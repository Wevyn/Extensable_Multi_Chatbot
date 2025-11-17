/**
 * General Bot Orchestrator
 * 
 * Tool-agnostic chatbot logic that works with any tool adapter.
 * Handles:
 * - Conversation management
 * - Tool routing
 * - Error handling
 * - Rate limiting
 * - Claude API interactions
 */

import { getCachedSchema, setCachedSchema } from '@/lib/schema-cache.js';
import { discoverAPIStructure, apiStructureToContext } from '@/lib/generic-api-discovery.js';
import { getActiveAPIConfigs } from '@/lib/api-config-manager.js';
import { validateToolCall, generateTroubleshootingHints } from '@/lib/validation/tool-validation.js';

// Rate limiting: Track last request time per user
const lastRequestTime = new Map();
const MIN_REQUEST_INTERVAL = 5000; // 5 seconds between requests

/**
 * General Bot Class
 * Orchestrates chatbot interactions with multiple tool adapters
 */
export class GeneralBot {
  constructor(adapters, claudeApiKey) {
    // Adapters can be a single adapter (backward compat) or array of adapters
    this.adapters = Array.isArray(adapters) ? adapters : [adapters];
    this.claudeApiKey = claudeApiKey;
    this.model = 'claude-3-5-haiku-20241022';
    
    // Create adapter lookup map for routing
    this.adapterMap = new Map();
    this.adapters.forEach(adapter => {
      this.adapterMap.set(adapter.getName(), adapter);
    });
  }

  /**
   * Check rate limiting
   */
  checkRateLimit(userId) {
    const now = Date.now();
    const lastRequest = lastRequestTime.get(userId) || 0;
    const timeSinceLastRequest = now - lastRequest;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      const waitTime = Math.ceil((MIN_REQUEST_INTERVAL - timeSinceLastRequest) / 1000);
      return {
        allowed: false,
        waitTime
      };
    }

