import { NextResponse } from 'next/server';
import { getPayload } from '@/lib/payload';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  if (!process.env.GUESTY_CLIENT_ID || !process.env.GUESTY_CLIENT_SECRET) {
    return NextResponse.json({ error: 'GUESTY_CLIENT_ID / GUESTY_CLIENT_SECRET non configurati' }, { status: 500 });
  }
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  try {
    return NextResponse.json(await getPayload({ refresh }));
  } catch (err) {
    return NextResponse.json({ error: 'Errore Guesty: ' + err.message }, { status: 502 });
  }
}
