import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';

export const runtime = 'nodejs';

export async function GET() {
  const APP_BASE_URL = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: 'Missing GOOGLE_CLIENT_ID' }, { status: 500 });

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${APP_BASE_URL}/integrations/google-calendar/callback`;

  // Google OAuth 2.0 authorization URL
  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar');
  authorizeUrl.searchParams.set('access_type', 'offline'); // Get refresh token
  authorizeUrl.searchParams.set('prompt', 'consent'); // Force consent to get refresh token

  const cookieStore = await cookies();
  cookieStore.set('google_calendar_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600, // 10 minutes
  });

  return NextResponse.redirect(authorizeUrl.toString(), { status: 302 });
}

