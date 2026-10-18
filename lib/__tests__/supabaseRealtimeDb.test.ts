import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabaseClient
vi.mock('../supabaseClient', () => {
  const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const mockUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockImplementation(() => ({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  });
  const mockSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
      neq: vi.fn().mockResolvedValue({ data: [{ unread_count: 0, user_id: 'user-2' }], error: null }),
    }),
  });

  const mockFrom = vi.fn().mockImplementation((table: string) => {
    if (table === 'messages') {
      return { insert: mockInsert, select: mockSelect };
    }
    if (table === 'chat_members') {
      return {
        update: mockUpdate,
        select: mockSelect,
      };
    }
    return {
      insert: mockInsert,
      update: mockUpdate,
      select: mockSelect,
    };
  });

  const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });

  const mockSupabase = {
    from: mockFrom,
    rpc: mockRpc,
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: vi.fn(),
  };

  return {
    supabaseUrl: 'https://eywpksapztzbnthlgfhd.supabase.co',
    supabase: mockSupabase,
    supabaseAdmin: mockSupabase,
    isSupabaseConfigured: true,
  };
});

import { ref, set } from '../supabaseRealtimeDb';
import { supabase } from '../supabaseClient';

describe('supabaseRealtimeDb - persistMessage direct insert & push trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as any);
  });

  it('directly inserts message into messages table and triggers push-on-message edge function', async () => {
    const msgRef = ref(null, 'messages/chat-123/msg-456');
    const msgValue = {
      senderId: 'user-1',
      text: 'Hello, world!',
      type: 'text',
      timestamp: 1710000000000,
    };

    await set(msgRef, msgValue);

    // Verify direct table insert call
    expect(supabase.from).toHaveBeenCalledWith('messages');
    expect(supabase.from('messages').insert).toHaveBeenCalledWith({
      id: 'msg-456',
      chat_id: 'chat-123',
      sender_id: 'user-1',
      text: 'Hello, world!',
      media_url: null,
      media_type: 'text',
      reply_to: null,
      created_at: expect.any(String),
    });

    // Verify manual Edge Function trigger call via fetch
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchOptions] = (global.fetch as any).mock.calls[0];
    expect(fetchUrl).toBe('https://eywpksapztzbnthlgfhd.supabase.co/functions/v1/push-on-message');
    expect(fetchOptions.method).toBe('POST');
    expect(fetchOptions.headers).toEqual({ 'Content-Type': 'application/json' });

    const parsedBody = JSON.parse(fetchOptions.body);
    expect(parsedBody).toEqual({
      record: {
        id: 'msg-456',
        chat_id: 'chat-123',
        sender_id: 'user-1',
        text: 'Hello, world!',
        media_url: null,
        media_type: 'text',
        reply_to: null,
        created_at: expect.any(String),
      },
    });
  });
});
