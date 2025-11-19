# Frontend-Backend Architecture Overview

## Executive Summary

This document provides a comprehensive overview of how the frontend components are wired to backend functions in the Extensable Multi-Chatbot application. The architecture follows a **Next.js App Router** pattern with **API Routes** for backend logic and **React Client Components** for the frontend.

---

## Frontend Structure

### Main Components

#### 1. **`app/page.tsx`** (Entry Point)
- **Type**: Server Component (Next.js)
- **Purpose**: Root page that renders the main App component
- **Flow**: `page.tsx` → `components/App.tsx`

#### 2. **`components/App.tsx`** (Main UI Component)
- **Type**: Client Component (`"use client"`)
- **Purpose**: Primary chat interface with OAuth integration management
- **Key Features**:
  - Chat message display and input
  - OAuth connection management (Attio, Google Calendar)
  - Settings panel with integration controls
  - Starfield background animation

**Key State Management**:
```typescript
- messages: Message[] - Chat message history
- connections: Record<string, { connected: boolean }> - Integration status
- isConnecting: boolean - OAuth flow state
- settingsOpen: boolean - Settings panel visibility
```

**Backend Connections**:
- `GET /api/auth/status` - Check authentication status
- `POST /api/chat` - Send messages to Claude AI
- `POST /api/auth/logout` - Disconnect integrations
- `GET /integrations/{tool}/connect` - Initiate OAuth flow
- `GET /integrations/{tool}/status` - Poll OAuth status

#### 3. **`components/AuthWrapper.jsx`** (Alternative Wrapper)
- **Type**: Client Component
- **Purpose**: Wraps ChatInterface and handles OAuth flows
- **Key Difference**: More comprehensive OAuth handling with modal UI
- **Renders**: `ChatInterface` component when authenticated

#### 4. **`components/ChatInterface.jsx`** (Chat Component)
- **Type**: Client Component
- **Purpose**: Focused chat UI with voice input support
- **Features**:
  - Speech recognition (Web Speech API)
  - Message history display
  - Loading states during processing

**Backend Connection**:
- `POST /api/chat` - Main chat endpoint

---

## Backend API Routes

### Authentication & OAuth

#### **`/api/auth/status`** (`app/api/auth/status/route.js`)
- **Method**: `GET`
- **Purpose**: Check authentication status for all registered adapters
- **Returns**: 
  ```json
  {
    "authenticated": boolean,
    "adapters": {
      "attio": { "connected": boolean, "cookieName": string },
      "google_calendar": { "connected": boolean, "cookieName": string }
    }
  }
  ```
- **Implementation**:
  - Reads httpOnly cookies for each adapter
  - Uses `getAllAdapters()` from adapter registry
  - Checks cookie existence to determine connection status

#### **`/api/auth/logout`** (`app/api/auth/logout/route.js`)
- **Method**: `POST`
- **Purpose**: Disconnect from one or all integrations
- **Body**: `{ "tool": "attio" }` (optional - if omitted, disconnects all)
- **Implementation**:
  - Deletes httpOnly cookies for specified adapter(s)
  - Uses adapter registry to find adapter by name

### Chat Processing

#### **`/api/chat`** (`app/api/chat/route.js`)
- **Method**: `POST`
- **Purpose**: Process user messages through Claude AI with multi-tool support
- **Body**:
  ```json
  {
    "message": "string",
    "conversationHistory": [
      { "role": "user" | "assistant", "content": "string" }
    ]
  }
  ```
- **Returns**:
  ```json
  {
    "success": true,
    "response": "string",
    "iterations": number
  }
  ```

**Processing Flow**:
1. **Extract Message**: Reads `message` and `conversationHistory` from request
2. **Detect Adapters**: 
   - Calls `getAllAdapters()` from adapter registry
   - Checks httpOnly cookies for each adapter's token
   - Creates `activeAdapters` array with authenticated adapters
3. **Create Adapter Credentials Map**:
   ```javascript
   adapterCredentials = Map<adapterName, { apiKey, baseUrl }>
   ```
4. **Get Claude API Key**: Uses `getCurrentKey()` from key rotator
5. **Create Bots**:
   - `GeneralBot`: Tool-agnostic orchestrator with all active adapters
   - `ControlBot`: Intelligent routing and task orchestration
6. **Rate Limiting**: Checks rate limits per user
7. **Process Message**: 
   - `controlBot.processMessage()` handles intelligent routing
   - Supports multi-tool operations (parallel or hierarchical)
8. **Return Response**: Claude's response with iteration count

### OAuth Integration Routes

#### **Attio OAuth Flow**

