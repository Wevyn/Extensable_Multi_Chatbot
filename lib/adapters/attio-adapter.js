/**
 * Attio Tool Adapter
 * 
 * Implements the ToolAdapter interface for Attio CRM.
 * Wraps existing Attio-specific logic to work with the general bot.
 */

import { ToolAdapter } from './adapter-interface.js';
import { loadCRMSchema, schemaToContext, normalizeEntityName, entityNamesMatch } from '@/lib/crm-schema-loader.js';
import { getAgentTools, executeAgentTool } from '@/lib/intelligent-agent.js';
import { validateField } from '@/lib/data-validator.js';
import { buildSystemPrompt as buildAttioSystemPrompt } from '@/lib/attio-system-prompt.js';
import { validateToolCall as validateToolCallGeneric } from '@/lib/validation/tool-validation.js';

export class AttioAdapter extends ToolAdapter {
  getName() {
    return 'attio';
  }

  getAuthType() {
    return 'oauth';
  }

  getCookieName() {
    return 'attio_api_token';
  }

  getDefaultBaseUrl() {
    return process.env.CRM_API_BASE_URL || 'https://api.attio.com';
  }

  async loadSchema(apiKey, baseUrl) {
    // Use existing Attio schema loader
    return await loadCRMSchema(apiKey, baseUrl);
  }

  schemaToContext(schema) {
    // Use existing Attio context converter
    return schemaToContext(schema);
  }

  getTools() {
    // Use existing intelligent agent tools
    return getAgentTools();
  }

  async executeTool(toolName, input, apiKey, baseUrl, apiConfigs = null) {
    // Use existing intelligent agent executor
    return await executeAgentTool(toolName, input, apiKey, baseUrl, apiConfigs);
  }

  validateToolCall(toolInput, schema) {
    // Use generic validation utilities
    return validateToolCallGeneric(toolInput, schema);
  }

  getOAuthConfig() {
    return {
      clientIdEnv: 'ATTIO_CLIENT_ID',
      clientSecretEnv: 'ATTIO_CLIENT_SECRET',
      authorizeUrl: 'https://app.attio.com/authorize',
      tokenUrl: 'https://app.attio.com/oauth/token',
      redirectUriPath: '/integrations/attio/callback',
      stateCookieName: 'attio_oauth_state',
      successMessageType: 'ATTIO_OAUTH_SUCCESS'
    };
  }

  getOAuthRoutes() {
    // Return OAuth route paths
    // These are implemented in app/integrations/attio/*
    return {
      connect: '/integrations/attio/connect',
      callback: '/integrations/attio/callback',
      status: '/integrations/attio/status'
    };
  }

  getSystemPrompt(context) {
    // Use existing Attio system prompt builder
    return buildAttioSystemPrompt(context);
  }

  supportsFeature(feature) {
    const supportedFeatures = [
      'record_linking',
      'name_normalization',
      'fuzzy_matching',
      'data_in_context'
    ];
    return supportedFeatures.includes(feature);
  }

  // Attio-specific helper methods
  normalizeEntityName(name) {
    return normalizeEntityName(name);
  }

  entityNamesMatch(name1, name2) {
    return entityNamesMatch(name1, name2);
  }
}

