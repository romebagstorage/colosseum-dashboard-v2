// Confronto riga per riga fra la vecchia lettura Guesty (GET /reservations, spenta il 01/03/2027)
// e la nuova (GET /reservations-reports/reservations/search).
//
//   node scripts/confronta-api.mjs scarica [DA] [A]   → scarica le due API una volta e salva i dump
//   node scripts/confronta-api.mjs confronta          → confronto offline sui dump (nessuna chiamata)
//
// Token: usa GUESTY_ACCESS_TOKEN se impostato; altrimenti chiede UN token (GUESTY_CLIENT_ID/SECRET)
// e lo salva nella cartella dei dump per le esecuzioni successive. Quota Guesty: 5 token al giorno.
// Cartella dei dump: CONFRONTO_DIR (predefinita: <tmp>/guesty-confronto). Contiene dati di ospiti: non condividerla.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = process.env.CONFRONTO_DIR || path.join(os.tmpdir(), 'guesty-confronto');
fs.mkdirSync(DIR, { recursive: true });
const TOKEN_FILE = path.join(DIR, 'token.json');
const [, , cmd = 'confronta', DA = '2025-01-01', A = `${new Date().getFullYear() + 1}-12-31`] = process.argv;

async function tokenUnaVolta() {
  if (process.env.GUESTY_ACCESS_TOKEN) return;
  if (fs.existsSync(TOKEN_FILE)) {
    const t = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (Date.now() < t.issuedAt + t.expiresIn * 1000 - 10 * 60 * 1000) { process.env.GUESTY_ACCESS_TOKEN = t.token; return; }
  }
  const id = process.env.GUESTY_CLIENT_ID || '', secret = process.env.GUESTY_CLIENT_SECRET || '';
  // niente richiesta a Guesty con valori vuoti o segnaposto («...»): sprecherebbe un tentativo
  if (id.length < 10 || secret.length < 10 || /^\.+$|[<>\s]/.test(id) || /^\.+$|[<>\s]/.test(secret)) {
    throw new Error('GUESTY_CLIENT_ID / GUESTY_CLIENT_SECRET mancanti o segnaposto: nessuna richiesta inviata a Guesty');
  }
  const res = await fetch('https://open-api.guesty.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'open-api', client_id: process.env.GUESTY_CLIENT_ID, client_secret: process.env.GUESTY_CLIENT_SECRET }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token: j.access_token, issuedAt: Date.now(), expiresIn: j.expires_in || 86400 }), { mode: 0o600 });
  process.env.GUESTY_ACCESS_TOKEN = j.access_token;
  console.log('Token nuovo emesso e salvato (1 dei 5 di oggi).');
}

if (cmd === 'scarica') {
  await tokenUnaVolta();
  const { fetchReservationsLegacy, fetchReportRaw } = await import('../lib/guesty.js');
  const t0 = Date.now();
  const legacy = await fetchReservationsLegacy(DA, A);
  console.log(`legacy: ${legacy.length} prenotazioni in ${Date.now() - t0} ms`);
  const t1 = Date.now();
  const report = await fetchReportRaw(DA, A);
  console.log(`reservations-reports: ${report.length} prenotazioni in ${Date.now() - t1} ms`);
  fs.writeFileSync(path.join(DIR, 'legacy.json'), JSON.stringify(legacy));
  fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify(report));
  fs.writeFileSync(path.join(DIR, 'periodo.json'), JSON.stringify({ da: DA, a: A, scaricatoIl: new Date().toISOString() }));
  console.log('Dump salvati in', DIR);
  process.exit(0);
}

// ------------------------------- confronto offline -------------------------------
const { toLegacyShape, normalizeReservation } = await import('../lib/guesty.js');
const { isCounted } = await import('../lib/kpi.js');
const legacy = JSON.parse(fs.readFileSync(path.join(DIR, 'legacy.json'), 'utf8'));
const reportRaw = JSON.parse(fs.readFileSync(path.join(DIR, 'report.json'), 'utf8'));
const periodo = JSON.parse(fs.readFileSync(path.join(DIR, 'periodo.json'), 'utf8'));
const report = reportRaw.map(toLegacyShape);

const L = new Map(legacy.map(r => [r._id, r]));
const N = new Map(report.map(r => [r._id, r]));
const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
log(`# Confronto vecchia/nuova API Guesty — check-out ${periodo.da} → ${periodo.a} (scaricato ${periodo.scaricatoIl})`);
log(`legacy ${legacy.length} righe, nuova ${report.length} righe`);

const soloL = legacy.filter(r => !N.has(r._id));
const soloN = report.filter(r => !L.has(r._id));
const byStatus = (rows) => Object.entries(rows.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {})).map(([k, v]) => `${k}×${v}`).join(', ') || '—';
log(`solo nella vecchia: ${soloL.length} (${byStatus(soloL)})`);
for (const r of soloL.slice(0, 15)) log(`   ${r.confirmationCode} ${r.status} ${r.source} ${r.checkInDateLocalized}→${r.checkOutDateLocalized} ${r.listing?.title || r.listingId}`);
log(`solo nella nuova: ${soloN.length} (${byStatus(soloN)})`);
for (const r of soloN.slice(0, 15)) log(`   ${r.confirmationCode} ${r.status} ${r.source} ${r.checkInDateLocalized}→${r.checkOutDateLocalized} ${r.listing?.title || r.listingId}`);

