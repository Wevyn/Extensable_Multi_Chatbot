# Testing Guide - Generic API Discovery System

## 🎯 Testing Strategy

Test incrementally: start simple, then add complexity.

## Phase 1: Basic Functionality (Start Here)

### Test 1.1: Default Attio (No Configuration)
**Goal:** Verify backward compatibility works

1. **Don't configure any APIs** - just use the app normally
2. **Try a simple query:**
   ```
   "Show me all contacts"
   ```
3. **Try creating a contact:**
   ```
   "Add a new contact named John Smith with email john@example.com"
   ```

**Expected:**
- ✅ Should work exactly as before
- ✅ Uses Attio-specific discovery
- ✅ Chat responds normally

**If it fails:** Check console logs for errors

---

### Test 1.2: Add Your First API (Attio via Generic Discovery)
**Goal:** Verify generic discovery works with Attio

1. **Add Attio as a configured API:**
   ```bash
   curl -X POST http://localhost:3000/api/apis/config \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Attio CRM",
       "type": "crm",
       "baseUrl": "https://api.attio.com",
       "apiKey": "YOUR_ATTIO_API_KEY",
       "authHeader": "Bearer"
     }'
   ```

2. **Check if it was configured:**
   ```bash
   curl http://localhost:3000/api/apis/config
   ```

3. **Try the same queries as Test 1.1**

**Expected:**
- ✅ API appears in list
- ✅ Discovery should find structure (check console logs)
- ✅ Chat works the same as before

**Watch for:**
- Discovery errors in console
- Cache working correctly
- Structure being discovered

---

## Phase 2: Multi-API Testing

### Test 2.1: Add a Second API
**Goal:** Verify multiple APIs work together

1. **Add a test API** (or use a real one you have access to):
   ```bash
   curl -X POST http://localhost:3000/api/apis/config \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Test API",
       "type": "custom",
       "baseUrl": "https://api.example.com",
       "apiKey": "test-key",
       "discoveryEndpoints": ["/api/v1/schema"]
     }'
   ```

2. **Check both APIs are listed:**
   ```bash
   curl http://localhost:3000/api/apis/config
   ```

3. **Try a chat message:**
   ```
   "What APIs do I have configured?"
   ```

**Expected:**
- ✅ Both APIs appear in list
- ✅ Claude should see both APIs in context
- ✅ Can work with either API

---

## Phase 3: Discovery Testing

### Test 3.1: OpenAPI Spec Discovery
**Goal:** Test OpenAPI spec detection

1. **Add an API with OpenAPI spec URL:**
   ```bash
   curl -X POST http://localhost:3000/api/apis/config \
     -H "Content-Type: application/json" \
     -d '{
       "name": "API with OpenAPI",
       "type": "custom",
       "baseUrl": "https://api.example.com",
       "apiKey": "key",
       "openApiSpecUrl": "https://api.example.com/openapi.json"
     }'
   ```

2. **Check console logs** - should see:
   ```
   📄 Loading OpenAPI spec from provided URL...
   ✅ Found OpenAPI spec at: ...
   ```

**Expected:**
- ✅ Discovers structure from OpenAPI spec
- ✅ Formatting rules extracted
- ✅ Examples found

---

### Test 3.2: Discovery Endpoints
**Goal:** Test discovery from endpoints

1. **Add API with discovery endpoints:**
   ```bash
   curl -X POST http://localhost:3000/api/apis/config \
     -H "Content-Type: application/json" \
     -d '{
       "name": "API with Discovery",
       "type": "custom",
       "baseUrl": "https://api.example.com",
       "apiKey": "key",
       "discoveryEndpoints": ["/api/schema", "/api/resources"]
     }'
   ```

2. **Check console logs** - should see:
   ```
   ✅ Discovered endpoint: /api/schema
   ```

**Expected:**
- ✅ Tries each discovery endpoint
- ✅ Learns structure from responses
- ✅ Builds formatting rules

---

## Phase 4: Validation Testing

### Test 4.1: Validation with Attio
**Goal:** Test pre-submission validation

1. **Try creating invalid data:**
   ```
   "Add a contact with email invalid-email"
   ```

**Expected:**
- ✅ Validation catches error before API call
- ✅ Clear error message
- ✅ Claude asks for correction

---

### Test 4.2: Validation with Generic API
**Goal:** Test validation with discovered APIs

1. **Add an API and try invalid data**
2. **Check if validation works**

**Expected:**
- ✅ Validation uses discovered rules
- ✅ Catches format errors
- ✅ Checks required fields

---

## Phase 5: Error Handling

### Test 5.1: Invalid API Configuration
**Goal:** Test error handling

