/**
 * Google Calendar Schema Loader
 * 
 * Loads Google Calendar API structure and existing events into context.
 * Makes Claude fully aware of calendars and events.
 */

/**
 * Load Google Calendar schema and existing events
 */
export async function loadGoogleCalendarSchema(apiKey, baseUrl) {
  console.log('📅 Loading Google Calendar schema and events...');

  const schema = {
    base_url: baseUrl,
    calendars: [],
    events: [],
    calendar_list: null,
    all_endpoints: []
  };

  try {
    // Get list of calendars
    const calendarsResp = await fetch(`${baseUrl}/users/me/calendarList`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (calendarsResp.ok) {
      const calendarsData = await calendarsResp.json();
      schema.calendar_list = calendarsData;
      schema.calendars = calendarsData.items || [];
      console.log(`✅ Found ${schema.calendars.length} calendar(s)`);
    } else {
      const errorText = await calendarsResp.text().catch(() => '');
      console.error(`❌ Failed to load calendar list: ${calendarsResp.status}`);
      if (calendarsResp.status === 403) {
        console.error('   This usually means the Calendar API is not enabled in your Google Cloud project.');
        console.error('   Enable it at: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com');
      } else if (calendarsResp.status === 401) {
        console.error('   Authentication failed - token may be expired or invalid.');
        console.error('   Try disconnecting and reconnecting Google Calendar.');
      }
    }

    // Get events from primary calendar (most recent, limited to avoid token limits)
    const maxEvents = parseInt(process.env.MAX_RECORDS_PER_OBJECT || '500');
    const now = new Date();
    const timeMin = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days ago
    const timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days ahead

    const eventsUrl = new URL(`${baseUrl}/calendars/primary/events`);
    eventsUrl.searchParams.set('timeMin', timeMin.toISOString());
    eventsUrl.searchParams.set('timeMax', timeMax.toISOString());
    eventsUrl.searchParams.set('maxResults', Math.min(maxEvents, 500).toString());
    eventsUrl.searchParams.set('singleEvents', 'true');
    eventsUrl.searchParams.set('orderBy', 'startTime');

    const eventsResp = await fetch(eventsUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (eventsResp.ok) {
      const eventsData = await eventsResp.json();
      schema.events = eventsData.items || [];
      console.log(`✅ Loaded ${schema.events.length} event(s) from primary calendar`);
    } else {
      const errorText = await eventsResp.text().catch(() => '');
      console.error(`❌ Failed to load events: ${eventsResp.status}`);
      if (eventsResp.status === 403) {
        console.error('   This usually means the Calendar API is not enabled in your Google Cloud project.');
        console.error('   Enable it at: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com');
      } else if (eventsResp.status === 401) {
        console.error('   Authentication failed - token may be expired or invalid.');
        console.error('   Try disconnecting and reconnecting Google Calendar.');
      }
    }

    // Discover available endpoints
    schema.all_endpoints = [
      { method: 'GET', path: '/calendars/primary/events', description: 'List events in primary calendar' },
      { method: 'POST', path: '/calendars/primary/events', description: 'Create event in primary calendar' },
      { method: 'GET', path: '/calendars/{calendarId}/events', description: 'List events in specific calendar' },
      { method: 'POST', path: '/calendars/{calendarId}/events', description: 'Create event in specific calendar' },
      { method: 'PUT', path: '/calendars/{calendarId}/events/{eventId}', description: 'Update event' },
      { method: 'DELETE', path: '/calendars/{calendarId}/events/{eventId}', description: 'Delete event' },
      { method: 'GET', path: '/users/me/calendarList', description: 'List all calendars' },
      { method: 'GET', path: '/calendars/{calendarId}', description: 'Get calendar details' }
    ];

    console.log(`✅ Google Calendar schema loaded: ${schema.calendars.length} calendars, ${schema.events.length} events`);
    return schema;

  } catch (error) {
    console.error('❌ Error loading Google Calendar schema:', error);
    return schema; // Return partial schema
  }
}

/**
 * Convert Google Calendar schema to context string for Claude
 */
export function schemaToContext(schema) {
  // Get current date/time for Claude to use as reference
  const now = new Date();
  const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const currentDateTime = now.toISOString(); // Full ISO 8601
  const currentDayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  
  let context = `## Google Calendar API

Base URL: ${schema.base_url}

### ⏰ CURRENT DATE/TIME (CRITICAL - Use this as reference for all date calculations):
- **Today's Date**: ${currentDate}
- **Current Date/Time**: ${currentDateTime}
- **Day of Week**: ${currentDayOfWeek}
- **IMPORTANT**: When user says "Wednesday", "next week", "tomorrow", etc., calculate from TODAY (${currentDate})
- **NEVER use hardcoded dates from examples** - always calculate from the current date above

### Available Endpoints:
${schema.all_endpoints.map(ep => `- ${ep.method} ${ep.path} - ${ep.description}`).join('\n')}

### Your Calendars:
`;

  if (schema.calendars && schema.calendars.length > 0) {
    schema.calendars.forEach(cal => {
      context += `- **${cal.summary || 'Untitled'}** (ID: ${cal.id})\n`;
      if (cal.description) context += `  Description: ${cal.description}\n`;
      if (cal.timeZone) context += `  Timezone: ${cal.timeZone}\n`;
      context += `  Access: ${cal.accessRole || 'unknown'}\n`;
    });
  } else {
    context += '- Primary calendar (default)\n';
  }

  context += `\n### Existing Events (${schema.events.length} total):\n`;
  context += `CRITICAL: The events listed below are REAL calendar events. Use this information to check if events exist before creating duplicates.\n\n`;

  if (schema.events && schema.events.length > 0) {
    // Show most recent and upcoming events
    const eventsToShow = schema.events.slice(0, 50);
    
    eventsToShow.forEach(event => {
      const summary = event.summary || 'Untitled Event';
      const start = event.start?.dateTime || event.start?.date || 'No start time';
      const end = event.end?.dateTime || event.end?.date || 'No end time';
      const location = event.location || '';
      const attendees = event.attendees?.map(a => a.email).join(', ') || '';
      
      context += `- **${summary}**\n`;
      context += `  Start: ${start}\n`;
      context += `  End: ${end}\n`;
      if (location) context += `  Location: ${location}\n`;
      if (attendees) context += `  Attendees: ${attendees}\n`;
      context += `  [ID: ${event.id}]\n`;
    });

    if (schema.events.length > 50) {
      context += `\n... and ${schema.events.length - 50} more events\n`;
    }
  } else {
    context += '- No events found in the selected time range\n';
  }

  context += `\n### Event Format:
When creating events, use this structure:
- summary: Event title (string)
- description: Event description (string, optional)
- start: { dateTime: "2024-01-15T10:00:00-08:00", timeZone: "America/Los_Angeles" }
- end: { dateTime: "2024-01-15T11:00:00-08:00", timeZone: "America/Los_Angeles" }
- location: "123 Main St, City, State" (string, optional)
- attendees: [{ email: "attendee@example.com" }] (array, optional)
- reminders: { useDefault: true } or { overrides: [{ method: "email", minutes: 30 }] }

### Important Notes:
- Always use ISO 8601 format for dates/times: "YYYY-MM-DDTHH:mm:ss±HH:mm"
- Include timeZone in start/end objects
- Use "primary" as calendarId for the user's primary calendar
- Check existing events before creating to avoid duplicates
- Event IDs are unique and can be used for updates/deletes
`;

  return context;
}

