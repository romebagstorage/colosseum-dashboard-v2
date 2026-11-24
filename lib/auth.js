// Simple HMAC-signed cookie session. Cookie format: <timestamp>.<hmac>; expires after 7 days.
import crypto from 'node:crypto';

const COOKIE_NAME = 'dashboard_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 7;

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET non impostato (almeno 16 caratteri)');
  return s;
}

export function createSessionToken() {
  const ts = Date.now().toString();
  const hmac = crypto.createHmac('sha256', getSecret()).update(ts).digest('hex');
  return `${ts}.${hmac}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [ts, hmac] = parts;
  const expected = crypto.createHmac('sha256', getSecret()).update(ts).digest('hex');
  if (expected.length !== hmac.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(hmac, 'hex'))) return false;
  const tsNum = parseInt(ts, 10);
  if (isNaN(tsNum)) return false;
  const ageSec = (Date.now() - tsNum) / 1000;
  if (ageSec > MAX_AGE_SEC || ageSec < 0) return false;
  return true;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_COOKIE_MAX_AGE = MAX_AGE_SEC;
