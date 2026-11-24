// La misura della scheda «Canali»: per mese, casa e portale, quanto paga
// l'ospite e quanto arriva, dalle prenotazioni vere di /api/data.
//
// I soldi si dividono fra i mesi per notti, come in lib/kpi.js
// (`aggregate`): così la somma dei portali coincide con i ricavi e il netto
// della Panoramica per lo stesso periodo e le stesse case.
//   pagato = Pagamento totale − tassa di soggiorno (= «Ricavi» della dashboard)
//   netto  = Netto della dashboard (lib/guesty.js, `calcNetto`)
//   quota  = netto / pagato
// ATTENZIONE: il netto Booking non e' letto, e' calcolato con la commissione
// misurata per casa (config/houses.js, `calcNetto`): per Booking la quota e'
// fissa per casa, e non puo' «cambiare di colpo». Trip.com e Agoda versano gia'
// il netto: per loro pagato e netto coincidono.

import { PARITA_SOGLIE } from '@/config/parita';

export const GRUPPI = [
  { id: 'airbnb', name: 'Airbnb', stimato: false },
  { id: 'booking', name: 'Booking.com', stimato: true },
  // Il sito (Guesty BE-API, motore di Guesty, vecchio sito): il KPI del
  // progetto prenotazioni dirette. Netto stimato: la commissione Stripe e'
  // una stima (lib/guesty.js, COSTO_STRIPE_STIMA).
  { id: 'sito', name: 'Sito', stimato: true },
  { id: 'manuale', name: 'A mano', stimato: false },
  { id: 'partner', name: 'Partner', stimato: false },
  { id: 'altri', name: 'Altri portali', stimato: false },
];

/** Gruppi che il simulatore dei prezzi (config/parita.js) tratta come un solo canale «Diretto». */
export const GRUPPI_DIRETTI = ['sito', 'manuale', 'partner'];

/** Il gruppo di un canale della dashboard (`r.channel`, da `mapCanale`). */
export function gruppo(channel) {
  const s = String(channel || '').toLowerCase();
  if (s.includes('airbnb')) return 'airbnb';
  if (s.includes('booking')) return 'booking';
  if (s === 'sito') return 'sito';
  if (s === 'diretto' || s === 'offline') return 'manuale';
  if (s === 'partner') return 'partner';
  return 'altri';
}

function nightsByMonth(checkIn, checkOut) {
  const out = new Map();
  const d = new Date(checkIn + 'T00:00:00Z');
  const end = new Date(checkOut + 'T00:00:00Z');
  for (; d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    out.set(k, (out.get(k) || 0) + 1);
  }
  return [...out.entries()].map(([k, n]) => { const [y, m] = k.split('-').map(Number); return { year: y, month: m, nights: n }; });
}

const vuoto = () => ({ notti: 0, pagato: 0, netto: 0, tot: 0, tassa: 0 });

/**
 * Tabella [casa][gruppo]['AAAA-MM'] = { notti, pagato, netto, tot, tassa }.
 * Stesse regole di `aggregate` in lib/kpi.js.
 */
export function misura(reservations) {
  const acc = {};
  for (const r of reservations || []) {
    if (!r.checkIn || !r.checkOut || !(r.nights > 0)) continue;
    const parts = nightsByMonth(r.checkIn, r.checkOut);
    const totalNights = parts.reduce((s, p) => s + p.nights, 0) || 1;
    const g = gruppo(r.channel);
    for (const p of parts) {
      const f = p.nights / totalNights;
      const k = `${p.year}-${String(p.month + 1).padStart(2, '0')}`;
      const b = (((acc[r.houseId] ??= {})[g] ??= {})[k] ??= vuoto());
      b.notti += p.nights;
      b.tot += (r.paidTotal || 0) * f;
      b.tassa += (r.cityTax || 0) * f;
      b.pagato += ((r.paidTotal || 0) - (r.cityTax || 0)) * f;
      b.netto += (r.net || 0) * f;
    }
  }
  return acc;
}

