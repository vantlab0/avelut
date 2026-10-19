-- RPC to mark chat as read for both sender and recipient under RLS
create or replace function public.mark_chat_as_read(p_chat_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'User must be authenticated';
  end if;

  -- 1. Reset unread_count and set last_message_is_read = true for current user (recipient)
  update public.chat_members
  set
    unread_count = 0,
    last_message_is_read = true
  where chat_id = p_chat_id and user_id = p_user_id;

  -- 2. Mark sender's member record as read (so sender receives Realtime update for chat list)
  update public.chat_members
  set last_message_is_read = true
  where chat_id = p_chat_id and user_id <> p_user_id;

  -- 3. Mark unread incoming messages as read in messages table
  update public.messages
  set is_read = true
  where chat_id = p_chat_id and sender_id <> p_user_id and is_read = false;
end;
$$;

revoke all on function public.mark_chat_as_read(uuid, uuid) from public;
grant execute on function public.mark_chat_as_read(uuid, uuid) to authenticated;
