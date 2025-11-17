/**
 * Control Bot - Intelligent Task Orchestrator
 * 
 * Interprets user queries and intelligently routes to appropriate tools.
 * Decides between parallel and hierarchical execution strategies.
 * Learns routing patterns and strategy decisions over time.
 */

import { 
  getSuggestedTools, 
  getSuggestedStrategy, 
  learnRoutingDecision 
} from '@/lib/learning/control-bot-learner.js';

/**
 * Analyze user query using Claude to determine which tools are needed
 */
async function analyzeQueryWithClaude(message, availableAdapters, claudeApiKey) {
  const adapterNames = availableAdapters.map(a => a.getName());
  const adapterDescriptions = availableAdapters.map(a => {
    const name = a.getName();
    const features = a.supportsFeature ? 
      Object.keys(a).filter(key => a.supportsFeature && a.supportsFeature(key)) : [];
    return `${name}: ${getToolDescription(name)}`;
  }).join('\n');
  
  const analysisPrompt = `Analyze this user query and determine:
1. Which tools/databases are needed to answer this query
2. Whether operations should be parallel (independent) or hierarchical (dependent)

Available tools:
${adapterDescriptions}

User query: "${message}"

Respond with JSON only:
{
  "tools": ["tool1", "tool2"],
  "strategy": "parallel" or "hierarchical",
  "reasoning": "brief explanation",
  "steps": [
    {"tool": "tool1", "action": "read", "what": "what to get"},
    {"tool": "tool2", "action": "write", "what": "what to create", "dependsOn": "output from step 1"}
  ]
}

Rules:
- "parallel": Operations can run simultaneously (e.g., "show companies and show events")
- "hierarchical": Operations depend on each other (e.g., "get email from CRM then schedule meeting")
- Only include tools that are actually needed
- If query is ambiguous, include all potentially relevant tools`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 500,
        messages: [
          { role: 'user', content: analysisPrompt }
        ]
      })
    });

    if (!response.ok) {
      throw new Error('Analysis failed');
    }

    const data = await response.json();
    const textResponse = data.content[0].text;
    
    // Extract JSON from response
    const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      
      // Validate tools exist
      const validTools = analysis.tools.filter(tool => adapterNames.includes(tool));
      
      return {
        tools: validTools.length > 0 ? validTools : adapterNames, // Fallback to all if invalid
        strategy: analysis.strategy || 'parallel',
        reasoning: analysis.reasoning || 'Analyzed query',
        steps: analysis.steps || []
      };
    }
  } catch (error) {
    console.error('Query analysis failed, using fallback:', error);
  }
  
  // Fallback to keyword-based analysis
  return analyzeQueryFallback(message, availableAdapters);
}

/**
 * Fallback keyword-based query analysis
 */
function analyzeQueryFallback(message, availableAdapters) {
  const adapterNames = availableAdapters.map(a => a.getName());
  const messageLower = message.toLowerCase();
  
  const toolHints = {
    attio: ['crm', 'contact', 'company', 'deal', 'person', 'people', 'attio', 'customer', 'client', 'workspace'],
    google_calendar: ['calendar', 'meeting', 'event', 'schedule', 'appointment', 'google calendar', 'cal'],
    quickbooks: ['invoice', 'payment', 'accounting', 'quickbooks', 'financial', 'expense', 'qb'],
    payroll: ['payroll', 'employee', 'salary', 'wage', 'pay stub', 'paycheck']
  };
  
  const neededTools = [];
  
  for (const adapter of availableAdapters) {
    const adapterName = adapter.getName();
    const hints = toolHints[adapterName] || [];
    
    if (hints.some(hint => messageLower.includes(hint))) {
      neededTools.push(adapterName);
    }
  }
  
  if (neededTools.length === 0) {
    return {
      tools: adapterNames,
      strategy: 'parallel',
      reasoning: 'No specific tool detected, using all available',
      steps: []
    };
  }
  
  return {
    tools: neededTools,
    strategy: determineStrategy(message, neededTools),
    reasoning: `Detected: ${neededTools.join(', ')}`,
    steps: []
  };
}

