/**
 * Intelligent Agent - Truly Dynamic API Access
 * Generic tool that works with ANY REST API (CRM, ERP, Payroll, etc.)
 * Includes smart caching for record lookups
 */

import { getCachedRecord, setCachedRecord, invalidateRecord } from './record-cache';

/**
 * Get agent tools - ONE tool to rule them all
 * No assumptions, no hardcoding - just raw API access
 * Works with any API by using the base URL from discovered structure
 */
export function getAgentTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'call_api',
        description: `Make any HTTP request to any configured API. The system has discovered the API structure - use the endpoints and formatting rules from the discovered structure. Works with CRM, ERP, Payroll, Calendar, or any REST API.

**MULTI-TOOL INTEGRATION:**
- You can use multiple tools together in a single conversation
- Example: Get email from CRM (api_name: "attio") then schedule meeting in Calendar (api_name: "google_calendar")
- Use "api_name" parameter to route to specific tools: "attio" for CRM, "google_calendar" for Calendar
- For dependent operations (e.g., get email then schedule), make sequential calls
- For independent operations (e.g., show companies AND show events), make parallel calls

CRITICAL FOR GOOGLE CALENDAR EVENTS:
- BEFORE creating an event (POST to /calendars/primary/events), you MUST have:
  1. A SPECIFIC time (not vague like "morning" and not default like "10:00 AM")
  2. A clear event title
  3. If you include attendees, they MUST have REAL email addresses (not fake ones like "name@example.com")
- NOTE: Emails/attendees are OPTIONAL - you can create events without them
- If time or title is missing, DO NOT call this tool. Instead, ask the user for the missing information first.
- If user mentions a person but didn't provide email: ASK for email: "What's [person's name]'s email address?" If user doesn't provide it, create event WITHOUT attendees. DO NOT create fake emails.`,
        parameters: {
          type: 'object',
          properties: {
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
              description: 'HTTP method'
            },
            path: {
              type: 'string',
              description: 'API path (e.g., /v2/objects/people/records, /api/employees, etc.). Use paths from the discovered API structure.'
            },
            body: {
              type: 'object',
              description: 'Request body for POST/PUT/PATCH. Format according to the discovered API structure and examples.'
            },
            query: {
              type: 'object',
              description: 'Query parameters'
            },
            api_name: {
              type: 'string',
              description: 'Optional: Name of the adapter/tool to call (e.g., "attio", "google_calendar", "quickbooks"). Must match the adapter name. If not specified, uses the default adapter.'
            }
          },
          required: ['method', 'path']
        }
      }
    }
  ];
}

/**
 * Execute agent tool
 * Now supports multiple APIs - can route to different APIs based on api_name parameter
 */
