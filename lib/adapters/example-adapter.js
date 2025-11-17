/**
 * Example Tool Adapter Template
 * 
 * This is a template showing how to create a new tool adapter.
 * Copy this file and customize it for your specific tool.
 * 
 * Steps:
 * 1. Copy this file to lib/adapters/your-tool-adapter.js
 * 2. Replace "Example" with your tool name
 * 3. Implement all required methods
 * 4. Register in adapter-registry.js
 * 5. Add environment variables to .env.local
 */

import { ToolAdapter } from './adapter-interface.js';
import { getAgentTools, executeAgentTool } from '@/lib/intelligent-agent.js';
import { validateToolCall } from '@/lib/validation/tool-validation.js';
import { discoverAPIStructure, apiStructureToContext } from '@/lib/generic-api-discovery.js';

export class ExampleAdapter extends ToolAdapter {
  /**
   * Get the tool name/identifier
   */
  getName() {
    return 'example'; // Change to your tool name
  }

  /**
   * Get authentication type
   * Options: 'oauth', 'api_key', 'basic', 'custom'
   */
  getAuthType() {
    return 'api_key'; // Change based on your tool's auth
  }

  /**
   * Get the cookie name for storing auth token
   */
  getCookieName() {
    return 'example_api_token'; // Change to your cookie name
  }

  /**
   * Get default base URL for this tool
   */
  getDefaultBaseUrl() {
    return process.env.EXAMPLE_API_BASE_URL || 'https://api.example.com';
  }

  /**
   * Load tool schema (objects, endpoints, structure)
   * 
   * Options:
   * 1. Use generic API discovery (recommended for REST APIs)
   * 2. Use tool-specific schema loader
   * 3. Load from OpenAPI spec
   */
  async loadSchema(apiKey, baseUrl) {
    // Option 1: Use generic API discovery
    const structure = await discoverAPIStructure(baseUrl, apiKey, {
      discoveryEndpoints: ['/api/v1/schema', '/openapi.json'], // Add your tool's discovery endpoints
      authHeader: 'Bearer', // or 'API-Key', 'Basic', etc.
      authHeaderName: 'Authorization', // or 'X-API-Key', etc.
      openApiSpecUrl: process.env.EXAMPLE_OPENAPI_SPEC_URL // If available
    });
    
    return structure;

    // Option 2: Use tool-specific loader
    // return await loadExampleSchema(apiKey, baseUrl);

    // Option 3: Load from OpenAPI spec
    // const spec = await fetch(process.env.EXAMPLE_OPENAPI_SPEC_URL);
    // return parseOpenAPISpec(await spec.json());
  }

  /**
   * Convert schema to context string for Claude's system prompt
   */
  schemaToContext(schema) {
    // Option 1: Use generic API discovery context converter
    if (schema.api_type === 'openapi' || schema.resources) {
      return apiStructureToContext(schema);
    }

    // Option 2: Use tool-specific converter
    // return exampleSchemaToContext(schema);

    // Option 3: Custom formatting
    return `# Example Tool API Structure

Base URL: ${schema.base_url}

## Resources:
${JSON.stringify(schema, null, 2)}

## Usage:
- Use the endpoints and formatting rules above
- Follow the API's data format requirements
`;
  }

  /**
   * Get tool definitions for Claude
   * 
   * Most tools can use the generic call_api tool.
   * Only override if you need tool-specific tools.
   */
  getTools() {
    // Use generic API tool (works for most REST APIs)
    return getAgentTools();

    // Or define tool-specific tools:
    // return [
    //   {
    //     type: 'function',
    //     function: {
    //       name: 'example_specific_action',
    //       description: 'Tool-specific action',
    //       parameters: { ... }
    //     }
    //   }
    // ];
  }

  /**
   * Execute a tool call
   */
  async executeTool(toolName, input, apiKey, baseUrl, apiConfigs = null) {
    // Use generic tool executor (works for most REST APIs)
    return await executeAgentTool(toolName, input, apiKey, baseUrl, apiConfigs);

    // Or implement tool-specific execution:
    // if (toolName === 'example_specific_action') {
    //   return await executeExampleAction(input, apiKey, baseUrl);
    // }
    // return await executeAgentTool(toolName, input, apiKey, baseUrl, apiConfigs);
  }

  /**
   * Validate tool call input against schema
   */
  validateToolCall(toolInput, schema) {
    // Use generic validation (works for most APIs)
    return validateToolCall(toolInput, schema);

    // Or implement tool-specific validation:
    // if (toolInput.path.includes('/example-specific-endpoint')) {
    //   return validateExampleSpecificFormat(toolInput, schema);
    // }
    // return validateToolCall(toolInput, schema);
  }

  /**
   * Get OAuth route handlers (if applicable)
   * Return null if tool doesn't use OAuth
   */
  getOAuthRoutes() {
    // If your tool uses OAuth, return route paths:
    // return {
    //   connect: '/integrations/example/connect',
    //   callback: '/integrations/example/callback',
    //   status: '/integrations/example/status'
    // };

    // If no OAuth, return null:
    return null;
  }

  /**
   * Build system prompt with tool-specific context
   */
  getSystemPrompt(context) {
    // Generic prompt (works for most tools)
    return `You are a helpful assistant that works with the Example Tool API.

${context}

## Tool-Specific Instructions:
- Follow the API structure shown above
- Use the exact endpoint paths and formats
- Handle errors gracefully
- Ask for clarification when needed

Execute requests confidently using the API knowledge above!`;

    // Or use tool-specific prompt:
    // return buildExampleSystemPrompt(context);
  }

  /**
   * Check if adapter supports a specific feature
   */
  supportsFeature(feature) {
    const supportedFeatures = [
      // 'record_linking',
      // 'name_normalization',
      // 'fuzzy_matching',
      // 'data_in_context'
    ];
    return supportedFeatures.includes(feature);
  }

  // Add tool-specific helper methods here
  // Example:
  // normalizeExampleData(data) {
  //   // Tool-specific normalization
  // }
}

