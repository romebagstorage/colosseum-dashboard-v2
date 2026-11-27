// Funzioni di aggregazione applicate al JSON ricevuto da /api/data.
// Tutto puro, deterministico, lato client (nessun fetch).

import { classifyReservation, leadTime, HOUSES_META } from './format';
import { ALL_HOUSE_IDS } from '@/config/houses';

// Percentuali su Google Sheets vengono spesso lette come 0-1 (es. 0.93 = 93%).
// Normalizzo: se il valore è <= 1.5 lo considero in scala 0-1 e lo porto a 0-100.
const normalizePct = (v) => (v == null || isNaN(v)) ? v : (Math.abs(v) <= 1.5 ? v * 100 : v);

export const ALL_HOUSES = ALL_HOUSE_IDS;

// Normalizza il "selettore casa" in un array di houseId.
// Accetta: array (multi-selezione, anche vuoto), 'all'/null (tutte), o un singolo id.
function resolveHouses(sel) {
  if (Array.isArray(sel)) return sel;
  if (sel == null || sel === 'all') return ALL_HOUSES;
  return [sel];
}

// Primo mese (0-11) in cui una casa è attiva in un anno = primo mese con notti > 0.
// Serve per NON contare i mesi pre-apertura (es. Prestige aperta a ottobre 2025:
// gen-set 2025 hanno 0% occupazione "fittizio" che non deve inquinare le medie).
// Ritorna -1 se la casa non ha attività nell'anno.
function firstActiveMonthIndex(data, houseId, year) {
  const m = data?.houses?.[houseId]?.monthly?.[year];
  const nights = m?.notti?.monthly;
  if (!nights) return -1;
  for (let i = 0; i < 12; i++) if (nights[i] != null && nights[i] > 0) return i;
  return -1;
}

// Occupazione aggregata = media delle occupazioni mensili sulle celle (casa, mese)
// ATTIVE nell'intervallo [mStart..mEnd]. Esclude i mesi pre-apertura di ogni casa,
// così una struttura aperta a metà anno non abbassa l'occupazione delle altre.
function aggOccupancy(data, houses, year, mStart, mEnd) {
  let sum = 0, cnt = 0;
  for (const h of houses) {
    const m = data?.houses?.[h]?.monthly?.[year];
    const occ = m?.occupazione?.monthly;
    if (!occ) continue;
    const first = firstActiveMonthIndex(data, h, year);
    if (first < 0) continue; // casa non attiva in quell'anno → esclusa
    const lo = Math.max(mStart, first);
    for (let i = lo; i <= mEnd; i++) {
      const v = occ[i];
      if (v != null) { sum += normalizePct(v); cnt++; }
    }
  }
  return cnt ? sum / cnt : null;
}

// ---- KPI per casa+anno (da monthly RESOCONTO MENSILE) ----
// Se monthIdx è null/undefined ritorna il totale anno; altrimenti i valori del mese specifico (0-11).
export function kpiForHouseYear(data, houseId, year, monthIdx) {
  const m = data?.houses?.[houseId]?.monthly?.[year];
  if (!m) return null;
  const pick = (kpi) => {
    if (!kpi) return null;
    if (monthIdx == null) return kpi.total;
    return kpi.monthly?.[monthIdx] ?? null;
  };
  return {
    bookings:     pick(m.prenotazioni) ?? 0,
    nights:       pick(m.notti) ?? 0,
    revenue:      pick(m.ricavi) ?? 0,
    // null (non 0) quando la riga non esiste (es. anni storici senza "netti OTA")
    // → la UI mostra "—" invece di "€ 0"
    netRevenue:   pick(m.ricaviNettiOTA),
    taxes:        pick(m.imposte) ?? 0,
    cityTax:      pick(m.tassaSoggiorno) ?? 0,
    costs:        pick(m.costi) ?? 0,
    profit:       pick(m.utile) ?? 0,
    occ:          normalizePct(pick(m.occupazione)),
    adr:          pick(m.adr),
    avgPerBooking: pick(m.ricavoMedioPerPren),
    profitMargin: normalizePct(pick(m.utiliRicavi)),
  };
}

