// Costruisce il payload della dashboard direttamente da Guesty (stessa forma della V1
// così il frontend resta compatibile). Solo KPI operativi: niente costi/utile.

import { fetchReservations, normalizeReservation } from './guesty';
import { aggregate, isCounted } from './kpi';

import { HOUSES, START_YEAR } from '../config/houses.js';
export { START_YEAR };
const HOUSE_NAMES = Object.fromEntries(HOUSES.map(h => [h.id, h.name]));

function series(arr, key, { upTo, avg = false } = {}) {
  // upTo: ultimo indice mese (0-11) da esporre; oltre → null (mesi futuri non ancora "consuntivo")
  const monthly = arr.map((b, i) => (upTo != null && i > upTo) ? null : b[key]);
  const vals = monthly.filter(v => v != null);
  let total;
  if (!vals.length) total = null;
  else if (avg) total = vals.reduce((s, v) => s + v, 0) / vals.length;
  else total = vals.reduce((s, v) => s + v, 0);
  return { monthly, total };
}

// "Oggi" in ora italiana (le funzioni Vercel girano in UTC).
function romeNow() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = k => Number(p.find(x => x.type === k).value);
  return { year: g('year'), month: g('month') - 1, day: g('day') };
}

// createdAt in Guesty è la data di creazione del record, non sempre la data di prenotazione:
// quando molte prenotazioni risultano create lo stesso giorno (import/collegamento canale)
// la data non è affidabile per il lead time → bookingDate = null.
const IMPORT_DAY_THRESHOLD = 10;
function markImportedBookingDates(rows) {
  const perDay = {};
  for (const r of rows) if (r.bookingDate) perDay[r.bookingDate] = (perDay[r.bookingDate] || 0) + 1;
  const importDays = new Set(Object.keys(perDay).filter(d => perDay[d] >= IMPORT_DAY_THRESHOLD));
  let n = 0;
  for (const r of rows) if (r.bookingDate && (importDays.has(r.bookingDate) || r.bookingDate > r.checkIn)) { r.bookingDate = null; n++; }
  return { importDays: [...importDays].sort(), unreliable: n };
}

