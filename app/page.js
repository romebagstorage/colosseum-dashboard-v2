import Dashboard from '@/components/Dashboard';
import { getPayload } from '@/lib/payload';
import { BRAND } from '@/config/brand';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function HomePage() {
  let data;
  try {
    if (!process.env.GUESTY_CLIENT_ID || !process.env.GUESTY_CLIENT_SECRET) throw new Error('GUESTY_CLIENT_ID / GUESTY_CLIENT_SECRET non configurati');
    data = await getPayload();
  } catch (err) {
    data = { error: err.message };
  }

  if (data?.error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="panel max-w-2xl" style={{ padding: 32 }}>
          <img src={BRAND.logoLockup} alt={BRAND.name} className="h-14 w-auto mb-6" />
          <h1 className="brand-title mb-3">Dati momentaneamente non disponibili</h1>
          <p className="text-sm mb-3" style={{ color: 'var(--text-dim)' }}>La dashboard non riesce a leggere i dati da Guesty. Messaggio:</p>
          <pre className="text-xs p-3 rounded overflow-auto max-h-40 mb-3" style={{ background: 'var(--raised)' }}>{data.error}</pre>
          <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Se il messaggio riguarda il limite token, basta attendere: la dashboard riprova da sola. Altrimenti verifica le env var <code className="px-1.5 py-0.5 rounded" style={{ background: 'var(--raised)' }}>GUESTY_CLIENT_ID</code> e <code className="px-1.5 py-0.5 rounded" style={{ background: 'var(--raised)' }}>GUESTY_CLIENT_SECRET</code> su Vercel.</p>
        </div>
      </div>
    );
  }
  return <Dashboard initialData={data} />;
}
