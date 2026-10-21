import React, { useState, useRef, useEffect } from 'react';
import {
  Menu,
  Calendar,
  SquarePen,
  Bell,
  MoreVertical,
  Settings,
  Crown,
  HelpCircle,
  Eraser,
  Trash2,
  LogOut,
} from 'lucide-react';
import { AppUpdateBadge } from './AppUpdateBadge';
import { useOTAUpdater } from '../hooks/useOTAUpdater';
import { NotificationDropdown } from './NotificationDropdown';
import type { UserProfile, Notification as NotificationType } from '../types';
import { isNative, openExternalSubscriptionPage } from '../utils/capacitorUtils';

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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAiPage = activeItem === 'chat';
  const isFloating = className?.includes('absolute') || className?.includes('fixed');

  // Handle click outside and Escape key to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

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
          <div className="relative pointer-events-auto overflow-visible" ref={dropdownRef}>
            {/* Combined Pill Container */}
            <div className="h-11 sm:h-12 rounded-full bg-white dark:bg-[#18181b] shadow-xs hover:shadow-sm border border-[#E5E5E5] dark:border-neutral-800 px-2.5 sm:px-3 flex items-center gap-2 sm:gap-2.5 shrink-0">
              {/* Neutral Calendar Icon Button */}
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onNavigate?.('timetable');
                }}
                className="w-9 h-9 sm:w-9.5 sm:h-9.5 rounded-full flex items-center justify-center text-[#171717] dark:text-neutral-300 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition active:scale-95 cursor-pointer"
                aria-label="Study Timetable"
                title="Study Timetable"
              >
                <Calendar className="w-[20px] h-[20px] text-[#171717] dark:text-neutral-300" strokeWidth={1.9} />
              </button>

              {/* Primary Action Button: Compose for AI Chat, Bell for Other Pages */}
              {isAiPage ? (
                <button
                  type="button"
                  onClick={onNewChat}
                  className="w-9 h-9 sm:w-9.5 sm:h-9.5 rounded-full flex items-center justify-center text-[#171717] dark:text-neutral-300 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition active:scale-95 cursor-pointer"
                  aria-label="New chat"
                  title="New chat"
                >
                  <SquarePen className="w-[20px] h-[20px] text-[#171717] dark:text-neutral-300" strokeWidth={1.9} />
                </button>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      setIsNotificationOpen((prev) => !prev);
                      onNotificationsClick?.();
                    }}
                    className={`relative w-9 h-9 sm:w-9.5 sm:h-9.5 rounded-full flex items-center justify-center text-[#171717] dark:text-neutral-300 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition active:scale-95 cursor-pointer ${
                      isNotificationOpen ? 'bg-neutral-100 dark:bg-neutral-800' : ''
                    }`}
                    aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
                    title="Notifications"
                  >
                    <Bell className="w-[20px] h-[20px] text-[#171717] dark:text-neutral-300" strokeWidth={1.9} />
                    {unreadCount > 0 && (
                      <span className="absolute top-1 right-1 flex h-2 w-2">
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

              {/* Vertical Hairline Divider */}
              <div className="w-px h-5 bg-[#E5E5E5] dark:bg-neutral-800 mx-1 sm:mx-1.5" />

              {/* Three Dot Kebab Menu Button */}
              <button
                type="button"
                onClick={() => setIsMenuOpen((prev) => !prev)}
                className={`w-9 h-9 sm:w-9.5 sm:h-9.5 rounded-full flex items-center justify-center text-[#171717] dark:text-neutral-300 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition active:scale-95 cursor-pointer ${
                  isMenuOpen ? 'bg-neutral-100 dark:bg-neutral-800' : ''
                }`}
                aria-label="More options"
                title="More options"
                aria-expanded={isMenuOpen}
              >
                <MoreVertical className="w-[20px] h-[20px] text-[#171717] dark:text-neutral-300" strokeWidth={1.9} />
              </button>
            </div>

            {/* Three Dot Dropdown Popover */}
            {isMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 sm:w-72 bg-white dark:bg-[#18181b] rounded-2xl shadow-xl shadow-black/8 dark:shadow-black/50 border border-neutral-200/80 dark:border-white/10 p-1.5 z-[9999] animate-in fade-in slide-in-from-top-2">
                {userProfile && (
                  <div className="px-3 py-2.5 border-b border-neutral-100 dark:border-white/10 mb-1 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 font-semibold flex items-center justify-center text-sm shrink-0 border border-neutral-200/60 dark:border-white/10">
                      {(userProfile.display_name || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                        {userProfile.display_name || 'Student'}
                      </p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        {userProfile.level || 'Academic'} Level
                      </p>
                    </div>
                  </div>
                )}

                {/* Profile & Settings (Consolidated) */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onNavigate?.('settings');
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 min-h-[44px] rounded-xl text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition cursor-pointer text-left"
                >
                  <Settings className="w-4.5 h-4.5 text-neutral-500 dark:text-neutral-400 shrink-0" strokeWidth={1.9} />
                  <span>Profile & Settings</span>
                </button>

                {/* Upgrade to Pro */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    openExternalSubscriptionPage(userProfile?.uid);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 min-h-[44px] rounded-xl text-sm font-medium text-neutral-900 dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition cursor-pointer text-left"
                >
                  <div className="flex items-center gap-3">
                    <Crown className="w-4.5 h-4.5 text-amber-500 shrink-0" strokeWidth={1.9} />
                    <span>Upgrade to Pro</span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 uppercase tracking-wider border border-neutral-200/50 dark:border-white/10">
                    Pro
                  </span>
                </button>

                {/* Help & Support */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onNavigate?.('help');
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 min-h-[44px] rounded-xl text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition cursor-pointer text-left"
                >
                  <HelpCircle className="w-4.5 h-4.5 text-neutral-500 dark:text-neutral-400 shrink-0" strokeWidth={1.9} />
                  <span>Help & Support</span>
                </button>

                {isAiPage && (hasMessages || hasActiveChat) && (
                  <>
                    <div className="h-px bg-neutral-100 dark:bg-white/[0.08] my-1 mx-1" />
                    {hasMessages && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          onClearChat?.();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 min-h-[44px] rounded-xl text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition cursor-pointer text-left"
                      >
                        <Eraser className="w-4.5 h-4.5 text-neutral-500 dark:text-neutral-400 shrink-0" strokeWidth={1.9} />
                        <span>Clear messages</span>
                      </button>
                    )}
                    {hasActiveChat && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          onDeleteChat?.();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 min-h-[44px] rounded-xl text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition cursor-pointer text-left"
                      >
                        <Trash2 className="w-4.5 h-4.5 text-rose-500 shrink-0" strokeWidth={1.9} />
                        <span>Delete conversation</span>
                      </button>
                    )}
                  </>
                )}

                <div className="h-px bg-neutral-100 dark:bg-white/[0.08] my-1 mx-1" />

                {/* Log Out */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onLogoutClick?.();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 min-h-[44px] rounded-xl text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition cursor-pointer text-left"
                >
                  <LogOut className="w-4.5 h-4.5 text-rose-500 shrink-0" strokeWidth={1.9} />
                  <span>Log Out</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
