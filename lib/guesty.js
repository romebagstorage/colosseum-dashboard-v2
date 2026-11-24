// Accesso diretto a Guesty Open API + formule monetarie (allineate al Guesty Sync Apps Script).

const TOKEN_URL = 'https://open-api.guesty.com/oauth2/token';
const API = 'https://open-api.guesty.com/v1';

import { unstable_cache, revalidateTag } from 'next/cache.js';
import { storeGet, storeSet, storeEnabled } from './store.js';

// ---------------------------------------------------------------------------
// TOKEN. Guesty concede pochi token al giorno per client (x-ratelimit-limit-day = 5).
// Strategia: 1) memoria dell'istanza → 2) store condiviso (Edge Config) → 3) Data Cache di
// Next → 4) richiesta a Guesty, con un contatore giornaliero che si rifiuta di superare
// MAX_TOKEN_REQUESTS_PER_DAY per lasciare margine agli Apps Script che usano lo stesso client.
// ---------------------------------------------------------------------------
const MAX_TOKEN_REQUESTS_PER_DAY = 3;
const TOKEN_KEY = 'guesty_token';
const TOKEN_LOG_KEY = 'guesty_token_requests';
const BLOCKED_KEY = 'guesty_token_blocked_until';

async function requestToken() {
  // guardia sul budget giornaliero (best-effort, solo se lo store è configurato)
  const blockedUntil = Number(await storeGet(BLOCKED_KEY)) || 0;
  if (blockedUntil > Date.now()) {
    throw new Error(`Guesty: limite giornaliero token raggiunto. Riprova dopo le ${new Date(blockedUntil).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}.`);
  }
  const log = (await storeGet(TOKEN_LOG_KEY)) || [];
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const recent = Array.isArray(log) ? log.filter(t => t > dayAgo) : [];
  if (storeEnabled() && recent.length >= MAX_TOKEN_REQUESTS_PER_DAY) {
    const next = new Date(Math.min(...recent) + 24 * 3600 * 1000);
    throw new Error(`Guesty: raggiunto il budget interno di ${MAX_TOKEN_REQUESTS_PER_DAY} richieste token/giorno della dashboard (limite Guesty 5/giorno, condiviso con gli Apps Script). Prossima richiesta possibile dopo le ${next.toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}.`);
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'open-api',
    client_id: process.env.GUESTY_CLIENT_ID,
    client_secret: process.env.GUESTY_CLIENT_SECRET,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    cache: 'no-store',
  });
  if (res.status === 429) {
    const ra = Number(res.headers.get('retry-after')) || 0;
    const hrs = ra ? (ra / 3600).toFixed(1) : '?';
    // memorizzo il blocco così le altre istanze non insistono (e non si consumano tentativi)
    await storeSet(BLOCKED_KEY, Date.now() + (ra ? ra * 1000 : 3600 * 1000));
    throw new Error(`Guesty: raggiunto il limite giornaliero di richieste token (${res.headers.get('x-ratelimit-limit-day') || 5}/giorno). Riprova tra circa ${hrs} ore.`);
  }
  if (!res.ok) throw new Error(`Guesty token ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const t = { token: j.access_token, issuedAt: Date.now(), expiresIn: j.expires_in || 86400 };
  await storeSet(TOKEN_LOG_KEY, [...recent, Date.now()]); // conto solo i token effettivamente emessi
  await storeSet(TOKEN_KEY, t);
  return t;
}

const cachedToken = unstable_cache(requestToken, ['guesty-oauth-token'], { revalidate: 23 * 3600, tags: ['guesty-token'] });
let memToken = { token: null, exp: 0 };
const validFor = (t) => t && t.token && Date.now() < t.issuedAt + t.expiresIn * 1000 - 5 * 60 * 1000;

export async function getToken() {
  // script e prove locali: token già emesso passato a mano (mai chiederne uno nuovo per una prova)
  if (process.env.GUESTY_ACCESS_TOKEN) return process.env.GUESTY_ACCESS_TOKEN;
  if (memToken.token && Date.now() < memToken.exp - 60_000) return memToken.token;
  let t = await storeGet(TOKEN_KEY);
  if (!validFor(t)) {
    try { t = await cachedToken(); }
    catch (e) { if (/incrementalCache/.test(String(e))) t = await requestToken(); else throw e; } // fuori da Next (script) → diretto
    if (!validFor(t)) { t = await requestToken(); }
  }
  memToken = { token: t.token, exp: t.issuedAt + t.expiresIn * 1000 };
  return t.token;
}

export function invalidateToken() {
  memToken = { token: null, exp: 0 };
  storeSet(TOKEN_KEY, null).catch(() => {});
  try { revalidateTag('guesty-token'); } catch {}
}

// ---------------------------------------------------------------------------
// LETTURA PRENOTAZIONI.
// Guesty spegne GET /reservations (legacy) il 01/03/2027. Dal 17/11/2026 la dashboard legge
// GET /reservations-reports/reservations/search, che restituisce in una sola chiamata money,
// ospite, annuncio e date di cancellazione; ogni riga viene riportata alla forma legacy
// (toLegacyShape) così normalizeReservation e le formule restano identiche.
// GUESTY_API=legacy torna alla vecchia lettura (solo fino al 01/03/2027, per confronti/rollback).
// ---------------------------------------------------------------------------

/** Tutte le reservation con check-out (data locale) nel range [from, to] (YYYY-MM-DD). */
export async function fetchReservations(from, to) {
  if (process.env.GUESTY_API === 'legacy') return fetchReservationsLegacy(from, to);
  return fetchReservationsReport(from, to);
}

export async function fetchReservationsReport(from, to) {
  return (await fetchReportRaw(from, to)).map(toLegacyShape);
}

const REPORT_PAGE = 100; // massimo consentito dall'endpoint
/** Righe grezze di /reservations-reports/reservations/search (check-out locale in [from, to]). */
export async function fetchReportRaw(from, to, _retried = false) {
  const token = await getToken();
  const out = [];
  const seen = new Set();
  for (let skip = 0; ; skip += REPORT_PAGE) {
    const qs = new URLSearchParams({
      limit: String(REPORT_PAGE), skip: String(skip), sort: 'checkIn',
      'filter[checkOutDate][gte]': from, 'filter[checkOutDate][lte]': to,
    });
    const res = await fetch(`${API}/reservations-reports/reservations/search?${qs}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store',
    });
    if (res.status === 401 && !_retried) { invalidateToken(); return fetchReportRaw(from, to, true); }
    if (!res.ok) throw new Error(`Guesty reservations-reports ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    const rows = Array.isArray(j.results) ? j.results : [];
    for (const r of rows) {
      const id = r.reservationId || r._id;
      if (seen.has(id)) continue; // difesa contro sovrapposizioni fra pagine
      seen.add(id);
      out.push(r);
    }
    const hasMore = j.pagination ? !!j.pagination.hasMore : rows.length === REPORT_PAGE;
    if (!hasMore) break;
    if (!rows.length) throw new Error('Guesty: paginazione anomala (hasMore senza risultati)');
    if (skip > 20000) throw new Error('Guesty: paginazione anomala (>20.000 prenotazioni)');
  }
  return out;
}

// Tassa di soggiorno incassata da Airbnb. La vecchia API la dava in money.transientOccupancyTax
// (senza una voce di fattura); la nuova non la espone da nessuna parte (verificato il 17/11/2026
// su reservations-reports, guest-folio/overview e invoice-items). Quindi:
//  - prenotazioni concluse prima del 17/11/2026 → valore storico di Guesty congelato (identico al centesimo);
//  - le altre → regola del Comune di Roma, 6 € a ospite a notte per al massimo 10 notti
//    (sulle 249 prenotazioni Airbnb 2026 coincide con Guesty in 240 casi).
// Solo prenotazioni confermate (Guesty dava 0 alle altre); una voce CT/TT in fattura ha la precedenza.
import { TASSA_AIRBNB_STORICA } from '../config/tassa-airbnb-storica.js';
const TASSA_ROMA_PER_OSPITE_NOTTE = 6;
const TASSA_ROMA_NOTTI_MAX = 10;
const TASSA_STATI = new Set(['confirmed', 'checked_in', 'checked_out']); // richieste, cancellate ecc.: Guesty dava 0
function tassaAirbnbMancante(r, money) {
  const id = r.reservationId || r._id;
  if (Object.prototype.hasOwnProperty.call(TASSA_AIRBNB_STORICA, id)) return TASSA_AIRBNB_STORICA[id];
  if (!/airbnb/i.test(String(r.source || '')) || !TASSA_STATI.has(r.status)) return undefined;
  const items = Array.isArray(money.invoiceItems) ? money.invoiceItems : [];
  if (items.some(it => it.normalType === 'CT' || it.normalType === 'TT' || it.type === 'CITY_TAX')) return undefined;
  const nights = Math.max(Number(r.numberOfNights ?? r.nightsCount) || 1, 1);
  const guests = Math.max(Number(r.guestsCount) || 1, 1);
  return TASSA_ROMA_PER_OSPITE_NOTTE * guests * Math.min(nights, TASSA_ROMA_NOTTI_MAX);
}

/** Riga di /reservations-reports → stessa forma dei campi che leggevamo da GET /reservations. */
export function toLegacyShape(r) {
  const stay = Array.isArray(r.stay) && r.stay.length ? r.stay : [];
  const first = stay[0] || {}, last = stay[stay.length - 1] || {};
  const listingId = r.listingId || first.listingId || '';
  const money = r.money ? { ...r.money } : undefined;
  if (money && money.transientOccupancyTax === undefined) {
    const t = tassaAirbnbMancante(r, money);
    if (t !== undefined) money.transientOccupancyTax = t;
  }
  return {
    _id: r.reservationId || r._id,
    status: r.status,
    source: r.source,
    checkIn: r.checkIn, checkOut: r.checkOut,
    checkInDateLocalized: r.checkInDate || first.checkInDateLocalized || (r.checkIn || '').slice(0, 10),
    checkOutDateLocalized: r.checkOutDate || last.checkOutDateLocalized || (r.checkOut || '').slice(0, 10),
    nightsCount: r.numberOfNights ?? r.nightsCount,
    guestsCount: r.guestsCount,
    confirmationCode: r.confirmationCode,
    createdAt: r.createdAt,
    canceledAt: r.cancelationDate || r.canceledAt || null,
    listingId,
    listing: { _id: listingId, title: r.listing?.title || first.unitTypeName || '' },
    guest: { fullName: r.guest?.fullName || [r.guest?.firstName, r.guest?.lastName].filter(Boolean).join(' '), address: { country: r.guest?.address?.country || '' } },
    money,
  };
}

const FIELDS = [
  '_id', 'status', 'source', 'checkIn', 'checkOut', 'checkInDateLocalized', 'checkOutDateLocalized',
  'nightsCount', 'guestsCount', 'confirmationCode', 'createdAt', 'canceledAt', 'listingId',
  'guest.fullName', 'guest.address.country',
  'listing.title', 'listing._id',
  'money.totalPaid', 'money.hostPayout', 'money.hostServiceFee', 'money.subTotalPrice',
  'money.totalTaxes', 'money.fareAccommodation', 'money.fareCleaning',
  'money.transientOccupancyTax', 'money.invoiceItems', 'money.currency',
].join(' ');

/** LEGACY (spenta il 01/03/2027): reservation con checkOutDateLocalized nel range [from, to]. */
export async function fetchReservationsLegacy(from, to, _retried = false) {
  const token = await getToken();
  const filters = JSON.stringify([
    { operator: '$gte', field: 'checkOutDateLocalized', value: from },
    { operator: '$lte', field: 'checkOutDateLocalized', value: to },
  ]);
  const out = [];
  const limit = 100;
  let expected = null;
  for (let skip = 0; ; skip += limit) {
    const url = `${API}/reservations?limit=${limit}&skip=${skip}&fields=${encodeURIComponent(FIELDS)}&filters=${encodeURIComponent(filters)}&sort=checkIn`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
    if (res.status === 401 && !_retried) { invalidateToken(); return fetchReservationsLegacy(from, to, true); }
    if (!res.ok) throw new Error(`Guesty reservations ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    const rows = j.results || [];
    if (expected == null && typeof j.count === 'number') expected = j.count;
    out.push(...rows);
    if (rows.length < limit) break;
    if (skip > 20000) throw new Error('Guesty: paginazione anomala (>20.000 prenotazioni)');
  }
  if (expected != null && out.length !== expected) throw new Error(`Guesty: lette ${out.length} prenotazioni su ${expected} attese (paginazione incompleta)`);
  return out;
}