// ---- KPI aggregato per un sottoinsieme di case, per anno (e opzionalmente mese) ----
// sel: array di houseId, 'all', o singolo id. Default = tutte.
export function kpiAggregatedYear(data, year, monthIdx, sel) {
  const houses = resolveHouses(sel);
  if (!houses.length) return null;
  const agg = {
    bookings: 0, nights: 0, revenue: 0, netRevenue: 0, netAny: false, taxes: 0, costs: 0, profit: 0,
    adrWeightedSum: 0, adrWeightedNights: 0, any: false
  };
  for (const h of houses) {
    const k = kpiForHouseYear(data, h, year, monthIdx);
    if (!k) continue;
    agg.any = true;
    agg.bookings += k.bookings || 0;
    agg.nights += k.nights || 0;
    agg.revenue += k.revenue || 0;
    if (k.netRevenue != null) { agg.netRevenue += k.netRevenue; agg.netAny = true; }
    agg.taxes += k.taxes || 0;
    agg.costs += k.costs || 0;
    agg.profit += k.profit || 0;
    if (k.adr != null && k.nights) { agg.adrWeightedSum += k.adr * k.nights; agg.adrWeightedNights += k.nights; }
  }
  if (!agg.any) return null;
  // Occupazione: media sulle celle (casa, mese) attive → esclude i mesi pre-apertura.
  const occ = (monthIdx == null)
    ? aggOccupancy(data, houses, year, 0, 11)
    : aggOccupancy(data, houses, year, monthIdx, monthIdx);
  return {
    bookings: agg.bookings,
    nights: agg.nights,
    revenue: agg.revenue,
    netRevenue: agg.netAny ? agg.netRevenue : null,
    taxes: agg.taxes,
    costs: agg.costs,
    profit: agg.profit,
    occ,
    adr: agg.adrWeightedNights ? agg.adrWeightedSum / agg.adrWeightedNights : null,
    avgPerBooking: agg.bookings ? agg.revenue / agg.bookings : null,
  };
}

// ---- Ultimo mese (0-11) con dati in un anno (per confronto YTD omogeneo) ----
// Considera "popolato" un mese con notti o ricavi > 0. Ritorna -1 se nessun dato.
export function lastPopulatedMonthIndex(data, sel, year) {
  const houses = resolveHouses(sel);
  let last = -1;
  for (const h of houses) {
    const m = data?.houses?.[h]?.monthly?.[year];
    if (!m) continue;
    const nights = m.notti?.monthly || [];
    const rev = m.ricavi?.monthly || [];
    for (let i = 0; i < 12; i++) {
      if ((nights[i] != null && nights[i] > 0) || (rev[i] != null && rev[i] > 0)) {
        if (i > last) last = i;
      }
    }
  }
  return last;
}

// ---- KPI per casa su finestra di mesi [0..endIdx] (per confronto YTD vs YTD) ----
// Somma i flussi (ricavi, notti, ...); ricalcola occ (media mesi) e adr (ricavi/notti)
// in modo coerente con i totali annui dello sheet.
export function kpiForHouseYearRange(data, houseId, year, endIdx) {
  const m = data?.houses?.[houseId]?.monthly?.[year];
  if (!m || endIdx < 0) return null;
  const sumRange = (kpi) => {
    if (!kpi || !kpi.monthly) return null;
    let s = 0, any = false;
    for (let i = 0; i <= endIdx; i++) { const v = kpi.monthly[i]; if (v != null) { s += v; any = true; } }
    return any ? s : null;
  };
  const meanPct = (kpi) => {
    if (!kpi || !kpi.monthly) return null;
    let s = 0, c = 0;
    for (let i = 0; i <= endIdx; i++) { const v = kpi.monthly[i]; if (v != null) { s += normalizePct(v); c++; } }
    return c ? s / c : null;
  };
  const revenue = sumRange(m.ricavi) ?? 0;
  const nights = sumRange(m.notti) ?? 0;
  const bookings = sumRange(m.prenotazioni) ?? 0;
  return {
    bookings, nights, revenue,
    netRevenue:   sumRange(m.ricaviNettiOTA),
    taxes:        sumRange(m.imposte) ?? 0,
    costs:        sumRange(m.costi) ?? 0,
    profit:       sumRange(m.utile) ?? 0,
    occ:          meanPct(m.occupazione),
    adr:          nights ? revenue / nights : null,
    avgPerBooking: bookings ? revenue / bookings : null,
  };
}

