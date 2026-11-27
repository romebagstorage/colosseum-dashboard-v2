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

import { forwardBooking, roomRevenueOf } from './aggregators.js';
import { expF } from './parita.js';
import { PREZZI_VENDITA_SOGLIE } from '../config/prezzi-vendita.js';
import { PARITA_DEFAULT } from '../config/parita.js';

/**
 * Da prezzo PriceLabs a prezzo che l'ospite paga in media (solo alloggio), per una casa:
 * per ogni portale (1 + ricarico Guesty) × fattore medio degli sconti (mobile, Genius,
 * last minute, settimanali…, con quanto spesso scattano), pesato sulle notti della casa
 * per portale. Tutto dal simulatore «Parità OTA» (config/parita.js, configurazione
 * attuale, non quelle salvate a mano). Lo sconto «Booking Sponsored» non conta: lo paga
 * Booking, l'incasso non cambia. I portali minori (Trip.com, Agoda) non hanno ricarichi
 * nel simulatore e restano fuori dal peso.
 * Ritorna { fattore, portali: [{ id, nome, fattore, notti }] }.
 */
export function fattoreIncasso(h, cfg = PARITA_DEFAULT) {
  const notti = cfg.houses?.[h]?.nights || {};
  const portali = cfg.channels.map((ch) => ({ id: ch.id, nome: ch.name, ricarico: ch.markup, sconti: 1 - expF(ch), fattore: (1 + ch.markup / 100) * expF(ch), notti: notti[ch.id] || 0 }));
  const tot = portali.reduce((a, p) => a + p.notti, 0);
  const fattore = tot ? portali.reduce((a, p) => a + p.notti * p.fattore, 0) / tot : 1;
  return { fattore, portali };
}

const meseDi = (giorno) => giorno.slice(0, 7);

function piuUno(giorno) {
  const d = new Date(giorno + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Da un'istantanea: { MA: Map(data → prezzo PriceLabs) }, con user_price o, se manca (giorno già prenotato), price. */
export function prezziPerData(ist) {
  const col = ist.colonne || [];
  const iD = col.indexOf('date'), iU = col.indexOf('user_price'), iP = col.indexOf('price');
  const out = {};
  for (const [h, c] of Object.entries(ist.case || {})) {
    const m = new Map();
    for (const g of c.giorni || []) {
      const v = g[iU] > 0 ? g[iU] : g[iP] > 0 ? g[iP] : null;
      if (v) m.set(g[iD], v);
    }
    out[h] = m;
  }
  return out;
}

/**
 * Coefficiente di realizzo: per ogni prenotazione fatta in un giorno di cui c'è la foto
 * dei prezzi, quanto ha pagato l'ospite per l'alloggio (senza pulizie né tassa) diviso
 * la somma dei prezzi PriceLabs di quel mattino per le sue notti. Comprende ricarichi,
 * sconti, Genius, soggiorni lunghi e i ritocchi fatti a mano: è il fattore vero.
 * prezziDelGiorno(giorno) → l'oggetto di prezziPerData, o null se quel giorno non c'è la foto.
 * Ritorna { dal, case: { MA: { coeff, notti, prenotazioni, pagato, listino, canali: { Airbnb: {…} } } } }.
 */
export function misuraRealizzo(prenotazioni, prezziDelGiorno, dal) {
  const acc = {};
  const add = (h, ch, notti, pagato, listino) => {
    const a = (acc[h] ||= { notti: 0, prenotazioni: 0, pagato: 0, listino: 0, canali: {} });
    const c = (a.canali[ch] ||= { notti: 0, prenotazioni: 0, pagato: 0, listino: 0 });
    for (const x of [a, c]) { x.notti += notti; x.prenotazioni++; x.pagato += pagato; x.listino += listino; }
  };
  for (const r of prenotazioni) {
    if (!r.bookingDate || r.bookingDate < dal || !(r.nights > 0) || !r.checkIn || !r.checkOut) continue;
    if (r.cleaning == null) continue; // payload vecchio, senza pulizie: non confrontabile
    const prezzi = prezziDelGiorno(r.bookingDate)?.[r.houseId];
    if (!prezzi) continue;
    let listino = 0, ok = true;
    for (let d = r.checkIn; d < r.checkOut; d = piuUno(d)) {
      const v = prezzi.get(d);
      if (!v) { ok = false; break; }
      listino += v;
    }
    const pagato = roomRevenueOf(r);
    if (!ok || !(listino > 0) || !(pagato > 0)) continue;
    add(r.houseId, r.channel || 'Altro', r.nights, pagato, listino);
  }
  const fin = (x) => ({ ...x, pagato: Math.round(x.pagato), listino: Math.round(x.listino), coeff: x.listino ? x.pagato / x.listino : null });
  return {
    dal,
    case: Object.fromEntries(Object.entries(acc).map(([h, a]) => [h, { ...fin(a), canali: Object.fromEntries(Object.entries(a.canali).map(([k, c]) => [k, fin(c)])) }])),
  };
}

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
 * Ogni cella: prezzo chiesto (PriceLabs), prezzo atteso (quello × fattoreIncasso), prezzo a notte incassato l'anno scorso (solo alloggio,
 * senza pulizie né tassa), notti già vendute oggi e alla stessa data dell'anno scorso, semaforo.
 *   stato: 'rosso'  prezzo alto e ritmo sotto l'anno scorso
 *          'giallo' solo una delle due
 *          'verde'  nessuna delle due
 *          'grigio' anno scorso non confrontabile (poche notti o casa in lancio)
 *          'pieno'  nessuna notte in vendita (tutto prenotato o bloccato)
 *          'manca'  PriceLabs non ha prezzi per quel mese
 */
export function prezziInVendita(riassunto, data, houses, oggi = new Date(), n = 6, soglie = PREZZI_VENDITA_SOGLIE, realizzo = null) {
  const primi = primiCheckIn(data);
  return houses.map((h) => {
    const pl = riassunto?.case?.[h];
    const sim = fattoreIncasso(h);
    const mis = realizzo?.case?.[h] || null;
    // Il coefficiente misurato vince sul simulatore quando ci sono abbastanza notti.
    const usaMisura = !!(mis && mis.coeff && mis.notti >= soglie.minNottiRealizzo);
    const fi = { fattore: usaMisura ? mis.coeff : sim.fattore };
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
      // Si confronta il prezzo che l'ospite pagherà in media (ricarichi e sconti dei portali),
      // non il prezzo PriceLabs: l'incassato dell'anno scorso li comprende già.
      const atteso = p?.prezzo ? Math.round(p.prezzo * fi.fattore) : null;
      const dPrezzo = confrontabile && atteso ? pct(atteso, lyAdr) : null;
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
        prezzo: p?.prezzo ?? null, atteso, consiglio: p?.consiglio ?? null, liberi: p?.liberi ?? 0, giorni: p?.giorni ?? 0,
        lyAdr: lyAdr != null ? Math.round(lyAdr) : null, lyNotti: m.lyFinalBooked, dPrezzo,
        notti: m.booked, lyNottiAllaData: m.lyBooked, alto, sotto,
      };
    });
    return { h, mesi, fattore: fi.fattore, fonte: usaMisura ? 'misurato' : 'simulatore', simulatore: sim.fattore, misura: mis, portali: sim.portali, min: pl?.min ?? null, base: pl?.base ?? null, max: pl?.max ?? null };
  });
}
