/**
 * Adaptive Adapter Wrapper
 * 
 * Wraps adapters with learning capabilities to improve over time.
 * Tracks successful patterns and adapts behavior based on learned patterns.
 */

import { 
  learnFromSuccess, 
  learnFromFailure, 
  getSuggestedFormat, 
  shouldAvoidPattern,
  getEnhancedContext 
} from './pattern-learner.js';
import { getLearnedLanguagePreferencesText } from './user-correction-learner.js';

/**
 * Wrap an adapter with learning capabilities
 */
export function makeAdaptive(adapter, userId) {
  const originalExecuteTool = adapter.executeTool.bind(adapter);
  
  // Wrap executeTool to learn from results (adapter-specific learning)
  const adapterName = adapter.getName();
  
  adapter.executeTool = async function(toolName, input, apiKey, baseUrl, apiConfigs = null) {
    // Determine operation type from input
    const operationType = determineOperationType(input);
    
    // Check if we should avoid this pattern (adapter-specific)
    if (shouldAvoidPattern(userId, adapterName, operationType, input)) {
      // Try to get a suggested format instead (adapter-specific)
      const suggestedFormat = getSuggestedFormat(userId, adapterName, operationType);
      if (suggestedFormat) {
        console.log(`🧠 [${adapterName}] Learned pattern: Using suggested format for ${operationType}`);
        // Merge suggested format with current input
        input = { ...suggestedFormat, ...input };
      }
    }
    
    try {
      const result = await originalExecuteTool(toolName, input, apiKey, baseUrl, apiConfigs);
      
      // Learn from success (adapter-specific)
      if (result && (result.success !== false)) {
        learnFromSuccess(userId, adapterName, operationType, input, result);
        console.log(`✅ [${adapterName}] Learned successful pattern for ${operationType}`);
      } else if (result && result.success === false) {
        // Learn from failure (adapter-specific)
        learnFromFailure(userId, adapterName, operationType, input, result);
        console.log(`⚠️ [${adapterName}] Learned failed pattern for ${operationType}`);
      }
      
      return result;
    } catch (error) {
      // Learn from exception (adapter-specific)
      learnFromFailure(userId, adapterName, operationType, input, error);
      console.log(`❌ [${adapterName}] Learned error pattern for ${operationType}: ${error.message}`);
      throw error;
    }
  };
  
  // Wrap getSystemPrompt to include learned context (adapter-specific)
  const originalGetSystemPrompt = adapter.getSystemPrompt.bind(adapter);
  adapter.getSystemPrompt = function(context) {
    const basePrompt = originalGetSystemPrompt(context);
    const enhancedContext = getEnhancedContext(userId, adapterName);
    const languagePreferences = getLearnedLanguagePreferencesText(userId, adapterName);
    
    let learnedSections = '';
    
    if (enhancedContext && enhancedContext.trim().length > 0) {
      // Add learned context section (adapter-specific)
      learnedSections += `\n\n## 📚 Your Usage Patterns with ${adapterName.toUpperCase()} (Learned from past interactions):${enhancedContext}\n\nUse this information to better understand the user's preferences and common operations with this specific tool.`;
    }
    
    if (languagePreferences && languagePreferences.trim().length > 0) {
      // Add learned language preferences
      learnedSections += languagePreferences;
    }
    
    return basePrompt + learnedSections;
  };
  
  return adapter;
}

/**
 * Determine operation type from tool input
 */
function determineOperationType(input) {
  if (!input || !input.path) {
    return 'unknown';
  }
  
  const path = input.path.toLowerCase();
  
  if (path.includes('/companies/records/query')) {
    return 'query_company';
  }
  
  if (path.includes('/companies/records') && input.method === 'POST') {
    return 'create_company';
  }
  
  if (path.includes('/people/records/query')) {
    return 'query_person';
  }
  
  if (path.includes('/people/records') && input.method === 'POST') {
    return 'create_person';
  }
  
  if (path.includes('/deals/records')) {
    return 'deal_operation';
  }
  
  if (path.includes('/notes')) {
    return 'note_operation';
  }
  
  if (path.includes('/tasks')) {
    return 'task_operation';
  }
  
  return 'unknown';
}