// ---------- formule monetarie (copiate 1:1 dal Guesty Sync) ----------

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

// Tassa di soggiorno. Ordine: money.transientOccupancyTax → voce fattura CT/TT → stima.
// Sanity check: su alcune prenotazioni Airbnb 2025 Guesty riporta valori assurdi
// (es. 216407 € per 4 notti); se la tassa supera 20 €/notte/persona la ignoro.
const CITY_TAX_MAX_PER_NIGHT_PERSON = 20;
const CITY_TAX_ESTIMATE_PER_NIGHT_PERSON = 6;
export function getCityTaxResolved(money, r) {
  if (!money) return '';
  const nights = Math.max(Number(r?.nightsCount) || 1, 1);
  const persons = Math.max(Number(r?.guestsCount) || 1, 1);
  const plausible = (v) => v !== '' && v != null && isFinite(Number(v)) && Number(v) >= 0 && Number(v) / (nights * persons) <= CITY_TAX_MAX_PER_NIGHT_PERSON;
  const items = Array.isArray(money.invoiceItems) ? money.invoiceItems : [];
  const fromItem = () => {
    for (const it of items) {
      const t = String(it.title || '').toUpperCase();
      if (it.normalType === 'CT' || it.normalType === 'TT' || it.type === 'CITY_TAX' || t.includes('CITY') || t.includes('TOURISM')) return it.amount;
    }
    return '';
  };
  const tot = money.transientOccupancyTax;
  if (tot !== undefined && tot !== null && tot !== '') {
    if (plausible(tot)) return tot;
    const it = fromItem();
    if (plausible(it)) return it;
    return nights * persons * CITY_TAX_ESTIMATE_PER_NIGHT_PERSON; // stima
  }
  return fromItem();
}

