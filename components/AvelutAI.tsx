import { db, off, onValue, ref as dbRef } from '@/lib/backend';
import React, { useEffect } from 'react';
import type { UserProfile, ChatConversation } from '../types';
import { Chat } from './Chat';
import { getLocalConversations } from '../services/chatStorageService';

interface AvelutAIProps {
  userProfile: UserProfile;
  onNavigate?: (tab: string) => void;
  setCustomHeaderConfig?: (config: any) => void;
  unreadMessagesCount?: number;
  onConversationsUpdate?: (conversations: ChatConversation[]) => void;
  onOpenMenu?: () => void;
  activeConversationId?: string | null;
  onSelectConversation?: (id: string | null) => void;
}

/** Avelut AI chat shell — uses unified Grok-style Chat component */
export default function AvelutAI({
  userProfile,
  onNavigate,
  setCustomHeaderConfig,
  unreadMessagesCount = 0,
  onConversationsUpdate,
  onOpenMenu,
  activeConversationId,
  onSelectConversation,
}: AvelutAIProps) {
  useEffect(() => {
    if (!userProfile?.uid || !onConversationsUpdate) return;
    let isMounted = true;

    // Load purely from local storage / SQLite on user device
    getLocalConversations(userProfile.uid)
      .then((local) => {
        if (isMounted) {
          onConversationsUpdate(
            (local || []).map((c) => ({
              id: c.id,
              user_id: c.user_id || userProfile.uid,
              title: c.title || 'New Chat',
              created_at: c.created_at || 0,
              last_updated_at: c.last_updated_at || c.created_at || 0,
            }))
          );
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [userProfile?.uid, onConversationsUpdate]);

  return (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden bg-white dark:bg-black">
      <Chat
        userProfile={userProfile}
        onNavigate={onNavigate}
        onOpenMenu={onOpenMenu}
        setCustomHeaderConfig={setCustomHeaderConfig}
        activeConversationId={activeConversationId}
        onSelectConversation={onSelectConversation}
      />
    </div>
  );
}
