'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BRAND } from '@/config/brand';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="panel">Caricamento...</div></div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const search = useSearchParams();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Errore di accesso');
        setLoading(false);
        return;
      }
      router.push(search.get('next') || '/');
    } catch (err) {
      setError('Errore di rete');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="panel w-full max-w-md" style={{ padding: 32 }}>
        <img src={BRAND.logoLockup} alt={BRAND.name} className="h-16 w-auto mb-6" />
        <div className="brand-sub mb-1">{BRAND.tagline}</div>
        <h1 className="brand-title mb-2">Accesso riservato</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-dim)' }}>Inserisci la password per accedere alla dashboard.</p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="ctl w-full mb-3 text-base focus:outline-none"
          style={{ padding: '10px 12px' }}
        />

        {error && <div className="text-sm mb-3" style={{ color: 'var(--red)' }}>{error}</div>}

        <button type="submit" disabled={loading || !password} className="btn-brand w-full transition">
          {loading ? 'Accesso in corso...' : 'Accedi'}
        </button>
        <div className="text-xs mt-6 text-center" style={{ color: 'var(--text-subtle)' }}>
          © {new Date().getFullYear()} · {BRAND.name} · dati Guesty
        </div>
      </form>
    </div>
  );
}