/**
 * Get tool description for analysis
 */
function getToolDescription(toolName) {
  const descriptions = {
    attio: 'CRM system for managing contacts, companies, deals, and customer relationships',
    google_calendar: 'Calendar system for scheduling meetings, events, and appointments',
    quickbooks: 'Accounting system for invoices, payments, and financial records',
    payroll: 'Payroll system for employee salaries and wages'
  };
  
  return descriptions[toolName] || `${toolName} integration`;
}

/**
 * Determine execution strategy: parallel vs hierarchical
 */
function determineStrategy(message, neededTools) {
  const messageLower = message.toLowerCase();
  
  // Hierarchical: Tasks that depend on each other
  // Examples:
  // - "Get John's email from CRM and schedule a meeting" (need email first, then schedule)
  // - "Find company in CRM, then create invoice in QuickBooks" (need company first)
  const hierarchicalKeywords = [
    'then', 'after', 'using', 'from', 'get', 'find', 'then create',
    'and schedule', 'and send', 'and create', 'based on', 'using the'
  ];
  
  const isHierarchical = hierarchicalKeywords.some(keyword => 
    messageLower.includes(keyword)
  );
  
  // Parallel: Independent tasks that can run simultaneously
  // Examples:
  // - "Show me all companies and all upcoming meetings" (independent queries)
  // - "List contacts and list events" (both are reads, independent)
  const parallelKeywords = [
    'and', 'also', 'both', 'all', 'list', 'show', 'get', 'display'
  ];
  
  // If it's a simple read operation with multiple tools, use parallel
  const isReadOnly = /^(show|list|get|display|find|search)/i.test(message.trim());
  const hasMultipleTools = neededTools.length > 1;
  
  if (isReadOnly && hasMultipleTools && !isHierarchical) {
    return 'parallel';
  }
  
  // Default to hierarchical if dependencies detected, otherwise parallel
  return isHierarchical ? 'hierarchical' : 'parallel';
}

/**
 * Plan execution steps for hierarchical strategy
 */
export function planHierarchicalExecution(message, neededTools, availableAdapters) {
  const steps = [];
  const messageLower = message.toLowerCase();
  
  // Simple pattern matching for common hierarchical patterns
  // Pattern 1: "Get X from Tool1, then do Y in Tool2"
  const thenMatch = messageLower.match(/(?:get|find|fetch|retrieve)\s+(.+?)\s+(?:from|in)\s+(\w+).*?then\s+(.+?)(?:\s+in|\s+with)?\s+(\w+)?/i);
  
  if (thenMatch) {
    const [, dataToGet, sourceTool, actionToDo, targetTool] = thenMatch;
    
    // Step 1: Get data from source tool
    if (sourceTool && neededTools.includes(sourceTool)) {
      steps.push({
        tool: sourceTool,
        action: 'read',
        description: `Get ${dataToGet} from ${sourceTool}`,
        output: dataToGet.trim()
      });
    }
    
    // Step 2: Use that data in target tool
    if (targetTool && neededTools.includes(targetTool)) {
      steps.push({
        tool: targetTool,
        action: 'write',
        description: `${actionToDo} in ${targetTool}`,
        dependsOn: steps.length > 0 ? steps[0].output : null
      });
    }
  } else {
    // Fallback: Simple sequential execution
    for (let i = 0; i < neededTools.length; i++) {
      const tool = neededTools[i];
      steps.push({
        tool,
        action: i === 0 ? 'read' : 'write', // First is usually read, rest are writes
        description: `Execute in ${tool}`,
        dependsOn: i > 0 ? steps[i - 1].output : null
      });
    }
  }
  
  return steps;
}

/**
 * Control Bot Class
 * Orchestrates intelligent routing and execution
 */
