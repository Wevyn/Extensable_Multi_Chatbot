# Conversational CRM Flow - Design Document

## Overview

A conversational AI system that intelligently collects data through natural dialogue, validates it, and reliably submits to the CRM. Always active, supports both reading and writing operations.

## Core Principles

1. **Always Active**: No special modes - every conversation can lead to data collection
2. **Intent-Driven**: Automatically detects if user wants to read or write data
3. **Natural Conversation**: Asks questions like a human would (one or many at once)
4. **Flexible Collection**: Asks once, continues with blanks for optional fields
5. **Post-Collection Validation**: Validates after gathering all data
6. **Resilient Submission**: Saves partial data, retries with clear error messages
7. **User Control**: Can cancel, edit, or update previous information

---

## Architecture

### 1. Conversation State Management

```javascript
ConversationState {
  intent: 'read' | 'write' | null,  // Detected intent
  objectType: string | null,         // e.g., 'people', 'companies', 'deals'
  operation: 'create' | 'update' | 'query' | null,
  collectedData: {},                 // Data collected so far
  missingFields: string[],          // Required fields still needed
  optionalFields: string[],         // Optional fields not yet collected
  validationErrors: {},             // Field-specific validation errors
  conversationHistory: [],         // Full conversation context
  state: 'idle' | 'collecting' | 'validating' | 'ready' | 'submitting' | 'complete' | 'error',
  partialDataId: string | null      // ID for recovering partial data
}
```

### 2. Intent Detection System

**Two Main Intents:**

1. **READ Intent** (Getting Information)
   - Keywords: "show", "list", "find", "get", "what", "who", "where"
   - Actions: Query, search, list records
   - No data collection needed (just execute query)

2. **WRITE Intent** (Writing Information)
   - Keywords: "create", "add", "new", "update", "change", "edit"
   - Actions: Create or update records
   - Requires data collection flow

**Intent Detection Flow:**
```
User Message → Intent Classifier → 
  - If READ: Execute query immediately
  - If WRITE: Enter data collection flow
```

### 3. Data Collection Flow

**Natural Conversation Pattern:**

```
User: "Add a new contact"
Bot: "I'd be happy to help you add a new contact! I'll need a few details:
      - What's their name? (first and last)
      - What's their email address?
      - Do they have a phone number?
      - What company are they with?"

User: "John Smith, john@example.com"
Bot: "Got it! I have John Smith with email john@example.com.
      - What's his phone number? (optional)
      - What company is he with? (optional)"

User: "Acme Corp"
Bot: "Perfect! Let me add John Smith to Acme Corp..."
      [Validates → Submits → Confirms]
```

**Collection Rules:**
- Ask for all required fields upfront (if possible)
- Ask for optional fields once, then continue if not provided
- Accept partial information in one message
- Parse natural language (e.g., "John Smith, john@example.com, Acme Corp")
- Allow user to provide information in any order

### 4. Validation Engine

**Validation Levels:**

1. **Completeness Check**
   - All required fields present?
   - Optional fields can be empty

2. **Format Validation** (Flexible but Type-Aware)
   - **Email**: Must match email pattern (flexible: accepts most formats)
   - **Phone**: Must be recognizable phone number (flexible: accepts various formats)
   - **URL**: Must be valid URL format
   - **Date**: Must be parseable date
   - **String**: Usually just needs to be non-empty (if required)
   - **Number**: Must be numeric
   - **Reference**: Must reference valid object/record

3. **Business Logic Validation**
   - Cross-field validation (e.g., end date after start date)
   - Reference validation (e.g., company exists)

**Validation Flow:**
```
Collected Data → Completeness Check → Format Validation → Business Logic → 
  - If Valid: Ready to Submit
  - If Invalid: Return specific errors, ask user to fix
```

### 5. Submission System

**Reliable Submission with Retry:**

```javascript
SubmissionFlow {
  1. Validate all data
  2. Format data according to CRM schema
  3. Save partial data (for recovery)
  4. Attempt submission
  5. If success: Clear partial data, confirm
  6. If failure:
     - Save error details
     - Determine if retryable (network) vs non-retryable (validation)
     - For retryable: Exponential backoff retry (max 3 attempts)
     - For non-retryable: Ask user with specific error message
     - Preserve partial data for user to fix
}
```

