import React, { useState, useRef, useEffect } from 'react';
import { AppUpdateBadge } from './AppUpdateBadge';
import { useOTAUpdater } from '../hooks/useOTAUpdater';
import { NotificationDropdown } from './NotificationDropdown';
import type { UserProfile, Notification as NotificationType } from '../types';
import { isNative } from '../utils/capacitorUtils';
import {
  Menu,
  Calendar,
  SquarePen,
  Bell,
  MoreVertical,
  Settings,
  Sparkles,
  HelpCircle,
  Eraser,
  Trash2,
  LogOut,
} from 'lucide-react';

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
              className || 'bg-white/70 dark:bg-black/60 backdrop-blur-xl border-b border-black/5 dark:border-white/8'
            }`
      }`}
      style={!isFloating ? { paddingTop: 'calc(var(--header-safe-top, 0px) + 2px)' } : undefined}
    >
      {/* Left Slot: Menu Hamburger Circular Button */}
      <div className="flex items-center gap-2 min-w-[40px] shrink-0">
        {leftActions ? (
          leftActions
        ) : (
          <button
            type="button"
            onClick={onMenuClick}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white dark:bg-[#212124] shadow-sm hover:shadow-md border border-neutral-200/80 dark:border-white/10 flex items-center justify-center text-neutral-800 dark:text-white transition-all active:scale-95 cursor-pointer relative shrink-0 pointer-events-auto"
            aria-label="Toggle menu"
            title="Menu"
          >
            <Menu className="w-5.5 h-5.5 text-neutral-800 dark:text-neutral-100 stroke-[1.8]" />
            {(unreadCount > 0 || unreadMessagesCount > 0) && (
              <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
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
      <div className="flex items-center gap-2 justify-end shrink-0 overflow-visible">
        {rightActions ? (
          rightActions
        ) : hideDefaultRightActions ? null : (
          <div className="relative pointer-events-auto overflow-visible" ref={dropdownRef}>
            {/* Combined Pill Container */}
            <div className="h-11 sm:h-12 rounded-full bg-white dark:bg-[#212124] shadow-sm hover:shadow-md border border-neutral-200/80 dark:border-white/10 px-1.5 flex items-center gap-0.5 shrink-0">
              {/* Calendar Icon Button */}
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onNavigate?.('timetable');
                }}
                className="w-9 h-9 rounded-full flex items-center justify-center text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-white/10 transition active:scale-95 cursor-pointer"
                aria-label="Study Timetable"
                title="Study Timetable"
              >
                <Calendar className="w-[19px] h-[19px] text-neutral-800 dark:text-neutral-100 stroke-[1.8]" />
              </button>

              {/* Primary Action Button: SquarePen for AI Chat, Bell for Other Pages */}
              {isAiPage ? (
                <button
                  type="button"
                  onClick={onNewChat}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-white/10 transition active:scale-95 cursor-pointer"
                  aria-label="New chat"
                  title="New chat"
                >
                  <SquarePen className="w-[19px] h-[19px] text-neutral-900 dark:text-white stroke-[1.8]" />
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
                    className={`relative w-9 h-9 rounded-full flex items-center justify-center text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-white/10 transition active:scale-95 cursor-pointer ${
                      isNotificationOpen ? 'bg-neutral-100 dark:bg-white/10' : ''
                    }`}
                    aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
                    title="Notifications"
                  >
                    <Bell className="w-[19px] h-[19px] text-neutral-900 dark:text-white stroke-[1.8]" />
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
              <div className="w-px h-5 bg-neutral-200 dark:bg-white/10 mx-0.5" />

              {/* Three Dot Kebab Menu Button */}
              <button
                type="button"
                onClick={() => setIsMenuOpen((prev) => !prev)}
                className={`w-9 h-9 rounded-full flex items-center justify-center text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-white/10 transition active:scale-95 cursor-pointer ${
                  isMenuOpen ? 'bg-neutral-100 dark:bg-white/10' : ''
                }`}
                aria-label="More options"
                title="More options"
                aria-expanded={isMenuOpen}
              >
                <MoreVertical className="w-[19px] h-[19px] text-neutral-900 dark:text-white stroke-[1.8]" />
              </button>
            </div>

            {/* Three Dot Dropdown Popover */}
            {isMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 sm:w-72 bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-2xl border border-neutral-200/90 dark:border-white/10 p-2 z-[9999] animate-in fade-in slide-in-from-top-2">
                {userProfile && (
                  <div className="px-3.5 py-3 border-b border-neutral-100 dark:border-white/10 mb-1.5 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-600/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 font-bold flex items-center justify-center text-sm shrink-0 border border-blue-500/20">
                      {(userProfile.display_name || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-neutral-900 dark:text-white truncate">
                        {userProfile.display_name || 'Student'}
                      </p>
                      <p className="text-xs font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
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
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm sm:text-[15px] font-semibold text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-white/5 transition cursor-pointer text-left"
                >
                  <Settings className="w-4.5 h-4.5 text-neutral-500 dark:text-neutral-400 shrink-0 stroke-[1.8]" />
                  <span>Profile & Settings</span>
                </button>

                {/* Upgrade to Pro */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onNavigate?.('billing');
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm sm:text-[15px] font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition cursor-pointer text-left"
                >
                  <div className="flex items-center gap-3">
                    <Sparkles className="w-4.5 h-4.5 text-amber-500 shrink-0 stroke-[1.8]" />
                    <span>Upgrade to Pro</span>
                  </div>
                  <span className="text-xs font-black px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 uppercase tracking-wider">
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
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm sm:text-[15px] font-semibold text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-white/5 transition cursor-pointer text-left"
                >
                  <HelpCircle className="w-4.5 h-4.5 text-neutral-500 dark:text-neutral-400 shrink-0 stroke-[1.8]" />
                  <span>Help & Support</span>
                </button>

                {isAiPage && (hasMessages || hasActiveChat) && (
                  <>
                    <div className="border-t border-neutral-100 dark:border-white/10 my-1.5" />
                    {hasMessages && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          onClearChat?.();
                        }}
                        className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm sm:text-[15px] font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 transition cursor-pointer text-left"
                      >
                        <Eraser className="w-4.5 h-4.5 text-neutral-500 dark:text-neutral-400 shrink-0 stroke-[1.8]" />
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
                        className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm sm:text-[15px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition cursor-pointer text-left"
                      >
                        <Trash2 className="w-4.5 h-4.5 text-rose-500 shrink-0 stroke-[1.8]" />
                        <span>Delete conversation</span>
                      </button>
                    )}
                  </>
                )}

                <div className="border-t border-neutral-100 dark:border-white/10 my-1.5" />

                {/* Log Out */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onLogoutClick?.();
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm sm:text-[15px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition cursor-pointer text-left"
                >
                  <LogOut className="w-4.5 h-4.5 text-rose-500 shrink-0 stroke-[1.8]" />
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
