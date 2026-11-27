import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import {
  getPendingSyncQueue,
  removeSyncQueueItem,
  updateSyncQueueError,
  markConversationSynced,
  markMessageSynced,
} from './chatStorageService';

export type CloudSyncStatus = 'synced' | 'syncing' | 'offline' | 'pending' | 'error';

type SyncListener = (status: CloudSyncStatus, pendingCount: number) => void;

function toDeterministicUUID(str: string): string {
  if (!str) return '00000000-0000-0000-0000-000000000000';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    return str;
  }
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ ch, 2246822507);
    h4 = Math.imul(h4 ^ ch, 3266489909);
  }
  const hex = [
    (h1 >>> 0).toString(16).padStart(8, '0'),
    (h2 >>> 0).toString(16).padStart(8, '0'),
    (h3 >>> 0).toString(16).padStart(8, '0'),
    (h4 >>> 0).toString(16).padStart(8, '0')
  ].join('');
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-4${hex.substring(13, 16)}-a${hex.substring(17, 20)}-${hex.substring(20, 32)}`;
}

class CloudSyncEngine {
  private status: CloudSyncStatus = 'synced';
  private listeners: Set<SyncListener> = new Set();
  private isSyncing = false;
  private syncIntervalId: any = null;
  private currentUserId: string | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[CloudSync] Network online detected. Triggering sync...');
        this.triggerSync();
      });

      window.addEventListener('offline', () => {
        console.log('[CloudSync] Network offline detected.');
        this.updateStatus('offline', 0);
      });
    }
  }

  /**
   * Start background sync engine. AI conversations live only in local SQLite;
   * only generic app state (e.g. profile) is synced remotely.
   */
  public start(userId: string): void {
    if (!userId) return;
    this.currentUserId = userId;

    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
    }

    void this.triggerSync();

    this.syncIntervalId = setInterval(() => {
      if (this.isOnline()) {
        void this.triggerSync();
      }
    }, 60000);
  }

  /**
   * Stop background sync engine.
   */
  public stop(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    this.currentUserId = null;
    this.updateStatus('synced', 0);
  }

  public isOnline(): boolean {
    if (typeof window === 'undefined') return true;
    return window.navigator.onLine !== false;
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.status, 0);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateStatus(newStatus: CloudSyncStatus, pendingCount: number = 0): void {
    this.status = newStatus;
    this.listeners.forEach(cb => {
      try {
        cb(newStatus, pendingCount);
      } catch (err) {
        console.error('[CloudSync] Listener notification error:', err);
      }
    });
  }

  /**
   * Main sync workflow: settle local AI chat queue items and sync generic app state.
   */
  public async triggerSync(): Promise<void> {
    if (this.isSyncing) return;
    if (!this.isOnline() || !isSupabaseConfigured) {
      const queue = await getPendingSyncQueue();
      this.updateStatus(this.isOnline() ? 'synced' : 'offline', queue.length);
      return;
    }

    try {
      this.isSyncing = true;
      const pendingItems = await getPendingSyncQueue();

      if (pendingItems.length > 0) {
        this.updateStatus('syncing', pendingItems.length);
        await this.processOutgoingSyncQueue(pendingItems);
      }

      const remainingQueue = await getPendingSyncQueue();
      if (remainingQueue.length > 0) {
        this.updateStatus('pending', remainingQueue.length);
      } else {
        this.updateStatus('synced', 0);
      }
    } catch (error) {
      console.error('[CloudSync] Sync cycle encountered an error:', error);
      this.updateStatus('error', 0);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Process queued local mutations. AI chat rows are settled locally; only
   * app_state is pushed to Supabase.
   */
  private async processOutgoingSyncQueue(pendingItems: any[]): Promise<void> {
    for (const item of pendingItems) {
      try {
        const payload = item.payload_json ? JSON.parse(item.payload_json) : {};

        switch (item.entity_type) {
          case 'conversation': {
            // AI tutor conversations are local-only SQLite data. There is no
            // remote messenger table to sync to; just settle the local queue.
            await markConversationSynced(item.entity_id);
            break;
          }

          case 'message': {
            // AI tutor messages are local-only SQLite data. Mark them synced
            // locally so the UI does not leave them stuck in "pending".
            await markMessageSynced(item.entity_id);
            break;
          }

          case 'app_state': {
            const userId = payload.userId || this.currentUserId;
            if (userId && payload.key === 'profile') {
              await supabase
                .from('profiles')
                .upsert({
                  id: toDeterministicUUID(userId),
                  ...payload.payload,
                  updated_at: new Date().toISOString(),
                });
            }
            break;
          }
        }

        // Successfully synced item, remove from queue
        await removeSyncQueueItem(item.id);
      } catch (err: any) {
        console.warn(`[CloudSync] Failed to sync queue item ${item.id}:`, err);
        await updateSyncQueueError(item.id, err.message || 'Network error');
      }
    }
  }

  /**
   * Retained for hooks/useChatStorage.ts compatibility. AI tutor conversations
   * are stored only in local SQLite (no remote messenger tables remain), so
   * this is intentionally a safe no-op. Local reads still work unchanged.
   */
  public async pullMessagesForConversation(_conversationId: string, _userId: string): Promise<void> {
    return;
  }
}

export const cloudSyncEngine = new CloudSyncEngine();
export default cloudSyncEngine;
