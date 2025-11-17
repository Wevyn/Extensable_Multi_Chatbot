/**
 * Tool Validation Utilities
 * 
 * Generic validation functions that work with any API.
 * Preserved from original chat route to maintain compatibility.
 */

/**
 * Validate tool call before execution (safety net)
 * Works with ANY API - converts all schemas to generic format for validation
 */
export function validateToolCall(toolInput, apiStructure) {
  const errors = [];
  
  // Validate POST, PUT, and PATCH requests (all modify data)
  if (!['POST', 'PUT', 'PATCH'].includes(toolInput.method)) {
    return { valid: true, errors: [] };
  }
  
  // Convert any schema format to generic formatting rules
  const formattingRules = convertSchemaToFormattingRules(toolInput.path, apiStructure);
  
  if (!formattingRules || Object.keys(formattingRules).length === 0) {
    // Can't validate - let it through
    return { valid: true, errors: [] };
  }
  
  // Use single generic validation for all APIs
  return validateGenericFormat(toolInput, formattingRules, apiStructure);
}

/**
 * Convert any schema format to generic formatting rules
 * Generic converter that works with ANY API schema structure
 */
function convertSchemaToFormattingRules(path, apiStructure) {
  if (!apiStructure) return null;
  
  // Case 1: Generic discovered structure (already has formatting_rules)
  if (apiStructure.formatting_rules) {
    const matchingRules = Object.entries(apiStructure.formatting_rules).find(([rulePath]) => 
      path.includes(rulePath) || rulePath.includes(path)
    );
    if (matchingRules) {
      return matchingRules[1]; // Return the rules object
    }
  }
  
  // Case 2: Object-based schemas (Attio, Salesforce, HubSpot, etc.)
  // Detects pattern: apiStructure.objects or apiStructure.resources
  if (apiStructure.objects || apiStructure.resources) {
    const objects = apiStructure.objects || apiStructure.resources;
    const objectSchema = findObjectSchemaForPath(path, objects, apiStructure);
    if (objectSchema) {
      return convertObjectSchemaToRules(objectSchema, apiStructure);
    }
  }
  
  // Case 3: OpenAPI-style schemas (already parsed, but check resources)
  if (apiStructure.resources && apiStructure.resources.length > 0) {
    const resource = findResourceForPath(path, apiStructure.resources);
    if (resource && resource.properties) {
      return convertPropertiesToRules(resource.properties, resource.required || []);
    }
  }
  
  return null;
}

/**
 * Find object schema that matches the API path
 */
function findObjectSchemaForPath(path, objects, apiStructure) {
  // Pattern 1: /objects/{type}/records (Attio-style)
  const attioMatch = path.match(/\/objects\/([^\/]+)\/records/);
  if (attioMatch) {
    const objectType = attioMatch[1];
    return objects.find(obj => obj.slug === objectType || obj.name === objectType);
  }
  
  // Pattern 2: /api/{resource} or /v1/{resource}
  const resourceMatch = path.match(/\/(?:api|v\d+)\/([^\/]+)/);
  if (resourceMatch) {
    const resourceName = resourceMatch[1];
    return objects.find(obj => 
      obj.slug === resourceName || 
      obj.name?.toLowerCase() === resourceName.toLowerCase() ||
      obj.plural?.toLowerCase() === resourceName.toLowerCase()
    );
  }
  
  // Pattern 3: Direct resource name in path
  for (const obj of objects) {
    if (path.includes(`/${obj.slug}`) || path.includes(`/${obj.name}`)) {
      return obj;
    }
  }
  
  return null;
}

/**
 * Find resource for path in OpenAPI-style structure
 */
function findResourceForPath(path, resources) {
  for (const resource of resources) {
    if (resource && resource.name) {
      const resourceName = resource.name.toLowerCase();
      if (path.includes(`/${resource.name}`) || path.includes(`/${resourceName}`)) {
        return resource;
      }
    }
  }
  return null;
}

/**
 * Generic converter: Converts ANY object schema format to formatting rules
 */
function convertObjectSchemaToRules(objectSchema, apiStructure) {
  const rules = {};
  
  // Handle different attribute/property structures
  const attributes = objectSchema.attributes || objectSchema.properties || objectSchema.fields || [];
  
  for (const attr of attributes) {
    if (!attr) continue;
    
    const attrName = attr.slug || attr.name || attr.field || attr.key;
    if (!attrName) {
      console.warn('Skipping attribute with no name:', attr);
      continue;
    }
    
    const attrType = attr.type || attr.dataType || 'string';
    const isRequired = attr.required !== undefined ? attr.required : (apiStructure?.required || []).includes(attrName);
    const requiresArray = detectArrayRequirement(apiStructure, attr);
    const format = inferFormatFromType(attrType, attr);
    const normalizedType = normalizeType(attrType);
    const isRecordReference = normalizedType === 'record-reference' || 
                              attr.target_object !== undefined ||
                              (attr.config && attr.config.target_object);
    
    rules[attrName] = {
      type: normalizedType,
      format: format,
      required: isRequired,
      isArray: requiresArray,
      nestedStructure: detectNestedStructure(attr),
      pattern: attr.pattern,
      enum: attr.enum || attr.options,
      minLength: attr.minLength || attr.min,
      maxLength: attr.maxLength || attr.max,
      target_object: attr.target_object || (attr.config && attr.config.target_object) || (isRecordReference ? 'unknown' : undefined)
    };
  }
  
  return rules;
}

