import { NextResponse } from 'next/server';
import { getAgentTools, executeAgentTool } from '@/lib/intelligent-agent';
import { loadCRMSchema, schemaToContext } from '@/lib/crm-schema-loader';

export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds max

// Rate limiting: Track last request time per user
const lastRequestTime = new Map();
const MIN_REQUEST_INTERVAL = 5000; // 5 seconds between requests (increased to avoid rate limits)

// Schema cache: Store loaded CRM schemas per API key
const schemaCache = new Map();

/**
 * Main chat endpoint - handles user messages and Claude AI processing
 * This is where the magic happens - NO HARDCODING
 */
export async function POST(request) {
  try {
    const { message, attioApiKey } = await request.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    if (!attioApiKey) {
      return NextResponse.json({ error: 'Attio API key is required. Please connect your workspace.' }, { status: 401 });
    }

    // Rate limiting check
    const userId = attioApiKey.substring(0, 10); // Use API key prefix as user ID
    const now = Date.now();
    const lastRequest = lastRequestTime.get(userId) || 0;
    const timeSinceLastRequest = now - lastRequest;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      const waitTime = Math.ceil((MIN_REQUEST_INTERVAL - timeSinceLastRequest) / 1000);
      return NextResponse.json({
        error: `Please wait ${waitTime} seconds before sending another message.`
      }, { status: 429 });
    }

    lastRequestTime.set(userId, now);

    // Use Claude Haiku (cheapest)
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;

    if (!claudeApiKey) {
      return NextResponse.json({ error: 'Server configuration error: Missing Claude API key' }, { status: 500 });
    }

    console.log('🚀 Processing message:', message);

    // Load CRM schema into context (cached per API key)
    const cacheKey = attioApiKey.substring(0, 20);
    let crmContext = '';

    if (!schemaCache.has(cacheKey)) {
      console.log('📥 First request - loading CRM schema...');
      const schema = await loadCRMSchema(
        attioApiKey,
        process.env.CRM_API_BASE_URL || 'https://api.attio.com'
      );
      schemaCache.set(cacheKey, schema);
      crmContext = schemaToContext(schema);
    } else {
      console.log('✅ Using cached CRM schema');
      crmContext = schemaToContext(schemaCache.get(cacheKey));
    }

    const model = 'claude-3-5-haiku-20241022';
    const tools = getAgentTools();
    const systemPrompt = buildSystemPrompt(crmContext);

    console.log(`💬 Claude (${model}):`, message);

    let response = await callClaude({
      model,
      max_tokens: 1024,
      messages: [
        { role: 'user', content: message }
      ],
      system: systemPrompt,
      tools: tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
      }))
    }, claudeApiKey);

    console.log('📨 Claude response:', JSON.stringify(response, null, 2));

    // Handle tool calls (agentic loop)
    const conversationHistory = [
      { role: 'user', content: message }
    ];

    let finalResponse = null;
    let iterationCount = 0;
    const maxIterations = 10;

    while (response.stop_reason === 'tool_use' && iterationCount < maxIterations) {
      iterationCount++;
      console.log(`🔄 Tool use iteration ${iterationCount}`);

      const toolResults = [];

      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`🔧 Executing tool: ${block.name}`);
          console.log(`📥 Input:`, JSON.stringify(block.input, null, 2));

          try {
            const result = await executeAgentTool(
              block.name,
              block.input,
              attioApiKey
            );

            console.log(`✅ Tool result:`, JSON.stringify(result, null, 2));

            toolResults.push({
              tool_call_id: block.id,
              role: 'tool',
              name: block.name,
              content: JSON.stringify(result)
            });

          } catch (error) {
            console.error(`❌ Tool execution failed:`, error);
            toolResults.push({
              tool_call_id: block.id,
              role: 'tool',
              name: block.name,
              content: JSON.stringify({
                error: error.message,
                details: 'Tool execution failed.'
              })
            });
          }
        }
      }

      conversationHistory.push({
        role: 'assistant',
        content: response.content
      });
      conversationHistory.push({
        role: 'user',
        content: toolResults.map(tr => ({
          type: 'tool_result',
          tool_use_id: tr.tool_call_id,
          content: tr.content
        }))
      });

      response = await callClaude({
        model,
        max_tokens: 1024,
        messages: conversationHistory,
        system: systemPrompt,
        tools: tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters
        }))
      }, claudeApiKey);

      console.log(`📨 Claude response (iteration ${iterationCount}):`, JSON.stringify(response, null, 2));
    }

    // Extract final text response
    finalResponse = extractTextResponse(response);

    console.log('✅ Final response:', finalResponse);

    return NextResponse.json({
      success: true,
      response: finalResponse,
      iterations: iterationCount
    });

  } catch (error) {
    console.error('❌ Chat API error:', error);
    return NextResponse.json({
      error: error.message,
      details: error.stack
    }, { status: 500 });
  }
}

/**
 * Build system prompt for intelligent agent with CRM context
 */
function buildSystemPrompt(crmContext) {
  return `You are a CRM assistant with FULL KNOWLEDGE of the connected CRM system.

${crmContext}

Your job: Execute user requests using the schema above. You already know everything about this CRM - no need to explore.

Instructions:
1. Use the exact attribute slugs and endpoints documented above
2. Remember: all attribute values must be in arrays (e.g., {name: [{first_name: "John"}]})
3. For queries, use POST to the query endpoint with optional filters
4. Be direct and efficient - you have complete knowledge

Execute requests confidently using your complete CRM knowledge.`;
}

/**
 * Call Claude API
 */
async function callClaude(payload, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API Error: ${error}`);
  }

  const data = await response.json();

  // Claude already returns in the correct format
  return {
    content: data.content,
    stop_reason: data.stop_reason,
    model: data.model
  };
}

/**
 * Extract text response from Claude's response
 */
function extractTextResponse(response) {
  const textBlocks = response.content.filter(block => block.type === 'text');
  return textBlocks.map(block => block.text).join('\n\n');
}