**`/integrations/attio/connect`** (`app/integrations/attio/connect/route.js`)
- **Method**: `GET`
- **Purpose**: Initiate Attio OAuth flow
- **Flow**:
  1. Generates random `state` token
  2. Stores state in httpOnly cookie (`attio_oauth_state`)
  3. Redirects to `https://app.attio.com/authorize` with OAuth params

**`/integrations/attio/callback`** (`app/integrations/attio/callback/route.js`)
- **Method**: `GET`
- **Purpose**: Handle OAuth callback from Attio
- **Flow**:
  1. Validates `state` parameter against cookie
  2. Exchanges `code` for `access_token` via Attio API
  3. Stores token in httpOnly cookie (`attio_api_token`)
  4. Sets temporary cookie (`attio_token_once`) for polling
  5. Returns HTML page that sends `postMessage` to parent window
  6. Closes popup window

**`/integrations/attio/status`** (`app/integrations/attio/status/route.js`)
- **Method**: `GET`
- **Purpose**: Poll OAuth status during connection
- **Returns**: `{ "access_token": "string" | null }`
- **Note**: Token is deleted after first read (one-time use)

#### **Google Calendar OAuth Flow**

Similar structure to Attio:
- `/integrations/google-calendar/connect` - Initiate OAuth
- `/integrations/google-calendar/callback` - Handle callback
- `/integrations/google-calendar/status` - Poll status

---

## Frontend-Backend Data Flow

### 1. **Initial Load & Authentication Check**

```
User opens app
    ↓
App.tsx mounts
    ↓
useEffect → checkAuthStatus()
    ↓
GET /api/auth/status
    ↓
Backend reads httpOnly cookies for all adapters
    ↓
Returns connection status
    ↓
Frontend updates connections state
    ↓
UI reflects connection status
```

### 2. **OAuth Connection Flow**

```
User clicks "Connect to Attio"
    ↓
startOAuth('attio')
    ↓
Opens popup: GET /integrations/attio/connect
    ↓
Backend redirects to Attio OAuth page
    ↓
User authorizes in popup
    ↓
Attio redirects to /integrations/attio/callback
    ↓
Backend exchanges code for token
    ↓
Stores token in httpOnly cookie
    ↓
Returns HTML with postMessage
    ↓
Popup sends message to parent window
    ↓
Frontend receives 'ATTIO_OAUTH_SUCCESS' message
    ↓
checkAuthStatus() called again
    ↓
UI updates to show connected state
```

**Alternative Polling Flow** (if postMessage fails):
```
Frontend polls GET /integrations/attio/status every 1 second
    ↓
Backend returns token when available
    ↓
Frontend detects token and closes popup
    ↓
checkAuthStatus() called
```

### 3. **Chat Message Flow**

```
User types message and hits Enter
    ↓
handleSendMessage() in App.tsx
    ↓
Adds user message to local state
    ↓
POST /api/chat
    Body: {
      message: "string",
      conversationHistory: [...]
    }
    ↓
Backend: /api/chat/route.js
    ↓
1. Reads httpOnly cookies for all adapters
2. Creates activeAdapters array
3. Creates GeneralBot with adapters
4. Creates ControlBot for routing
5. controlBot.processMessage()
    ↓
ControlBot analyzes query
    ↓
Routes to appropriate adapters
    ↓
GeneralBot executes tool calls
    ↓
Claude AI processes with tool results
    ↓
Returns response
    ↓
Frontend receives response
    ↓
Adds bot message to state
    ↓
UI displays response
```

### 4. **Disconnect Flow**

```
User clicks "Disconnect" in settings
    ↓
handleDisconnect('attio')
    ↓
POST /api/auth/logout
    Body: { "tool": "attio" }
    ↓
Backend deletes httpOnly cookie
    ↓
Returns success
    ↓
Frontend calls checkAuthStatus()
    ↓
UI updates to show disconnected
```

---

## Key Architecture Patterns

### 1. **Adapter Pattern**
- **Location**: `lib/adapters/`
- **Purpose**: Abstract tool-specific logic
- **Key Files**:
  - `adapter-interface.js` - Base class
  - `adapter-registry.js` - Adapter management
  - `attio-adapter.js` - Attio implementation
  - `google-calendar-adapter.js` - Google Calendar implementation

**How Frontend Uses It**:
- Frontend doesn't directly interact with adapters
- Backend uses adapters to:
  - Load schemas
  - Execute tool calls
  - Format context for Claude

### 2. **Cookie-Based Authentication**
- **Security**: All tokens stored in httpOnly cookies (XSS protection)
- **Cookie Names**:
  - `attio_api_token` - Attio access token
  - `google_calendar_api_token` - Google Calendar token