/**
 * Convert OpenAPI-style properties to rules
 */
function convertPropertiesToRules(properties, requiredFields = []) {
  const rules = {};
  
  for (const [fieldName, fieldSchema] of Object.entries(properties)) {
    const resolvedSchema = fieldSchema.$ref ? resolveSchemaRef(fieldSchema, {}) : fieldSchema;
    
    rules[fieldName] = {
      type: normalizeType(resolvedSchema.type || 'string'),
      format: resolvedSchema.format,
      required: requiredFields.includes(fieldName),
      isArray: resolvedSchema.type === 'array',
      pattern: resolvedSchema.pattern,
      enum: resolvedSchema.enum,
      minLength: resolvedSchema.minLength,
      maxLength: resolvedSchema.maxLength
    };
  }
  
  return rules;
}

/**
 * Detect if API requires arrays for this field
 */
function detectArrayRequirement(apiStructure, attr) {
  if (attr.multivalue === true) return true;
  if (apiStructure.base_url?.includes('attio.com')) return true;
  if (attr.type === 'array' || attr.dataType === 'array') return true;
  if (attr.example && Array.isArray(attr.example)) return true;
  return false;
}

/**
 * Infer format from type (email, phone, date, etc.)
 */
function inferFormatFromType(type, attr) {
  const typeLower = (type || '').toLowerCase();
  
  if (typeLower.includes('email') || typeLower === 'email') return 'email';
  if (typeLower.includes('phone') || typeLower.includes('tel')) return 'phone';
  if (typeLower.includes('url') || typeLower.includes('uri') || typeLower.includes('link')) return 'url';
  if (typeLower.includes('date') || typeLower.includes('time')) return 'date';
  
  if (attr.format) return attr.format;
  return undefined;
}

/**
 * Normalize type to standard types
 */
function normalizeType(type) {
  if (!type || typeof type !== 'string') return 'string';
  
  const typeLower = type.toLowerCase();
  
  if (typeLower === 'record-reference' || typeLower === 'record_reference' || 
      typeLower === 'reference' || typeLower === 'link' || typeLower === 'relation') {
    return 'record-reference';
  }
  
  if (typeLower === 'name' || typeLower === 'object') return 'object';
  if (['string', 'text', 'varchar'].includes(typeLower)) return 'string';
  if (['number', 'integer', 'int', 'float', 'decimal', 'currency'].includes(typeLower)) return 'number';
  if (typeLower === 'boolean' || typeLower === 'bool') return 'boolean';
  if (typeLower === 'array') return 'array';
  
  return 'string';
}

/**
 * Detect nested structure (e.g., name: { first_name, last_name })
 */
function detectNestedStructure(attr) {
  if (attr.type === 'name' && attr.fields) {
    return { fields: attr.fields };
  }
  
  if (attr.properties) {
    return { properties: attr.properties };
  }
  
  if (attr.fields && Array.isArray(attr.fields)) {
    return { fields: attr.fields };
  }
  
  return undefined;
}

/**
 * Resolve schema reference
 */
function resolveSchemaRef(schema, allSchemas) {
  if (schema.$ref) {
    return schema;
  }
  return schema;
}

/**
 * Universal validation function - works with ANY API format
 */
