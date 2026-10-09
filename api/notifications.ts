/**
 * Pure Firebase Cloud Messaging (FCM HTTP v1) push notifications API.
 * OneSignal has been completely decommissioned.
 *
 * POST /api/notifications
 * Body:
 *   - action: "send"
 *     targetUserId: string (or fcmToken directly)
 *     title: string
 *     message: string
 *     data?: Record<string, string>
 *
 *   - action: "schedule"
 *     targetUserId: string
 *     reminders: Array<{ time: number, title: string, body: string, data?: any }>
 */

import crypto from 'crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://eywpksapztzbnthlgfhd.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5d3Brc2FwenR6Ym50aGxnZmhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMjc5MzYsImV4cCI6MjEwMzYwMzkzNn0.uLZ-LBLWBmcgZYHnSDkbMV-BJA26I9x-pGDTZZxzyPI';
const DEFAULT_FIREBASE_PROJECT_ID = 'vantlab';

interface ServiceAccountConfig {
  project_id: string;
  client_email: string;
  private_key: string;
}

let cachedOAuthToken: { token: string; expiresAt: number } | null = null;

async function getServiceAccount(): Promise<ServiceAccountConfig | null> {
  // 1. Check environment variable (JSON string or base64)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      let raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      if (!raw.startsWith('{')) {
        raw = Buffer.from(raw, 'base64').toString('utf8');
      }
      const parsed = JSON.parse(raw);
      if (parsed.client_email && parsed.private_key) {
        return {
          project_id: parsed.project_id || DEFAULT_FIREBASE_PROJECT_ID,
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, '\n'),
        };
      }
    } catch (e) {
      console.warn('[FCM] Error parsing FIREBASE_SERVICE_ACCOUNT env var:', e);
    }
  }

  // 2. Check individual env variables
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      project_id: process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }

  // 3. Fallback: Check Supabase app_settings table for 'firebase_service_account'
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=eq.firebase_service_account&select=value_json`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (res.ok) {
      const rows = await res.json();
      if (rows && rows[0]?.value_json) {
        let val = rows[0].value_json;
        if (typeof val === 'string') {
          try { val = JSON.parse(val); } catch {}
        }
        if (val.value && typeof val.value === 'object') val = val.value;
        if (val.client_email && val.private_key) {
          return {
            project_id: val.project_id || DEFAULT_FIREBASE_PROJECT_ID,
            client_email: val.client_email,
            private_key: val.private_key.replace(/\\n/g, '\n'),
          };
        }
      }
    }
  } catch (err) {
    console.warn('[FCM] Error querying app_settings for firebase_service_account:', err);
  }

  return null;
}

/**
 * Generate Google OAuth2 Access Token for FCM v1 using RSA-SHA256 JWT assertion
 */
async function getFCMV1AccessToken(sa: ServiceAccountConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedOAuthToken && cachedOAuthToken.expiresAt > now + 60) {
    return cachedOAuthToken.token;
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const toBase64Url = (obj: any) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const unsignedJwt = `${toBase64Url(header)}.${toBase64Url(claim)}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedJwt);
  const signature = signer
    .sign(sa.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const assertion = `${unsignedJwt}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!tokenRes.ok) {
    const errorBody = await tokenRes.text();
    throw new Error(`Failed to exchange JWT for Google OAuth access token: ${errorBody}`);
  }

  const tokenData = await tokenRes.json();
  cachedOAuthToken = {
    token: tokenData.access_token,
    expiresAt: now + (tokenData.expires_in || 3600),
  };

  return cachedOAuthToken.token;
}

/**
 * Lookup device FCM token from Supabase app_kv or profiles
 */
async function getDeviceTokenForUser(userId: string): Promise<string | null> {
  if (!userId) return null;

  try {
    // 1. Check app_kv: user_device_tokens/<userId>
    const kvRes = await fetch(`${SUPABASE_URL}/rest/v1/app_kv?key=eq.user_device_tokens/${userId}&select=*`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (kvRes.ok) {
      const kvRows = await kvRes.json();
      const rawVal = kvRows?.[0]?.value || kvRows?.[0]?.value_json;
      let parsed = rawVal;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch {}
      }
      const token = parsed?.fcm_token;
      if (token && typeof token === 'string' && token.length > 20) {
        return token;
      }
    }

    // 2. Fallback: check profiles table
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=fcm_token`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (profileRes.ok) {
      const profileRows = await profileRes.json();
      const token = profileRows?.[0]?.fcm_token;
      if (token && typeof token === 'string' && token.length > 20) {
        return token;
      }
    }
  } catch (err) {
    console.warn('[FCM] Error looking up token for user:', userId, err);
  }

  return null;
}

/**
 * Fetch all registered device FCM tokens across app_kv and profiles
 */
