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
import { getCurrentKey, rotateToNextKey } from '@/lib/claude-key-rotator.js';

// Rate limiting: Track last request time per user
const lastRequestTime = new Map();
const MIN_REQUEST_INTERVAL = 5000; // 5 seconds between requests

/**
 * General Bot Class
 * Orchestrates chatbot interactions with multiple tool adapters
 */
export class GeneralBot {
  constructor(adapters, claudeApiKey = null) {
    // Adapters can be a single adapter (backward compat) or array of adapters
    this.adapters = Array.isArray(adapters) ? adapters : [adapters];
    // Use provided key or get current key from rotator
    this.claudeApiKey = claudeApiKey || getCurrentKey();
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
    
    // Check if this is a correction and learn from it
    if (previousMessages.length >= 2) {
      const lastBotMessage = previousMessages[previousMessages.length - 1];
      const lastUserMessage = previousMessages[previousMessages.length - 2];
      
      if (lastBotMessage.role === 'assistant' && lastUserMessage.role === 'user') {
        const { detectCorrection, learnFromCorrection } = await import('@/lib/learning/user-correction-learner.js');
        const correction = detectCorrection(message, lastBotMessage.content, lastUserMessage.content);
        
        if (correction.isCorrection && correction.originalPhrase && correction.correctedInterpretation) {
          // Learn from correction for each active adapter
          for (const adapterName of adapterCredentials.keys()) {
            learnFromCorrection(
              userId,
              adapterName,
              correction.originalPhrase,
              correction.correctedInterpretation,
              correction.context
            );
          }
        }
      }
    }
    
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
            
            // HARD VALIDATION: Google Calendar event updates (PUT) - ensure all fields are preserved
            if (block.input.path && block.input.path.includes('/calendars/primary/events') && 
                block.input.method === 'PUT' && block.input.body) {
              const validationErrors = [];
              const body = block.input.body;
              
              // Check if summary (title) is missing - this will cause the title to be removed
              if (!body.summary || body.summary.trim() === '') {
                // Try to find the existing event to get its summary
                const eventIdMatch = block.input.path.match(/\/events\/([^\/]+)/);
                const eventId = eventIdMatch ? eventIdMatch[1] : null;
                
                if (eventId) {
                  const googleCalendarSchema = toolSchemas.get('google_calendar');
                  if (googleCalendarSchema && googleCalendarSchema.events && Array.isArray(googleCalendarSchema.events)) {
                    const existingEvent = googleCalendarSchema.events.find(e => e.id === eventId);
                    if (existingEvent && existingEvent.summary) {
                      validationErrors.push(`You must include the event title (summary: "${existingEvent.summary}") in your update request. When updating an event with PUT, you must include ALL existing fields (summary, location, description, attendees, etc.) - only modify the fields the user wants to change. If you only send start and end, the title will be removed!`);
                    } else {
                      validationErrors.push(`You must include the event title (summary) in your update request. When updating an event with PUT, you must include ALL existing fields from the event. Check the "Existing Events" section to find the event's current summary, location, description, attendees, and other fields, then include them all in your PUT request body.`);
                    }
                  } else {
                    validationErrors.push(`You must include the event title (summary) in your update request. When updating an event with PUT, you must include ALL existing fields from the event. Check the "Existing Events" section to find the event's current summary, location, description, attendees, and other fields, then include them all in your PUT request body.`);
                  }
                } else {
                  validationErrors.push(`You must include the event title (summary) in your update request. When updating an event with PUT, you must include ALL existing fields from the event. Check the "Existing Events" section to find the event's current summary, location, description, attendees, and other fields, then include them all in your PUT request body.`);
                }
                
                console.log(`❌ Hard validation failed for Google Calendar event update: Missing summary field`);
              }
              
              if (validationErrors.length > 0) {
                console.log(`❌ Hard validation failed for Google Calendar event update:`);
                validationErrors.forEach(err => console.log(`   - ${err}`));
                return {
                  tool_call_id: block.id,
                  role: 'tool',
                  name: block.name,
                  content: JSON.stringify({
                    success: false,
                    error: 'Validation failed: Missing required fields in update',
                    validation_errors: validationErrors,
                    note: validationErrors.join(' '),
                    message: validationErrors.join(' ')
                  })
                };
              }
            }
            
            // HARD VALIDATION: Google Calendar event creation - check for fake emails, missing time, and duplicates
            if (block.input.path && block.input.path.includes('/calendars/primary/events') && 
                block.input.method === 'POST' && block.input.body) {
              const validationErrors = [];
              const body = block.input.body;
              
              // Check for duplicate events - if event with same title and similar time already exists, reject creation
              if (body.summary && body.start && body.start.dateTime) {
                const googleCalendarSchema = toolSchemas.get('google_calendar');
                if (googleCalendarSchema && googleCalendarSchema.events && Array.isArray(googleCalendarSchema.events)) {
                  const newEventTitle = body.summary.toLowerCase().trim();
                  const newEventStart = body.start.dateTime;
                  
                  // Extract date from new event (YYYY-MM-DD)
                  const newEventDateMatch = newEventStart.match(/^(\d{4}-\d{2}-\d{2})/);
                  const newEventDate = newEventDateMatch ? newEventDateMatch[1] : null;
                  
                  // Check for existing events with same title and same/similar date
                  const duplicateEvent = googleCalendarSchema.events.find(existingEvent => {
                    const existingTitle = (existingEvent.summary || '').toLowerCase().trim();
                    const existingStart = existingEvent.start?.dateTime || existingEvent.start?.date || '';
                    const existingDateMatch = existingStart.match(/^(\d{4}-\d{2}-\d{2})/);
                    const existingDate = existingDateMatch ? existingDateMatch[1] : null;
                    
                    // Check if titles match (fuzzy match - allow for minor variations)
                    const titleMatch = existingTitle === newEventTitle || 
                                      existingTitle.includes(newEventTitle) || 
                                      newEventTitle.includes(existingTitle);
                    
                    if (!titleMatch) return false;
                    
                    // Check if dates match (same day) - for non-recurring events
                    const dateMatch = newEventDate && existingDate && newEventDate === existingDate;
                    
                    // For recurring events, match by title + location + time (not date)
                    const newIsRecurring = body.recurrence && body.recurrence.length > 0;
                    const existingIsRecurring = existingEvent.recurrence && existingEvent.recurrence.length > 0;
                    
                    if (newIsRecurring && existingIsRecurring) {
                      // Both are recurring - match by title, location, and time
                      const newLocation = (body.location || '').toLowerCase().trim();
                      const existingLocation = (existingEvent.location || '').toLowerCase().trim();
                      const locationMatch = !newLocation || !existingLocation || newLocation === existingLocation;
                      
                      // Extract time from start (HH:MM)
                      const newTimeMatch = newEventStart.match(/T(\d{2}):(\d{2})/);
                      const existingTimeMatch = existingStart.match(/T(\d{2}):(\d{2})/);
                      const timeMatch = !newTimeMatch || !existingTimeMatch || 
                                       (newTimeMatch[1] === existingTimeMatch[1] && newTimeMatch[2] === existingTimeMatch[2]);
                      
                      return locationMatch && timeMatch;
                    }
                    
                    // For non-recurring events, match by title + date
                    return dateMatch;
                  });
                  
                  if (duplicateEvent) {
                    const existingEventId = duplicateEvent.id;
                    validationErrors.push(`An event with the title "${body.summary}" already exists on the same date/time. You must UPDATE the existing event (use PUT method with event ID ${existingEventId}) instead of creating a duplicate. Check the "Existing Events" section in your context to find the event ID.`);
                    console.log(`🚫 Duplicate event detected: "${body.summary}" - existing event ID: ${existingEventId}`);
                  }
                }
              }
              
              // Check for fake/example email addresses (emails are optional, but if provided, they must be real)
              if (body.attendees && Array.isArray(body.attendees)) {
                for (const attendee of body.attendees) {
                  if (attendee.email && attendee.email.includes('@example.com')) {
                    validationErrors.push(`I cannot create an event with a fake email address (${attendee.email}). If you need to invite someone, please ask the user for their real email address. Otherwise, you can create the event without attendees.`);
                  }
                }
              }
              
              // HARD VALIDATION: Check if time is a default and wasn't explicitly mentioned
              if (body.start && body.start.dateTime && validationErrors.length === 0) {
                const timeMatch = body.start.dateTime.match(/T(\d{2}):(\d{2}):(\d{2})/);
                if (timeMatch) {
                  const hour = parseInt(timeMatch[1]);
                  const minute = parseInt(timeMatch[2]);
                  
                  // Check for common default times: 10:00 AM, 6:30 AM, or any round hour (XX:00) that's suspicious
                  // Also check for common meal times that might be defaults: 7 PM (dinner), 12 PM (lunch), 8 AM (breakfast)
                  const isSuspiciousDefault = (hour === 10 && minute === 0) || // 10:00 AM
                                             (hour === 6 && minute === 30) ||  // 6:30 AM
                                             (hour >= 9 && hour <= 11 && minute === 0) || // 9-11 AM (common defaults)
                                             (hour === 19 && minute === 0) || // 7:00 PM (common dinner default)
                                             (hour === 12 && minute === 0) || // 12:00 PM (common lunch default)
                                             (hour === 8 && minute === 0); // 8:00 AM (common breakfast default)
                  
                  if (isSuspiciousDefault) {
                    // Get all user messages from conversation history
                    const allUserMessages = conversationHistory
                      .filter(msg => msg.role === 'user')
                      .map(msg => normalizeMessageContent(msg.content).toLowerCase())
                      .join(' ');
                    
                    // Check if the SPECIFIC hour was mentioned (e.g., if time is 10:00, check for "10", "10am", "10:00", etc.)
                    const hour12 = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
                    const hourPattern = new RegExp(`\\b${hour12}\\b|\\b${hour}:${minute.toString().padStart(2, '0')}\\b|\\b${hour}\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)`, 'i');
                    const specificHourMentioned = hourPattern.test(allUserMessages);
                    
                    // Check for explicit time mentions (any time format like "2pm", "14:00", "7:30", etc.)
                    // This is more strict - must have actual time format, not just words like "at" or "time"
                    const explicitTimeMentioned = /\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\\.|p\.m\\.)|\d{1,2}:\d{2}/i.test(allUserMessages);
                    
                    // Check for vague time terms - if these are used, we should still reject defaults because system prompt says to ask for specific time
                    const vagueTimeTerms = /(?:morning|afternoon|evening|night|noon|midnight|breakfast|lunch|dinner)/i.test(allUserMessages);
                    
                    // REJECT if:
                    // 1. It's a suspicious default time (10:00 AM, 6:30 AM, 7:00 PM, etc.)
                    // 2. The specific hour wasn't mentioned
                    // 3. No explicit time format was mentioned
                    // Note: Even if vague terms are used, we reject defaults because system prompt requires asking for specific time
                    if (!specificHourMentioned && !explicitTimeMentioned) {
                      // Format the default time for display
                      let defaultTimeDisplay;
                      if (hour === 10) defaultTimeDisplay = '10:00 AM';
                      else if (hour === 6) defaultTimeDisplay = '6:30 AM';
                      else if (hour === 19) defaultTimeDisplay = '7:00 PM';
                      else if (hour === 12) defaultTimeDisplay = '12:00 PM';
                      else if (hour === 8) defaultTimeDisplay = '8:00 AM';
                      else defaultTimeDisplay = `${hour12}:00 ${hour >= 12 ? 'PM' : 'AM'}`;
                      
                      const reason = vagueTimeTerms 
                        ? `The user mentioned a vague time (like "morning", "afternoon", "dinner", etc.), but you must ask for a specific time before creating the event.`
                        : `The user didn't specify a time, but you're using a default time (${defaultTimeDisplay}).`;
                      
                      console.log(`⏰ Time validation: Rejecting default time ${defaultTimeDisplay}`);
                      console.log(`   - Specific hour mentioned: ${specificHourMentioned}`);
                      console.log(`   - Explicit time mentioned: ${explicitTimeMentioned}`);
                      console.log(`   - Vague terms found: ${vagueTimeTerms}`);
                      console.log(`   - User messages: ${allUserMessages.substring(0, 200)}...`);
                      
                      validationErrors.push(`${reason} Please ask the user: "What time should this be?" before creating the event.`);
                    }
                  }
                }
              }
              
              if (validationErrors.length > 0) {
                console.log(`❌ Hard validation failed for Google Calendar event:`);
                validationErrors.forEach(err => console.log(`   - ${err}`));
                return {
                  tool_call_id: block.id,
                  role: 'tool',
                  name: block.name,
                  content: JSON.stringify({
                    success: false,
                    error: 'Validation failed: Missing required information',
                    validation_errors: validationErrors,
                    note: validationErrors.join(' '),
                    message: validationErrors.join(' ')
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
              // Prefer user-friendly message if available, otherwise use error field
              let errorMessage = enhancedResult.note || enhancedResult.error || enhancedResult.message || 'Unknown error';
              if (typeof errorMessage === 'string' && errorMessage.length > 500) {
                errorMessage = errorMessage.substring(0, 500) + '...';
              }

              // Find appropriate schema for troubleshooting
              const adapterName = adapter.getName();
              const schema = toolSchemas.get(adapterName) || toolSchemas.get(apiName);
              
              enhancedResult = {
                ...enhancedResult,
                success: false,
                error: errorMessage, // Use user-friendly message
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

        // Check for rate limit or overloaded errors - rotate key and retry
        if (errorData.error?.type === 'rate_limit_error' || errorData.error?.type === 'overloaded_error') {
          const errorType = errorData.error?.type === 'rate_limit_error' ? 'rate limit' : 'overloaded';
          
          // Try rotating to next key
          const nextKey = rotateToNextKey();
          if (nextKey) {
            console.log(`⏳ Claude API ${errorType} error, rotating to next API key...`);
            this.claudeApiKey = nextKey;
            // Small delay before retry with new key
            await new Promise(resolve => setTimeout(resolve, 1000));
            return this.callClaude(payload, retryCount);
          }
          
          // If no more keys, use exponential backoff
          const delay = Math.min(baseDelay * Math.pow(2, Math.min(retryCount, 5)), maxDelay);
          console.log(`⏳ Claude API ${errorType} error, all keys exhausted, waiting ${delay}ms before retry (attempt ${retryCount + 1})...`);
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
        // Try rotating to next key
        const nextKey = rotateToNextKey();
        if (nextKey) {
          console.log(`⏳ Claude API error caught, rotating to next API key...`);
          this.claudeApiKey = nextKey;
          await new Promise(resolve => setTimeout(resolve, 1000));
          return this.callClaude(payload, retryCount);
        }
        
        // If no more keys, use exponential backoff
        const delay = Math.min(baseDelay * Math.pow(2, Math.min(retryCount, 5)), maxDelay);
        console.log(`⏳ Claude API error caught, all keys exhausted, waiting ${delay}ms before retry...`);
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
- You can combine data from multiple tools to provide comprehensive responses
- Always use the most appropriate tool for each operation

## Tool Routing:
- Each tool call can specify "api_name" to route to a specific tool
- If "api_name" is not specified, the call will go to the default tool
- Available tools: ${toolNames}

${adapters.some(a => a.getName() === 'attio') && adapters.some(a => a.getName() === 'google_calendar') ? `
## 🎯 Attio CRM + Google Calendar Integration - Common Use Cases:

**You can seamlessly combine Attio (CRM) and Google Calendar to create powerful workflows:**

### 1. **Schedule Meetings with Contacts**
**User:** "Schedule a meeting with John Smith next Tuesday at 2pm"
**Your Action:**
1. Look up "John Smith" in Attio (api_name: "attio") to get their email address
2. Create calendar event (api_name: "google_calendar") with John's email as attendee
3. Optionally: Create a note or task in Attio linked to this meeting

**Example Tool Calls:**
- \`call_api(api_name: "attio", method: "POST", path: "/v2/objects/people/records/query", body: { filter: { name: "John Smith" } })\`
- \`call_api(api_name: "google_calendar", method: "POST", path: "/calendars/primary/events", body: { summary: "Meeting with John Smith", start: {...}, attendees: [{ email: "john.smith@example.com" }] })\`

### 2. **Add Calendar Events to CRM Records**
**User:** "I had a meeting with Acme Corp yesterday"
**Your Action:**
1. Find/create "Acme Corp" company in Attio (api_name: "attio")
2. Create a note or activity in Attio linked to the company about the meeting
3. Optionally: Link to the calendar event if it exists

### 3. **Get Contact Info for Calendar Invites**
**User:** "Add Sarah to the meeting tomorrow"
**Your Action:**
1. Look up "Sarah" in Attio (api_name: "attio") to get their email
2. Update the calendar event (api_name: "google_calendar") to add Sarah as attendee

### 4. **Create Follow-up Tasks from Meetings**
**User:** "After my meeting with John, remind me to send a proposal"
**Your Action:**
1. Find the meeting in Google Calendar (api_name: "google_calendar")
2. Create a task/note in Attio (api_name: "attio") linked to John's contact record
3. Set the task with appropriate due date

### 5. **Sync Company Meetings to Deals**
**User:** "Schedule a demo with Acme Corp next week"
**Your Action:**
1. Find/create "Acme Corp" company in Attio (api_name: "attio")
2. Find/create related deal in Attio if it exists
3. Create calendar event (api_name: "google_calendar") for the demo
4. Link the calendar event to the deal/company in Attio (via notes or activities)

### 6. **Check Availability Before Scheduling**
**User:** "When can I meet with John next week?"
**Your Action:**
1. Look up John in Attio (api_name: "attio") to get their contact info
2. Check your calendar (api_name: "google_calendar") for availability
3. Suggest times that work for both

### 7. **Create Recurring Meetings with Contacts**
**User:** "Set up a weekly check-in with my team"
**Your Action:**
1. Find team members in Attio (api_name: "attio") to get their emails
2. Create recurring calendar event (api_name: "google_calendar") with all team members as attendees

### 8. **Link Calendar Events to Deals**
**User:** "Schedule a contract review meeting for the Acme deal"
**Your Action:**
1. Find the "Acme" deal in Attio (api_name: "attio")
2. Get contact emails from the deal's associated people/companies
3. Create calendar event (api_name: "google_calendar") with those contacts
4. Add a note to the deal in Attio linking to the meeting

**CRITICAL RULES FOR INTEGRATION:**
- **Always look up contacts in Attio first** before adding them to calendar events
- **Use real email addresses from Attio** - never create fake emails
- **Link related activities** - if you create a meeting, consider adding a note in Attio
- **Preserve data integrity** - if a contact doesn't exist in Attio, you can still create the calendar event (emails are optional)
- **Use hierarchical execution** when one tool depends on another (e.g., get email from Attio, then use it in Calendar)
- **Use parallel execution** when operations are independent (e.g., show all companies AND show all events)

### 9. **Automatic Data Collection & Syncing (CRITICAL)**
**User:** "Schedule a meeting with john@example.com next Tuesday at 2pm"
**Your Action:**
1. Create calendar event (api_name: "google_calendar") with john@example.com as attendee
2. **AUTOMATICALLY**: Look up "john" in Attio (api_name: "attio") to see if this contact exists
3. **If contact exists but email is missing**: Add the email to the contact in Attio
4. **If contact doesn't exist**: Optionally create the contact in Attio with the email
5. **Link the meeting**: Add a note in Attio about the scheduled meeting

**Key Principle: BE PROACTIVE ABOUT DATA COLLECTION**
- **When user provides ANY information** (email, phone, company name, etc.), automatically sync it to the appropriate tool
- **If you get an email for a calendar event**, check if that person exists in Attio and add/update their email
- **If you get a company name**, check if it exists in Attio and link the meeting to that company
- **If you create a meeting with someone**, add a note or activity in Attio about that meeting
- **Don't wait for the user to ask** - automatically collect and sync information whenever possible
- **Think of both tools as one unified system** - data should flow freely between them

**Examples of Proactive Syncing:**
- User provides email → Add to contact in Attio (if contact exists or create new)
- User mentions company name → Link meeting to company in Attio
- User schedules meeting → Create note/activity in Attio about the meeting
- User provides phone number → Add to contact in Attio
- User mentions a person → Look them up in Attio, get their info, use it for calendar event
` : ''}

Execute requests confidently using your complete knowledge of all connected tools!`;
  }
}

/**
 * Normalize Anthropic-style message content to plain text.
 * Handles strings, arrays of blocks, and objects with text/content fields.
 */
function normalizeMessageContent(content) {
  if (!content) {
    return '';
  }

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map(part => {
      if (!part) return '';
      if (typeof part === 'string') return part;
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      return '';
    }).join(' ');
  }

  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
  }

  return '';
}