export function getHostChannelFeeAbs(money) {
  const items = Array.isArray(money?.invoiceItems) ? money.invoiceItems : [];
  for (const it of items) {
    const t = String(it.title || '').toUpperCase();
    if (it.normalType === 'HCF' || t.includes('HOST CHANNEL') || t.includes('CHANNEL FEE')) {
      return Math.abs(Number(it.amount) || 0);
    }
  }
  return 0;
}

// Lordi = quanto vale la prenotazione per l'host. Il sync usava totalPaid||hostPayout, ma in
// Guesty totalPaid può contenere solo un incasso parziale (es. nel 2025 per Booking.com risultava
// registrata solo la tassa di soggiorno incassata in loco): si prende il maggiore fra i due.
export function calcLordi(money) {
  if (!money) return '';
  const tp = Number(money.totalPaid) || 0;
  const hp = Number(money.hostPayout) || 0;
  const v = Math.max(tp, hp);
  return v > 0 ? v : '';
}

export function calcPagamentoTotale(r, money, lordi, cityTax) {
  const src = String(r.source || '').toLowerCase();
  const m = money || {};
  const ct = num(cityTax);
  if (/airbnb/.test(src)) {
    const v = num(m.hostPayout) + num(m.hostServiceFee) + ct;
    return v > 0 ? v : num(lordi);
  }
  if (/agoda/.test(src)) return num(lordi) + ct;
  if (/travelstaytion/.test(src)) return num(m.subTotalPrice) + getHostChannelFeeAbs(m) + (num(m.totalTaxes) || ct);
  if (/plumguide/.test(src)) return num(m.hostPayout) + num(m.fareCleaning) + num(m.totalTaxes);
  if (/vrbo|homeaway/.test(src)) {
    if (num(m.hostPayout) > 0) return num(m.hostPayout);
    const v = num(m.subTotalPrice) + num(m.totalTaxes);
    return v > 0 ? v : num(lordi);
  }
  return num(lordi);
}

