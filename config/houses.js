// ============================================================================
// CONFIGURAZIONE STRUTTURE — unico punto da modificare per un altro account Guesty.
// Ogni casa: id breve (chiave usata ovunque), nome, etichetta corta, colore grafico,
// e UNA regola di matching sulle reservation Guesty:
//   - listingId: match esatto su reservation.listingId (preferito, univoco)
//   - titleIncludes: substring (lowercase) su reservation.listing.title
// L'ordine dell'array è l'ordine di visualizzazione.
// ============================================================================
// bookingCommission: commissione e costi di Booking.com sul pagato senza tassa
// di soggiorno (alloggio + pulizie), misurata il 19/11/2026 su 55 prenotazioni
// dal 24/08/2026 (dettaglio prenotazione nell'extranet): 24,5% su Poliziano,
// Bilocale e Trilocale, 19,5% su Marco Aurelio e Prestige. Il motivo della
// differenza non e' noto. Usata da `calcNetto` in lib/guesty.js; senza valore
// vale il 23,79% di prima (18% + 1,5% pagamenti, IVA 22%).
export const HOUSES = [
  { id: 'MA',  name: 'Marco Aurelio 43',          short: 'Marco Aurelio', color: '#556b58', titleIncludes: 'marco aurelio', bookingCommission: 0.195 },
  { id: 'POL', name: 'Via Poliziano 61',          short: 'Poliziano',     color: '#b39e73', titleIncludes: 'three-bedroom', bookingCommission: 0.245 },
  { id: 'PRE', name: 'Prestige Three Bedrooms',   short: 'Prestige',      color: '#7e6b3e', titleIncludes: 'prestige', bookingCommission: 0.195 },
  { id: 'BIL', name: 'Bilocale S.Giovanni 84',    short: 'Bilocale (A)',  color: '#8a9d8c', listingId: '6854861b066d37001060d473', bookingCommission: 0.245 },
  { id: 'TRI', name: 'Trilocale S.Giovanni 84',   short: 'Trilocale (B)', color: '#a04e3a', listingId: '68548615331bfe00134cf985', bookingCommission: 0.245 },
];

// Primo anno con dati Guesty completi (gli anni precedenti restano nell'archivio V1 / fogli).
export const START_YEAR = 2025;

export const ALL_HOUSE_IDS = HOUSES.map(h => h.id);
export const HOUSES_BY_ID = Object.fromEntries(HOUSES.map(h => [h.id, h]));

/** Ritorna l'id casa di una reservation Guesty grezza, o 'OTHER'. */
export function houseIdForReservation(listingId, listingTitle) {
  const t = String(listingTitle || '').toLowerCase();
  for (const h of HOUSES) if (h.listingId && h.listingId === listingId) return h.id;
  for (const h of HOUSES) if (h.titleIncludes && t.includes(h.titleIncludes)) return h.id;
  return 'OTHER';
}
