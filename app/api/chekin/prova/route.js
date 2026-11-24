// Prova delle API Chekin (lib/chekin.js): dice come ci si autentica e com'e'
// fatta una prenotazione, SENZA dati personali (solo nomi dei campi, stati,
// date, conteggi). Serve una volta, per scrivere il controllo degli arrivi.
//
//   GET /api/chekin/prova  → JSON con autenticazione, swagger, case, prenotazioni
//
// Protetta dal login come il resto (middleware.js). Scrive lo stesso JSON nel
// registro di Vercel, a pezzi, con «[chekin-prova]», cosi' si legge anche da li'.
// Non cambia niente su Chekin.

import { NextResponse } from 'next/server';
import { provaChekin, CHEKIN_BASE } from '@/lib/chekin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 120;

export async function GET() {
  const key = process.env.CHEKIN_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: 'CHEKIN_API_KEY non impostata su Vercel' }, { status: 503 });
  try {
    // CHEKIN_BASE_URL serve solo alle prove in locale.
    const base = (!process.env.VERCEL && process.env.CHEKIN_BASE_URL) || CHEKIN_BASE;
    const out = await provaChekin({ key, base });
    const testo = JSON.stringify(out);
    for (let i = 0, n = 1; i < testo.length; i += 3000, n++) console.log(`[chekin-prova] ${n}/${Math.ceil(testo.length / 3000)} ${testo.slice(i, i + 3000)}`);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    console.error(`[chekin-prova] errore: ${e.message}`);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