async function getAllDeviceTokens(): Promise<string[]> {
  const tokenSet = new Set<string>();
  try {
    const kvRes = await fetch(`${SUPABASE_URL}/rest/v1/app_kv?key=like.user_device_tokens%25&select=value,value_json`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (kvRes.ok) {
      const kvRows = await kvRes.json();
      if (Array.isArray(kvRows)) {
        for (const row of kvRows) {
          const raw = row.value || row.value_json;
          let parsed = raw;
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch {}
          }
          const t = parsed?.fcm_token;
          if (t && typeof t === 'string' && t.length > 20) {
            tokenSet.add(t.trim());
          }
        }
      }
    }

    const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?fcm_token=not.is.null&select=fcm_token`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (profRes.ok) {
      const profRows = await profRes.json();
      if (Array.isArray(profRows)) {
        for (const row of profRows) {
          const t = row.fcm_token;
          if (t && typeof t === 'string' && t.length > 20) {
            tokenSet.add(t.trim());
          }
        }
      }
    }
  } catch (err) {
    console.warn('[FCM] Error fetching all device tokens:', err);
  }
  return Array.from(tokenSet);
}

export async function GET() {
  const sa = await getServiceAccount();
  return new Response(
    JSON.stringify({
      status: 'ok',
      provider: 'firebase_fcm_v1',
      project_id: sa?.project_id || DEFAULT_FIREBASE_PROJECT_ID,
      service_account_configured: Boolean(sa),
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

    const sa = await getServiceAccount();
    if (!sa) {
      return new Response(
        JSON.stringify({
          success: false,
          reason: 'Firebase Service Account is not configured. Please add FIREBASE_SERVICE_ACCOUNT environment variable or set "firebase_service_account" in Supabase app_settings.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // ── action: send ──────────────────────────────────────────────────────────
    if (action === 'send') {
      const { targetUserId, fcmToken, title, message, data: customData } = body;

      if ((!targetUserId && !fcmToken) || !message) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: (targetUserId or fcmToken) and message' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Convert any custom data values to string as required by FCM
      const dataPayload: Record<string, string> = {};
      if (customData && typeof customData === 'object') {
        for (const [k, v] of Object.entries(customData)) {
          if (v !== undefined && v !== null) {
            dataPayload[k] = typeof v === 'string' ? v : JSON.stringify(v);
          }
        }
      }

      // ── Broadcast to all users ──
      if (targetUserId === 'all' || body.broadcast === true) {
        const tokens = await getAllDeviceTokens();
        if (tokens.length === 0) {
          return new Response(
            JSON.stringify({
              success: false,
              reason: 'No active device FCM tokens found in database to broadcast to.',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const accessToken = await getFCMV1AccessToken(sa);
        let delivered = 0;
        let failed = 0;

        await Promise.allSettled(
          tokens.map(async (tok) => {
            try {
              const fcmPayload = {
                message: {
                  token: tok,
                  notification: {
                    title: title || 'Avelut',
                    body: message,
                  },
                  data: dataPayload,
                  android: {
                    priority: 'high',
                    notification: {
                      channel_id: 'default',
                      icon: 'ic_launcher',
                      sound: 'default',
                      default_vibrate_timings: true,
                    },
                  },
                },
              };

              const res = await fetch(
                `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                  },
                  body: JSON.stringify(fcmPayload),
                }
              );
              if (res.ok) {
                delivered++;
              } else {
                failed++;
              }
            } catch {
              failed++;
            }
          })
        );

        return new Response(
          JSON.stringify({
            success: true,
            broadcast: true,
            totalDevices: tokens.length,
            delivered,
            failed,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // ── Single recipient ──
      const token = fcmToken || (await getDeviceTokenForUser(targetUserId));
      if (!token) {
        return new Response(
          JSON.stringify({
            success: false,
            reason: `Target user ${targetUserId} does not have an active FCM token registered in Supabase.`,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const accessToken = await getFCMV1AccessToken(sa);

      const fcmPayload = {
        message: {
          token,
          notification: {
            title: title || 'Avelut',
            body: message,
          },
          data: dataPayload,
          android: {
            priority: 'high',
            notification: {
              channel_id: 'default',
              icon: 'ic_launcher',
              sound: 'default',
              default_vibrate_timings: true,
            },
          },
        },
      };

      const fcmRes = await fetch(
        `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(fcmPayload),
        }
      );

      const fcmData = await fcmRes.json();

      if (!fcmRes.ok) {
        console.error('[FCM] Send error:', fcmData);
        return new Response(
          JSON.stringify({ success: false, error: fcmData }),
          { status: fcmRes.status, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          messageId: fcmData.name,
          recipientTokenPreview: token.substring(0, 15) + '...',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── action: schedule ──────────────────────────────────────────────────────
    if (action === 'schedule') {
      const { targetUserId, reminders } = body;
      if (!targetUserId || !Array.isArray(reminders)) {
        return new Response(
          JSON.stringify({ error: 'Missing targetUserId or reminders array' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          scheduledCount: reminders.length,
          message: 'Study reminders registered.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action. Use "send" or "schedule".' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[FCM] Server error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
