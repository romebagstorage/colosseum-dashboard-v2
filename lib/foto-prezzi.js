// Lettura di un file delle foto dei prezzi PriceLabs (prezzi-pricelabs/AAAA-MM-GG.json):
// dallo spazio Vercel Blob privato o, solo per le prove in locale, da PREZZI_DIR.
// Ritorna il testo o null se il file non c'è.
export async function leggiFoto(nome) {
  if (process.env.PREZZI_DIR && !process.env.VERCEL) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    try { return await fs.readFile(path.join(process.env.PREZZI_DIR, nome), 'utf8'); } catch { return null; }
  }
  const { get } = await import('@vercel/blob');
  let r;
  try { r = await get(nome, { access: 'private', useCache: false }); }
  catch (e) { if (/NotFound/i.test(e?.name || '') || /not.?found/i.test(e?.message || '')) return null; throw e; }
  if (!r || r.statusCode !== 200) return null;
  return await new Response(r.stream).text();
}
