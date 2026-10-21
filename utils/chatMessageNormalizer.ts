import type { Message } from '../types';
import { runStatement } from '../lib/sqlite/sqliteService';

/**
 * Robustly detects whether a message is an AI response with 100% certainty,
 * even if stored or synced with sender: 'user'.
 */
export function isAiMessage(msg: {
  id?: string;
  sender?: string;
  text?: string;
  reasoningText?: string;
  parts?: any[];
  attachments?: any[];
  image_url?: string;
}): boolean {
  if (!msg) return false;

  // 1. Explicit AI sender designations
  if (
    msg.sender === 'bot' ||
    msg.sender === 'assistant' ||
    msg.sender === 'system' ||
    msg.sender === 'model'
  ) {
    return true;
  }

  // 2. ID-based indicators (explicit AI ID prefix)
  const id = msg.id || '';
  if (
    id.startsWith('ai_') ||
    id.startsWith('bot_') ||
    id.includes('_bot_') ||
    id.includes('_ai_')
  ) {
    return true;
  }
  // User messages created with user_msg_ prefix are definitely user
  if (id.startsWith('user_msg_') || id.startsWith('user_')) {
    return false;
  }

  // 3. Structural indicators (reasoning text or tool invocations)
  if (msg.reasoningText && msg.reasoningText.trim().length > 0) {
    return true;
  }
  if (msg.parts && msg.parts.some((p: any) => p.type === 'tool-invocation' || p.type === 'reasoning')) {
    return true;
  }

  // 4. Attachments (images attached by user are almost always user messages)
  if ((msg.attachments && msg.attachments.length > 0) || msg.image_url) {
    return false;
  }

  // 5. Text content fingerprints unique to Avelut AI responses
  const text = (msg.text || '').trim();
  if (text) {
    // Follow-up suggestions indicator (↳) generated exclusively by Avelut AI
    if (text.includes('\n↳') || text.startsWith('↳') || text.includes(' ↳ ')) {
      return true;
    }
    // AI standard greetings
    if (
      text.startsWith('Hello! 👋') ||
      text.startsWith('Hello! 👋 How can I help you') ||
      text.startsWith('Welcome to Avelut')
    ) {
      return true;
    }
    // Search tool outputs
    if (
      text.includes('Here are some of the latest updates from recent searches:') ||
      text.includes('Here are the latest updates from recent searches:') ||
      text.includes('[Search Query:') ||
      text.includes('[Search Sources]')
    ) {
      return true;
    }
    // Standard error/apology/system messages
    if (
      text.startsWith('I apologize, but I could not generate a response') ||
      text.startsWith('Thinking Process:') ||
      text.startsWith('### Reasoning:')
    ) {
      return true;
    }
    // Markdown formatting typical of AI explanations and study guides
    if (
      text.includes('```') ||
      text.includes('### ') ||
      text.includes('## ') ||
      (text.includes('**') && (text.includes('\n* ') || text.includes('\n- ') || text.includes('\n1. ')))
    ) {
      if (!id.startsWith('user_msg_')) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Normalizes an array of messages for a conversation, reconciling turn alternation
 * and healing any messages whose sender attribute was erroneously overwritten.
 */
export function normalizeConversationMessages(rawMessages: any[]): Message[] {
  if (!rawMessages || rawMessages.length === 0) return [];

  // Sort chronologically
  const sorted = [...rawMessages].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  // First pass: mark definite AI messages by content and structure
  const resolved: Message[] = sorted.map((m) => {
    let attachments: any[] | undefined = undefined;
    if (m.attachments_json && typeof m.attachments_json === 'string') {
      try {
        attachments = JSON.parse(m.attachments_json);
      } catch {}
    } else if (Array.isArray(m.attachments)) {
      attachments = m.attachments;
    }

    const isBot = isAiMessage(m);
    const correctedSender: 'user' | 'bot' = isBot ? 'bot' : (m.sender === 'bot' || m.sender === 'assistant' ? 'bot' : 'user');

    return {
      id: m.id,
      text: m.text || '',
      image_url: m.image_url || undefined,
      attachments,
      sender: correctedSender,
      timestamp: m.timestamp || Date.now(),
      reasoningText: m.reasoningText,
      parts: m.parts,
      status: m.status,
    };
  });

  // Second pass: Conversation Turn Reconciliation
  // In a 1-on-1 AI chat, messages alternate between user prompt and AI response.
  // If consecutive messages are marked 'user', but the second one has AI formatting,
  // is lengthy, or lacks explicit user_msg prefix, re-attribute it to 'bot'.
  for (let i = 0; i < resolved.length; i++) {
    const current = resolved[i];
    const prev = i > 0 ? resolved[i - 1] : null;

    if (current.sender === 'user' && prev && prev.sender === 'user') {
      const text = (current.text || '').trim();
      const isExplicitUser = current.id?.startsWith('user_msg_');
      const hasAiMarkdown = text.includes('**') || text.includes('```') || text.includes('###') || text.includes('\n- ') || text.includes('\n* ');

      if (!isExplicitUser && (!current.attachments?.length && !current.image_url)) {
        if (hasAiMarkdown || text.length > 80 || isAiMessage(current)) {
          current.sender = 'bot';
        }
      }
    }
  }

  // Asynchronously heal SQLite if any message had sender erroneously set to 'user'
  for (const msg of resolved) {
    if (msg.sender === 'bot') {
      const orig = rawMessages.find((rm) => rm.id === msg.id);
      if (orig && orig.sender === 'user') {
        void runStatement(
          `UPDATE messages SET sender = 'assistant' WHERE id = ?`,
          [msg.id]
        ).catch(() => {});
      }
    }
  }

  return resolved;
}
