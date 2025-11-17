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
        description: 'Make any HTTP request to any configured API. The system has discovered the API structure - use the endpoints and formatting rules from the discovered structure. Works with CRM, ERP, Payroll, or any REST API.',
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
  const { method, path, body, query } = input;

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
    return {
      success: false,
      status: response.status,
      error: text,
      note: 'API call failed - try a different path or method'
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