    lastRequestTime.set(userId, now);
    return { allowed: true };
  }

  /**
   * Load tool context from all adapters
   * Supports multiple tools in a single conversation
   */
  async loadToolContext(adapterCredentials, userId) {
    // adapterCredentials: Map<adapterName, { apiKey, baseUrl }>
    const configuredAPIs = getActiveAPIConfigs(userId);
    
    const toolContexts = [];
    const toolSchemas = [];
    
    // Load context from all adapters
    for (const adapter of this.adapters) {
      const adapterName = adapter.getName();
      const credentials = adapterCredentials.get(adapterName);
      
      if (!credentials || !credentials.apiKey) {
        continue; // Skip adapters without credentials
      }
      
      const { apiKey, baseUrl } = credentials;
      const cacheKey = `${adapterName}:${apiKey.substring(0, 20)}`;
      const cachedEntry = getCachedSchema(cacheKey);
      
      let schema = null;
      let context = '';
      
      if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
        schema = cachedEntry.schema;
        context = adapter.schemaToContext(schema);
      } else {
        // Cache miss or expired - reload schema using adapter
        schema = await adapter.loadSchema(apiKey, baseUrl);
        setCachedSchema(cacheKey, schema);
        context = adapter.schemaToContext(schema);
      }
      
      if (context) {
        toolContexts.push(`## ${adapterName.toUpperCase()} Tool\n\n${context}`);
        toolSchemas.push({ adapterName, schema });
      }
    }
    
    // Also load generic API configs (for manually configured APIs)
    if (configuredAPIs.length > 0) {
      for (const apiConfig of configuredAPIs) {
        const cacheKey = `${userId}:${apiConfig.name}`.substring(0, 20);
        const cachedEntry = getCachedSchema(cacheKey);
        
        let structure = null;
        
        if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
          structure = cachedEntry.schema;
        } else if (apiConfig.isDiscoveryCacheValid()) {
          structure = apiConfig.discoveredStructure;
        } else {
          try {
            structure = await discoverAPIStructure(
              apiConfig.baseUrl,
              apiConfig.apiKey,
              {
                discoveryEndpoints: apiConfig.discoveryEndpoints,
                authHeader: apiConfig.authHeader,
                authHeaderName: apiConfig.authHeaderName,
                openApiSpecUrl: apiConfig.openApiSpecUrl
              }
            );
            apiConfig.updateDiscoveredStructure(structure);
            setCachedSchema(cacheKey, structure);
          } catch (error) {
            console.error(`❌ Discovery failed for ${apiConfig.name}:`, error);
            structure = apiConfig.discoveredStructure;
          }
        }
        
        if (structure) {
          const context = apiStructureToContext(structure);
          const typeLabel = (apiConfig.type || 'custom').toUpperCase();
          toolContexts.push(`## ${apiConfig.name} (${typeLabel})\n\n${context}`);
          toolSchemas.push({ adapterName: apiConfig.name, schema: structure });
        }
      }
    }

    const combinedContext = toolContexts.join('\n\n---\n\n');
    
    // Create schema lookup map for validation
    const schemaMap = new Map();
    toolSchemas.forEach(({ adapterName, schema }) => {
      schemaMap.set(adapterName, schema);
    });

    return { toolContext: combinedContext, toolSchemas: schemaMap };
  }

  /**
   * Process a chat message
   * Main entry point for chatbot interactions
   * Supports multiple tools in a single conversation
   */
  async processMessage(message, previousMessages, adapterCredentials, userId, apiConfigs = null) {
    // adapterCredentials: Map<adapterName, { apiKey, baseUrl }>
    
    // Load tool context from all adapters
    const { toolContext, toolSchemas } = await this.loadToolContext(adapterCredentials, userId);

    // Merge tools from all adapters (use first adapter's tools as base, they're usually the same)
    const tools = this.adapters[0]?.getTools() || [];
    
    // Build combined system prompt (use first adapter's prompt builder, but can be overridden)
    // For multi-tool, we'll use a generic prompt that mentions all tools
    let systemPrompt;
    if (this.adapters.length === 1) {
      // Single tool - use adapter's specific prompt
      systemPrompt = this.adapters[0].getSystemPrompt(toolContext);
    } else {
      // Multiple tools - use generic multi-tool prompt
      systemPrompt = this.buildMultiToolSystemPrompt(toolContext, this.adapters);
    }

    // Build messages array with conversation history + current message
    const messages = [
      ...previousMessages,
      { role: 'user', content: message }
    ];

    // Initial Claude call
    const payload = {
      model: this.model,
      max_tokens: 1024,
      messages,
      system: systemPrompt,
      tools: tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
      }))
    };

    let response = await this.callClaude(payload);

    // Handle tool calls (agentic loop)
    const conversationHistory = [
      ...previousMessages,
      { role: 'user', content: message }
    ];

    let finalResponse = null;
    let iterationCount = 0;
    const maxIterations = 10; // Increased to allow complex multi-step operations (create company + person, etc.)
    const validationErrors = new Set();

    while (response.stop_reason === 'tool_use' && iterationCount < maxIterations) {
      iterationCount++;
      console.log(`🔄 Agentic loop iteration ${iterationCount}/${maxIterations}`);

      // Add delay between iterations to help avoid rate limits
      if (iterationCount > 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Early exit if we're hitting too many validation errors
      if (iterationCount >= 2 && validationErrors.size >= 2) {
        break;
      }

      // Collect ALL tool calls from this response
      const toolCalls = response.content.filter(block => block.type === 'tool_use');

      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        toolCalls.map(async (block) => {
          // Determine which adapter to use for this tool call
          // Tool calls can specify api_name to route to specific adapter
          const apiName = block.input?.api_name;
          let adapter = null;
          let credentials = null;
          
          if (apiName && this.adapterMap.has(apiName)) {
            // Route to specific adapter
            adapter = this.adapterMap.get(apiName);
            credentials = adapterCredentials.get(apiName);
          } else {
            // Default to first adapter (backward compatibility)
            adapter = this.adapters[0];
            if (adapter) {
              const firstAdapterName = adapter.getName();
              credentials = adapterCredentials.get(firstAdapterName);
            }
          }
          
          if (!adapter || !credentials) {
            return {
              tool_call_id: block.id,
              role: 'tool',
              name: block.name,
              content: JSON.stringify({
                success: false,
                error: `Adapter "${apiName || 'default'}" not found or not authenticated`
              })
            };
          }
          
          // Pre-submission validation for CREATE/UPDATE operations
          if (block.name === 'call_api' && block.input &&
              (block.input.method === 'POST' || block.input.method === 'PUT' || block.input.method === 'PATCH')) {
            // Find appropriate schema for validation
            const adapterName = adapter.getName();
            const schema = toolSchemas.get(adapterName) || toolSchemas.get(apiName);
            
            if (schema) {
              const validationResult = validateToolCall(block.input, schema);
              if (validationResult && !validationResult.valid) {
                return {
                  tool_call_id: block.id,
                  role: 'tool',
                  name: block.name,
                  content: JSON.stringify({
                    success: false,
                    error: 'Validation failed before submission',
                    validation_errors: validationResult.errors || [],
                    message: `I found some formatting issues before submitting:\n${(validationResult.errors || []).join('\n')}\n\nPlease check the data format and try again.`
                  })
                };
              }
            }
          }

          try {
            // Execute tool using the appropriate adapter
            const result = await adapter.executeTool(
              block.name,
              block.input,
              credentials.apiKey,
              credentials.baseUrl,
              apiConfigs
            );

            // Enhanced error detection
            let enhancedResult = result;
            if (typeof result === 'string') {
              try {
                enhancedResult = JSON.parse(result);
              } catch {
                enhancedResult = { success: false, error: result, raw: result };
              }
            }

            if (enhancedResult && enhancedResult.success === false) {
              let errorMessage = enhancedResult.error || enhancedResult.message || 'Unknown error';
              if (typeof errorMessage === 'string' && errorMessage.length > 500) {
                errorMessage = errorMessage.substring(0, 500) + '...';
              }

              // Find appropriate schema for troubleshooting
              const adapterName = adapter.getName();
              const schema = toolSchemas.get(adapterName) || toolSchemas.get(apiName);
              
              enhancedResult = {
                ...enhancedResult,
                success: false,
                error: errorMessage,
                troubleshooting_hints: generateTroubleshootingHints(block.input, enhancedResult, schema)
              };
            }

            return {
              tool_call_id: block.id,
              role: 'tool',
              name: block.name,
              content: JSON.stringify(enhancedResult)
            };

          } catch (error) {
            console.error(`❌ Tool execution failed:`, error);

            if (error.message && error.message.includes('validation')) {
              validationErrors.add(error.message);
            }

            return {
              tool_call_id: block.id,
              role: 'tool',
              name: block.name,
              content: JSON.stringify({
                error: error.message,
                details: 'Tool execution failed. Check the error message for specific validation issues.'
              })
            };
          }
        })
      );

      // Add tool results to conversation history
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

      // Continue conversation with tool results
      response = await this.callClaude({
        model: this.model,
        max_tokens: 1024,
        messages: conversationHistory,
        system: systemPrompt,
        tools: tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters
        }))
      });
    }

    // Log why loop exited
    if (response.stop_reason !== 'tool_use') {
      console.log(`✅ Agentic loop completed: stop_reason = "${response.stop_reason}" (not "tool_use")`);
    } else if (iterationCount >= maxIterations) {
      console.log(`⚠️ Agentic loop stopped: reached max iterations (${maxIterations})`);
    }

    // Extract final text response
    finalResponse = this.extractTextResponse(response);

    return {
      response: finalResponse,
      iterations: iterationCount
    };
  }


  /**
   * Call Claude API with rate limit handling
   */
  async callClaude(payload, retryCount = 0) {
    const maxRetries = 100;
    const baseDelay = 2000;
    const maxDelay = 60000;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.claudeApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: { type: 'unknown', message: errorText } };
        }

        // Check for rate limit or overloaded errors - retry indefinitely with backoff
        if (errorData.error?.type === 'rate_limit_error' || errorData.error?.type === 'overloaded_error') {
          const errorType = errorData.error?.type === 'rate_limit_error' ? 'rate limit' : 'overloaded';
          const delay = Math.min(baseDelay * Math.pow(2, Math.min(retryCount, 5)), maxDelay);
          console.log(`⏳ Claude API ${errorType} error, waiting ${delay}ms before retry (attempt ${retryCount + 1})...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.callClaude(payload, retryCount + 1);
        }

        throw new Error(`Claude API Error: ${errorText}`);
      }

      const data = await response.json();

      return {
        content: data.content,
        stop_reason: data.stop_reason,
        model: data.model
      };
    } catch (error) {
      if (error.message && (error.message.includes('rate limit') || error.message.includes('overloaded'))) {
        const delay = Math.min(baseDelay * Math.pow(2, Math.min(retryCount, 5)), maxDelay);
        console.log(`⏳ Claude API error caught, waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.callClaude(payload, retryCount + 1);
      }
      throw new Error(`Claude API Error: ${error.message}`);
    }
  }

  /**
   * Extract text response from Claude's response
   */
  extractTextResponse(response) {
    const textBlocks = response.content.filter(block => block.type === 'text');
    return textBlocks.map(block => block.text).join('\n\n');
  }

  /**
   * Build system prompt for multi-tool scenarios
   */
  buildMultiToolSystemPrompt(toolContext, adapters) {
    const toolNames = adapters.map(a => a.getName()).join(', ');
    
    return `You are a helpful, conversational assistant that works with multiple business systems: ${toolNames}.

You have COMPLETE knowledge of all configured tools' schemas, attributes, structures, AND ACTUAL DATA.

## 🚨 CRITICAL USER-FACING RULES:
1. **NEVER use example data as real records** - Examples are FICTIONAL and only show format. ONLY use actual data from the "Existing Records in Database" sections.
2. **NEVER show timestamps, IDs, or technical details to users** - These are for internal use only
3. **NEVER ask users to clarify between multiple matches** - Resolve ambiguity internally using the most likely match
4. **NEVER mention record IDs to users** - Users don't know UUIDs and shouldn't see them
5. **ALWAYS resolve record identification internally** - Use email, company, or other human-friendly identifiers
6. **NEVER use technical language** - Don't mention "API", "PUT method", "database records", "query", "search", etc.
7. **Speak naturally and conversationally** - Like a helpful assistant, not a technical system

${toolContext}

## Multi-Tool Usage:
- You can access data from multiple tools in a single conversation
- When making API calls, specify which tool to use with the "api_name" parameter
- Example: To get email from CRM and schedule in Calendar, make two tool calls:
  1. Call CRM tool (api_name: "attio") to get person's email
  2. Call Calendar tool (api_name: "google_calendar") to create event with that email
- You can combine data from multiple tools to provide comprehensive responses
- Always use the most appropriate tool for each operation

## Tool Routing:
- Each tool call can specify "api_name" to route to a specific tool
- If "api_name" is not specified, the call will go to the default tool
- Available tools: ${toolNames}

Execute requests confidently using your complete knowledge of all connected tools!`;
  }
}

