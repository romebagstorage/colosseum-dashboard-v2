// KPI mensili con prorata per notti di competenza.

const COUNTED_STATUSES = new Set(['confirmed', 'checked_in', 'checked_out']);

export function isCounted(r) { return COUNTED_STATUSES.has(r.status); }

function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }

/** Ritorna [{year, month(0-11), nights}] per una prenotazione. */
export function nightsByMonth(checkIn, checkOut) {
  const out = new Map();
  const d = new Date(checkIn + 'T00:00:00Z');
  const end = new Date(checkOut + 'T00:00:00Z');
  for (; d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    out.set(k, (out.get(k) || 0) + 1);
  }
  return [...out.entries()].map(([k, n]) => { const [y, m] = k.split('-').map(Number); return { year: y, month: m, nights: n }; });
}

const empty = () => ({ prenotazioni: 0, notti: 0, ricavi: 0, ricaviNettiOTA: 0, imposte: 0, tot: 0, tassa: 0 });

/**
 * Aggrega per casa/anno/mese. Ricavi = Pagamento totale − Tassa soggiorno (come C.ECONOMICO).
 * "prenotazioni" conta la prenotazione nel mese di check-in (intero), il denaro è proratato per notti.
 */
export function aggregate(reservations, { years, prorate = true } = {}) {
  const acc = {}; // house -> year -> month -> bucket
  const bucket = (h, y, m) => ((acc[h] ??= {})[y] ??= Array.from({ length: 12 }, empty))[m];

  for (const r of reservations) {
    if (!isCounted(r)) continue;
    if (!r.checkIn || !r.checkOut || r.nights <= 0) continue;
    const parts = prorate ? nightsByMonth(r.checkIn, r.checkOut) : [{ year: Number(r.checkIn.slice(0, 4)), month: Number(r.checkIn.slice(5, 7)) - 1, nights: r.nights }];
    const totalNights = parts.reduce((s, p) => s + p.nights, 0) || 1;
    const ciY = Number(r.checkIn.slice(0, 4)), ciM = Number(r.checkIn.slice(5, 7)) - 1;
    for (const p of parts) {
      if (years && !years.includes(p.year)) continue;
      const f = p.nights / totalNights;
      const b = bucket(r.houseId, p.year, p.month);
      b.notti += p.nights;
      b.tot += r.paidTotal * f;
      b.tassa += r.cityTax * f;
      b.ricavi += (r.paidTotal - r.cityTax) * f;
      b.ricaviNettiOTA += r.net * f;
    }
    if (!years || years.includes(ciY)) bucket(r.houseId, ciY, ciM).prenotazioni += 1;
  }

  // KPI derivati
  for (const h of Object.keys(acc)) for (const y of Object.keys(acc[h])) {
    acc[h][y] = acc[h][y].map((b, m) => {
      const dim = daysInMonth(Number(y), m);
      return {
        ...b,
        imposte: b.ricavi * 0.21,
        occupazione: b.notti / dim,
        adr: b.notti ? b.ricavi / b.notti : 0,
        ricavoMedioPerPren: b.prenotazioni ? b.ricavi / b.prenotazioni : 0,
      };
    });
  }
  return acc;
}
