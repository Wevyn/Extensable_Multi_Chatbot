/**
 * CRM Schema Loader - Load ENTIRE workspace into context
 * Makes Claude fully aware of the CRM like a website chatbot knows a website
 */

/**
 * Fetch and build COMPLETE workspace schema
 * This is called ONCE when user connects, then cached
 * Discovers EVERYTHING: objects, lists, tasks, notes, custom resources, etc.
 */
export async function loadCRMSchema(apiKey, baseUrl) {
  console.log('📚 Loading FULL workspace schema into context...');

  const schema = {
    base_url: baseUrl,
    workspace: null,
    objects: [],
    lists: [],
    tasks: [],
    notes: [],
    other_resources: [],
    all_endpoints: []
  };

  try {
    // Strategy: Explore common API patterns to discover ALL resources
    const commonEndpoints = [
      '/v2/workspace',
      '/v2/objects',
      '/v2/lists',
      '/v2/tasks',
      '/v2/notes',
      '/v2/comments',
      '/v2/webhooks',
      '/v2/users',
      '/v2/workspaces',
      '/v2/entries',
      '/v2/attributes',
      '/api/workspace',
      '/api/schema',
      '/metadata'
    ];

    // Discover all available endpoints
    for (const endpoint of commonEndpoints) {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        schema.all_endpoints.push({
          endpoint,
          method: 'GET',
          response_preview: JSON.stringify(data).substring(0, 500)
        });
        console.log(`✅ Discovered: GET ${endpoint}`);

        // Parse specific resource types
        if (endpoint.includes('objects')) {
          await loadObjects(schema, data, apiKey, baseUrl);
        } else if (endpoint.includes('workspace')) {
          schema.workspace = data;
        } else if (endpoint.includes('lists')) {
          schema.lists = data.data || data;
        } else if (endpoint.includes('tasks')) {
          schema.tasks = data.data || data;
        } else if (endpoint.includes('notes')) {
          schema.notes = data.data || data;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✅ Full workspace loaded: ${schema.objects.length} objects, ${schema.all_endpoints.length} endpoints discovered`);
    return schema;

  } catch (error) {
    console.error('❌ Schema loading failed:', error);
    return {
      error: error.message,
      note: 'Schema loading failed - agent will explore dynamically'
    };
  }
}

/**
 * Load all objects with their attributes
 */
async function loadObjects(schema, objectsData, apiKey, baseUrl) {
  for (const obj of objectsData.data || []) {
    const objectSlug = obj.api_slug;

    // Get attributes for this object
    const attrsResponse = await fetch(
      `${baseUrl}/v2/objects/${obj.id.object_id}/attributes`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    let attributes = [];
    if (attrsResponse.ok) {
      const attrsData = await attrsResponse.json();
      attributes = (attrsData.data || []).map(attr => ({
        slug: attr.api_slug,
        name: attr.name,
        type: attr.type,
        required: attr.is_required || false,
        multivalue: attr.is_multivalue || false
      }));
    }

    schema.objects.push({
      slug: objectSlug,
      name: obj.singular_noun,
      plural: obj.plural_noun,
      id: obj.id.object_id,
      attributes,
      operations: {
        query: `POST /v2/objects/${objectSlug}/records/query`,
        create: `POST /v2/objects/${objectSlug}/records`,
        get: `GET /v2/objects/${objectSlug}/records/{id}`,
        update: `PUT /v2/objects/${objectSlug}/records/{id}`,
        delete: `DELETE /v2/objects/${objectSlug}/records/{id}`,
        list: `GET /v2/objects/${objectSlug}/records`
      }
    });

    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/**
 * Convert schema to context string for Claude's system prompt
 */
export function schemaToContext(schema) {
  if (schema.error) {
    return `CRM Schema: Unable to load schema. You'll need to explore the API dynamically.`;
  }

  let context = `# COMPLETE CRM WORKSPACE KNOWLEDGE

Base URL: ${schema.base_url}

## Discovered Endpoints (All Available APIs):
${schema.all_endpoints.map(ep => `- ${ep.method} ${ep.endpoint}`).join('\n')}

`;

  // Add workspace info if available
  if (schema.workspace) {
    context += `## Workspace Information:
${JSON.stringify(schema.workspace, null, 2).substring(0, 1000)}

`;
  }

  // Add objects
  if (schema.objects.length > 0) {
    context += `## Objects (${schema.objects.length} total):
`;
    for (const obj of schema.objects) {
      context += `\n### ${obj.name} (${obj.plural})
Slug: ${obj.slug}

Attributes:
${obj.attributes.map(attr =>
  `  - ${attr.slug} (${attr.type})${attr.required ? ' [REQUIRED]' : ''}${attr.multivalue ? ' [ARRAY]' : ''}`
).join('\n')}

Operations:
  - Query/Search: ${obj.operations.query}
    Body: { limit: 50, filter: {...} }
  - Create: ${obj.operations.create}
    Body: { data: { values: { attribute_slug: [value] } } }
  - Get by ID: ${obj.operations.get}
  - Update: ${obj.operations.update}
  - Delete: ${obj.operations.delete}
`;
    }
  }

  // Add tasks if available
  if (schema.tasks && schema.tasks.length > 0) {
    context += `\n## Tasks:
Available at: GET /v2/tasks
Structure: ${JSON.stringify(schema.tasks[0], null, 2).substring(0, 500)}
`;
  }

  // Add lists if available
  if (schema.lists && schema.lists.length > 0) {
    context += `\n## Lists:
Available at: GET /v2/lists
Structure: ${JSON.stringify(schema.lists[0], null, 2).substring(0, 500)}
`;
  }

  // Add notes if available
  if (schema.notes && schema.notes.length > 0) {
    context += `\n## Notes:
Available at: GET /v2/notes
Structure: ${JSON.stringify(schema.notes[0], null, 2).substring(0, 500)}
`;
  }

  context += `\n## Important Notes:
- All attribute values in objects must be arrays (even single values)
- Use exact attribute slugs and endpoints documented above
- For resources like tasks/lists/notes, use the endpoints discovered above
- Try endpoints with POST/GET/PUT/DELETE to perform operations
`;

  return context;
}
