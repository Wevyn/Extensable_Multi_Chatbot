# Learning & Adaptation System

## Overview

The system now includes an adaptive learning layer that allows bots to learn from successful and failed operations, improving performance over time.

## How It Works

### 1. Pattern Learning (`lib/learning/pattern-learner.js`)

Tracks and learns from operations:

**What It Learns:**
- ✅ Successful query patterns (what works)
- ❌ Failed query patterns (what to avoid)
- 👤 User-specific context:
  - Frequently accessed companies
  - Frequently accessed people/contacts
  - Common operation types
  - Preferred query formats

**Storage:**
- In-memory learning store (per user)
- Could be persisted to database for production

### 2. Adaptive Adapter Wrapper (`lib/learning/adaptive-adapter.js`)

Wraps adapters with learning capabilities:

**Features:**
- **Pattern Avoidance**: Checks if a pattern previously failed and suggests alternatives
- **Format Suggestions**: Uses learned successful patterns for similar operations
- **Enhanced Prompts**: Adds learned user context to system prompts

**Example:**
```javascript
// Before learning
adapter.executeTool(...) // Uses default format

// After learning
adapter.executeTool(...) // Uses learned successful format
```

### 3. Integration Points

**Route Level** (`app/api/chat/route.js`):
- Wraps adapters with `makeAdaptive()` before use
- Each adapter learns from its operations

**API Level** (`lib/intelligent-agent.js`):
- Tracks successful/failed API calls
- Learns operation types (query_company, create_person, etc.)
- Extracts user context from results

## What Gets Learned

### Operation Patterns

**Company Operations:**
- `query_company` - Successful company search patterns
- `create_company` - Successful company creation formats

**Person Operations:**
- `query_person` - Successful person search patterns
- `create_person` - Successful person creation formats

**Other Operations:**
- `deal_operation` - Deal-related operations
- `note_operation` - Note operations
- `task_operation` - Task operations

### User Context

**Frequently Accessed Companies:**
- Tracks which companies the user queries/creates most
- Example: "Tesla (accessed 15 times)", "Apple (accessed 8 times)"

**Frequently Accessed People:**
- Tracks which contacts the user accesses most
- Example: "John Doe (accessed 12 times)"

**Common Operations:**
- Tracks most frequent operation types
- Example: "query_company (45 times)", "create_person (12 times)"

## How Learning Improves Performance

### 1. Pattern Reuse

When a similar operation is requested:
1. System checks learned successful patterns
2. Suggests using the learned format
3. Avoids previously failed patterns

**Example:**
```
User: "Find Apple company"
System: Checks learned patterns
  - Found: Successful pattern for query_company
  - Uses: Learned format that worked before
  - Result: Faster, more reliable query
```

### 2. Enhanced Context

System prompts include learned user context:

```
## 📚 Your Usage Patterns (Learned from past interactions):

## Your Frequently Accessed Companies:
- Tesla (accessed 15 times)
- Apple (accessed 8 times)
- PayPal (accessed 5 times)

## Your Frequently Accessed Contacts:
- John Doe (accessed 12 times)
- Jane Smith (accessed 7 times)

## Your Common Operations:
- query_company (45 times)
- create_person (12 times)
```

This helps Claude:
- Understand user preferences
- Prioritize frequently accessed data
- Use familiar patterns

### 3. Error Prevention

**Before Learning:**
```
User: "Find Apple"
System: Tries format A → Error 400
System: Tries format B → Error 400
System: Tries format C → Success
```

**After Learning:**
```
User: "Find Apple"
System: Checks learned patterns
System: Uses format C (learned from previous success)
System: Success (first try!)
```

## Learning Data Structure

```javascript
{
  userId: {
    successfulQueries: {
      'query_company': [
        {
          pattern: { path: '/v2/objects/companies/records/query', filter: {...} },
          result: {...},
          count: 5,
          timestamp: 1234567890
        }
      ],
      'create_person': [...]
    },
    failedQueries: {
      'query_company': [
        {
          pattern: { path: '...', filter: {...} },
          error: 'Invalid text value',
          timestamp: 1234567890
        }
      ]
    },
    userContext: {
      commonCompanies: Map('Apple' => 8, 'Tesla' => 15),
      commonPeople: Map('John Doe' => 12),
      commonOperations: [
        { type: 'query_company', timestamp: ... },
        { type: 'create_person', timestamp: ... }
      ]
    },
    queryFormats: {
      'query_company': { /* learned format */ }
    }
  }
}
```

## Usage Examples

### Example 1: Learning Company Query Format

**First Attempt:**
```
User: "Find Apple"
System: Tries { "name": ["Apple"] } → Error 400
System: Tries { "name": "Apple" } → Error 400
System: Tries correct format → Success
System: ✅ Learned successful pattern
```

**Second Attempt:**
```
User: "Find Tesla"
System: Checks learned patterns
System: Uses learned successful format
System: Success (first try!)
```

### Example 2: Learning User Preferences

**After Multiple Interactions:**
```
User: "Show me companies"
System: Enhanced prompt includes:
  - "Your frequently accessed: Tesla, Apple, PayPal"
  - Claude prioritizes these companies
  - More relevant results
```

### Example 3: Avoiding Failed Patterns

**After Learning:**
```
User: "Find company"
System: Checks failed patterns
System: Avoids { "name": ["Company"] } (learned to fail)
System: Uses learned successful format
System: Success
```

## Benefits

1. **Faster Responses**: Uses learned patterns instead of trial-and-error
2. **Better Accuracy**: Avoids previously failed patterns
3. **Personalization**: Adapts to user's specific usage patterns
4. **Reduced Errors**: Learns from mistakes and avoids repeating them
5. **Improved Context**: System prompts include user-specific information

## Future Enhancements

1. **Persistence**: Store learning data in database for persistence
2. **Cross-User Learning**: Learn general patterns across all users
3. **Temporal Learning**: Adapt based on time of day, day of week
4. **Advanced Pattern Matching**: Use ML for pattern recognition
5. **User Feedback**: Allow users to correct/improve learned patterns

## Configuration

Learning is automatically enabled for all adapters. No configuration needed!

The system learns passively in the background and improves over time.

