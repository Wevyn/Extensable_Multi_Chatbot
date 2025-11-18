/**
 * Pattern Learner - Adaptive Learning System
 * 
 * Learns from successful and failed operations to improve future performance.
 * Tracks:
 * - Successful query patterns
 * - User-specific context and preferences
 * - API format patterns that work
 * - Common operations per user
 */

import { getCachedSchema, setCachedSchema } from '@/lib/schema-cache.js';

// In-memory learning store (could be persisted to database)
// Structure: Map<userId, Map<adapterName, adapterLearningData>>
const adapterLearningStore = new Map(); // Adapter-specific learning

// Control bot learning store (routing, strategy, query patterns)
// Structure: Map<userId, controlBotLearningData>
const controlBotLearningStore = new Map(); // Control bot learning

/**
 * Get or create adapter-specific learning data
 */
function getAdapterLearningData(userId, adapterName) {
  if (!adapterLearningStore.has(userId)) {
    adapterLearningStore.set(userId, new Map());
  }
  
  const userAdapters = adapterLearningStore.get(userId);
  if (!userAdapters.has(adapterName)) {
    userAdapters.set(adapterName, {
      successfulQueries: new Map(), // Map<operationType, successfulPatterns[]>
      failedQueries: new Map(), // Map<operationType, failedPatterns[]>
      userContext: {
        commonCompanies: new Map(), // Map<companyName, count> - adapter-specific
        commonPeople: new Map(), // Map<personName, count> - adapter-specific
        commonOperations: [], // Most frequent operations for this adapter
        preferredFormats: new Map(), // Map<operationType, preferredFormat>
        languagePreferences: new Map() // Map<phrase, interpretation> - user-specific language preferences
      },
      queryFormats: new Map(), // Map<operationType, workingFormat>
      lastUpdated: Date.now()
    });
  }
  return userAdapters.get(adapterName);
}

/**
 * Get or create control bot learning data
 */
export function getControlBotLearningData(userId) {
  if (!controlBotLearningStore.has(userId)) {
    controlBotLearningStore.set(userId, {
      queryToToolMappings: new Map(), // Map<queryPattern, toolName[]>
      strategyDecisions: new Map(), // Map<queryPattern, strategy>
      queryReformulations: new Map(), // Map<originalQuery, improvedQuery>
      successfulRoutings: [], // Array of {query, tools, strategy, success}
      lastUpdated: Date.now()
    });
  }
  return controlBotLearningStore.get(userId);
}

/**
 * Learn from a successful adapter operation (adapter-specific)
 */
export function learnFromSuccess(userId, adapterName, operationType, pattern, result) {
  const learning = getAdapterLearningData(userId, adapterName);
  
  // Track successful patterns
  if (!learning.successfulQueries.has(operationType)) {
    learning.successfulQueries.set(operationType, []);
  }
  
  const successfulPatterns = learning.successfulQueries.get(operationType);
  
  // Add pattern if not already present (avoid duplicates)
  const patternKey = JSON.stringify(pattern);
  if (!successfulPatterns.some(p => JSON.stringify(p.pattern) === patternKey)) {
    successfulPatterns.push({
      pattern,
      result,
      timestamp: Date.now(),
      count: 1
    });
    
    // Keep only last 20 successful patterns per operation type
    if (successfulPatterns.length > 20) {
      successfulPatterns.shift();
    }
  } else {
    // Increment count for existing pattern
    const existing = successfulPatterns.find(p => JSON.stringify(p.pattern) === patternKey);
    if (existing) {
      existing.count++;
      existing.timestamp = Date.now();
    }
  }
  
  // Extract and learn user context
  if (result && result.data) {
    extractUserContext(learning, result.data, operationType);
  }
  
  learning.lastUpdated = Date.now();
}

/**
 * Learn from a failed adapter operation (adapter-specific)
 */
export function learnFromFailure(userId, adapterName, operationType, pattern, error) {
  const learning = getAdapterLearningData(userId, adapterName);
  
  // Track failed patterns
  if (!learning.failedQueries.has(operationType)) {
    learning.failedQueries.set(operationType, []);
  }
  
  const failedPatterns = learning.failedQueries.get(operationType);
  
  // Add failed pattern
  const patternKey = JSON.stringify(pattern);
  if (!failedPatterns.some(p => JSON.stringify(p.pattern) === patternKey)) {
    failedPatterns.push({
      pattern,
      error: error.message || error,
      timestamp: Date.now()
    });
    
    // Keep only last 10 failed patterns (to avoid repeating mistakes)
    if (failedPatterns.length > 10) {
      failedPatterns.shift();
    }
  }
  
  learning.lastUpdated = Date.now();
}

