// Il modello del simulatore «Parità OTA» (scheda «Canali»).
//
// È il porting, formula per formula, dell'artifact «Parità OTA Colosseum»
// (19/11/2026). Tutto puro e deterministico: nessuna estrazione a caso, si
// calcolano tutte le combinazioni di sconti con la loro probabilità.
//   - tariffa piena sul portale = prezzo PriceLabs × (1 + ricarico Guesty);
//   - ogni sconto toglie la sua percentuale da quello che resta (15% e poi 10%
//     fanno 23,5%), nell'ordine delle ricevute Airbnb e Booking;
//   - dentro un gruppo scatta al massimo uno sconto; se le quote del gruppo
//     superano il 100% si riscalano;
//   - la commissione si calcola su alloggio + pulizie;
//   - lo sconto pagato da Booking («Booking Sponsored Benefit») abbassa il prezzo
//     per l'ospite ma non l'incasso.
// Se cambia una formula qui, va cambiata anche nell'artifact (o viceversa).

import { PARITA_HOUSES, PARITA_ORDER } from '@/config/parita';

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const chan = (S, id) => S.channels.find((c) => c.id === id);

/** Le combinazioni di sconti di un portale: [{ names, f, p }] con f = fattore di prezzo, p = probabilità. */
export function outcomes(ch) {
  let combos = [{ names: [], f: 1, p: 1 }];
  for (const g of ch.groups) {
    const its = g.items.filter((i) => i.on && i.prob > 0);
    if (!its.length) continue;
    const sum = its.reduce((s, i) => s + i.prob / 100, 0);
    const k = sum > 1 ? 1 / sum : 1;
    const outs = [{ name: null, f: 1, p: Math.max(0, 1 - sum * k) }]
      .concat(its.map((i) => ({ name: `${i.name} −${String(i.pct).replace('.', ',')}%`, f: 1 - i.pct / 100, p: (i.prob / 100) * k })));
    const next = [];
    for (const c of combos) for (const o of outs) {
      if (o.p <= 0) continue;
      next.push({ names: o.name ? c.names.concat(o.name) : c.names, f: c.f * o.f, p: c.p * o.p });
    }
    combos = next;
  }
  return combos;
}

/** Il fattore medio di sconto (1 = nessuno sconto). */
export const expF = (ch) => outcomes(ch).reduce((s, o) => s + o.p * o.f, 0);

/** La parte di prezzo che Booking paga di tasca sua, in media. */
export const sponsorCut = (ch) => (ch.sponsor ? (ch.sponsor.prob / 100) * (ch.sponsor.pct / 100) : 0);

/** Quanto arriva su 100 € di prezzo PriceLabs, solo alloggio. */
export const per100 = (ch, comm) => 100 * (1 + ch.markup / 100) * expF(ch) * (1 - comm / 100);

function quant(outs) {
  const s = outs.slice().sort((a, b) => a.net - b.net);
  const at = (t) => { let c = 0; for (const o of s) { c += o.p; if (c >= t - 1e-9) return o.net; } return s[s.length - 1].net; };
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}

/** Un soggiorno su un portale: prezzo per l'ospite e incasso, a notte, con la distribuzione. */
export function stay(ch, price, nights, cleaning, comm) {
  const L = price * nights * (1 + ch.markup / 100), c = comm / 100;
  const outs = outcomes(ch).map((o) => {
    const room = L * o.f;
    return { ...o, guest: (room + cleaning) / nights, net: (room + cleaning) * (1 - c) / nights, p100: 100 * (1 + ch.markup / 100) * o.f * (1 - c) };
  });
  const Ef = outs.reduce((s, o) => s + o.p * o.f, 0), room = L * Ef;
  return {
    L, Ef, outs,
    net: (room + cleaning) * (1 - c) / nights,
    guest: (room * (1 - sponsorCut(ch)) + cleaning) / nights,
    guestList: (room + cleaning) / nights,
    p100: 100 * (1 + ch.markup / 100) * Ef * (1 - c),
    q: quant(outs),
  };
}

/** Lo scenario (ricarichi, sconti, commissioni) separato dal resto dello stato. */
export const scenarioOf = (S) => ({
  channels: clone(S.channels),
  comm: Object.fromEntries(PARITA_ORDER.map((h) => [h, clone(S.houses[h].comm)])),
});

function nightNet(S, ch, h, comm) {
  const H = PARITA_HOUSES[h], p = S.houses[h].yprice || H.price.media;
  return (p * (1 + ch.markup / 100) * expF(ch) + H.cleaning / H.los) * (1 - comm / 100);
}

/** Il netto di un anno con uno scenario, alle notti e ai prezzi medi di S. */
export function annual(S, sc) {
  const rows = PARITA_ORDER.map((h) => {
    let tot = 0;
    for (const ch of sc.channels) tot += nightNet(S, ch, h, sc.comm[h][ch.id]) * (S.houses[h].nights[ch.id] || 0);
    return { h, tot };
  });
  return { rows, tot: rows.reduce((s, r) => s + r.tot, 0) };
}

/** Quanto costa ogni sconto acceso in un anno (netto recuperato spegnendolo, a notti invariate). */
export function discountCosts(S) {
  const cur = annual(S, scenarioOf(S));
  const rows = [];
  for (const ch of S.channels) for (const g of ch.groups) for (const it of g.items) {
    if (!it.on || it.prob <= 0 || it.pct <= 0) continue;
    const sc = scenarioOf(S);
    sc.channels.find((c) => c.id === ch.id).groups.find((gg) => gg.id === g.id).items.find((ii) => ii.id === it.id).on = false;
    rows.push({ ch, it, cost: annual(S, sc).tot - cur.tot });
  }
  return rows.sort((a, b) => b.cost - a.cost);
}