export async function executeAgentTool(toolName, input, defaultApiKey, defaultBaseUrl = process.env.CRM_API_BASE_URL || 'https://api.attio.com', apiConfigs = null) {
  if (toolName === 'call_api') {
    // If api_name is specified and we have API configs, use that API
    if (input.api_name && apiConfigs && apiConfigs.length > 0) {
      const apiConfig = apiConfigs.find(api => api.name === input.api_name);
      if (apiConfig) {
        return await callAPI(input, apiConfig.apiKey, apiConfig.baseUrl, {
          authHeader: apiConfig.authHeader,
          authHeaderName: apiConfig.authHeaderName
        });
      }
    }
    
    // Otherwise use default (backward compatibility)
    return await callAPI(input, defaultApiKey, defaultBaseUrl);
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

/**
 * Generic API caller - works with any REST API
 * Supports different authentication methods
 * Includes smart caching for query/search operations
 */
async function callAPI(input, apiKey, baseUrl, authConfig = null) {
  let { method, path, body, query } = input;

  // Sanitize Attio query filters (Claude occasionally sends arrays instead of strings)
  if (
    input.api_name === 'attio' &&
    method === 'POST' &&
    path.includes('/objects/') &&
    path.includes('/records/query') &&
    body?.filter
  ) {
    body = {
      ...body,
      filter: sanitizeAttioFilter(body.filter)
    };
  }

  // HARD VALIDATION: Reject Google Calendar event creation with fake emails (emails are optional, but if provided, they must be real)
  if (method === 'POST' && path.includes('/calendars/primary/events') && body) {
    const validationErrors = [];
    
    // Check for fake/example email addresses (emails are optional, but if provided, they must be real)
    if (body.attendees && Array.isArray(body.attendees)) {
      for (const attendee of body.attendees) {
        if (attendee.email && attendee.email.includes('@example.com')) {
          validationErrors.push(`Cannot create event with fake email address: ${attendee.email}. If you need to invite someone, ask the user for their real email address. Otherwise, create the event without attendees.`);
        }
      }
    }
    
    // Note: Time validation is handled in general-bot.js with access to conversation history
    // This validation here only checks for fake emails
    
    if (validationErrors.length > 0) {
      console.log(`❌ Validation failed for Google Calendar event creation:`);
      validationErrors.forEach(err => console.log(`   - ${err}`));
      return {
        success: false,
        status: 400,
        error: 'Validation failed: Missing required information',
        validation_errors: validationErrors,
        note: validationErrors.join(' ')
      };
    }
  }

  // Check cache for query/search operations
  if (method === 'POST' && path.includes('/query') && body && body.filter) {
    // Extract object type from path (e.g., /v2/objects/companies/records/query -> companies)
    const pathMatch = path.match(/\/objects\/([^\/]+)\/records\/query/);
    if (pathMatch) {
      const objectType = pathMatch[1];
      // Try to extract search key from filter
      const searchKey = extractSearchKey(body.filter);
      if (searchKey) {
        const cached = getCachedRecord(apiKey, objectType, searchKey);
        if (cached) {
          console.log(`💾 Cache HIT for ${objectType}:${searchKey} → ${cached.record_id}`);
          return {
            success: true,
            status: 200,
            data: {
              data: [{
                id: { record_id: cached.record_id },
                ...(cached.record_data || {})
              }]
            },
            cached: true
          };
        }
      }
    }
  }

  // Build URL
  let url = `${baseUrl}${path}`;

  if (query) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }

  // Build request headers with configurable auth
  const headers = {
    'Content-Type': 'application/json'
  };
  
  // Add authentication based on config
  if (authConfig) {
    const { authHeader = 'Bearer', authHeaderName = 'Authorization' } = authConfig;
    if (authHeader === 'Bearer') {
      headers[authHeaderName] = `Bearer ${apiKey}`;
    } else if (authHeader === 'API-Key') {
      headers[authHeaderName] = apiKey;
    } else if (authHeader === 'Basic') {
      headers[authHeaderName] = `Basic ${Buffer.from(apiKey).toString('base64')}`;
    } else {
      headers[authHeaderName] = `${authHeader} ${apiKey}`;
    }
  } else {
    // Default to Bearer token
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Build request
  const options = {
    method: method.toUpperCase(),
    headers
  };

  if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
    options.body = JSON.stringify(body);
  }

  console.log(`🌐 ${method} ${url}`);
  if (body) console.log(`📤 Body:`, JSON.stringify(body, null, 2));

  // Make request
  const response = await fetch(url, options);
  const text = await response.text();

  if (!response.ok) {
    console.log(`❌ API Error (${response.status}): ${text.substring(0, 200)}`);
    
    // Parse error for better user-facing messages
    let errorMessage = text;
    let userFriendlyMessage = null;
    
    try {
      const errorData = JSON.parse(text);
      
      // Google Calendar API not enabled error
      if (response.status === 403 && errorData.error?.message?.includes('has not been used') && errorData.error?.message?.includes('or it is disabled')) {
        userFriendlyMessage = 'I\'m having trouble accessing your calendar right now. This usually means the Calendar service needs to be enabled in your account. You\'ll need to enable it in your account settings, then reconnect your calendar.';
      }
      // Google Calendar authentication errors (401)
      else if (response.status === 401 && url.includes('googleapis.com/calendar')) {
        userFriendlyMessage = 'I\'m not connected to your calendar anymore. Please reconnect your Google Calendar in the settings, then I\'ll be able to help you with your events.';
      }
      // Other Google Calendar permission errors
      else if (response.status === 403 && url.includes('googleapis.com/calendar')) {
        userFriendlyMessage = 'I don\'t have permission to access your calendar. Please check that you\'ve granted the necessary permissions when connecting.';
      }
      // Generic 403 errors
      else if (response.status === 403) {
        userFriendlyMessage = 'I don\'t have permission to perform this action. Please check your connection settings.';
      }
      // Generic 401 errors
      else if (response.status === 401) {
        userFriendlyMessage = 'I\'m not connected anymore. Please reconnect in the settings, then try again.';
      }
      
      if (userFriendlyMessage) {
        errorMessage = userFriendlyMessage;
      }
    } catch {
      // If error isn't JSON, use original text
    }
    
    return {
      success: false,
      status: response.status,
      error: errorMessage,
      raw_error: text, // Keep original for debugging
      note: userFriendlyMessage || 'API call failed - try a different path or method'
    };
  }

  try {
    const result = {
      success: true,
      status: response.status,
      data: JSON.parse(text)
    };

    // Log successful operations
    if (path.includes('/objects/companies/records')) {
      if (path.includes('/query')) {
        // Company query
        const pathMatch = path.match(/\/objects\/([^\/]+)\/records\/query/);
        const objectType = pathMatch?.[1] || 'companies';
        const searchKey = extractSearchKey(body?.filter);
        if (result.data?.data && result.data.data.length > 0) {
          const firstRecord = result.data.data[0];
          const recordId = firstRecord.id?.record_id || firstRecord.id;
          const companyName = firstRecord.values?.name?.[0]?.value || searchKey || 'Unknown';
          console.log(`✅ Found company: "${companyName}" (ID: ${recordId})`);
        } else {
          console.log(`⚠️ Company query returned no results for: ${searchKey || 'query'}`);
        }
      } else if (method === 'POST' && !path.includes('/query')) {
        // Company creation
        const createdCompany = result.data?.data;
        if (createdCompany) {
          const recordId = createdCompany.id?.record_id || createdCompany.id;
          const companyName = createdCompany.values?.name?.[0]?.value || body?.data?.values?.name?.[0]?.value || 'Unknown';
          console.log(`✅ Created company: "${companyName}" (ID: ${recordId})`);
        }
      }
    } else if (path.includes('/objects/people/records')) {
      if (path.includes('/query')) {
        // Person query
        const searchKey = extractSearchKey(body?.filter);
        if (result.data?.data && result.data.data.length > 0) {
          const firstRecord = result.data.data[0];
          const recordId = firstRecord.id?.record_id || firstRecord.id;
          const personName = firstRecord.values?.name?.[0]?.value || searchKey || 'Unknown';
          console.log(`✅ Found person: "${personName}" (ID: ${recordId})`);
        } else {
          console.log(`⚠️ Person query returned no results for: ${searchKey || 'query'}`);
        }
      } else if (method === 'POST' && !path.includes('/query')) {
        // Person creation
        const createdPerson = result.data?.data;
        if (createdPerson) {
          const recordId = createdPerson.id?.record_id || createdPerson.id;
          const personName = createdPerson.values?.name?.[0]?.value || body?.data?.values?.name?.[0]?.value || 'Unknown';
          const email = createdPerson.values?.email_addresses?.[0]?.email_address || body?.data?.values?.email_addresses?.[0]?.email_address || 'N/A';
          console.log(`✅ Created person: "${personName}" (${email}) (ID: ${recordId})`);
        }
      }
    }

    // Cache successful query results
    if (method === 'POST' && path.includes('/query') && result.success && result.data?.data) {
      const pathMatch = path.match(/\/objects\/([^\/]+)\/records\/query/);
      if (pathMatch && result.data.data.length > 0) {
        const objectType = pathMatch[1];
        const firstRecord = result.data.data[0];
        const recordId = firstRecord.id?.record_id || firstRecord.id;
        const searchKey = extractSearchKey(body?.filter);
        if (recordId && searchKey) {
          setCachedRecord(apiKey, objectType, searchKey, recordId, firstRecord);
          console.log(`💾 Cached ${objectType}:${searchKey} → ${recordId}`);
        }
      }
    }

    // Invalidate cache on updates/deletes
    if (['PUT', 'PATCH', 'DELETE'].includes(method) && result.success) {
      const pathMatch = path.match(/\/objects\/([^\/]+)\/records\/([^\/]+)/);
      if (pathMatch) {
        const objectType = pathMatch[1];
        const recordId = pathMatch[2];
        invalidateRecord(apiKey, objectType, recordId);
        console.log(`🗑️ Invalidated cache for ${objectType}:${recordId}`);
      }
    }

    return result;
  } catch {
    return {
      success: true,
      status: response.status,
      data: { raw: text }
    };
  }
}

/**
 * Determine operation type from API path and method
 */
function determineOperationTypeFromPath(path, method) {
  if (!path) return 'unknown';
  
  const pathLower = path.toLowerCase();
  
  if (pathLower.includes('/companies/records/query')) {
    return 'query_company';
  }
  
  if (pathLower.includes('/companies/records') && method === 'POST') {
    return 'create_company';
  }
  
  if (pathLower.includes('/people/records/query')) {
    return 'query_person';
  }
  
  if (pathLower.includes('/people/records') && method === 'POST') {
    return 'create_person';
  }
  
  if (pathLower.includes('/deals/records')) {
    return 'deal_operation';
  }
  
  if (pathLower.includes('/notes')) {
    return 'note_operation';
  }
  
  if (pathLower.includes('/tasks')) {
    return 'task_operation';
  }
  
  return 'unknown';
}

/**
 * Extract search key from filter object for caching
 */
function extractSearchKey(filter) {
  if (!filter || typeof filter !== 'object') return null;
  
  // Handle Attio filter format: { "name": ["Apple"] }
  if (filter.name && Array.isArray(filter.name) && filter.name.length > 0) {
    const nameValue = filter.name[0];
    if (typeof nameValue === 'string') {
      return nameValue;
    } else if (nameValue && typeof nameValue === 'object' && nameValue.value) {
      return nameValue.value;
    }
  }
  
  // Handle simple filter: { attribute: "name", operator: "contains", value: "Tesla" }
  if (filter.attribute && filter.value) {
    return filter.value;
  }
  
  // Handle direct value
  if (filter.value && typeof filter.value === 'string') {
    return filter.value;
  }
  
  // Handle nested filters
  if (filter.AND || filter.OR) {
    const conditions = filter.AND || filter.OR || [];
    for (const condition of conditions) {
      if (condition.value) {
        return condition.value;
      }
    }
  }
  
  return null;
}

/**
 * Normalize Attio query filters so the API doesn't error on array inputs.
 */
function sanitizeAttioFilter(filter) {
  if (!filter || typeof filter !== 'object') {
    return filter;
  }

  const sanitized = { ...filter };

  const flatten = key => {
    if (Array.isArray(sanitized[key]) && sanitized[key].length > 0) {
      sanitized[key] = sanitized[key][0];
    }
  };

  flatten('name');
  flatten('title');
  flatten('company');
  flatten('domain');

  if (Array.isArray(sanitized.email_addresses) && sanitized.email_addresses.length > 0) {
    const first = sanitized.email_addresses[0];
    if (typeof first === 'string') {
      sanitized.email_addresses = [{ email_address: first }];
    } else if (first && typeof first === 'object' && first.email_address) {
      sanitized.email_addresses = [first];
    }
  }

  return sanitized;
}
