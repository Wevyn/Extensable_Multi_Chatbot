# Pre-Testing Checklist

## ✅ Issues Fixed

1. **Null/Undefined Safety:**
   - ✅ Fixed `apiConfig.type.toUpperCase()` - now handles null/undefined
   - ✅ Fixed `normalizeType()` - now checks if type is string before calling toLowerCase()
   - ✅ Fixed `findResourceForPath()` - now checks if resource.name exists
   - ✅ Added null checks for attributes in schema conversion
   - ✅ Added validation for missing attribute names

2. **Error Handling:**
   - ✅ Added fallback when no valid API structures found
   - ✅ Added null checks in validation result handling
   - ✅ Added safety checks for block.input before validation

3. **Edge Cases:**
   - ✅ Handles empty apiContexts array gracefully
   - ✅ Skips null/undefined attributes in schema conversion
   - ✅ Handles missing attribute names with warning

## 🔍 Things to Test

### 1. Basic Functionality
- [ ] Chat works with default Attio (no configured APIs)
- [ ] Chat works with configured APIs
- [ ] Multiple APIs work simultaneously
- [ ] API discovery works for new APIs

### 2. Error Scenarios
- [ ] Invalid API configuration (missing fields)
- [ ] API discovery failure (invalid URL/key)
- [ ] Network errors during discovery
- [ ] Validation errors in data submission

### 3. Edge Cases
- [ ] Empty API configurations
- [ ] APIs with no discoverable structure
- [ ] APIs with malformed schemas
- [ ] Very large schemas (performance)

### 4. Validation
- [ ] Attio format validation works
- [ ] Generic API format validation works
- [ ] Validation errors are clear and helpful
- [ ] Missing required fields detected

### 5. Caching
- [ ] Schema cache works correctly
- [ ] Cache expiration works
- [ ] Cache invalidation works
- [ ] Multiple APIs cache separately

## 🐛 Potential Issues to Watch For

1. **API Discovery:**
   - Some APIs may not have OpenAPI specs
   - Discovery endpoints may require different auth
   - Rate limiting during discovery

2. **Schema Conversion:**
   - Very different schema formats may not convert perfectly
   - Nested structures may need more handling
   - Array detection may not work for all APIs

3. **Validation:**
   - Some APIs may have complex validation rules
   - Pattern matching may need refinement
   - Nested object validation may need enhancement

4. **Performance:**
   - Large schemas may slow down discovery
   - Multiple API discovery may be slow
   - Cache lookups should be fast

## 📝 Known Limitations

1. **Schema Resolution:**
   - OpenAPI $ref resolution is simplified (may need full implementation)
   - Complex nested schemas may not convert perfectly

2. **Array Detection:**
   - Currently uses heuristics (base URL, multivalue flag, examples)
   - May need API-specific hints for some products

3. **Format Inference:**
   - Relies on type names and format fields
   - May miss some custom formats

## ✅ Ready for Testing

The code should now handle:
- ✅ Null/undefined values safely
- ✅ Missing data gracefully
- ✅ Error cases with fallbacks
- ✅ Edge cases in schema conversion
- ✅ Multiple API configurations

Start with basic functionality, then test error scenarios and edge cases.

