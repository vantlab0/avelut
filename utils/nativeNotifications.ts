/**
 * Pure Native Firebase Cloud Messaging (FCM) push notifications
 * using @capacitor/push-notifications.
 * OneSignal has been completely removed.
 */

import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import type { AuthUser } from '@/lib/backend';
import { supabase } from '@/lib/backend';

type AddToastFn = (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
type SetActiveItemFn = (item: string) => void;
type SetPendingChatIdFn = (chatId: string | null) => void;

export interface ReminderSession {
  id: string;
  day: string;
  time: string;
  subject: string;
  topic?: string;
  activity?: string;
  date?: string; // YYYY-MM-DD optional specific date
}

let listenersAttached = false;
let registrationHandle: PluginListenerHandle | null = null;
let registrationErrorHandle: PluginListenerHandle | null = null;
let pushReceivedHandle: PluginListenerHandle | null = null;
let actionHandle: PluginListenerHandle | null = null;

let navigationHandlers: {
  setActiveItem?: SetActiveItemFn;
  setPendingChatId?: SetPendingChatIdFn;
  addToast?: AddToastFn;
} = {};

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

const DAY_MAP: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

export function parseSessionStartTime(time: string): { hours: number; minutes: number } | null {
  if (!time || typeof time !== 'string') return null;
  const start = time.split('-')[0].trim();
  const m = start.match(/(\d{1,2})\s*:\s*(\d{2})\s*(AM|PM|am|pm)?/);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const ampm = m[3]?.toUpperCase();
  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

export function nextOccurrence(
  session: ReminderSession,
  minMinutesFromNow = 1
): Date | null {
  const parsed = parseSessionStartTime(session.time);
  if (!parsed) return null;

  const now = new Date();
  const minAt = new Date(now.getTime() + minMinutesFromNow * 60 * 1000);

  if (session.date && /^\d{4}-\d{2}-\d{2}$/.test(session.date)) {
    const [y, mo, d] = session.date.split('-').map(Number);
    const at = new Date(y, mo - 1, d, parsed.hours, parsed.minutes, 0, 0);
    return at > minAt ? at : null;
  }

  const dayKey = (session.day || '').toLowerCase().trim();
  const targetDow = DAY_MAP[dayKey];
  if (targetDow === undefined) return null;

  for (let add = 0; add <= 14; add++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + add);
    candidate.setHours(parsed.hours, parsed.minutes, 0, 0);
    if (candidate.getDay() === targetDow && candidate > minAt) {
      return candidate;
    }
  }
  return null;
}

/**
 * Persist device token to Supabase app_kv and profiles table
 */
export async function saveFcmToken(uid: string, token: string): Promise<void> {
  if (!uid || !token) return;
  try {
    const platform = isNative() ? Capacitor.getPlatform() : 'web';
    
    // 1. Save to app_kv table under user_device_tokens/<uid>
    const payload = {
      fcm_token: token,
      fcm_platform: platform,
      updated_at: Date.now(),
    };
    await supabase.from('app_kv').upsert({
      key: `user_device_tokens/${uid}`,
      value: payload,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });

    // 2. Mirror into profiles table
    await supabase.from('profiles').update({
      fcm_token: token,
      notifications_enabled: true,
    }).eq('id', uid);

    console.log('[FCM] Device token registered and saved for user:', uid);
  } catch (err) {
    console.warn('[FCM] Error saving token to Supabase:', err);
  }
}

export async function requestLocalNotificationPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const perm = await PushNotifications.requestPermissions();
    return perm.receive === 'granted';
  } catch (e) {
    console.warn('[FCM] Permission request failed:', e);
    return false;
  }
}

