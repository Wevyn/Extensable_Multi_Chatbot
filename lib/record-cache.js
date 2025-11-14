/**
 * Record Cache - Smart caching for API search results
 * 
 * This module provides intelligent caching of record lookups to reduce API calls
 * while maintaining data freshness and reliability.
 */

// In-memory cache: Map<apiKey, Map<objectType, Map<searchKey, cachedRecord>>>
const recordCache = new Map();

// Cache entry structure: { record_id, record_data, expiresAt, searchKey }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes - balances freshness with performance

/**
 * Generate a cache key from search parameters
 */
function generateCacheKey(objectType, searchParams) {
  // Normalize search params for consistent keys
  const normalized = {
    object: objectType,
    ...searchParams
  };
  return JSON.stringify(normalized);
}

/**
 * Normalize entity name for fuzzy matching in cache
 */
function normalizeName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase().trim()
    .replace(/[.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company)\b\.?/gi, '')
    .trim();
}

/**
 * Get cached record if available and not expired
 */
export function getCachedRecord(apiKey, objectType, searchKey) {
  const apiCache = recordCache.get(apiKey);
  if (!apiCache) return null;

  const objectCache = apiCache.get(objectType);
  if (!objectCache) return null;

  // Try exact match first
  let cached = objectCache.get(searchKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  // Try fuzzy match (normalized name)
  const normalizedKey = normalizeName(searchKey);
  for (const [key, entry] of objectCache.entries()) {
    if (normalizeName(key) === normalizedKey && entry.expiresAt > Date.now()) {
      return entry;
    }
  }

  return null;
}

/**
 * Cache a record lookup result
 */
export function setCachedRecord(apiKey, objectType, searchKey, recordId, recordData = null) {
  if (!apiKey || !objectType || !searchKey || !recordId) return;

  let apiCache = recordCache.get(apiKey);
  if (!apiCache) {
    apiCache = new Map();
    recordCache.set(apiKey, apiCache);
  }

  let objectCache = apiCache.get(objectType);
  if (!objectCache) {
    objectCache = new Map();
    apiCache.set(objectType, objectCache);
  }

  const expiresAt = Date.now() + CACHE_TTL_MS;
  objectCache.set(searchKey, {
    record_id: recordId,
    record_data: recordData,
    expiresAt,
    searchKey
  });

  // Also cache with normalized key for fuzzy matching
  const normalizedKey = normalizeName(searchKey);
  if (normalizedKey !== searchKey.toLowerCase()) {
    objectCache.set(normalizedKey, {
      record_id: recordId,
      record_data: recordData,
      expiresAt,
      searchKey: normalizedKey
    });
  }
}

/**
 * Invalidate cache for a specific record (when it's updated/deleted)
 */
export function invalidateRecord(apiKey, objectType, recordId) {
  const apiCache = recordCache.get(apiKey);
  if (!apiCache) return;

  const objectCache = apiCache.get(objectType);
  if (!objectCache) return;

  // Remove all entries with this record_id
  for (const [key, entry] of objectCache.entries()) {
    if (entry.record_id === recordId) {
      objectCache.delete(key);
    }
  }
}

/**
 * Clear all cache for an API key (e.g., on logout)
 */
export function clearCache(apiKey) {
  recordCache.delete(apiKey);
}

/**
 * Get cache statistics
 */
export function getCacheStats(apiKey = null) {
  if (apiKey) {
    const apiCache = recordCache.get(apiKey);
    if (!apiCache) return { total: 0, valid: 0, expired: 0 };

    let total = 0;
    let valid = 0;
    let expired = 0;
    const now = Date.now();

    for (const objectCache of apiCache.values()) {
      for (const entry of objectCache.values()) {
        total++;
        if (entry.expiresAt > now) {
          valid++;
        } else {
          expired++;
        }
      }
    }

    return { total, valid, expired, ttlMinutes: CACHE_TTL_MS / 1000 / 60 };
  }

  // Global stats
  let total = 0;
  let valid = 0;
  let expired = 0;
  const now = Date.now();

  for (const apiCache of recordCache.values()) {
    for (const objectCache of apiCache.values()) {
      for (const entry of objectCache.values()) {
        total++;
        if (entry.expiresAt > now) {
          valid++;
        } else {
          expired++;
        }
      }
    }
  }

  return { total, valid, expired, ttlMinutes: CACHE_TTL_MS / 1000 / 60 };
}

/**
 * Clean up expired entries (run periodically)
 */
export function cleanupExpired() {
  const now = Date.now();
  let cleaned = 0;

  for (const apiCache of recordCache.values()) {
    for (const objectCache of apiCache.values()) {
      for (const [key, entry] of objectCache.entries()) {
        if (entry.expiresAt <= now) {
          objectCache.delete(key);
          cleaned++;
        }
      }
    }
  }

  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} expired cache entries`);
  }

  return cleaned;
}

// Run cleanup every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpired, 10 * 60 * 1000);
}

