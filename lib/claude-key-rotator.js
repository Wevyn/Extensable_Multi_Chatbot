/**
 * Claude API Key Rotator
 * 
 * Manages multiple Claude API keys and automatically rotates through them
 * when rate limits are encountered.
 */

// Load keys from environment
function loadKeys() {
  const keysEnv = process.env.ANTHROPIC_API_KEYS;
  const singleKey = process.env.ANTHROPIC_API_KEY;
  
  if (keysEnv) {
    // Parse comma-separated keys
    const keys = keysEnv.split(',').map(k => k.trim()).filter(k => k.length > 0);
    if (keys.length > 0) {
      return keys;
    }
  }
  
  // Fallback to single key
  if (singleKey) {
    return [singleKey];
  }
  
  return [];
}

// Store keys and current index
let keys = loadKeys();
let currentKeyIndex = 0;

/**
 * Get the current API key
 */
export function getCurrentKey() {
  if (keys.length === 0) {
    throw new Error('No Claude API keys configured. Set ANTHROPIC_API_KEY or ANTHROPIC_API_KEYS in environment.');
  }
  return keys[currentKeyIndex];
}

/**
 * Rotate to the next API key
 * Returns the new key, or null if all keys exhausted
 */
export function rotateToNextKey() {
  if (keys.length === 0) {
    return null;
  }
  
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;
  const newKey = keys[currentKeyIndex];
  
  console.log(`🔄 Rotated to Claude API key ${currentKeyIndex + 1}/${keys.length}`);
  
  return newKey;
}

/**
 * Get all available keys (for debugging)
 */
export function getAllKeys() {
  return [...keys];
}

/**
 * Get number of keys
 */
export function getKeyCount() {
  return keys.length;
}

/**
 * Reload keys from environment (useful for testing or dynamic updates)
 */
export function reloadKeys() {
  keys = loadKeys();
  currentKeyIndex = 0;
  console.log(`🔄 Reloaded ${keys.length} Claude API key(s)`);
}

