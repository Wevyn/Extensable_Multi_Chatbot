# Database Records in Context

## ✅ Implementation Complete

The system now loads **actual database records** and includes them in Claude's context, not just the schema!

## 🎯 How It Works

### What Gets Loaded

1. **Schema** (structure) - as before
2. **Actual Records** - NEW! Up to 500 records per object type (configurable)

### What Records Are Included

For each object type (people, companies, deals, etc.):
- Loads up to 500 records (configurable via `MAX_RECORDS_PER_OBJECT`)
- Includes key identifying fields:
  - Names (first_name, last_name, company name)
  - Email addresses
  - Titles
  - Company associations
  - Required fields
- Excludes less important fields to save tokens

### How It's Presented to Claude

The records are shown in the system prompt like this:

```
### People (people)
...
Existing Records in Database (150 total):
  - name: John Smith, email: john@example.com, company: Acme Corp
  - name: Jane Doe, email: jane@example.com
  - name: Bob Johnson, email: bob@company.com, company: TechCorp
  ... and 147 more records

Note: You have access to ALL 150 people records. Use this information to check if records exist before creating duplicates.
```

## ⚙️ Configuration

### Environment Variable

Add to `.env.local`:

```bash
# Maximum records to load per object type (default: 500)
# Set to 0 to disable data loading (schema only)
MAX_RECORDS_PER_OBJECT=500
```

### Options

- **500** (default) - Good balance of data vs tokens
- **1000** - More records, more tokens
- **100** - Fewer records, fewer tokens
- **0** - Disable data loading (schema only)

## 📊 Token Usage

**Estimated token usage:**
- Schema only: ~5,000-10,000 tokens
- Schema + 500 records/object: ~15,000-30,000 tokens (depends on data)
- Schema + 1000 records/object: ~30,000-60,000 tokens

**Recommendations:**
- Start with 500 records
- If you hit token limits, reduce to 100-200
- If you have small databases (<100 records), use 1000

## 🎯 Benefits

1. **No Queries Needed**: Claude can check if records exist instantly
2. **Prevents Duplicates**: Claude sees existing records before creating
3. **Better Context**: Claude understands what's already in the database
4. **Faster Responses**: No need to query before every operation

## 🔄 Caching

- Records are cached with the schema (24-hour TTL by default)
- Cache is refreshed when schema cache expires
- To force refresh: Use `/api/cache/invalidate` endpoint

## ⚠️ Considerations

### Large Databases

If you have 10,000+ records:
- Consider reducing `MAX_RECORDS_PER_OBJECT` to 200-300
- Or use 0 to disable (Claude will query when needed)
- Records are sorted by most recent (if API supports it)

### Token Limits

- Claude 3.5 Haiku: 200,000 token context window
- With 500 records/object × 5 objects = ~25,000 tokens
- Still plenty of room for conversation

### Data Freshness

- Records are loaded when schema is loaded/cached
- Cache TTL: 24 hours (configurable)
- For real-time data, reduce cache TTL or disable caching

## 🚀 Usage

Just use the app normally! The database records are automatically included in Claude's context.

**Example:**
```
User: "Add Sara from Delta Air Lines"
Bot: [Checks companies list in context]
  → "I see Delta Air Lines in the database. What's Sara's email?"
```

No queries needed - Claude already knows!

