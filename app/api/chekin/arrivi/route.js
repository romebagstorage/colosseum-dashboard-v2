// Controllo degli arrivi da Chekin (agente 8 «Arrivi e conformità»).
//
//   GET /api/chekin/arrivi  → arrivi dei prossimi 7 giorni con ospiti
//   registrati, Questura (Alloggiati Web), ISTAT e tassa di soggiorno; arrivi
//   degli ultimi 30 giorni ancora senza invio; ALLARMI e DA GUARDARE pronti.
//
// Sola lettura, niente dati personali (lib/chekin.js, controllaArrivi).
// Protetta dal login come il resto (middleware.js): la legge il giro del
// mattino del Guardiano da Chrome, come /api/data. Scrive nel registro di
// Vercel una riga di conteggi con «[chekin-arrivi]».

import { NextResponse } from 'next/server';
import { controllaArrivi, CHEKIN_BASE } from '@/lib/chekin';
import { getPayload } from '@/lib/payload';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 120;

export async function GET() {
  const key = process.env.CHEKIN_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: 'CHEKIN_API_KEY non impostata su Vercel' }, { status: 503 });
  let guesty = null;
  try { guesty = await getPayload(); } catch (e) { console.error(`[chekin-arrivi] Guesty non letto: ${e.message}`); }
  try {
    const base = (!process.env.VERCEL && process.env.CHEKIN_BASE_URL) || CHEKIN_BASE;
    const out = await controllaArrivi({ key, base, guesty: guesty && { reservations: guesty.reservations, cancelled: guesty.cancelled } });
    if (out.errore) {
      console.error(`[chekin-arrivi] errore: ${out.errore}`);
      return NextResponse.json({ ok: false, ...out }, { status: 502 });
    }
    console.log(`[chekin-arrivi] ${JSON.stringify(out.conteggi)} avvisi=${out.avvisi.length}`);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    console.error(`[chekin-arrivi] errore: ${e.message}`);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
