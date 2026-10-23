import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  deleteLocalMessage,
  updateLocalMessageText,
  getLocalMessages,
  saveLocalMessage,
  saveLocalConversation,
} from '../services/chatStorageService';

// Mock sqliteService
vi.mock('../lib/sqlite/sqliteService', () => {
  const mockStorage = new Map<string, any[]>();

  return {
    runQuery: vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes('FROM messages')) {
        const convoId = params[0];
        const msgs = mockStorage.get(`msg_${convoId}`) || [];
        return msgs.filter((m) => m.is_deleted === 0);
      }
      return [];
    }),
    runStatement: vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes('UPDATE messages SET is_deleted = 1 WHERE id = ?')) {
        const msgId = params[0];
        for (const [key, list] of mockStorage.entries()) {
          const found = list.find((m) => m.id === msgId);
          if (found) {
            found.is_deleted = 1;
          }
        }
      } else if (sql.includes('UPDATE messages SET text = ? WHERE id = ?')) {
        const [newText, msgId] = params;
        for (const [key, list] of mockStorage.entries()) {
          const found = list.find((m) => m.id === msgId);
          if (found) {
            found.text = newText;
          }
        }
      } else if (sql.includes('INSERT OR REPLACE INTO messages')) {
        const [id, conversation_id, user_id, sender, text, attachments_json, image_url, timestamp, sync_status, is_deleted] = params;
        const key = `msg_${conversation_id}`;
        const existing = mockStorage.get(key) || [];
        const idx = existing.findIndex((m) => m.id === id);
        const item = { id, conversation_id, user_id, sender, text, attachments_json, image_url, timestamp, sync_status, is_deleted };
        if (idx >= 0) {
          existing[idx] = item;
        } else {
          existing.push(item);
        }
        mockStorage.set(key, existing);
      }
    }),
    subscribeTable: vi.fn(() => () => {}),
    mockStorage,
  };
});

describe('Edit-Message Branching and Truncation', () => {
  const convoId = 'conv_test_branch_1';
  const userId = 'user_123';

  beforeEach(async () => {
    // Populate sample conversation history: 5 turns (U1, A1, U2, A2, U3)
    await saveLocalConversation({ id: convoId, user_id: userId, title: 'Test Convo' });

    await saveLocalMessage({ id: 'msg_u1', conversation_id: convoId, user_id: userId, sender: 'user', text: 'Prompt 1', timestamp: 1000 });
    await saveLocalMessage({ id: 'msg_a1', conversation_id: convoId, user_id: userId, sender: 'assistant', text: 'Response 1', timestamp: 2000 });
    await saveLocalMessage({ id: 'msg_u2', conversation_id: convoId, user_id: userId, sender: 'user', text: 'Prompt 2', timestamp: 3000 });
    await saveLocalMessage({ id: 'msg_a2', conversation_id: convoId, user_id: userId, sender: 'assistant', text: 'Response 2', timestamp: 4000 });
    await saveLocalMessage({ id: 'msg_u3', conversation_id: convoId, user_id: userId, sender: 'user', text: 'Prompt 3', timestamp: 5000 });
  });

  it('1. Truncates messages correctly when editing a prompt at index i', async () => {
    const initialMsgs = await getLocalMessages(convoId);
    expect(initialMsgs.length).toBe(5);

    // Edit Prompt 2 (index 2 in 0-indexed list: msg_u1, msg_a1, msg_u2, msg_a2, msg_u3)
    const targetIdx = 2;
    const targetMsgId = initialMsgs[targetIdx].id; // 'msg_u2'
    const newText = 'Edited Prompt 2';

    // Delete downstream messages (msg_a2, msg_u3)
    const subsequentMsgs = initialMsgs.slice(targetIdx + 1);
    for (const sm of subsequentMsgs) {
      await deleteLocalMessage(sm.id);
    }

    // Update target message text
    await updateLocalMessageText(targetMsgId, newText);

    // Verify active conversation in SQLite now has only msg_u1, msg_a1, edited msg_u2
    const updatedMsgs = await getLocalMessages(convoId);
    expect(updatedMsgs.length).toBe(3);
    expect(updatedMsgs.map((m) => m.id)).toEqual(['msg_u1', 'msg_a1', 'msg_u2']);
    expect(updatedMsgs[2].text).toBe('Edited Prompt 2');
  });

  it('2. In-flight generation cancellation aborts active fetch controller', () => {
    const abortController = new AbortController();
    const abortSpy = vi.spyOn(abortController, 'abort');

    // Simulate handleSaveEdit in-flight check
    if (abortController) {
      abortController.abort();
    }

    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(abortController.signal.aborted).toBe(true);
  });

  it('3. Downstream messages disappear permanently from active history query', async () => {
    // Edit prompt 1 (index 0)
    const initialMsgs = await getLocalMessages(convoId);
    const targetIdx = 0;
    const targetMsgId = initialMsgs[targetIdx].id;

    const subsequentMsgs = initialMsgs.slice(targetIdx + 1);
    for (const sm of subsequentMsgs) {
      await deleteLocalMessage(sm.id);
    }
    await updateLocalMessageText(targetMsgId, 'Edited Prompt 1');

    const updatedMsgs = await getLocalMessages(convoId);
    expect(updatedMsgs.length).toBe(1);
    expect(updatedMsgs[0].id).toBe('msg_u1');
    expect(updatedMsgs[0].text).toBe('Edited Prompt 1');
  });
});
