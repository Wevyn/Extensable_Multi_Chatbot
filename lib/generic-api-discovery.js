/**
 * Generic API Discovery System
 * Works with ANY API (CRM, ERP, Payroll, etc.) by discovering structure dynamically
 * Accepts API endpoints/links and learns formatting rules from the API itself
 */

/**
 * Discover API structure from base URL and optional discovery endpoints
 * @param {string} baseUrl - Base API URL (e.g., https://api.example.com)
 * @param {string} apiKey - API key/token for authentication
 * @param {object} config - Discovery configuration
 * @param {string[]} config.discoveryEndpoints - Optional endpoints to try (e.g., ['/openapi.json', '/schema', '/docs'])
 * @param {string} config.authHeader - Auth header format ('Bearer', 'API-Key', etc.)
 * @param {string} config.openApiSpecUrl - Direct URL to OpenAPI spec (if available)
 */
export async function discoverAPIStructure(baseUrl, apiKey, config = {}) {
  console.log('🔍 Discovering API structure for:', baseUrl);
  
  const {
    discoveryEndpoints = [],
    authHeader = 'Bearer',
    openApiSpecUrl = null,
    authHeaderName = 'Authorization'
  } = config;
  
  const schema = {
    base_url: baseUrl,
    api_type: null, // 'openapi', 'rest', 'graphql', etc.
    openapi_spec: null,
    resources: [],
    endpoints: [],
    formatting_rules: {},
    examples: {}
  };
  
  // Step 1: Try to find OpenAPI/Swagger spec
  if (openApiSpecUrl) {
    console.log('📄 Loading OpenAPI spec from provided URL...');
    const spec = await loadOpenAPISpec(openApiSpecUrl, apiKey, authHeader, authHeaderName);
    if (spec) {
      schema.openapi_spec = spec;
      schema.api_type = 'openapi';
      return parseOpenAPISpec(spec, baseUrl);
    }
  }
  
  // Step 2: Try common OpenAPI spec locations
  const commonSpecPaths = [
    '/openapi.json',
    '/openapi.yaml',
    '/swagger.json',
    '/swagger.yaml',
    '/api-docs',
    '/api-docs.json',
    '/v1/openapi.json',
    '/v2/openapi.json',
    '/schema',
    '/docs/openapi.json'
  ];
  
  for (const specPath of commonSpecPaths) {
    try {
      const spec = await loadOpenAPISpec(`${baseUrl}${specPath}`, apiKey, authHeader, authHeaderName);
      if (spec) {
        console.log(`✅ Found OpenAPI spec at: ${specPath}`);
        schema.openapi_spec = spec;
        schema.api_type = 'openapi';
        return parseOpenAPISpec(spec, baseUrl);
      }
    } catch (error) {
      // Continue trying other paths
    }
  }
  
  // Step 3: Try discovery endpoints provided by user
  for (const endpoint of discoveryEndpoints) {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: buildAuthHeaders(apiKey, authHeader, authHeaderName)
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Discovered endpoint: ${endpoint}`);
        
        // Check if it's an OpenAPI spec
        if (data.openapi || data.swagger) {
          schema.openapi_spec = data;
          schema.api_type = 'openapi';
          return parseOpenAPISpec(data, baseUrl);
        }
        
        // Otherwise, try to infer structure from response
        schema.endpoints.push({
          endpoint,
          method: 'GET',
          response_structure: inferStructureFromResponse(data)
        });
      }
    } catch (error) {
      console.log(`⚠️ Failed to fetch ${endpoint}:`, error.message);
    }
  }
  
  // Step 4: Explore API by making test calls and learning from responses
  console.log('🔍 Exploring API structure from responses...');
  const discoveredStructure = await exploreAPIFromResponses(baseUrl, apiKey, config);
  
  return {
    ...schema,
    ...discoveredStructure,
    api_type: schema.api_type || 'rest'
  };
}

/**
 * Load OpenAPI specification
 */
async function loadOpenAPISpec(url, apiKey, authHeader, authHeaderName) {
  try {
    const response = await fetch(url, {
      headers: buildAuthHeaders(apiKey, authHeader, authHeaderName)
    });
    
    if (response.ok) {
      const spec = await response.json();
      if (spec.openapi || spec.swagger) {
        return spec;
      }
    }
  } catch (error) {
    // Not an OpenAPI spec or not accessible
  }
  return null;
}

/**
 * Parse OpenAPI specification into our schema format
 */
function parseOpenAPISpec(spec, baseUrl) {
  const schema = {
    base_url: baseUrl,
    api_type: 'openapi',
    openapi_version: spec.openapi || spec.swagger,
    resources: [],
    endpoints: [],
    formatting_rules: {},
    examples: {}
  };
  
  const paths = spec.paths || {};
  const components = spec.components || {};
  const schemas = components.schemas || {};
  
  // Extract all endpoints
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method.toLowerCase())) {
        const endpoint = {
          path,
          method: method.toUpperCase(),
          operation_id: operation.operationId,
          summary: operation.summary,
          description: operation.description,
          parameters: operation.parameters || [],
          request_body: operation.requestBody,
          responses: operation.responses
        };
        
        schema.endpoints.push(endpoint);
        
        // Extract formatting rules from request body schema
        if (operation.requestBody) {
          const bodySchema = extractSchemaFromRef(operation.requestBody.content, schemas);
          if (bodySchema) {
            const rules = inferFormattingRules(bodySchema, schemas);
            schema.formatting_rules[path] = rules;
            
            // Extract examples
            if (operation.requestBody.content) {
              const examples = extractExamples(operation.requestBody.content);
              if (examples) {
                schema.examples[path] = examples;
              }
            }
          }
        }
      }
    }
  }
  
  // Extract resource definitions from schemas
  for (const [schemaName, schemaDef] of Object.entries(schemas)) {
    if (schemaDef.type === 'object' && schemaDef.properties) {
      schema.resources.push({
        name: schemaName,
        properties: schemaDef.properties,
        required: schemaDef.required || [],
        example: schemaDef.example
      });
    }
  }
  
  return schema;
}

/**
 * Explore API by making test calls and learning from responses
 */
async function exploreAPIFromResponses(baseUrl, apiKey, config) {
  const discovered = {
    resources: [],
    endpoints: [],
    formatting_rules: {},
    examples: {}
  };
  
  // Try common REST patterns
  const commonPatterns = [
    '/api/v1',
    '/api/v2',
    '/v1',
    '/v2',
    '/api',
    '/rest'
  ];
  
  for (const pattern of commonPatterns) {
    try {
      const response = await fetch(`${baseUrl}${pattern}`, {
        headers: buildAuthHeaders(apiKey, config.authHeader || 'Bearer', config.authHeaderName || 'Authorization')
      });
      
      if (response.ok) {
        const data = await response.json();
        const structure = inferStructureFromResponse(data);
        discovered.endpoints.push({
          endpoint: pattern,
          method: 'GET',
          structure
        });
      }
    } catch (error) {
      // Continue
    }
  }
  
  return discovered;
}

/**
 * Infer structure from API response
 */
function inferStructureFromResponse(data) {
  if (Array.isArray(data)) {
    if (data.length > 0) {
      return {
        type: 'array',
        item_structure: inferObjectStructure(data[0])
      };
    }
    return { type: 'array' };
  }
  
  if (typeof data === 'object' && data !== null) {
    return {
      type: 'object',
      structure: inferObjectStructure(data)
    };
  }
  
  return { type: typeof data };
}

/**
 * Infer object structure from example data
 */
function inferObjectStructure(obj) {
  const structure = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      structure[key] = {
        type: 'array',
        item_type: value.length > 0 ? typeof value[0] : 'unknown'
      };
    } else if (typeof value === 'object' && value !== null) {
      structure[key] = {
        type: 'object',
        properties: inferObjectStructure(value)
      };
    } else {
      structure[key] = {
        type: typeof value,
        example: value
      };
    }
  }
  
  return structure;
}

/**
 * Infer formatting rules from schema
 */
function inferFormattingRules(schema, allSchemas) {
  const rules = {};
  
  if (schema.properties) {
    for (const [field, fieldSchema] of Object.entries(schema.properties)) {
      const resolvedSchema = resolveSchemaRef(fieldSchema, allSchemas);
      
      rules[field] = {
        type: resolvedSchema.type,
        format: resolvedSchema.format,
        required: (schema.required || []).includes(field),
        example: resolvedSchema.example,
        enum: resolvedSchema.enum,
        pattern: resolvedSchema.pattern,
        minLength: resolvedSchema.minLength,
        maxLength: resolvedSchema.maxLength
      };
    }
  }
  
  return rules;
}

/**
 * Extract schema from content reference
 */
function extractSchemaFromRef(content, schemas) {
  if (!content || !content['application/json']) return null;
  
  const jsonContent = content['application/json'];
  if (jsonContent.schema) {
    return resolveSchemaRef(jsonContent.schema, schemas);
  }
  
  return null;
}

/**
 * Resolve schema reference
 */
function resolveSchemaRef(schema, allSchemas) {
  if (schema.$ref) {
    const refPath = schema.$ref.replace('#/components/schemas/', '');
    return allSchemas[refPath] || schema;
  }
  return schema;
}

/**
 * Extract examples from content
 */
function extractExamples(content) {
  if (content['application/json'] && content['application/json'].example) {
    return content['application/json'].example;
  }
  if (content['application/json'] && content['application/json'].examples) {
    return Object.values(content['application/json'].examples)[0]?.value;
  }
  return null;
}

/**
 * Build authentication headers
 */
function buildAuthHeaders(apiKey, authHeader, authHeaderName) {
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (authHeader === 'Bearer') {
    headers[authHeaderName] = `Bearer ${apiKey}`;
  } else if (authHeader === 'API-Key') {
    headers[authHeaderName] = apiKey;
  } else if (authHeader === 'Basic') {
    headers[authHeaderName] = `Basic ${Buffer.from(apiKey).toString('base64')}`;
  } else {
    // Custom format
    headers[authHeaderName] = `${authHeader} ${apiKey}`;
  }
  
  return headers;
}

/**
 * Convert discovered API structure to context string for Claude
 */
export function apiStructureToContext(apiStructure) {
  let context = `# API Structure Discovery

Base URL: ${apiStructure.base_url}
API Type: ${apiStructure.api_type}

`;
  
  if (apiStructure.openapi_spec) {
    context += `## OpenAPI Specification Found
Version: ${apiStructure.openapi_version}
Title: ${apiStructure.openapi_spec.info?.title || 'Unknown'}
Description: ${apiStructure.openapi_spec.info?.description || ''}

`;
  }
  
  if (apiStructure.resources.length > 0) {
    context += `## Resources (${apiStructure.resources.length} total):
`;
    for (const resource of apiStructure.resources) {
      context += `\n### ${resource.name}
`;
      if (resource.properties) {
        context += `Properties:\n`;
        for (const [prop, propSchema] of Object.entries(resource.properties)) {
          const required = (resource.required || []).includes(prop) ? ' [REQUIRED]' : ' [OPTIONAL]';
          context += `  - ${prop} (${propSchema.type || 'unknown'})${required}\n`;
          if (propSchema.example) {
            context += `    Example: ${JSON.stringify(propSchema.example)}\n`;
          }
        }
      }
    }
  }
  
  if (apiStructure.endpoints.length > 0) {
    context += `\n## Available Endpoints (${apiStructure.endpoints.length} total):
`;
    for (const endpoint of apiStructure.endpoints.slice(0, 20)) { // Limit to first 20
      context += `- ${endpoint.method} ${endpoint.path || endpoint.endpoint}\n`;
      if (endpoint.summary) {
        context += `  ${endpoint.summary}\n`;
      }
    }
  }
  
  if (Object.keys(apiStructure.formatting_rules).length > 0) {
    context += `\n## Formatting Rules Discovered:
`;
    for (const [path, rules] of Object.entries(apiStructure.formatting_rules)) {
      context += `\n### ${path}:\n`;
      for (const [field, rule] of Object.entries(rules)) {
        context += `  - ${field}: ${rule.type}${rule.format ? ` (${rule.format})` : ''}${rule.required ? ' [REQUIRED]' : ''}\n`;
        if (rule.example) {
          context += `    Example: ${JSON.stringify(rule.example)}\n`;
        }
      }
    }
  }
  
  if (Object.keys(apiStructure.examples).length > 0) {
    context += `\n## Example Payloads:
`;
    for (const [path, example] of Object.entries(apiStructure.examples)) {
      context += `\n### ${path}:\n\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\`\n`;
    }
  }
  
  context += `\n## Discovery Notes:
- Format data based on the examples and formatting rules above
- Use exact field names from the discovered structure
- Follow the API's data format requirements
- If unsure, examine API responses to learn the format
`;
  
  return context;
}