// 1) campi normalizzati (quelli che usa la dashboard)
const NUM = new Set(['persons', 'nights', 'gross', 'cityTax', 'paidTotal', 'net', 'year']);
const FIELDS = ['status', 'guest', 'country', 'persons', 'nights', 'checkIn', 'checkOut', 'confirmationCode', 'listing', 'listingId', 'houseId', 'channel', 'source', 'gross', 'cityTax', 'paidTotal', 'net', 'bookingDate', 'canceledAt', 'year'];
const diff = Object.fromEntries(FIELDS.map(f => [f, []]));
const comuni = legacy.filter(r => N.has(r._id));
for (const lr of comuni) {
  const a = normalizeReservation(lr), b = normalizeReservation(N.get(lr._id));
  for (const f of FIELDS) {
    const va = a[f], vb = b[f];
    const same = NUM.has(f) ? Math.abs((Number(va) || 0) - (Number(vb) || 0)) < 0.005 : (va ?? '') === (vb ?? '');
    if (!same) diff[f].push({ code: a.confirmationCode, status: a.status, source: a.source, vecchio: va, nuovo: vb });
  }
}
log(`\n## Campi normalizzati su ${comuni.length} prenotazioni in comune`);
for (const f of FIELDS) {
  log(`${f.padEnd(17)} ${diff[f].length ? diff[f].length + ' differenze' : 'identico'}`);
  for (const d of diff[f].slice(0, 6)) log(`     ${d.code} [${d.status}/${d.source}] vecchio=${JSON.stringify(f === 'guest' ? '…' : d.vecchio)} nuovo=${JSON.stringify(f === 'guest' ? '…' : d.nuovo)}`);
}

// 2) campi money grezzi
const MONEY = ['totalPaid', 'hostPayout', 'hostServiceFee', 'subTotalPrice', 'totalTaxes', 'fareAccommodation', 'fareCleaning', 'transientOccupancyTax', 'currency'];
log(`\n## Campi money grezzi`);
for (const k of MONEY) {
  let d = 0, mancanti = 0; const ex = [];
  for (const lr of comuni) {
    const a = lr.money?.[k], b = N.get(lr._id).money?.[k];
    if (b === undefined && a !== undefined) mancanti++;
    const same = typeof a === 'number' || typeof b === 'number' ? Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005 : (a ?? '') === (b ?? '');
    if (!same) { d++; if (ex.length < 5) ex.push(`${lr.confirmationCode}[${lr.status}/${lr.source}] ${a} → ${b}`); }
  }
  log(`${k.padEnd(22)} ${d ? d + ' differenze' : 'identico'}${mancanti ? ` (assente nella nuova su ${mancanti})` : ''}`);
  for (const e of ex) log(`     ${e}`);
}
const itemsKey = (m) => (Array.isArray(m?.invoiceItems) ? m.invoiceItems : []).map(i => `${i.normalType || i.type}|${i.title}|${Math.round((Number(i.amount) || 0) * 100)}`).sort().join(';');
let dItems = 0; const exItems = [];
for (const lr of comuni) {
  if (itemsKey(lr.money) !== itemsKey(N.get(lr._id).money)) { dItems++; if (exItems.length < 5) exItems.push(`${lr.confirmationCode}: ${itemsKey(lr.money)}  ⇢  ${itemsKey(N.get(lr._id).money)}`); }
}
log(`invoiceItems           ${dItems ? dItems + ' differenze' : 'identico (tipo, titolo, importo)'}`);
for (const e of exItems) log(`     ${e}`);

// 3) totali come li vede la dashboard (prenotazioni contate, per anno di check-out e casa)
log(`\n## Totali delle prenotazioni contate (confermate) per anno e casa — vecchia | nuova`);
const tot = (rows) => {
  const acc = {};
  for (const r of rows.map(normalizeReservation).filter(r => isCounted(r))) {
    const k = `${r.year} ${r.houseId}`;
    const t = (acc[k] ??= { n: 0, notti: 0, lordi: 0, tot: 0, netto: 0, tassa: 0 });
    t.n++; t.notti += r.nights; t.lordi += r.gross; t.tot += r.paidTotal; t.netto += r.net; t.tassa += r.cityTax;
  }
  return acc;
};
const tl = tot(legacy), tn = tot(report);
const fmt = (t) => t ? `${String(t.n).padStart(4)} pren ${String(t.notti).padStart(5)} notti  TOT ${t.tot.toFixed(2).padStart(10)}  netto ${t.netto.toFixed(2).padStart(10)}  tassa ${t.tassa.toFixed(2).padStart(8)}` : '—';
for (const k of [...new Set([...Object.keys(tl), ...Object.keys(tn)])].sort()) {
  const same = JSON.stringify(tl[k] && Object.values(tl[k]).map(v => Math.round(v * 100))) === JSON.stringify(tn[k] && Object.values(tn[k]).map(v => Math.round(v * 100)));
  log(`${same ? '=' : '≠'} ${k.padEnd(9)} ${fmt(tl[k])}`);
  if (!same) log(`  ${''.padEnd(9)} ${fmt(tn[k])}`);
}
const canc = (rows) => rows.filter(r => r.status === 'canceled');
log(`\ncancellate: vecchia ${canc(legacy).length} (con canceledAt ${canc(legacy).filter(r => r.canceledAt).length}), nuova ${canc(report).length} (con data ${canc(report).filter(r => r.canceledAt).length})`);
fs.writeFileSync(path.join(DIR, 'confronto.txt'), out.join('\n'));
console.log('\nResoconto salvato in', path.join(DIR, 'confronto.txt'));
