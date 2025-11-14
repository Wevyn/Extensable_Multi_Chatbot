# Generic API Discovery System

## 🎯 Overview

The system now supports **ANY API** (CRM, ERP, Payroll, etc.) by discovering structure dynamically from endpoints/links you provide. No hardcoded formatting rules - the system learns from the API itself!

## ✨ Key Features

1. **OpenAPI Spec Detection**: Automatically finds and parses OpenAPI/Swagger specs
2. **Dynamic Discovery**: Explores API structure from responses
3. **Format Learning**: Infers formatting rules from API examples and schemas
4. **Multi-API Support**: Configure multiple APIs (CRM + ERP + Payroll, etc.)
5. **Backward Compatible**: Still works with Attio if no APIs configured

## 🔧 How It Works

### 1. API Discovery Process

When you provide an API endpoint, the system:

1. **Tries OpenAPI Spec** (if provided or found at common paths):
   - `/openapi.json`
   - `/swagger.json`
   - `/api-docs`
   - Custom URL you provide

2. **Explores Discovery Endpoints** (if provided):
   - User-provided endpoints to explore
   - Learns structure from responses

3. **Infers Structure**:
   - Extracts resources, endpoints, formatting rules
   - Learns required fields, data types, examples
   - Builds context for Claude

### 2. Configuration

Add APIs via the configuration endpoint:

```javascript
POST /api/apis/config
{
  "name": "QuickBooks ERP",
  "type": "erp",
  "baseUrl": "https://api.quickbooks.com/v3",
  "apiKey": "your-api-key",
  "authHeader": "Bearer", // or "API-Key", "Basic", etc.
  "authHeaderName": "Authorization",
  "discoveryEndpoints": ["/companyinfo", "/items"],
  "openApiSpecUrl": "https://api.quickbooks.com/openapi.json" // Optional
}
```

### 3. Discovery Strategies

The system tries multiple strategies:

1. **OpenAPI Spec** (best case):
   - Complete API structure
   - All endpoints, schemas, examples
   - Formatting rules from schemas

2. **Discovery Endpoints**:
   - User provides endpoints to explore
   - System learns from responses
   - Infers structure from data

3. **Common Patterns**:
   - Tries common REST patterns
   - Learns from successful responses

## 📋 API Configuration Options

### Required Fields
- `name`: Name of the API (e.g., "Attio CRM")
- `baseUrl`: Base API URL
- `apiKey`: API key/token

### Optional Fields
- `type`: 'crm', 'erp', 'payroll', 'custom'
- `authHeader`: 'Bearer' (default), 'API-Key', 'Basic', or custom format
- `authHeaderName`: Header name (default: 'Authorization')
- `discoveryEndpoints`: Array of endpoints to explore
- `openApiSpecUrl`: Direct URL to OpenAPI spec
- `discoveryCacheTTL`: Cache TTL in ms (default: 24 hours)

## 🚀 Usage Examples

### Example 1: Add QuickBooks ERP

```bash
curl -X POST http://localhost:3000/api/apis/config \
  -H "Content-Type: application/json" \
  -d '{
    "name": "QuickBooks",
    "type": "erp",
    "baseUrl": "https://sandbox-quickbooks.api.intuit.com/v3",
    "apiKey": "your-token",
    "openApiSpecUrl": "https://developer.intuit.com/openapi.json"
  }'
```

### Example 2: Add Payroll System

```bash
curl -X POST http://localhost:3000/api/apis/config \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ADP Payroll",
    "type": "payroll",
    "baseUrl": "https://api.adp.com",
    "apiKey": "your-key",
    "authHeader": "Bearer",
    "discoveryEndpoints": ["/hr/v2/workers", "/payroll/v1/employees"]
  }'
```

### Example 3: List Configured APIs

```bash
curl http://localhost:3000/api/apis/config
```

## 💬 Chat Usage

Once APIs are configured, Claude automatically:

1. **Uses discovered structure** for formatting
2. **Asks questions** when information is missing
3. **Validates data** before submission
4. **Handles errors** gracefully

**Example Conversation:**
```
User: "Add an employee to payroll"
Bot: "I'll help! I need:
      - Employee name
      - Employee ID
      - Department
      - Salary"

User: "John Smith, ID 12345, Engineering, $100k"
Bot: [Formats using discovered structure → Validates → Submits]
```

## 🔍 Discovery Details

### What Gets Discovered

1. **Resources**: Objects/entities (people, companies, employees, etc.)
2. **Endpoints**: All available API paths
3. **Formatting Rules**: 
   - Field types (string, number, date, etc.)
   - Required vs optional fields
   - Format constraints (email, phone, etc.)
   - Array vs single value
4. **Examples**: Sample payloads from OpenAPI specs

### Format Inference

The system infers formatting from:

- **OpenAPI Schemas**: Type, format, pattern, examples
- **API Responses**: Structure of returned data
- **Request Examples**: Sample payloads in docs
- **Common Patterns**: REST conventions

## 🛡️ Validation

The system validates before submission:

1. **Required Fields**: Checks all required fields present
2. **Type Validation**: Ensures correct data types
3. **Format Validation**: Email, phone, URL patterns
4. **Structure Validation**: Array vs object, nesting

## 📊 Multi-API Support

When multiple APIs are configured:

- Claude sees all APIs in context
- Can work with multiple systems in one conversation
- Routes requests to correct API based on context
- Example: "Add contact to CRM and create order in ERP"

## 🔄 Backward Compatibility

If no APIs are configured:
- Falls back to Attio-specific discovery
- Uses existing `loadCRMSchema` function
- Maintains all existing functionality

## 🎯 Benefits

1. **Truly Generic**: Works with any REST API
2. **Self-Learning**: Discovers structure automatically
3. **No Hardcoding**: Formatting rules learned from API
4. **Extensible**: Easy to add new APIs
5. **Intelligent**: Claude uses discovered structure naturally

## 📝 Next Steps

1. **UI for API Configuration**: Build UI to add/manage APIs
2. **Better Discovery**: Enhance pattern recognition
3. **GraphQL Support**: Add GraphQL schema discovery
4. **Webhook Discovery**: Auto-discover webhook endpoints
5. **API Testing**: Test discovery with various APIs

## 🐛 Known Limitations

1. **OpenAPI Preferred**: Works best with OpenAPI specs
2. **REST Only**: Currently supports REST APIs (GraphQL coming)
3. **Auth Methods**: Supports Bearer, API-Key, Basic (extensible)
4. **Discovery Time**: First discovery may take a few seconds

## 📚 Files

- `lib/generic-api-discovery.js` - Core discovery logic
- `lib/api-config-manager.js` - API configuration management
- `app/api/apis/config/route.js` - API configuration endpoint
- `app/api/chat/route.js` - Updated to use generic discovery

