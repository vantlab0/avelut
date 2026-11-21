import React, { useState, useRef, useEffect } from 'react';
import {
  Menu,
  Calendar,
  SquarePen,
  Bell,
  Flame,
  Star,
} from 'lucide-react';
import { AppUpdateBadge } from './AppUpdateBadge';
import { useOTAUpdater } from '../hooks/useOTAUpdater';
import { NotificationDropdown } from './NotificationDropdown';
import type { UserProfile, Notification as NotificationType } from '../types';


export interface HeaderProps {
  activeItem?: string;
  currentPageLabel?: string | React.ReactNode;
  title?: React.ReactNode;
  onNotificationsClick?: () => void;
  unreadCount?: number;
  notifications?: NotificationType[];
  onMarkAllAsRead?: () => void;
  onMarkAsRead?: (id: string) => void;
  onMenuClick: () => void;
  onMessengerClick?: () => void;
  onCalendarClick?: () => void;
  unreadMessagesCount?: number;
  rightActions?: React.ReactNode;
  leftActions?: React.ReactNode;
  userProfile?: UserProfile;
  className?: string;
  onNavigate?: (route: string) => void;
  onLogoutClick?: () => void;
  hideTitle?: boolean;
  hideDefaultRightActions?: boolean;
  hideProfileAvatar?: boolean;
  onNewChat?: () => void;
  onClearChat?: () => void;
  onDeleteChat?: () => void;
  hasActiveChat?: boolean;
  hasMessages?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeItem,
  currentPageLabel,
  title,
  onNotificationsClick,
  unreadCount = 0,
  notifications = [],
  onMarkAllAsRead,
  onMarkAsRead,
  onMenuClick,
  onMessengerClick,
  onCalendarClick,
  unreadMessagesCount = 0,
  rightActions,
  leftActions,
  userProfile,
  className,
  onNavigate,
  onLogoutClick,
  hideTitle,
  hideDefaultRightActions,
  onNewChat,
  onClearChat,
  onDeleteChat,
  hasActiveChat = false,
  hasMessages = false,
}) => {
  const { updateStatus } = useOTAUpdater();
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAiPage = activeItem === 'chat';
  const isFloating = className?.includes('absolute') || className?.includes('fixed');
  const streakCount = Number((userProfile as any)?.streak_count || (userProfile as any)?.current_streak || 0);
  const xpCount = Number((userProfile as any)?.xp || 0);

  return (
    <header
      className={`z-40 flex items-center justify-between w-full ${
        isFloating
          ? className
          : `sticky top-0 flex-shrink-0 px-3 sm:px-6 md:px-8 pt-1 pb-2 ${
              className || 'bg-white/80 dark:bg-black/60 backdrop-blur-xl border-b border-[#E5E5E5] dark:border-transparent'
            }`
      }`}
      style={!isFloating ? { paddingTop: 'calc(var(--header-safe-top, 0px) + 2px)' } : undefined}
    >
      {/* Left Slot: Menu Hamburger Circular Button */}
      <div className="flex items-center gap-3 sm:gap-3.5 min-w-[40px] shrink-0">
        {leftActions ? (
          leftActions
        ) : (
          <button
            type="button"
            onClick={onMenuClick}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white dark:bg-[#18181b] shadow-xs hover:shadow-sm border border-[#E5E5E5] dark:border-neutral-800 flex items-center justify-center text-[#171717] dark:text-neutral-100 hover:text-black dark:hover:text-white transition-all active:scale-95 cursor-pointer relative shrink-0 pointer-events-auto"
            aria-label="Toggle menu"
            title="Menu"
          >
            <Menu className="w-[22px] h-[22px] text-[#171717] dark:text-neutral-100" strokeWidth={1.9} />
            {(unreadCount > 0 || unreadMessagesCount > 0) && (
              <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
              </span>
            )}
          </button>
        )}
        {!leftActions && !hideTitle && !isAiPage && userProfile?.use_personal_token && userProfile?.personal_api_key && (
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 text-amber-500 text-[10px] font-black tracking-widest uppercase rounded-full border border-amber-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            AI Token Active
          </span>
        )}
      </div>

      {/* Center Slot: Show update badge when downloading/ready, or page title */}
      <div className="flex-1 flex items-center justify-center min-w-0 px-2 pointer-events-none [&>*]:pointer-events-auto">
        {updateStatus !== 'idle' ? (
          <AppUpdateBadge />
        ) : title ? (
          title
        ) : hideTitle ? null : React.isValidElement(currentPageLabel) ? (
          currentPageLabel
        ) : typeof currentPageLabel === 'string' ? (
          <h1 className="text-base sm:text-[17px] font-semibold text-neutral-900 dark:text-white tracking-tight truncate max-w-[200px] sm:max-w-md text-center">
            {currentPageLabel}
          </h1>
        ) : null}
      </div>

      {/* Right Slot: Combined Pill Control + Optional Update Badge */}
      <div className="flex items-center gap-2.5 sm:gap-3 justify-end shrink-0 overflow-visible">
        {rightActions ? (
          rightActions
        ) : hideDefaultRightActions ? null : (
          <>
            {(streakCount > 0 || xpCount > 0) && (
              <div
                className="hidden sm:inline-flex items-center gap-1.5 h-10 px-3 rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-300 font-heading font-semibold text-sm"
                title={`${streakCount > 0 ? `${streakCount} day streak` : ''}${streakCount > 0 && xpCount > 0 ? ' • ' : ''}${xpCount > 0 ? `${xpCount} XP` : ''}`}
                aria-label="Learning streak and points"
              >
                {streakCount > 0 ? <Flame className="w-4 h-4 text-amber-500" strokeWidth={2} /> : <Star className="w-4 h-4 text-amber-500" strokeWidth={2} />}
                <span>{streakCount > 0 ? streakCount : xpCount}</span>
              </div>
            )}
            <div className="relative pointer-events-auto overflow-visible" ref={dropdownRef}>
            {/* Combined Pill Container */}
            <div className="h-11 sm:h-12 rounded-full bg-white dark:bg-[#18181b] shadow-xs hover:shadow-sm border border-[#E5E5E5] dark:border-neutral-800 px-2 sm:px-2.5 flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Neutral Calendar Icon Button */}
              <button
                type="button"
                onClick={() => onNavigate?.('timetable')}
                className="w-10 h-10 rounded-full flex items-center justify-center text-[#171717] dark:text-neutral-300 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition active:scale-95 cursor-pointer"
                aria-label="Open calendar"
                title="Calendar"
              >
                <Calendar className="w-5 h-5 text-[#171717] dark:text-neutral-300" strokeWidth={1.9} />
              </button>

              {/* Primary Action Button: Compose for AI Chat, Bell for Other Pages */}
              {isAiPage ? (
                <button
                  type="button"
                  onClick={onNewChat}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-[#171717] dark:text-neutral-300 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition active:scale-95 cursor-pointer"
                  aria-label="New chat"
                  title="New chat"
                >
                  <SquarePen className="w-5 h-5 text-[#171717] dark:text-neutral-300" strokeWidth={1.9} />
                </button>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setIsNotificationOpen((prev) => !prev);
                      onNotificationsClick?.();
                    }}
                    className={`relative w-10 h-10 rounded-full flex items-center justify-center text-[#171717] dark:text-neutral-300 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition active:scale-95 cursor-pointer ${
                      isNotificationOpen ? 'bg-neutral-100 dark:bg-neutral-800' : ''
                    }`}
                    aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
                    title="Notifications"
                  >
                    <Bell className="w-5 h-5 text-[#171717] dark:text-neutral-300" strokeWidth={1.9} />
                    {unreadCount > 0 && (
                      <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0066FF] opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#0066FF]" />
                      </span>
                    )}
                  </button>

                  {/* Notification Dropdown Popup */}
                  <NotificationDropdown
                    isOpen={isNotificationOpen}
                    onClose={() => setIsNotificationOpen(false)}
                    notifications={notifications}
                    onMarkAllAsRead={() => onMarkAllAsRead?.()}
                    onMarkAsRead={(id) => onMarkAsRead?.(id)}
                    onNavigate={(route) => {
                      setIsNotificationOpen(false);
                      onNavigate?.(route);
                    }}
                    onViewAll={() => {
                      setIsNotificationOpen(false);
                      onNavigate?.('notifications');
                    }}
                  />
                </div>
              )}

            </div>
            </div>
          </>
        )}
      </div>
    </header>
  );
};
