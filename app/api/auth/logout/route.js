import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAdapter, getAllAdapters } from '@/lib/adapters/adapter-registry.js';

export const runtime = 'nodejs';

/**
 * Logout endpoint - clears httpOnly cookies for adapters
 * If a tool is specified, only that adapter is cleared
 */
export async function POST(request) {
  try {
    const { tool } = await request.json().catch(() => ({}));
    const cookieStore = await cookies();

    if (tool) {
      try {
        const adapter = getAdapter(tool);
        cookieStore.delete(adapter.getCookieName());
        return NextResponse.json({ success: true, message: `Disconnected from ${tool}` });
      } catch (error) {
        console.error(`Logout error for tool "${tool}":`, error);
        return NextResponse.json({ error: `Unknown tool "${tool}"` }, { status: 400 });
      }
    }

    // No specific tool provided - clear all adapter cookies
    const adapters = getAllAdapters().map(AdapterClass => new AdapterClass());
    adapters.forEach(adapter => {
      cookieStore.delete(adapter.getCookieName());
    });

    return NextResponse.json({ success: true, message: 'Disconnected from all tools' });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 });
  }
}