export class ControlBot {
  constructor(generalBot, availableAdapters, claudeApiKey) {
    this.generalBot = generalBot;
    this.availableAdapters = availableAdapters;
    this.claudeApiKey = claudeApiKey;
  }
  
  /**
   * Process message with intelligent routing
   */
  async processMessage(message, previousMessages, adapterCredentials, userId, apiConfigs = null) {
    // Step 0: Check learned patterns for suggested tools/strategy
    const suggestedTools = getSuggestedTools(userId, message);
    const suggestedStrategy = getSuggestedStrategy(userId, message);
    
    let analysis;
    if (suggestedTools && suggestedTools.length > 0) {
      // Use learned pattern
      console.log(`🧠 Control Bot: Using learned pattern for query`);
      console.log(`   Suggested tools: ${suggestedTools.join(', ')}`);
      console.log(`   Suggested strategy: ${suggestedStrategy || 'parallel'}`);
      
      // Validate suggested tools exist
      const availableAdapterNames = this.availableAdapters.map(a => a.getName());
      const validTools = suggestedTools.filter(tool => availableAdapterNames.includes(tool));
      
      if (validTools.length > 0) {
        analysis = {
          tools: validTools,
          strategy: suggestedStrategy || 'parallel',
          reasoning: 'Using learned routing pattern',
          steps: []
        };
      } else {
        // Fallback to Claude analysis if learned tools are invalid
        analysis = await analyzeQueryWithClaude(
          message, 
          this.availableAdapters, 
          this.claudeApiKey
        );
      }
    } else {
      // Step 1: Analyze query using Claude to determine needed tools and strategy
      analysis = await analyzeQueryWithClaude(
        message, 
        this.availableAdapters, 
        this.claudeApiKey
      );
    }
    
    console.log(`🎯 Control Bot Analysis:`);
    console.log(`   Reasoning: ${analysis.reasoning}`);
    console.log(`   Strategy: ${analysis.strategy}`);
    console.log(`   Tools needed: ${analysis.tools.join(', ')}`);
    if (analysis.steps.length > 0) {
      console.log(`   Execution plan:`, analysis.steps);
    }
    
    // Step 2: Filter adapters to only those needed
    const neededAdapters = this.availableAdapters.filter(adapter => 
      analysis.tools.includes(adapter.getName())
    );
    
    if (neededAdapters.length === 0) {
      // Fallback: use all adapters if analysis failed
      console.log(`⚠️ No tools selected, using all available adapters`);
      return await this.generalBot.processMessage(
        message,
        previousMessages,
        adapterCredentials,
        userId,
        apiConfigs
      );
    }
    
    // Step 3: Filter credentials to only those needed
    const neededCredentials = new Map();
    for (const adapter of neededAdapters) {
      const adapterName = adapter.getName();
      if (adapterCredentials.has(adapterName)) {
        neededCredentials.set(adapterName, adapterCredentials.get(adapterName));
      }
    }
    
    // Step 4: Create focused general bot with only needed adapters
    const focusedBot = new (this.generalBot.constructor)(neededAdapters, this.generalBot.claudeApiKey);
    
    // Step 5: Build strategy-aware system prompt
    const systemPrompt = this.buildStrategyPrompt(analysis, neededAdapters);
    
    // Step 6: Process with strategy-aware execution
    const result = await this.processWithStrategy(
      focusedBot,
      message,
      previousMessages,
      neededCredentials,
      userId,
      apiConfigs,
      systemPrompt,
      analysis
    );
    
    // Step 7: Learn from routing decision (control bot learning)
    const success = result && result.response && !result.response.includes('error');
    learnRoutingDecision(
      userId,
      message,
      analysis.tools,
      analysis.strategy,
      success
    );
    
    return {
      ...result,
      analysis: {
        toolsUsed: analysis.tools,
        strategy: analysis.strategy,
        reasoning: analysis.reasoning
      }
    };
  }
  