export async function buildPayload() {
  const t0 = Date.now();
  const { year: curYear, month: curMonth } = romeNow();
  const from = `${START_YEAR}-01-01`;
  const to = `${curYear + 1}-12-31`;

  const raw = await fetchReservations(from, to);
  const all = raw.map(normalizeReservation);
  const counted = all.filter(r => isCounted(r) && r.houseId !== 'OTHER');
  const unassigned = all.filter(r => isCounted(r) && r.houseId === 'OTHER');
  // Cancellate (solo status «canceled»: le richieste rifiutate o scadute non erano prenotazioni)
  const cancelledRaw = all.filter(r => r.status === 'canceled' && r.houseId !== 'OTHER');
  const importInfo = markImportedBookingDates(counted);
  const unmappedNet = {};
  for (const r of counted) if (!(r.net > 0) && r.paidTotal > 0) unmappedNet[r.source] = (unmappedNet[r.source] || 0) + 1;
  const warnings = [];
  if (unassigned.length) warnings.push(`${unassigned.length} prenotazioni confermate non attribuite a nessuna casa (listing sconosciuto)`);
  if (Object.keys(unmappedNet).length) warnings.push('Netto non calcolabile (canale senza regola): ' + Object.entries(unmappedNet).map(([k, v]) => `${k} ×${v}`).join(', '));

  const years = [];
  for (let y = START_YEAR; y <= curYear; y++) years.push(y);
  const agg = aggregate(counted, { years });

  const houses = {};
  for (const h of Object.keys(HOUSE_NAMES)) {
    const monthly = {};
    for (const y of years) {
      const arr = agg[h]?.[y];
      if (!arr) continue;
      const upTo = (y === curYear) ? curMonth : null;
      const hasAny = arr.some((b, i) => (upTo == null || i <= upTo) && b.notti > 0);
      if (!hasAny) continue;
      const nightsSum = arr.reduce((s, b, i) => (upTo == null || i <= upTo) ? s + b.notti : s, 0);
      const revSum = arr.reduce((s, b, i) => (upTo == null || i <= upTo) ? s + b.ricavi : s, 0);
      const prenSum = arr.reduce((s, b, i) => (upTo == null || i <= upTo) ? s + b.prenotazioni : s, 0);
      monthly[String(y)] = {
        prenotazioni: series(arr, 'prenotazioni', { upTo }),
        notti: series(arr, 'notti', { upTo }),
        ricavi: series(arr, 'ricavi', { upTo }),
        ricaviNettiOTA: series(arr, 'ricaviNettiOTA', { upTo }),
        tassaSoggiorno: series(arr, 'tassa', { upTo }),
        pagamentoTotale: series(arr, 'tot', { upTo }),
        imposte: series(arr, 'imposte', { upTo }),
        occupazione: (() => {
          // mesi pre-apertura (prima del primo mese con notti) → null, così non abbassano le medie
          const first = arr.findIndex(b => b.notti > 0);
          const o = series(arr, 'occupazione', { upTo, avg: true });
          o.monthly = o.monthly.map((v, i) => (i < first ? null : v));
          const vals = o.monthly.filter(v => v != null);
          o.total = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
          return o;
        })(),
        adr: { ...series(arr, 'adr', { upTo, avg: true }), total: nightsSum ? revSum / nightsSum : null },
        ricavoMedioPerPren: { ...series(arr, 'ricavoMedioPerPren', { upTo, avg: true }), total: prenSum ? revSum / prenSum : null },
      };
    }
    houses[h] = { name: HOUSE_NAMES[h], monthly };
  }

  // Reservation "leggere" per mix canali / ospiti / forward booking (tutte, 2025 → anno prossimo)
  const reservations = counted.map(r => ({
    guest: r.guest, country: r.country, persons: r.persons, nights: r.nights,
    checkIn: r.checkIn, checkOut: r.checkOut, confirmationCode: r.confirmationCode,
    listing: r.listing, listingId: r.listingId, houseId: r.houseId, channel: r.channel,
    gross: Math.round(r.gross * 100) / 100, cityTax: Math.round(r.cityTax * 100) / 100,
    paidTotal: Math.round(r.paidTotal * 100) / 100, net: Math.round(r.net * 100) / 100,
    status: r.status, bookingDate: r.bookingDate, year: r.year,
  }));

  // Cancellate «leggere»: servono a tasso di cancellazione e confronti alla stessa data
  const cancelled = cancelledRaw.map(r => ({
    houseId: r.houseId, listing: r.listing, listingId: r.listingId, channel: r.channel,
    checkIn: r.checkIn, checkOut: r.checkOut, nights: r.nights,
    paidTotal: Math.round(r.paidTotal * 100) / 100, cityTax: Math.round(r.cityTax * 100) / 100,
    gross: Math.round(r.gross * 100) / 100,
    bookingDate: r.bookingDate || null, canceledAt: r.canceledAt || null,
  }));

  return {
    version: 'v2-guesty',
    source: 'guesty',
    generatedAt: new Date().toISOString(),
    startYear: START_YEAR,
    currentYear: curYear,
    currentMonth: curMonth,
    houses,
    reservations,
    cancelled,
    counts: { fetched: raw.length, counted: counted.length, cancelled: cancelled.length, unassigned: unassigned.length, bookingDateUnreliable: importInfo.unreliable },
    warnings,
    elapsedMs: Date.now() - t0,
  };
}

// ---- cache condivisa (Vercel Data Cache, 10 minuti) fra page server-side e /api/data ----
import { unstable_cache, revalidateTag } from 'next/cache.js';

let lastGood = null; // ultimo payload valido di questa istanza (fallback se Guesty è giù)
const cachedPayload = unstable_cache(() => buildPayload(), ['guesty-dashboard-payload'], { revalidate: 600, tags: ['guesty-data'] });

// Modalità demo (solo per anteprime grafiche): DEMO_PAYLOAD=1 legge data/demo-payload.json invece di Guesty.
async function demoPayload() {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const raw = await fs.readFile(path.join(process.cwd(), 'data', 'demo-payload.json'), 'utf8');
  return { ...JSON.parse(raw), generatedAt: new Date().toISOString(), version: 'demo' };
}

export async function getPayload({ refresh = false } = {}) {
  if (process.env.DEMO_PAYLOAD === '1') return demoPayload();
  if (refresh) { try { revalidateTag('guesty-data'); } catch {} }
  let data;
  try { data = await cachedPayload(); }
  catch (e) {
    if (/incrementalCache/.test(String(e))) data = await buildPayload();
    else if (lastGood) return { ...lastGood, _cache: 'stale', _error: String(e.message || e) };
    else throw e;
  }
  lastGood = data;
  const age = Date.now() - new Date(data.generatedAt).getTime();
  return { ...data, _cache: age < 5000 ? 'miss' : 'hit', _cacheAge: age };
}
