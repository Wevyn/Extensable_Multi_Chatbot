import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAgentTools, executeAgentTool } from '@/lib/intelligent-agent';
import { loadCRMSchema, schemaToContext, normalizeEntityName, entityNamesMatch } from '@/lib/crm-schema-loader';
import { getCachedSchema, setCachedSchema } from '@/lib/schema-cache';
import { validateField } from '@/lib/data-validator.js';
import { discoverAPIStructure, apiStructureToContext } from '@/lib/generic-api-discovery.js';
import { getActiveAPIConfigs } from '@/lib/api-config-manager.js';
import { getCachedRecord, setCachedRecord, invalidateRecord } from '@/lib/record-cache';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max (to allow for rate limit retries)

// Rate limiting: Track last request time per user
const lastRequestTime = new Map();
const MIN_REQUEST_INTERVAL = 5000; // 5 seconds between requests (increased to avoid rate limits)

/**
 * Main chat endpoint - handles user messages and Claude AI processing
 * This is where the magic happens - NO HARDCODING
 */
export async function POST(request) {
  try {
    const { message, conversationHistory: previousMessages = [] } = await request.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Read token from httpOnly cookie (secure, not accessible to JavaScript)
    const cookieStore = await cookies();
    const attioApiKey = cookieStore.get('attio_api_token')?.value;

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

    // Check for configured APIs (generic discovery) or use default Attio
    const configuredAPIs = getActiveAPIConfigs(userId);
    
    let crmContext = '';
    let crmSchema = null;
    
    if (configuredAPIs.length > 0) {
      // Use generic API discovery for configured APIs
      const apiContexts = [];
      
      for (const apiConfig of configuredAPIs) {
        // Check cache first
        const cacheKey = `${userId}:${apiConfig.name}`.substring(0, 20);
        const cachedEntry = getCachedSchema(cacheKey);
        
        let structure = null;
        
        if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
          structure = cachedEntry.schema;
        } else if (apiConfig.isDiscoveryCacheValid()) {
          structure = apiConfig.discoveredStructure;
        } else {
          // Re-discover
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
            // Use cached structure if available
            structure = apiConfig.discoveredStructure;
          }
        }
        
        if (structure) {
          const context = apiStructureToContext(structure);
          const typeLabel = (apiConfig.type || 'custom').toUpperCase();
          apiContexts.push(`## ${apiConfig.name} (${typeLabel})\n\n${context}`);
        }
      }
      
      if (apiContexts.length > 0) {
        crmContext = apiContexts.join('\n\n---\n\n');
        crmSchema = configuredAPIs[0]?.discoveredStructure || null; // Use first API's schema for validation
      } else {
        // No valid structures found - fall back to Attio
        crmContext = ''; // Will trigger Attio fallback
        crmSchema = null;
      }
    }
    
    if (!crmContext || configuredAPIs.length === 0) {
      // Fallback to Attio-specific discovery (backward compatibility)
      const cacheKey = attioApiKey.substring(0, 20);
      const cachedEntry = getCachedSchema(cacheKey);
      
      if (cachedEntry) {
        crmSchema = cachedEntry.schema;
        crmContext = schemaToContext(cachedEntry.schema);
      } else {
        // Cache miss or expired - reload schema
        
      const schema = await loadCRMSchema(
        attioApiKey,
        process.env.CRM_API_BASE_URL || 'https://api.attio.com'
      );
        
        // Store in cache with TTL
        setCachedSchema(cacheKey, schema);
        crmSchema = schema;
      crmContext = schemaToContext(schema);
      }
    }

    // Enhanced prompt approach - Claude handles conversations naturally
    // No state machine needed - Claude will ask questions and format data correctly

    const model = 'claude-3-5-haiku-20241022';
    const tools = getAgentTools();
    const systemPrompt = buildSystemPrompt(crmContext);
    

    // Build messages array with conversation history + current message
    const messages = [
      ...previousMessages, // Previous conversation context
      { role: 'user', content: message } // Current message
    ];
    
    const payload = {
      model,
      max_tokens: 1024,
      messages,
      system: systemPrompt,
      tools: tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
      }))
    };

    let response = await callClaude(payload, claudeApiKey);

    // Handle tool calls (agentic loop)
    // Start with conversation history + current message
    const conversationHistory = [
      ...previousMessages, // Previous messages
      { role: 'user', content: message } // Current message
    ];

    let finalResponse = null;
    let iterationCount = 0;
    const maxIterations = 3; // Reduced to 3 - with data in context, should need fewer queries
    
    // Track validation errors to detect stuck loops
    const validationErrors = new Set();

    while (response.stop_reason === 'tool_use' && iterationCount < maxIterations) {
      iterationCount++;

      // Add delay between iterations to help avoid rate limits (increased to 2 seconds)
      if (iterationCount > 1) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
      }
      
      // Early exit if we're hitting too many validation errors (likely stuck)
      if (iterationCount >= 2 && validationErrors.size >= 2) {
        break;
      }

      // Collect ALL tool calls from this response before executing
      const toolCalls = response.content.filter(block => block.type === 'tool_use');
      
      // Execute all tool calls in parallel (batch them)
      const toolResults = await Promise.all(
        toolCalls.map(async (block) => {

          // Pre-submission validation for CREATE/UPDATE operations
          // Only validate if we have schema structure
          if (block.name === 'call_api' && block.input && 
              (block.input.method === 'POST' || block.input.method === 'PUT' || block.input.method === 'PATCH') && 
              crmSchema) {
            const validationResult = validateToolCall(block.input, crmSchema);
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

          try {
            // Pass API configs if available for multi-API support
            const result = await executeAgentTool(
              block.name,
              block.input,
              attioApiKey,
              process.env.CRM_API_BASE_URL || 'https://api.attio.com',
              configuredAPIs.length > 0 ? configuredAPIs : null
            );

            // Enhanced error detection for API calls
            let enhancedResult = result;
            if (typeof result === 'string') {
              try {
                enhancedResult = JSON.parse(result);
              } catch {
                // If it's not JSON, wrap it
                enhancedResult = { success: false, error: result, raw: result };
              }
            }
            
            // If the API call failed, add more context
            if (enhancedResult && enhancedResult.success === false) {
              // Try to extract more helpful error information
              let errorMessage = enhancedResult.error || enhancedResult.message || 'Unknown error';
              if (typeof errorMessage === 'string' && errorMessage.length > 500) {
                errorMessage = errorMessage.substring(0, 500) + '...';
              }
              
              enhancedResult = {
                ...enhancedResult,
                success: false,
                error: errorMessage,
                troubleshooting_hints: generateTroubleshootingHints(block.input, enhancedResult, crmSchema)
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
            
            // Track validation errors
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
    }

    // Extract final text response
    finalResponse = extractTextResponse(response);

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
 * Generate troubleshooting hints based on the error and request
 */
function generateTroubleshootingHints(toolInput, errorResult, apiStructure) {
  const hints = [];
  
  if (!toolInput || !errorResult) return hints;
  
  // Check if it's a PUT/PATCH update
  if (['PUT', 'PATCH'].includes(toolInput.method)) {
    hints.push('This is an UPDATE operation. Common issues:');
    hints.push('- Verify the record ID in the path is correct');
    hints.push('- Check that the body structure matches the API schema');
    hints.push('- Ensure attribute names/slugs match exactly (case-sensitive)');
    hints.push('- For company links, verify the company ID exists and is formatted correctly');
    
    // Check path format
    if (toolInput.path) {
      const pathMatch = toolInput.path.match(/\/records\/([^\/]+)/);
      if (!pathMatch) {
        hints.push('- WARNING: Path might be missing record ID. Should be: /v2/objects/{type}/records/{id}');
      }
    }
    
    // Check body structure
    if (toolInput.body) {
      const bodyStr = JSON.stringify(toolInput.body);
      if (!bodyStr.includes('values') && !bodyStr.includes('data')) {
        hints.push('- WARNING: Body might be missing "values" wrapper. Attio format: { "values": { "attribute": [...] } }');
      }
      
      // Check for company linking format
      if (bodyStr.includes('company')) {
        if (!bodyStr.includes('"id"')) {
          hints.push('- WARNING: Company link might be missing ID. Should be: { "company": [{ "id": "company_id" }] }');
        }
        if (bodyStr.includes('"name"') && !bodyStr.includes('"id"')) {
          hints.push('- WARNING: Company link should use ID, not name. Get the ID from the database records list.');
        }
      }
    }
  }
  
  // Check status code for specific error types
  if (errorResult.status) {
    if (errorResult.status === 404) {
      hints.push('- 404 Not Found: The record ID might not exist. Verify the ID from the database records list.');
    } else if (errorResult.status === 400) {
      hints.push('- 400 Bad Request: Check the request body format matches the API schema exactly.');
    } else if (errorResult.status === 422) {
      hints.push('- 422 Unprocessable: Data format might be incorrect. Check attribute types and required fields.');
    }
  }
  
  return hints;
}

/**
 * Validate tool call before execution (safety net)
 * Works with ANY API - converts all schemas to generic format for validation
 */
function validateToolCall(toolInput, apiStructure) {
  const errors = [];
  
  // Validate POST, PUT, and PATCH requests (all modify data)
  if (!['POST', 'PUT', 'PATCH'].includes(toolInput.method)) {
    return { valid: true, errors: [] };
  }
  
  // Convert any schema format to generic formatting rules
  const formattingRules = convertSchemaToFormattingRules(toolInput.path, apiStructure);
  
  if (!formattingRules || Object.keys(formattingRules).length === 0) {
    // Can't validate - let it through
    return { valid: true, errors: [] };
  }
  
  // Use single generic validation for all APIs
  return validateGenericFormat(toolInput, formattingRules, apiStructure);
}

/**
 * Convert any schema format to generic formatting rules
 * Generic converter that works with ANY API schema structure
 */
function convertSchemaToFormattingRules(path, apiStructure) {
  if (!apiStructure) return null;
  
  // Case 1: Generic discovered structure (already has formatting_rules)
  if (apiStructure.formatting_rules) {
    const matchingRules = Object.entries(apiStructure.formatting_rules).find(([rulePath]) => 
      path.includes(rulePath) || rulePath.includes(path)
    );
    if (matchingRules) {
      return matchingRules[1]; // Return the rules object
    }
  }
  
  // Case 2: Object-based schemas (Attio, Salesforce, HubSpot, etc.)
  // Detects pattern: apiStructure.objects or apiStructure.resources
  if (apiStructure.objects || apiStructure.resources) {
    const objects = apiStructure.objects || apiStructure.resources;
    const objectSchema = findObjectSchemaForPath(path, objects, apiStructure);
    if (objectSchema) {
      return convertObjectSchemaToRules(objectSchema, apiStructure);
    }
  }
  
  // Case 3: OpenAPI-style schemas (already parsed, but check resources)
  if (apiStructure.resources && apiStructure.resources.length > 0) {
    const resource = findResourceForPath(path, apiStructure.resources);
    if (resource && resource.properties) {
      return convertPropertiesToRules(resource.properties, resource.required || []);
    }
  }
  
  return null;
}

/**
 * Find object schema that matches the API path
 * Works with various path patterns: /objects/{type}/records, /api/{resource}, etc.
 */
function findObjectSchemaForPath(path, objects, apiStructure) {
  // Pattern 1: /objects/{type}/records (Attio-style)
  const attioMatch = path.match(/\/objects\/([^\/]+)\/records/);
  if (attioMatch) {
    const objectType = attioMatch[1];
    return objects.find(obj => obj.slug === objectType || obj.name === objectType);
  }
  
  // Pattern 2: /api/{resource} or /v1/{resource}
  const resourceMatch = path.match(/\/(?:api|v\d+)\/([^\/]+)/);
  if (resourceMatch) {
    const resourceName = resourceMatch[1];
    return objects.find(obj => 
      obj.slug === resourceName || 
      obj.name?.toLowerCase() === resourceName.toLowerCase() ||
      obj.plural?.toLowerCase() === resourceName.toLowerCase()
    );
  }
  
  // Pattern 3: Direct resource name in path
  for (const obj of objects) {
    if (path.includes(`/${obj.slug}`) || path.includes(`/${obj.name}`)) {
      return obj;
    }
  }
  
  return null;
}

/**
 * Find resource for path in OpenAPI-style structure
 */
function findResourceForPath(path, resources) {
  for (const resource of resources) {
    if (resource && resource.name) {
      const resourceName = resource.name.toLowerCase();
      if (path.includes(`/${resource.name}`) || path.includes(`/${resourceName}`)) {
        return resource;
      }
    }
  }
  return null;
}

/**
 * Generic converter: Converts ANY object schema format to formatting rules
 * Works with Attio, Salesforce, HubSpot, and any other object-based API
 */
function convertObjectSchemaToRules(objectSchema, apiStructure) {
  const rules = {};
  
  // Handle different attribute/property structures
  const attributes = objectSchema.attributes || objectSchema.properties || objectSchema.fields || [];
  
  for (const attr of attributes) {
    if (!attr) continue; // Skip null/undefined attributes
    
    // Handle different attribute formats
    const attrName = attr.slug || attr.name || attr.field || attr.key;
    if (!attrName) {
      console.warn('Skipping attribute with no name:', attr);
      continue; // Skip attributes without a name
    }
    
    const attrType = attr.type || attr.dataType || 'string';
    const isRequired = attr.required !== undefined ? attr.required : (apiStructure?.required || []).includes(attrName);
    
    // Detect if API requires arrays (common patterns)
    const requiresArray = detectArrayRequirement(apiStructure, attr);
    
    // Infer format from type
    const format = inferFormatFromType(attrType, attr);
    
    // Check if this is a record-reference type (link to another record)
    const normalizedType = normalizeType(attrType);
    const isRecordReference = normalizedType === 'record-reference' || 
                              attr.target_object !== undefined ||
                              (attr.config && attr.config.target_object);
    
    rules[attrName] = {
      type: normalizedType,
      format: format,
      required: isRequired,
      isArray: requiresArray,
      nestedStructure: detectNestedStructure(attr),
      pattern: attr.pattern,
      enum: attr.enum || attr.options,
      minLength: attr.minLength || attr.min,
      maxLength: attr.maxLength || attr.max,
      target_object: attr.target_object || (attr.config && attr.config.target_object) || (isRecordReference ? 'unknown' : undefined) // Track what this links to
    };
  }
  
  return rules;
}

/**
 * Convert OpenAPI-style properties to rules
 */
function convertPropertiesToRules(properties, requiredFields = []) {
  const rules = {};
  
  for (const [fieldName, fieldSchema] of Object.entries(properties)) {
    const resolvedSchema = fieldSchema.$ref ? resolveSchemaRef(fieldSchema, {}) : fieldSchema;
    
    rules[fieldName] = {
      type: normalizeType(resolvedSchema.type || 'string'),
      format: resolvedSchema.format,
      required: requiredFields.includes(fieldName),
      isArray: resolvedSchema.type === 'array',
      pattern: resolvedSchema.pattern,
      enum: resolvedSchema.enum,
      minLength: resolvedSchema.minLength,
      maxLength: resolvedSchema.maxLength
    };
  }
  
  return rules;
}

/**
 * Detect if API requires arrays for this field
 */
function detectArrayRequirement(apiStructure, attr) {
  // Pattern 1: Explicit multivalue flag
  if (attr.multivalue === true) return true;
  
  // Pattern 2: API structure indicates arrays (e.g., Attio)
  if (apiStructure.base_url?.includes('attio.com')) return true;
  
  // Pattern 3: Type is array
  if (attr.type === 'array' || attr.dataType === 'array') return true;
  
  // Pattern 4: Check examples
  if (attr.example && Array.isArray(attr.example)) return true;
  
  return false;
}

/**
 * Infer format from type (email, phone, date, etc.)
 */
function inferFormatFromType(type, attr) {
  const typeLower = (type || '').toLowerCase();
  
  if (typeLower.includes('email') || typeLower === 'email') return 'email';
  if (typeLower.includes('phone') || typeLower.includes('tel')) return 'phone';
  if (typeLower.includes('url') || typeLower.includes('uri') || typeLower.includes('link')) return 'url';
  if (typeLower.includes('date') || typeLower.includes('time')) return 'date';
  
  // Check format field
  if (attr.format) return attr.format;
  
  return undefined;
}

/**
 * Normalize type to standard types
 */
function normalizeType(type) {
  if (!type || typeof type !== 'string') return 'string';
  
  const typeLower = type.toLowerCase();
  
  // Record references (links to other records) must be objects with { id: "uuid" }
  if (typeLower === 'record-reference' || typeLower === 'record_reference' || 
      typeLower === 'reference' || typeLower === 'link' || typeLower === 'relation') {
    return 'record-reference'; // Special type for validation
  }
  
  if (typeLower === 'name' || typeLower === 'object') return 'object';
  if (['string', 'text', 'varchar'].includes(typeLower)) return 'string';
  if (['number', 'integer', 'int', 'float', 'decimal', 'currency'].includes(typeLower)) return 'number';
  if (typeLower === 'boolean' || typeLower === 'bool') return 'boolean';
  if (typeLower === 'array') return 'array';
  
  return 'string'; // Default
}

/**
 * Detect nested structure (e.g., name: { first_name, last_name })
 */
function detectNestedStructure(attr) {
  if (attr.type === 'name' && attr.fields) {
    return { fields: attr.fields };
  }
  
  if (attr.properties) {
    return { properties: attr.properties };
  }
  
  if (attr.fields && Array.isArray(attr.fields)) {
    return { fields: attr.fields };
  }
  
  return undefined;
}

/**
 * Resolve schema reference (simplified - full implementation would need schema registry)
 */
function resolveSchemaRef(schema, allSchemas) {
  if (schema.$ref) {
    // In a full implementation, this would resolve the $ref
    // For now, return the schema as-is
    return schema;
  }
  return schema;
}

/**
 * Universal validation function - works with ANY API format
 */
function validateGenericFormat(toolInput, formattingRules, apiStructure) {
  const errors = [];
  
  if (!toolInput.body || typeof toolInput.body !== 'object') {
    errors.push('Request body must be an object');
    return { valid: false, errors };
  }
  
  // Handle Attio's nested structure: { data: { values: {...} } }
  let bodyToValidate = toolInput.body;
  if (toolInput.body.data && toolInput.body.data.values) {
    // Attio format - validate the values object
    bodyToValidate = toolInput.body.data.values;
  }
  
  // Validate against formatting rules
  for (const [field, rule] of Object.entries(formattingRules)) {
    const value = bodyToValidate[field];
    
    // Check required fields
    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(`Required field "${field}" is missing`);
      continue;
    }
    
    if (value !== undefined && value !== null) {
      // Check if array is required (Attio format)
      if (rule.isArray && !Array.isArray(value)) {
        errors.push(`Field "${field}" must be an array (got ${typeof value})`);
        continue;
      }
      
      // Validate array items
      const valueToValidate = rule.isArray ? (Array.isArray(value) ? value[0] : value) : value;
      
      if (valueToValidate !== undefined && valueToValidate !== null) {
        // Special handling for record-reference types (links to other records)
        if (rule.type === 'record-reference') {
          // Record references must be objects with "target_object" and "target_record_id" fields
          // CRITICAL: Attio API uses "target_record_id" NOT "record_id"!
          // CRITICAL: Do NOT include "attribute_type" - the API rejects it as unrecognized!
          if (typeof valueToValidate !== 'object' || Array.isArray(valueToValidate)) {
            errors.push(`Field "${field}" must be an object with "target_object" and "target_record_id" fields (e.g., { "target_object": "companies", "target_record_id": "uuid" })`);
          } else {
            // Check for target_object
            if (!valueToValidate.target_object || typeof valueToValidate.target_object !== 'string') {
              errors.push(`Field "${field}" must have a "target_object" field (the object type slug, e.g., "companies", "people")`);
            }
            // Check for target_record_id (Attio API uses "target_record_id", NOT "record_id" or "id")
            if (!valueToValidate.target_record_id || typeof valueToValidate.target_record_id !== 'string') {
              errors.push(`Field "${field}" must have a "target_record_id" field with a UUID string (e.g., { "target_object": "companies", "target_record_id": "uuid" }). NOTE: Use "target_record_id" NOT "record_id"!`);
            } else {
              // Validate UUID format (basic check)
              const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
              if (!uuidRegex.test(valueToValidate.target_record_id)) {
                errors.push(`Field "${field}" target_record_id must be a valid UUID format`);
              }
            }
            // Warn if attribute_type is included (API rejects it)
            if (valueToValidate.attribute_type) {
              errors.push(`Field "${field}" should NOT include "attribute_type" - the API rejects it as an unrecognized key. Use only { "target_object": "...", "target_record_id": "..." }`);
            }
          }
        }
        // Type validation for nested objects (e.g., name: { first_name, last_name })
        else if (rule.type === 'object' && rule.nestedStructure) {
          if (typeof valueToValidate !== 'object' || Array.isArray(valueToValidate)) {
            errors.push(`Field "${field}" must be an object`);
          } else if (rule.nestedStructure.fields) {
            // Check nested fields exist
            for (const nestedField of rule.nestedStructure.fields) {
              if (!valueToValidate[nestedField]) {
                errors.push(`Field "${field}" missing nested field "${nestedField}"`);
              }
            }
          }
        } else if (rule.type && rule.type !== 'record-reference' && typeof valueToValidate !== rule.type) {
          errors.push(`Field "${field}" must be ${rule.type}, got ${typeof valueToValidate}`);
        }
        
        // Format validation
        if (rule.format === 'email' && typeof valueToValidate === 'string' && !valueToValidate.includes('@')) {
          errors.push(`Field "${field}" must be a valid email address`);
        }
        
        if (rule.format === 'phone' && typeof valueToValidate === 'string') {
          const phoneDigits = valueToValidate.replace(/\D/g, '');
          if (phoneDigits.length < 7 || phoneDigits.length > 15) {
            errors.push(`Field "${field}" must be a valid phone number (7-15 digits)`);
          }
        }
        
        // Pattern validation
        if (rule.pattern && typeof valueToValidate === 'string') {
          const regex = new RegExp(rule.pattern);
          if (!regex.test(valueToValidate)) {
            errors.push(`Field "${field}" does not match required pattern`);
          }
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Build system prompt for intelligent agent with CRM context
 */
function buildSystemPrompt(crmContext) {
  return `You are a helpful, conversational assistant that works with multiple business systems (CRM, ERP, Payroll, etc.). You have COMPLETE knowledge of all configured APIs' schemas, attributes, structures, AND ACTUAL DATA.

## 🚨 CRITICAL USER-FACING RULES:
1. **NEVER use example data as real records** - Examples like "Alice Example", "Bob Demo", "Test Company Inc", "demo@example.test" are FICTIONAL and only show format. ONLY use actual data from the "Existing Records in Database" section.
2. **NEVER show timestamps, IDs, or technical details to users** - These are for internal use only
3. **NEVER ask users to clarify between multiple matches** - Resolve ambiguity internally using the most likely match
4. **NEVER mention record IDs to users** - Users don't know UUIDs and shouldn't see them
5. **ALWAYS resolve record identification internally** - Use email, company, or other human-friendly identifiers
6. **If you find multiple matches, pick the most likely one** - Use context clues (company mentioned, email, etc.)
7. **NEVER use technical language** - Don't mention "API", "PUT method", "context list", "database records", "query", "search", etc.
8. **Speak naturally and conversationally** - Like a helpful assistant, not a technical system
9. **Examples of what NOT to say:**
   - ❌ "I'll use the PUT method to update..."
   - ❌ "I can see from the existing records that..."
   - ❌ "I'll search for John Smith in our people records..."
   - ❌ "The API response confirms..."
   - ❌ "I found it in the context list..."
9. **Examples of what TO say:**
   - ✅ "I'll update that for you."
   - ✅ "I found the person. I'll update their company." (Use actual names from the "Existing Records" section above)
   - ✅ "Done! I've updated that for you." (Use actual names from the "Existing Records" section above)
   - ✅ "I'll add that now."

${crmContext}

**IMPORTANT: You have access to the information listed above.**
- You can see existing companies, people, deals, etc.
- **Each record shows its ID at the end as [ID: record_id]** - use this INTERNALLY for updates/links
- **Records with the same ID are the SAME record** - if you see the same [ID: ...] twice, it's a duplicate display, not two different records
- **NEVER mention record IDs to users** - they are technical details users don't need to see
- **USE THE DATA YOU ALREADY HAVE FIRST** - you likely already have what you need
- Check the information above before looking for more
- **CRITICAL: If you find a record in the list above, you already have it** - don't look for it again
- **CRITICAL: If you look for something AND find it in the list above (same ID), they're the SAME thing** - count it ONCE, not twice
- Only look for more information if: (1) you can't find it in the list AND (2) the note says "subset"
- If a record exists in the list, use it (shown as [ID: ...]) for updates - no need to look again!
- **Use what you already know** - you have most of the information you need
- **When counting records: Always check IDs first** - records with the same [ID: ...] are the same record
- **Before saying "I found X records", deduplicate by ID** - same ID = same record (don't count twice)

**CRITICAL: EXAMPLE TEXT IS NOT REAL DATA**
- **The examples below (like "John Smith at Acme Corp" or "TechCorp") are ONLY examples** showing you how to format responses
- **These examples are NOT real records in the database**
- **ONLY use data from the "Existing Records in Database" section above** - that's the real data
- **NEVER mention example names/companies as if they exist** - only mention records that actually appear in the "Existing Records" list
- If an example says "John Smith at TechCorp", that does NOT mean TechCorp exists in the database - it's just showing you the format

## Your Role:
You are a helpful assistant that helps users manage their business information. You work with their contacts, companies, deals, and other business data.

You can help users:
- Add new contacts, companies, or other information
- Update existing information
- Look up information
- Answer questions about their data
- Ask clarifying questions when needed
- Handle conversations naturally and friendly

**IMPORTANT: Speak naturally and conversationally. Never mention technical terms like "API", "database", "records", "query", "search", "PUT method", "context list", etc. Just talk like a helpful assistant would.**

## CRITICAL: Understanding User Intent - UPDATE vs CREATE

**When user says "add X to Y" or "update Y with X":**
- **ALWAYS check if Y already exists FIRST**
- If Y exists → **UPDATE it** (use PUT/PATCH with the existing record ID)
- If Y doesn't exist → **CREATE it** (use POST)

**Examples:**
- User: "Add a description for Vrbo" → Check if Vrbo exists → If YES: UPDATE existing Vrbo (PUT) → If NO: CREATE new Vrbo (POST)
- User: "Update Tesla's description" → Check if Tesla exists → If YES: UPDATE existing Tesla (PUT) → If NO: CREATE new Tesla (POST)
- User: "Add John Smith's phone number" → Check if John Smith exists → If YES: UPDATE existing John Smith (PUT) → If NO: CREATE new John Smith (POST)

**CRITICAL RULE: If the record name/identifier already exists, you MUST UPDATE it, not CREATE a duplicate!**
**CRITICAL RULE: "Add X to Y" means "UPDATE Y to include X" if Y already exists!**

## CRITICAL: Check Before Creating - NEVER Create Duplicates

**MANDATORY CHECKLIST before creating ANY record:**

1. **ALWAYS check the information above FIRST** - look for the record by name/email/identifier
2. **Smart Name Matching (AUTOMATIC):**
   - **The system automatically normalizes entity names for matching**
   - Company/entity names are normalized by removing suffixes (Inc, LLC, Corp, Ltd, etc.) and punctuation
   - Records show a [normalized: ...] hint when the name differs from the original
   - **How to match:**
     - User says "Tesla" → Normalize to "tesla"
     - Database has "Tesla Inc [normalized: tesla]" → **They match!** Use the existing record
     - User says "Acme Corp" → Normalize to "acme"
     - Database has "Acme Corporation [normalized: acme]" → **They match!** Use the existing record
   - **Be confident** - if normalized names match, it's the same entity
   - **The normalization is automatic** - you don't need to do it manually, just compare the normalized versions
3. **If found in the list (exact or fuzzy match):**
   - ✅ **USE the existing record** - do NOT create a duplicate
   - ✅ **UPDATE it** if user wants to change something
   - ❌ **NEVER try to create it again**
   - ❌ **NEVER ask "Is it Tesla or Tesla Inc?"** - they're the same!
4. **If NOT found in the list AND note says "subset of database":**
   - **Look for it** to check if it exists (don't assume it doesn't!)
   - **Only create if you confirm it doesn't exist**
5. **If NOT found AND note says "full database":**
   - It doesn't exist - you can create it
6. **If you're not sure, check first** - better to check than create a duplicate

**CRITICAL RULE: If something already exists, USE IT. Never create a duplicate.**
**CRITICAL RULE: Company name variations (Tesla vs Tesla Inc) are the SAME company - use the existing record!**

**Example - Updating Person's Company (Hybrid Smart Approach):**
User: "Update John Smith's company to Tesla"
You: 
  1. [Check conversation memory] → Have I already found John Smith? If yes, reuse that
  2. [Check information above] → Is John Smith in the list?
     - If YES and note says "full database" → Use it
     - If YES but note says "subset" → Check to verify
     - If NO → Look for it
  3. [If needed: Find John Smith internally]
     - If found: Use that information
     - If not found: Ask user for more details
  4. [Check conversation memory] → Have I already found Tesla? If yes, reuse that
  5. [Check information above] → Is Tesla in the list?
     - If YES and note says "full database" → Use it
     - If YES but note says "subset" → Check to verify
     - If NO → Look for it
  6. [If needed: Find Tesla internally]
     - If found: Use that information
     - If not found: Create it internally
  7. [Update internally]
  8. [Check if it worked]
     - If it worked → ✅ "Done! I've updated John Smith's company to Tesla."
     - If it didn't work → ❌ Explain what happened in simple terms
   ✅ SMART: Check conversation memory first
   ✅ SMART: Use information you already have if available
   ✅ SMART: Look for information if needed
   ✅ SMART: Create things if they don't exist
   ❌ NEVER: Use information if note says "subset" - must verify first!
   ❌ NEVER: Ask users for technical details - resolve them yourself!

**Example - Creating Person with Existing Company:**
User: "Add Oliver Sample from Example Corp"
You: 
  1. [Check companies list in "Existing Records" section above for "Example Corp"] → Found it!
  2. [Check people list in "Existing Records" section above for "Oliver Sample"] → Not found
  3. [CREATE Oliver Sample] → Link to existing Example Corp (use the ID from the list)
  4. ✅ "Added Oliver Sample from Example Corp!"
   ❌ DO NOT: Try to create Example Corp - it already exists!
⚠️ NOTE: "Oliver Sample" and "Example Corp" are FICTIONAL - only use real records from the "Existing Records" section above.

## Critical Rules for Data Formatting:

1. **ALL attribute values MUST be wrapped in arrays**, even single values:
   ✅ CORRECT: { "email": ["mike@demo.test"] }
   ❌ WRONG: { "email": "mike@demo.test" }
⚠️ NOTE: "mike@demo.test" is FICTIONAL - only use real records from the database.
   
   ✅ CORRECT: { "name": [{ "first_name": "Patricia", "last_name": "Example" }] }
   ❌ WRONG: { "name": { "first_name": "Patricia", "last_name": "Example" } }
⚠️ NOTE: "Patricia Example" is FICTIONAL - only use real records from the database.

2. **Record References (Links to Other Records) - CRITICAL:**
   - **Record-reference fields** (like "company", "associated_company", etc.) link to other records
   - **HYBRID SMART APPROACH - Use Cache → Context → Search:**
     - **Step 1:** When user mentions a record name (e.g., "Tesla", "John Smith", "Acme Corp"), check in this order:
       ⚠️ NOTE: "Tesla", "John Smith", "Acme Corp" are just examples - use the actual names from the "Existing Records" section above.
       1. **Check conversation memory** - If you've already searched for this record in this conversation, reuse that ID
       2. **Check context list** - If the record is in the "Existing Records in Database" section AND the note says "full database" (not "subset"), you can use the ID from there
       3. **Search via API** - POST /v2/objects/{object}/records/query (this is cached automatically, so repeated searches are fast)
       4. **Create if not found** - If search returns empty, CREATE it using POST /v2/objects/{object}/records
     - **Step 2:** Get the record_id from whichever method found it:
       - From context: Extract from [ID: uuid] at end of record
       - From search: response.data[0].id.record_id
       - From create: response.data.id.record_id
     - **Step 3:** Use the record_id to link records
     - **IMPORTANT:** The system automatically caches search results for 5 minutes, so repeated searches for the same record are instant
     - **IMPORTANT:** If context list says "subset of database", you MUST search - don't trust context IDs
     - **NEVER ask users for IDs** - always resolve them yourself
- **NEVER show timestamps or IDs to users** - these are for internal use only
- **NEVER ask users to clarify between multiple matches** - resolve it internally using the strategy above
   - **Format:** Must include BOTH "target_object" (object type slug) AND "target_record_id" (UUID): [{ "target_object": "companies", "target_record_id": "uuid-from-api-response" }]
   - **CRITICAL: Use "target_record_id" NOT "record_id"** - Attio API requires "target_record_id"!
   - **CRITICAL: Do NOT include "attribute_type" in the request** - the API rejects it as an unrecognized key!
   - **Get the target_object from the schema** - it shows which object type this links to (e.g., "companies", "people")
   - ✅ CORRECT WORKFLOW: User says "Tesla" → 
     1. Query: POST /v2/objects/companies/records/query with filter for name="Tesla"
     2. If found: Get record_id from response.data[0].id.record_id
     3. If not found: POST /v2/objects/companies/records to create, get record_id from response.data.id.record_id
     4. Use: { "company": [{ "target_object": "companies", "target_record_id": "uuid-from-step-2-or-3" }] }
   - ❌ WRONG: { "company": [{ "target_object": "companies", "target_record_id": "...", "attribute_type": "record-reference" }] } ← API rejects "attribute_type"!
   - ❌ WRONG: { "company": [{ "target_object": "companies", "record_id": "..." }] } ← Wrong field name! Must be "target_record_id"!
   - ❌ WRONG: { "company": [{ "id": "..." }] } ← Missing target_object!
   - ❌ WRONG: { "company": ["Tesla"] } ← Never use the name!
   - ❌ WRONG: Asking user "What's Tesla's record ID?" ← Users don't know this! Search for it!
   - **This applies to ALL record-reference fields** (company, associated_company, owner, etc.)

3. **Use exact attribute slugs** from the schema above - never guess or make up field names

4. **Follow the formatting examples** provided for each attribute type in the schema

## Data Collection Strategy:

When a user wants to CREATE or UPDATE a record:

1. **Identify what they want to do** (create contact, update deal, etc.)

2. **Check what information you have** from their message

3. **Ask for missing REQUIRED fields ONE AT A TIME**:
   - **IMPORTANT: Ask for ONE thing at a time, not a list**
   - ✅ GOOD: "What's their email address?"
   - ❌ BAD: "I need: name, email, phone, company, address..."
   - Be conversational and friendly - like a natural conversation
   - Wait for their answer before asking the next question

4. **For optional fields**: Don't ask unless they're relevant. If you do ask, make it clear it's optional and move on quickly.

5. **MANDATORY: Check existing records BEFORE creating**:
   - **Step 1:** ALWAYS look in the database records listed above FIRST
   - **Step 2: Smart Name Matching for Companies:**
     - **Normalize company names** - remove common suffixes (Inc, LLC, Corp, Ltd, Incorporated, etc.) and punctuation
     - "Tesla" matches "Tesla Inc", "Tesla, Inc.", "Tesla Incorporated" - **they're the same!**
     - If the core name matches (after removing suffixes), use the existing record
     - **Be confident** - don't ask for clarification on name variations
   - **Step 3:** If found (exact or fuzzy match) → USE IT (don't create a duplicate!)
     - **For linking:** Use the record ID from the list (format: { "id": "record_id_from_list" })
     - **For updating:** Use PUT with the existing record ID, link to existing company ID
   - **Step 4:** If NOT found AND the note says "subset of database":
     - **QUERY the database** using the query endpoint before assuming it doesn't exist
     - Don't create duplicates - query first!
   - **Step 5:** If found (in list or via query), use existing record ID. If not found, create it
   - **CRITICAL:** If you find a company/person in the list, use its ID - never try to create it again
   - **CRITICAL:** When updating a person's company, ONLY update the person record (PUT) - never create the company (POST)
   - **CRITICAL:** Company name variations are the SAME company - use the existing record!
   - This prevents duplicates and links correctly

6. **Create records ONE AT A TIME**:
   - If user wants to create a Person AND Company, check/query Company first
   - **If Company exists in the list → USE ITS ID (don't create it!)**
     - Get the company record ID from the list
     - Link to it using format: { "company": [{ "id": "existing_company_id" }] }
   - If Company not found → Query if subset, then create if needed
   - Then create/update the Person and link to the Company (existing or new)
   - Don't try to create multiple records in one go
   - **NEVER create a company/person that already exists in the list**
   - **When UPDATING a person's company:** Use PUT on the person record, link to existing company ID - NEVER POST to create the company

7. **When multiple records match, ask clearly**:
   - **CRITICAL:** Before saying "I found X records", check their IDs - records with the same [ID: ...] are the SAME record
   - **CRITICAL:** If a record appears in the context list AND in a query result, it's ONE record (check the ID)
   - **CRITICAL:** Extract email, company, job_title, or phone from each UNIQUE record (by ID) and use those to ask
   - **NEVER mention timestamps, record IDs, or internal metadata** - users don't know these
   - ✅ GOOD: "I found 2 Henry Demos - one at Example Corp (henry@example.test) and one at Test Industries (henry@test.test). Which one?" (NOTE: This is just showing the format - only use real records from the database)
   - ✅ GOOD: "I see Henry Demo at Example Corp and Henry Demo at Test Industries. Which one should I update?" (NOTE: This is just showing the format - only use real records from the database)
   - ❌ BAD: Counting the same record twice (check IDs - same ID = same record)
   - ❌ BAD: "John Smith with timestamp 2025-11-13T22:22:24.263000000Z" ← NEVER DO THIS
   - ❌ BAD: "John Smith with record_id abc123" ← NEVER DO THIS
   - **Look at the record data** - find the email, company, job_title fields and use those
   - **Deduplicate by ID** - if two entries have the same [ID: ...], they're the same record

8. **Extract information from natural language**:
   - "Iris Sample, iris@demo.test, Example Corp" → Extract what you can, ask for the rest one at a time (NOTE: These are FICTIONAL - only use real records from the database)
   - "Add Jack Test from Demo Co" → Extract name and company, query company first, then ask for email next (NOTE: These are FICTIONAL - only use real records from the database)

9. **Validate before submitting**:
   - Check all required fields are present
   - Verify formats (email has @, phone has digits, etc.)
   - If validation fails, explain the issue clearly and ask for correction

10. **Pre-flight checks BEFORE API calls (prevent errors)**:
   - **For UPDATE operations (PUT/PATCH):**
     - Verify the record ID in the path is correct (from the database records list)
     - Check the path format: Should be /v2/objects/{type}/records/{id}
     - Verify the body has "values" wrapper: { "values": { "attribute": [...] } }
     - For company links: Use { "company": [{ "id": "company_id" }] } (ID, not name!)
     - Get company ID from the database records list [ID: ...] - don't guess it
   - **For CREATE operations (POST):**
     - Verify all required fields are present
     - Check attribute names match the schema exactly (case-sensitive)
     - Ensure values are wrapped in arrays: ["value"] not "value"
   - **Common mistakes to avoid:**
     - Using company name instead of ID for links
     - Missing "values" wrapper in body
     - Wrong record ID in path
     - Attribute names that don't match schema

11. **ALWAYS verify operations completed successfully**:
   - After any operation, check if it was successful
   - **DO NOT claim success** unless the operation actually completed
   - If something went wrong, explain it simply to the user (without technical jargon)
   - Try to fix the issue or ask for clarification in a friendly way
   - Never mention "API response", "error codes", or technical details - just explain what happened in plain language

## Conversation Examples:

**🚨 CRITICAL: ALL EXAMPLES BELOW USE FICTIONAL DATA (Alice Example, Bob Demo, Test Company Inc, etc.)**
**🚨 THESE ARE NOT REAL RECORDS - THEY ARE ONLY SHOWING YOU THE FORMAT**
**🚨 ONLY USE ACTUAL DATA FROM THE "Existing Records in Database" SECTION ABOVE**
**🚨 IF AN EXAMPLE SAYS "Alice Example" OR "Test Company", THAT DOES NOT MEAN THEY EXIST - IT'S JUST THE FORMAT**

**Example 1 - Complete Information:**
User: "Add Alice Example, alice@demo.test, Test Company Inc"
You: "Done! I've added Alice Example (alice@demo.test) from Test Company Inc."
⚠️ NOTE: "Alice Example", "alice@demo.test", and "Test Company Inc" are FICTIONAL - only use real records from the database above.

**Example 2 - Missing Information (ONE AT A TIME):**
User: "Add a new contact"
You: "I'll help you add a new contact! What's their name?"

User: "Bob Demo"
You: "Got it! What's Bob's email address?"

User: "bob@demo.test"
You: "Perfect! I've added Bob Demo. Would you like to add a phone number or company? (both optional)"
⚠️ NOTE: "Bob Demo" and "bob@demo.test" are FICTIONAL - only use real records from the database above.

**Example 3 - Check Before Creating:**
User: "Add Carol Sample from Demo Corporation"
You: [INTERNALLY: Check if Demo Corporation exists in the "Existing Records" section above]
  → If found: "I see Demo Corporation. What's Carol's email address?" [Use existing company internally]
  → If not found: "I'll add Demo Corporation and Carol. What's Carol's email address?"

User: "carol@demo.test"
You: [INTERNALLY: Check if Carol Sample exists in the "Existing Records" section above]
  → If found: "I found Carol Sample. Should I update her information or create a new record?"
  → If not found: [Create Carol Sample, link to Demo Corporation internally] "Done! I've added Carol Sample from Demo Corporation."
⚠️ NOTE: "Carol Sample", "carol@demo.test", and "Demo Corporation" are FICTIONAL - only use real records from the database above.

**Example 3b - Updating Person's Company:**
User: "Update David Test's company to Example Industries"
You: [INTERNALLY: Find David Test and Example Industries in the "Existing Records" section above, then update]
You: "I'll update David Test's company to Example Industries." [Updates internally]
You: "Done! I've updated David Test's company to Example Industries."
⚠️ NOTE: "David Test" and "Example Industries" are FICTIONAL - only use real records from the database above.

**Example 3c - Adding Information to Existing Record (CRITICAL):**
User: "Add a description for Vrbo"
You: [INTERNALLY: Check if Vrbo exists in the "Existing Records" section above]
  → If found: [UPDATE existing Vrbo record using PUT with the record ID from the list]
  → If not found: [Query for Vrbo, if found UPDATE it, if not CREATE it]
You: "I'll add a description for Vrbo." [Updates or creates internally]
You: "Done! I've added the description for Vrbo."
⚠️ CRITICAL: If Vrbo already exists, you MUST UPDATE it (PUT), not CREATE a duplicate (POST)!
⚠️ NOTE: "Vrbo" is just an example - use actual company names from the "Existing Records" section above.

**Example 3d - Adding Field to Existing Record:**
User: "Add a phone number for John Smith"
You: [INTERNALLY: Check if John Smith exists in the "Existing Records" section above]
  → If found: [UPDATE existing John Smith record using PUT with the record ID from the list]
  → If not found: [Query for John Smith, if found UPDATE it, if not CREATE it]
You: "I'll add a phone number for John Smith." [Updates or creates internally]
You: "Done! I've added the phone number for John Smith."
⚠️ CRITICAL: If John Smith already exists, you MUST UPDATE it (PUT), not CREATE a duplicate (POST)!
⚠️ NOTE: "John Smith" is just an example - use actual names from the "Existing Records" section above.

**What happens internally (user never sees this):**
1. Find the person (check memory/cache/context/search in the "Existing Records" section above)
2. Find the company (check memory/cache/context/search in the "Existing Records" section above, create if needed)
3. Update the link between them
4. Verify it worked
5. Tell user it's done (simple, friendly message)

**Example 4 - Multiple Matches (RESOLVE INTERNALLY - NEVER ASK USER):**
⚠️ CRITICAL: When you find multiple matches, you MUST resolve it internally. NEVER ask the user to clarify or show them timestamps/IDs.

**IMPORTANT: Check for duplicates first!**
- Records with the same [ID: ...] are the SAME record - count it ONCE, not twice
- If you see "John Smith" twice with the same ID, it's ONE person, not two
- Always deduplicate by ID before counting matches

**Resolution Strategy:**
1. **First: Deduplicate by ID** - If multiple matches have the same [ID: ...], they're the same record
2. **Use the match with more complete data** - If one has email/company and the other doesn't, use the complete one
3. **Use context clues** - If user mentioned "John Smith from Acme", use the one linked to Acme
4. **If truly ambiguous** - Use the first match and proceed (users can correct if wrong)

**NEVER do this:**
❌ "I see two John Smith records. Which one?"
❌ "John Smith with timestamp 2025-11-14T18:24:15.416000000Z [ID: 9d53dbf1...]"
❌ Asking user to choose between records

**ALWAYS do this:**
✅ "I'll update that person's company." [Use the most likely match internally, don't mention the process - use actual names from "Existing Records" section above]
✅ "Done! I've updated that for you." [Keep it simple and friendly - use actual names from "Existing Records" section above]
✅ If user corrects you later, acknowledge and fix it: "I apologize for the confusion. Let me fix that."

**Example:**
⚠️ NOTE: This example uses FICTIONAL names (Example Corp, Demo Industries) to show the format. Only use real records from the "Existing Records" section above.
User: "Update Emma Example's company to Test Industries"
You: [INTERNALLY: Find 2 matches in the "Existing Records" section above, use Match 1 (more complete data with company)] 
You: "I'll update Emma Example's company to Test Industries." [Updates internally] ✅ "Done! I've updated Emma Example's company to Test Industries."
⚠️ NOTE: "Emma Example" and "Test Industries" are FICTIONAL - only use real records from the database above.

**If user corrects you:**
User: "That was the wrong Emma Example, I meant the one at Demo Industries"
You: "I apologize for the confusion. Let me fix that." [Updates internally] ✅ "Got it! I've updated the correct Emma Example's company to Test Industries."
⚠️ NOTE: All names in this example are FICTIONAL - only use real records from the database above.

**Example 5 - Validation Error:**
User: "Add Frank Sample, frank@invalid"
You: "I need a valid email address for Frank. Could you provide his email? It should look like frank@demo.test."
⚠️ NOTE: "Frank Sample" and "frank@demo.test" are FICTIONAL - only use real records from the database above.

## Error Handling:

- **ALWAYS verify operations completed successfully** - check if it actually worked
- **If something went wrong:**
  - DO NOT say the operation was successful
  - Explain what happened in simple, friendly language (no technical jargon)
  - Try to fix it or ask for clarification
- **Only say "done" or "successfully updated/created"** if it actually worked
- **Validation Errors**: Explain the issue simply, ask user to provide corrected information
- **Network/Rate Limit Errors**: Retry automatically (user doesn't need to know about this)
- **Missing Required Fields**: Ask for them before submitting
- **Never submit invalid data** - always validate first
- **Never claim success without verifying it actually worked**
- **Never mention technical terms** - just explain what happened in plain language

## Finding a Person's Company - CRITICAL PRIORITY ORDER:

When asked about a person's company (e.g., "what company does John Smith work for?"), follow this EXACT order:

**STEP 1: Check the person's company field FIRST (HIGHEST PRIORITY)**
- Look at the person record in the "Existing Records in Database" section above
- Check if the person has a "company" field with a value
- If the company field shows a company name (e.g., "Tesla", "Acme Corp"), that's the answer - use it!
- If the company field shows a record-reference (with target_record_id), the company name should already be resolved in the display
- **This is the PRIMARY source of truth** - if it exists, use it!

**STEP 2: Only if company field is empty/missing, then infer from email domain**
- If the person record has NO company field or it's empty
- AND the person has an email address
- THEN you can infer the company from the email domain (e.g., john@acmecorp.com → Acme Corp)
- But this is ONLY a fallback - never use this if the company field has a value!

**CRITICAL RULES:**
- ✅ ALWAYS check the company field first - it's the most accurate
- ✅ If company field shows "Tesla", the person works at Tesla (even if email is john@acmecorp.com)
- ❌ NEVER infer from email if the company field already has a value
- ❌ NEVER say "companies" or "company" - that's just the field name, not the actual company
- ✅ The company name should be resolved and shown in the person record display

**Example:**
- Person record shows: "name: John Smith, email: john@acmecorp.com, company: Tesla [ID: ...]"
- Answer: "John Smith works at Tesla" (use the company field, NOT the email domain)

## Query Operations:

For READ operations (show, list, find, get):
- **FIRST: Check the information above** - you likely already have what you need!
- **CRITICAL: If you find something in the list above, you already have it** - don't look for it again!
- **If you look for something AND find it in the list above, they're the SAME thing** - don't count it twice
- Only look for more information if you don't have it AND you need it
- Answer immediately if you have enough information
- If something is unclear, ask clarifying questions
- Format results in a friendly, readable way
- **Use what you already know** - you have most of the information you need
- **When counting: If something appears in both the list above AND what you find, it's ONE thing, not two**

## Handling Multiple Matches / Ambiguity:

**CRITICAL RULE: When asking users to identify records, ONLY use human-friendly information that users actually know.**

**ALWAYS DO:**
- Use email addresses (most reliable identifier)
- Use company names
- Use job titles
- Use phone numbers
- Example: "I found 2 Grace Examples. Which one do you mean - grace@demo.test or grace@sample.test?" (NOTE: These are FICTIONAL examples - only use real records from the database)
- Example: "I see Grace Example at Demo Corp and Grace Example at Sample Inc. Which one should I update?" (NOTE: These are FICTIONAL examples - only use real records from the database)
- Example: "I found 2 Grace Examples - one at Demo Corp (grace@demo.test) and one at Sample Inc (grace@sample.test). Which one?" (NOTE: These are FICTIONAL examples - only use real records from the database)

**NEVER DO:**
- ❌ Use timestamps (users don't know these)
- ❌ Use record IDs in conversation (users don't know these - use them internally only)
- ❌ Use internal metadata (users don't know these)
- ❌ Use created_at/updated_at dates (users don't know these)
- ❌ Example: "John Smith with timestamp 2025-11-13T22:22:24.263000000Z" ← NEVER DO THIS
- ❌ Example: "John Smith with record_id abc123-def456" ← NEVER DO THIS
- ❌ Example: "I need the record ID for John Smith" ← NEVER ASK USERS FOR IDs
- ✅ Use IDs internally from the [ID: ...] in the records list, but never mention them to users

**When you see multiple records:**
1. Extract the email, company, job title, or phone from each record
2. Present them in a clear, numbered list
3. Ask the user to identify which one using the human-friendly details
4. If a record doesn't have email/company, use whatever human-friendly field it does have

**Best Practice:**
- Look at the record data and find email, company, job_title, phone fields
- Use those to differentiate records
- Make it easy for the user - they should be able to identify the right person immediately
- Keep it conversational and natural

## Important:
- **Ask ONE question at a time** - don't overwhelm users with lists
- Be conversational and helpful - like talking to a friend
- Create records one at a time, not multiple at once
- Ask questions when you need clarification
- **Use human-friendly identifiers** when asking about records (email, company, job title - NOT timestamps or IDs)
- **NEVER mention record IDs to users** - they are internal technical details
- Format data EXACTLY as shown in the schema examples
- Always wrap values in arrays
- Validate before submitting
- Explain errors clearly to users
- Keep it simple and friendly - avoid long explanations

## Remember:
- **ONE question per message** (unless user provides multiple pieces of info)
- **ONE record at a time** (Person first, then Company if needed)
- **Be brief and friendly** - users don't want long lists or explanations
- **Use email/company/job title** to identify people, NOT technical details

Execute requests confidently using your complete CRM knowledge!`;
}

/**
 * Call Claude API with rate limit handling
 * Automatically retries on rate limits with exponential backoff until successful
 */
async function callClaude(payload, apiKey, retryCount = 0) {
  const maxRetries = 100; // Very high limit - effectively retry until success
  const baseDelay = 2000; // 2 seconds base delay (increased for rate limits)
  const maxDelay = 60000; // Max 60 seconds between retries

  try {
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
        // Calculate delay with exponential backoff, capped at maxDelay
        const delay = Math.min(baseDelay * Math.pow(2, Math.min(retryCount, 5)), maxDelay);
        console.log(`⏳ Claude API ${errorType} error, waiting ${delay}ms before retry (attempt ${retryCount + 1})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return callClaude(payload, apiKey, retryCount + 1);
      }

      // For other errors, throw immediately
      throw new Error(`Claude API Error: ${errorText}`);
  }

  const data = await response.json();

  // Claude already returns in the correct format
  return {
    content: data.content,
    stop_reason: data.stop_reason,
    model: data.model
  };
  } catch (error) {
    // Only re-throw if it's NOT a rate limit or overloaded error (those are handled above)
    if (error.message && (error.message.includes('rate limit') || error.message.includes('overloaded'))) {
      // This shouldn't happen, but if it does, retry
      const delay = Math.min(baseDelay * Math.pow(2, Math.min(retryCount, 5)), maxDelay);
      console.log(`⏳ Claude API error caught, waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return callClaude(payload, apiKey, retryCount + 1);
    }
    // Wrap other errors
    throw new Error(`Claude API Error: ${error.message}`);
  }
}

/**
 * Extract text response from Claude's response
 */
function extractTextResponse(response) {
  const textBlocks = response.content.filter(block => block.type === 'text');
  return textBlocks.map(block => block.text).join('\n\n');
}
