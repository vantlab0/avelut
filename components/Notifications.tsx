import React, { useEffect } from 'react';
import type { Notification } from '../types';
import { NotificationBellIcon } from './icons/NotificationBellIcon';
import { clearDeliveredNotifications } from '../utils/nativeNotifications';
import { NotificationTypeIcon, resolveNotificationRoute, timeAgo } from '../utils/notificationUtils';

export { NotificationTypeIcon, resolveNotificationRoute, timeAgo };

interface NotificationsProps {
  notifications: Notification[];
  onMarkAllAsRead: () => void;
  onMarkAsRead: (id: string) => void;
  onNavigate: (page: string, params?: any) => void;
}

export const Notifications: React.FC<NotificationsProps> = ({ notifications, onMarkAllAsRead, onMarkAsRead, onNavigate }) => {
    useEffect(() => {
        clearDeliveredNotifications();
    }, []);

    const handleNotificationClick = (notification: Notification) => {
        onMarkAsRead(notification.id);
        const route = resolveNotificationRoute(notification);
        if (route) {
            onNavigate(route);
        }
    };

    const unreadCount = notifications.filter(n => !n.is_read).length;

    return (
        <div className="flex-1 w-full max-w-4xl mx-auto h-full overflow-hidden flex flex-col bg-gray-50 dark:bg-black/50 md:rounded-2xl md:my-4 md:border border-gray-200 dark:border-gray-800 md:shadow-sm">
            {/* Header */}
            <div className="flex-none p-4 md:p-6 bg-white dark:bg-[#0A0A0A] border-b border-gray-200 dark:border-gray-800 flex justify-between items-center z-10 sticky top-0">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <NotificationBellIcon className="w-6 h-6 text-lime-600" />
                    Notifications
                </h1>
                {unreadCount > 0 && (
                    <button 
                        onClick={onMarkAllAsRead} 
                        className="px-4 py-2 text-sm font-medium text-lime-700 bg-lime-50 rounded-full hover:bg-lime-100 transition-colors"
                    >
                        Mark all as read
                    </button>
                )}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {notifications.length > 0 ? (
                    notifications.map(notification => (
                        <div 
                            key={notification.id} 
                            onClick={() => handleNotificationClick(notification)}
                            className={`group relative overflow-hidden rounded-xl border p-4 transition-all duration-200 cursor-pointer
                                ${notification.is_read 
                                    ? 'bg-white dark:bg-[#0A0A0A] border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700 hover:shadow-sm' 
                                    : 'bg-lime-50/30 dark:bg-lime-900/10 border-lime-200 dark:border-lime-900 shadow-sm ring-1 ring-lime-500/10'}`}
                        >
                            {!notification.is_read && (
                                <div className="absolute top-0 left-0 w-1 h-full bg-lime-500 rounded-l-xl"></div>
                            )}
                            
                            <div className="flex items-start gap-4">
                                <div className={`flex-shrink-0 p-3 rounded-xl flex items-center justify-center 
                                    ${notification.is_read ? 'bg-gray-100 text-gray-500 dark:text-gray-400' : 'bg-lime-100 text-lime-600'}`}>
                                   <NotificationTypeIcon type={notification.type} />
                                </div>
                                
                                <div className="flex-1 min-w-0 pt-1">
                                    <div className="flex justify-between items-start gap-2 mb-1">
                                        <p className={`font-semibold text-base truncate ${notification.is_read ? 'text-gray-700 dark:text-gray-300' : 'text-gray-900 dark:text-white'}`}>
                                            {notification.title}
                                        </p>
                                        <span className="text-xs font-medium text-gray-400 whitespace-nowrap">
                                            {timeAgo(notification.timestamp)}
                                        </span>
                                    </div>
                                    <p className={`text-sm line-clamp-2 ${notification.is_read ? 'text-gray-500 dark:text-gray-400' : 'text-gray-700 dark:text-gray-200'}`}>
                                        {notification.message}
                                    </p>

                                </div>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 text-gray-500 dark:text-gray-400">
                        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                            <NotificationBellIcon className="w-10 h-10 text-gray-300" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">No notifications yet</h3>
                        <p className="text-gray-500 dark:text-gray-400 max-w-sm">When you receive new messages, partner requests, or study reminders, they will appear here.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
