/**
 * Google Calendar Tool Adapter
 * 
 * Implements the ToolAdapter interface for Google Calendar.
 * Provides full read/write access to calendar events.
 */

import { ToolAdapter } from './adapter-interface.js';
import { loadGoogleCalendarSchema, schemaToContext } from '@/lib/google-calendar-schema-loader.js';
import { getAgentTools, executeAgentTool } from '@/lib/intelligent-agent.js';
import { validateToolCall as validateToolCallGeneric } from '@/lib/validation/tool-validation.js';
import { buildSystemPrompt as buildGoogleCalendarSystemPrompt } from '@/lib/google-calendar-system-prompt.js';

export class GoogleCalendarAdapter extends ToolAdapter {
  getName() {
    return 'google_calendar';
  }

  getAuthType() {
    return 'oauth';
  }

  getCookieName() {
    return 'google_calendar_token';
  }

  getDefaultBaseUrl() {
    return 'https://www.googleapis.com/calendar/v3';
  }

  async loadSchema(apiKey, baseUrl) {
    // Load Google Calendar API structure
    return await loadGoogleCalendarSchema(apiKey, baseUrl);
  }

  schemaToContext(schema) {
    // Convert schema to context string for Claude
    return schemaToContext(schema);
  }

  getTools() {
    // Use existing intelligent agent tools (generic API access)
    return getAgentTools();
  }

  async executeTool(toolName, input, apiKey, baseUrl, apiConfigs = null) {
    // Use existing intelligent agent executor
    // Google Calendar API uses Bearer token authentication (default in callAPI)
    return await executeAgentTool(toolName, input, apiKey, baseUrl, apiConfigs);
  }

  validateToolCall(toolInput, schema) {
    // Use generic validation utilities
    return validateToolCallGeneric(toolInput, schema);
  }

  getOAuthConfig() {
    return {
      clientIdEnv: 'GOOGLE_CLIENT_ID',
      clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      redirectUriPath: '/integrations/google-calendar/callback',
      stateCookieName: 'google_calendar_oauth_state',
      successMessageType: 'GOOGLE_CALENDAR_OAUTH_SUCCESS',
      scopes: ['https://www.googleapis.com/auth/calendar'] // Full read/write access
    };
  }

  getOAuthRoutes() {
    return {
      connect: '/integrations/google-calendar/connect',
      callback: '/integrations/google-calendar/callback',
      status: '/integrations/google-calendar/status'
    };
  }

  getSystemPrompt(context) {
    // Use Google Calendar system prompt builder
    return buildGoogleCalendarSystemPrompt(context);
  }

  supportsFeature(feature) {
    const supportedFeatures = [
      'event_creation',
      'event_updates',
      'calendar_listing',
      'attendee_management',
      'timezone_handling'
    ];
    return supportedFeatures.includes(feature);
  }
}

