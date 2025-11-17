/**
 * Control Bot Learner
 * 
 * Learns high-level routing and strategy decisions:
 * - Query → Tool mappings (which tools to use for which queries)
 * - Strategy selection (parallel vs hierarchical)
 * - Query reformulation (better ways to ask for information)
 */

import { getControlBotLearningData } from './pattern-learner.js';

/**
 * Learn from a successful routing decision
 */
export function learnRoutingDecision(userId, query, selectedTools, strategy, success) {
  const learning = getControlBotLearningData(userId);
  
  // Store successful routing
  learning.successfulRoutings.push({
    query,
    tools: selectedTools,
    strategy,
    success,
    timestamp: Date.now()
  });
  
  // Keep only last 50 routings
  if (learning.successfulRoutings.length > 50) {
    learning.successfulRoutings.shift();
  }
  
  // Learn query → tool mapping
  const queryKey = normalizeQuery(query);
  if (!learning.queryToToolMappings.has(queryKey)) {
    learning.queryToToolMappings.set(queryKey, []);
  }
  
  const mappings = learning.queryToToolMappings.get(queryKey);
  const existingMapping = mappings.find(m => 
    JSON.stringify(m.tools.sort()) === JSON.stringify(selectedTools.sort())
  );
  
  if (existingMapping) {
    existingMapping.count++;
    existingMapping.lastUsed = Date.now();
  } else {
    mappings.push({
      tools: selectedTools,
      count: 1,
      lastUsed: Date.now()
    });
  }
  
  // Learn strategy decision
  if (!learning.strategyDecisions.has(queryKey)) {
    learning.strategyDecisions.set(queryKey, []);
  }
  
  const strategies = learning.strategyDecisions.get(queryKey);
  const existingStrategy = strategies.find(s => s.strategy === strategy);
  
  if (existingStrategy) {
    existingStrategy.count++;
    existingStrategy.lastUsed = Date.now();
  } else {
    strategies.push({
      strategy,
      count: 1,
      lastUsed: Date.now()
    });
  }
  
  learning.lastUpdated = Date.now();
}

/**
 * Get suggested tools for a query based on learned patterns
 */
export function getSuggestedTools(userId, query) {
  const learning = getControlBotLearningData(userId);
  const queryKey = normalizeQuery(query);
  
  const mappings = learning.queryToToolMappings.get(queryKey);
  if (!mappings || mappings.length === 0) {
    return null;
  }
  
  // Return most frequently used tool mapping
  const mostUsed = mappings.reduce((best, current) => {
    return current.count > (best?.count || 0) ? current : best;
  }, null);
  
  return mostUsed?.tools || null;
}

/**
 * Get suggested strategy for a query
 */
export function getSuggestedStrategy(userId, query) {
  const learning = getControlBotLearningData(userId);
  const queryKey = normalizeQuery(query);
  
  const strategies = learning.strategyDecisions.get(queryKey);
  if (!strategies || strategies.length === 0) {
    return null;
  }
  
  // Return most frequently used strategy
  const mostUsed = strategies.reduce((best, current) => {
    return current.count > (best?.count || 0) ? current : best;
  }, null);
  
  return mostUsed?.strategy || null;
}

/**
 * Learn query reformulation (better ways to ask)
 */
export function learnQueryReformulation(userId, originalQuery, improvedQuery, success) {
  const learning = getControlBotLearningData(userId);
  
  if (success) {
    // Only learn successful reformulations
    const originalKey = normalizeQuery(originalQuery);
    learning.queryReformulations.set(originalKey, {
      improved: improvedQuery,
      count: (learning.queryReformulations.get(originalKey)?.count || 0) + 1,
      lastUsed: Date.now()
    });
  }
  
  learning.lastUpdated = Date.now();
}

/**
 * Get suggested query reformulation
 */
export function getSuggestedReformulation(userId, query) {
  const learning = getControlBotLearningData(userId);
  const queryKey = normalizeQuery(query);
  
  const reformulation = learning.queryReformulations.get(queryKey);
  return reformulation?.improved || null;
}

/**
 * Normalize query for pattern matching (remove variations)
 */
function normalizeQuery(query) {
  return query.toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .replace(/\s+/g, ' ') // Normalize whitespace
    .substring(0, 100); // Limit length
}

/**
 * Get routing statistics
 */
export function getRoutingStats(userId) {
  const learning = getControlBotLearningData(userId);
  
  // Count tool usage
  const toolUsage = new Map();
  learning.successfulRoutings.forEach(routing => {
    routing.tools.forEach(tool => {
      toolUsage.set(tool, (toolUsage.get(tool) || 0) + 1);
    });
  });
  
  // Count strategy usage
  const strategyUsage = new Map();
  learning.successfulRoutings.forEach(routing => {
    strategyUsage.set(routing.strategy, (strategyUsage.get(routing.strategy) || 0) + 1);
  });
  
  return {
    totalRoutings: learning.successfulRoutings.length,
    toolUsage: Array.from(toolUsage.entries()).sort((a, b) => b[1] - a[1]),
    strategyUsage: Array.from(strategyUsage.entries()).sort((a, b) => b[1] - a[1]),
    lastUpdated: learning.lastUpdated
  };
}

