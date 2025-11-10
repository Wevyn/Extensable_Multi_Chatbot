# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **Extensible**, a conversational AI CRM assistant built with Next.js 15. It uses Claude AI (Anthropic) with a schema-driven approach to provide intelligent CRM automation through natural language. Unlike traditional CRM integrations, this system loads the entire workspace schema into Claude's context, enabling it to understand and operate on any CRM structure without hardcoded tools.

## Key Technologies

- **Next.js 15.4.6** (App Router with Turbopack)
- **React 19.1.0**
- **TypeScript 5** (with `allowJs` for mixed JS/TS codebase)
- **Tailwind CSS 4**
- **Web Speech API** (browser-native voice recognition)
- **Attio CRM API** (v2)
- **Claude AI** (claude-3-5-haiku-20241022 via Anthropic SDK)
- **OAuth 2.0** (for Attio workspace authentication)

## Development Commands

```bash
# Start development server with Turbopack
npm run dev

# Production build
npm run build

# Start production server
npm start

# Run linting
npm run lint
```

Development server runs on: `http://localhost:3000`

## Architecture Overview

### 1. Schema-Driven Intelligence

The core innovation is **schema introspection**. Instead of predefined CRM tools, the system:

1. **Loads entire workspace schema** on first request (cached per API key)
2. **Injects schema into Claude's context** as system prompt
3. **Provides one generic tool** (`call_api`) for all CRM operations
4. **Claude learns the API structure** from context and makes intelligent decisions

This approach makes the system work with ANY CRM structure without code changes.

### 2. Data Flow

```
User Input (Text/Voice) → ChatInterface → /api/chat →
  ┌─ Load/Cache CRM Schema
  ├─ Build System Prompt with Full Schema
  ├─ Claude Haiku (with call_api tool)
  └─ Agentic Loop (tool calls → responses)
→ Response to User
```

### 3. Core Components

#### Frontend Layer (`/app` and `/components`)

- **[app/page.tsx](app/page.tsx)**: Entry point, renders `AuthWrapper`
- **[components/AuthWrapper.jsx](components/AuthWrapper.jsx)** (~277 lines):
  - Manages OAuth authentication flow with popup-based auth
  - Token storage in `localStorage` (key: `attio_api_token`)
  - Connection status UI and settings modal
  - Renders `ChatInterface` when authenticated
  - Polling timeout (2 minutes) to prevent infinite loops

- **[components/ChatInterface.jsx](components/ChatInterface.jsx)** (~349 lines):
  - Dark-themed chat UI with message history
  - Web Speech API integration for voice-to-text (Chrome/Edge/Safari only)
  - Auto-restart speech recognition with continuous mode
  - Text input with auto-resize textarea
  - Sends messages to `/api/chat` endpoint

#### Backend Layer (`/app/api`)

- **[app/api/chat/route.js](app/api/chat/route.js)** (~247 lines):
  - Main orchestration endpoint (POST)
  - Rate limiting: 5 seconds minimum between requests per user
  - Schema caching: Loads workspace schema once per API key
  - Agentic loop: Handles tool calls (max 10 iterations)
  - Uses Claude 3.5 Haiku for cost efficiency
  - Runtime: Node.js, maxDuration: 60 seconds

#### OAuth Integration (`/app/integrations/attio`)

- **[app/integrations/attio/connect/route.js](app/integrations/attio/connect/route.js)**:
  - Initiates OAuth flow with Attio
  - Generates authorization URL with state token
  - Returns redirect to Attio's authorization page

- **[app/integrations/attio/callback/route.js](app/integrations/attio/callback/route.js)**:
  - Handles OAuth callback with authorization code
  - Exchanges code for access token
  - Returns HTML page with `postMessage` to parent window
  - Includes session storage for polling fallback

- **[app/integrations/attio/status/route.js](app/integrations/attio/status/route.js)**:
  - Polling endpoint for OAuth completion
  - Fallback mechanism if `postMessage` fails
  - Returns token from server-side session

