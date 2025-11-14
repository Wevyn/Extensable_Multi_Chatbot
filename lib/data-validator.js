/**
 * Data Validation Engine
 * Validates collected data against CRM schema requirements
 */

/**
 * Validate email format (flexible)
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  // Flexible email validation - just check for @ and basic structure
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Validate phone number (flexible but must be recognizable)
 */
function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  // Remove common formatting characters
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  // Must have at least 10 digits (US format) or 7+ digits (international)
  const digitsOnly = cleaned.replace(/\D/g, '');
  return digitsOnly.length >= 7 && digitsOnly.length <= 15;
}

/**
 * Validate URL format
 */
function validateURL(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    new URL(url);
    return true;
  } catch {
    // Also accept URLs without protocol
    try {
      new URL(`https://${url}`);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Validate date format
 */
function validateDate(date) {
  if (!date || typeof date !== 'string') return false;
  const parsed = new Date(date);
  return !isNaN(parsed.getTime());
}

/**
 * Validate number
 */
function validateNumber(value) {
  if (value === null || value === undefined) return false;
  return !isNaN(Number(value));
}

/**
 * Validate field value based on attribute type
 */
export function validateField(attribute, value) {
  const errors = [];
  
  // Check required
  if (attribute.required && (!value || value === '' || value === null || value === undefined)) {
    errors.push(`${attribute.name || attribute.slug} is required`);
    return { valid: false, errors };
  }
  
  // If not required and empty, it's valid
  if (!value || value === '' || value === null || value === undefined) {
    return { valid: true, errors: [] };
  }
  
  // Type-specific validation
  switch (attribute.type) {
    case 'email':
      if (!validateEmail(value)) {
        errors.push(`${attribute.name || attribute.slug} must be a valid email address`);
      }
      break;
      
    case 'phone':
    case 'phone-number':
      if (!validatePhone(value)) {
        errors.push(`${attribute.name || attribute.slug} must be a valid phone number`);
      }
      break;
      
    case 'url':
    case 'website':
      if (!validateURL(value)) {
        errors.push(`${attribute.name || attribute.slug} must be a valid URL`);
      }
      break;
      
    case 'date':
      if (!validateDate(value)) {
        errors.push(`${attribute.name || attribute.slug} must be a valid date`);
      }
      break;
      
    case 'number':
    case 'currency':
    case 'decimal':
      if (!validateNumber(value)) {
        errors.push(`${attribute.name || attribute.slug} must be a number`);
      }
      break;
      
    case 'name':
      // Name validation - check if it has required fields
      if (typeof value === 'object' && attribute.fields) {
        const requiredFields = attribute.fields.filter(f => 
          attribute.config?.fields?.find(cf => cf.slug === f)?.required
        );
        for (const field of requiredFields) {
          if (!value[field] || value[field] === '') {
            errors.push(`Name must include ${field}`);
          }
        }
      } else if (typeof value === 'string' && value.trim() === '') {
        errors.push(`${attribute.name || attribute.slug} cannot be empty`);
      }
      break;
      
    // For string types, just check non-empty if required
    case 'text':
    case 'string':
    default:
      if (typeof value === 'string' && value.trim() === '') {
        if (attribute.required) {
          errors.push(`${attribute.name || attribute.slug} cannot be empty`);
        }
      }
      break;
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate all collected data against schema
 */
export function validateCollectedData(collectedData, objectSchema) {
  const validationErrors = {};
  let isValid = true;
  
  // Check all required fields are present
  const requiredFields = objectSchema.attributes.filter(attr => attr.required);
  const missingFields = [];
  
  for (const attr of requiredFields) {
    const value = collectedData[attr.slug];
    if (!value || value === '' || value === null || value === undefined) {
      missingFields.push(attr.slug);
      isValid = false;
    }
  }
  
  // Validate each collected field
  for (const [fieldSlug, value] of Object.entries(collectedData)) {
    const attribute = objectSchema.attributes.find(attr => attr.slug === fieldSlug);
    if (attribute) {
      const validation = validateField(attribute, value);
      if (!validation.valid) {
        validationErrors[fieldSlug] = validation.errors;
        isValid = false;
      }
    }
  }
  
  return {
    valid: isValid && missingFields.length === 0,
    missingFields,
    validationErrors,
    errors: Object.values(validationErrors).flat()
  };
}

/**
 * Format validation errors for user-friendly messages
 */
export function formatValidationErrors(validationResult) {
  const messages = [];
  
  if (validationResult.missingFields.length > 0) {
    const fieldNames = validationResult.missingFields.map(slug => {
      // Try to find friendly name
      // For now, just use slug
      return slug.replace(/_/g, ' ');
    });
    messages.push(`Missing required fields: ${fieldNames.join(', ')}`);
  }
  
  for (const [field, errors] of Object.entries(validationResult.validationErrors)) {
    const fieldName = field.replace(/_/g, ' ');
    messages.push(`${fieldName}: ${errors.join(', ')}`);
  }
  
  return messages;
}

