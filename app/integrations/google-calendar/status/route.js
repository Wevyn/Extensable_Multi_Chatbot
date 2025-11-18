import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('google_calendar_token_once')?.value;
  
  if (token) {
    // Delete temporary cookie after reading
    cookieStore.delete('google_calendar_token_once');
    return NextResponse.json({ access_token: token });
  }
  
  // Check if already authenticated
  const existingToken = cookieStore.get('google_calendar_token')?.value;
  if (existingToken) {
    return NextResponse.json({ access_token: existingToken });
  }
  
  return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
}

