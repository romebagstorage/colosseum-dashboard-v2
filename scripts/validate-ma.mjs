import { fetchReservations, normalizeReservation } from '../lib/guesty.js';
import { aggregate } from '../lib/kpi.js';
import fs from 'fs';

const raw = await fetchReservations('2025-01-01', '2026-12-31');
fs.writeFileSync('/tmp/guesty_raw.json', JSON.stringify(raw));
const rows = raw.map(normalizeReservation);
console.log('reservations:', raw.length, 'statuses:', [...new Set(rows.map(r=>r.status))].join(','), 'houses:', JSON.stringify(rows.reduce((a,r)=>(a[r.houseId]=(a[r.houseId]||0)+1,a),{})));

const ref = {
  tot:   [6966,6176,8292,10996,12064,9716,10240,7639],
  ricavi:[6300,5624,7662,10384,11362,9014,9580,7033],
  netto: [5423,4814,6117,8478,8809,8287,7878,5580],
  tassa: [666,552,630,612,702,702,660,606],
  pren:  [10,9,7,11,7,7,11,7],
  notti: [28,27,29,30,31,29,30,29],
};
const agg = aggregate(rows, { years: [2025, 2026] });
const ma = agg.MA['2026'];
const M = ['gen','feb','mar','apr','mag','giu','lug','ago'];
const line = (label, g, s) => console.log(label.padEnd(7), M.map((m,i)=>`${String(Math.round(g[i])).padStart(6)}/${String(s[i]).padStart(6)}`).join(' '));
console.log('MA 2026 — Guesty / Foglio');
line('TOT', ma.map(b=>b.tot), ref.tot);
line('Ricavi', ma.map(b=>b.ricavi), ref.ricavi);
line('Netto', ma.map(b=>b.ricaviNettiOTA), ref.netto);
line('Tassa', ma.map(b=>b.tassa), ref.tassa);
line('Pren', ma.map(b=>b.prenotazioni), ref.pren);
line('Notti', ma.map(b=>b.notti), ref.notti);
const sum = a => a.slice(0,8).reduce((s,x)=>s+x,0);
console.log('\nTotali gen-ago  TOT', Math.round(sum(ma.map(b=>b.tot))), '/', sum(ref.tot), ' Ricavi', Math.round(sum(ma.map(b=>b.ricavi))), '/', sum(ref.ricavi), ' Netto', Math.round(sum(ma.map(b=>b.ricaviNettiOTA))), '/', sum(ref.netto), ' Pren', sum(ma.map(b=>b.prenotazioni)), '/', sum(ref.pren), ' Notti', sum(ma.map(b=>b.notti)), '/', sum(ref.notti));
