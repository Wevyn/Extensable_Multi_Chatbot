import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { clearCachedSchema, getCacheStats } from '@/lib/schema-cache';

export const runtime = 'nodejs';

/**
 * Manual cache invalidation endpoint
 * Clears the schema cache for the current user's workspace
 * Useful when you know the schema has changed
 */
export async function POST() {
  try {
    // Read token from httpOnly cookie
    const cookieStore = await cookies();
    const attioApiKey = cookieStore.get('attio_api_token')?.value;

    if (!attioApiKey) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const cacheKey = attioApiKey.substring(0, 20);
    clearCachedSchema(cacheKey);
    
    const stats = getCacheStats();
    
    return NextResponse.json({ 
      success: true, 
      message: 'Schema cache cleared. Schema will be reloaded on next request.',
      cacheStats: stats
    });
  } catch (error) {
    console.error('Cache invalidation error:', error);
    return NextResponse.json({ error: 'Cache invalidation failed' }, { status: 500 });
  }
}

/**
 * Get cache statistics
 */
export async function GET() {
  try {
    const stats = getCacheStats();
    return NextResponse.json({ stats });
  } catch (error) {
    console.error('Cache stats error:', error);
    return NextResponse.json({ error: 'Failed to get cache stats' }, { status: 500 });
  }
}

