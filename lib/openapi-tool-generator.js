/**
 * Dynamic Tool Generator from OpenAPI Specification
 * Generates Claude-compatible tools from any OpenAPI spec
 * NO HARDCODING - everything is dynamically generated
 */

export class OpenAPIToolGenerator {
  constructor(openApiSpec) {
    this.spec = openApiSpec;
    this.tools = [];
    this.toolMetadata = new Map(); // Store metadata separately
  }

  /**
   * Generate all tools from the OpenAPI specification
   * Returns array of Claude-compatible tool definitions
   */
  generateTools() {
    if (!this.spec?.paths) {
      throw new Error('Invalid OpenAPI specification: missing paths');
    }

    this.tools = [];

    // Iterate through all paths in the OpenAPI spec
    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      // For each HTTP method in this path
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method.toLowerCase())) {
          continue; // Skip non-HTTP method keys like 'parameters'
        }

        const tool = this.generateToolFromOperation(path, method, operation);
        if (tool) {
          this.tools.push(tool);
        }
      }
    }

    console.log(`✅ Generated ${this.tools.length} tools from OpenAPI spec`);
    return this.tools;
  }

  /**
   * Generate a single tool definition from an OpenAPI operation
   */
  generateToolFromOperation(path, method, operation) {
    const operationId = operation.operationId || this.generateOperationId(path, method);
    const summary = operation.summary || operation.description || `${method.toUpperCase()} ${path}`;
    const toolName = this.sanitizeToolName(operationId);

    // Build input schema from parameters and requestBody
    const inputSchema = this.buildInputSchema(operation, path);

    // Store metadata separately (not sent to Claude API)
    this.toolMetadata.set(toolName, {
      path,
      method: method.toUpperCase(),
      operationId
    });

    // Return tool WITHOUT metadata field (Claude API doesn't allow it)
    return {
      name: toolName,
      description: this.buildToolDescription(summary, operation.description, method, path),
      input_schema: inputSchema
    };
  }

  /**
   * Build Claude tool input schema from OpenAPI operation
   */
  buildInputSchema(operation, path) {
    const properties = {};
    const required = [];

    // Extract path parameters
    const pathParams = this.extractPathParameters(path);
    for (const param of pathParams) {
      properties[param] = {
        type: 'string',
        description: `Path parameter: ${param}`
      };
      required.push(param);
    }

    // Extract query parameters
    if (operation.parameters) {
      for (const param of operation.parameters) {
        if (param.in === 'query') {
          properties[param.name] = this.convertSchemaType(param.schema || { type: 'string' });
          properties[param.name].description = param.description || `Query parameter: ${param.name}`;

          if (param.required) {
            required.push(param.name);
          }
        } else if (param.in === 'path' && !properties[param.name]) {
          properties[param.name] = this.convertSchemaType(param.schema || { type: 'string' });
          properties[param.name].description = param.description || `Path parameter: ${param.name}`;
          required.push(param.name);
        }
      }
    }

    // Extract request body schema
    if (operation.requestBody) {
      const content = operation.requestBody.content;
      const jsonContent = content?.['application/json'];

      if (jsonContent?.schema) {
        // Add entire request body as 'body' parameter
        properties.body = this.convertSchemaType(jsonContent.schema);
        properties.body.description = operation.requestBody.description || 'Request body';

        if (operation.requestBody.required) {
          required.push('body');
        }
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined
    };
  }

  /**
   * Convert OpenAPI schema type to Claude-compatible schema
   */
  convertSchemaType(schema) {
    if (!schema) {
      return { type: 'string' };
    }

    // Handle $ref references
    if (schema.$ref) {
      const refName = schema.$ref.split('/').pop();
      const resolvedSchema = this.resolveRef(schema.$ref);
      return this.convertSchemaType(resolvedSchema);
    }

    const converted = {
      type: schema.type || 'string',
      description: schema.description
    };

    // Handle arrays
    if (schema.type === 'array' && schema.items) {
      converted.items = this.convertSchemaType(schema.items);
    }

    // Handle objects with properties
    if (schema.type === 'object' && schema.properties) {
      converted.properties = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        converted.properties[key] = this.convertSchemaType(value);
      }
      if (schema.required) {
        converted.required = schema.required;
      }
    }

    // Handle enums
    if (schema.enum) {
      converted.enum = schema.enum;
    }

    // Handle examples and defaults
    if (schema.example !== undefined) {
      converted.description = (converted.description || '') + ` Example: ${JSON.stringify(schema.example)}`;
    }
    if (schema.default !== undefined) {
      converted.description = (converted.description || '') + ` Default: ${JSON.stringify(schema.default)}`;
    }

    return converted;
  }

  /**
   * Resolve $ref references in OpenAPI spec
   */
  resolveRef(ref) {
    if (!ref || !ref.startsWith('#/')) {
      return null;
    }

    const path = ref.substring(2).split('/');
    let current = this.spec;

    for (const segment of path) {
      if (!current[segment]) {
        console.warn(`Could not resolve reference: ${ref}`);
        return null;
      }
      current = current[segment];
    }

    return current;
  }

  /**
   * Extract path parameters from a path string
   * e.g., "/objects/{objectId}/records" => ["objectId"]
   */
  extractPathParameters(path) {
    const matches = path.match(/\{([^}]+)\}/g);
    if (!matches) return [];
    return matches.map(match => match.slice(1, -1));
  }

  /**
   * Generate operation ID if not provided
   */
  generateOperationId(path, method) {
    const cleanPath = path
      .replace(/\{([^}]+)\}/g, 'by_$1')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    return `${method}_${cleanPath}`;
  }

  /**
   * Sanitize tool name to be Claude-compatible
   */
  sanitizeToolName(name) {
    return name
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 64); // Claude has a 64 char limit on tool names
  }

  /**
   * Build comprehensive tool description
   */
  buildToolDescription(summary, description, method, path) {
    let desc = summary;
    if (description && description !== summary) {
      desc += `\n\n${description}`;
    }
    desc += `\n\nHTTP Method: ${method.toUpperCase()}`;
    desc += `\nEndpoint: ${path}`;
    return desc;
  }

  /**
   * Get all generated tools
   */
  getTools() {
    return this.tools;
  }

  /**
   * Get metadata for a specific tool by name
   */
  getToolMetadata(toolName) {
    return this.toolMetadata.get(toolName);
  }

  /**
   * Get all tool metadata
   */
  getAllToolMetadata() {
    return this.toolMetadata;
  }
}

