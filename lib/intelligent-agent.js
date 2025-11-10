/**
 * Intelligent Agent - Truly Dynamic CRM Access
 * Generic tool that works with ANY REST API
 */

/**
 * Get agent tools - ONE tool to rule them all
 * No assumptions, no hardcoding - just raw API access
 */
export function getAgentTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'call_api',
        description: 'Make any HTTP request to the CRM API. Explore and discover the API structure yourself. Try different endpoints, examine responses, and learn how this specific CRM works.',
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
              description: 'API path to try (e.g., /v2/objects, /api/data, etc.)'
            },
            body: {
              type: 'object',
              description: 'Request body for POST/PUT/PATCH'
            },
            query: {
              type: 'object',
              description: 'Query parameters'
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
 */
export async function executeAgentTool(toolName, input, crmApiKey, crmBaseUrl = process.env.CRM_API_BASE_URL || 'https://api.attio.com') {
  if (toolName === 'call_api') {
    return await callAPI(input, crmApiKey, crmBaseUrl);
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

/**
 * Generic API caller - works with any REST API
 */
async function callAPI(input, apiKey, baseUrl) {
  const { method, path, body, query } = input;

  // Build URL
  let url = `${baseUrl}${path}`;

  if (query) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }

  // Build request
  const options = {
    method: method.toUpperCase(),
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
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
    return {
      success: true,
      status: response.status,
      data: JSON.parse(text)
    };
  } catch {
    return {
      success: true,
      status: response.status,
      data: { raw: text }
    };
  }
}
