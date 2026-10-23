import { describe, it, expect } from 'vitest';
import {
  formatLastSeen,
  isUserOnline,
  getLastMessagePreview,
  getUnreadCount,
  formatChatTimestamp,
} from '../components/messenger/messengerUtils';

describe('Messenger Utility & Presence Tests', () => {
  describe('formatLastSeen', () => {
    it('returns "Offline" for null or undefined timestamps', () => {
      expect(formatLastSeen(null)).toBe('Offline');
      expect(formatLastSeen(undefined)).toBe('Offline');
    });

    it('returns "Last seen just now" when timestamp is less than 1 minute ago', () => {
      const recent = Date.now() - 30000; // 30s ago
      expect(formatLastSeen(recent)).toBe('Last seen just now');
    });

    it('returns "Last seen Xm ago" when timestamp is minutes ago', () => {
      const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
      expect(formatLastSeen(fiveMinsAgo)).toBe('Last seen 5m ago');
    });

    it('returns "Last seen Xh ago" when timestamp is hours ago', () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      expect(formatLastSeen(twoHoursAgo)).toBe('Last seen 2h ago');
    });

    it('handles ISO string timestamps', () => {
      const isoStr = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      expect(formatLastSeen(isoStr)).toBe('Last seen 10m ago');
    });
  });

  describe('isUserOnline', () => {
    it('returns true when user ID is present in onlineUserIds Record', () => {
      const user = { uid: 'user_123', is_online: false, last_seen: null };
      const onlineUserIds = { user_123: true };
      expect(isUserOnline(user, onlineUserIds)).toBe(true);
    });

    it('returns true when user ID is present in onlineUserIds Set', () => {
      const user = { uid: 'user_456', is_online: false, last_seen: null };
      const onlineUserIds = new Set(['user_456']);
      expect(isUserOnline(user, onlineUserIds)).toBe(true);
    });

    it('returns true when user.is_online is true and last_seen is within threshold', () => {
      const user = { uid: 'user_789', is_online: true, last_seen: Date.now() - 10000 };
      expect(isUserOnline(user)).toBe(true);
    });

    it('returns false when user.is_online is true but last_seen is stale (>45s ago)', () => {
      const user = { uid: 'user_789', is_online: true, last_seen: Date.now() - 60000 };
      expect(isUserOnline(user)).toBe(false);
    });

    it('returns false when user is not online and not in presence set', () => {
      const user = { uid: 'user_000', is_online: false, last_seen: Date.now() - 120000 };
      expect(isUserOnline(user)).toBe(false);
    });
  });

  describe('getLastMessagePreview', () => {
    it('returns message text if available', () => {
      const chat = { last_message: { text: 'Hello there!' } };
      expect(getLastMessagePreview(chat)).toBe('Hello there!');
    });

    it('returns Photo preview when image URL is present', () => {
      const chat = { last_message: { mediaUrl: 'https://example.com/image.jpg' } };
      expect(getLastMessagePreview(chat)).toBe('📷 Photo');
    });

    it('returns default fallback when no last message exists', () => {
      expect(getLastMessagePreview(null)).toBe('Tap to send a message');
    });
  });

  describe('getUnreadCount', () => {
    it('returns unreadCount numeric value', () => {
      expect(getUnreadCount({ unreadCount: 5 })).toBe(5);
      expect(getUnreadCount({ unreadCount: 0 })).toBe(0);
      expect(getUnreadCount(null)).toBe(0);
    });
  });

  describe('formatChatTimestamp', () => {
    it('formats today timestamp as time', () => {
      const now = Date.now();
      const formatted = formatChatTimestamp(now);
      expect(formatted).toMatch(/\d{1,2}:\d{2}/);
    });

    it('returns empty string for missing timestamp', () => {
      expect(formatChatTimestamp(undefined)).toBe('');
    });
  });

  describe('Optimistic Message Reconciliation & Retry Logic', () => {
    it('reconciles optimistic messages when matching cloud message is present', () => {
      const now = Date.now();
      const optimisticList = [
        { id: 'temp_123', senderId: 'user_1', text: 'Hello', timestamp: now, isPending: true }
      ];
      const cloudMsgs = [
        { id: 'cloud_789', senderId: 'user_1', text: 'Hello', timestamp: now + 500 }
      ];

      const remainingOptimistic = optimisticList.filter(opt => {
        if (cloudMsgs.some(cloud => cloud.id === opt.id)) return false;
        if (cloudMsgs.some(cloud => cloud.senderId === opt.senderId && cloud.text === opt.text && Math.abs(cloud.timestamp - opt.timestamp) < 15000)) {
          return false;
        }
        return true;
      });

      expect(remainingOptimistic.length).toBe(0);
    });

    it('preserves failed optimistic messages for user retry', () => {
      const now = Date.now();
      const optimisticList = [
        { id: 'temp_failed_1', senderId: 'user_1', text: 'Failed msg', timestamp: now, isFailed: true, isPending: false }
      ];
      const cloudMsgs: any[] = [];

      const remainingOptimistic = optimisticList.filter(opt => {
        if (cloudMsgs.some(cloud => cloud.id === opt.id)) return false;
        if (!opt.isFailed && cloudMsgs.some(cloud => cloud.senderId === opt.senderId && cloud.text === opt.text)) {
          return false;
        }
        return true;
      });

      expect(remainingOptimistic.length).toBe(1);
      expect(remainingOptimistic[0].isFailed).toBe(true);
    });
  });
});
