# Architecture Refactoring - Migration Guide

## Overview

The codebase has been refactored to support multiple external tools/APIs while maintaining full backward compatibility with Attio. The architecture now uses an **adapter pattern** that separates tool-agnostic chatbot logic from tool-specific implementations.

## What Changed

### New Architecture

1. **Adapter Interface** (`lib/adapters/adapter-interface.js`)
   - Defines the contract all tool adapters must implement
   - Ensures consistent behavior across different tools

2. **Attio Adapter** (`lib/adapters/attio-adapter.js`)
   - Wraps all Attio-specific logic
   - Implements the adapter interface
   - Preserves all existing Attio functionality

3. **General Bot** (`lib/bots/general-bot.js`)
   - Tool-agnostic chatbot orchestrator
   - Handles conversation management, tool routing, error handling
   - Works with any adapter

4. **Adapter Registry** (`lib/adapters/adapter-registry.js`)
   - Manages available adapters
   - Provides adapter lookup by name or cookie

5. **Validation Utilities** (`lib/validation/tool-validation.js`)
   - Shared validation logic extracted from chat route
   - Works with any API schema format

### File Structure

```
lib/
├── adapters/
│   ├── adapter-interface.js      # Base adapter interface
│   ├── adapter-registry.js     # Adapter management
│   └── attio-adapter.js          # Attio-specific adapter
├── bots/
│   └── general-bot.js            # Tool-agnostic bot orchestrator
├── validation/
│   └── tool-validation.js        # Shared validation utilities
└── attio-system-prompt.js        # Attio system prompt builder

app/api/chat/
└── route.js                      # Refactored to use adapter pattern
```

## Backward Compatibility

✅ **All existing Attio functionality is preserved:**
- OAuth flow works exactly as before
- Schema loading unchanged
- API calls unchanged
- Data transformations unchanged
- Chatbot behavior unchanged

The refactoring is **purely architectural** - no functional changes to Attio support.

## How It Works

### Current Flow (Attio)

1. User sends message → `/api/chat`
2. Route detects `attio_api_token` cookie
3. Loads Attio adapter from registry
4. Creates GeneralBot with Attio adapter
5. GeneralBot processes message using adapter
6. Adapter handles all Attio-specific logic
7. Response returned to user

### Future Flow (Multiple Tools)

1. User sends message → `/api/chat`
2. Route detects tool cookie (e.g., `quickbooks_api_token`)
3. Loads appropriate adapter from registry
4. Creates GeneralBot with that adapter
5. GeneralBot processes message using adapter
6. Adapter handles tool-specific logic
7. Response returned to user

## Adding a New Tool

### Step 1: Create Adapter File

Create `lib/adapters/your-tool-adapter.js`:

```javascript
import { ToolAdapter } from './adapter-interface.js';

export class YourToolAdapter extends ToolAdapter {
  getName() {
    return 'your-tool';
  }

  getAuthType() {
    return 'api_key'; // or 'oauth', 'basic', etc.
  }

  getCookieName() {
    return 'your_tool_api_token';
  }

  getDefaultBaseUrl() {
    return process.env.YOUR_TOOL_API_BASE_URL || 'https://api.your-tool.com';
  }

  async loadSchema(apiKey, baseUrl) {
    // Load your tool's schema
    // Return schema object
  }

  schemaToContext(schema) {
    // Convert schema to context string for Claude
    // Return formatted string
  }

  getTools() {
    // Return tool definitions for Claude
    // Usually just the generic call_api tool
    return getAgentTools(); // From intelligent-agent.js
  }

  async executeTool(toolName, input, apiKey, baseUrl, apiConfigs = null) {
    // Execute tool calls
    // Use executeAgentTool from intelligent-agent.js
    return await executeAgentTool(toolName, input, apiKey, baseUrl, apiConfigs);
  }

  validateToolCall(toolInput, schema) {
    // Use generic validation or tool-specific validation
    return validateToolCall(toolInput, schema); // From tool-validation.js
  }

  getSystemPrompt(context) {
    // Build system prompt with tool-specific context
    // Can use generic prompt or tool-specific
    return `Your tool-specific system prompt...\n\n${context}`;
  }
}
```

### Step 2: Register Adapter

