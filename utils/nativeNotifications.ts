/**
 * Pure Native Firebase Cloud Messaging (FCM) push notifications
 * using @capacitor/push-notifications.
 */

import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import type { AuthUser } from '@/lib/backend';
import { supabase } from '@/lib/backend';

type AddToastFn = (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
type SetActiveItemFn = (item: string) => void;
type SetPendingChatIdFn = (chatId: string | null) => void;

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

const persistFcmTokenLocally = (token: string, platform: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('fcm_token', token);
    window.localStorage.setItem('fcm_device_token', token);
    window.localStorage.setItem('fcm_platform', platform);
  } catch {
    // ignore localStorage storage failures
  }
};

export async function saveFcmToken(uid: string, token: string): Promise<void> {
  if (!uid || !token) return;
  try {
    const platform = isNative() ? Capacitor.getPlatform() : 'web';
    persistFcmTokenLocally(token, platform);

    const payload = {
      fcm_token: token,
      fcm_platform: platform,
      updated_at: Date.now(),
    };

    await Promise.allSettled([
      supabase.from('app_kv').upsert({
        key: `user_device_tokens/${uid}`,
        value: payload,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' }),
      supabase.from('profiles').update({
        fcm_token: token,
        notifications_enabled: true,
      }).eq('id', uid),
    ]);

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

export const initNativeNotifications = async (
  user: AuthUser | null,
  addToast: AddToastFn,
  setActiveItem: SetActiveItemFn,
  setPendingChatId: SetPendingChatIdFn
): Promise<void> => {
  navigationHandlers = { addToast, setActiveItem, setPendingChatId };

  if (!user || !isNative()) return;

  try {
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

    const granted = await requestLocalNotificationPermission();
    if (!granted) {
      console.log('[FCM] Push notifications permission not granted.');
      return;
    }

    if (!listenersAttached) {
      listenersAttached = true;

      registrationHandle = await PushNotifications.addListener('registration', async (token) => {
        const value = token?.value;
        if (!value || !user?.uid) return;
        console.log('[FCM] Received device token:', value.substring(0, 20) + '...');
        persistFcmTokenLocally(value, Capacitor.getPlatform());
        await saveFcmToken(user.uid, value);
      });

      registrationErrorHandle = await PushNotifications.addListener('registrationError', (error) => {
        console.warn('[FCM] Push notification registration error:', error);
      });

      pushReceivedHandle = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        try {
          const title = notification.title || 'Avelut';
          const body = notification.body || '';
          const display = body ? `${title}: ${body}` : title;
          if (navigationHandlers.addToast) {
            navigationHandlers.addToast(`🔔 ${display}`, 'info');
          }

          const currentPayload = notification.data || {};
          if (typeof window !== 'undefined' && currentPayload?.chatId) {
            window.localStorage.setItem('last_fcm_chat_route', String(currentPayload.chatId));
          }
        } catch (err) {
          console.warn('[FCM] Foreground notification display error:', err);
        }
      });

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

    await PushNotifications.register();
    await PushNotifications.removeAllDeliveredNotifications().catch(() => {});

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
