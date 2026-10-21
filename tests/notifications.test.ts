import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { POST } from '../api/notifications';

describe('api/notifications FCM v1 API', () => {
  const originalEnv = process.env;
  let testPrivateKey: string;

  beforeEach(() => {
    vi.restoreAllMocks();

    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    testPrivateKey = privateKey;

    process.env = {
      ...originalEnv,
      FIREBASE_PROJECT_ID: 'test-project',
      FIREBASE_CLIENT_EMAIL: 'test@test-project.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: testPrivateKey,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('constructs a high-priority data-only FCM payload without top-level notification field', async () => {
    let capturedFcmPayload: any = null;

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      // OAuth token request mock
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'mock_oauth_access_token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // FCM v1 send request mock
      if (url.includes('messages:send')) {
        capturedFcmPayload = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ name: 'projects/test-project/messages/msg_123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({}), { status: 404 });
    });

    const req = new Request('https://www.avelut.xyz/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send',
        fcmToken: 'mock_fcm_device_token_abc',
        title: 'New Study Partner Message',
        message: 'Hey, let us review Calculus together!',
        customData: {
          route: 'messenger',
          chatId: 'chat_calc_101',
          senderId: 'user_sender_999',
        },
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.messageId).toBe('projects/test-project/messages/msg_123');

    // Verify FCM v1 Payload Structure
    expect(capturedFcmPayload).toBeDefined();
    const msg = capturedFcmPayload.message;

    // Must be data-only to guarantee onMessageReceived runs on Android background/closed states
    expect(msg.notification).toBeUndefined();
    expect(msg.android.notification).toBeUndefined();

    // Data payload checks
    expect(msg.token).toBe('mock_fcm_device_token_abc');
    expect(msg.android.priority).toBe('high');
    expect(msg.data.title).toBe('New Study Partner Message');
    expect(msg.data.body).toBe('Hey, let us review Calculus together!');
    expect(msg.data.message).toBe('Hey, let us review Calculus together!');
    expect(msg.data.route).toBe('messenger');
    expect(msg.data.chatId).toBe('chat_calc_101');
    expect(msg.data.senderId).toBe('user_sender_999');
  });
});