- **Frontend Access**: Cookies are **NOT** accessible to JavaScript
- **Backend Access**: Cookies read via `cookies()` from Next.js

### 3. **Multi-Tool Support**
- **Single Conversation**: Can use multiple tools in one chat
- **Tool Routing**: ControlBot intelligently routes to appropriate tools
- **Parallel vs Hierarchical**: 
  - Parallel: Independent operations (e.g., "show companies and events")
  - Hierarchical: Dependent operations (e.g., "get email from CRM then schedule meeting")

### 4. **Bot Architecture**
- **GeneralBot** (`lib/bots/general-bot.js`):
  - Tool-agnostic orchestrator
  - Handles Claude API interactions
  - Manages tool execution
  - Rate limiting
  
- **ControlBot** (`lib/bots/control-bot.js`):
  - Intelligent query analysis
  - Tool routing decisions
  - Strategy selection (parallel/hierarchical)
  - Learning from past decisions

---

## Frontend Component Hierarchy

```
app/page.tsx (Server Component)
    ↓
components/App.tsx (Client Component)
    ├── Settings Panel (OAuth controls)
    ├── Chat Messages Display
    └── Input Area (Text + Voice)

OR

app/page.tsx
    ↓
components/AuthWrapper.jsx (Client Component)
    ├── Settings Panel
    └── components/ChatInterface.jsx
        ├── Messages Display
        └── Input Area
```

---

## Environment Variables

### Frontend
- None required (all config in backend)

### Backend
- `ATTIO_CLIENT_ID` - Attio OAuth client ID
- `ATTIO_CLIENT_SECRET` - Attio OAuth client secret
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `ANTHROPIC_API_KEY` or `ANTHROPIC_API_KEYS` - Claude API key(s)
- `APP_BASE_URL` - Base URL for OAuth redirects
- `FRONTEND_ORIGIN` - Frontend origin for postMessage

---

## Security Considerations

1. **httpOnly Cookies**: Tokens never exposed to JavaScript
2. **CSRF Protection**: `sameSite: 'lax'` on cookies
3. **HTTPS in Production**: `secure: true` in production
4. **OAuth State Validation**: Prevents CSRF attacks
5. **Rate Limiting**: Prevents abuse (5 second minimum interval)

---

## File Structure Summary

```
Frontend:
├── app/
│   ├── page.tsx                    # Entry point
│   ├── layout.tsx                   # Root layout
│   └── globals.css                  # Global styles
├── components/
│   ├── App.tsx                      # Main UI (with OAuth)
│   ├── AuthWrapper.jsx              # Alternative wrapper
│   ├── ChatInterface.jsx            # Chat component
│   └── ui/                          # UI components (shadcn)
└── lib/                             # (Not used by frontend directly)

Backend:
├── app/api/
│   ├── chat/route.js                # Chat endpoint
│   ├── auth/
│   │   ├── status/route.js          # Auth status
│   │   └── logout/route.js          # Logout
│   └── cache/invalidate/route.js    # Cache management
├── app/integrations/
│   ├── attio/
│   │   ├── connect/route.js         # OAuth initiation
│   │   ├── callback/route.js        # OAuth callback
│   │   └── status/route.js          # OAuth polling
│   └── google-calendar/             # Same structure
└── lib/
    ├── adapters/                    # Adapter pattern
    ├── bots/                        # Bot orchestrators
    ├── learning/                    # Learning system
    └── ...                          # Other utilities
```

---

## Key Takeaways

1. **Frontend is "dumb"**: React components handle UI only, all logic in backend
2. **Cookies are secure**: Tokens stored in httpOnly cookies, never in localStorage
3. **Multi-tool ready**: Architecture supports multiple tools in single conversation
4. **Adapter pattern**: Easy to add new tools without changing core logic
5. **Intelligent routing**: ControlBot decides which tools to use and how
6. **OAuth flow**: Popup-based with postMessage + polling fallback

---

## Next Steps for Development

1. **Add New Tool**: 
   - Create adapter in `lib/adapters/`
   - Register in `adapter-registry.js`
   - Add OAuth routes in `app/integrations/`
   - Add config to `TOOL_CONFIGS` in frontend

2. **Modify Chat Behavior**:
   - Edit `GeneralBot` for tool execution
   - Edit `ControlBot` for routing logic
   - Edit adapters for tool-specific behavior

3. **Frontend Changes**:
   - UI components in `components/`
   - API calls use standard fetch with credentials
   - State management is React hooks (useState, useEffect)

