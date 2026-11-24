// Piccolo key-value condiviso fra tutte le istanze serverless (Vercel Edge Config).
// Letture: endpoint pubblico con read token (env EDGE_CONFIG = connection string).
// Scritture: Vercel REST API (env VERCEL_API_TOKEN + EDGE_CONFIG_ID). Tutto best-effort: se non
// configurato, le funzioni ritornano null / false e il chiamante usa il fallback.

function conn() {
  const cs = process.env.EDGE_CONFIG;
  if (!cs) return null;
  try { const u = new URL(cs); return { base: u.origin + u.pathname.replace(/\/$/, ''), token: u.searchParams.get('token') }; } catch { return null; }
}

export function storeEnabled() { return !!(conn() && process.env.EDGE_CONFIG_ID && process.env.VERCEL_API_TOKEN); }

export async function storeGet(key) {
  const c = conn();
  if (!c) return null;
  try {
    const res = await fetch(`${c.base}/item/${encodeURIComponent(key)}?token=${c.token}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function storeSet(key, value) {
  const id = process.env.EDGE_CONFIG_ID, tok = process.env.VERCEL_API_TOKEN;
  if (!id || !tok) return false;
  try {
    const res = await fetch(`https://api.vercel.com/v1/edge-config/${id}/items`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ operation: 'upsert', key, value }] }),
      cache: 'no-store',
    });
    return res.ok;
  } catch { return false; }
}