// ---- KPI aggregato (sottoinsieme case) su finestra di mesi [0..endIdx] ----
export function kpiAggregatedRange(data, year, endIdx, sel) {
  const houses = resolveHouses(sel);
  if (!houses.length) return null;
  const agg = { bookings:0, nights:0, revenue:0, netRevenue:0, netAny:false,
                taxes:0, costs:0, profit:0, any:false };
  for (const h of houses) {
    const k = kpiForHouseYearRange(data, h, year, endIdx);
    if (!k) continue;
    agg.any = true;
    agg.bookings += k.bookings || 0;
    agg.nights += k.nights || 0;
    agg.revenue += k.revenue || 0;
    if (k.netRevenue != null) { agg.netRevenue += k.netRevenue; agg.netAny = true; }
    agg.taxes += k.taxes || 0;
    agg.costs += k.costs || 0;
    agg.profit += k.profit || 0;
  }
  if (!agg.any) return null;
  return {
    bookings: agg.bookings,
    nights: agg.nights,
    revenue: agg.revenue,
    netRevenue: agg.netAny ? agg.netRevenue : null,
    taxes: agg.taxes,
    costs: agg.costs,
    profit: agg.profit,
    occ: aggOccupancy(data, houses, year, 0, endIdx), // esclude mesi pre-apertura
    adr: agg.nights ? agg.revenue / agg.nights : null,
    avgPerBooking: agg.bookings ? agg.revenue / agg.bookings : null,
  };
}

// ---- Serie mensile per un sottoinsieme di case (somma flussi, media % e medie) ----
// sel: array di houseId, 'all', o singolo id. Per 1 sola casa = valori grezzi.
// Per 'occupazione' esclude i mesi pre-apertura di ciascuna casa.
export function monthlySeries(data, sel, year, metric) {
  const houses = resolveHouses(sel);
  const isPercent = (metric === 'occupazione' || metric === 'utiliRicavi');
  const isAvg = (metric === 'adr' || metric === 'ricavoMedioPerPren' || metric === 'profittoMedioPerPren' || metric === 'profittoMedioPerNotte');
  const isOcc = (metric === 'occupazione');
  const norm = (v) => isPercent ? normalizePct(v) : v;

  const result = new Array(12).fill(null);
  const counts = new Array(12).fill(0);

  for (const h of houses) {
    const arr = data?.houses?.[h]?.monthly?.[year]?.[metric]?.monthly;
    if (!arr) continue;
    const first = isOcc ? firstActiveMonthIndex(data, h, year) : 0;
    if (isOcc && first < 0) continue; // casa non attiva → niente occupazione
    for (let i = 0; i < 12; i++) {
      if (isOcc && i < first) continue; // salta mesi pre-apertura
      const val = norm(arr[i]);
      if (val != null) {
        if (result[i] == null) result[i] = 0;
        result[i] += val;
        counts[i]++;
      }
    }
  }
  if (isPercent || isAvg) {
    return result.map((v, i) => counts[i] > 0 ? v / counts[i] : null);
  }
  return result;
}

// ---- Anni disponibili per una casa ----
export function availableYears(data, houseId) {
  if (houseId === 'all') {
    const all = new Set();
    for (const h of ALL_HOUSES) {
      const m = data?.houses?.[h]?.monthly;
      if (!m) continue;
      Object.keys(m).forEach(y => all.add(y));
    }
    return Array.from(all).sort();
  }
  const m = data?.houses?.[houseId]?.monthly;
  return m ? Object.keys(m).sort() : [];
}

// ---- Filtra reservations per casa + mese (year-month) ----
// Nota: BIL e TRI condividono lo stesso listing.title sul source, quindi
// quando si filtra per uno dei due, includiamo entrambi (mix canali combinato).
export function filterReservations(reservations, sel, year, monthIdx) {
  const houses = resolveHouses(sel);
  const isAll = houses.length === ALL_HOUSES.length;
  const wantSG = houses.includes('BIL') || houses.includes('TRI');
  return (reservations || []).filter(r => {
    if (!isAll) {
      const h = classifyReservation(r);
      // 'SG' = San Giovanni non distinguibile: accettato se BIL o TRI è selezionata
      if (!(houses.includes(h) || (wantSG && h === 'SG'))) return false;
    }
    if (monthIdx != null && r.checkIn) {
      const m = String(r.checkIn).match(/^(\d{4})-(\d{2})/);
      if (!m) return false;
      if (year && m[1] !== String(year)) return false;
      if (parseInt(m[2], 10) - 1 !== monthIdx) return false;
    } else if (year && r.checkIn) {
      const m = String(r.checkIn).match(/^(\d{4})-/);
      if (!m || m[1] !== String(year)) return false;
    }
    return true;
  });
}

