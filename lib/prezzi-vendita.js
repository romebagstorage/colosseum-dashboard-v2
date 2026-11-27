// Pannello «Prezzi in vendita» (dal 27/11/2026): il prezzo che si chiede oggi
// per le notti ancora libere, contro quanto si è incassato a notte nello stesso
// mese dell'anno scorso e contro il ritmo delle prenotazioni.
//
// Due metà:
//  - riassumiIstantanea: lato server, riduce il file PriceLabs del giorno
//    (lib/pricelabs.js, ~120 KB) a una media per casa e mese (pochi KB).
//  - prezziInVendita: lato client, incrocia il riassunto con le prenotazioni
//    di /api/data (forwardBooking) e assegna il semaforo.
// Tutte e due pure: niente fetch.

import { forwardBooking } from './aggregators.js';
import { PREZZI_VENDITA_SOGLIE } from '../config/prezzi-vendita.js';

const meseDi = (giorno) => giorno.slice(0, 7);

/** Un giorno è in vendita se PriceLabs ha un prezzo, non è prenotato e non è bloccato. */
export function inVendita(g) {
  return g.user_price > 0 && !g.unbookable && !String(g.booking_status || '').startsWith('Booked');
}

/**
 * Riduce l'istantanea del giorno (forma di lib/pricelabs.js: colonne + case.X.giorni)
 * a { giorno, salvata_alle, case: { MA: { min, base, max, mesi: { 'AAAA-MM': { prezzo, consiglio, liberi, giorni } } } }, avvisi }.
 * prezzo = media di user_price (prezzo su Guesty, prima del ricarico dei portali) sui giorni in vendita;
 * consiglio = media di price (consiglio PriceLabs) sugli stessi giorni.
 */
export function riassumiIstantanea(ist) {
  const col = ist.colonne || [];
  const idx = Object.fromEntries(col.map((k, i) => [k, i]));
  const case_ = {};
  for (const [h, c] of Object.entries(ist.case || {})) {
    const mesi = {};
    for (const riga of c.giorni || []) {
      const g = Object.fromEntries(col.map((k) => [k, riga[idx[k]]]));
      if (!g.date) continue;
      const m = (mesi[meseDi(g.date)] ||= { somma: 0, sommaConsiglio: 0, liberi: 0, giorni: 0 });
      m.giorni++;
      if (inVendita(g)) { m.liberi++; m.somma += g.user_price; m.sommaConsiglio += g.price > 0 ? g.price : g.user_price; }
    }
    case_[h] = {
      min: c.min ?? null, base: c.base ?? null, max: c.max ?? null,
      mesi: Object.fromEntries(Object.entries(mesi).map(([k, m]) => [k, {
        prezzo: m.liberi ? Math.round(m.somma / m.liberi) : null,
        consiglio: m.liberi ? Math.round(m.sommaConsiglio / m.liberi) : null,
        liberi: m.liberi, giorni: m.giorni,
      }])),
    };
  }
  return { giorno: ist.giorno, salvata_alle: ist.salvata_alle, case: case_, avvisi: ist.avvisi || [] };
}

const pct = (a, b) => (a != null && b ? (a - b) / b * 100 : null);

/** Primo check-in di ogni casa (per riconoscere l'anno di lancio). */
function primiCheckIn(data) {
  const out = {};
  for (const r of data?.reservations || []) {
    if (!r.checkIn) continue;
    const h = r.houseId;
    if (!out[h] || r.checkIn < out[h]) out[h] = r.checkIn;
  }
  return out;
}

function mesiFra(da, a) { // 'AAAA-MM-GG' / 'AAAA-MM' → numero di mesi interi
  const [y1, m1] = da.split('-').map(Number), [y2, m2] = a.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

/**
 * Righe del pannello: una per casa, con `mesi` = i prossimi `n` mesi da oggi.
 * Ogni cella: prezzo chiesto, prezzo a notte incassato l'anno scorso (solo alloggio,
 * senza pulizie né tassa), notti già vendute oggi e alla stessa data dell'anno scorso, semaforo.
 *   stato: 'rosso'  prezzo alto e ritmo sotto l'anno scorso
 *          'giallo' solo una delle due
 *          'verde'  nessuna delle due
 *          'grigio' anno scorso non confrontabile (poche notti o casa in lancio)
 *          'pieno'  nessuna notte in vendita (tutto prenotato o bloccato)
 *          'manca'  PriceLabs non ha prezzi per quel mese
 */
export function prezziInVendita(riassunto, data, houses, oggi = new Date(), n = 6, soglie = PREZZI_VENDITA_SOGLIE) {
  const primi = primiCheckIn(data);
  return houses.map((h) => {
    const pl = riassunto?.case?.[h];
    // Il mese in corso conta solo se restano almeno 10 giorni: a fine mese è rumore.
    const fineMese = new Date(oggi.getFullYear(), oggi.getMonth() + 1, 0).getDate();
    const salta = fineMese - oggi.getDate() + 1 < 10 ? 1 : 0;
    const fwd = forwardBooking(data, oggi, [h], n + salta).months.slice(salta);
    const mesi = fwd.map((m) => {
      const p = pl?.mesi?.[m.month] || null;
      const lyMese = `${Number(m.month.slice(0, 4)) - 1}${m.month.slice(4)}`;
      const lyAdr = m.lyFinalBooked ? m.lyFinalRoomRevenue / m.lyFinalBooked : null;
      const lancio = primi[h] ? mesiFra(primi[h], lyMese) < soglie.mesiLancio : true;
      const confrontabile = m.lyHasData && !lancio && m.lyFinalBooked >= soglie.minNottiAnnoScorso && lyAdr > 0;
      const dPrezzo = confrontabile && p?.prezzo ? pct(p.prezzo, lyAdr) : null;
      const sotto = m.booked < m.lyBooked;
      const alto = dPrezzo != null && dPrezzo >= soglie.prezzoAlto;
      let stato;
      if (!p) stato = 'manca';
      else if (!p.liberi) stato = 'pieno';
      else if (!confrontabile) stato = 'grigio';
      else if (alto && sotto) stato = 'rosso';
      else if (alto || sotto) stato = 'giallo';
      else stato = 'verde';
      return {
        month: m.month, stato, lancio,
        prezzo: p?.prezzo ?? null, consiglio: p?.consiglio ?? null, liberi: p?.liberi ?? 0, giorni: p?.giorni ?? 0,
        lyAdr: lyAdr != null ? Math.round(lyAdr) : null, lyNotti: m.lyFinalBooked, dPrezzo,
        notti: m.booked, lyNottiAllaData: m.lyBooked, alto, sotto,
      };
    });
    return { h, mesi, min: pl?.min ?? null, base: pl?.base ?? null, max: pl?.max ?? null };
  });
}
