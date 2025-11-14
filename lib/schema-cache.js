/**
 * Shared Schema Cache Module
 * Manages CRM schema caching with TTL support
 */

// Schema cache: Store loaded CRM schemas per API key with TTL
// Cache entry structure: { schema: {...}, expiresAt: timestamp }
const schemaCache = new Map();

// TTL for schema cache (default: 24 hours, configurable via env)
// Can be set in .env.local as SCHEMA_CACHE_TTL_MS (in milliseconds)
// Examples:
//  86400000 = 24 hours (default)
//  3600000 = 1 hour
//  1800000 = 30 minutes
const SCHEMA_CACHE_TTL_MS = parseInt(
  process.env.SCHEMA_CACHE_TTL_MS || '86400000', 
  10
);

/**
 * Get cached schema if it exists and is not expired
 * @param {string} cacheKey - Cache key (usually API key prefix)
 * @returns {object|null} - Cached schema entry or null if expired/missing
 */
export function getCachedSchema(cacheKey) {
  const cachedEntry = schemaCache.get(cacheKey);
  if (!cachedEntry) {
    return null;
  }

  const now = Date.now();
  if (cachedEntry.expiresAt <= now) {
    // Expired - remove it
    schemaCache.delete(cacheKey);
    return null;
  }

  return cachedEntry;
}

/**
 * Store schema in cache with TTL
 * @param {string} cacheKey - Cache key (usually API key prefix)
 * @param {object} schema - Schema object to cache
 */
export function setCachedSchema(cacheKey, schema) {
  const expiresAt = Date.now() + SCHEMA_CACHE_TTL_MS;
  schemaCache.set(cacheKey, {
    schema,
    expiresAt
  });
}

/**
 * Clear cache entry for a specific key
 * @param {string} cacheKey - Cache key to clear
 */
export function clearCachedSchema(cacheKey) {
  schemaCache.delete(cacheKey);
}

/**
 * Clear all cached schemas
 */
export function clearAllCachedSchemas() {
  schemaCache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  const now = Date.now();
  let valid = 0;
  let expired = 0;
  
  for (const entry of schemaCache.values()) {
    if (entry.expiresAt > now) {
      valid++;
    } else {
      expired++;
    }
  }
  
  return {
    total: schemaCache.size,
    valid,
    expired,
    ttlMs: SCHEMA_CACHE_TTL_MS,
    ttlHours: Math.round(SCHEMA_CACHE_TTL_MS / 1000 / 60 / 60 * 10) / 10
  };
}

/**
 * Clean up expired cache entries
 * @returns {number} - Number of entries cleaned
 */
export function cleanupExpiredCache() {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, entry] of schemaCache.entries()) {
    if (entry.expiresAt <= now) {
      schemaCache.delete(key);
      cleaned++;
    }
  }
  return cleaned;
}

// Run cleanup every hour (helps with memory management)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const cleaned = cleanupExpiredCache();
    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} expired cache entries`);
    }
  }, 60 * 60 * 1000); // Every hour
}