export function calcNetto(r, money, lordi, cityTax, pagTot) {
  const src = String(r.source || '').toLowerCase();
  const m = money || {};
  const ct = num(cityTax);
  const pt = num(pagTot);
  let v;
  if (/airbnb|travelstaytion/.test(src)) v = num(lordi);
  else if (/^bookingengine$|^direct$|^partner$|^owner-guest$/.test(src)) v = (pt || num(lordi)) - ct;
  // Booking: la commissione misurata per casa (config/houses.js, 19/11/2026);
  // per un annuncio senza valore, il 23,79% di prima.
  else if (/booking/.test(src)) v = (pt - ct) * (1 - (HOUSES_BY_ID[houseOf(r)]?.bookingCommission ?? (0.18 + 0.015) * 1.22));
  else if (/plumguide/.test(src)) v = num(m.hostPayout) - getHostChannelFeeAbs(m);
  // Agoda versa all'host l'importo già al netto della commissione (= Lordi): la vecchia formula
  // fareAccommodation × 1,15 dava un netto più alto del ricavo (riconciliazione 2025, 01/10/2026).
  else if (/agoda/.test(src)) v = num(lordi);
  else if (/vrbo|homeaway/.test(src)) v = pt - 0.15 * (pt - ct);
  // Ostrovok (via Rentals United): commissione 18% sul totale (decisione 01/10/2026).
  else if (/ostrovok/.test(src)) v = pt * 0.82 - ct;
  else if (/^website$|^manual$|^tripcom$/.test(src)) v = (pt || num(lordi)) - ct;
  // Il sito (BE-API, dal 22/10/2026): l'ospite paga con Stripe sul conto
  // collegato a Guesty. Al netto va tolto il costo d'incasso Stripe, qui
  // stimato: da confermare con il rapporto Stripe del conto.
  else if (/^be-api$/.test(src)) v = (pt || num(lordi)) - ct - costoStripe(pt || num(lordi));
  else return '';
  return v > 0 ? v : '';
}

