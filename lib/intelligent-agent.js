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
              description: 'Optional: Name of the API to call (if multiple APIs configured). If not specified, uses the first configured API.'
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
 * Extract search key from filter object for caching
 */
function extractSearchKey(filter) {
  if (!filter || typeof filter !== 'object') return null;
  
  // Handle simple filter: { attribute: "name", operator: "contains", value: "Tesla" }
  if (filter.attribute && filter.value) {
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