#### CRM Intelligence Layer (`/lib`)

**Active Files:**
- **[lib/crm-schema-loader.js](lib/crm-schema-loader.js)** (~223 lines):
  - `loadCRMSchema()`: Discovers ALL workspace endpoints and objects
  - Explores common API patterns: `/v2/objects`, `/v2/lists`, `/v2/tasks`, etc.
  - Fetches attributes for each object with field types and constraints
  - Returns complete schema with objects, lists, endpoints
  - `schemaToContext()`: Converts schema to system prompt text

- **[lib/intelligent-agent.js](lib/intelligent-agent.js)** (~112 lines):
  - `getAgentTools()`: Returns single `call_api` tool definition
  - `executeAgentTool()`: Executes generic API calls
  - `callAPI()`: Makes HTTP requests (GET, POST, PUT, PATCH, DELETE)
  - Supports query parameters and request bodies
  - Returns structured responses with error handling

**Legacy Files (Not Used in Current Flow):**
- [lib/attio-tools.js](lib/attio-tools.js) - Old predefined tool approach
- [lib/dynamic-api-tools.js](lib/dynamic-api-tools.js) - Meta-tools pattern
- [lib/openapi-tool-generator.js](lib/openapi-tool-generator.js) - OpenAPI spec to tools
- [lib/workspace-introspection.js](lib/workspace-introspection.js) - Class-based introspection
- [lib/attio_openapi.json](lib/attio_openapi.json) - Full OpenAPI spec (2MB, unused)
- [lib/attio_openapi_minimal.json](lib/attio_openapi_minimal.json) - Minimal spec (1.9MB, unused)
- [lib/attio_cleaned_no_country_code.json](lib/attio_cleaned_no_country_code.json) - Schema definitions (97KB, reference only)

### 4. Critical Implementation Details

#### Schema-Driven System Prompt

