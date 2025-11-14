import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { setAPIConfig, getAPIConfig, getUserAPIConfigs, removeAPIConfig } from '@/lib/api-config-manager.js';
import { discoverAPIStructure, apiStructureToContext } from '@/lib/generic-api-discovery.js';
import { setCachedSchema } from '@/lib/schema-cache.js';

export const runtime = 'nodejs';

/**
 * GET - List all API configurations for the user
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const apiKey = cookieStore.get('attio_api_token')?.value; // Using existing auth for now
    
    if (!apiKey) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const userId = apiKey.substring(0, 10);
    const configs = getUserAPIConfigs(userId);
    
    // Return configs without sensitive data
    const safeConfigs = configs.map(config => ({
      name: config.name,
      type: config.type,
      baseUrl: config.baseUrl,
      active: config.active,
      hasDiscoveredStructure: !!config.discoveredStructure,
      lastDiscovery: config.lastDiscovery
    }));
    
    return NextResponse.json({ apis: safeConfigs });
  } catch (error) {
    console.error('Error fetching API configs:', error);
    return NextResponse.json({ error: 'Failed to fetch API configurations' }, { status: 500 });
  }
}

/**
 * POST - Add or update an API configuration
 * Body: {
 *   name: string,
 *   type: 'crm' | 'erp' | 'payroll' | 'custom',
 *   baseUrl: string,
 *   apiKey: string,
 *   authHeader?: 'Bearer' | 'API-Key' | 'Basic',
 *   authHeaderName?: string,
 *   discoveryEndpoints?: string[],
 *   openApiSpecUrl?: string
 * }
 */
export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const userApiKey = cookieStore.get('attio_api_token')?.value;
    
    if (!userApiKey) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const userId = userApiKey.substring(0, 10);
    const config = await request.json();
    
    // Validate required fields
    if (!config.name || !config.baseUrl || !config.apiKey) {
      return NextResponse.json({ 
        error: 'Missing required fields: name, baseUrl, apiKey' 
      }, { status: 400 });
    }
    
    // Create API configuration
    const apiConfig = setAPIConfig(userId, {
      name: config.name,
      type: config.type || 'custom',
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      authHeader: config.authHeader || 'Bearer',
      authHeaderName: config.authHeaderName || 'Authorization',
      discoveryEndpoints: config.discoveryEndpoints || [],
      openApiSpecUrl: config.openApiSpecUrl || null
    });
    
    // Discover API structure
    console.log(`🔍 Discovering structure for ${config.name}...`);
    try {
      const structure = await discoverAPIStructure(
        config.baseUrl,
        config.apiKey,
        {
          discoveryEndpoints: config.discoveryEndpoints || [],
          authHeader: config.authHeader || 'Bearer',
          authHeaderName: config.authHeaderName || 'Authorization',
          openApiSpecUrl: config.openApiSpecUrl || null
        }
      );
      
      apiConfig.updateDiscoveredStructure(structure);
      
      // Cache the structure (using name as cache key)
      const cacheKey = `${userId}:${config.name}`.substring(0, 20);
      setCachedSchema(cacheKey, structure);
      
      return NextResponse.json({
        success: true,
        message: `Successfully configured ${config.name}`,
        api: {
          name: config.name,
          type: config.type,
          baseUrl: config.baseUrl,
          discovered: true,
          resources: structure.resources?.length || 0,
          endpoints: structure.endpoints?.length || 0
        }
      });
    } catch (discoveryError) {
      console.error('Discovery error:', discoveryError);
      return NextResponse.json({
        success: true,
        message: `API configured but discovery failed: ${discoveryError.message}`,
        api: {
          name: config.name,
          type: config.type,
          baseUrl: config.baseUrl,
          discovered: false
        },
        warning: 'You may need to provide discovery endpoints or OpenAPI spec URL'
      });
    }
  } catch (error) {
    console.error('Error configuring API:', error);
    return NextResponse.json({ error: 'Failed to configure API' }, { status: 500 });
  }
}

/**
 * DELETE - Remove an API configuration
 */
export async function DELETE(request) {
  try {
    const cookieStore = await cookies();
    const userApiKey = cookieStore.get('attio_api_token')?.value;
    
    if (!userApiKey) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const userId = userApiKey.substring(0, 10);
    const { name } = await request.json();
    
    if (!name) {
      return NextResponse.json({ error: 'API name is required' }, { status: 400 });
    }
    
    const removed = removeAPIConfig(userId, name);
    
    if (removed) {
      return NextResponse.json({ success: true, message: `Removed ${name}` });
    } else {
      return NextResponse.json({ error: 'API configuration not found' }, { status: 404 });
    }
  } catch (error) {
    console.error('Error removing API config:', error);
    return NextResponse.json({ error: 'Failed to remove API configuration' }, { status: 500 });
  }
}