/** Somma i bucket di case, gruppi e mesi scelti. `mesi` = array di 'AAAA-MM'. */
export function somma(tab, case_, gruppi, mesi) {
  const s = vuoto();
  for (const h of case_) for (const g of gruppi) for (const m of mesi) {
    const b = tab?.[h]?.[g]?.[m];
    if (!b) continue;
    s.notti += b.notti; s.pagato += b.pagato; s.netto += b.netto; s.tot += b.tot; s.tassa += b.tassa;
  }
  return { ...s, quota: s.pagato > 0 ? s.netto / s.pagato : null, nettoNotte: s.notti ? s.netto / s.notti : null, pagatoNotte: s.notti ? s.pagato / s.notti : null };
}

/**
 * I mesi del periodo scelto nell'intestazione, come fa la Panoramica: l'anno
 * intero, ma nell'anno in corso solo fino al mese corrente; oppure un mese solo.
 */
export function mesiDelPeriodo(year, monthIdx, currentYear, currentMonth) {
  const y = Number(year);
  if (monthIdx != null) return [`${y}-${String(monthIdx + 1).padStart(2, '0')}`];
  const fine = y === Number(currentYear) ? Number(currentMonth) : 11;
  return Array.from({ length: fine + 1 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
}

/** I mesi interi già passati, dal più vecchio: gli ultimi `n` prima del mese corrente. */
export function ultimiMesiChiusi(currentYear, currentMonth, n) {
  const out = [];
  let y = Number(currentYear), m = Number(currentMonth);
  for (let i = 0; i < n; i++) {
    m -= 1; if (m < 0) { m = 11; y -= 1; }
    out.unshift(`${y}-${String(m + 1).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Gli avvisi sulla misura: la quota netto/pagato di un portale nell'ultimo
 * mese chiuso, confrontata con la media dei tre mesi prima. Scatta se si
 * sposta di più di `puntiQuota` punti e il mese ha almeno `nottiMinime` notti.
 * Booking non si controlla: il suo netto è calcolato, non letto.
 */
export function avvisiMisura(data, case_, soglie = PARITA_SOGLIE) {
  if (!data?.reservations) return [];
  const tab = misura(data.reservations);
  const mesi = ultimiMesiChiusi(data.currentYear, data.currentMonth, 4);
  const [prima, ultimo] = [mesi.slice(0, 3), mesi[3]];
  const out = [];
  for (const g of GRUPPI) {
    if (g.stimato || g.id === 'altri') continue;
    const ora = somma(tab, case_, [g.id], [ultimo]);
    const pre = prima.map((m) => somma(tab, case_, [g.id], [m])).filter((x) => x.notti >= soglie.nottiMinime && x.quota != null);
    if (ora.notti < soglie.nottiMinime || ora.quota == null || pre.length < 2) continue;
    const media = pre.reduce((s, x) => s + x.quota, 0) / pre.length;
    const diff = (ora.quota - media) * 100;
    if (Math.abs(diff) > soglie.puntiQuota) out.push({ g: g.id, name: g.name, mese: ultimo, quota: ora.quota, media, diff, notti: ora.notti });
  }
  return out;
}

/** Le notti per portale con check-in negli ultimi 365 giorni, per casa (dati di partenza del simulatore). */
export function nottiUltimoAnno(reservations, oggi = new Date()) {
  const fine = oggi.toISOString().slice(0, 10);
  const d = new Date(oggi); d.setUTCDate(d.getUTCDate() - 365);
  const inizio = d.toISOString().slice(0, 10);
  const out = {};
  for (const r of reservations || []) {
    if (!r.checkIn || r.checkIn < inizio || r.checkIn >= fine) continue;
    const g0 = gruppo(r.channel);
    const g = GRUPPI_DIRETTI.includes(g0) ? 'direct' : g0;
    const o = (out[r.houseId] ??= { airbnb: 0, booking: 0, direct: 0, altri: 0 });
    o[g] += r.nights || 0;
  }
  return { inizio, fine, perCasa: out };
}
