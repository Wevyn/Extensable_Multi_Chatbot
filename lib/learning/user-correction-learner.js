/**
 * User Correction Learner
 * 
 * Detects when users correct the bot and learns their language preferences.
 * Example: User says "next Friday" → bot interprets as this Friday → user corrects "I meant the following week"
 * This learns: "next Friday" for this user means "the following week's Friday"
 */

import { learnLanguagePreference, getLanguagePreference, getAllLanguagePreferences } from './pattern-learner.js';

/**
 * Detect if a user message contains a correction
 * Returns { isCorrection: boolean, originalPhrase: string, correctedInterpretation: string, context: object }
 */
export function detectCorrection(userMessage, previousBotResponse, previousUserMessage) {
  const message = userMessage.toLowerCase().trim();
  
  // Strong correction indicators (must be at start of message or after common starters)
  const strongCorrectionIndicators = [
    /^(?:no|actually|wait|correction|that's not|that should be|that was|i meant|i mean|i wanted|i said|when i said)/i,
    /(?:^|\. |, )(?:no|actually|wait|correction|that's not|that should be|that was|i meant|i mean|i wanted)/i
  ];
  
  let hasCorrectionIndicator = false;
  for (const pattern of strongCorrectionIndicators) {
    if (pattern.test(message)) {
      hasCorrectionIndicator = true;
      break;
    }
  }
  
  if (!hasCorrectionIndicator) {
    return { isCorrection: false };
  }
  
  // Try to extract original phrase and correction
  const originalPhrase = extractOriginalPhrase(message, previousUserMessage, previousBotResponse);
  const correctedInterpretation = extractCorrectedInterpretation(message, previousBotResponse);
  
  // If we found both, it's a valid correction
  if (originalPhrase && correctedInterpretation) {
    return {
      isCorrection: true,
      originalPhrase,
      correctedInterpretation,
      context: {
        previousBotResponse: previousBotResponse,
        previousUserMessage: previousUserMessage,
        type: 'date_time' // Most corrections are about dates/times
      }
    };
  }
  
  // Even if we can't extract perfectly, if there's a strong indicator and date/time words, treat as correction
  const dateTimeWords = /(?:friday|monday|tuesday|wednesday|thursday|saturday|sunday|week|month|day|tomorrow|today|next|this|following|last)/i;
  if (hasCorrectionIndicator && dateTimeWords.test(message)) {
    return {
      isCorrection: true,
      originalPhrase: extractOriginalPhrase(message, previousUserMessage, previousBotResponse) || 'unknown',
      correctedInterpretation: extractCorrectedInterpretation(message, previousBotResponse) || message,
      context: {
        previousBotResponse: previousBotResponse,
        previousUserMessage: previousUserMessage,
        type: 'date_time',
        partial: true // Flag that extraction wasn't perfect
      }
    };
  }
  
  return { isCorrection: false };
}

/**
 * Extract the original phrase from the correction message
 */
function extractOriginalPhrase(correctionMessage, previousUserMessage, previousBotResponse) {
  // Try to find quoted phrases
  const quotedMatch = correctionMessage.match(/"([^"]+)"/);
  if (quotedMatch) {
    return quotedMatch[1].toLowerCase().trim();
  }
  
  // Try to extract from patterns like "by X I meant Y"
  const byPatternMatch = correctionMessage.match(/by "?([^"]+)"? i (?:meant|mean|wanted)/i);
  if (byPatternMatch) {
    return byPatternMatch[1].toLowerCase().trim();
  }
  
  // Try "when I said X"
  const whenSaidMatch = correctionMessage.match(/when i said "?([^"]+)"?/i);
  if (whenSaidMatch) {
    return whenSaidMatch[1].toLowerCase().trim();
  }
  
  // If we have the previous user message, try to extract the relevant phrase
  if (previousUserMessage) {
    // Look for date/time phrases in the previous message
    const dateTimePhrases = previousUserMessage.match(/(?:next|this|the following|last) (?:friday|monday|tuesday|wednesday|thursday|saturday|sunday|week|month)/gi);
    if (dateTimePhrases && dateTimePhrases.length > 0) {
      return dateTimePhrases[0].toLowerCase().trim();
    }
    
    // Look for "next [day]" patterns
    const nextDayMatch = previousUserMessage.match(/next (?:friday|monday|tuesday|wednesday|thursday|saturday|sunday)/gi);
    if (nextDayMatch && nextDayMatch.length > 0) {
      return nextDayMatch[0].toLowerCase().trim();
    }
  }
  
  // Check if bot response mentioned a date that user is correcting
  if (previousBotResponse && (correctionMessage.includes('following week') || correctionMessage.includes('next week'))) {
    const botDateMatch = previousBotResponse.match(/(?:november|december|january|february|march|april|may|june|july|august|september|october) \d+/i);
    if (botDateMatch) {
      // User is correcting a date interpretation
      if (previousUserMessage) {
        const userPhrase = previousUserMessage.match(/(?:next|this|the following) (?:friday|monday|tuesday|wednesday|thursday|saturday|sunday|week)/gi);
        if (userPhrase && userPhrase.length > 0) {
          return userPhrase[0].toLowerCase().trim();
        }
      }
    }
  }
  
  // Fallback: extract common date/time phrases from correction message
  const commonPhrases = correctionMessage.match(/(?:next|this|the following|last) (?:friday|monday|tuesday|wednesday|thursday|saturday|sunday|week|month)/gi);
  if (commonPhrases && commonPhrases.length > 0) {
    return commonPhrases[0].toLowerCase().trim();
  }
  
  return null;
}

