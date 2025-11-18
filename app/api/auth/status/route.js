import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAllAdapters } from '@/lib/adapters/adapter-registry.js';

export const runtime = 'nodejs';

/**
 * Check authentication status for all registered adapters
 * Returns a map of adapter names to connection status as well as an aggregate flag
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const adapters = getAllAdapters().map(AdapterClass => new AdapterClass());
    const adapterStatuses = {};

    let authenticated = false;

    for (const adapter of adapters) {
      const name = adapter.getName();
      const cookieName = adapter.getCookieName();
      const token = cookieStore.get(cookieName)?.value;
      const connected = Boolean(token);

      adapterStatuses[name] = {
        connected,
        cookieName
      };

      if (connected) {
        authenticated = true;
      }
    }

    return NextResponse.json({
      authenticated,
      adapters: adapterStatuses
    });
  } catch (error) {
    console.error('Auth status check error:', error);
    return NextResponse.json({ authenticated: false, adapters: {} });
  }
}

