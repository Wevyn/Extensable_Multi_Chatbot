import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('attio_token_once')?.value || null;

  // Only return token once, but don't delete yet (let it expire naturally)
  // This prevents issues if client polls multiple times before receiving postMessage
  if (token) {
    // Delete the cookie after returning it to prevent reuse
    // But the maxAge of 120s will clean it up automatically anyway
    cookieStore.delete('attio_token_once');
  }

  return NextResponse.json({ access_token: token });
}
