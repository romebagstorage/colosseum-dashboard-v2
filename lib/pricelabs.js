// Il salvataggio giornaliero dei prezzi PriceLabs (dal 19/11/2026).
//
// PriceLabs mostra solo i prezzi di oggi: quelli di ieri non si possono piu'
// rileggere. Ogni mattina questa funzione scarica, per le 5 case, i prezzi dei
// prossimi 365 giorni e li salva in un file del giorno, cosi' si puo' vedere
// come cambia un prezzo man mano che la data si avvicina e cosa c'era quando
// e' arrivata (o non e' arrivata) una prenotazione.
//
// Fonte: PriceLabs Customer API (https://developers.pricelabs.co, lette il
// 19/11/2026):
//   GET  /v1/listings        minimo, base e massimo, ultima sincronizzazione
//   POST /v1/listing_prices  i prezzi giorno per giorno
// Limiti: 60 richieste al minuto, 1.000 l'ora; qui se ne fanno 2 al giorno.
// La chiave e' PRICELABS_API_KEY (solo Production, la mette Alberto su
// Vercel). Questa funzione legge e basta: non cambia niente su PriceLabs.

import { houseIdForReservation, ALL_HOUSE_IDS } from '../config/houses.js';

export const PRICELABS_BASE = 'https://api.pricelabs.co';
export const GIORNI_AVANTI = 365;

// I campi tenuti per ogni giorno, in quest'ordine (il file sta in colonne per
// essere piccolo: ~5 case x 366 giorni).
export const COLONNE = [
  'date', 'price', 'user_price', 'booked_price', 'uncustomized_price',
  'min_stay', 'booking_status', 'unbookable', 'check_in', 'check_out', 'demand_desc',
];

const CAMPI_CASA = ['min', 'base', 'max', 'recommended_base_price', 'push_enabled', 'last_date_pushed', 'last_refreshed_at', 'currency'];

/** 'AAAA-MM-GG' del giorno a Roma. */
export function giornoRoma(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function piuGiorni(giorno, n) {
  const d = new Date(giorno + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function chiama(fetchImpl, base, key, path, init = {}) {
  const r = await fetchImpl(base + path, {
    ...init,
    // Mai dalla cache di Next.js: senza, le prove in locale hanno mostrato la
    // risposta di un giorno prima anche a PriceLabs spento.
    cache: 'no-store',
    headers: { 'X-API-Key': key, 'Content-Type': 'application/json', ...(init.headers || {}) },
    // PriceLabs consiglia di aspettare fino a 300 secondi.
    signal: AbortSignal.timeout(280_000),
  });
  const testo = await r.text();
  if (!r.ok) throw new Error(`PriceLabs ${path}: HTTP ${r.status} ${testo.slice(0, 200)}`);
  try { return JSON.parse(testo); } catch { throw new Error(`PriceLabs ${path}: risposta non JSON`); }
}

/**
 * Scarica case e prezzi e compone l'istantanea del giorno.
 * Ritorna { giorno, istantanea, avvisi }. Non salva niente.
 */
export async function leggiPricelabs({ key, fetchImpl = fetch, base = PRICELABS_BASE, ora = new Date() }) {
  if (!key) throw new Error('PRICELABS_API_KEY non impostata');
  const giorno = giornoRoma(ora);
  const avvisi = [];

  const { listings = [] } = await chiama(fetchImpl, base, key, '/v1/listings?only_syncing_listings=false');
  const case_ = {};
  for (const l of listings) {
    const h = houseIdForReservation(l.id, l.name);
    if (h === 'OTHER') { avvisi.push(`annuncio PriceLabs non riconosciuto: ${l.name || l.id}`); continue; }
    if (case_[h]) { avvisi.push(`due annunci PriceLabs per ${h}: tengo ${case_[h].id}, salto ${l.id}`); continue; }
    case_[h] = { id: l.id, pms: l.pms, nome: l.name, ...Object.fromEntries(CAMPI_CASA.filter((k) => l[k] !== undefined).map((k) => [k, l[k]])) };
  }
  for (const h of ALL_HOUSE_IDS) if (!case_[h]) avvisi.push(`${h}: nessun annuncio su PriceLabs`);

  const ids = Object.values(case_);
  if (ids.length) {
    const dateTo = piuGiorni(giorno, GIORNI_AVANTI);
    const prezzi = await chiama(fetchImpl, base, key, '/v1/listing_prices', {
      method: 'POST',
      body: JSON.stringify({ listings: ids.map((c) => ({ id: c.id, pms: c.pms, dateFrom: giorno, dateTo })) }),
    });
    for (const p of Array.isArray(prezzi) ? prezzi : []) {
      const h = Object.keys(case_).find((k) => case_[k].id === p.id);
      if (!h) continue;
      if (p.error || p.error_status) { avvisi.push(`${h}: ${p.error_status || ''} ${p.error || ''}`.trim()); continue; }
      const c = case_[h];
      if (p.last_refreshed_at) c.last_refreshed_at = p.last_refreshed_at;
      if (p.currency) c.currency = p.currency;
      if (p.los_pricing && Object.keys(p.los_pricing).length) c.los_pricing = p.los_pricing;
      c.giorni = (p.data || []).map((d) => COLONNE.map((k) => (d[k] === undefined ? null : d[k])));
    }
    for (const [h, c] of Object.entries(case_)) if (!c.giorni?.length) avvisi.push(`${h}: nessun prezzo giornaliero`);
  }

  const istantanea = {
    v: 1,
    giorno,
    salvata_alle: ora.toISOString(),
    fonte: 'PriceLabs Customer API: /v1/listings e /v1/listing_prices',
    colonne: COLONNE,
    case: case_,
    avvisi,
  };
  return { giorno, istantanea, avvisi };
}

/** Il nome del file del giorno nello spazio Blob. */
export const fileDelGiorno = (giorno) => `prezzi-pricelabs/${giorno}.json`;

/**
 * Salva l'istantanea: nello spazio Vercel Blob privato o, solo per le prove in
 * locale, in una cartella (PREZZI_DIR).
 */
export async function salvaIstantanea(istantanea) {
  const nome = fileDelGiorno(istantanea.giorno);
  const testo = JSON.stringify(istantanea);
  // Su Vercel (VERCEL=1) si salva sempre nello spazio Blob.
  if (process.env.PREZZI_DIR && !process.env.VERCEL) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const f = path.join(process.env.PREZZI_DIR, nome);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, testo);
    return { nome, byte: Buffer.byteLength(testo), dove: 'locale' };
  }
  const { put } = await import('@vercel/blob');
  await put(nome, testo, { access: 'private', contentType: 'application/json', allowOverwrite: true, addRandomSuffix: false });
  return { nome, byte: Buffer.byteLength(testo), dove: 'blob' };
}
