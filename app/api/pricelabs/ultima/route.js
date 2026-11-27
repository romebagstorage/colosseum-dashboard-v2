// GET /api/pricelabs/ultima → il riassunto dell'ultima foto dei prezzi PriceLabs
// (lib/prezzi-vendita.js, riassumiIstantanea), per il pannello «Prezzi in vendita».
// Solo da loggati (middleware.js). Legge il file del giorno salvato dal cron
// (/api/pricelabs/salva); se manca prova i 7 giorni prima. Non chiama PriceLabs.

import { NextResponse } from 'next/server';
import { fileDelGiorno, giornoRoma } from '@/lib/pricelabs';
import { riassumiIstantanea } from '@/lib/prezzi-vendita';
import { leggiFoto as leggi } from '@/lib/foto-prezzi';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET() {
  const oggi = giornoRoma();
  try {
    for (let i = 0; i <= 7; i++) {
      const d = new Date(oggi + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() - i);
      const giorno = d.toISOString().slice(0, 10);
      const testo = await leggi(fileDelGiorno(giorno));
      if (!testo) continue;
      const r = riassumiIstantanea(JSON.parse(testo));
      return NextResponse.json({ ok: true, vecchia_di_giorni: i, ...r });
    }
    return NextResponse.json({ ok: false, error: 'nessuna foto dei prezzi negli ultimi 7 giorni' }, { status: 404 });
  } catch (e) {
    console.error(`[pricelabs-ultima] errore: ${e.message}`);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
