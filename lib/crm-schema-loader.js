/**
 * CRM Schema Loader - Load ENTIRE workspace into context
 * Makes Claude fully aware of the CRM like a website chatbot knows a website
 */

/**
 * Normalize company/entity names for fuzzy matching
 * Removes common suffixes, punctuation, and normalizes whitespace
 * This allows matching "Tesla" with "Tesla Inc", "Tesla, Inc.", etc.
 */
export function normalizeEntityName(name) {
  if (!name || typeof name !== 'string') return '';
  
  // Convert to lowercase and trim
  let normalized = name.toLowerCase().trim();
  
  // Remove common business suffixes (with various punctuation)
  const suffixes = [
    'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation',
    'co', 'company', 'plc', 'lp', 'llp', 'pc', 'pa', 'p.c.', 'p.a.',
    'gmbh', 'ag', 'sa', 'nv', 'bv', 'oy', 'ab', 'as', 'spa', 'srl'
  ];
  
  // Remove suffixes with various punctuation patterns
  for (const suffix of suffixes) {
    const patterns = [
      new RegExp(`\\s+${suffix}\\.?$`, 'i'),
      new RegExp(`[,.]\\s*${suffix}\\.?$`, 'i'),
      new RegExp(`\\s+${suffix}\\s*$`, 'i')
    ];
    
    for (const pattern of patterns) {
      normalized = normalized.replace(pattern, '');
    }
  }
  
  // Remove punctuation and extra whitespace
  normalized = normalized.replace(/[.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
  
  return normalized;
}

/**
 * Check if two entity names match (fuzzy matching)
 * Returns true if normalized names are the same
 */
export function entityNamesMatch(name1, name2) {
  const normalized1 = normalizeEntityName(name1);
  const normalized2 = normalizeEntityName(name2);
  
  if (!normalized1 || !normalized2) return false;
  
  // Exact match after normalization
  if (normalized1 === normalized2) return true;
  
  // Check if one contains the other (for cases like "Tesla Motors" vs "Tesla")
  const longer = normalized1.length > normalized2.length ? normalized1 : normalized2;
  const shorter = normalized1.length > normalized2.length ? normalized2 : normalized1;
  
  // If shorter name is at least 3 chars and is contained in longer, consider it a match
  if (shorter.length >= 3 && longer.includes(shorter)) {
    return true;
  }
  
  return false;
}

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
      attributes = (attrsData.data || []).map(attr => {
        const attrInfo = {
        slug: attr.api_slug,
        name: attr.name,
        type: attr.type,
        required: attr.is_required || false,
        multivalue: attr.is_multivalue || false
        };
        
        // Capture additional structure for complex types
        if (attr.config) {
          // For name attributes, capture the structure
          if (attr.type === 'name' && attr.config.fields) {
            attrInfo.fields = attr.config.fields;
            attrInfo.example = {
              first_name: "John",
              last_name: "Smith"
            };
          }
          // For record-reference types (links to other records), capture target object
          if ((attr.type === 'record-reference' || attr.type === 'reference') && attr.config.target_object) {
            attrInfo.target_object = attr.config.target_object;
            attrInfo.example = { id: "uuid-of-target-record" };
          }
          // For other complex types, capture config
          if (attr.config.target_object && !attrInfo.target_object) {
            attrInfo.target_object = attr.config.target_object;
          }
        }
        
        return attrInfo;
      });
    }

    // Load actual records for this object (configurable limit)
    const maxRecordsPerObject = parseInt(process.env.MAX_RECORDS_PER_OBJECT || '500', 10);
    let records = [];
    
    if (maxRecordsPerObject > 0) {
      try {
        console.log(`📥 Loading records for ${objectSlug} (max ${maxRecordsPerObject})...`);
        const recordsResponse = await fetch(
          `${baseUrl}/v2/objects/${objectSlug}/records/query`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              limit: maxRecordsPerObject
            })
          }
        );
        
        if (recordsResponse.ok) {
          const recordsData = await recordsResponse.json();
          const seenIds = new Set(); // Track seen record IDs to prevent duplicates
          
          records = (recordsData.data || []).map(record => {
            const recordId = record.id?.record_id;
            
            // Skip duplicates
            if (!recordId || seenIds.has(recordId)) {
              return null;
            }
            seenIds.add(recordId);
            
            // Extract key fields only to save tokens
            const simplifiedRecord = {
              id: recordId,
              values: {}
            };
            
            // Include important fields (name, email, etc.)
            if (record.values) {
              for (const [key, value] of Object.entries(record.values)) {
                // Only include key identifying fields
                if (key.includes('name') || key.includes('email') || key.includes('title') || 
                    key.includes('company') || key === 'slug' || attributes.find(a => a.slug === key && a.required)) {
                  simplifiedRecord.values[key] = value;
                }
              }
            }
            
            return simplifiedRecord;
          }).filter(r => r !== null); // Remove null entries (duplicates)
          
          console.log(`✅ Loaded ${records.length} unique records for ${objectSlug}`);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to load records for ${objectSlug}:`, error.message);
        // Continue without records - schema is still useful
      }
    }

    schema.objects.push({
      slug: objectSlug,
      name: obj.singular_noun,
      plural: obj.plural_noun,
      id: obj.id.object_id,
      attributes,
      records, // Include actual records
      recordCount: records.length,
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
  
  // Build lookup maps for ALL object types to resolve record-references generically
  // This allows resolving any record-reference field (company, owner, associated_people, etc.)
  const recordLookups = new Map(); // Map<objectSlug, Map<recordId, displayName>>
  
  for (const obj of schema.objects) {
    if (!obj.records || obj.records.length === 0) continue;
    
    const objectLookup = new Map();
    
    for (const record of obj.records) {
      if (!record.id || !record.values) continue;
      
      // Extract display name from the record
      // Try common name fields first
      let displayName = null;
      
      // Check for name field (most common)
      const nameValue = record.values.name;
      if (nameValue && Array.isArray(nameValue) && nameValue.length > 0) {
        const nameObj = nameValue[0];
        if (typeof nameObj === 'string') {
          displayName = nameObj;
        } else if (typeof nameObj === 'object' && nameObj !== null) {
          // For name objects, try known common fields first
          // Companies might have: name, title, singular_noun, plural_noun, full_name
          displayName = nameObj.name || 
                       nameObj.title || 
                       nameObj.full_name || 
                       nameObj.singular_noun || 
                       nameObj.plural_noun ||
                       (nameObj.values && (nameObj.values.name || nameObj.values.title || nameObj.values.value)) ||
                       (nameObj.first_name && nameObj.last_name ? `${nameObj.first_name} ${nameObj.last_name}`.trim() : null) ||
                       nameObj.first_name;
          
          // If no known field found, look for ANY string field that could be the display name
          // This handles cases where the name is in unexpected fields like "value", "label", etc.
          // Skip technical/metadata fields (timestamps, IDs, type indicators)
          if (!displayName) {
            const technicalFields = new Set([
              'active_from', 'active_until', 'created_at', 'updated_at', 'timestamp',
              'created_by_actor', 'attribute_type', 'id', '_id', 'record_id',
              'target_object', 'target_record_id', 'suggest', 'metadata'
            ]);
            
            // Look for any string value that's not a technical field
            for (const [key, val] of Object.entries(nameObj)) {
              if (technicalFields.has(key)) continue; // Skip technical fields
              
              if (typeof val === 'string' && val.length > 0) {
                // Skip if it looks like a timestamp, UUID, or empty
                if (!val.match(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i) && 
                    !val.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
                  displayName = val;
                  break; // Use the first non-technical string field found
                }
              }
            }
          }
        }
      }
      
      // If no name field, try email (for people)
      if (!displayName && record.values.email_addresses && Array.isArray(record.values.email_addresses) && record.values.email_addresses.length > 0) {
        const emailObj = record.values.email_addresses[0];
        if (typeof emailObj === 'string') {
          displayName = emailObj;
        } else if (typeof emailObj === 'object' && emailObj !== null) {
          displayName = emailObj.email_address || emailObj.email || emailObj.original_email_address;
        }
      }
      
      // If still no display name, try slug or any string field
      if (!displayName) {
        for (const [key, value] of Object.entries(record.values)) {
          if (key === 'slug' || key.includes('name') || key.includes('title') || key.includes('company')) {
            if (Array.isArray(value) && value.length > 0) {
              const val = value[0];
              if (typeof val === 'string' && val.length > 0 && !val.match(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i)) {
                displayName = val;
                break;
              } else if (typeof val === 'object' && val !== null) {
                // Try known common fields first
                let extracted = val.name || 
                                val.title || 
                                val.singular_noun || 
                                val.plural_noun || 
                                val.full_name ||
                                val.company_name ||
                                val.company ||
                                (val.values && (val.values.name || val.values.title || val.values.value));
                
                // If no known field found, look for ANY string field that could be the display name
                // This handles cases where the name is in unexpected fields like "value", "label", etc.
                if (!extracted) {
                  const technicalFields = new Set([
                    'active_from', 'active_until', 'created_at', 'updated_at', 'timestamp',
                    'created_by_actor', 'attribute_type', 'id', '_id', 'record_id',
                    'target_object', 'target_record_id', 'suggest', 'metadata'
                  ]);
                  
                  // Look for any string value that's not a technical field
                  for (const [key, fieldVal] of Object.entries(val)) {
                    if (technicalFields.has(key)) continue; // Skip technical fields
                    
                    if (typeof fieldVal === 'string' && fieldVal.length > 0) {
                      // Skip if it looks like a timestamp, UUID, or empty
                      if (!fieldVal.match(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i) && 
                          !fieldVal.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
                        extracted = fieldVal;
                        break; // Use the first non-technical string field found
                      }
                    }
                  }
                }
                
                if (extracted) {
                  displayName = extracted;
                  break;
                }
              }
            } else if (typeof value === 'string' && value.length > 0 && !value.match(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i)) {
              // Some fields might be direct strings, not arrays
              displayName = value;
              break;
            }
          }
        }
      }
      
      // DEBUG: Only log for target company or if it's a critical failure
      if (!displayName && (obj.slug === 'companies' || obj.slug === 'company') && record.id === 'a3593388-7102-4d00-a0ad-906908e46453') {
        console.log(`   ⚠️ Could not extract display name for target company ${record.id}`);
        if (record.values.name) {
          console.log(`   Name value:`, JSON.stringify(record.values.name).substring(0, 300));
        }
      }
      
      if (displayName) {
        objectLookup.set(record.id, displayName);
        // DEBUG: Log specific company if it's the one we need
        if ((obj.slug === 'companies' || obj.slug === 'company') && record.id === 'a3593388-7102-4d00-a0ad-906908e46453') {
          console.log(`   ✅ Found target company record: ${record.id} -> ${displayName}`);
          console.log(`   Record values:`, JSON.stringify(record.values, null, 2).substring(0, 500));
        }
      } else {
        // DEBUG: Log if we couldn't extract display name for the target company
        if ((obj.slug === 'companies' || obj.slug === 'company') && record.id === 'a3593388-7102-4d00-a0ad-906908e46453') {
          console.log(`   ❌ FAILED to extract display name for target company record: ${record.id}`);
          console.log(`   Record values keys:`, Object.keys(record.values || {}));
          console.log(`   Full record.values:`, JSON.stringify(record.values, null, 2).substring(0, 1000));
        } else if (obj.slug === 'companies' || obj.slug === 'company') {
          // DEBUG: Log if we couldn't extract a name for any company
          console.log(`   ⚠️ Could not extract display name for company record ${record.id}`);
          console.log(`   Record values keys:`, Object.keys(record.values || {}));
          if (record.values.name) {
            console.log(`   Name value:`, JSON.stringify(record.values.name).substring(0, 200));
          }
        }
      }
    }
    
    if (objectLookup.size > 0) {
      recordLookups.set(obj.slug, objectLookup);
      // DEBUG: Log lookup map size for companies
      if (obj.slug === 'companies' || obj.slug === 'company') {
        console.log(`📦 Built company lookup map with ${objectLookup.size} entries`);
        // Log first few entries for debugging
        const firstFew = Array.from(objectLookup.entries()).slice(0, 5);
        console.log(`   Sample entries:`, firstFew.map(([id, name]) => `${id.substring(0, 8)}... -> ${name}`));
        // Check if the specific ID we need is in the map
        const targetId = 'a3593388-7102-4d00-a0ad-906908e46453';
        if (objectLookup.has(targetId)) {
          console.log(`   ✅ Target ID ${targetId.substring(0, 8)}... is in the map -> ${objectLookup.get(targetId)}`);
        } else {
          console.log(`   ⚠️ Target ID ${targetId.substring(0, 8)}... is NOT in the map`);
          // Check if any IDs are similar
          const allIds = Array.from(objectLookup.keys());
          console.log(`   All IDs in map (first 10):`, allIds.slice(0, 10));
          // Check if the target company record exists in the loaded records
          const targetRecord = obj.records.find(r => r.id === targetId);
          if (targetRecord) {
            console.log(`   ⚠️ Target company record EXISTS in loaded records but name extraction failed`);
            console.log(`   Record values keys:`, Object.keys(targetRecord.values || {}));
            if (targetRecord.values.name) {
              console.log(`   Name value:`, JSON.stringify(targetRecord.values.name).substring(0, 500));
            }
          } else {
            console.log(`   ⚠️ Target company record NOT FOUND in loaded records (maybe beyond limit?)`);
            console.log(`   Total companies loaded: ${obj.records.length}`);
          }
        }
      }
    }
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

  // Add objects with detailed examples and actual data
  if (schema.objects.length > 0) {
    context += `## Objects (${schema.objects.length} total):
`;
    for (const obj of schema.objects) {
      context += `\n### ${obj.name} (${obj.plural})
Slug: ${obj.slug}

Attributes with Formatting Rules:
${obj.attributes.map(attr => {
  let desc = `  - ${attr.slug} (${attr.type})${attr.required ? ' [REQUIRED]' : ' [OPTIONAL]'}${attr.multivalue ? ' [ARRAY]' : ''}`;
  
  // Add detailed formatting examples based on type
  switch (attr.type) {
    case 'name':
      if (attr.fields) {
        desc += `\n    Format: Object with fields: ${attr.fields.join(', ')}`;
        desc += `\n    Example: { first_name: "John", last_name: "Smith" }`;
        desc += `\n    Always use: [{ first_name: "John", last_name: "Smith" }] (wrapped in array)`;
      }
      break;
      
    case 'email':
      desc += `\n    Format: Valid email address (must contain @ and domain)`;
      desc += `\n    Example: "demo@example.test" (FICTIONAL - only use real records from database)`;
      desc += `\n    Always use: ["demo@example.test"] (wrapped in array)`;
      break;
      
    case 'phone':
    case 'phone-number':
      desc += `\n    Format: Phone number (7-15 digits, formatting optional)`;
      desc += `\n    Examples: "555-123-4567", "+1-555-123-4567", "5551234567"`;
      desc += `\n    Always use: ["555-123-4567"] (wrapped in array)`;
      break;
      
    case 'url':
    case 'website':
      desc += `\n    Format: Valid URL (with or without protocol)`;
      desc += `\n    Examples: "https://example.com", "www.example.com"`;
      desc += `\n    Always use: ["https://example.com"] (wrapped in array)`;
      break;
      
    case 'date':
      desc += `\n    Format: ISO date string (YYYY-MM-DD or ISO 8601)`;
      desc += `\n    Examples: "2024-01-15", "2024-01-15T10:30:00Z"`;
      desc += `\n    Always use: ["2024-01-15"] (wrapped in array)`;
      break;
      
    case 'number':
    case 'currency':
    case 'decimal':
      desc += `\n    Format: Numeric value`;
      desc += `\n    Examples: 1000, 99.99, 50000`;
      desc += `\n    Always use: [1000] (wrapped in array)`;
      break;
      
    case 'select':
    case 'multi-select':
      desc += `\n    Format: String value matching one of the allowed options`;
      desc += `\n    Always use: ["option_value"] (wrapped in array)`;
      break;
      
    default:
      desc += `\n    Format: String value`;
      desc += `\n    Example: "Some text"`;
      desc += `\n    Always use: ["Some text"] (wrapped in array)`;
  }
  
  // Reference fields (record-reference type - links to other records)
  if (attr.type === 'record-reference' || attr.type === 'reference' || attr.target_object) {
    const targetObj = attr.target_object || 'target_object';
    desc += `\n    Type: Record Reference (links to ${targetObj} object)`;
    desc += `\n    Format: [{ "target_object": "${targetObj}", "target_record_id": "uuid-of-target-record" }]`;
    desc += `\n    Example: [{ "target_object": "${targetObj}", "target_record_id": "123e4567-e89b-12d3-a456-426614174000" }]`;
    desc += `\n    CRITICAL: Must include "target_object" (object type slug) AND "target_record_id" (UUID, NOT "record_id"). Do NOT include "attribute_type" - API rejects it!`;
    desc += `\n    WORKFLOW: Search for the record first (POST /v2/objects/${targetObj}/records/query), if not found create it (POST /v2/objects/${targetObj}/records), then get the record_id from the API response and use it here.`;
  }
  
  return desc;
}).join('\n')}

Operations with Examples:
  - Query/Search: ${obj.operations.query}
    Body: { limit: 50, filter: {...} }
    
  - Create: ${obj.operations.create}
    Body Format: { data: { values: { attribute_slug: [value] } } }
    
    Complete Example for ${obj.name}:
    {
      "data": {
        "values": {
${generateExampleValues(obj.attributes)}
        }
      }
    }
    
  - Get by ID: ${obj.operations.get}
  - Update: ${obj.operations.update}
    Body Format: Same as Create
  - Delete: ${obj.operations.delete}
`;

      // Include actual records from database
      if (obj.records && obj.records.length > 0) {
        // DEBUG: Log before adding records section
        if (obj.slug === 'people' || obj.slug === 'person') {
          console.log(`\n📋 Adding ${obj.recordCount} people records to context...`);
        }
        
        context += `
Existing Records in Database (${obj.recordCount} total):
CRITICAL: The records listed below are REAL database records. Example text elsewhere in this prompt (like "demo@example.test" or "Alice Example") is FICTIONAL and NOT real data.
Note: For company/entity names, variations like "Tesla" and "Tesla Inc" are the same entity. 
The system automatically normalizes names for matching (removes suffixes like Inc, LLC, Corp, etc.).

IMPORTANT: When displaying person records, if a person has a company field, the company name is automatically resolved and shown. 
If you see "company: Tesla" in a person record, that person works at Tesla - use that information directly!
`;
        // Show first 50 records to avoid token limits
        // Deduplicate by ID before displaying (in case duplicates slipped through)
        const seenRecordIds = new Set();
        const uniqueRecords = obj.records.filter(record => {
          const recordId = record.id;
          if (!recordId || seenRecordIds.has(recordId)) {
            return false; // Skip duplicate
          }
          seenRecordIds.add(recordId);
          return true;
        });
        const recordsToShow = uniqueRecords.slice(0, 50);
        let recordIndex = 0;
        for (const record of recordsToShow) {
          recordIndex++;
          const recordSummary = [];
          const priorityFields = []; // Human-friendly fields first
          const otherFields = [];
          
          if (record.values) {
            // Sort fields: prioritize human-friendly identifiers
            const fieldOrder = ['name', 'email', 'company', 'title', 'job_title', 'phone', 'phone_number'];
            
            for (const [key, value] of Object.entries(record.values)) {
              // Skip technical/metadata fields that users don't know
              if (key.includes('timestamp') || key.includes('created_at') || key.includes('updated_at') || 
                  key.includes('_id') || key === 'id' || key.includes('metadata') ||
                  key.includes('active_from') || key.includes('active_until') || key === 'suggest') {
                continue; // Don't show these to users
              }
              
              let displayValue = null;
              if (value && Array.isArray(value) && value.length > 0) {
                // Special handling for email_addresses - extract all email addresses
                if (key.includes('email')) {
                  const emails = value
                    .map(v => {
                      if (typeof v === 'string') return v;
                      if (typeof v === 'object' && v !== null) {
                        return v.email_address || v.email || v.address;
                      }
                      return null;
                    })
                    .filter(e => e && !e.includes('active_from') && !e.includes('timestamp'));
                  if (emails.length > 0) {
                    displayValue = emails.join(', ');
                  } else {
                    continue; // Skip if no readable emails found
                  }
                }
                // Special handling for phone numbers
                else if (key.includes('phone')) {
                  const phones = value
                    .map(v => {
                      if (typeof v === 'string') return v;
                      if (typeof v === 'object' && v !== null) {
                        return v.phone_number || v.phone || v.number;
                      }
                      return null;
                    })
                    .filter(p => p);
                  if (phones.length > 0) {
                    displayValue = phones.join(', ');
                  } else {
                    continue;
                  }
                }
                // Generic handling for record-reference fields (company, owner, associated_people, etc.)
                // Check if this field is a record-reference type by looking at the attribute definition
                else {
                  const attr = obj.attributes.find(a => a.slug === key);
                  const isRecordReference = attr && (attr.type === 'record-reference' || attr.type === 'reference' || attr.target_object);
                  
                  // Get target_object from attribute definition, or fall back to the value itself
                  // (Some APIs don't include target_object in the attribute definition, but it's in the data)
                  let targetObjectSlug = attr?.target_object;
                  if (!targetObjectSlug && value && Array.isArray(value) && value.length > 0) {
                    const firstVal = value[0];
                    if (typeof firstVal === 'object' && firstVal !== null && firstVal.target_object) {
                      targetObjectSlug = firstVal.target_object;
                    }
                  }
                  
                  if (isRecordReference && targetObjectSlug) {
                    // This is a record-reference field - resolve the referenced record's display name
                    const referencedNames = value
                      .map(v => {
                        if (typeof v === 'string') return v;
                        if (typeof v === 'object' && v !== null) {
                          // First, try to extract name directly from the object (if it's embedded)
                          let referencedName = v.title || v.name || v.singular_noun || v.plural_noun || 
                                             v.company_name || v.company || v.label ||
                                             (v.values && (v.values.name || v.values.title));
                          
                          // If no name found, try to resolve from target_record_id (record-reference type)
                          if (!referencedName && v.target_record_id) {
                            const targetLookup = recordLookups.get(targetObjectSlug);
                            if (targetLookup) {
                              referencedName = targetLookup.get(v.target_record_id);
                            }
                          }
                          
                          // Also try record_id or id fields
                          if (!referencedName) {
                            const recordId = v.record_id || v.id || v._id;
                            if (recordId) {
                              const targetLookup = recordLookups.get(targetObjectSlug);
                              if (targetLookup) {
                                referencedName = targetLookup.get(recordId);
                              }
                            }
                          }
                          
                          // Last resort: try to find any string value (but not timestamps, UUIDs, or target_object)
                          if (!referencedName) {
                            referencedName = Object.values(v).find(val => 
                              typeof val === 'string' && 
                              val.length > 0 && 
                              !val.match(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i) &&
                              !val.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) && // Not a UUID
                              val !== targetObjectSlug && // Not the target_object slug (e.g., "companies")
                              !['target_object', 'target_record_id', 'record_id', 'id', '_id'].includes(val) // Not field names
                            );
                          }
                          
                          return referencedName;
                        }
                        return null;
                      })
                      .filter(n => n && typeof n === 'string');
                    
                    if (referencedNames.length > 0) {
                      displayValue = referencedNames.join(', ');
                    } else {
                      // If we can't extract a name, try to get the ID and look it up
                      const ids = value
                        .map(v => {
                          if (typeof v === 'object' && v !== null) {
                            return v.target_record_id || v.record_id || v.id || v._id;
                          }
                          return null;
                        })
                        .filter(id => id);
                      
                      if (ids.length > 0) {
                        // Try to look up the referenced record's name by ID
                        const targetLookup = recordLookups.get(targetObjectSlug);
                        if (targetLookup) {
                          const lookedUpName = targetLookup.get(ids[0]);
                          
                          if (lookedUpName) {
                            displayValue = lookedUpName;
                          } else {
                            // If we still can't find it, skip showing it (better than showing cryptic ID)
                            continue;
                          }
                        } else {
                          // No lookup available for this target object type - skip
                          continue;
                        }
                      } else {
                        continue; // Skip if we can't extract anything useful
                      }
                    }
                  } else {
                    // Handle first element for other arrays (non-record-reference)
                    const val = value[0];
                    if (typeof val === 'object' && val !== null) {
                      // CRITICAL: Filter out ALL technical/timestamp fields from display
                      const technicalFields = ['active_from', 'active_until', 'created_at', 'updated_at', 'timestamp', '_id', 'id', 'record_id', 'suggest', 'created_by_actor', 'attribute_type'];
                      const filteredVal = {};
                      for (const [k, v] of Object.entries(val)) {
                        if (!technicalFields.some(tf => k.toLowerCase().includes(tf.toLowerCase()))) {
                          filteredVal[k] = v;
                        }
                      }
                      
                      // Handle name objects
                      if (filteredVal.first_name || filteredVal.last_name) {
                        displayValue = `${filteredVal.first_name || ''} ${filteredVal.last_name || ''}`.trim();
                      }
                      // Handle other link objects - extract name or title
                      else if (filteredVal.name || filteredVal.title || filteredVal.singular_noun || filteredVal.plural_noun || filteredVal.label) {
                        displayValue = filteredVal.name || filteredVal.title || filteredVal.singular_noun || filteredVal.plural_noun || filteredVal.label;
                      }
                      // For other objects, try to find a human-readable field
                      else {
                        const readableFields = Object.keys(filteredVal).filter(k => {
                          const valStr = String(filteredVal[k]).toLowerCase();
                          return !technicalFields.some(tf => valStr.includes(tf)) && 
                                 !valStr.match(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i); // No ISO timestamps
                        });
                        if (readableFields.length > 0) {
                          // Use the first readable field
                          const firstReadable = readableFields[0];
                          displayValue = typeof filteredVal[firstReadable] === 'string' ? filteredVal[firstReadable] : String(filteredVal[firstReadable]);
                        } else {
                          // Skip this field entirely if it only has technical data
                          continue;
                        }
                      }
                    } else {
                      // Check if it's a timestamp string
                      if (typeof val === 'string' && val.match(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i)) {
                        continue; // Skip timestamp strings
                      }
                      displayValue = val;
                    }
                  }
                }
              } else if (value) {
                displayValue = value;
              }
              
              if (displayValue) {
                const fieldEntry = `${key}: ${displayValue}`;
                // Prioritize human-friendly fields
                if (fieldOrder.some(f => key.toLowerCase().includes(f))) {
                  priorityFields.push(fieldEntry);
                } else {
                  otherFields.push(fieldEntry);
                }
              }
            }
          }
          
          // Combine: priority fields first, then others
          const allFields = [...priorityFields, ...otherFields];
          
          // Always include record ID at the end (needed for updates/links)
          const recordIdDisplay = record.id ? `[ID: ${record.id}]` : '';
          
          // For company/entity names, add normalized version for fuzzy matching
          let normalizedNameHint = '';
          if (obj.slug === 'companies' || obj.slug === 'company') {
            // Find the name field
            const nameField = priorityFields.find(f => f.includes('name:'));
            if (nameField) {
              const nameMatch = nameField.match(/name:\s*(.+?)(?:,|$)/);
              if (nameMatch && nameMatch[1]) {
                const originalName = nameMatch[1].trim();
                const normalized = normalizeEntityName(originalName);
                if (normalized && normalized !== originalName.toLowerCase()) {
                  // Add hint about normalized name (for Claude's matching)
                  normalizedNameHint = ` [normalized: ${normalized}]`;
                }
              }
            }
          }
          
          // For people records, also normalize company names for matching
          if (obj.slug === 'people' || obj.slug === 'person') {
            const companyField = priorityFields.find(f => f.includes('company:'));
            if (companyField) {
              const companyMatch = companyField.match(/company:\s*(.+?)(?:\s+\[|,|$)/);
              if (companyMatch && companyMatch[1]) {
                const companyName = companyMatch[1].trim();
                const normalized = normalizeEntityName(companyName);
                if (normalized && normalized !== companyName.toLowerCase()) {
                  normalizedNameHint = ` [company normalized: ${normalized}]`;
                }
              }
            }
          }
          
          const recordDisplay = allFields.length > 0 
            ? `${allFields.join(', ')}${normalizedNameHint} ${recordIdDisplay}`.trim()
            : `Record${normalizedNameHint} ${recordIdDisplay || '(no ID)'}`;
          
          context += `  - ${recordDisplay}\n`;
        }
        if (obj.records.length > 50) {
          context += `  ... and ${obj.records.length - 50} more records\n`;
        }
        
        // Check if we loaded the full database or a subset
        const maxRecords = parseInt(process.env.MAX_RECORDS_PER_OBJECT || '500', 10);
        const isFullDatabase = obj.recordCount < maxRecords;
        
        if (isFullDatabase) {
          context += `
Note: You have access to ALL ${obj.recordCount} ${obj.plural} records (full database). Use this list to check if records exist before creating duplicates.
`;
        } else {
          context += `
Note: You have access to ${obj.recordCount} ${obj.plural} records (subset of database, max ${maxRecords} loaded). 
If you can't find a record in this list, QUERY the database before assuming it doesn't exist. 
Only create new records if your query confirms they don't exist.
`;
        }
      } else {
        context += `
Existing Records: None (database is empty for this object type)
`;
      }
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

  context += `\n## Critical Formatting Rules:
- ALL attribute values MUST be wrapped in arrays, even single values
- Example: name: [{ first_name: "Patricia", last_name: "Example" }] NOT name: { first_name: "Patricia" }
⚠️ NOTE: "Patricia Example" is FICTIONAL - only use real records from the database.
- Example: email: ["demo@example.test"] NOT email: "demo@example.test"
⚠️ NOTE: "demo@example.test" is FICTIONAL - only use real records from the database.
- Example: phone: ["555-123-4567"] NOT phone: "555-123-4567"

## Data Collection Guidelines:
- When user wants to CREATE or UPDATE a record, ask for missing REQUIRED fields
- Ask questions naturally and conversationally (like ChatGPT/Claude)
- You can ask multiple questions at once or one at a time
- If user provides partial information, extract what you can and ask for the rest
- For optional fields, ask once - if not provided, proceed without them
- Always validate data format before submitting

## Validation Rules:
- Email: Must contain @ and valid domain (e.g., user@domain.com)
- Phone: Must be 7-15 digits (formatting like dashes/spaces is OK)
- URL: Must be valid URL format
- Date: Must be parseable date (ISO format preferred)
- Number: Must be numeric
- Name: Must include required fields (usually first_name and last_name)
- Required fields: Cannot be empty or null

## Error Handling:
- If submission fails with validation error, explain the specific issue to user
- Ask user to provide corrected information
- Never retry with the same invalid data
- For network/rate limit errors, retry automatically (max 3 attempts)

## Example Conversation Flow:
⚠️ CRITICAL: The names below (Nancy Example, nancy@demo.test) are FICTIONAL - only use real records from the "Existing Records in Database" section above.

User: "Add a new contact"
You: "I'll help you add a new contact. I need:
      - Name (first and last)
      - Email address
      - Phone number (optional)
      - Company (optional)"

User: "Nancy Example, nancy@demo.test"
You: "Got it! I have Nancy Example with email nancy@demo.test. Do you have a phone number or company? (both optional)"
⚠️ NOTE: "Nancy Example" and "nancy@demo.test" are FICTIONAL - only use real records from the database above.

[Then format and submit when ready]
`;


  return context;
}

/**
 * Generate example values for an object
 */
function generateExampleValues(attributes) {
  const examples = [];
  const requiredAttrs = attributes.filter(a => a.required).slice(0, 3); // Show first 3 required
  const optionalAttrs = attributes.filter(a => !a.required).slice(0, 2); // Show first 2 optional
  
  for (const attr of requiredAttrs) {
    examples.push(`          "${attr.slug}": ${getExampleValue(attr)}`);
  }
  
  if (optionalAttrs.length > 0 && examples.length > 0) {
    examples.push(`          // Optional fields (examples):`);
    for (const attr of optionalAttrs) {
      examples.push(`          // "${attr.slug}": ${getExampleValue(attr)}`);
    }
  }
  
  // If no required fields, show at least one example
  if (examples.length === 0 && attributes.length > 0) {
    examples.push(`          "${attributes[0].slug}": ${getExampleValue(attributes[0])}`);
  }
  
  return examples.join(',\n');
}

/**
 * Get example value for an attribute
 */
function getExampleValue(attr) {
  switch (attr.type) {
    case 'name':
      return '[{ "first_name": "Patricia", "last_name": "Example" }]'; // FICTIONAL - only use real records from database
    case 'email':
      return '["demo@example.test"]'; // FICTIONAL - only use real records from database
    case 'phone':
    case 'phone-number':
      return '["555-123-4567"]';
    case 'url':
    case 'website':
      return '["https://example.com"]';
    case 'date':
      return '["2024-01-15"]';
    case 'number':
    case 'currency':
    case 'decimal':
      return '[1000]';
    default:
      return '["Example value"]';
  }
}
