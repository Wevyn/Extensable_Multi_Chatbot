import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

/**
 * Logout endpoint - clears the httpOnly cookie
 */
export async function POST() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete('attio_api_token');
    
    return NextResponse.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 });
  }
}

