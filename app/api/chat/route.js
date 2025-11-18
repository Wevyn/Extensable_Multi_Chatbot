/**
 * Chat API Route - Refactored to use Adapter Pattern
 * 
 * This route now uses the adapter pattern to support multiple tools.
 * It maintains full backward compatibility with Attio while being extensible.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GeneralBot } from '@/lib/bots/general-bot.js';
import { ControlBot } from '@/lib/bots/control-bot.js';
import { getAllAdapters } from '@/lib/adapters/adapter-registry.js';
import { getActiveAPIConfigs } from '@/lib/api-config-manager.js';
import { makeAdaptive } from '@/lib/learning/adaptive-adapter.js';
import { getCurrentKey } from '@/lib/claude-key-rotator.js';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max (to allow for rate limit retries)

/**
 * Main chat endpoint - handles user messages and Claude AI processing
 * Now uses adapter pattern for extensibility
 */
export async function POST(request) {
  try {
    const { message, conversationHistory: previousMessages = [] } = await request.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Read tokens from httpOnly cookies (secure, not accessible to JavaScript)
    const cookieStore = await cookies();
    
    // Detect all available adapters from cookies (multi-tool support)
    const allAdapters = getAllAdapters();
    const activeAdapters = [];
    const adapterCredentials = new Map();
    
    // Get userId from first available API key (for rate limiting and learning)
    let userId = null;
    let firstApiKey = null;
    
    for (const AdapterClass of allAdapters) {
      const adapter = new AdapterClass();
      const cookieName = adapter.getCookieName();
      const apiKey = cookieStore.get(cookieName)?.value;
      
      if (apiKey) {
        if (!firstApiKey) {
          firstApiKey = apiKey;
          userId = apiKey.substring(0, 10); // Use first API key for user ID
        }
        
        // Make adapter adaptive (learns from operations)
        const adaptiveAdapter = makeAdaptive(adapter, userId);
        activeAdapters.push(adaptiveAdapter);
        adapterCredentials.set(adaptiveAdapter.getName(), {
          apiKey,
          baseUrl: adaptiveAdapter.getDefaultBaseUrl()
        });
      }
    }
    
    // At least one adapter must be authenticated
    if (activeAdapters.length === 0) {
      return NextResponse.json({ 
        error: 'No tools connected. Please connect at least one workspace (e.g., Attio).' 
      }, { status: 401 });
    }
    
    // Get Claude API key (from rotator or fallback to env var for backward compatibility)
    let claudeApiKey;
    try {
      claudeApiKey = getCurrentKey();
    } catch (error) {
      // Fallback to single key for backward compatibility
      claudeApiKey = process.env.ANTHROPIC_API_KEY;
      if (!claudeApiKey) {
        return NextResponse.json({ error: 'Server configuration error: Missing Claude API key. Set ANTHROPIC_API_KEY or ANTHROPIC_API_KEYS in environment.' }, { status: 500 });
      }
    }

    // Create general bot with all active adapters
    const generalBot = new GeneralBot(activeAdapters, claudeApiKey);

    // Check rate limiting
    const rateLimitCheck = generalBot.checkRateLimit(userId);
    if (!rateLimitCheck.allowed) {
      return NextResponse.json({
        error: `Please wait ${rateLimitCheck.waitTime} seconds before sending another message.`
      }, { status: 429 });
    }

    // Get configured APIs (for multi-API support)
    const configuredAPIs = getActiveAPIConfigs(userId);

    // Create control bot for intelligent routing
    const controlBot = new ControlBot(generalBot, activeAdapters, claudeApiKey);

    // Process message using control bot (intelligent routing)
    const result = await controlBot.processMessage(
      message,
      previousMessages,
      adapterCredentials,
      userId,
      configuredAPIs.length > 0 ? configuredAPIs : null
    );

    return NextResponse.json({
      success: true,
      response: result.response,
      iterations: result.iterations
    });

  } catch (error) {
    console.error('❌ Chat API error:', error);
    return NextResponse.json({
      error: error.message,
      details: error.stack
    }, { status: 500 });
  }
}
