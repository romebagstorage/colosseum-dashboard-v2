export const fmtEur = (n) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '€ ' + Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0 });
};

export const fmtEurDecimal = (n) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '€ ' + Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const fmtPct = (n) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toFixed(1).replace('.', ',') + '%';
};

export const fmtNum = (n) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString('it-IT');
};

export const fmtDate = (iso) => {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
};

export const MONTHS = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

import { HOUSES, HOUSES_BY_ID, houseIdForReservation } from '@/config/houses';

export const HOUSES_META = Object.fromEntries(HOUSES.map(h => [h.id, { name: h.name, short: h.short, color: h.color }]));

// Identifica la casa di una reservation. Il backend V2 precomputa r.houseId;
// fallback su listingId/titolo tramite la config.
export function classifyReservation(r) {
  if (r && r.houseId) return r.houseId;
  return houseIdForReservation(r?.listingId, r?.listing);
}

// Lead time in giorni tra bookingDate e checkIn
export function leadTime(r) {
  if (!r.bookingDate || !r.checkIn) return null;
  const a = new Date(r.bookingDate);
  const b = new Date(r.checkIn);
  if (isNaN(a) || isNaN(b)) return null;
  const days = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return days >= 0 ? days : null;
}
