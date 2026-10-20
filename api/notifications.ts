/**
 * Pure Firebase Cloud Messaging (FCM HTTP v1) push notifications API.
 */

import crypto from 'crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://eywpksapztzbnthlgfhd.supabase.co';
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
    const { action, targetUserId, fcmToken, title, message, data: customData } = body;

    if (!action) {
      return jsonResponse({ error: 'Missing action.' }, 400);
    }

    if (action === 'send') {
      if ((!targetUserId && !fcmToken) || !message) {
        return jsonResponse({ error: 'Missing required fields: (targetUserId or fcmToken) and message' }, 400);
      }

      const token = fcmToken || await (async () => {
        if (!SUPABASE_ANON_KEY) {
          throw new Error('SUPABASE_ANON_KEY is not configured for notification token lookup.');
        }
        const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${targetUserId}&select=fcm_token`, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        });
        if (!res.ok) return null;
        const rows = await res.json();
        return rows?.[0]?.fcm_token || null;
      })();

      if (!token) {
        return jsonResponse({ success: false, reason: `Target user ${targetUserId} does not have an active FCM token registered.` }, 200);
      }

      const firebaseConfig = {
        project_id: process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      };

      if (!firebaseConfig.client_email || !firebaseConfig.private_key) {
        return jsonResponse({ success: false, reason: 'Firebase Service Account is not configured.' }, 200);
      }

      const accessToken = await getFCMV1AccessToken(firebaseConfig as any);

      const messagePayload = {
        message: {
          token,
          notification: {
            title: title || 'Avelut',
            body: message,
          },
          data: { ...(customData || {}), route: String((customData || {}).route || 'chat') },
          android: {
            priority: 'high',
            notification: {
              channel_id: 'default',
              icon: 'ic_launcher',
              sound: 'default',
              default_vibrate_timings: true,
              click_action: 'FCM_PLUGIN_ACTIVITY',
            },
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
