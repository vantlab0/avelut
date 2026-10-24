import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { NavItem, UserProfile, ChatConversation } from '../types';
import { navigationItems, adminNavigationItems } from '../constants';
import { Avatar } from './Avatar';
import { VerificationBadge } from './VerificationBadge';
import { useToast } from '../hooks/useToast';
import { deleteLocalConversation, getLocalMessages, renameLocalConversation } from '../services/chatStorageService';
import { Capacitor } from '@capacitor/core';
import { Pin, Pencil, FolderPlus, Archive, Trash2, ChevronRight, X } from 'lucide-react';
import { db, ref, remove } from '../lib/backend';

export interface SidebarProps {
  activeItem: string;
  onItemClick: (id: string) => void;
  userProfile: UserProfile | null;
  onLogout: () => void;
  isMobileSidebarOpen: boolean;
  onCloseMobileSidebar: () => void;
  items?: NavItem[];
  secondaryItems?: NavItem[];
  unreadCount?: number;
  unreadMessagesCount?: number;
  recentConversations?: ChatConversation[];
  onSelectConversation?: (id: string) => void;
  onNewChat?: () => void;
  onDeleteConversation?: (id: string) => void;
  onPinConversation?: (id: string, isPinned: boolean) => void;
  activeConversationId?: string | null;
  quickLinks?: NavItem[];
  brandTitle?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  overlayRef?: React.RefObject<HTMLDivElement | null>;
  sidebarRef?: React.RefObject<HTMLElement | null>;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

const PINNED_STORAGE_PREFIX = 'avelut_pinned_chats_';

const getStoredPinnedIds = (userId?: string): Set<string> => {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(`${PINNED_STORAGE_PREFIX}${userId || 'anon'}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
};

const saveStoredPinnedIds = (pinnedIds: Set<string>, userId?: string) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      `${PINNED_STORAGE_PREFIX}${userId || 'anon'}`,
      JSON.stringify(Array.from(pinnedIds))
    );
  } catch (err) {
    console.warn('[Sidebar] Failed to save pinned chats:', err);
  }
};

const timeAgo = (timestamp: number): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/**
 * Quick-access navigation button — Grok-style stacked cards
 * Full-width rounded rectangles, larger type, light/dark adaptive
 */
const LinkRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  badge?: number;
  badgeLabel?: string;
}> = ({ icon, label, active, onClick, badge, badgeLabel }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full flex items-center gap-3.5 px-4 py-3.5 sm:py-4 text-left transition-colors cursor-pointer select-none group relative ${
      active
        ? 'bg-neutral-100 dark:bg-[#1C1C1C] text-neutral-900 dark:text-white font-medium'
        : 'bg-transparent text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-[#1a1a1a]'
    }`}
  >
    <span
      className={`flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center transition-colors [&>svg]:w-6 [&>svg]:h-6 sm:[&>svg]:w-6.5 sm:[&>svg]:h-6.5 ${
        active
          ? 'text-neutral-900 dark:text-white'
          : 'text-neutral-600 dark:text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white'
      }`}
    >
      {icon}
    </span>
    <span className="text-[17px] sm:text-[18px] truncate flex-1 tracking-tight font-semibold leading-none">
      {label}
    </span>
    {badgeLabel ? (
      <span className="flex-shrink-0 bg-[#E8F0FE] dark:bg-[#1e3a5f]/60 text-[#1a73e8] dark:text-[#8ab4f8] text-[12px] font-semibold px-2.5 py-0.5 rounded-full leading-none">
        {badgeLabel}
      </span>
    ) : badge != null && badge > 0 ? (
      <span className="bg-[#0066FF] text-white text-[11px] font-bold rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center">
        {badge > 99 ? '99+' : badge}
      </span>
    ) : null}
  </button>
);

interface ActiveMenuState {
  convo: ChatConversation;
  isPinned: boolean;
  anchorY?: number;
  anchorX?: number;
}

/**
 * Responsive Options Context Menu:
 * Floating rounded card with 20px border radius, dark charcoal background (#262626), elevated drop shadow, padding 10px. Width around 230px.
 */
const ChatContextMenu: React.FC<{
  menuState: ActiveMenuState;
  onClose: () => void;
  onTogglePin: (convoId: string) => void;
  onRename: (convo: ChatConversation) => void;
  onAddToProject: (convo: ChatConversation) => void;
  onArchive: (convo: ChatConversation) => void;
  onRequestDelete: (convo: ChatConversation) => void;
}> = ({ menuState, onClose, onTogglePin, onRename, onAddToProject, onArchive, onRequestDelete }) => {
  const { convo, isPinned, anchorY = 200, anchorX = 200 } = menuState;
  const menuRef = useRef<HTMLDivElement>(null);

  // Dismiss on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Compute popover position:
  // Around 200px width, ~210px height. Anchor intelligently near touch/click coordinates without viewport overflow.
  const popoverStyle = useMemo<React.CSSProperties>(() => {
    const menuWidth = 200;
    const menuHeight = 210;

    // Position near the touch/cursor point
    let left = anchorX > 160 ? anchorX - 160 : anchorX + 10;
    // Bound within viewport horizontally
    if (left + menuWidth > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - menuWidth - 12);
    }
    if (left < 12) left = 12;

    // Bound vertically
    let top = anchorY - 20;
    if (top + menuHeight > window.innerHeight - 16) {
      top = Math.max(16, window.innerHeight - menuHeight - 16);
    }
    if (top < 16) top = 16;

    return {
      top: `${top}px`,
      left: `${left}px`,
    };
  }, [anchorY, anchorX]);

