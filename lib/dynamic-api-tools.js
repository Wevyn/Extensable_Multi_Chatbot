/**
 * Dynamic API Tools - Token-Efficient Approach
 * Instead of generating 59 tools upfront, provide meta-tools that let Claude
 * discover and call API endpoints on-demand using Attio docs
 */

/**
 * Get minimal set of meta-tools for dynamic API interaction
 */
export function getDynamicTools() {
  return [
    {
      name: 'search_attio_api_docs',
      description: 'Search Attio REST API documentation to find the right endpoint for a task. Use this when you need to know how to perform an operation (create record, query records, update, etc.)',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What you want to do (e.g., "create person record", "query companies", "update deal")'
          }
        },
        required: ['query']
      }
    },
    {
      name: 'call_attio_api',
      description: 'Make a direct API call to Attio after you\'ve looked up the correct endpoint from the docs. Supports GET, POST, PUT, PATCH, DELETE.',
      input_schema: {
        type: 'object',
        properties: {
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            description: 'HTTP method'
          },
          path: {
            type: 'string',
            description: 'API path (e.g., "/v2/objects/people/records")'
          },
          body: {
            type: 'object',
            description: 'Request body for POST/PUT/PATCH requests'
          },
          query_params: {
            type: 'object',
            description: 'Query parameters as key-value pairs'
          }
        },
        required: ['method', 'path']
      }
    },
    {
      name: 'list_workspace_objects',
      description: 'Get all available objects (people, companies, deals, custom objects) in the Attio workspace with their attributes',
      input_schema: {
        type: 'object',
        properties: {}
      }
    }
  ];
}

/**
 * Execute dynamic tool calls
 */
