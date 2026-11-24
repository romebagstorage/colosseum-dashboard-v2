// Il salvataggio giornaliero dei prezzi PriceLabs (lib/pricelabs.js).
//
//   GET /api/pricelabs/salva  → { ok, file, byte, case: { MA: giorni, … }, avvisi }
//
// La chiama il cron di Vercel ogni mattina (vercel.json), con
// «Authorization: Bearer <CRON_SECRET>». La si puo' lanciare anche a mano da
// loggati, aprendo l'indirizzo nel browser: rifa' il file del giorno.
// middleware.js la lascia passare senza login proprio per il cron: il
// controllo (cron o login) e' qui sotto.
// Legge e basta: non cambia niente su PriceLabs.

import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import { leggiPricelabs, salvaIstantanea, PRICELABS_BASE } from '@/lib/pricelabs';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

function uguali(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function autorizzato(request) {
  const segreto = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  if (segreto && segreto.length >= 16 && uguali(auth, `Bearer ${segreto}`)) return 'cron';
  try { if (verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value)) return 'login'; } catch {}
  return null;
}

export async function GET(request) {
  const chi = autorizzato(request);
  if (!chi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = process.env.PRICELABS_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: 'PRICELABS_API_KEY non impostata su Vercel' }, { status: 503 });

  try {
    // PRICELABS_BASE_URL serve solo alle prove in locale.
    const base = (!process.env.VERCEL && process.env.PRICELABS_BASE_URL) || PRICELABS_BASE;
    const { istantanea, avvisi } = await leggiPricelabs({ key, base });
    const giorni = Object.fromEntries(Object.entries(istantanea.case).map(([h, c]) => [h, c.giorni?.length || 0]));
    const totale = Object.values(giorni).reduce((s, n) => s + n, 0);
    if (!totale) {
      console.error(`[pricelabs] nessun prezzo da salvare (${chi}): ${avvisi.join(' · ')}`);
      return NextResponse.json({ ok: false, error: 'nessun prezzo da salvare', avvisi }, { status: 502 });
    }
    const s = await salvaIstantanea(istantanea);
    console.log(`[pricelabs] salvata ${s.nome} (${s.byte} byte, ${chi}) giorni ${JSON.stringify(giorni)}${avvisi.length ? ' avvisi: ' + avvisi.join(' · ') : ''}`);
    return NextResponse.json({ ok: true, file: s.nome, byte: s.byte, case: giorni, avvisi });
  } catch (e) {
    console.error(`[pricelabs] errore (${chi}): ${e.message}`);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