  return (
    <div
      className="fixed inset-0 z-[160] select-none bg-transparent"
      onClick={onClose}
    >
      {/* Click-away backdrop */}
      <div className="fixed inset-0 z-[160]" onClick={onClose} aria-hidden="true" />

      {/* Container: Floating rounded card with 20px border radius, dark charcoal background (#262626), elevated drop shadow, padding 6px. Width around 200px. */}
      <div
        ref={menuRef}
        onClick={(e) => e.stopPropagation()}
        style={popoverStyle}
        className="z-[161] absolute w-[200px] rounded-[20px] p-[6px] bg-[#262626] border border-white/5 shadow-2xl shadow-black/80 transition-all animate-in fade-in zoom-in-95 duration-150 flex flex-col gap-0.5 text-left font-sans select-none"
      >
        {/* 1. Pin (pushpin outline icon) */}
        <button
          type="button"
          onClick={() => {
            onTogglePin(convo.id);
            onClose();
          }}
          className="w-full flex items-center gap-[10px] px-2.5 py-2 rounded-[12px] text-left text-[13.5px] font-medium text-[#ededed] transition-colors duration-150 hover:bg-white/10 active:bg-white/15 cursor-pointer"
        >
          <Pin className="w-4 h-4 shrink-0 text-[#ededed]" />
          <span className="truncate">{isPinned ? 'Unpin' : 'Pin'}</span>
        </button>

        {/* 2. Rename (pencil outline icon) */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onRename(convo);
          }}
          className="w-full flex items-center gap-[10px] px-2.5 py-2 rounded-[12px] text-left text-[13.5px] font-medium text-[#ededed] transition-colors duration-150 hover:bg-white/10 active:bg-white/15 cursor-pointer"
        >
          <Pencil className="w-4 h-4 shrink-0 text-[#ededed]" />
          <span className="truncate">Rename</span>
        </button>

        {/* 3. Add to project (folder-plus outline icon) */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onAddToProject(convo);
          }}
          className="w-full flex items-center gap-[10px] px-2.5 py-2 rounded-[12px] text-left text-[13.5px] font-medium text-[#ededed] transition-colors duration-150 hover:bg-white/10 active:bg-white/15 cursor-pointer"
        >
          <FolderPlus className="w-4 h-4 shrink-0 text-[#ededed]" />
          <span className="truncate">Add to project</span>
          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[#ededed] ml-auto" />
        </button>

        {/* 4. Archive (archive box outline icon) */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onArchive(convo);
          }}
          className="w-full flex items-center gap-[10px] px-2.5 py-2 rounded-[12px] text-left text-[13.5px] font-medium text-[#ededed] transition-colors duration-150 hover:bg-white/10 active:bg-white/15 cursor-pointer"
        >
          <Archive className="w-4 h-4 shrink-0 text-[#ededed]" />
          <span className="truncate">Archive</span>
        </button>

        {/* 5. Delete (trash can outline icon) */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onRequestDelete(convo);
          }}
          className="w-full flex items-center gap-[10px] px-2.5 py-2 rounded-[12px] text-left text-[13.5px] font-medium text-[#f87171] transition-colors duration-150 hover:bg-[#f87171]/10 active:bg-[#f87171]/20 cursor-pointer"
        >
          <Trash2 className="w-4 h-4 shrink-0 text-[#f87171]" />
          <span className="truncate">Delete</span>
        </button>
      </div>
    </div>
  );
};