function validateGenericFormat(toolInput, formattingRules, apiStructure) {
  const errors = [];
  
  if (!toolInput.body || typeof toolInput.body !== 'object') {
    errors.push('Request body must be an object');
    return { valid: false, errors };
  }
  
  // Handle Attio's nested structure: { data: { values: {...} } }
  let bodyToValidate = toolInput.body;
  if (toolInput.body.data && toolInput.body.data.values) {
    bodyToValidate = toolInput.body.data.values;
  }
  
  // Validate against formatting rules
  for (const [field, rule] of Object.entries(formattingRules)) {
    const value = bodyToValidate[field];
    
    // Check required fields
    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(`Required field "${field}" is missing`);
      continue;
    }
    
    if (value !== undefined && value !== null) {
      // Check if array is required (Attio format)
      if (rule.isArray && !Array.isArray(value)) {
        errors.push(`Field "${field}" must be an array (got ${typeof value})`);
        continue;
      }
      
      // Validate array items
      const valueToValidate = rule.isArray ? (Array.isArray(value) ? value[0] : value) : value;
      
      if (valueToValidate !== undefined && valueToValidate !== null) {
        // Special handling for record-reference types
        if (rule.type === 'record-reference') {
          if (typeof valueToValidate !== 'object' || Array.isArray(valueToValidate)) {
            errors.push(`Field "${field}" must be an object with "target_object" and "target_record_id" fields (e.g., { "target_object": "companies", "target_record_id": "uuid" })`);
          } else {
            if (!valueToValidate.target_object || typeof valueToValidate.target_object !== 'string') {
              errors.push(`Field "${field}" must have a "target_object" field (the object type slug, e.g., "companies", "people")`);
            }
            if (!valueToValidate.target_record_id || typeof valueToValidate.target_record_id !== 'string') {
              errors.push(`Field "${field}" must have a "target_record_id" field with a UUID string (e.g., { "target_object": "companies", "target_record_id": "uuid" }). NOTE: Use "target_record_id" NOT "record_id"!`);
            } else {
              const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
              if (!uuidRegex.test(valueToValidate.target_record_id)) {
                errors.push(`Field "${field}" target_record_id must be a valid UUID format`);
              }
            }
            if (valueToValidate.attribute_type) {
              errors.push(`Field "${field}" should NOT include "attribute_type" - the API rejects it as an unrecognized key. Use only { "target_object": "...", "target_record_id": "..." }`);
            }
          }
        }
        // Type validation for nested objects
        else if (rule.type === 'object' && rule.nestedStructure) {
          if (typeof valueToValidate !== 'object' || Array.isArray(valueToValidate)) {
            errors.push(`Field "${field}" must be an object`);
          } else if (rule.nestedStructure.fields) {
            for (const nestedField of rule.nestedStructure.fields) {
              if (!valueToValidate[nestedField]) {
                errors.push(`Field "${field}" missing nested field "${nestedField}"`);
              }
            }
          }
        } else if (rule.type && rule.type !== 'record-reference' && typeof valueToValidate !== rule.type) {
          errors.push(`Field "${field}" must be ${rule.type}, got ${typeof valueToValidate}`);
        }
        
        // Format validation
        if (rule.format === 'email' && typeof valueToValidate === 'string' && !valueToValidate.includes('@')) {
          errors.push(`Field "${field}" must be a valid email address`);
        }
        
        if (rule.format === 'phone' && typeof valueToValidate === 'string') {
          const phoneDigits = valueToValidate.replace(/\D/g, '');
          if (phoneDigits.length < 7 || phoneDigits.length > 15) {
            errors.push(`Field "${field}" must be a valid phone number (7-15 digits)`);
          }
        }
        
        // Pattern validation
        if (rule.pattern && typeof valueToValidate === 'string') {
          const regex = new RegExp(rule.pattern);
          if (!regex.test(valueToValidate)) {
            errors.push(`Field "${field}" does not match required pattern`);
          }
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Generate troubleshooting hints based on the error and request
 */
export function generateTroubleshootingHints(toolInput, errorResult, apiStructure) {
  const hints = [];
  
  if (!toolInput || !errorResult) return hints;
  
  // Check if it's a PUT/PATCH update
  if (['PUT', 'PATCH'].includes(toolInput.method)) {
    hints.push('This is an UPDATE operation. Common issues:');
    hints.push('- Verify the record ID in the path is correct');
    hints.push('- Check that the body structure matches the API schema');
    hints.push('- Ensure attribute names/slugs match exactly (case-sensitive)');
    hints.push('- For company links, verify the company ID exists and is formatted correctly');
    
    // Check path format
    if (toolInput.path) {
      const pathMatch = toolInput.path.match(/\/records\/([^\/]+)/);
      if (!pathMatch) {
        hints.push('- WARNING: Path might be missing record ID. Should be: /v2/objects/{type}/records/{id}');
      }
    }
    
    // Check body structure
    if (toolInput.body) {
      const bodyStr = JSON.stringify(toolInput.body);
      if (!bodyStr.includes('values') && !bodyStr.includes('data')) {
        hints.push('- WARNING: Body might be missing "values" wrapper. Attio format: { "values": { "attribute": [...] } }');
      }
      
      // Check for company linking format
      if (bodyStr.includes('company')) {
        if (!bodyStr.includes('"id"')) {
          hints.push('- WARNING: Company link might be missing ID. Should be: { "company": [{ "id": "company_id" }] }');
        }
        if (bodyStr.includes('"name"') && !bodyStr.includes('"id"')) {
          hints.push('- WARNING: Company link should use ID, not name. Get the ID from the database records list.');
        }
      }
    }
  }
  
  // Check status code for specific error types
  if (errorResult.status) {
    if (errorResult.status === 404) {
      hints.push('- 404 Not Found: The record ID might not exist. Verify the ID from the database records list.');
    } else if (errorResult.status === 400) {
      hints.push('- 400 Bad Request: Check the request body format matches the API schema exactly.');
    } else if (errorResult.status === 422) {
      hints.push('- 422 Unprocessable: Data format might be incorrect. Check attribute types and required fields.');
    }
  }
  
  return hints;
}