/**
 * Extract the corrected interpretation from the correction message
 */
function extractCorrectedInterpretation(correctionMessage, previousBotResponse) {
  // Try to find the corrected phrase after "meant", "mean", "wanted", etc.
  const meantMatch = correctionMessage.match(/(?:i (?:meant|mean|wanted)|that should be|that was) (?:the|on|it to be|it as|that as)? ?([^.!?]+)/i);
  if (meantMatch) {
    return meantMatch[1].trim();
  }
  
  // Try pattern "by X I meant Y"
  const byMeantMatch = correctionMessage.match(/by "?[^"]+"? i (?:meant|mean|wanted) ([^.!?]+)/i);
  if (byMeantMatch) {
    return byMeantMatch[1].trim();
  }
  
  // Try "I meant the following week" or similar
  const followingWeekMatch = correctionMessage.match(/(?:i (?:meant|mean|wanted)|that should be) (?:the )?(?:following|next) (?:week|friday|monday|tuesday|wednesday|thursday|saturday|sunday)/i);
  if (followingWeekMatch) {
    return correctionMessage.match(/(?:the )?(?:following|next) (?:week|friday|monday|tuesday|wednesday|thursday|saturday|sunday)/i)?.[0] || null;
  }
  
  // Try to extract date/time phrases from the correction
  const dateTimePhrases = correctionMessage.match(/(?:the|a|an) (?:following|next|this) (?:friday|monday|tuesday|wednesday|thursday|saturday|sunday|week|month)/gi);
  if (dateTimePhrases && dateTimePhrases.length > 0) {
    return dateTimePhrases[0].trim();
  }
  
  // If correction mentions "following week" or "next week", extract that
  const weekMatch = correctionMessage.match(/(?:the )?(?:following|next) week/i);
  if (weekMatch) {
    return weekMatch[0].trim();
  }
  
  return null;
}

/**
 * Learn from a user correction
 */
export function learnFromCorrection(userId, adapterName, originalPhrase, correctedInterpretation, context = {}) {
  if (!originalPhrase || !correctedInterpretation) {
    return false;
  }
  
  learnLanguagePreference(userId, adapterName, originalPhrase, correctedInterpretation, context);
  return true;
}

/**
 * Get learned language preferences for use in system prompts
 */
export function getLearnedLanguagePreferencesText(userId, adapterName) {
  const preferences = getAllLanguagePreferences(userId, adapterName);
  
  if (preferences.length === 0) {
    return '';
  }
  
  let text = `\n## 🧠 Your Language Preferences (Learned from your corrections):\n\n`;
  text += `**IMPORTANT: When interpreting user requests, use these learned preferences:**\n\n`;
  
  preferences.forEach(pref => {
    text += `- **"${pref.phrase}"** → This user means: "${pref.interpretation}" (learned ${pref.count} time${pref.count > 1 ? 's' : ''})\n`;
  });
  
  text += `\n**Always apply these preferences when interpreting similar phrases in future requests.**\n`;
  
  return text;
}