const ConversationRow: React.FC<{
  convo: ChatConversation;
  isActive: boolean;
  isPinned: boolean;
  onSelect: () => void;
  onOpenContextMenu: (coords: { x: number; y: number }, convo: ChatConversation) => void;
}> = ({ convo, isActive, isPinned, onSelect, onOpenContextMenu }) => {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const didLongPressRef = useRef<boolean>(false);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    didLongPressRef.current = false;
    const touch = e.touches[0];
    startPosRef.current = { x: touch.clientX, y: touch.clientY };

    timerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(40);
        }
      } catch {}
      onOpenContextMenu({ x: touch.clientX, y: touch.clientY }, convo);
    }, 450);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!timerRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - startPosRef.current.x);
    const dy = Math.abs(touch.clientY - startPosRef.current.y);
    if (dx > 10 || dy > 10) {
      clearTimer();
    }
  };

  const handleTouchEnd = () => {
    clearTimer();
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    didLongPressRef.current = false;
    startPosRef.current = { x: e.clientX, y: e.clientY };

    timerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      onOpenContextMenu({ x: e.clientX, y: e.clientY }, convo);
    }, 450);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timerRef.current) return;
    const dx = Math.abs(e.clientX - startPosRef.current.x);
    const dy = Math.abs(e.clientY - startPosRef.current.y);
    if (dx > 10 || dy > 10) {
      clearTimer();
    }
  };

  const handleMouseUp = () => {
    clearTimer();
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    clearTimer();
    onOpenContextMenu({ x: e.clientX, y: e.clientY }, convo);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (didLongPressRef.current) {
      didLongPressRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onSelect();
  };

  return (
    <div
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className={`w-full group relative flex items-center justify-between px-3 py-2 rounded-xl text-left transition-all duration-150 cursor-pointer select-none [-webkit-touch-callout:none] active:scale-[0.99] animate-in fade-in duration-150 ${
        isActive
          ? 'bg-neutral-200 dark:bg-[#1C1C1C] text-neutral-900 dark:text-white font-medium shadow-xs'
          : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/5'
      }`}
    >
      <div className="flex-1 min-w-0 pr-1">
        <div className="flex items-center gap-1.5">
          {isPinned && (
            <Pin className="w-4 h-4 text-[#0066FF] dark:text-[#38BDF8] shrink-0" />
          )}
          <span className="block text-[15px] sm:text-base truncate leading-snug font-semibold">
            {convo.title || 'New Chat'}
          </span>
        </div>
        <span className="block text-xs sm:text-[13px] text-neutral-500 dark:text-neutral-400 mt-0.5">
          {timeAgo(convo.last_updated_at)}
        </span>
      </div>
    </div>
  );
};

