import { NextResponse } from 'next/server';

const COOKIE_NAME = 'dashboard_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 7;

async function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [ts, hmacHex] = parts;
  const tsNum = parseInt(ts, 10);
  if (isNaN(tsNum)) return false;
  const ageSec = (Date.now() - tsNum) / 1000;
  if (ageSec > MAX_AGE_SEC || ageSec < 0) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(ts));
  const sigHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  if (sigHex.length !== hmacHex.length) return false;
  let diff = 0;
  for (let i = 0; i < sigHex.length; i++) diff |= sigHex.charCodeAt(i) ^ hmacHex.charCodeAt(i);
  return diff === 0;
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  // /api/pricelabs/salva: la chiama il cron di Vercel, che non ha il login;
  // la rotta controlla da sola CRON_SECRET o il login.
  if (pathname === '/login' || pathname === '/api/login' || pathname === '/api/pricelabs/salva' || pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.startsWith('/icon') || pathname.startsWith('/apple-icon') || pathname.startsWith('/brand/')) {
    return NextResponse.next();
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: 'SESSION_SECRET non configurato' }, { status: 500 });
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const valid = await verifyToken(token, secret);
  if (!valid) {
    if (pathname.startsWith('/api')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
