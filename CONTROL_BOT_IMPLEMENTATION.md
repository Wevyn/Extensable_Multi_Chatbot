# Control Bot Implementation

## Overview

The Control Bot is an intelligent orchestrator that sits above the General Bot and analyzes user queries to determine:
1. **Which tools/databases are needed** - Only routes to relevant tools
2. **Execution strategy** - Parallel (independent operations) vs Hierarchical (dependent operations)

## Architecture

```
User Query
    ↓
Control Bot (analyzes intent)
    ↓
[Filters adapters to only needed ones]
    ↓
General Bot (with filtered adapters)
    ↓
Tool Adapters (Attio, Google Calendar, etc.)
```

## Key Features

### 1. Intelligent Query Analysis

The Control Bot uses Claude to analyze user queries and determine:
- Which tools are needed (e.g., "show companies" → only needs Attio)
- Execution strategy (parallel vs hierarchical)
- Execution plan with steps

**Example Analysis:**
```json
{
  "tools": ["attio"],
  "strategy": "parallel",
  "reasoning": "Simple read operation, only needs CRM",
  "steps": []
}
```

**Hierarchical Example:**
```json
{
  "tools": ["attio", "google_calendar"],
  "strategy": "hierarchical",
  "reasoning": "Need email from CRM first, then schedule meeting",
  "steps": [
    {"tool": "attio", "action": "read", "what": "person's email"},
    {"tool": "google_calendar", "action": "write", "what": "create event", "dependsOn": "email"}
  ]
}
```

### 2. Tool Filtering

The Control Bot filters adapters and credentials to only those needed:
- If query mentions "companies" → only loads Attio adapter
- If query mentions "meetings" → only loads Google Calendar adapter
- If query mentions both → loads both but uses appropriate strategy

### 3. Strategy-Aware Execution

#### Parallel Strategy
- Independent operations that can run simultaneously
- Example: "Show me all companies and all upcoming meetings"
- All tool calls execute in parallel using `Promise.all()`

#### Hierarchical Strategy
- Dependent operations that must run sequentially
- Example: "Get John's email from CRM, then schedule a meeting"
- Tool calls execute one at a time, with each step using output from previous steps

### 4. Enhanced System Prompt

The Control Bot builds a strategy-aware system prompt that:
- Lists only the tools that are needed
- Provides execution guidance (parallel vs sequential)
- Includes execution plan for hierarchical tasks
- Emphasizes using only needed tools

## Implementation Details

### Query Analysis

The Control Bot uses Claude to analyze queries:

```javascript
async function analyzeQueryWithClaude(message, availableAdapters, claudeApiKey) {
  // Sends query to Claude with:
  // - Available tools and their descriptions
  // - User query
  // - Instructions to determine tools needed and strategy
  
  // Returns:
  // - tools: array of tool names needed
  // - strategy: "parallel" or "hierarchical"
  // - reasoning: explanation
  // - steps: execution plan (for hierarchical)
}
```

**Fallback:** If Claude analysis fails, uses keyword-based detection:
- "crm", "contact", "company" → Attio
- "calendar", "meeting", "event" → Google Calendar
- "invoice", "payment" → QuickBooks
- etc.

### Tool Execution

The Control Bot overrides tool execution to implement strategy:

```javascript
async executeToolCallsWithStrategy(toolCalls, bot, credentials, toolSchemas, analysis) {
  if (analysis.strategy === 'parallel') {
    // Execute all in parallel
    return await Promise.all(
      toolCalls.map(block => this.executeToolCall(block, bot, credentials, toolSchemas))
    );
  } else {
    // Execute sequentially (hierarchical)
    const results = [];
    for (const block of toolCalls) {
      const result = await this.executeToolCall(block, bot, credentials, toolSchemas);
      results.push(result);
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between steps
    }
    return results;
  }
}
```

## Usage Examples

### Example 1: Simple Query (Single Tool)
**User:** "Show me all companies"

**Control Bot Analysis:**
- Tools: `["attio"]`
- Strategy: `"parallel"`
- Action: Only loads Attio adapter, executes query

### Example 2: Parallel Query (Multiple Tools, Independent)
**User:** "Show me all companies and all upcoming meetings"

**Control Bot Analysis:**
- Tools: `["attio", "google_calendar"]`
- Strategy: `"parallel"`
- Action: Loads both adapters, executes both queries simultaneously

### Example 3: Hierarchical Query (Dependent Operations)
**User:** "Get John's email from CRM, then schedule a meeting with him"

**Control Bot Analysis:**
- Tools: `["attio", "google_calendar"]`
- Strategy: `"hierarchical"`
- Steps:
  1. Get email from Attio
  2. Use email to create calendar event
- Action: Executes step 1, waits for result, then executes step 2 with email

## Integration

The Control Bot is integrated into the chat route:

```javascript
// app/api/chat/route.js
const controlBot = new ControlBot(generalBot, activeAdapters, claudeApiKey);
const result = await controlBot.processMessage(
  message,
  previousMessages,
  adapterCredentials,
  userId,
  configuredAPIs
);
```

## Benefits

1. **Performance**: Only loads and queries needed tools
2. **Efficiency**: Parallel execution for independent operations
3. **Correctness**: Sequential execution for dependent operations
4. **Intelligence**: Uses Claude to understand user intent
5. **Extensibility**: Works with any number of tools

## Future Enhancements

1. **Caching Analysis**: Cache query analysis results for similar queries
2. **Learning**: Learn from user corrections to improve analysis
3. **Confidence Scores**: Provide confidence scores for tool selection
4. **Multi-step Planning**: Better planning for complex multi-step tasks
5. **Tool Recommendations**: Suggest tools when query is ambiguous

