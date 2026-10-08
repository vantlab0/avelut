/**
 * Unified OneSignal notifications handler.
 *
 * POST /api/notifications
 * Body must include an `action` field:
 *   - "send"     → send an immediate push notification
 *   - "schedule" → schedule one or more future push notifications
 */

const ONESIGNAL_APP_ID = '805fdff6-e515-4ace-ad01-f2dcec4f0a37';

async function getApiKey(): Promise<string | undefined> {
  if (process.env.ONESIGNAL_REST_API_KEY) {
    return process.env.ONESIGNAL_REST_API_KEY;
  }
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://eywpksapztzbnthlgfhd.supabase.co';
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5d3Brc2FwenR6Ym50aGxnZmhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMjc5MzYsImV4cCI6MjEwMzYwMzkzNn0.uLZ-LBLWBmcgZYHnSDkbMV-BJA26I9x-pGDTZZxzyPI';
    const res = await fetch(`${supabaseUrl}/rest/v1/app_settings?key=eq.onesignal_rest_api_key&select=value_json`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data[0]?.value_json?.value) {
        return data[0].value_json.value;
      }
    }
  } catch {}
  return undefined;
}

export async function GET() {
  const apiKey = await getApiKey();
  return new Response(
    JSON.stringify({
      status: 'ok',
      onesignal_app_id: ONESIGNAL_APP_ID,
      api_key_configured: Boolean(apiKey),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;

    const apiKey = await getApiKey();
    if (!apiKey) {
      console.warn('ONESIGNAL_REST_API_KEY is not set.');
      return new Response(
        JSON.stringify({
          success: false,
          reason: 'ONESIGNAL_REST_API_KEY environment variable is not configured in Vercel project settings or Supabase app_settings.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // ── action: send ──────────────────────────────────────────────────────────
    if (action === 'send') {
      const { targetUserId, title, message, data: customData } = body;

      if (!targetUserId || !message) {
        return new Response(JSON.stringify({ error: 'Missing required fields: targetUserId and message' }), { status: 400 });
      }

      const response = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Basic ${apiKey}`,
        },
        body: JSON.stringify({
          app_id: ONESIGNAL_APP_ID,
          include_aliases: { external_id: [targetUserId] },
          include_external_user_ids: [targetUserId],
          target_channel: 'push',
          headings: { en: title || 'New Message' },
          contents: { en: message },
          data: customData || {},
          small_icon: 'ic_launcher',
        }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        console.error('OneSignal API Error:', responseData);
        return new Response(JSON.stringify({ success: false, error: responseData }), { status: response.status });
      }

      const recipients = responseData.recipients ?? (responseData.id ? 1 : 0);
      if (recipients === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            reason: 'User has no active push subscription on this device or external_id is not yet registered.',
            data: responseData,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ success: true, data: responseData }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // ── action: schedule ──────────────────────────────────────────────────────
    if (action === 'schedule') {
      const { targetUserId, reminders } = body;

      if (!targetUserId || !Array.isArray(reminders) || reminders.length === 0) {
        return new Response(JSON.stringify({ error: 'Missing required fields: targetUserId and reminders' }), { status: 400 });
      }

      const results = await Promise.all(
        reminders.map(async (reminder: any) => {
          const sendAfterDate = new Date(reminder.time).toUTCString();

          const response = await fetch('https://onesignal.com/api/v1/notifications', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              Authorization: `Basic ${apiKey}`,
            },
            body: JSON.stringify({
              app_id: ONESIGNAL_APP_ID,
              include_aliases: { external_id: [targetUserId] },
              include_external_user_ids: [targetUserId],
              target_channel: 'push',
              headings: { en: reminder.title || 'Study Reminder' },
              contents: { en: reminder.body },
              data: reminder.data || { route: 'timetable' },
              small_icon: 'ic_launcher',
              send_after: sendAfterDate,
            }),
          });

          return response.json();
        }),
      );

      return new Response(JSON.stringify({ success: true, results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Unknown action. Use "send" or "schedule".' }), {
      status: 400,
    });
  } catch (error: any) {
    console.error('Error in /api/notifications:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
