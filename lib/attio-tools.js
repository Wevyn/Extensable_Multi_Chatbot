/**
 * Simple, working Attio tools
 * No overthinking - just give Claude what it needs to access the CRM
 */

const ATTIO_BASE_URL = 'https://api.attio.com/v2';

/**
 * Get simple, working tools for Attio CRM
 */
export function getAttioTools() {
  return [
    {
      name: 'get_workspace_schema',
      description: 'Get all objects, attributes, and their types in the Attio workspace. Call this first to understand what data is available.',
      input_schema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'query_records',
      description: 'Query/search for records in any object (people, companies, deals, etc.). Returns matching records.',
      input_schema: {
        type: 'object',
        properties: {
          object: {
            type: 'string',
            description: 'Object slug (e.g., "people", "companies", "deals")'
          },
          filter: {
            type: 'object',
            description: 'Optional filter criteria'
          },
          limit: {
            type: 'number',
            description: 'Max records to return (default 20)'
          }
        },
        required: ['object']
      }
    },
    {
      name: 'create_record',
      description: 'Create a new record in any object. Use the workspace schema to know which attributes are available.',
      input_schema: {
        type: 'object',
        properties: {
          object: {
            type: 'string',
            description: 'Object slug (e.g., "people", "companies")'
          },
          values: {
            type: 'object',
            description: 'Attribute values to set. Format: { attribute_slug: value }'
          }
        },
        required: ['object', 'values']
      }
    },
    {
      name: 'update_record',
      description: 'Update an existing record',
      input_schema: {
        type: 'object',
        properties: {
          object: {
            type: 'string',
            description: 'Object slug'
          },
          record_id: {
            type: 'string',
            description: 'Record ID to update'
          },
          values: {
            type: 'object',
            description: 'Attribute values to update'
          }
        },
        required: ['object', 'record_id', 'values']
      }
    }
  ];
}

/**
 * Execute Attio tool calls
 */
export async function executeAttioTool(toolName, input, attioApiKey) {
  switch (toolName) {
    case 'get_workspace_schema':
      return await getWorkspaceSchema(attioApiKey);

    case 'query_records':
      return await queryRecords(input, attioApiKey);

    case 'create_record':
      return await createRecord(input, attioApiKey);

    case 'update_record':
      return await updateRecord(input, attioApiKey);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * Get workspace schema - all objects and attributes
 */
async function getWorkspaceSchema(apiKey) {
  // Get all objects
  const objectsRes = await attioFetch('/objects', apiKey);
  const objects = objectsRes.data || [];

  const schema = [];

  for (const obj of objects) {
    const objectId = obj.id?.object_id;
    if (!objectId) continue;

    // Get attributes for this object
    const attrsRes = await attioFetch(`/objects/${objectId}/attributes`, apiKey);
    const attributes = attrsRes.data || [];

    schema.push({
      slug: obj.api_slug,
      name: obj.name,
      attributes: attributes.map(attr => ({
        slug: attr.api_slug,
        name: attr.name,
        type: attr.type,
        required: attr.is_required || false,
        multivalue: attr.is_multivalue || false
      }))
    });

    // Small delay for rate limiting
    await sleep(50);
  }

  return { objects: schema };
}

/**
 * Query records
 */
async function queryRecords(input, apiKey) {
  const { object, filter, limit = 20 } = input;

  const body = {
    limit,
    ...(filter && { filter })
  };

  const result = await attioFetch(`/objects/${object}/records/query`, apiKey, 'POST', body);
  return result;
}

/**
 * Create record
 */
async function createRecord(input, apiKey) {
  const { object, values } = input;

  const body = {
    data: {
      values: values
    }
  };

  const result = await attioFetch(`/objects/${object}/records`, apiKey, 'POST', body);
  return result;
}

/**
 * Update record
 */
async function updateRecord(input, apiKey) {
  const { object, record_id, values } = input;

  const body = {
    data: {
      values: values
    }
  };

  const result = await attioFetch(`/objects/${object}/records/${record_id}`, apiKey, 'PUT', body);
  return result;
}

/**
 * Helper: Make Attio API call
 */
async function attioFetch(endpoint, apiKey, method = 'GET', body = null) {
  const url = `${ATTIO_BASE_URL}${endpoint}`;

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Attio API Error (${response.status}): ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * Helper: Sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
