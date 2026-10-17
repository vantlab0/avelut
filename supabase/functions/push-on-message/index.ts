/**
 * push-on-message
 * Triggered by a Database Webhook on INSERT to public.messages.
 * Looks up recipients (service role) and calls the existing /api/notifications
 * so FCM is delivered even when the app is fully closed.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-event-id",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function env(...keys: string[]): string {
  for (const k of keys) {
    const v = Deno.env.get(k);
    if (v && v.trim()) return v.trim();
  }
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    // Optional simple secret so only your webhook can call this function
    const expectedSecret = env("PUSH_WEBHOOK_SECRET");
    if (expectedSecret) {
      const incoming =
        req.headers.get("x-webhook-secret") ||
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (incoming !== expectedSecret) {
        return json({ error: "Unauthorized" }, 401);
      }
    }

    const body = await req.json();

    // Supabase Database Webhook payload shape
    const record = body.record || body;
    if (!record || !record.id || !record.chat_id || !record.sender_id) {
      return json({ error: "Invalid payload – missing message fields" }, 400);
    }

    const chatId = record.chat_id as string;
    const senderId = record.sender_id as string;
    const text = (record.text || "").trim();
    const mediaType = record.media_type || null;

    const summary =
      mediaType === "voice"
        ? "Voice message"
        : mediaType === "image"
          ? "Image"
          : mediaType === "file"
            ? "Document"
            : text || "New message";

    // Service-role client (bypasses RLS)
    const supabaseUrl = env("SUPABASE_URL");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // All members except the sender
    const { data: members, error: membersErr } = await admin
      .from("chat_members")
      .select("user_id")
      .eq("chat_id", chatId)
      .neq("user_id", senderId);

    if (membersErr) {
      console.error("[push-on-message] members lookup failed:", membersErr.message);
      return json({ error: membersErr.message }, 500);
    }

    if (!members || members.length === 0) {
      return json({ success: true, delivered: 0, reason: "no recipients" });
    }

    // Call your existing production notifications API
    const apiBase = env("AVELUT_API_BASE") || "https://www.avelut.xyz";
    let delivered = 0;
    let failed = 0;

    await Promise.allSettled(
      members.map(async (m) => {
        if (!m.user_id) return;
        try {
          const res = await fetch(`${apiBase}/api/notifications`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "send",
              targetUserId: m.user_id,
              title: "New Message",
              message: summary.slice(0, 180),
              data: {
                route: "messenger",
                chatId,
                senderId,
                messageId: record.id,
              },
            }),
          });
          if (res.ok) delivered++;
          else failed++;
        } catch {
          failed++;
        }
      }),
    );

    return json({
      success: true,
      chatId,
      recipients: members.length,
      delivered,
      failed,
    });
  } catch (e: any) {
    console.error("[push-on-message] error:", e?.message || e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
