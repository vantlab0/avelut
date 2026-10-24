package com.avelut.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.RemoteInput;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class AvelutMessagingService extends MessagingService {

    private static final String CHANNEL_ID = "default";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        showNotificationWithActions(remoteMessage);
    }

    private void showNotificationWithActions(RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        RemoteMessage.Notification notification = remoteMessage.getNotification();

        String title = null;
        String body = null;

        if (notification != null) {
            title = notification.getTitle();
            body = notification.getBody();
        }

        if (title == null && data != null && data.containsKey("title")) {
            title = data.get("title");
        }
        if (body == null && data != null && data.containsKey("body")) {
            body = data.get("body");
        }
        if (body == null && data != null && data.containsKey("message")) {
            body = data.get("message");
        }

        if (title == null) {
            title = "Avelut";
        }
        if (body == null) {
            body = "";
        }

        String chatId = data != null ? data.get("chatId") : null;
        String route = data != null ? data.get("route") : null;

        Context context = getApplicationContext();
        NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

        if (notificationManager == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = notificationManager.getNotificationChannel(CHANNEL_ID);
            if (channel == null) {
                channel = new NotificationChannel(CHANNEL_ID, "General", NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("Avelut messages and updates");
                channel.enableVibration(true);
                notificationManager.createNotificationChannel(channel);
            }
        }

        int iconResId = context.getResources().getIdentifier("ic_stat_name", "drawable", context.getPackageName());
        if (iconResId == 0) {
            iconResId = context.getApplicationInfo().icon;
        }

        Intent contentIntent = new Intent(context, MainActivity.class);
        contentIntent.setAction(Intent.ACTION_VIEW);
        Uri.Builder uriBuilder = new Uri.Builder()
                .scheme("avelut")
                .authority("action");
        if (chatId != null && !chatId.isEmpty()) {
            uriBuilder.appendQueryParameter("chatId", chatId);
        } else if (route != null && !route.isEmpty()) {
            uriBuilder.appendQueryParameter("route", route);
        }
        contentIntent.setData(uriBuilder.build());
        contentIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int notifId = chatId != null && !chatId.isEmpty() ? chatId.hashCode() : (int) System.currentTimeMillis();

        PendingIntent contentPendingIntent = PendingIntent.getActivity(
                context,
                notifId,
                contentIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(iconResId)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setContentIntent(contentPendingIntent);

        try {
            int launcherIconRes = context.getApplicationInfo().icon;
            if (launcherIconRes != 0) {
                Bitmap largeIcon = BitmapFactory.decodeResource(context.getResources(), launcherIconRes);
                if (largeIcon != null) {
                    builder.setLargeIcon(largeIcon);
                }
            }
        } catch (Exception ignored) {}

        if (chatId != null && !chatId.isEmpty()) {
            RemoteInput remoteInput = new RemoteInput.Builder("inline_reply")
                    .setLabel("Reply")
                    .build();

            Intent replyIntent = new Intent(context, NotificationActionReceiver.class);
            replyIntent.putExtra("action_id", "reply_action");
            replyIntent.putExtra("chatId", chatId);

            PendingIntent replyPendingIntent = PendingIntent.getBroadcast(
                    context,
                    notifId + 1,
                    replyIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0)
            );

            NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
                    iconResId,
                    "Reply",
                    replyPendingIntent
            )
            .addRemoteInput(remoteInput)
            .build();

            Intent readIntent = new Intent(context, NotificationActionReceiver.class);
            readIntent.putExtra("action_id", "mark_read");
            readIntent.putExtra("chatId", chatId);

            PendingIntent readPendingIntent = PendingIntent.getBroadcast(
                    context,
                    notifId + 2,
                    readIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            NotificationCompat.Action readAction = new NotificationCompat.Action.Builder(
                    0,
                    "Mark as read",
                    readPendingIntent
            )
            .build();

            builder.addAction(replyAction);
            builder.addAction(readAction);
        }

        notificationManager.notify(notifId, builder.build());
    }
}