// ---- Mix canali, pesato per notti ----
export function channelMix(reservations) {
  const counts = {};
  for (const r of reservations) {
    const c = normalizeChannel(r.channel);
    const w = (typeof r.nights === 'number' && r.nights > 0) ? r.nights : 0;
    counts[c] = (counts[c] || 0) + w;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  const sorted = Object.entries(counts)
    .map(([name, count]) => ({ name, count, pct: count / total * 100 }))
    .sort((a, b) => b.count - a.count);
  return sorted;
}

function normalizeChannel(c) {
  if (!c) return 'Altro';
  const s = String(c).toLowerCase();
  if (s.includes('booking')) return 'Booking.com';
  if (s.includes('airbnb')) return 'Airbnb';
  if (s.includes('website') || s.includes('sito') || s.includes('direct') || s.includes('diretto') || s.includes('bookingengine')) return 'Diretto (sito)';
  if (s.includes('vrbo')) return 'VRBO';
  if (s.includes('homeaway') || s === 'ha') return 'HomeAway';
  if (s.includes('expedia')) return 'Expedia';
  if (s.includes('travelstaytion') || s.includes('travel staytion')) return 'Travelstaytion';
  if (s.includes('travel')) return 'Travel';
  if (s.includes('agoda')) return 'Agoda';
  if (s.includes('plum')) return 'PlumGuide';
  if (s.includes('manual') || s.includes('offline') || s.includes('owner')) return 'Offline / manuale';
  if (s.includes('trip.com') || s.includes('tripcom')) return 'Trip.com';
  if (s.includes('ostrovok')) return 'Ostrovok';
  return c;
}

// ---- Top paesi da reservations ----
export function topCountries(reservations, limit = 10) {
  const counts = {};
  for (const r of reservations) {
    const c = (r.country || '').trim() || 'Sconosciuto';
    counts[c] = (counts[c] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  const sorted = Object.entries(counts)
    .map(([name, count]) => ({ name, count, pct: count / total * 100 }))
    .sort((a, b) => b.count - a.count);
  if (sorted.length <= limit) return sorted;
  const top = sorted.slice(0, limit);
  const otherCount = sorted.slice(limit).reduce((a, b) => a + b.count, 0);
  top.push({ name: 'Altri', count: otherCount, pct: otherCount / total * 100 });
  return top;
}

// ---- LOS per casa (reservations 2026 in corso) ----
export function losByHouse(reservations) {
  const buckets = {};
  for (const r of reservations) {
    const h = classifyReservation(r);
    if (h === 'OTHER' || h === 'SG_UNKNOWN') continue;
    if (!buckets[h]) buckets[h] = { sumNights: 0, count: 0 };
    if (r.nights > 0) {
      buckets[h].sumNights += r.nights;
      buckets[h].count++;
    }
  }
  const result = {};
  for (const h in buckets) {
    result[h] = buckets[h].count ? buckets[h].sumNights / buckets[h].count : null;
  }
  return result;
}

// ---- LOS distribution ----
export function losDistribution(reservations) {
  const buckets = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7+': 0 };
  for (const r of reservations) {
    const n = r.nights;
    if (n >= 7) buckets['7+']++;
    else if (n >= 1 && n <= 6) buckets[String(n)]++;
  }
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  return Object.entries(buckets).map(([k, v]) => ({ label: k, count: v, pct: v / total * 100 }));
}

// ---- Persone medie per casa ----
export function avgPartyByHouse(reservations) {
  const buckets = {};
  for (const r of reservations) {
    const h = classifyReservation(r);
    if (h === 'OTHER' || h === 'SG_UNKNOWN') continue;
    if (!buckets[h]) buckets[h] = { sumPersons: 0, count: 0 };
    if (r.persons > 0) { buckets[h].sumPersons += r.persons; buckets[h].count++; }
  }
  const result = {};
  for (const h in buckets) {
    result[h] = buckets[h].count ? buckets[h].sumPersons / buckets[h].count : null;
  }
  return result;
}

// ---- Lead time analysis ----
export function leadTimeStats(reservations) {
  const values = reservations.map(leadTime).filter(v => v != null);
  if (values.length === 0) return { avg: null, median: null, distribution: [], byChannel: {} };
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Distribution buckets
  const buckets = { '0-7': 0, '8-30': 0, '31-60': 0, '61-90': 0, '91-180': 0, '181+': 0 };
  for (const v of values) {
    if (v <= 7) buckets['0-7']++;
    else if (v <= 30) buckets['8-30']++;
    else if (v <= 60) buckets['31-60']++;
    else if (v <= 90) buckets['61-90']++;
    else if (v <= 180) buckets['91-180']++;
    else buckets['181+']++;
  }
  const total = values.length;
  const distribution = Object.entries(buckets).map(([k, v]) => ({ label: k, count: v, pct: v / total * 100 }));

  // Per canale
  const byChannel = {};
  for (const r of reservations) {
    const lt = leadTime(r);
    if (lt == null) continue;
    const c = normalizeChannel(r.channel);
    if (!byChannel[c]) byChannel[c] = { sum: 0, count: 0 };
    byChannel[c].sum += lt;
    byChannel[c].count++;
  }
  const byChannelAvg = {};
  for (const c in byChannel) {
    byChannelAvg[c] = byChannel[c].count ? byChannel[c].sum / byChannel[c].count : null;
  }

  return { avg, median, distribution, byChannel: byChannelAvg, count: values.length };
}

// ---- Forward booking (12 mesi a partire dal mese corrente) ----
// sel: array di houseId / 'all' / singolo id. Capacità = giorni × n. unità selezionate.
// Notti e ricavi attribuiti al mese di competenza (prorata per notte).
export function forwardBooking(data, currentDate = new Date(), sel = 'all', horizonMonths = 12) {
  const all = (data?.reservations || []);
  const houses = resolveHouses(sel);
  const isAll = houses.length === ALL_HOUSES.length;
  const units = houses.length;
  const reservations = isAll ? all : all.filter(r => houses.includes(classifyReservation(r)));
  const cancelled = cancelledWithRevenue(data).filter(r => houses.includes(classifyReservation(r)));
  const y0 = currentDate.getFullYear(), m0 = currentDate.getMonth();
  // Confronto «stessa data dell'anno scorso»: prenotazioni dello stesso mese di un anno prima
  // che risultavano già fatte (bookingDate) entro la stessa data di un anno prima.
  // bookingDate null = data non affidabile (import in blocco o record creato dopo il check-in):
  // contata come già prenotata, perché gli import sono tutti precedenti alla data di confronto.
  // Le cancellate dopo quella data erano ancora in calendario: si aggiungono (serve canceledAt).
  const lyCutoff = ymd(new Date(y0 - 1, m0, currentDate.getDate()));
  const lyAlive = [...reservations, ...cancelled.filter(r => r.canceledAt && r.canceledAt > lyCutoff)];
  const withCancelDate = cancelled.some(r => r.canceledAt);
  const startYear = data?.startYear || 2025;
  const result = [];
  for (let k = 0; k < horizonMonths; k++) {
    const d = new Date(y0, m0 + k, 1);
    const y = d.getFullYear(), monthIdx = d.getMonth() + 1; // 1-12
    const cur = monthStats(reservations, y, monthIdx);
    const lyOtb = monthStats(lyAlive, y - 1, monthIdx, r => !r.bookingDate || r.bookingDate <= lyCutoff);
    const lyFinal = monthStats(reservations, y - 1, monthIdx);
    result.push({
      month: `${y}-${String(monthIdx).padStart(2, '0')}`,
      booked: cur.nights, capacity: daysInMonth(y, monthIdx) * units, revenue: cur.revenue, roomRevenue: cur.room,
      lyBooked: lyOtb.nights, lyRevenue: lyOtb.revenue, lyRoomRevenue: lyOtb.room, lyCapacity: daysInMonth(y - 1, monthIdx) * units,
      lyFinalBooked: lyFinal.nights, lyFinalRevenue: lyFinal.revenue, lyFinalRoomRevenue: lyFinal.room,
      lyHasData: (y - 1) >= startYear,
    });
  }
  return { months: result, lyCutoff, withCancelDate };
}

// ---- helper su date YYYY-MM-DD (in UTC, così l'ora legale non sposta i giorni) ----
function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}
const revenueOf = r => (r.paidTotal || r.gross || 0) - (r.cityTax || 0);
// Solo l'alloggio: pagato senza tassa di soggiorno e senza pulizie (r.cleaning = money.fareCleaning
// di Guesty, dal 27/11/2026 nel payload). È il numero da confrontare con i prezzi a notte di PriceLabs,
// che le pulizie non le comprendono; con le pulizie i soggiorni corti fanno salire il prezzo a notte.
export const roomRevenueOf = r => Math.max(0, revenueOf(r) - (r.cleaning || 0));

// Guesty azzera l'importo delle prenotazioni cancellate: per confrontare ricavi e prezzi
// «alla stessa data» il loro valore si stima con il prezzo medio a notte della stessa casa
// nello stesso mese di check-in (o, se manca, di tutto il periodo). estimated = true.
const imputeCache = new WeakMap();
export function cancelledWithRevenue(data) {
  if (!data) return [];
  if (imputeCache.has(data)) return imputeCache.get(data);
  const acc = {};
  const add = (k, n, rev, room) => { acc[k] = acc[k] || { n: 0, rev: 0, room: 0 }; acc[k].n += n; acc[k].rev += rev; acc[k].room += room; };
  for (const r of data.reservations || []) {
    const rev = revenueOf(r);
    if (!(rev > 0) || !(r.nights > 0) || !r.checkIn) continue;
    const h = classifyReservation(r);
    add(`${h}|${r.checkIn.slice(0, 7)}`, r.nights, rev, roomRevenueOf(r));
    add(`${h}|all`, r.nights, rev, roomRevenueOf(r));
  }
  const pick = k => (acc[k] && acc[k].n ? acc[k] : null);
  const out = (data.cancelled || []).map(r => {
    if (revenueOf(r) > 0 || !(r.nights > 0)) return r;
    const h = classifyReservation(r);
    const a = pick(`${h}|${(r.checkIn || '').slice(0, 7)}`) ?? pick(`${h}|all`);
    if (!a) return r;
    const tot = Math.round(a.rev / a.n * r.nights);
    const cleaning = tot - Math.round(a.room / a.n * r.nights);
    return { ...r, paidTotal: tot, cityTax: 0, gross: tot, cleaning, estimated: true };
  });
  imputeCache.set(data, out);
  return out;
}

// Prenotazioni vive e cancellate delle case selezionate
function selected(data, sel) {
  const houses = resolveHouses(sel);
  const inSel = r => houses.includes(classifyReservation(r));
  return { houses, live: (data?.reservations || []).filter(inSel), canc: cancelledWithRevenue(data).filter(inSel) };
}

// ---- Ritmo delle prenotazioni (pickup) ----
// Prenotazioni create negli ultimi 7/30/90 giorni (qualunque data di soggiorno) e ancora valide oggi,
// contro quelle create nello stesso periodo di un anno prima e ancora valide a quella data.
// Le prenotazioni senza data di creazione affidabile (bookingDate null) sono escluse.
export function pickupStats(data, currentDate = new Date(), sel = 'all', weeks = 12) {
  const { live, canc } = selected(data, sel);
  const today = ymd(currentDate);
  const lyToday = ymd(new Date(currentDate.getFullYear() - 1, currentDate.getMonth(), currentDate.getDate()));
  const lySet = [...live, ...canc.filter(r => r.canceledAt && r.canceledAt > lyToday)];
  const win = (set, end, days) => {
    const start = addDays(end, -(days - 1));
    let bookings = 0, nights = 0, revenue = 0;
    for (const r of set) {
      if (!r.bookingDate || r.bookingDate < start || r.bookingDate > end) continue;
      bookings++; nights += r.nights || 0; revenue += revenueOf(r);
    }
    return { bookings, nights, revenue: Math.round(revenue) };
  };
  const windows = [7, 30, 90].map(days => ({ days, cur: win(live, today, days), ly: win(lySet, lyToday, days) }));
  const weekly = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const end = addDays(today, -7 * w);
    weekly.push({ start: addDays(end, -6), end, cur: win(live, end, 7).nights, ly: win(lySet, addDays(lyToday, -7 * w), 7).nights });
  }
  return { today, lyToday, windows, weekly };
}

// ---- Notti orfane: buchi di 1–2 notti fra due prenotazioni, nei prossimi `horizon` giorni ----
// I blocchi messi a mano in Guesty non sono nei dati: un buco può essere già chiuso dal proprietario.
export function orphanNights(data, currentDate = new Date(), sel = 'all', horizon = 60, maxNights = 2) {
  const { houses, live } = selected(data, sel);
  const today = ymd(currentDate);
  const end = addDays(today, horizon);
  const out = [];
  for (const h of houses) {
    const rs = live.filter(r => classifyReservation(r) === h && r.checkOut >= addDays(today, -1) && r.checkIn <= addDays(end, maxNights + 1));
    const occ = new Map(); // giorno → prenotazione che lo occupa
    for (const r of rs) for (let d = r.checkIn; d < r.checkOut; d = addDays(d, 1)) occ.set(d, r);
    let d = today;
    while (d <= end) {
      if (occ.has(d)) { d = addDays(d, 1); continue; }
      const start = d;
      while (!occ.has(d) && d <= addDays(end, maxNights)) d = addDays(d, 1);
      const len = daysBetween(start, d);
      const before = occ.get(addDays(start, -1));
      const after = occ.get(d);
      if (len <= maxNights && before && after) {
        out.push({ houseId: h, from: start, to: d, nights: len, before: before.channel, after: after.channel });
      }
    }
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.houseId.localeCompare(b.houseId));
}

// ---- Canali delle notti già prenotate nei prossimi `months` mesi, oggi vs stessa data anno scorso ----
export function channelMixForward(data, currentDate = new Date(), sel = 'all', months = 6) {
  const { live, canc } = selected(data, sel);
  const y0 = currentDate.getFullYear(), m0 = currentDate.getMonth();
  const lyCutoff = ymd(new Date(y0 - 1, m0, currentDate.getDate()));
  const lySet = [...live, ...canc.filter(r => r.canceledAt && r.canceledAt > lyCutoff)]
    .filter(r => !r.bookingDate || r.bookingDate <= lyCutoff);
  const collect = (set, from, to) => {
    const by = {};
    for (const r of set) {
      if (!r.checkIn || !r.checkOut || !(r.nights > 0)) continue;
      const s = r.checkIn > from ? r.checkIn : from;
      const e = r.checkOut < to ? r.checkOut : to;
      const n = daysBetween(s, e);
      if (n <= 0) continue;
      const c = r.channel || 'Altro';
      by[c] = by[c] || { nights: 0, revenue: 0 };
      by[c].nights += n; by[c].revenue += revenueOf(r) * (n / r.nights);
    }
    return by;
  };
  const from = ymd(new Date(y0, m0, 1)), to = ymd(new Date(y0, m0 + months, 1));
  const lyFrom = ymd(new Date(y0 - 1, m0, 1)), lyTo = ymd(new Date(y0 - 1, m0 + months, 1));
  const cur = collect(live, from, to), ly = collect(lySet, lyFrom, lyTo);
  const totCur = Object.values(cur).reduce((a, b) => a + b.nights, 0);
  const totLy = Object.values(ly).reduce((a, b) => a + b.nights, 0);
  const rows = [...new Set([...Object.keys(cur), ...Object.keys(ly)])].map(c => ({
    channel: c,
    nights: cur[c]?.nights || 0, revenue: Math.round(cur[c]?.revenue || 0), share: totCur ? (cur[c]?.nights || 0) / totCur * 100 : null,
    lyNights: ly[c]?.nights || 0, lyRevenue: Math.round(ly[c]?.revenue || 0), lyShare: totLy ? (ly[c]?.nights || 0) / totLy * 100 : null,
  })).sort((a, b) => b.nights - a.nights || b.lyNights - a.lyNights);
  return { rows, totCur, totLy, lyCutoff, from, to };
}

// ---- Cancellazioni: prenotazioni con check-in negli ultimi 12 mesi chiusi ----
// Tasso = cancellate / (confermate + cancellate), per mese di check-in e per canale.
export function cancellationStats(data, currentDate = new Date(), sel = 'all', months = 12) {
  const { live, canc } = selected(data, sel);
  const y0 = currentDate.getFullYear(), m0 = currentDate.getMonth();
  const from = ymd(new Date(y0, m0 - months, 1)), to = ymd(new Date(y0, m0, 1));
  const inWin = r => r.checkIn && r.checkIn >= from && r.checkIn < to;
  const L = live.filter(inWin), C = canc.filter(inWin);
  const monthly = [];
  for (let k = months; k >= 1; k--) {
    const d = new Date(y0, m0 - k, 1);
    const key = ymd(d).slice(0, 7);
    const l = L.filter(r => r.checkIn.startsWith(key)).length;
    const c = C.filter(r => r.checkIn.startsWith(key)).length;
    monthly.push({ month: key, confirmed: l, cancelled: c, rate: (l + c) ? c / (l + c) * 100 : null });
  }
  const chans = {};
  const ch = r => r.channel || 'Altro';
  for (const r of L) { const c = ch(r); chans[c] = chans[c] || { confirmed: 0, cancelled: 0, nightsLost: 0, valueLost: 0, notice: [] }; chans[c].confirmed++; }
  for (const r of C) {
    const c = ch(r); chans[c] = chans[c] || { confirmed: 0, cancelled: 0, nightsLost: 0, valueLost: 0, notice: [] };
    chans[c].cancelled++; chans[c].nightsLost += r.nights || 0; chans[c].valueLost += Math.max(0, revenueOf(r));
    if (r.canceledAt && r.canceledAt <= r.checkIn) chans[c].notice.push(daysBetween(r.canceledAt, r.checkIn));
  }
  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const byChannel = Object.entries(chans).map(([channel, v]) => ({
    channel, confirmed: v.confirmed, cancelled: v.cancelled,
    rate: (v.confirmed + v.cancelled) ? v.cancelled / (v.confirmed + v.cancelled) * 100 : null,
    nightsLost: v.nightsLost, valueLost: Math.round(v.valueLost), medianNotice: median(v.notice),
  })).sort((a, b) => b.cancelled - a.cancelled || b.confirmed - a.confirmed);
  const totConfirmed = L.length, totCancelled = C.length;
  const allNotice = C.filter(r => r.canceledAt && r.canceledAt <= r.checkIn).map(r => daysBetween(r.canceledAt, r.checkIn));
  // Cancellazioni recenti (ultimi 30 giorni, qualunque data di soggiorno)
  const today = ymd(currentDate);
  const recent = canc.filter(r => r.canceledAt && r.canceledAt > addDays(today, -30) && r.canceledAt <= today);
  return {
    from, to, monthly, byChannel,
    total: { confirmed: totConfirmed, cancelled: totCancelled, rate: (totConfirmed + totCancelled) ? totCancelled / (totConfirmed + totCancelled) * 100 : null, nightsLost: C.reduce((a, r) => a + (r.nights || 0), 0), medianNotice: median(allNotice) },
    recent: { count: recent.length, nights: recent.reduce((a, r) => a + (r.nights || 0), 0), futureNights: recent.filter(r => r.checkIn >= today).reduce((a, r) => a + (r.nights || 0), 0) },
    withCancelDate: canc.some(r => r.canceledAt),
  };
}

// Notti e ricavi (pagamento totale − tassa di soggiorno, prorata per notte) di un mese.
function monthStats(reservations, y, monthIdx, keep = null) {
  const monthStart = new Date(y, monthIdx - 1, 1);
  const monthEnd = new Date(y, monthIdx, 1);
  let nights = 0, revenue = 0, room = 0;
  for (const r of reservations) {
    if (!r.checkIn || !r.checkOut || !(r.nights > 0)) continue;
    if (keep && !keep(r)) continue;
    const ci = new Date(r.checkIn + 'T00:00:00');
    const co = new Date(r.checkOut + 'T00:00:00');
    const overlapStart = ci > monthStart ? ci : monthStart;
    const overlapEnd = co < monthEnd ? co : monthEnd;
    const nightsInMonth = Math.max(0, Math.round((overlapEnd - overlapStart) / 86400000));
    if (nightsInMonth > 0) {
      nights += nightsInMonth;
      revenue += ((r.paidTotal || r.gross || 0) - (r.cityTax || 0)) * (nightsInMonth / r.nights);
      room += roomRevenueOf(r) * (nightsInMonth / r.nights);
    }
  }
  return { nights: Math.round(nights), revenue: Math.round(revenue), room: Math.round(room) };
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}