The system prompt is built dynamically from workspace schema ([app/api/chat/route.js:196-210](app/api/chat/route.js#L196-L210)):

```javascript
function buildSystemPrompt(crmContext) {
  return `You are a CRM assistant with FULL KNOWLEDGE of the connected CRM system.

${crmContext}  // Contains all objects, attributes, endpoints

Your job: Execute user requests using the schema above.
Instructions:
1. Use exact attribute slugs and endpoints documented above
2. All attribute values must be arrays (e.g., {name: [{first_name: "John"}]})
3. For queries, use POST to query endpoint with filters
4. Be direct and efficient - you have complete knowledge`;
}
```

#### Generic API Tool

Single tool definition provides maximum flexibility ([lib/intelligent-agent.js:12-42](lib/intelligent-agent.js#L12-L42)):

```javascript
{
  name: 'call_api',
  description: 'Make any HTTP request to the CRM API...',
  parameters: {
    method: { enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
    path: { type: 'string' },  // e.g., /v2/objects/companies/records
    body: { type: 'object' },
    query: { type: 'object' }
  }
}
```

#### Agentic Loop

The chat endpoint implements tool use iteration ([app/api/chat/route.js:103-171](app/api/chat/route.js#L103-L171)):

1. Call Claude with user message and tools
2. If `stop_reason === 'tool_use'`:
   - Execute each tool call
   - Add tool results to conversation history
   - Call Claude again with updated history
3. Repeat up to 10 iterations
4. Extract final text response

#### Web Speech API Integration

Voice recognition in ChatInterface ([components/ChatInterface.jsx:28-83](components/ChatInterface.jsx#L28-L83)):

- Continuous mode with interim results
- Auto-restart on `onend` event
- Graceful error handling for `no-speech`
- Real-time transcript updates
- Browser compatibility check (Chrome/Edge/Safari only)

### 5. Environment Variables

Required in `.env.local`:

```bash
# Application URLs
APP_BASE_URL=http://localhost:3000
FRONTEND_ORIGIN=http://localhost:3000

# CRM API
CRM_API_BASE_URL=https://api.attio.com

# OAuth Credentials
ATTIO_CLIENT_ID=<your_oauth_app_client_id>
ATTIO_CLIENT_SECRET=<your_oauth_app_client_secret>

# AI Provider
ANTHROPIC_API_KEY=<your_claude_api_key>
```

**Security Note**: Current implementation stores these in `.env.local` - ensure this file is in `.gitignore`.

### 6. Configuration Files

**TypeScript**: [tsconfig.json](tsconfig.json)
- Targets ES2017 with module resolution bundler
- `allowJs: true` for mixed JS/TS codebase
- Path alias: `@/*` maps to root directory

**Tailwind**: [tailwind.config.ts](tailwind.config.ts)
- Content paths: `./pages/**/*.{ts,tsx}`, `./components/**/*.{ts,tsx}`, `./app/**/*.{ts,tsx}`
- Uses Tailwind v4 with PostCSS plugin

**Next.js**: [next.config.ts](next.config.ts)
- Currently empty (default Next.js 15 configuration)

### 7. Authentication Flow

OAuth popup-based flow:

1. User clicks "Connect to Attio" in settings modal
2. `AuthWrapper` opens popup to `/integrations/attio/connect`
3. Connect route redirects to Attio authorization page
4. User authorizes workspace access
5. Attio redirects to `/integrations/attio/callback` with code
6. Callback exchanges code for access token
7. Callback returns HTML with `postMessage` to parent window
8. Parent window receives token via message listener
9. Validates token with GET `/v2/objects` request
10. Stores token in `localStorage` as `attio_api_token`
11. Renders `ChatInterface` with authenticated state

**Fallback**: Polling `/integrations/attio/status` every 1 second if `postMessage` fails

### 8. Data Flow Example

User: "Add John Smith from Acme Corp as a new contact"

1. **ChatInterface** sends message to `/api/chat` with `attioApiKey`
2. **Chat route** loads/retrieves cached schema for workspace
3. **System prompt** includes all objects and attributes from schema
4. **Claude** receives context: knows "companies" object has `name` attribute, "people" object has `first_name`, `last_name`, etc.
5. **Claude** makes tool calls:
   ```javascript
   call_api({
     method: "POST",
     path: "/v2/objects/companies/records",
     body: { values: { name: [{ value: "Acme Corp" }] } }
   })

   call_api({
     method: "POST",
     path: "/v2/objects/people/records",
     body: {
       values: {
         first_name: [{ value: "John" }],
         last_name: [{ value: "Smith" }],
         company: [{ referenced_actor_id: "<company_id>" }]
       }
     }
   })
   ```
6. **Tool executor** makes HTTP requests to Attio API
7. **Claude** receives results and responds to user: "✅ Added John Smith from Acme Corp"

## Important Patterns & Conventions

### Schema Loading Strategy

- Schema loading happens **on first request** per API key
- Results are cached in Map with API key prefix (first 20 chars)
- Cache lives for lifetime of server process
- Schema includes: objects, lists, tasks, notes, all discovered endpoints

### Adding Support for New CRM Systems

The architecture is CRM-agnostic. To support a different CRM:

1. Update `CRM_API_BASE_URL` environment variable
2. Modify `crm-schema-loader.js` to discover CRM's schema endpoints
3. Update `schemaToContext()` to format schema appropriately
4. No changes needed to `intelligent-agent.js` or `/api/chat`

### Error Handling

- **Rate limiting**: Returns 429 with wait time
- **Missing API key**: Returns 401 with instructions
- **Tool execution failures**: Returns error in tool result, Claude adapts
- **Schema loading failures**: Returns error object, agent can explore dynamically

### OAuth Token Management

- **Storage**: `localStorage` (client-side only)
- **Validation**: GET `/v2/objects` before accepting token
- **Revocation**: Remove from localStorage via "Disconnect" button
- **Scope**: Depends on Attio OAuth app configuration

## Testing the Application

1. Start dev server: `npm run dev`
2. Open browser: `http://localhost:3000`
3. Click "Connect to Attio" button in Settings modal
4. Authorize workspace in popup (should auto-close after 1 second)
5. Wait for "Connected to Attio" status (if it times out after 2 minutes, try again)
6. Type or speak CRM commands
7. Examples:
   - "Show me all companies"
   - "Create a new contact named Sarah Johnson"
   - "Add a task to follow up with John next week"
   - "Update Acme Corp's industry to Technology"

## Known Limitations

- **No test suite** - No Jest/Vitest configuration
- **Client-side token storage** - `localStorage` is not secure for sensitive tokens
- **No retry logic** - Failed API calls are not automatically retried
- **Schema cache lifetime** - Cache persists until server restart (no TTL)
- **Browser compatibility** - Voice input only works in Chrome/Edge/Safari
- **Rate limiting simplicity** - Uses in-memory Map (resets on server restart)
- **No conversation persistence** - Chat history lost on page refresh
- **Single workspace per token** - No multi-workspace support
- **OAuth timing sensitivity** - Popup must stay open for 1 second to allow postMessage delivery

## Troubleshooting

### OAuth "Keeps Polling" or Times Out
**Symptoms**: You see repeated `GET /integrations/attio/status 200` in terminal, connection eventually times out after 2 minutes.

**Cause**: Race condition where popup closes before parent receives postMessage.

**Solutions**:
1. **Ensure popup blockers are disabled** - Browser must allow the OAuth popup
2. **Check browser console** - Look for postMessage errors or CORS issues
3. **Verify environment variables** - `FRONTEND_ORIGIN` must match your actual origin
4. **Try incognito mode** - Browser extensions can interfere with postMessage
5. **Manual fallback**: If postMessage consistently fails, the polling will eventually succeed (within 2 minutes)

**Recent Fix**: Added 1-second delay before popup auto-closes to give postMessage time to deliver. Added 2-minute timeout to prevent infinite polling.

### Rate Limiting Errors
**Symptoms**: "Please wait X seconds before sending another message"

**Solution**: Wait the specified time. This is intentional to prevent hitting Attio's rate limits.

### Schema Loading Failures
**Symptoms**: Error messages about missing schema or objects

**Solution**: Disconnect and reconnect to Attio. This will reload the workspace schema.

### Voice Input Not Working
**Symptoms**: Microphone button doesn't respond or shows compatibility warning

**Solution**:
- Use Chrome, Edge, or Safari (Firefox doesn't support Web Speech API)
- Grant microphone permissions when prompted
- Check browser console for specific errors
- Use text input as fallback

## Architecture Evolution

This codebase has evolved through multiple approaches:

1. **Original** ([ConversationalAI_CRM_General_Beta/](ConversationalAI_CRM_General_Beta/)): React with Groq AI, Attio-specific tools
2. **Tool-based** ([lib/attio-tools.js](lib/attio-tools.js)): Predefined CRM tools (query, create, update)
3. **OpenAPI-driven** ([lib/openapi-tool-generator.js](lib/openapi-tool-generator.js)): Generated tools from spec
4. **Current** ([lib/intelligent-agent.js](lib/intelligent-agent.js) + [lib/crm-schema-loader.js](lib/crm-schema-loader.js)): Schema-driven with generic tool

The current approach balances flexibility (works with any CRM) and efficiency (single tool, schema in context).

## File Path Aliases

The project uses `@/*` alias mapping to root directory via [tsconfig.json](tsconfig.json):

```typescript
"paths": {
  "@/*": ["./*"]
}
```

## Next.js App Router Structure

- All routes use App Router (no Pages directory)
- Server Components by default
- `"use client"` directive required for:
  - Browser APIs (Speech API, localStorage)
  - React hooks (useState, useEffect)
  - Event handlers
- API routes are Route Handlers: `route.js` files with named HTTP exports (GET, POST)
