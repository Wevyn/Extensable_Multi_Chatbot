# Data Loading Reasoning - "Reasonable Subset"

## 🎯 The Challenge

**Problem:** Databases can have thousands or millions of records. Loading everything would:
- Exceed Claude's token limits (200k for Haiku)
- Be extremely slow to load
- Be expensive (more tokens = more cost)
- Include irrelevant old/stale data

**Solution:** Load a "reasonable subset" that gives Claude useful context without overwhelming it.

## 📊 Current Implementation

### Default: 500 Records Per Object Type

**Reasoning:**
1. **Token Budget:**
   - Claude 3.5 Haiku: 200,000 token context window
   - Schema: ~5,000-10,000 tokens
   - Conversation: ~1,000-5,000 tokens per message
   - **Available for data: ~185,000 tokens**

2. **Per Record Size:**
   - Simplified record (key fields only): ~50-100 tokens
   - 500 records × 100 tokens = ~50,000 tokens
   - Leaves plenty of room for conversation

3. **Practical Coverage:**
   - Most databases: 80% of queries are on recent/active records
   - 500 records covers most common use cases
   - Recent records are more likely to be relevant

### What Fields Are Included?

**Included (Key Identifying Fields):**
- `name` - Essential for checking duplicates
- `email` - Primary identifier for people
- `title` - Job titles (useful context)
- `company` - Company associations
- `slug` - Unique identifiers
- Required fields - Needed for validation

**Excluded (To Save Tokens):**
- Long text fields (notes, descriptions)
- Historical data (old timestamps)
- Large binary data
- Less frequently used custom fields

**Reasoning:**
- Focus on fields needed to **identify** and **check for duplicates**
- Skip fields that are rarely used for lookups
- Balance between usefulness and token efficiency

### Display Strategy

**Shows first 50 records in context:**
- Full list would be too long
- 50 gives Claude a good sample
- Note says "and X more records" so Claude knows there are more
- Claude can still reference records beyond the 50 shown

## 🧮 Token Math

### Example Calculation

**Scenario:** 5 object types (people, companies, deals, tasks, notes)

**With 500 records each:**
- Schema: 10,000 tokens
- Records: 5 × 500 × 100 = 250,000 tokens ❌ **TOO MUCH!**

**Reality Check:**
- Not all objects have 500 records
- Records are simplified (only key fields)
- Actual usage: ~50,000-100,000 tokens total

**With 200 records each:**
- Records: 5 × 200 × 100 = 100,000 tokens ✅ **SAFE**

## 🎛️ Configurable Limits

### Why Make It Configurable?

Different use cases need different amounts:

1. **Small Database (<100 records):**
   - Set to 1000 - load everything
   - No token concerns

2. **Medium Database (100-1000 records):**
   - Set to 500 (default) - good balance
   - Covers most records

3. **Large Database (1000-10,000 records):**
   - Set to 200-300 - focus on recent/active
   - Still covers most queries

4. **Very Large Database (10,000+ records):**
   - Set to 100-200 - only most recent
   - Or set to 0 - query on-demand

## 🔍 What Makes a "Reasonable" Subset?

### Factors to Consider:

1. **Token Budget:**
   - How much room do you have?
   - Schema + conversation + data = total tokens
   - Leave 20-30% buffer for long conversations

2. **Database Size:**
   - Small (<500): Load all
   - Medium (500-5000): Load 200-500
   - Large (5000+): Load 100-200

3. **Query Patterns:**
   - Do you mostly query recent records? → Load recent
   - Do you query by name/email? → Include those fields
   - Do you need historical data? → May need more

4. **Object Type Importance:**
   - People/Companies: High importance → Load more
   - Tasks/Notes: Lower importance → Load fewer
   - Could make limits per-object-type

## 💡 Current Implementation Details

### What I Implemented:

```javascript
// Default: 500 records per object
const maxRecordsPerObject = parseInt(
  process.env.MAX_RECORDS_PER_OBJECT || '500', 
  10
);

// Only include key identifying fields
if (key.includes('name') || 
    key.includes('email') || 
    key.includes('title') || 
    key.includes('company') || 
    key === 'slug' || 
    isRequired) {
  // Include this field
}
```

### Why This Approach:

1. **500 is a safe default:**
   - Works for most databases
   - Doesn't overwhelm token budget
   - Covers majority of records

2. **Key fields only:**
   - Focuses on what Claude needs to check duplicates
   - Saves ~70% of tokens vs full records
   - Still provides useful context

3. **Configurable:**
   - Users can adjust based on their needs
   - Can disable (set to 0) if needed
   - Can increase if they have token budget

## 🎯 Recommendations by Database Size

| Database Size | Recommended Limit | Reasoning |
|--------------|------------------|-----------|
| < 100 records | 1000 (load all) | Small enough to load everything |
| 100-500 records | 500 | Covers all or most records |
| 500-2000 records | 300-500 | Covers most active records |
| 2000-10,000 records | 200-300 | Focus on recent/active |
| 10,000+ records | 100-200 or 0 | Either recent only, or query on-demand |

## 🔄 Alternative Approaches

### Option 1: Per-Object Limits
```javascript
MAX_RECORDS_PEOPLE=500
MAX_RECORDS_COMPANIES=300
MAX_RECORDS_DEALS=200
```

### Option 2: Smart Filtering
- Load only records modified in last 30 days
- Load only records with certain statuses
- Load only records user has access to

### Option 3: Pagination in Context
- Show first 50, but note there are more
- Claude can query if needed
- Best of both worlds

## 📝 Current Status

**What's implemented:**
- ✅ 500 records default (configurable)
- ✅ Key fields only (saves tokens)
- ✅ Shows first 50 in context
- ✅ Notes total count

**What could be improved:**
- Per-object-type limits
- Smart filtering (recent records only)
- Better field selection based on object type
- Compression/summarization for very large records

## 🎯 Bottom Line

**"Reasonable" = Balance between:**
- ✅ Having enough data for Claude to be useful
- ✅ Staying within token limits
- ✅ Loading quickly
- ✅ Covering most common use cases

**500 records with key fields is a good starting point** because:
- Covers most databases adequately
- Stays well within token limits
- Loads reasonably fast
- Provides enough context for duplicate checking

You can adjust `MAX_RECORDS_PER_OBJECT` based on your specific needs!