export async function scheduleStudyReminders(
  sessions: ReminderSession[],
  options?: { enabled?: boolean }
): Promise<void> {
  if (options?.enabled === false) {
    await cancelAllStudyReminders();
    return;
  }

  const toSchedule = [];
  for (const session of sessions) {
    if (!session?.id) continue;
    const startAt = nextOccurrence(session, 2);
    if (!startAt) continue;

    const subject = session.subject || 'Class';
    const topic = session.topic || session.activity || '';
    const bodyCore = topic ? `${subject} — ${topic}` : subject;

    toSchedule.push({
      time: startAt.getTime(),
      title: 'Class starting',
      body: bodyCore
    });
  }

  if (toSchedule.length === 0) return;

  try {
    const apiBase = typeof window !== 'undefined' && Capacitor.isNativePlatform()
      ? 'https://www.avelut.xyz'
      : '';
    const uid = window.localStorage?.getItem('avelut_last_uid');
    if (!uid) return;

    await fetch(`${apiBase}/api/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'schedule',
        targetUserId: uid,
        reminders: toSchedule
      })
    });
  } catch (e) {
    console.warn('[FCM] Failed to schedule study reminders:', e);
  }
}

export async function cancelStudyRemindersForSessions(sessionIds: string[]): Promise<void> {
  // Optional reminder cleanup
}

export async function cancelAllStudyReminders(): Promise<void> {
  // Optional reminder cleanup
}

export const clearDeliveredNotifications = async (): Promise<void> => {
  if (!isNative()) return;
  try {
    await PushNotifications.removeAllDeliveredNotifications();
  } catch (err) {
    console.warn('[FCM] Failed to clear delivered notifications:', err);
  }
};

export async function sendTestNotification(): Promise<{ success: boolean; message: string }> {
  try {
    const apiBase = typeof window !== 'undefined' && Capacitor.isNativePlatform()
      ? 'https://www.avelut.xyz'
      : '';
    const uid = typeof window !== 'undefined'
      ? (window.localStorage?.getItem('avelut_last_uid') || '')
      : '';

    if (!uid) {
      return { success: false, message: 'Please log in before sending a test notification.' };
    }

    if (isNative()) {
      try {
        const granted = await requestLocalNotificationPermission();
        if (granted) {
          await PushNotifications.register();
        }
      } catch (err) {
        console.warn('[FCM] Registration check before test notification:', err);
      }
    }

    let fcmToken: string | undefined = undefined;
    if (typeof window !== 'undefined') {
      fcmToken = window.localStorage.getItem('fcm_token') || window.localStorage.getItem('fcm_device_token') || undefined;
    }

    const res = await fetch(`${apiBase}/api/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send',
        targetUserId: uid,
        fcmToken: fcmToken,
        title: 'Avelut Push Test',
        message: 'Firebase FCM push notifications are configured and working!',
        data: { route: 'chat' },
      }),
    });

    const data = await res.json();
    if (!res.ok || data.success === false) {
      return {
        success: false,
        message: data.reason || data.error?.message || data.error || 'Notification delivery failed.',
      };
    }

    return {
      success: true,
      message: 'Test notification sent! Check your device notification tray.',
    };
  } catch (e: any) {
    const isFetchFail = e?.message?.includes('Failed to fetch') || e?.name === 'TypeError';
    return {
      success: false,
      message: isFetchFail
        ? 'Could not reach notification server. Please check internet connection.'
        : (e?.message || 'Failed to dispatch test notification.'),
    };
  }
}

export const initNativeNotifications = async (
  user: AuthUser | null,
  addToast: AddToastFn,
  setActiveItem: SetActiveItemFn,
  setPendingChatId: SetPendingChatIdFn
): Promise<void> => {
  navigationHandlers = { addToast, setActiveItem, setPendingChatId };

  if (!user || !isNative()) return;

  try {
    // 1. Create Android Notification Channel
    try {
      await PushNotifications.createChannel({
        id: 'default',
        name: 'General',
        description: 'Avelut messages and updates',
        importance: 5,
        visibility: 1,
        vibration: true,
      });
    } catch (channelErr) {
      console.warn('[FCM] createChannel warning:', channelErr);
    }

    // 2. Request permission
    const granted = await requestLocalNotificationPermission();
    if (!granted) {
      console.log('[FCM] Push notifications permission not granted.');
      return;
    }

    if (!listenersAttached) {
      listenersAttached = true;

      // Token received
      registrationHandle = await PushNotifications.addListener('registration', async (token) => {
        console.log('[FCM] Received device token:', token.value?.substring(0, 20) + '...');
        if (token?.value && user?.uid) {
          await saveFcmToken(user.uid, token.value);
        }
      });

      // Registration error
      registrationErrorHandle = await PushNotifications.addListener('registrationError', (error) => {
        console.warn('[FCM] Push notification registration error:', error);
      });

      // Foreground push notification received: display toast
      pushReceivedHandle = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        try {
          const title = notification.title || 'Avelut';
          const body = notification.body || '';
          const display = body ? `${title}: ${body}` : title;
          if (navigationHandlers.addToast) {
            navigationHandlers.addToast(`🔔 ${display}`, 'info');
          }
        } catch (err) {
          console.warn('[FCM] Foreground notification display error:', err);
        }
      });

      // Notification tapped / clicked
      actionHandle = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        try {
          const data = action.notification?.data || {};
          if (data.route && navigationHandlers.setActiveItem) {
            navigationHandlers.setActiveItem(data.route);
          }
          if (data.chatId && navigationHandlers.setPendingChatId) {
            navigationHandlers.setPendingChatId(data.chatId);
            if (navigationHandlers.setActiveItem) {
              navigationHandlers.setActiveItem('messenger');
            }
          }
        } catch (err) {
          console.warn('[FCM] Action handler error:', err);
        }
      });
    }

    // Register with FCM on native device
    await PushNotifications.register();

    // 8. Clean up any delivered notifications
    await clearDeliveredNotifications();

    console.log('[FCM] Native push notification listeners attached successfully.');
  } catch (err) {
    console.warn('[FCM] Failed to initialize native push notifications:', err);
  }
};

export const cleanupNativeNotifications = async (): Promise<void> => {
  listenersAttached = false;
  navigationHandlers = {};
  try {
    await registrationHandle?.remove();
    await registrationErrorHandle?.remove();
    await pushReceivedHandle?.remove();
    await actionHandle?.remove();
  } catch (err) {
    console.warn('[FCM] Cleanup listeners error:', err);
  }
};
