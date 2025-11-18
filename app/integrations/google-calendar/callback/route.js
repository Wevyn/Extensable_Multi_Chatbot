import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Handle OAuth errors
  if (error) {
    console.error('Google OAuth error:', error);
    return NextResponse.json({ error: `OAuth error: ${error}` }, { status: 400 });
  }

  const cookieStore = await cookies();
  const cookieState = cookieStore.get('google_calendar_oauth_state')?.value;
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 });
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 403 });
  }

  const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? APP_BASE_URL;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${APP_BASE_URL}/integrations/google-calendar/callback`;

  // Exchange authorization code for access token
  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('code', code);
  form.set('redirect_uri', redirectUri);
  form.set('client_id', clientId);
  form.set('client_secret', clientSecret);

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });

  if (!tokenResp.ok) {
    const body = await tokenResp.text().catch(() => '');
    console.error('Google token exchange failed', tokenResp.status, body);
    return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 });
  }

  const tokenData = await tokenResp.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) return NextResponse.json({ error: 'No access_token' }, { status: 500 });

  // Store access token in secure httpOnly cookie
  // Google tokens typically expire in 1 hour, but we'll store for 30 days
  // The refresh token (if provided) can be used to get new access tokens
  cookieStore.set('google_calendar_token', accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  // Store refresh token separately if provided (for token refresh)
  if (tokenData.refresh_token) {
    cookieStore.set('google_calendar_refresh_token', tokenData.refresh_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365, // 1 year (refresh tokens don't expire)
    });
  }

  // Also set temporary cookie for polling fallback
  cookieStore.set('google_calendar_token_once', accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 120, // 2 minutes
  });

  cookieStore.delete('google_calendar_oauth_state');

  // Return HTML that signals success
  const html = `<!doctype html>
<meta charset="utf-8"/>
<title>Connected to Google Calendar</title>
<script>
  (function () {
    try {
      var msg = { type: 'GOOGLE_CALENDAR_OAUTH_SUCCESS' };
      if (window.opener) {
        window.opener.postMessage(msg, ${JSON.stringify(FRONTEND_ORIGIN)});
        setTimeout(function() { window.close(); }, 1000);
      } else {
        window.close();
      }
    } catch (e) {
      console.error('postMessage error:', e);
      window.close();
    }
  })();
</script>
<p>✅ Connected to Google Calendar! This window will close automatically...</p>`;

  const res = new NextResponse(html, { status: 200 });
  res.headers.set('Content-Type', 'text/html; charset=utf-8');
  return res;
}