/**
 * Helper function to execute a tool call against the CRM API
 */
export async function executeToolCall(toolCall, attioApiKey, toolMetadataMap, baseUrl = 'https://api.attio.com') {
  const { name, input } = toolCall;

  // Get metadata from the metadata map instead of toolCall.metadata
  const tool = toolMetadataMap.get(name);

  if (!tool) {
    throw new Error(`No metadata found for tool: ${name}`);
  }

  let { path, method } = tool;

  if (!path || !method) {
    throw new Error(`Missing path or method for tool: ${name}`);
  }

  // Replace path parameters
  const pathParams = path.match(/\{([^}]+)\}/g);
  if (pathParams) {
    for (const param of pathParams) {
      const paramName = param.slice(1, -1);
      const paramValue = input[paramName];
      if (paramValue) {
        path = path.replace(param, encodeURIComponent(paramValue));
        delete input[paramName]; // Remove from input after using
      }
    }
  }

  // Build query string from remaining non-body parameters
  const queryParams = new URLSearchParams();
  const bodyData = input.body || null;

  for (const [key, value] of Object.entries(input)) {
    if (key !== 'body' && value !== undefined) {
      queryParams.append(key, value);
    }
  }

  const queryString = queryParams.toString();
  const url = `${baseUrl}${path}${queryString ? '?' + queryString : ''}`;

  // Make API call
  const options = {
    method: method.toUpperCase(),
    headers: {
      'Authorization': `Bearer ${attioApiKey}`,
      'Content-Type': 'application/json'
    }
  };

  if (bodyData && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
    options.body = JSON.stringify(bodyData);
  }

  console.log(`🌐 Executing tool: ${name}`);
  console.log(`📍 ${method.toUpperCase()} ${url}`);

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