export const curPrice = (S) => (S.price > 0 ? S.price : PARITA_HOUSES[S.house].price[S.season === 'manuale' ? 'media' : S.season]);

/** L'obiettivo: quanto deve arrivare su 100 € di PriceLabs. */
export function targetP100(S) {
  const comm = S.houses[S.house].comm;
  if (S.target.mode === 'fixed') return S.target.pct;
  const ch = chan(S, S.target.mode);
  return per100(ch, comm[ch.id]);
}

/** Il ricarico che porterebbe un portale all'obiettivo, con gli sconti di oggi. */
export function markupForTarget(ch, comm, T) {
  return ((T / 100) / (expF(ch) * (1 - comm / 100)) - 1) * 100;
}

/** I quattro controlli sulle prenotazioni vere. */
export function verify(rows) {
  return rows.map((r) => {
    const model = r.commission
      ? r.commission.base * r.commission.rate
      : (r.room * r.cuts.reduce((f, c) => f * (1 - c / 100), 1) + r.cleaning) * (1 - r.comm / 100);
    const cents = (v) => Math.round(v * 100);
    return { ...r, model, scarto: Math.abs(cents(model) - cents(r.real)) / 100 };
  });
}

/**
 * Gli avvisi del simulatore: un portale più lontano di `soglia` punti
 * dall'obiettivo, per ogni casa. Il portale scelto come obiettivo non conta.
 * Il diretto avvisa solo se scende sotto: che renda più dei portali e' lo scopo.
 */
export function simAlerts(S, soglia) {
  const out = [];
  for (const h of PARITA_ORDER) {
    const comm = S.houses[h].comm;
    const T = S.target.mode === 'fixed' ? S.target.pct : per100(chan(S, S.target.mode), comm[S.target.mode]);
    for (const ch of S.channels) {
      if (ch.id === S.target.mode) continue;
      const diff = per100(ch, comm[ch.id]) - T;
      if (ch.id === 'direct' ? diff < -soglia : Math.abs(diff) > soglia) out.push({ h, ch: ch.id, name: ch.name, diff, T });
    }
  }
  return out;
}

/** Stato valido? (forma minima di una configurazione salvata) */
export function isState(s) {
  return !!(s && Array.isArray(s.channels) && s.houses && PARITA_ORDER.every((h) => s.houses[h]?.comm && s.houses[h]?.nights) && s.target);
}

// ---- Forma compatta, per l'archivio sul server ----------------------------
// L'archivio e' piccolo: si salvano solo i numeri che si possono cambiare
// (ricarichi, sconti, quote, commissioni, notti, prezzi). Nomi e fonti degli
// sconti vengono sempre da config/parita.js. Uno sconto che nella
// configurazione attuale non esiste piu' si perde; uno nuovo prende i valori
// attuali.

export function compatta(S) {
  const ch = {};
  for (const c of S.channels) {
    const it = {};
    for (const g of c.groups) for (const i of g.items) it[`${g.id}.${i.id}`] = [i.pct, i.prob, i.on ? 1 : 0];
    ch[c.id] = { mk: c.markup, sp: c.sponsor ? [c.sponsor.pct, c.sponsor.prob] : null, it };
  }
  const hs = {};
  for (const h of PARITA_ORDER) {
    const x = S.houses[h];
    hs[h] = [x.comm.airbnb, x.comm.booking, x.comm.direct, x.nights.airbnb, x.nights.booking, x.nights.direct, x.yprice];
  }
  return { h: S.house, se: S.season, p: S.price, st: S.stay, t: [S.target.mode, S.target.pct], hs, ch };
}

export function espandi(c, base) {
  const S = clone(base);
  if (!c || typeof c !== 'object') return S;
  if (PARITA_ORDER.includes(c.h)) S.house = c.h;
  if (typeof c.se === 'string') S.season = c.se;
  S.price = c.p > 0 ? c.p : null;
  if (c.st > 0) S.stay = c.st;
  if (Array.isArray(c.t)) S.target = { mode: c.t[0], pct: c.t[1] };
  for (const h of PARITA_ORDER) {
    const a = c.hs?.[h];
    if (!Array.isArray(a)) continue;
    const x = S.houses[h];
    [x.comm.airbnb, x.comm.booking, x.comm.direct, x.nights.airbnb, x.nights.booking, x.nights.direct, x.yprice] = a.map((v, i) => (Number.isFinite(v) ? v : [x.comm.airbnb, x.comm.booking, x.comm.direct, x.nights.airbnb, x.nights.booking, x.nights.direct, x.yprice][i]));
  }
  for (const ch of S.channels) {
    const k = c.ch?.[ch.id];
    if (!k) continue;
    if (Number.isFinite(k.mk)) ch.markup = k.mk;
    if (ch.sponsor && Array.isArray(k.sp)) [ch.sponsor.pct, ch.sponsor.prob] = k.sp;
    for (const g of ch.groups) for (const i of g.items) {
      const v = k.it?.[`${g.id}.${i.id}`];
      if (Array.isArray(v)) [i.pct, i.prob, i.on] = [v[0], v[1], !!v[2]];
    }
  }
  return S;
}

/** Una configurazione compatta ha la forma giusta? */
export const isCompatta = (c) => !!(c && typeof c === 'object' && c.hs && c.ch && Array.isArray(c.t));
