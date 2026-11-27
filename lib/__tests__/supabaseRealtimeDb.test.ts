import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn().mockResolvedValue({ error: null }),
  delete: vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
    like: vi.fn().mockResolvedValue({ error: null }),
  }),
  from: vi.fn(),
  rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  channel: vi.fn().mockReturnValue({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  }),
  removeChannel: vi.fn(),
}));

vi.mock('../supabaseClient', () => {
  mocks.from.mockImplementation((table: string) => {
    if (table === 'app_kv') {
      return { upsert: mocks.upsert, delete: mocks.delete };
    }
    return {};
  });

  const client = {
    from: mocks.from,
    rpc: mocks.rpc,
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  };

  return {
    supabaseUrl: 'https://eywpksapztzbnthlgfhd.supabase.co',
    supabaseAnonKey: 'test-anon-key',
    supabase: client,
    supabaseAdmin: null,
    isSupabaseConfigured: true,
  };
});

import { ref, set } from '../supabaseRealtimeDb';
import { supabase } from '../supabaseClient';

describe('supabaseRealtimeDb - AI tutor chat persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores AI tutor messages in app_kv', async () => {
    await set(ref(null, 'chat_messages/convo-1/msg-1'), {
      id: 'msg-1',
      sender: 'user',
      text: 'Hello tutor',
    });

    expect(supabase.from).toHaveBeenCalledWith('app_kv');
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'chat_messages/convo-1/msg-1' })
    );
  });

  it('removes an AI tutor conversation by deleting its app_kv keys', async () => {
    await set(ref(null, 'chat_messages/convo-1'), null);

    expect(supabase.from).toHaveBeenCalledWith('app_kv');
    expect(mocks.delete).toHaveBeenCalled();
  });
});