// Costo d'incasso Stripe per le prenotazioni del sito: STIMA (24/11/2026).
// Carte europee 1,5% + 0,25 €, extraeuropee e britanniche di piu': 2,5% e'
// una media prudente per ospiti in buona parte non europei.
export const COSTO_STRIPE_STIMA = { perc: 0.025, fisso: 0.25 };
export function costoStripe(importo) {
  const x = num(importo);
  return x > 0 ? x * COSTO_STRIPE_STIMA.perc + COSTO_STRIPE_STIMA.fisso : 0;
}

export const CANALE_MAP = {
  'airbnb2': 'Airbnb', 'booking.com': 'Bookingcom', 'manual': 'OFFLINE', 'travelstaytion': 'Travel Staytion',
  'tripcom': 'Trip.com', 'agoda': 'Agoda', 'plumguide': 'PlumGuide', 'vrbo': 'VRBO', 'homeaway it': 'HomeAway',
  'website': 'Sito', 'be-api': 'Sito', 'ostrovok@rentalsunited.com': 'Ostrovok', 'rentalz': 'Rentalz',
  'bookingcom': 'Bookingcom', 'bookingengine': 'Sito', 'direct': 'Diretto', 'partner': 'Partner',
  'owner-guest': 'OFFLINE', 'homeaway': 'HomeAway', 'homeaway2': 'HomeAway', 'homeaway es': 'HomeAway',
};
export function mapCanale(source) {
  const s = String(source || '').toLowerCase();
  return CANALE_MAP[s] || source || '';
}

// ---------- normalizzazione in "riga prenotazione" ----------

import { houseIdForReservation, HOUSES_BY_ID } from '../config/houses.js';
export function houseOf(r) {
  return houseIdForReservation(r.listingId || r.listing?._id, r.listing?.title);
}

export function normalizeReservation(r) {
  const money = r.money || {};
  const lordi = calcLordi(money);
  const cityTax = getCityTaxResolved(money, r);
  const pagTot = calcPagamentoTotale(r, money, lordi, cityTax);
  const netto = calcNetto(r, money, lordi, cityTax, pagTot);
  const checkIn = (r.checkInDateLocalized || r.checkIn || '').slice(0, 10);
  const checkOut = (r.checkOutDateLocalized || r.checkOut || '').slice(0, 10);
  return {
    id: r._id,
    status: r.status,
    guest: r.guest?.fullName || '',
    country: r.guest?.address?.country || '',
    persons: r.guestsCount || 0,
    nights: r.nightsCount || 0,
    checkIn, checkOut,
    confirmationCode: r.confirmationCode || '',
    listing: r.listing?.title || '',
    listingId: r.listingId || r.listing?._id || '',
    houseId: houseOf(r),
    channel: mapCanale(r.source),
    source: r.source,
    gross: num(lordi),          // Lordi
    cityTax: num(cityTax),      // Tassa di soggiorno
    paidTotal: num(pagTot),     // Pagamento totale (TOT)
    net: num(netto),            // Netto
    bookingDate: (r.createdAt || '').slice(0, 10),
    canceledAt: (r.canceledAt || '').slice(0, 10) || null, // data di cancellazione (solo status canceled)
    year: Number(checkOut.slice(0, 4)),
  };
}
