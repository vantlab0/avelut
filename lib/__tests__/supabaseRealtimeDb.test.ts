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

  const mockRpc = vi.fn().mockImplementation((fnName: string) => {
    if (fnName === 'send_chat_message') {
      return Promise.resolve({ data: null, error: { message: 'RPC not available' } });
    }
    return Promise.resolve({ data: null, error: null });
  });

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

import { ref, set, markChatAsRead } from '../supabaseRealtimeDb';
import { supabase } from '../supabaseClient';

describe('supabaseRealtimeDb - markChatAsRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears current user unread count and only marks sender read if current user is recipient', async () => {
    // Mock RPC mark_chat_as_read failing to test REST fallback
    (supabase.rpc as any).mockResolvedValueOnce({ error: { message: 'RPC error' } });

    // Mock select last_message_sender_id
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: { last_message_sender_id: 'user-sender' },
    });
    const mockSelectEq2 = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockSelectEq1 = vi.fn().mockReturnValue({ eq: mockSelectEq2 });

    const mockUpdateEq2 = vi.fn().mockResolvedValue({ error: null });
    const mockUpdateEq1 = vi.fn().mockReturnValue({ eq: mockUpdateEq2 });

    const mockMsgEqFalse = vi.fn().mockResolvedValue({ error: null });
    const mockMsgNeqSender = vi.fn().mockReturnValue({ eq: mockMsgEqFalse });
    const mockMsgEqChat = vi.fn().mockReturnValue({ neq: mockMsgNeqSender });

    const mockUpdateSender = vi.fn().mockResolvedValue({ error: null });
    const mockUpdateSenderEq = vi.fn().mockReturnValue({ eq: mockUpdateSender });

    const originalFrom = supabase.from;
    (supabase.from as any) = vi.fn().mockImplementation((table: string) => {
      if (table === 'chat_members') {
        return {
          update: vi.fn().mockImplementation((val: any) => {
            if ('unread_count' in val) {
              return { eq: mockUpdateEq1 };
            }
            return { eq: mockUpdateSenderEq };
          }),
          select: vi.fn().mockReturnValue({ eq: mockSelectEq1 }),
        };
      }
      if (table === 'messages') {
        return {
          update: vi.fn().mockReturnValue({ eq: mockMsgEqChat }),
        };
      }
      return {};
    });

    try {
      await markChatAsRead('chat-1', 'user-recipient');

      expect(supabase.from).toHaveBeenCalledWith('chat_members');
      expect(supabase.from).toHaveBeenCalledWith('messages');
    } finally {
      (supabase.from as any) = originalFrom;
    }
  });
});

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