export async function executeDynamicTool(toolName, input, attioApiKey) {
  switch (toolName) {
    case 'search_attio_api_docs':
      return await searchAttioDocs(input.query);

    case 'call_attio_api':
      return await callAttioAPI(input, attioApiKey);

    case 'list_workspace_objects':
      return await listWorkspaceObjects(attioApiKey);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * Search Attio API documentation
 */
async function searchAttioDocs(query) {
  const searchQuery = encodeURIComponent(query);

  // Fetch relevant documentation pages based on query
  const docsUrls = getRelevantDocsUrls(query);

  const results = [];
  for (const url of docsUrls.slice(0, 2)) { // Limit to 2 most relevant
    try {
      const response = await fetch(url);
      const html = await response.text();

      // Extract relevant content (simplified - you could use a proper HTML parser)
      const content = extractRelevantContent(html, query);
      results.push({
        url,
        content: content.substring(0, 2000) // Limit content size
      });
    } catch (error) {
      console.error(`Failed to fetch ${url}:`, error.message);
    }
  }

  // If no results, return common patterns
  if (results.length === 0) {
    return getCommonAPIPatterns(query);
  }

  return {
    query,
    results,
    note: 'Use call_attio_api tool with the endpoint information from these results'
  };
}

/**
 * Get relevant documentation URLs based on query
 */
function getRelevantDocsUrls(query) {
  const lowerQuery = query.toLowerCase();

  const urlMap = {
    'create': 'https://docs.attio.com/rest-api/objects/records/create-a-record',
    'add': 'https://docs.attio.com/rest-api/objects/records/create-a-record',
    'query': 'https://docs.attio.com/rest-api/objects/records/query-records',
    'search': 'https://docs.attio.com/rest-api/objects/records/query-records',
    'find': 'https://docs.attio.com/rest-api/objects/records/query-records',
    'list': 'https://docs.attio.com/rest-api/objects/records/list-records',
    'get': 'https://docs.attio.com/rest-api/objects/records/get-a-record',
    'update': 'https://docs.attio.com/rest-api/objects/records/update-a-record',
    'delete': 'https://docs.attio.com/rest-api/objects/records/delete-a-record',
    'people': 'https://docs.attio.com/rest-api/people',
    'person': 'https://docs.attio.com/rest-api/people',
    'companies': 'https://docs.attio.com/rest-api/companies',
    'company': 'https://docs.attio.com/rest-api/companies',
    'deals': 'https://docs.attio.com/rest-api/objects/records',
    'task': 'https://docs.attio.com/rest-api/tasks',
    'note': 'https://docs.attio.com/rest-api/notes'
  };

  const urls = new Set();

  // Add base overview
  urls.add('https://docs.attio.com/rest-api/overview');

  // Add relevant specific pages
  for (const [keyword, url] of Object.entries(urlMap)) {
    if (lowerQuery.includes(keyword)) {
      urls.add(url);
    }
  }

  return Array.from(urls);
}

/**
 * Extract relevant content from HTML (simplified)
 */
function extractRelevantContent(html, query) {
  // Remove HTML tags (very basic - consider using a proper library)
  const text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                   .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                   .replace(/<[^>]+>/g, ' ')
                   .replace(/\s+/g, ' ')
                   .trim();

  // Find sections relevant to query
  const queryWords = query.toLowerCase().split(' ');
  const sentences = text.split('. ');

  const relevantSentences = sentences
    .filter(sentence =>
      queryWords.some(word => sentence.toLowerCase().includes(word))
    )
    .slice(0, 10)
    .join('. ');

  return relevantSentences || text.substring(0, 1000);
}

/**
 * Get common API patterns when docs aren't available
 */
function getCommonAPIPatterns(query) {
  const lowerQuery = query.toLowerCase();

  const patterns = {
    'create': {
      pattern: 'POST /v2/objects/{object}/records',
      example: {
        method: 'POST',
        path: '/v2/objects/people/records',
        body: {
          data: {
            values: {
              name: [{ first_name: 'John', last_name: 'Smith' }],
              email_addresses: [{ email_address: 'john@example.com' }]
            }
          }
        }
      }
    },
    'query': {
      pattern: 'POST /v2/objects/{object}/records/query',
      example: {
        method: 'POST',
        path: '/v2/objects/people/records/query',
        body: {
          filter: {
            attribute: 'name',
            value: 'John'
          }
        }
      }
    },
    'list': {
      pattern: 'GET /v2/objects/{object}/records',
      example: {
        method: 'GET',
        path: '/v2/objects/people/records'
      }
    },
    'update': {
      pattern: 'PUT /v2/objects/{object}/records/{record_id}',
      example: {
        method: 'PUT',
        path: '/v2/objects/people/records/{record_id}',
        body: {
          data: {
            values: {
              email_addresses: [{ email_address: 'newemail@example.com' }]
            }
          }
        }
      }
    }
  };

  for (const [keyword, info] of Object.entries(patterns)) {
    if (lowerQuery.includes(keyword)) {
      return {
        query,
        pattern: info.pattern,
        example: info.example,
        note: 'Common pattern - verify with list_workspace_objects for exact attribute names'
      };
    }
  }

  return {
    query,
    note: 'Use list_workspace_objects to see available objects and attributes',
    common_patterns: {
      create: 'POST /v2/objects/{object}/records',
      query: 'POST /v2/objects/{object}/records/query',
      list: 'GET /v2/objects/{object}/records',
      get: 'GET /v2/objects/{object}/records/{record_id}',
      update: 'PUT /v2/objects/{object}/records/{record_id}',
      delete: 'DELETE /v2/objects/{object}/records/{record_id}'
    }
  };
}

/**
 * Call Attio API directly
 */
async function callAttioAPI(input, attioApiKey) {
  const { method, path, body, query_params } = input;

  // Build URL
  let url = `https://api.attio.com${path}`;

  if (query_params) {
    const queryString = new URLSearchParams(query_params).toString();
    url += `?${queryString}`;
  }

  // Build request options
  const options = {
    method: method.toUpperCase(),
    headers: {
      'Authorization': `Bearer ${attioApiKey}`,
      'Content-Type': 'application/json'
    }
  };

  if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
    options.body = JSON.stringify(body);
  }

  console.log(`🌐 ${method} ${url}`);
  if (body) console.log(`📤 Body:`, JSON.stringify(body, null, 2));

  const response = await fetch(url, options);
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`API Error (${response.status}): ${responseText}`);
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    result = { raw: responseText };
  }

  return result;
}

/**
 * List all workspace objects with attributes
 */
async function listWorkspaceObjects(attioApiKey) {
  const response = await fetch('https://api.attio.com/v2/objects', {
    headers: {
      'Authorization': `Bearer ${attioApiKey}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to list objects: ${response.status}`);
  }

  const data = await response.json();
  const objects = data.data || [];

  const result = [];

  for (const obj of objects) {
    // Get attributes for this object
    const attrResponse = await fetch(
      `https://api.attio.com/v2/objects/${obj.id.object_id}/attributes`,
      {
        headers: {
          'Authorization': `Bearer ${attioApiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const attrData = await attrResponse.json();
    const attributes = attrData.data || [];

    result.push({
      slug: obj.api_slug,
      name: obj.name,
      type: obj.object_type,
      attributes: attributes.map(attr => ({
        slug: attr.api_slug,
        name: attr.name,
        type: attr.type,
        required: attr.is_required,
        multivalue: attr.is_multivalue
      }))
    });

    // Small delay to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return {
    objects: result,
    note: 'Use these slugs in API paths (e.g., /v2/objects/people/records)'
  };
}