1. **Try adding API with missing fields:**
   ```bash
   curl -X POST http://localhost:3000/api/apis/config \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Invalid API"
     }'
   ```

**Expected:**
- ✅ Returns 400 error
- ✅ Clear error message about missing fields

---

### Test 5.2: Discovery Failure
**Goal:** Test when discovery fails

1. **Add API with invalid URL/key:**
   ```bash
   curl -X POST http://localhost:3000/api/apis/config \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Bad API",
       "baseUrl": "https://invalid-url-12345.com",
       "apiKey": "bad-key"
     }'
   ```

**Expected:**
- ✅ Discovery fails gracefully
- ✅ Returns warning but doesn't crash
- ✅ Falls back to cached structure if available

---

### Test 5.3: No Valid Structures
**Goal:** Test fallback when discovery fails

1. **Add API that fails discovery**
2. **Try using chat**

**Expected:**
- ✅ Falls back to Attio
- ✅ Chat still works
- ✅ Clear warning in logs

---

## Phase 6: Real-World Scenarios

### Test 6.1: Create Record Flow
**Goal:** End-to-end test

1. **Ask to create a record:**
   ```
   "Add a new contact"
   ```
2. **Provide information when asked**
3. **Verify it was created**

**Expected:**
- ✅ Asks for required fields
- ✅ Validates data
- ✅ Creates record successfully
- ✅ Confirms creation

---

### Test 6.2: Query Flow
**Goal:** Test querying

1. **Ask to find records:**
   ```
   "Find all contacts with email containing @example.com"
   ```

**Expected:**
- ✅ Executes query
- ✅ Returns results
- ✅ Formats nicely

---

### Test 6.3: Update Flow
**Goal:** Test updates

1. **Ask to update a record:**
   ```
   "Update John Smith's email to john.new@example.com"
   ```

**Expected:**
- ✅ Finds the record
- ✅ Updates it
- ✅ Confirms update

---

## 🔍 What to Watch For

### Console Logs
Watch for these patterns:

**Good signs:**
- ✅ `✅ Using cached structure`
- ✅ `✅ Discovered endpoint`
- ✅ `✅ Found OpenAPI spec`
- ✅ `📡 Found X configured API(s)`

**Warning signs:**
- ⚠️ `❌ Discovery failed`
- ⚠️ `⚠️ No valid API structures found`
- ⚠️ `⚠️ Pre-submission validation failed`

**Errors to investigate:**
- ❌ Network errors
- ❌ Authentication errors
- ❌ Schema parsing errors

---

### Common Issues

1. **Discovery takes too long:**
   - Check network connectivity
   - Verify API keys are valid
   - Check if API has rate limits

2. **Validation too strict:**
   - Check discovered formatting rules
   - May need to adjust validation logic
   - Check console for validation errors

3. **Cache not working:**
   - Check cache TTL settings
   - Verify cache keys are correct
   - Check if cache is being cleared

4. **Multiple APIs conflict:**
   - Check API names are unique
   - Verify context is being built correctly
   - Check if Claude is using right API

---

## 📊 Success Criteria

### Must Have:
- ✅ Default Attio works (backward compatibility)
- ✅ Can add/remove APIs
- ✅ Discovery works for at least one API
- ✅ Validation catches errors
- ✅ Chat works with configured APIs

### Nice to Have:
- ✅ Multiple APIs work simultaneously
- ✅ OpenAPI spec discovery works
- ✅ Discovery endpoints work
- ✅ Cache works correctly
- ✅ Error messages are helpful

---

## 🚀 Quick Start Testing

**Fastest way to test:**

1. **Start with default Attio:**
   - Just use the app normally
   - Verify it works

2. **Add Attio as configured API:**
   ```bash
   curl -X POST http://localhost:3000/api/apis/config \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Attio",
       "type": "crm",
       "baseUrl": "https://api.attio.com",
       "apiKey": "YOUR_KEY",
       "authHeader": "Bearer"
     }'
   ```

3. **Test chat:**
   - Try creating a contact
   - Try querying
   - Check console logs

4. **If that works, try adding another API**

---

## 🐛 Debugging Tips

1. **Check console logs** - lots of helpful info there
2. **Check network tab** - see API calls being made
3. **Test API config endpoint** - verify APIs are stored
4. **Check cache** - verify caching is working
5. **Test validation separately** - isolate issues

---

## 📝 Test Checklist

- [ ] Default Attio works
- [ ] Can add API configuration
- [ ] Can list API configurations
- [ ] Can remove API configuration
- [ ] Discovery works (at least one method)
- [ ] Chat works with configured APIs
- [ ] Validation catches errors
- [ ] Error handling works
- [ ] Cache works
- [ ] Multiple APIs work
- [ ] Fallback to Attio works

Good luck! 🎉