**Error Handling:**
- **Network Errors**: Retry with exponential backoff
- **Rate Limits**: Wait and retry
- **Validation Errors**: Show specific field errors, ask user to fix
- **Permission Errors**: Inform user, don't retry
- **Partial Failures**: Save what worked, report what failed

### 6. State Persistence

**Storage Strategy:**
- Store conversation state in memory (per session)
- Save partial data to temporary storage (in case of failure)
- Use cache/database for multi-session persistence (future)

**Recovery:**
- If submission fails, preserve collected data
- User can resume from where they left off
- Can edit any previously provided field

### 7. User Controls

**Available Actions:**
- **Cancel**: "Never mind" or "Cancel" → Clear state, return to idle
- **Edit**: "Change the email to..." → Update specific field
- **Start Over**: "Let me start over" → Clear all collected data
- **Skip**: "Skip that" → Mark field as intentionally blank (if optional)

---

## Implementation Plan

### Phase 1: Core Infrastructure
1. Conversation state manager
2. Intent detection system
3. Basic data collection flow

### Phase 2: Validation & Submission
4. Validation engine
5. Submission with retry logic
6. Error handling and recovery

### Phase 3: User Experience
7. User controls (cancel, edit)
8. Natural conversation improvements
9. State persistence

---

## Example Flows

### Flow 1: Simple Create
```
User: "Add John Smith as a contact"
Bot: "I'll add John Smith. What's his email address?"
User: "john@example.com"
Bot: [Validates → Submits] "✅ Added John Smith (john@example.com)!"
```

### Flow 2: Complex Create with Missing Data
```
User: "Create a new deal"
Bot: "I'll help you create a deal. I need:
      - Deal name
      - Company
      - Deal value
      - Stage"
User: "Acme Corp deal, $50k"
Bot: "Got it! For the Acme Corp deal worth $50,000:
      - What stage is it in? (e.g., 'Proposal', 'Negotiation', 'Won')"
User: "Proposal"
Bot: [Validates → Submits] "✅ Created deal: Acme Corp deal ($50k, Proposal stage)"
```

### Flow 3: Update Existing Record
```
User: "Update John's email"
Bot: "I found John Smith. What should the new email be?"
User: "john.new@example.com"
Bot: [Validates → Updates] "✅ Updated John Smith's email to john.new@example.com"
```

### Flow 4: Error Recovery
```
User: "Add Sarah Johnson"
Bot: "I'll add Sarah. What's her email?"
User: "sarah@example"
Bot: [Validates] "I need a valid email address. Could you provide Sarah's email?"
User: "sarah@example.com"
Bot: [Validates → Submits] "✅ Added Sarah Johnson (sarah@example.com)!"
```

### Flow 5: User Cancels
```
User: "Add a new company"
Bot: "I'll add a new company. What's the company name?"
User: "Never mind"
Bot: "No problem! I've cancelled that. What would you like to do?"
```

---

## Questions for Clarification

1. **Multi-Object Operations**: If user says "Add John Smith and Sarah Johnson", should we:
   - Create two separate collection flows?
   - Or handle as batch operation?

2. **Update Operations**: When updating, should we:
   - Show current values and ask what to change?
   - Or just ask for new values directly?

3. **Query Operations**: For READ intent, should we:
   - Execute immediately with best-effort query?
   - Or ask clarifying questions about filters first?

4. **Partial Data Recovery**: How long should partial data persist?
   - Until user explicitly cancels?
   - Or timeout after X minutes of inactivity?

5. **Validation Feedback**: Should validation errors be:
   - Shown immediately as data is entered?
   - Or only after user says "done" or similar?

6. **Natural Language Parsing**: How aggressive should parsing be?
   - Try to extract everything from one message?
   - Or ask for confirmation if uncertain?

---

## Next Steps

Once you confirm the design and answer the questions above, I'll implement:
1. Conversation state management module
2. Intent detection system
3. Data collection orchestrator
4. Validation engine
5. Submission handler with retry logic
6. Integration with existing chat API

