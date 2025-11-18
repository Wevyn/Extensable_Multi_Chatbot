/**
 * Adapter Registry
 * 
 * Manages tool adapters and provides a way to load them dynamically.
 * This allows the system to support multiple tools without hardcoding.
 */

import { AttioAdapter } from './attio-adapter.js';
import { GoogleCalendarAdapter } from './google-calendar-adapter.js';

// Registry of available adapters
const adapters = new Map();

// Register default adapters
adapters.set('attio', AttioAdapter);
adapters.set('google_calendar', GoogleCalendarAdapter);

/**
 * Register a new adapter
 * @param {string} name - Adapter name
 * @param {class} AdapterClass - Adapter class
 */
export function registerAdapter(name, AdapterClass) {
  adapters.set(name.toLowerCase(), AdapterClass);
}

/**
 * Get an adapter instance
 * @param {string} name - Adapter name (e.g., 'attio')
 * @returns {ToolAdapter} Adapter instance
 */
export function getAdapter(name) {
  const AdapterClass = adapters.get(name.toLowerCase());
  if (!AdapterClass) {
    throw new Error(`Adapter "${name}" not found. Available adapters: ${Array.from(adapters.keys()).join(', ')}`);
  }
  return new AdapterClass();
}

/**
 * Get adapter by cookie name (for OAuth flows)
 * @param {string} cookieName - Cookie name (e.g., 'attio_api_token')
 * @returns {ToolAdapter|null} Adapter instance or null
 */
export function getAdapterByCookieName(cookieName) {
  for (const [name, AdapterClass] of adapters.entries()) {
    const adapter = new AdapterClass();
    if (adapter.getCookieName() === cookieName) {
      return adapter;
    }
  }
  return null;
}

/**
 * Get all registered adapter names
 * @returns {string[]} Array of adapter names
 */
export function getAvailableAdapters() {
  return Array.from(adapters.keys());
}

/**
 * Check if an adapter is registered
 * @param {string} name - Adapter name
 * @returns {boolean}
 */
export function hasAdapter(name) {
  return adapters.has(name.toLowerCase());
}

/**
 * Get all registered adapter classes
 * @returns {Array} Array of adapter classes
 */
export function getAllAdapters() {
  return Array.from(adapters.values());
}

/**
 * Get all adapters that have active cookies
 * @param {object} cookieStore - Cookie store from Next.js
 * @returns {Array} Array of adapter instances with active cookies
 */
export function getActiveAdaptersFromCookies(cookieStore) {
  const activeAdapters = [];
  
  for (const AdapterClass of adapters.values()) {
    const adapter = new AdapterClass();
    const cookieName = adapter.getCookieName();
    const token = cookieStore.get(cookieName)?.value;
    
    if (token) {
      activeAdapters.push(adapter);
    }
  }
  
  return activeAdapters;
}

