import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const cookieStore = await cookies();
  const cookieState = cookieStore.get('attio_oauth_state')?.value;
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 });
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 403 });
  }

  const APP_BASE_URL = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? APP_BASE_URL;
  const clientId = process.env.ATTIO_CLIENT_ID;
  const clientSecret = process.env.ATTIO_CLIENT_SECRET;
  const redirectUri = `${APP_BASE_URL}/integrations/attio/callback`;

  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('code', code);
  form.set('redirect_uri', redirectUri);
  form.set('client_id', clientId);
  form.set('client_secret', clientSecret);

  const tokenResp = await fetch('https://app.attio.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });

  if (!tokenResp.ok) {
    const body = await tokenResp.text().catch(() => '');
    console.error('Token exchange failed', tokenResp.status, body);
    return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 });
  }

  const { access_token } = await tokenResp.json();
  if (!access_token) return NextResponse.json({ error: 'No access_token' }, { status: 500 });

  // Store token in secure httpOnly cookie (not accessible to JavaScript)
  // Set to expire in 30 days (can be adjusted based on token expiration)
  cookieStore.set('attio_api_token', access_token, {
    httpOnly: true, // Prevents JavaScript access (XSS protection)
    sameSite: 'lax', // CSRF protection
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  // Also set temporary cookie for polling fallback (will be deleted after use)
  cookieStore.set('attio_token_once', access_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 120, // 2 minutes
  });

  cookieStore.delete('attio_oauth_state');

  // Return HTML that signals success without exposing token
  const html = `<!doctype html>
<meta charset="utf-8"/>
<title>Connected to Attio</title>
<script>
  (function () {
    try {
      // Signal success without sending token (token is now in httpOnly cookie)
      var msg = { type: 'ATTIO_OAUTH_SUCCESS' };
      if (window.opener) {
        window.opener.postMessage(msg, ${JSON.stringify(FRONTEND_ORIGIN)});
        // Give parent window time to receive the message before closing
        setTimeout(function() { window.close(); }, 1000);
      } else {
        // No opener, close immediately (polling will handle it)
        window.close();
      }
    } catch (e) {
      console.error('postMessage error:', e);
      window.close();
    }
  })();
</script>
<p>✅ Connected! This window will close automatically...</p>`;

  const res = new NextResponse(html, { status: 200 });
  res.headers.set('Content-Type', 'text/html; charset=utf-8');
  return res;
}
