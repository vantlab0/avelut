/**
 * Pure Firebase Cloud Messaging (FCM HTTP v1) push notifications API.
 */

import crypto from 'crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://eywpksapztzbnthlgfhd.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const DEFAULT_FIREBASE_PROJECT_ID = 'vantlab';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function resolveFirebaseConfig() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const parsed = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : process.env.FIREBASE_SERVICE_ACCOUNT;
      if (parsed.client_email && parsed.private_key) {
        return {
          project_id: parsed.project_id || process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID,
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, '\n'),
        };
      }
    } catch (e) {
      console.warn('[FCM] Error parsing FIREBASE_SERVICE_ACCOUNT JSON:', e);
    }
  }

  return {
    project_id: process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };
}

async function lookupUserFcmToken(userId: string): Promise<string | null> {
  const authKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!authKey) return null;

  const headers = { apikey: authKey, Authorization: `Bearer ${authKey}` };

  // 1. Try profiles table first
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=fcm_token`, { headers });
    if (res.ok) {
      const rows = await res.json();
      if (rows?.[0]?.fcm_token) {
        return rows[0].fcm_token;
      }
    }
  } catch (err) {
    console.warn('[FCM] profiles token lookup error:', err);
  }

  // 2. Fallback to app_kv table under user_device_tokens/<uid>
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/app_kv?key=eq.user_device_tokens/${userId}&select=value`, { headers });
    if (res.ok) {
      const rows = await res.json();
      const val = rows?.[0]?.value;
      const token = typeof val === 'object' ? val?.fcm_token : val;
      if (token && typeof token === 'string') {
        return token;
      }
    }
  } catch (err) {
    console.warn('[FCM] app_kv token lookup error:', err);
  }

  return null;
}

async function getFCMV1AccessToken(sa: { project_id: string; client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const toBase64Url = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const unsignedJwt = `${toBase64Url(header)}.${toBase64Url(claim)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedJwt);
  const signature = signer.sign(sa.private_key, 'base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
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
  return tokenData.access_token;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, targetUserId, fcmToken, title, message } = body;
    const customData = body.customData || body.data;

    if (!action) {
      return jsonResponse({ error: 'Missing action.' }, 400);
    }

    if (action === 'send') {
      if ((!targetUserId && !fcmToken) || !message) {
        return jsonResponse({ error: 'Missing required fields: (targetUserId or fcmToken) and message' }, 400);
      }

      const token = fcmToken || (targetUserId ? await lookupUserFcmToken(targetUserId) : null);

      if (!token) {
        return jsonResponse({ success: false, reason: `Target user ${targetUserId} does not have an active FCM token registered.` }, 200);
      }

      const firebaseConfig = resolveFirebaseConfig();

      if (!firebaseConfig.client_email || !firebaseConfig.private_key) {
        return jsonResponse({ success: false, reason: 'Firebase Service Account is not configured.' }, 200);
      }

      const accessToken = await getFCMV1AccessToken(firebaseConfig as any);

      // Ensure all customData entries are strings for FCM v1 spec
      const stringifiedData: Record<string, string> = {
        route: 'chat',
        title: title || 'Avelut',
        body: message || '',
        message: message || '',
      };
      if (customData && typeof customData === 'object') {
        for (const [k, v] of Object.entries(customData)) {
          if (v !== undefined && v !== null) {
            stringifiedData[k] = String(v);
          }
        }
      }

      // Omit top-level notification and android.notification to ensure FCM delivers a data-only payload.
      // This forces FirebaseMessagingService.onMessageReceived() (AvelutMessagingService) to always run
      // in foreground, background, or closed states on Android, constructing custom notifications with
      // native action buttons (Inline Reply, Mark as read).
      const messagePayload = {
        message: {
          token,
          data: stringifiedData,
          android: {
            priority: 'high',
          },
        },
      };

      const fcmRes = await fetch(`https://fcm.googleapis.com/v1/projects/${firebaseConfig.project_id}/messages:send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(messagePayload),
      });

      const fcmData = await fcmRes.json();
      if (!fcmRes.ok) {
        console.error('[FCM] Send error:', fcmData);
        return jsonResponse({ success: false, error: fcmData }, fcmRes.status);
      }

      return jsonResponse({ success: true, messageId: fcmData.name, recipientTokenPreview: token.substring(0, 15) + '...' }, 200);
    }

    if (action === 'schedule') {
      return jsonResponse({ success: true, scheduledCount: Array.isArray(body.reminders) ? body.reminders.length : 0 }, 200);
    }

    return jsonResponse({ error: 'Unknown action. Use "send" or "schedule".' }, 400);
  } catch (err: any) {
    console.error('[FCM] Server error:', err);
    return jsonResponse({ error: err.message || 'Internal server error' }, 500);
  }
}