  /**
   * Process message with strategy-aware execution
   * Simply delegate to general bot but with enhanced system prompt
   * The general bot already handles tool execution correctly
   */
  async processWithStrategy(bot, message, previousMessages, credentials, userId, apiConfigs, systemPrompt, analysis) {
    // Load tool context from only needed adapters
    const { toolContext, toolSchemas } = await bot.loadToolContext(credentials, userId);
    
    // Use strategy-enhanced system prompt (replace placeholder with actual context)
    const finalSystemPrompt = systemPrompt.replace('${toolContext}', toolContext);
    
    // Temporarily store the enhanced prompt so general bot can use it
    const originalBuildMultiToolSystemPrompt = bot.buildMultiToolSystemPrompt;
    bot.buildMultiToolSystemPrompt = () => finalSystemPrompt;
    
    // Also override getSystemPrompt for single adapter case
    // The general bot calls this with toolContext, but we've already included it in finalSystemPrompt
    let originalGetSystemPrompt = null;
    if (bot.adapters.length === 1) {
      originalGetSystemPrompt = bot.adapters[0].getSystemPrompt;
      bot.adapters[0].getSystemPrompt = (context) => finalSystemPrompt; // Accept param but use our enhanced prompt
    }
    
    try {
      // Delegate to general bot - it already handles everything correctly
      const result = await bot.processMessage(message, previousMessages, credentials, userId, apiConfigs);
      return result;
    } finally {
      // Restore original methods
      bot.buildMultiToolSystemPrompt = originalBuildMultiToolSystemPrompt;
      if (bot.adapters.length === 1 && originalGetSystemPrompt) {
        bot.adapters[0].getSystemPrompt = originalGetSystemPrompt;
      }
    }
  }
  
