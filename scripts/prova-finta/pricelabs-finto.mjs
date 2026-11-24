// PriceLabs finto per scripts/prova-finta/avvia.sh: GET /v1/listings, POST /v1/listing_prices (porta 4011).
import http from 'node:http';
const LISTINGS = [
  { id: 'pl-ma', pms: 'guesty', name: 'Marco Aurelio 43 - Colosseum', min: 90, base: 180, max: 400, push_enabled: true },
  { id: 'pl-pol', pms: 'guesty', name: 'Three-Bedroom Via Poliziano 61', min: 100, base: 200, max: 450, push_enabled: true },
  { id: 'pl-pre', pms: 'guesty', name: 'Prestige Three Bedrooms', min: 120, base: 240, max: 500, push_enabled: true },
  { id: '6854861b066d37001060d473', pms: 'guesty', name: 'Bilocale A', min: 70, base: 130, max: 300, push_enabled: true },
  { id: '68548615331bfe00134cf985', pms: 'guesty', name: 'Trilocale B', min: 80, base: 150, max: 320, push_enabled: true },
];
let chiamate = 0;
http.createServer((req, res) => {
  chiamate++;
  const fine = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.headers['x-api-key'] !== 'chiave-finta') return fine({ error: 'chiave' }, 401);
  if (req.method === 'GET' && req.url.startsWith('/v1/listings')) return fine({ listings: LISTINGS });
  if (req.method === 'POST' && req.url === '/v1/listing_prices') {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const { listings } = JSON.parse(b);
      fine(listings.map((l) => {
        const data = []; const d = new Date(l.dateFrom + 'T00:00:00Z'); const to = new Date(l.dateTo + 'T00:00:00Z');
        for (; d <= to; d.setUTCDate(d.getUTCDate() + 1)) data.push({ date: d.toISOString().slice(0, 10), price: 150, user_price: 155, uncustomized_price: 140, min_stay: 2, booking_status: '', unbookable: 0, demand_desc: 'Normal Demand' });
        return { id: l.id, pms: l.pms, currency: 'EUR', last_refreshed_at: new Date().toISOString(), data };
      }));
    }); return;
  }
  fine({ error: 'sconosciuto' }, 404);
}).listen(4011, () => console.log('PriceLabs finto su 4011'));
