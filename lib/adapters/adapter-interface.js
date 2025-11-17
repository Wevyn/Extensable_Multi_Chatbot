/**
 * Tool Adapter Interface
 * 
 * All tool-specific adapters must implement this interface.
 * This allows the general bot to work with any tool (Attio, ERP, Payroll, etc.)
 * without knowing tool-specific details.
 */

/**
 * Base Adapter Interface
 * 
 * Each tool adapter must implement:
 * - getName(): Returns the tool name (e.g., "attio", "quickbooks")
 * - getAuthType(): Returns auth type ("oauth", "api_key", "basic")
 * - getCookieName(): Returns the cookie name for storing auth token
 * - loadSchema(apiKey, baseUrl): Loads and returns tool schema
 * - schemaToContext(schema): Converts schema to context string for Claude
 * - getTools(): Returns tool definitions for Claude
 * - executeTool(toolName, input, apiKey, baseUrl, apiConfigs): Executes a tool call
 * - validateToolCall(toolInput, schema): Validates tool input against schema
 * - getOAuthRoutes(): Returns OAuth route handlers (if applicable)
 * - getSystemPrompt(context): Builds system prompt with tool-specific context
 */

export class ToolAdapter {
  /**
   * Get the tool name/identifier
   */
  getName() {
    throw new Error('getName() must be implemented');
  }

  /**
   * Get authentication type
   * @returns {string} 'oauth' | 'api_key' | 'basic' | 'custom'
   */
  getAuthType() {
    throw new Error('getAuthType() must be implemented');
  }

  /**
   * Get the cookie name for storing auth token
   */
  getCookieName() {
    throw new Error('getCookieName() must be implemented');
  }

  /**
   * Load tool schema (objects, endpoints, structure)
   * @param {string} apiKey - API key/token
   * @param {string} baseUrl - Base API URL
   * @returns {Promise<object>} Schema object
   */
  async loadSchema(apiKey, baseUrl) {
    throw new Error('loadSchema() must be implemented');
  }

  /**
   * Convert schema to context string for Claude's system prompt
   * @param {object} schema - Schema object
   * @returns {string} Context string
   */
  schemaToContext(schema) {
    throw new Error('schemaToContext() must be implemented');
  }

  /**
   * Get tool definitions for Claude
   * @returns {Array} Array of tool definitions
   */
  getTools() {
    throw new Error('getTools() must be implemented');
  }

  /**
   * Execute a tool call
   * @param {string} toolName - Tool name
   * @param {object} input - Tool input
   * @param {string} apiKey - API key
   * @param {string} baseUrl - Base URL
   * @param {Array} apiConfigs - Additional API configs (for multi-API support)
   * @returns {Promise<object>} Tool result
   */
  async executeTool(toolName, input, apiKey, baseUrl, apiConfigs = null) {
    throw new Error('executeTool() must be implemented');
  }

  /**
   * Validate tool call input against schema
   * @param {object} toolInput - Tool input to validate
   * @param {object} schema - Schema to validate against
   * @returns {object} { valid: boolean, errors: string[] }
   */
  validateToolCall(toolInput, schema) {
    throw new Error('validateToolCall() must be implemented');
  }

  /**
   * Get OAuth configuration (if applicable)
   * @returns {object} OAuth configuration or null
   * {
   *   clientIdEnv: string, // Environment variable name for client ID
   *   clientSecretEnv: string, // Environment variable name for client secret
   *   authorizeUrl: string, // OAuth authorize URL
   *   tokenUrl: string, // OAuth token URL
   *   redirectUriPath: string, // Path for callback (e.g., '/integrations/attio/callback')
   *   stateCookieName: string, // Cookie name for OAuth state
   *   successMessageType: string // PostMessage type for success (e.g., 'ATTIO_OAUTH_SUCCESS')
   * }
   */
  getOAuthConfig() {
    return null; // Default: no OAuth
  }

  /**
   * Get OAuth route paths (if applicable)
   * @returns {object} { connect: string, callback: string, status: string } | null
   */
  getOAuthRoutes() {
    return null; // Default: no OAuth
  }

  /**
   * Build system prompt with tool-specific context
   * @param {string} context - Tool context string
   * @returns {string} Complete system prompt
   */
  getSystemPrompt(context) {
    throw new Error('getSystemPrompt() must be implemented');
  }

  /**
   * Get default base URL for this tool
   * @returns {string} Default base URL
   */
  getDefaultBaseUrl() {
    throw new Error('getDefaultBaseUrl() must be implemented');
  }

  /**
   * Check if adapter supports a specific feature
   * @param {string} feature - Feature name (e.g., 'record_linking', 'bulk_operations')
   * @returns {boolean}
   */
  supportsFeature(feature) {
    return false; // Default: no special features
  }
}