  /**
   * Execute tool calls with strategy awareness
   */
  async executeToolCallsWithStrategy(toolCalls, bot, credentials, toolSchemas, analysis) {
    if (analysis.strategy === 'parallel') {
      // Execute all in parallel
      return await Promise.all(
        toolCalls.map(block => this.executeToolCall(block, bot, credentials, toolSchemas))
      );
    } else {
      // Execute sequentially (hierarchical)
      const results = [];
      for (const block of toolCalls) {
        const result = await this.executeToolCall(block, bot, credentials, toolSchemas);
        results.push(result);
        // If this step produces output needed by next step, wait a bit
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      return results;
    }
  }
  
  /**
   * Execute a single tool call
   */
  async executeToolCall(block, bot, credentials, toolSchemas) {
    const apiName = block.input?.api_name;
    let adapter = null;
    let creds = null;
    
    if (apiName && bot.adapterMap.has(apiName)) {
      adapter = bot.adapterMap.get(apiName);
      creds = credentials.get(apiName);
    } else {
      adapter = bot.adapters[0];
      if (adapter) {
        const firstAdapterName = adapter.getName();
        creds = credentials.get(firstAdapterName);
      }
    }
    
    if (!adapter || !creds) {
      return {
        tool_call_id: block.id,
        role: 'tool',
        name: block.name,
        content: JSON.stringify({
          success: false,
          error: `Adapter "${apiName || 'default'}" not found or not authenticated`
        })
      };
    }
    
    // Import validation utilities
    const { validateToolCall, generateTroubleshootingHints } = await import('@/lib/validation/tool-validation.js');
    
    // Pre-submission validation
    if (block.name === 'call_api' && block.input &&
        (block.input.method === 'POST' || block.input.method === 'PUT' || block.input.method === 'PATCH')) {
      const adapterName = adapter.getName();
      const schema = toolSchemas.get(adapterName) || toolSchemas.get(apiName);
      
      if (schema) {
        const validationResult = validateToolCall(block.input, schema);
        if (validationResult && !validationResult.valid) {
          return {
            tool_call_id: block.id,
            role: 'tool',
            name: block.name,
            content: JSON.stringify({
              success: false,
              error: 'Validation failed before submission',
              validation_errors: validationResult.errors || [],
              message: `I found some formatting issues before submitting:\n${(validationResult.errors || []).join('\n')}\n\nPlease check the data format and try again.`
            })
          };
        }
      }
    }
    
    try {
      const result = await adapter.executeTool(
        block.name,
        block.input,
        creds.apiKey,
        creds.baseUrl,
        null
      );
      
      let enhancedResult = result;
      if (typeof result === 'string') {
        try {
          enhancedResult = JSON.parse(result);
        } catch {
          enhancedResult = { success: false, error: result, raw: result };
        }
      }
      
      if (enhancedResult && enhancedResult.success === false) {
        let errorMessage = enhancedResult.error || enhancedResult.message || 'Unknown error';
        if (typeof errorMessage === 'string' && errorMessage.length > 500) {
          errorMessage = errorMessage.substring(0, 500) + '...';
        }
        
        const adapterName = adapter.getName();
        const schema = toolSchemas.get(adapterName) || toolSchemas.get(apiName);
        
        enhancedResult = {
          ...enhancedResult,
          success: false,
          error: errorMessage,
          troubleshooting_hints: generateTroubleshootingHints(block.input, enhancedResult, schema)
        };
      }
      
      return {
        tool_call_id: block.id,
        role: 'tool',
        name: block.name,
        content: JSON.stringify(enhancedResult)
      };
    } catch (error) {
      return {
        tool_call_id: block.id,
        role: 'tool',
        name: block.name,
        content: JSON.stringify({
          error: error.message,
          details: 'Tool execution failed'
        })
      };
    }
  }
  
  /**
   * Build system prompt with strategy guidance
   */
  buildStrategyPrompt(analysis, neededAdapters) {
    const toolNames = neededAdapters.map(a => a.getName()).join(', ');
    
    let strategyGuidance = '';
    if (analysis.strategy === 'hierarchical') {
      strategyGuidance = `
## Execution Strategy: Hierarchical (Sequential)

This task requires sequential execution where later steps depend on earlier ones.

${analysis.steps.length > 0 ? `**Execution Plan:**
${analysis.steps.map((step, i) => 
  `${i + 1}. ${step.action === 'read' ? 'GET' : 'CREATE/UPDATE'} from ${step.tool}: ${step.what || step.description}${step.dependsOn ? ` (uses: ${step.dependsOn})` : ''}`
).join('\n')}` : ''}

**Instructions:**
- Execute steps in order (1, then 2, then 3...)
- Use output from earlier steps in later steps
- Wait for each step to complete before starting the next
- If a step fails, stop and report the error`;
    } else {
      strategyGuidance = `
## Execution Strategy: Parallel

This task can be executed in parallel across multiple tools.

**Available Tools:** ${toolNames}

**Instructions:**
- You can make simultaneous API calls to different tools
- Use the "api_name" parameter to route calls to specific tools
- Example: call_api(api_name: "attio", ...) and call_api(api_name: "google_calendar", ...) can run at the same time
- All operations are independent and can execute concurrently`;
    }
    
    return `You are a helpful assistant that works with multiple business systems: ${toolNames}.

You have COMPLETE knowledge of all configured tools' schemas, attributes, structures, AND ACTUAL DATA.

${strategyGuidance}

${'${toolContext}'}

## 🚨 CRITICAL USER-FACING RULES:
1. **NEVER use example data as real records** - Only use actual data from the "Existing Records in Database" sections
2. **NEVER show timestamps, IDs, or technical details to users**
3. **NEVER ask users to clarify between multiple matches** - Resolve ambiguity internally
4. **NEVER mention record IDs to users**
5. **ALWAYS resolve record identification internally**
6. **NEVER use technical language** - Speak naturally and conversationally
7. **Only use the tools that are needed** - Don't query tools unnecessarily

Execute requests confidently using your complete knowledge of all connected tools!`;
  }
}

