/**
 * API Configuration Manager
 * Manages multiple API integrations (CRM, ERP, Payroll, etc.)
 * Users can provide API endpoints/links and the system discovers structure
 */

// In-memory storage (in production, use database)
const apiConfigs = new Map();

/**
 * API Configuration Structure
 */
export class APIConfig {
  constructor(userId, config) {
    this.userId = userId;
    this.name = config.name; // e.g., "Attio CRM", "QuickBooks ERP"
    this.type = config.type; // 'crm', 'erp', 'payroll', 'custom'
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.authHeader = config.authHeader || 'Bearer'; // 'Bearer', 'API-Key', 'Basic', etc.
    this.authHeaderName = config.authHeaderName || 'Authorization';
    
    // Discovery configuration
    this.discoveryEndpoints = config.discoveryEndpoints || []; // User-provided endpoints to explore
    this.openApiSpecUrl = config.openApiSpecUrl || null; // Direct link to OpenAPI spec
    
    // Discovered structure (cached)
    this.discoveredStructure = null;
    this.lastDiscovery = null;
    this.discoveryCacheTTL = config.discoveryCacheTTL || 24 * 60 * 60 * 1000; // 24 hours
    
    this.active = config.active !== false; // Active by default
  }
  
  /**
   * Check if discovery cache is still valid
   */
  isDiscoveryCacheValid() {
    if (!this.discoveredStructure || !this.lastDiscovery) {
      return false;
    }
    return Date.now() - this.lastDiscovery < this.discoveryCacheTTL;
  }
  
  /**
   * Update discovered structure
   */
  updateDiscoveredStructure(structure) {
    this.discoveredStructure = structure;
    this.lastDiscovery = Date.now();
  }
}

/**
 * Add or update API configuration
 */
export function setAPIConfig(userId, config) {
  const apiConfig = new APIConfig(userId, config);
  const key = `${userId}:${config.name}`;
  apiConfigs.set(key, apiConfig);
  return apiConfig;
}

/**
 * Get API configuration
 */
export function getAPIConfig(userId, name) {
  const key = `${userId}:${name}`;
  return apiConfigs.get(key);
}

/**
 * Get all API configurations for a user
 */
export function getUserAPIConfigs(userId) {
  const configs = [];
  for (const [key, config] of apiConfigs.entries()) {
    if (key.startsWith(`${userId}:`)) {
      configs.push(config);
    }
  }
  return configs;
}

/**
 * Remove API configuration
 */
export function removeAPIConfig(userId, name) {
  const key = `${userId}:${name}`;
  return apiConfigs.delete(key);
}

/**
 * Get active API configurations for a user
 */
export function getActiveAPIConfigs(userId) {
  return getUserAPIConfigs(userId).filter(config => config.active);
}

