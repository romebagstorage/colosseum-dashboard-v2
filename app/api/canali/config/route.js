// Le configurazioni del simulatore «Parità OTA» (scheda «Canali»), sul server.
//
//   GET  /api/canali/config  → { ok, attivo, stato }   stato = { v, corrente, base, salvate[] } | null
//   PUT  /api/canali/config  ← { corrente?, base?, salvate? }  → { ok, stato }
// `corrente`, `base` e ogni `salvate[].stato` sono nella forma compatta di
// lib/parita.js (`compatta` / `espandi`): solo i numeri, circa 1 KB l'una.
//
// Stanno nello stesso archivio condiviso che la dashboard usa già per il
// gettone Guesty (lib/store.js, Vercel Edge Config), sotto una chiave sola:
// cosi' Alberto le ritrova dal telefono e dal computer. Si scrive solo quando
// si preme «Salva»: l'archivio e' piccolo e le scritture sono contate.
// La rotta e' protetta dal login come il resto (middleware.js).

import { NextResponse } from 'next/server';
import { storeEnabled, storeGet, storeSet } from '@/lib/store';
import { isCompatta } from '@/lib/parita';

export const dynamic = 'force-dynamic';

const CHIAVE = 'parita_canali';
// L'archivio ospita anche il gettone Guesty: in forma compatta una
// configurazione pesa circa 1 KB, con il punto di partenza e tre salvate si
// sta sotto questo tetto.
const MAX_BYTE = 6000;
const MAX_SALVATE = 3;

const pulisci = (c) => (isCompatta(c) ? c : null);

export async function GET() {
  if (!storeEnabled()) return NextResponse.json({ ok: true, attivo: false, stato: null });
  const stato = await storeGet(CHIAVE);
  return NextResponse.json({ ok: true, attivo: true, stato: stato && stato.v === 1 ? stato : null });
}

export async function PUT(request) {
  if (!storeEnabled()) {
    return NextResponse.json({ ok: false, motivo: 'Archivio sul server non configurato (EDGE_CONFIG, EDGE_CONFIG_ID, VERCEL_API_TOKEN)' }, { status: 503 });
  }
  let d;
  try { d = await request.json(); } catch { return NextResponse.json({ ok: false, motivo: 'Richiesta non valida' }, { status: 400 }); }

  const prima = (await storeGet(CHIAVE)) || { v: 1, corrente: null, base: null, salvate: [] };
  const stato = {
    v: 1,
    corrente: d.corrente !== undefined ? pulisci(d.corrente) : prima.corrente,
    base: d.base !== undefined ? pulisci(d.base) : prima.base,
    salvate: d.salvate !== undefined
      ? (Array.isArray(d.salvate) ? d.salvate : [])
        .filter((x) => x && typeof x.nome === 'string' && isCompatta(x.stato))
        .slice(0, MAX_SALVATE)
        .map((x) => ({ nome: x.nome.slice(0, 40), il: String(x.il || '').slice(0, 10), stato: x.stato }))
      : prima.salvate || [],
    aggiornato: new Date().toISOString(),
  };
  const peso = Buffer.byteLength(JSON.stringify(stato));
  if (peso > MAX_BYTE) {
    return NextResponse.json({ ok: false, motivo: `Troppo grande per l'archivio (${peso} byte su ${MAX_BYTE}): togli una configurazione salvata` }, { status: 413 });
  }
  const ok = await storeSet(CHIAVE, stato);
  if (!ok) return NextResponse.json({ ok: false, motivo: "L'archivio non ha accettato il salvataggio" }, { status: 502 });
  return NextResponse.json({ ok: true, stato });
}