const SidebarPanel: React.FC<{
  activeItem: string;
  onItemClick: (id: string) => void;
  userProfile: UserProfile | null;
  navItems: NavItem[];
  quickLinks?: NavItem[];
  recentConversations?: ChatConversation[];
  onSelectConversation?: (id: string) => void;
  onNewChat?: () => void;
  onDeleteConversation?: (id: string) => void;
  onPinConversation?: (id: string, isPinned: boolean) => void;
  activeConversationId?: string | null;
  unreadMessagesCount: number;
  brandTitle: string;
  onClose?: () => void;
}> = ({
  activeItem,
  onItemClick,
  userProfile,
  navItems,
  quickLinks,
  recentConversations,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  onPinConversation,
  activeConversationId,
  unreadMessagesCount,
  brandTitle,
  onClose,
}) => {
  const { addToast } = useToast();
  const links = quickLinks && quickLinks.length > 0 ? quickLinks : navItems;
  const showRecents = activeItem === 'chat' && Array.isArray(recentConversations);

  // Pinned state persistence
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() =>
    getStoredPinnedIds(userProfile?.uid)
  );
  const [isPinnedCollapsed, setIsPinnedCollapsed] = useState<boolean>(false);

  // Sync pinned ids when user profile changes
  useEffect(() => {
    setPinnedIds(getStoredPinnedIds(userProfile?.uid));
  }, [userProfile?.uid]);

  // Context menu state & modal confirmation states
  const [activeMenu, setActiveMenu] = useState<ActiveMenuState | null>(null);
  const [convoToDelete, setConvoToDelete] = useState<ChatConversation | null>(null);
  const [convoToRename, setConvoToRename] = useState<ChatConversation | null>(null);
  const [renameTitle, setRenameTitle] = useState('');

  // Archived chats persistence
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem(`avelut_archived_chats_${userProfile?.uid || 'anon'}`);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  });

  // Add to project modal state
  const [convoToAddToProject, setConvoToAddToProject] = useState<ChatConversation | null>(null);
  const [projectNameInput, setProjectNameInput] = useState('');
  const [savedProjects, setSavedProjects] = useState<string[]>(() => {
    if (typeof window === 'undefined') return ['Computer Science', 'Semester 1', 'Exam Prep'];
    try {
      const raw = localStorage.getItem(`avelut_chat_projects_${userProfile?.uid || 'anon'}`);
      return raw ? JSON.parse(raw) : ['Computer Science', 'Semester 1', 'Exam Prep'];
    } catch {
      return ['Computer Science', 'Semester 1', 'Exam Prep'];
    }
  });

  const handleArchiveChat = useCallback(
    (convo: ChatConversation) => {
      setArchivedIds((prev) => {
        const next = new Set(prev);
        const willArchive = !next.has(convo.id);
        if (willArchive) {
          next.add(convo.id);
          addToast(`"${convo.title || 'Chat'}" moved to archive`, 'info');
        } else {
          next.delete(convo.id);
          addToast('Chat unarchived', 'info');
        }
        try {
          localStorage.setItem(
            `avelut_archived_chats_${userProfile?.uid || 'anon'}`,
            JSON.stringify(Array.from(next))
          );
        } catch {}
        return next;
      });
    },
    [userProfile?.uid, addToast]
  );

  const handleSaveToProject = useCallback(
    (targetProject: string) => {
      if (!convoToAddToProject) return;
      const trimmed = targetProject.trim();
      if (!trimmed) {
        addToast('Please enter or select a project name.', 'warning');
        return;
      }
      try {
        if (!savedProjects.includes(trimmed)) {
          const updated = [...savedProjects, trimmed];
          setSavedProjects(updated);
          localStorage.setItem(
            `avelut_chat_projects_${userProfile?.uid || 'anon'}`,
            JSON.stringify(updated)
          );
        }
        const mappingRaw = localStorage.getItem(`avelut_chat_project_mapping_${userProfile?.uid || 'anon'}`);
        const mapping = mappingRaw ? JSON.parse(mappingRaw) : {};
        mapping[convoToAddToProject.id] = trimmed;
        localStorage.setItem(
          `avelut_chat_project_mapping_${userProfile?.uid || 'anon'}`,
          JSON.stringify(mapping)
        );
        addToast(`Added "${convoToAddToProject.title || 'Chat'}" to "${trimmed}"`, 'success');
        setConvoToAddToProject(null);
        setProjectNameInput('');
      } catch (err) {
        console.error('Failed to add to project:', err);
        addToast('Failed to add to project', 'error');
      }
    },
    [convoToAddToProject, savedProjects, userProfile?.uid, addToast]
  );

  const handleSaveRename = useCallback(async () => {
    if (!convoToRename) return;
    const trimmed = renameTitle.trim();
    if (!trimmed) {
      addToast('Please enter a chat title.', 'warning');
      return;
    }
    try {
      const uid = userProfile?.uid || 'anon';
      await renameLocalConversation(convoToRename.id, trimmed, uid);
      convoToRename.title = trimmed;
      addToast('Chat renamed', 'success');
      setConvoToRename(null);
    } catch (err) {
      console.error('[Sidebar] Failed to rename chat:', err);
      addToast('Failed to rename chat.', 'error');
    }
  }, [convoToRename, renameTitle, userProfile?.uid, addToast]);

  const togglePinChat = useCallback(
    (convoId: string) => {
      setPinnedIds((prev) => {
        const next = new Set<string>(prev);
        const willPin = !next.has(convoId);
        if (willPin) {
          next.add(convoId);
          addToast('Chat pinned to top', 'success');
        } else {
          next.delete(convoId);
          addToast('Chat unpinned', 'info');
        }
        saveStoredPinnedIds(next, userProfile?.uid);
        onPinConversation?.(convoId, willPin);
        return next;
      });
    },
    [userProfile?.uid, onPinConversation, addToast]
  );

  const handleShareChat = useCallback(
    async (convo: ChatConversation) => {
      try {
        const uid = userProfile?.uid || 'anon';
        const messages = await getLocalMessages(convo.id);
        const transcript = messages
          .filter((m) => m.sender !== 'system')
          .map((m) => `${m.sender === 'user' ? '👤 Student' : '🤖 Avelut'}:\n${m.text}`)
          .join('\n\n');

        const sharePayload = {
          title: convo.title || 'Avelut AI Chat',
          text: transcript ? `Chat: ${convo.title}\n\n${transcript}` : `Avelut Chat: ${convo.title}`,
          dialogTitle: 'Share Chat',
        };

        if (Capacitor.isNativePlatform()) {
          try {
            const { Share } = await import('@capacitor/share');
            await Share.share(sharePayload);
            addToast('Shared successfully!', 'success');
            return;
          } catch (capErr: any) {
            if (capErr?.message?.includes('canceled') || capErr?.message?.includes('closed')) return;
          }
        }

        if (typeof navigator !== 'undefined' && navigator.share) {
          try {
            await navigator.share(sharePayload);
            addToast('Shared successfully!', 'success');
            return;
          } catch (navErr: any) {
            if (navErr?.name === 'AbortError') return;
          }
        }

        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(sharePayload.text);
          addToast('Chat transcript copied to clipboard!', 'info');
        }
      } catch (err) {
        console.error('[Sidebar] Share chat error:', err);
        addToast('Could not share chat.', 'error');
      }
    },
    [userProfile?.uid, addToast]
  );

  const handleForwardChat = useCallback(
    async (convo: ChatConversation) => {
      try {
        const uid = userProfile?.uid || 'anon';
        const messages = await getLocalMessages(convo.id);
        const excerpt = messages
          .slice(-3)
          .map((m) => `${m.sender === 'user' ? 'Me' : 'Avelut'}: ${m.text.slice(0, 100)}`)
          .join('\n');

        const forwardPackage = {
          type: 'chat_forward',
          conversationId: convo.id,
          title: convo.title,
          excerpt,
          timestamp: Date.now(),
        };

        localStorage.setItem('pending_forward_chat', JSON.stringify(forwardPackage));
        addToast('Chat prepared. Select a partner to forward to!', 'info');
        onItemClick('messenger');
      } catch (err) {
        console.error('[Sidebar] Forward chat error:', err);
        addToast('Could not prepare chat forward.', 'error');
      }
    },
    [userProfile?.uid, onItemClick, addToast]
  );

  const handleDeleteChat = useCallback(
    async (convoId: string) => {
      try {
        const uid = userProfile?.uid || 'anon';
        await deleteLocalConversation(convoId, uid);
        if (userProfile?.uid) {
          remove(ref(db, `chat_conversations/${userProfile.uid}/${convoId}`)).catch(console.error);
          remove(ref(db, `chat_messages/${convoId}`)).catch(console.error);
        }
        setPinnedIds((prev) => {
          if (!prev.has(convoId)) return prev;
          const next = new Set<string>(prev);
          next.delete(convoId);
          saveStoredPinnedIds(next, uid);
          return next;
        });
        if (onDeleteConversation) {
          onDeleteConversation(convoId);
        }
        addToast('Chat deleted', 'info');
      } catch (err) {
        console.error('[Sidebar] Delete conversation error:', err);
        addToast('Failed to delete chat.', 'error');
      }
    },
    [userProfile?.uid, onDeleteConversation, addToast]
  );

  const handleOpenContextMenu = useCallback(
    (coords: { x: number; y: number }, convo: ChatConversation) => {
      setActiveMenu({
        convo,
        isPinned: pinnedIds.has(convo.id),
        anchorY: coords.y,
        anchorX: coords.x,
      });
    },
    [pinnedIds]
  );

  // Divide conversations into Pinned and Recents (excluding archived chats)
  const { pinnedConversations, unpinnedConversations } = useMemo(() => {
    if (!recentConversations || !Array.isArray(recentConversations)) {
      return { pinnedConversations: [], unpinnedConversations: [] };
    }
    const pinned: ChatConversation[] = [];
    const unpinned: ChatConversation[] = [];
    recentConversations.forEach((c) => {
      if (archivedIds.has(c.id)) return;
      if (pinnedIds.has(c.id)) {
        pinned.push(c);
      } else {
        unpinned.push(c);
      }
    });
    return { pinnedConversations: pinned, unpinnedConversations: unpinned };
  }, [recentConversations, pinnedIds, archivedIds]);

  const extraNavLinks: NavItem[] = [
    {
      id: 'timetable',
      label: 'Calendar',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <rect x="3" y="4" width="18" height="18" rx="3.5" stroke="currentColor" strokeWidth={1.75} />
          <line x1="16" y1="2" x2="16" y2="6" strokeLinecap="round" />
          <line x1="8" y1="2" x2="8" y2="6" strokeLinecap="round" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <circle cx="8" cy="14" r="1" fill="currentColor" />
          <circle cx="12" cy="14" r="1" fill="currentColor" />
          <circle cx="16" cy="14" r="1" fill="currentColor" />
          <circle cx="8" cy="18" r="1" fill="currentColor" />
          <circle cx="12" cy="18" r="1" fill="currentColor" />
        </svg>
      ),
    },
    {
      id: 'leaderboard',
      label: 'Leaderboard',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 003-3V8.25a3 3 0 00-3-3h-9a3 3 0 00-3 3v7.5a3 3 0 003 3m9 0v3.375c0 .621-.504 1.125-1.125 1.125h-6.75A1.125 1.125 0 017.5 22.125V18.75m9 0a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75c0-.231-.035-.454-.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v6.75c0 .621.504 1.125 1.125 1.125H6.75" />
        </svg>
      ),
    },
    {
      id: 'study_partners',
      label: 'Study Partners',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      ),
    },
    {
      id: 'history',
      label: 'Exam History',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
      ),
    },
    {
      id: 'feedback',
      label: 'Feedback',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
      ),
    },
    {
      id: 'help',
      label: 'Help & Support',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 18a.75.75 0 100-1.5.75.75 0 000 1.5z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="h-full flex flex-col bg-white dark:bg-black text-neutral-900 dark:text-white select-none">
      {/* Top Brand Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 flex-shrink-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{brandTitle}</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="w-9 h-9 rounded-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors"
            aria-label="Search"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Close sidebar"
              title="Close sidebar"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Main Navigation — Quick-access cards */}
      <nav className="px-2 flex-shrink-0">
        <div className="bg-white dark:bg-[#111111] border border-neutral-200/80 dark:border-white/10 rounded-2xl overflow-hidden flex flex-col">
          {links.map((item, index) => (
            <React.Fragment key={item.id}>
              <LinkRow
                icon={item.icon}
                label={item.label}
                active={activeItem === item.id}
                onClick={() => onItemClick(item.id)}
                badge={item.id === 'messenger' ? unreadMessagesCount : undefined}
              />
              {index < links.length - 1 && (
                <div className="h-[1px] bg-neutral-200/50 dark:bg-white/5 mx-3" />
              )}
            </React.Fragment>
          ))}
        </div>
      </nav>

      {/* History & Conversations: Pinned + Recents */}
      {showRecents ? (
        <div className="flex-1 min-h-0 flex flex-col mt-4 px-2 overflow-hidden">
          {/* Scrollable conversation container */}
          <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-4 space-y-3">
            {/* 1. Dedicated & Collapsible Pinned Chats Section */}
            {pinnedConversations.length > 0 && (
              <div className="flex-shrink-0 px-1">
                <div className="flex items-center justify-between px-2.5 py-1 mb-1 text-neutral-500 dark:text-neutral-400">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">
                    <svg className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#38BDF8]" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.283.284-.53.5-.664.672C10.553 2.82 10.5 3 10.5 3.5V5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1.077l-1.423 7.115a.5.5 0 0 1-.49.405.5.5 0 0 1-.49-.405L6.577 7H5.5a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h1V3.5c0-.5-.053-.68-.19-.849-.134-.172-.38-.388-.664-.672C4.342 1.174 4 0.68 4 .5a.5.5 0 0 1 .146-.354z"/>
                    </svg>
                    <span>Pinned</span>
                    <span className="text-[10px] bg-neutral-100 dark:bg-white/10 px-1.5 py-0.2 rounded-full font-bold text-neutral-600 dark:text-neutral-300">
                      {pinnedConversations.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPinnedCollapsed((prev) => !prev)}
                    className="p-1 rounded-md hover:bg-neutral-100 dark:hover:bg-white/10 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
                    aria-label={isPinnedCollapsed ? 'Expand pinned chats' : 'Collapse pinned chats'}
                  >
                    <svg
                      className={`w-3.5 h-3.5 transition-transform duration-200 ${
                        isPinnedCollapsed ? '-rotate-90' : 'rotate-0'
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                </div>
                {!isPinnedCollapsed && (
                  <div className="space-y-0.5">
                    {pinnedConversations.map((convo) => (
                      <ConversationRow
                        key={convo.id}
                        convo={convo}
                        isActive={activeConversationId === convo.id}
                        isPinned={true}
                        onSelect={() => onSelectConversation?.(convo.id)}
                        onOpenContextMenu={handleOpenContextMenu}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 2. Recents Section */}
            <div className="flex-shrink-0 px-1">
              <div className="flex items-center justify-between px-2.5 py-1 mb-1">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  <span>Recents</span>
                  {unpinnedConversations.length > 0 && (
                    <span className="text-[10px] bg-neutral-100 dark:bg-white/10 px-1.5 py-0.2 rounded-full font-bold text-neutral-600 dark:text-neutral-300">
                      {unpinnedConversations.length}
                    </span>
                  )}
                </div>
                {onNewChat && (
                  <button
                    type="button"
                    onClick={onNewChat}
                    className="text-[12px] font-semibold text-[#0066FF] dark:text-[#38BDF8] hover:underline cursor-pointer"
                  >
                    New
                  </button>
                )}
              </div>

              <div className="space-y-0.5">
                {unpinnedConversations.length === 0 && pinnedConversations.length === 0 ? (
                  <p className="px-3 py-6 text-[13px] text-neutral-400 text-center">
                    Your history will appear here.
                  </p>
                ) : (
                  unpinnedConversations.map((convo) => (
                    <ConversationRow
                      key={convo.id}
                      convo={convo}
                      isActive={activeConversationId === convo.id}
                      isPinned={false}
                      onSelect={() => onSelectConversation?.(convo.id)}
                      onOpenContextMenu={handleOpenContextMenu}
                    />
                  ))
                )}
              </div>

              {recentConversations && recentConversations.length > 8 && (
                <button
                  type="button"
                  onClick={() => onItemClick('history')}
                  className="w-full text-left px-3 py-2 text-[12px] font-medium text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
                >
                  See all history…
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Standard Navigation for non-chat views */
        <div className="flex-1 min-h-0 flex flex-col mt-4 px-3 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="px-1 mb-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              Navigation
            </span>
          </div>
          <div className="space-y-1.5 pb-4">
            {extraNavLinks.map((item) => (
              <LinkRow
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={activeItem === item.id}
                onClick={() => onItemClick(item.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Floating Context Menu / Popover */}
      {activeMenu && (
        <ChatContextMenu
          menuState={activeMenu}
          onClose={() => setActiveMenu(null)}
          onTogglePin={togglePinChat}
          onRename={(convo) => {
            setConvoToRename(convo);
            setRenameTitle(convo.title || '');
          }}
          onAddToProject={(convo) => {
            setConvoToAddToProject(convo);
            setProjectNameInput('');
          }}
          onArchive={handleArchiveChat}
          onRequestDelete={(convo) => {
            setConvoToDelete(convo);
          }}
        />
      )}

      {/* Centered Modal: Delete Chat Confirmation */}
      {convoToDelete && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none animate-in fade-in duration-150"
          onClick={() => setConvoToDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#18181B] border border-neutral-200/80 dark:border-white/10 p-6 shadow-2xl space-y-4 text-center animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-50 dark:bg-rose-500/15 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-neutral-900 dark:text-white">Delete Chat?</h3>
              <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
                Are you sure you want to delete <span className="font-semibold text-neutral-800 dark:text-neutral-200">"{convoToDelete.title || 'New Chat'}"</span>? This action cannot be undone.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConvoToDelete(null)}
                className="flex-1 py-3 px-4 rounded-2xl bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 text-sm font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = convoToDelete.id;
                  setConvoToDelete(null);
                  handleDeleteChat(id);
                }}
                className="flex-1 py-3 px-4 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold shadow-md shadow-rose-600/20 transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Centered Modal: Rename Chat */}
      {convoToRename && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none animate-in fade-in duration-150"
          onClick={() => setConvoToRename(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#18181B] border border-neutral-200/80 dark:border-white/10 p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1 text-left">
              <h3 className="text-lg font-bold text-neutral-900 dark:text-white">Rename Chat</h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Enter a new title for this conversation.</p>
            </div>
            <input
              type="text"
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              placeholder="Chat title..."
              autoFocus
              className="w-full px-4 py-3 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200/80 dark:border-white/10 text-neutral-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveRename();
              }}
            />
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConvoToRename(null)}
                className="flex-1 py-3 px-4 rounded-2xl bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 text-sm font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveRename}
                className="flex-1 py-3 px-4 rounded-2xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-bold shadow-md transition-colors cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Centered Modal: Add to Project */}
      {convoToAddToProject && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none animate-in fade-in duration-150"
          onClick={() => setConvoToAddToProject(null)}
        >
          <div
            className="w-full max-w-sm rounded-[24px] bg-[#1E1E22] border border-white/10 p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 text-left font-sans text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <FolderPlus className="w-5 h-5 text-neutral-300" />
                  Add to project
                </h3>
                <p className="text-xs text-neutral-400">
                  Organize "{convoToAddToProject.title || 'Chat'}" into a project
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConvoToAddToProject(null)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {savedProjects.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Select Project</p>
                <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
                  {savedProjects.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleSaveToProject(p)}
                      className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-neutral-200 text-xs font-medium transition-colors cursor-pointer border border-white/5"
                    >
                      📁 {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2 pt-2">
              <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Or create new project</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={projectNameInput}
                  onChange={(e) => setProjectNameInput(e.target.value)}
                  placeholder="New project name..."
                  autoFocus
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-neutral-800 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveToProject(projectNameInput);
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleSaveToProject(projectNameInput)}
                  className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors cursor-pointer shrink-0"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Profile Footer (Redundant Chat button removed to maximize vertical space) */}
      <div className="flex-shrink-0 px-3 pb-4 pt-2 border-t border-neutral-100 dark:border-white/10">
        <button
          type="button"
          onClick={() => onItemClick('settings')}
          className="w-full flex items-center gap-3 p-2 rounded-2xl hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors text-left cursor-pointer"
        >
          <Avatar
            display_name={userProfile?.display_name || null}
            photo_url={userProfile?.photo_url}
            className="w-9 h-9 flex-shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium truncate flex items-center gap-1 text-neutral-900 dark:text-white">
              {userProfile?.display_name || 'Profile'}
              <VerificationBadge status={userProfile?.subscription_status} />
            </p>
            <p className="text-[11px] text-neutral-500">Settings</p>
          </div>
        </button>
      </div>
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeItem,
  onItemClick,
  userProfile,
  onLogout,
  isMobileSidebarOpen,
  onCloseMobileSidebar,
  items,
  secondaryItems,
  unreadCount = 0,
  unreadMessagesCount = 0,
  recentConversations,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  onPinConversation,
  activeConversationId,
  quickLinks,
  brandTitle = 'Avelut',
  overlayRef,
  sidebarRef,
  containerRef,
}) => {
  const handleMobileItemClick = (id: string) => {
    onItemClick(id);
    onCloseMobileSidebar();
  };

  const baseItems = items || navigationItems;
  const navItems =
    userProfile?.is_admin && !items
      ? [...baseItems, ...adminNavigationItems]
      : baseItems;

  return (
    <>
      {/* Mobile Drawer — Fullscreen with NO drop shadows */}
      <div
        ref={containerRef as any}
        className={`fixed inset-0 z-[130] md:hidden transition-opacity duration-200 ${
          isMobileSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div
          ref={overlayRef as any}
          className="absolute inset-0 bg-transparent transition-opacity"
          onClick={onCloseMobileSidebar}
          aria-hidden="true"
        />
        <aside
          ref={sidebarRef as any}
          className={`absolute top-0 left-0 h-full w-full bg-white dark:bg-black shadow-none border-none z-10 will-change-transform transition-transform duration-300 ease-out ${
            isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <SidebarPanel
            activeItem={activeItem}
            onItemClick={handleMobileItemClick}
            userProfile={userProfile}
            navItems={navItems}
            quickLinks={quickLinks}
            recentConversations={recentConversations}
            onSelectConversation={(id) => {
              onSelectConversation?.(id);
              onCloseMobileSidebar();
            }}
            onNewChat={() => {
              onNewChat?.();
              onCloseMobileSidebar();
            }}
            onDeleteConversation={onDeleteConversation}
            onPinConversation={onPinConversation}
            activeConversationId={activeConversationId}
            unreadMessagesCount={unreadMessagesCount}
            brandTitle={brandTitle}
            onClose={onCloseMobileSidebar}
          />
        </aside>
      </div>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-shrink-0 w-[280px] h-full border-r border-neutral-200 dark:border-white/5 bg-white dark:bg-black">
        <div className="w-full h-full">
          <SidebarPanel
            activeItem={activeItem}
            onItemClick={onItemClick}
            userProfile={userProfile}
            navItems={navItems}
            quickLinks={quickLinks}
            recentConversations={recentConversations}
            onSelectConversation={onSelectConversation}
            onNewChat={onNewChat}
            onDeleteConversation={onDeleteConversation}
            onPinConversation={onPinConversation}
            activeConversationId={activeConversationId}
            unreadMessagesCount={unreadMessagesCount}
            brandTitle={brandTitle}
          />
        </div>
      </aside>
    </>
  );
};

/** Floating semi-transparent two-line hamburger – shown on most pages */
export const FloatingMenuButton: React.FC<{
  onClick: () => void;
  visible?: boolean;
  className?: string;
}> = ({ onClick, visible = true, className = '' }) => {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open menu"
      className={`fixed top-[calc(env(safe-area-inset-top,0px)+2px)] left-3 z-[110] w-10 h-10 rounded-full bg-white/70 dark:bg-black/50 backdrop-blur-md border border-black/5 dark:border-white/10 flex items-center justify-center text-neutral-800 dark:text-white hover:bg-white/90 dark:hover:bg-black/70 active:scale-95 transition-all md:hidden ${className}`}
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 9h16M4 15h16" />
      </svg>
    </button>
  );
};

export default Sidebar;
