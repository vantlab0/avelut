-- RPC to mark chat as read for both sender and recipient under RLS
create or replace function public.mark_chat_as_read(p_chat_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_sender_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'User must be authenticated';
  end if;

  -- 1. Always clear current user's unread_count
  update public.chat_members
  set unread_count = 0
  where chat_id = p_chat_id and user_id = p_user_id;

  -- 2. Check who sent the last message on this user's member row
  select last_message_sender_id into v_last_sender_id
  from public.chat_members
  where chat_id = p_chat_id and user_id = p_user_id;

  -- 3. Only if current user is recipient of the last message:
  --    - mark sender's member record as last_message_is_read = true
  --    - mark incoming unread messages as read
  if v_last_sender_id is not null and v_last_sender_id <> p_user_id then
    update public.chat_members
    set last_message_is_read = true
    where chat_id = p_chat_id and user_id = v_last_sender_id;

    update public.messages
    set is_read = true
    where chat_id = p_chat_id and sender_id <> p_user_id and is_read = false;
  end if;
end;
$$;

revoke all on function public.mark_chat_as_read(uuid, uuid) from public;
grant execute on function public.mark_chat_as_read(uuid, uuid) to authenticated;
