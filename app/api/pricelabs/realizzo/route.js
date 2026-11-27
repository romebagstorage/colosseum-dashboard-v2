// GET /api/pricelabs/realizzo → coefficiente di realizzo per casa (lib/prezzi-vendita.js,
// misuraRealizzo): quanto pagano davvero gli ospiti rispetto al prezzo PriceLabs del
// mattino in cui hanno prenotato. Solo da loggati (middleware.js).
// Legge le prenotazioni di /api/data (getPayload, stessa cache) e, per ogni giorno di
// prenotazione dal 19/11/2026, la foto dei prezzi di quel giorno (Blob, o PREZZI_DIR in
// locale). Il risultato resta in cache 3 ore: le foto sono una al giorno.
// Non chiama PriceLabs, non scrive niente.

import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getPayload } from '@/lib/payload';
import { fileDelGiorno, giornoRoma } from '@/lib/pricelabs';
import { misuraRealizzo, prezziPerData } from '@/lib/prezzi-vendita';
import { leggiFoto } from '@/lib/foto-prezzi';
import { PREZZI_VENDITA_SOGLIE } from '@/config/prezzi-vendita';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

async function calcola(oggi) {
  const data = await getPayload();
  const dal = PREZZI_VENDITA_SOGLIE.primaFoto;
  const giorni = [...new Set((data.reservations || []).map((r) => r.bookingDate).filter((g) => g && g >= dal && g <= oggi))].sort();
  const foto = {};
  const mancanti = [];
  // A gruppi di 6, per non aprire troppe letture insieme.
  for (let i = 0; i < giorni.length; i += 6) {
    await Promise.all(giorni.slice(i, i + 6).map(async (g) => {
      const t = await leggiFoto(fileDelGiorno(g));
      if (t) foto[g] = prezziPerData(JSON.parse(t)); else mancanti.push(g);
    }));
  }
  const r = misuraRealizzo(data.reservations || [], (g) => foto[g] || null, dal);
  return { ...r, giorni_con_foto: Object.keys(foto).length, giorni_senza_foto: mancanti.sort(), payload: data.generatedAt };
}

const inCache = unstable_cache((oggi) => calcola(oggi), ['pricelabs-realizzo-v1'], { revalidate: 10800 });

export async function GET(request) {
  const oggi = giornoRoma();
  try {
    const fresco = request.nextUrl.searchParams.get('refresh') === '1';
    let r;
    try { r = fresco ? await calcola(oggi) : await inCache(oggi); }
    catch (e) { if (/incrementalCache/.test(String(e))) r = await calcola(oggi); else throw e; }
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error(`[pricelabs-realizzo] errore: ${e.message}`);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