In `lib/adapters/adapter-registry.js`, add:

```javascript
import { YourToolAdapter } from './your-tool-adapter.js';

// Register default adapters
adapters.set('attio', AttioAdapter);
adapters.set('your-tool', YourToolAdapter); // Add this
```

### Step 3: Configure Environment

Add to `.env.local`:

```bash
YOUR_TOOL_API_BASE_URL=https://api.your-tool.com
YOUR_TOOL_API_KEY=your-api-key
```

### Step 4: Add OAuth Routes (if needed)

If your tool uses OAuth, create routes in `app/integrations/your-tool/`:
- `connect/route.js` - Initiate OAuth
- `callback/route.js` - Handle OAuth callback
- `status/route.js` - Check OAuth status

Then update your adapter's `getOAuthRoutes()` method to return the route paths.

## Configuration

### Environment Variables

**Required:**
- `ANTHROPIC_API_KEY` - Claude API key

**Attio (existing):**
- `ATTIO_CLIENT_ID` - Attio OAuth client ID
- `ATTIO_CLIENT_SECRET` - Attio OAuth client secret
- `CRM_API_BASE_URL` - Attio API base URL (default: https://api.attio.com)

**New Tools:**
- `YOUR_TOOL_API_BASE_URL` - Your tool's API base URL
- `YOUR_TOOL_API_KEY` - Your tool's API key (if not using OAuth)

**Optional:**
- `MAX_RECORDS_PER_OBJECT` - Max records to load per object (default: 500)
- `SCHEMA_CACHE_TTL_MS` - Schema cache TTL in milliseconds (default: 24 hours)

## Testing

### Verify Attio Still Works

1. **OAuth Flow:**
   - Go to app
   - Click "Connect to Attio"
   - Complete OAuth flow
   - Verify connection status shows "Attio Connected"

2. **Read Operations:**
   - Ask: "Show me all companies"
   - Verify response shows companies from Attio

3. **Write Operations:**
   - Ask: "Add John Doe from Acme Corp"
   - Verify person is created in Attio
   - Verify company link works

4. **Update Operations:**
   - Ask: "Update John Doe's email to john@example.com"
   - Verify update works in Attio

5. **Conversational Flow:**
   - Have a multi-turn conversation
   - Verify context is maintained
   - Verify natural language understanding works

### Test New Tool

1. Create adapter following steps above
2. Register adapter
3. Configure environment variables
4. Test OAuth (if applicable)
5. Test read/write operations
6. Verify chatbot behavior

## Key Design Decisions

### Why Adapter Pattern?

- **Separation of Concerns**: Tool-specific logic isolated from general bot logic
- **Extensibility**: Easy to add new tools without modifying core code
- **Testability**: Each adapter can be tested independently
- **Maintainability**: Changes to one tool don't affect others

### Why Keep Validation in Shared Module?

- **Consistency**: All tools use same validation logic
- **DRY**: Don't repeat validation code for each adapter
- **Flexibility**: Can still override in adapter if needed

### Why General Bot Orchestrator?

- **Single Responsibility**: Bot handles orchestration, adapters handle tool specifics
- **Reusability**: Same bot logic works with any adapter
- **Consistency**: All tools get same conversation management, error handling, etc.

## Migration Checklist

- [x] Create adapter interface
- [x] Create Attio adapter
- [x] Create general bot orchestrator
- [x] Create adapter registry
- [x] Extract validation utilities
- [x] Refactor chat route
- [x] Test Attio OAuth flow
- [x] Test Attio read operations
- [x] Test Attio write operations
- [x] Test conversational flow
- [ ] Add example adapter template
- [ ] Update documentation

## Future Enhancements

1. **Tool Discovery**: Automatically discover available tools from environment
2. **Multi-Tool Support**: Support multiple tools in single conversation
3. **Tool Routing**: Route requests to appropriate tool based on intent
4. **Tool Composition**: Chain multiple tools for complex operations
5. **Tool Marketplace**: Plugin system for third-party adapters

## Questions?

If you encounter any issues or have questions about the refactoring:
1. Check this guide first
2. Review the adapter interface for required methods
3. Look at Attio adapter as reference implementation
4. Check validation utilities for validation patterns

