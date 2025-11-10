# Extensible - Conversational AI CRM

An intelligent CRM assistant that lets you manage your Attio workspace through natural conversation. Never look at your CRM directly again - just talk to it!

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ installed
- An Attio workspace
- An Anthropic API key (get one at https://console.anthropic.com/)

### 1. Install Dependencies

```bash
npm install
```

### 2. Add Your Anthropic API Key

Edit `.env.local` and add your API key:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-YOUR_KEY_HERE
```

**Important:** Replace `YOUR_KEY_HERE` with your actual Anthropic API key from https://console.anthropic.com/

The Attio OAuth credentials are already configured.

### 3. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Connect Your Attio Workspace

1. Click the **Settings** icon in the top-right corner
2. Click **Continue with Attio**
3. Sign in to your Attio workspace (if prompted)
4. Select your workspace and approve access
5. The popup will close automatically when connected

### 5. Start Talking to Your CRM!

Try these examples:

**Text Input:**
- "Add John Smith from Acme Corp as a new contact"
- "Create a deal with TechCo for $50,000"
- "The CEO is very interested in our product" (automatically creates follow-up task!)
- "Show me all my open deals"
- "Update John's email to john@acme.com"

**Voice Input:**
- Click the microphone button
- Speak your request naturally
- Click the mic again or press Send when done

## 🏗️ Architecture

### How It Works

1. **User Input** → Text or voice input via the ChatInterface
2. **Workspace Introspection** → Fetches your live CRM schema (objects, attributes, relationships)
3. **Dynamic Tool Generation** → Automatically generates Claude tools from the Attio OpenAPI spec
4. **AI Processing** → Claude analyzes your request and executes appropriate CRM operations
5. **Response** → Confirms what was done and suggests next steps

### Key Features

- ✅ **Zero Hardcoding** - All CRM operations are dynamically generated from OpenAPI spec
- ✅ **Intelligent Actions** - Automatically creates tasks when you express sentiment or next steps
- ✅ **Live Schema Awareness** - Knows about all your custom objects and fields
- ✅ **Multi-Modal Input** - Text and voice (Chrome/Edge/Safari only for voice)
- ✅ **OAuth Security** - Secure workspace connection via Attio OAuth
- ✅ **Cost Efficient** - Uses Claude 3.5 Haiku for optimal cost/performance

### File Structure

```
app/
  api/
    chat/
      route.js          # Main Claude AI endpoint (agentic loop)
  integrations/
    attio/
      connect/route.js  # OAuth initiation
      callback/route.js # OAuth callback
      status/route.js   # OAuth polling
  globals.css           # Dark theme styles
  layout.tsx            # Root layout
  page.tsx              # Main page

components/
  AuthWrapper.jsx       # Handles Attio OAuth
  ChatInterface.jsx     # Chat UI with voice input

lib/
  openapi-tool-generator.js    # Dynamically generates tools from OpenAPI
  workspace-introspection.js   # Fetches live CRM schema
  attio_cleaned_no_country_code.json  # Attio OpenAPI spec
```

## 🎯 Usage Examples

### Creating Records

**Contact:**
```
"Add Sarah Johnson, she's the VP of Sales at Acme Corp.
Her email is sarah@acme.com"
```

**Deal:**
```
"Create a new deal with TechCo for $75,000.
We're in the proposal stage."
```

**Task (automatically created):**
```
"Had a great call with the CEO, they're very interested.
Need to follow up next Friday."
```
→ Creates contact update + follow-up task with deadline

### Querying Records

```
"Show me all deals over $50k"
"Find contacts at Acme Corp"
"What tasks do I have this week?"
```

### Updating Records

```
"Move the TechCo deal to Won"
"Update Sarah's phone number to 555-1234"
"Mark the follow-up task as complete"
```

## 🔧 Troubleshooting

### "Speech recognition is not supported"
- Voice input only works in Chrome, Edge, and Safari
- Try using the text input instead
- Ensure microphone permissions are granted

### "Server configuration error: Missing Anthropic API key"
- Make sure `ANTHROPIC_API_KEY` is set in `.env.local`
- Restart the dev server after adding environment variables

### "Token validation failed"
- Click Settings → Disconnect
- Try reconnecting to Attio
- Make sure you selected the correct workspace

### Tool execution failures
- Check console for detailed error messages
- Verify your Attio workspace has the objects being referenced
- Some operations require specific permissions in Attio

## 💰 Cost Optimization

The system uses **Claude 3.5 Haiku** by default for optimal cost/performance:
- ~$0.25 per 1M input tokens
- ~$1.25 per 1M output tokens

Typical conversation costs:
- Simple query: ~$0.001
- Complex operation with 5 tool calls: ~$0.01
- Full conversation (10 messages): ~$0.05

To use a different model, edit `app/api/chat/route.js` and change the model parameter:
```javascript
model: 'claude-3-5-sonnet-20241022', // More capable, higher cost
// or
model: 'claude-3-5-haiku-20241022', // Faster, lower cost (default)
```

## 🔒 Security Notes

- OAuth tokens are stored in `localStorage` (client-side only)
- Attio API key is never exposed to the frontend
- Anthropic API key is server-side only
- For production, add proper session management and database storage

## 🐛 Known Limitations

- Voice input requires Chrome/Edge/Safari (WebKit Speech API limitation)
- No conversation history persistence (refreshing page clears chat)
- Max 10 tool call iterations per message (prevents infinite loops)
- No retry logic for failed CRM operations
- Some complex queries may require multiple messages to clarify

## 📝 Development Notes

### Adding Support for Other CRMs

The system is designed to work with any CRM that has an OpenAPI specification:

1. Replace `lib/attio_cleaned_no_country_code.json` with your CRM's OpenAPI spec
2. Update the API base URL in `lib/workspace-introspection.js`
3. Update the OAuth flow in `app/integrations/` if needed
4. The tool generator will automatically create tools for all endpoints

### Extending Functionality

Want to add more intelligence?

Edit the system prompt in `app/api/chat/route.js` → `buildSystemPrompt()`:
- Add custom rules for your business logic
- Define specific task creation patterns
- Add domain-specific knowledge

## 🆘 Support

If you encounter issues:
1. Check the browser console for errors
2. Check the terminal where `npm run dev` is running
3. Verify all environment variables are set correctly
4. Make sure you're using a supported browser

## 📄 License

[Your License Here]

---

Built with Next.js 15, React 19, Claude AI, and Attio CRM.
