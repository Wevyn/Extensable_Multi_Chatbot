/**
 * Workspace Introspection
 * Fetches live CRM schema from user's Attio workspace
 * Provides context to Claude about available objects, attributes, and relationships
 */

export class WorkspaceIntrospector {
  constructor(attioApiKey) {
    this.apiKey = attioApiKey;
    this.baseUrl = 'https://api.attio.com/v2';
    this.schema = {
      objects: new Map(),
      attributes: new Map(),
      initialized: false
    };
  }

  /**
   * Initialize workspace schema by fetching all objects and their attributes
   */
  async introspectWorkspace() {
    if (this.schema.initialized) {
      console.log('📋 Using cached workspace schema');
      return this.getSchemaContext();
    }

    console.log('🔍 Introspecting Attio workspace...');

    try {
      // Fetch all objects in the workspace
      const objectsResponse = await this.apiCall('/objects');
      const objects = objectsResponse?.data || [];

      console.log(`📋 Found ${objects.length} objects in workspace`);

      for (const obj of objects) {
        if (!obj?.id?.object_id || !obj?.api_slug) {
          console.warn('⚠️ Skipping object with missing ID or slug:', obj);
          continue;
        }

        // Store object metadata
        this.schema.objects.set(obj.api_slug, {
          id: obj.id.object_id,
          slug: obj.api_slug,
          name: obj.name || obj.api_slug,
          type: obj.object_type || 'custom',
          description: obj.description || '',
          singular: obj.singular_noun || obj.name,
          plural: obj.plural_noun || obj.name
        });

        // Fetch attributes for this object
        try {
          const attributesResponse = await this.apiCall(`/objects/${obj.id.object_id}/attributes`);
          const attributes = attributesResponse?.data || [];

          const objectAttrs = new Map();
          for (const attr of attributes) {
            if (!attr?.id?.attribute_id || !attr?.api_slug) continue;

            objectAttrs.set(attr.api_slug, {
              id: attr.id.attribute_id,
              slug: attr.api_slug,
              name: attr.name || attr.api_slug,
              type: attr.type || 'text',
              required: attr.is_required || false,
              multivalue: attr.is_multivalue || false,
              config: attr.config || {},
              options: attr.options || [],
              description: attr.description || ''
            });
          }

          this.schema.attributes.set(obj.api_slug, objectAttrs);
          console.log(`  ✓ ${obj.api_slug}: ${attributes.length} attributes`);

          // Small delay to respect rate limits
          await this.sleep(100);

        } catch (attrError) {
          console.warn(`⚠️ Failed to load attributes for ${obj.api_slug}:`, attrError.message);
          this.schema.attributes.set(obj.api_slug, new Map());
        }
      }

      this.schema.initialized = true;
      console.log(`✅ Workspace introspection complete: ${this.schema.objects.size} objects`);

      return this.getSchemaContext();

    } catch (error) {
      console.error('❌ Workspace introspection failed:', error);
      throw error;
    }
  }

  /**
   * Get formatted schema context for Claude (CONCISE VERSION - saves tokens!)
   * Returns a minimal string description of the workspace schema
   */
  getSchemaContext() {
    if (!this.schema.initialized) {
      return 'Workspace schema not yet loaded.';
    }

    // Concise format to save tokens
    const objects = [];
    for (const [slug, obj] of this.schema.objects) {
      const attrs = this.schema.attributes.get(slug);
      const attrList = attrs ? Array.from(attrs.keys()).join(', ') : 'none';
      objects.push(`${slug}: ${attrList}`);
    }

    return `Available objects: ${Array.from(this.schema.objects.keys()).join(', ')}\n\nKey attributes:\n${objects.join('\n')}`;
  }

  /**
   * Get object metadata by slug
   */
  getObject(slug) {
    return this.schema.objects.get(slug);
  }

  /**
   * Get attributes for an object
   */
  getAttributes(objectSlug) {
    return this.schema.attributes.get(objectSlug);
  }

  /**
   * Get all objects
   */
  getAllObjects() {
    return Array.from(this.schema.objects.values());
  }

  /**
   * Check if a type is a reference/relationship type
   */
  isReferenceType(type) {
    return type && (type.includes('reference') || type.includes('relation'));
  }

  /**
   * Make API call to Attio
   */
  async apiCall(endpoint, method = 'GET', body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (response.status === 429) {
      console.log('⏳ Rate limited, waiting...');
      await this.sleep(60000);
      return this.apiCall(endpoint, method, body);
    }

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`API Error (${response.status}): ${responseText}`);
    }

    try {
      return JSON.parse(responseText);
    } catch {
      return { raw: responseText };
    }
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
