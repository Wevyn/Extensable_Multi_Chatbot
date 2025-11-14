import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

/**
 * Check authentication status by reading httpOnly cookie
 * Returns whether user is authenticated (without exposing token)
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('attio_api_token')?.value;

    if (!token) {
      return NextResponse.json({ authenticated: false });
    }

    // Validate token by making a test API call to Attio
    try {
      const resp = await fetch('https://api.attio.com/v2/objects', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!resp.ok) {
        // Token is invalid, clear it
        cookieStore.delete('attio_api_token');
        return NextResponse.json({ authenticated: false });
      }

      return NextResponse.json({ authenticated: true });
    } catch (error) {
      console.error('Token validation error:', error);
      return NextResponse.json({ authenticated: false });
    }
  } catch (error) {
    console.error('Auth status check error:', error);
    return NextResponse.json({ authenticated: false });
  }
}

