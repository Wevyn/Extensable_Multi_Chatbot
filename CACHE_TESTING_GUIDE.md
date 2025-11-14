# Schema Cache TTL Testing Guide

## Quick Test Methods

### 1. **Check Server Console Logs**

Watch your terminal where `npm run dev` is running. You'll see different messages:

**First Request (Cache Miss):**
```
📥 Loading CRM schema...
```

**Cached Requests (Cache Hit):**
```
✅ Using cached CRM schema (expires in 1440 minutes)
```

**After Expiration:**
```
📥 Loading CRM schema...
```

### 2. **Check Cache Statistics**

Open your browser and visit:
```
http://localhost:3000/api/cache/invalidate
```

Or use curl:
```bash
curl http://localhost:3000/api/cache/invalidate
```

You'll see:
```json
{
  "stats": {
    "total": 1,
    "valid": 1,
    "expired": 0,
    "ttlMs": 86400000,
    "ttlHours": 24
  }
}
```

### 3. **Test with Short TTL (Recommended for Testing)**

Add to your `.env.local`:
```bash
# Set TTL to 2 minutes for testing
SCHEMA_CACHE_TTL_MS=120000
```

Then:
1. Restart your dev server
2. Send a chat message (schema loads)
3. Send another message immediately (should use cache)
4. Wait 2+ minutes
5. Send another message (should reload schema)

### 4. **Test Manual Cache Invalidation**

**Using Browser:**
1. Open browser DevTools (F12)
2. Go to Console tab
3. Run:
```javascript
fetch('/api/cache/invalidate', { method: 'POST', credentials: 'include' })
  .then(r => r.json())
  .then(console.log)
```

**Using curl:**
```bash
curl -X POST http://localhost:3000/api/cache/invalidate \
  -H "Cookie: attio_api_token=YOUR_TOKEN" \
  --cookie-jar cookies.txt \
  --cookie cookies.txt
```

After invalidation, the next chat message will reload the schema.

## Step-by-Step Test Procedure

### Test 1: Cache Hit (Immediate)
1. Connect to Attio (if not already connected)
2. Send a chat message: "Show me all companies"
3. **Check terminal**: Should see `📥 Loading CRM schema...`
4. Send another message immediately: "What contacts do I have?"
5. **Check terminal**: Should see `✅ Using cached CRM schema (expires in X minutes)`
6. **Result**: ✅ Cache is working if you see the "cached" message

### Test 2: Cache Expiration (Short TTL)
1. Add to `.env.local`: `SCHEMA_CACHE_TTL_MS=60000` (1 minute)
2. Restart dev server: `npm run dev`
3. Send a message (schema loads)
4. Wait 1 minute and 10 seconds
5. Send another message
6. **Check terminal**: Should see `📥 Loading CRM schema...` (not cached)
7. **Result**: ✅ TTL is working if schema reloads after expiration

### Test 3: Manual Invalidation
1. Send a message (ensures cache exists)
2. Check cache stats: Visit `http://localhost:3000/api/cache/invalidate`
3. Should show `"total": 1, "valid": 1`
4. Invalidate cache (use browser console method above)
5. Send another message
6. **Check terminal**: Should see `📥 Loading CRM schema...` (reloaded)
7. **Result**: ✅ Manual invalidation works

### Test 4: Multiple Users (Different Cache Keys)
1. Connect with one Attio account
2. Send a message (creates cache entry)
3. Check stats: Should show 1 entry
4. **Note**: Each unique API key gets its own cache entry
5. **Result**: ✅ Multiple users have separate caches

## Expected Behavior

### ✅ Working Correctly:
- First request: `📥 Loading CRM schema...`
- Immediate subsequent requests: `✅ Using cached CRM schema (expires in X minutes)`
- After TTL expires: `📥 Loading CRM schema...` (reloads)
- Cache stats show valid entries
- Manual invalidation clears cache

### ❌ Not Working:
- Every request shows `📥 Loading CRM schema...` (cache not storing)
- Cache stats always show `"total": 0` (cache not persisting)
- No expiration messages (TTL not checking)
- Manual invalidation doesn't clear cache

## Monitoring Cache in Real-Time

### Watch Terminal Logs:
```bash
# In your terminal running npm run dev, you'll see:
🚀 Processing message: Show me all companies
📥 Loading CRM schema...
✅ Final response: ...

🚀 Processing message: What contacts do I have?
✅ Using cached CRM schema (expires in 1439 minutes)
✅ Final response: ...
```

### Check Cache Stats Periodically:
```bash
# Every few minutes, check:
curl http://localhost:3000/api/cache/invalidate | jq
```

## Troubleshooting

### Cache Not Working?
1. **Check environment variable**: Make sure `.env.local` exists and has correct format
2. **Restart server**: Environment variables only load on startup
3. **Check console logs**: Look for any error messages
4. **Verify cache module**: Check `lib/schema-cache.js` exists

### TTL Not Expiring?
1. **Check TTL value**: Verify `SCHEMA_CACHE_TTL_MS` in `.env.local`
2. **Restart server**: TTL is read on startup
3. **Wait full duration**: TTL is in milliseconds, make sure you wait long enough
4. **Check system time**: Ensure your system clock is correct

### Manual Invalidation Not Working?
1. **Check authentication**: You must be logged in (have cookie)
2. **Check endpoint**: Verify `/api/cache/invalidate` is accessible
3. **Check browser console**: Look for errors in Network tab

## Performance Verification

### Cache Hit Performance:
- **First request**: ~500-2000ms (schema loading)
- **Cached request**: ~50-200ms (instant from cache)
- **Improvement**: 10-40x faster with cache

### Memory Usage:
- Each cached schema: ~50-500KB (depends on workspace size)
- Default TTL: 24 hours
- Cleanup: Runs every hour automatically

## Production Monitoring

For production, you might want to:
1. Add logging to track cache hit/miss rates
2. Monitor memory usage
3. Set appropriate TTL based on schema change frequency
4. Consider Redis for distributed caching (if multiple servers)