/**
 * Extract user context from successful operations
 */
function extractUserContext(learning, data, operationType) {
  // Extract companies
  if (data.data) {
    const records = Array.isArray(data.data) ? data.data : [data.data];
    
    for (const record of records) {
      // Extract company names
      if (record.values?.company) {
        const companyRef = Array.isArray(record.values.company) 
          ? record.values.company[0] 
          : record.values.company;
        
        if (companyRef?.target_record_id) {
          // We'll resolve company name from context if available
        }
      }
      
      // Extract company names from company records
      if (operationType === 'query_company' && record.values?.name) {
        const companyName = Array.isArray(record.values.name) 
          ? record.values.name[0]?.value 
          : record.values.name;
        
        if (companyName) {
          const count = learning.userContext.commonCompanies.get(companyName) || 0;
          learning.userContext.commonCompanies.set(companyName, count + 1);
        }
      }
      
      // Extract person names
      if (operationType === 'query_person' && record.values?.name) {
        const personName = Array.isArray(record.values.name) 
          ? record.values.name[0]?.value 
          : record.values.name;
        
        if (personName) {
          const count = learning.userContext.commonPeople.get(personName) || 0;
          learning.userContext.commonPeople.set(personName, count + 1);
        }
      }
    }
  }
  
  // Track common operations
  learning.userContext.commonOperations.push({
    type: operationType,
    timestamp: Date.now()
  });
  
  // Keep only last 100 operations
  if (learning.userContext.commonOperations.length > 100) {
    learning.userContext.commonOperations.shift();
  }
}

/**
 * Get learned patterns for an operation type (adapter-specific)
 */
export function getLearnedPatterns(userId, adapterName, operationType) {
  const learning = getAdapterLearningData(userId, adapterName);
  return learning.successfulQueries.get(operationType) || [];
}

/**
 * Get failed patterns to avoid (adapter-specific)
 */
export function getFailedPatterns(userId, adapterName, operationType) {
  const learning = getAdapterLearningData(userId, adapterName);
  return learning.failedQueries.get(operationType) || [];
}

/**
 * Get user context (common companies, people, etc.) - adapter-specific
 */
export function getUserContext(userId, adapterName) {
  const learning = getAdapterLearningData(userId, adapterName);
  
  // Get top companies (most frequently accessed)
  const topCompanies = Array.from(learning.userContext.commonCompanies.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));
  
  // Get top people
  const topPeople = Array.from(learning.userContext.commonPeople.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));
  
  // Get most common operations
  const operationCounts = new Map();
  learning.userContext.commonOperations.forEach(op => {
    const count = operationCounts.get(op.type) || 0;
    operationCounts.set(op.type, count + 1);
  });
  
  const topOperations = Array.from(operationCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }));
  
  return {
    topCompanies,
    topPeople,
    topOperations,
    lastUpdated: learning.lastUpdated
  };
}

/**
 * Get suggested query format for an operation (adapter-specific)
 */
export function getSuggestedFormat(userId, adapterName, operationType) {
  const learning = getAdapterLearningData(userId, adapterName);
  const successfulPatterns = learning.successfulQueries.get(operationType) || [];
  
  if (successfulPatterns.length === 0) {
    return null;
  }
  
  // Return the most frequently used successful pattern
  const mostUsed = successfulPatterns.reduce((best, current) => {
    return current.count > (best?.count || 0) ? current : best;
  }, null);
  
  return mostUsed?.pattern || null;
}

/**
 * Check if a pattern should be avoided (was previously failed) - adapter-specific
 */
export function shouldAvoidPattern(userId, adapterName, operationType, pattern) {
  const learning = getAdapterLearningData(userId, adapterName);
  const failedPatterns = learning.failedQueries.get(operationType) || [];
  
  const patternKey = JSON.stringify(pattern);
  return failedPatterns.some(failed => {
    const failedKey = JSON.stringify(failed.pattern);
    return failedKey === patternKey;
  });
}

/**
 * Get enhanced context for system prompt (adapter-specific)
 */
