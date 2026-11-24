// Prove in locale con dati finti (scripts/prova-finta/avvia.sh). Precaricato con
// NODE_OPTIONS=--require: intercetta le fetch verso Guesty, Edge Config, API Vercel e
// PriceLabs vero e risponde con dati finti; nessuna richiesta esce verso quei servizi
// (e mai una richiesta di gettone Guesty). Le prenotazioni sono inventate e sempre uguali.
const fs = require('fs');
const path = require('path');
const os = require('os');
const ARCHIVIO = process.env.ARCHIVIO_FINTO_FILE || path.join(os.tmpdir(), 'dashboard-archivio-finto.json');
const LOG = process.env.RETE_FINTA_LOG || path.join(os.tmpdir(), 'dashboard-rete-finta.log');
const log = (s) => fs.appendFileSync(LOG, `${new Date().toISOString()} [${process.pid}] ${s}\n`);

// --- prenotazioni finte, deterministiche ---
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const CASE = [
  { title: 'Marco Aurelio 43 - Colosseum', id: 'L-MA' },
  { title: 'Three-Bedroom Via Poliziano 61', id: 'L-POL' },
  { title: 'Prestige Three Bedrooms Colosseo', id: 'L-PRE' },
  { title: 'Bilocale A', id: '6854861b066d37001060d473' },
  { title: 'Trilocale B', id: '68548615331bfe00134cf985' },
];
const FONTI = [['airbnb2', 0.45], ['Booking.com', 0.35], ['website', 0.08], ['manual', 0.05], ['tripcom', 0.04], ['agoda', 0.03]];
const PAESI = ['Italy', 'United States', 'Germany', 'France', 'United Kingdom', 'Spain', 'Brazil', 'Australia', ''];
const OGGI = '2026-11-20';
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function genera() {
  const r = rng(42), out = [];
  let n = 0;
  CASE.forEach((c, ci) => {
    let d = ci === 3 || ci === 4 ? '2025-07-01' : '2025-01-03';
    while (d < '2027-09-01') {
      const futuro = d > OGGI;
      const gap = futuro ? Math.floor(r() * (d > '2027-03-01' ? 25 : 8)) : Math.floor(r() * 4);
      d = addDays(d, gap);
      const notti = 2 + Math.floor(r() * 6), ospiti = 1 + Math.floor(r() * 5);
      const out_ = addDays(d, notti);
      let x = r(), fonte = FONTI[0][0];
      for (const [f, p] of FONTI) { if ((x -= p) <= 0) { fonte = f; break; } }
      const ppn = Math.round(110 + r() * 150 + (ci === 2 ? 60 : 0));
      const pulizie = 60;
      const tassa = 6 * ospiti * Math.min(notti, 10);
      const alloggio = notti * ppn;
      let money;
      if (fonte === 'airbnb2') {
        const hp = Math.round((alloggio + pulizie) * 0.845 * 100) / 100;
        money = { totalPaid: hp, hostPayout: hp, hostServiceFee: Math.round((alloggio + pulizie) * 0.155 * 100) / 100, subTotalPrice: alloggio + pulizie, fareAccommodation: alloggio, fareCleaning: pulizie, totalTaxes: 0, invoiceItems: [], currency: 'EUR' };
      } else {
        const tot = alloggio + pulizie + tassa;
        money = { totalPaid: tot, hostPayout: tot, hostServiceFee: 0, subTotalPrice: alloggio + pulizie, fareAccommodation: alloggio, fareCleaning: pulizie, totalTaxes: tassa, invoiceItems: [{ title: 'City tax', normalType: 'CT', amount: tassa }], currency: 'EUR' };
      }
      const lead = 3 + Math.floor(r() * 120);
      let creata = addDays(d, -lead);
      if (creata > OGGI) creata = addDays(OGGI, -Math.floor(r() * 30));
      const cancellata = r() < 0.08;
      n++;
      out.push({
        reservationId: `fake${String(n).padStart(5, '0')}`, status: cancellata ? 'canceled' : (out_ <= OGGI ? 'checked_out' : 'confirmed'),
        source: fonte, checkIn: d + 'T13:00:00.000Z', checkOut: out_ + 'T08:00:00.000Z', checkInDate: d, checkOutDate: out_,
        numberOfNights: notti, guestsCount: ospiti, confirmationCode: `FK${n}`, createdAt: creata + 'T10:00:00.000Z',
        cancelationDate: cancellata ? addDays(creata, 5) + 'T10:00:00.000Z' : null,
        listingId: c.id, listing: { title: c.title },
        guest: { fullName: `Ospite Finto ${n}`, address: { country: PAESI[Math.floor(r() * PAESI.length)] } }, money,
      });
      d = out_;
    }
  });
  return out.sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1));
}
const PRENOTAZIONI = genera();

const leggiArchivio = () => { try { return JSON.parse(fs.readFileSync(ARCHIVIO, 'utf8')); } catch { return {}; } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const veraFetch = globalThis.fetch;
globalThis.fetch = async function fetchFinta(input, init = {}) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const u = new URL(url);
  if (u.hostname === 'open-api.guesty.com') {
    if (u.pathname.startsWith('/oauth2')) { log('BLOCCATA richiesta gettone Guesty'); return json({ error: 'gettone vietato nelle prove' }, 403); }
    if (u.pathname === '/v1/reservations-reports/reservations/search') {
      const q = u.searchParams, from = q.get('filter[checkOutDate][gte]'), to = q.get('filter[checkOutDate][lte]');
      const skip = +q.get('skip') || 0, limit = +q.get('limit') || 100;
      const tutte = PRENOTAZIONI.filter((p) => p.checkOutDate >= from && p.checkOutDate <= to);
      log(`guesty finto skip=${skip} (${tutte.length} in tutto)`);
      return json({ results: tutte.slice(skip, skip + limit), pagination: { hasMore: skip + limit < tutte.length } });
    }
    log('guesty finto: percorso sconosciuto ' + u.pathname); return json({ error: 'non finto' }, 404);
  }
  if (u.hostname === 'edge-config.finto') {
    const key = decodeURIComponent(u.pathname.split('/item/')[1] || '');
    const a = leggiArchivio();
    log(`archivio finto GET ${key}`);
    return key in a && a[key] !== null ? json(a[key]) : json({ error: 'not found' }, 404);
  }
  if (u.hostname === 'api.vercel.com') {
    if (/\/v1\/edge-config\/[^/]+\/items$/.test(u.pathname) && init.method === 'PATCH') {
      const a = leggiArchivio();
      for (const it of JSON.parse(init.body).items) a[it.key] = it.value;
      fs.writeFileSync(ARCHIVIO, JSON.stringify(a));
      log(`archivio finto PATCH ${JSON.parse(init.body).items.map((i) => i.key)}`);
      return json({ status: 'ok' });
    }
    log('BLOCCATA api.vercel.com ' + u.pathname); return json({ error: 'vietato nelle prove' }, 403);
  }
  if (/pricelabs\.co$/.test(u.hostname)) { log('BLOCCATA PriceLabs vero'); return json({ error: 'vietato' }, 403); }
  return veraFetch(input, init);
};
log(`rete finta attiva: ${PRENOTAZIONI.length} prenotazioni`);
