-- Remove the retired Messenger feature from deployed Supabase projects.
-- Safe to re-run. AI tutor chat (chat_messages / chat_conversations in app_kv
-- plus local SQLite), notifications, study partners, profiles, and app settings
-- are intentionally untouched.

-- 1. Remove Messenger tables from Realtime before dropping them.
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY[
      'messenger_conversations',
      'messenger_messages',
      'private_messages',
      'user_chats',
      'chats',
      'chat_members',
      'messages'
    ] LOOP
      IF EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- 2. Drop Messenger RPCs.
DROP FUNCTION IF EXISTS public.mark_chat_as_read(uuid, uuid);
DROP FUNCTION IF EXISTS public.send_chat_message(uuid, uuid, uuid, text, text, text, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.get_or_create_direct_chat(uuid);

-- 3. Drop Messenger tables. Policies, indexes, triggers, and grants attached to
--    these tables are removed with them. CASCADE also removes any stale foreign
--    keys pointing at a Messenger chat from legacy deployments.
DROP TABLE IF EXISTS public.messenger_messages CASCADE;
DROP TABLE IF EXISTS public.messenger_conversations CASCADE;
DROP TABLE IF EXISTS public.private_messages CASCADE;
DROP TABLE IF EXISTS public.user_chats CASCADE;
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.chat_members CASCADE;
DROP TABLE IF EXISTS public.chats CASCADE;