export function getEnhancedContext(userId, adapterName) {
  const learning = getAdapterLearningData(userId, adapterName);
  const context = getUserContext(userId, adapterName);
  
  let enhancedText = '';
  
  if (context.topCompanies.length > 0) {
    enhancedText += `\n## Your Frequently Accessed Companies:\n`;
    enhancedText += context.topCompanies.map(c => `- ${c.name} (accessed ${c.count} times)`).join('\n');
    enhancedText += '\n';
  }
  
  if (context.topPeople.length > 0) {
    enhancedText += `\n## Your Frequently Accessed Contacts:\n`;
    enhancedText += context.topPeople.map(p => `- ${p.name} (accessed ${p.count} times)`).join('\n');
    enhancedText += '\n';
  }
  
  if (context.topOperations.length > 0) {
    enhancedText += `\n## Your Common Operations:\n`;
    enhancedText += context.topOperations.map(op => `- ${op.type} (${op.count} times)`).join('\n');
    enhancedText += '\n';
  }
  
  // Add successful query patterns (top 3 per operation type)
  const successfulPatterns = [];
  for (const [operationType, patterns] of learning.successfulQueries.entries()) {
    const topPatterns = patterns
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    topPatterns.forEach(p => {
      successfulPatterns.push({ operationType, pattern: p.pattern, count: p.count });
    });
  }
  
  if (successfulPatterns.length > 0) {
    enhancedText += `\n## Successful Query Patterns:\n`;
    successfulPatterns.slice(0, 5).forEach(p => {
      enhancedText += `- ${p.operationType}: ${JSON.stringify(p.pattern).substring(0, 100)} (used ${p.count} times)\n`;
    });
  }
  
  // Add failed patterns to avoid (top 3)
  const failedPatterns = [];
  for (const [operationType, patterns] of learning.failedQueries.entries()) {
    const topFailed = patterns
      .sort((a, b) => b.count - a.count)
      .slice(0, 2);
    topFailed.forEach(p => {
      failedPatterns.push({ operationType, pattern: p.pattern, error: p.error });
    });
  }
  
  if (failedPatterns.length > 0) {
    enhancedText += `\n## Patterns to Avoid (previously failed):\n`;
    failedPatterns.slice(0, 3).forEach(p => {
      enhancedText += `- ${p.operationType}: ${JSON.stringify(p.pattern).substring(0, 80)} (error: ${p.error?.message || 'failed'})\n`;
    });
  }
  
  return enhancedText;
}

/**
 * Learn user-specific language preference/correction
 * Example: User says "next Friday" → bot interprets as this Friday → user corrects "I meant the following week"
 * This learns: "next Friday" for this user means "the following week's Friday"
 */
export function learnLanguagePreference(userId, adapterName, originalPhrase, correctedInterpretation, context = {}) {
  const learning = getAdapterLearningData(userId, adapterName);
  
  // Normalize the phrase (lowercase, trim)
  const normalizedPhrase = originalPhrase.toLowerCase().trim();
  
  // Store the preference
  learning.userContext.languagePreferences.set(normalizedPhrase, {
    interpretation: correctedInterpretation,
    context: context, // e.g., { date: "2025-11-21", actualDate: "2025-11-28" }
    timestamp: Date.now(),
    count: (learning.userContext.languagePreferences.get(normalizedPhrase)?.count || 0) + 1
  });
  
  learning.lastUpdated = Date.now();
  console.log(`🧠 [${adapterName}] Learned language preference: "${normalizedPhrase}" → "${correctedInterpretation}"`);
}

/**
 * Get user-specific language preference
 * Returns the learned interpretation for a phrase, or null if not learned
 */
export function getLanguagePreference(userId, adapterName, phrase) {
  const learning = getAdapterLearningData(userId, adapterName);
  const normalizedPhrase = phrase.toLowerCase().trim();
  
  return learning.userContext.languagePreferences.get(normalizedPhrase) || null;
}

/**
 * Get all language preferences for a user/adapter
 */
export function getAllLanguagePreferences(userId, adapterName) {
  const learning = getAdapterLearningData(userId, adapterName);
  const preferences = [];
  
  for (const [phrase, data] of learning.userContext.languagePreferences.entries()) {
    preferences.push({
      phrase,
      interpretation: data.interpretation,
      context: data.context,
      count: data.count,
      lastUsed: data.timestamp
    });
  }
  
  return preferences.sort((a, b) => b.count - a.count); // Sort by usage count
}

