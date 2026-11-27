-- Avelut: notifications and social tables on Supabase (Realtime / WebSockets)
-- Safe to re-run. Compatible with existing `reports.reporter_id` column.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  body text,
  type text default 'general',
  data jsonb default '{}'::jsonb,
  is_read boolean default false,
  created_at timestamptz default now()
);

create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

-- reports may already exist with reporter_id (not reporter_uid)
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id),
  reported_id uuid,
  chat_id uuid,
  reason text,
  created_at timestamptz default now()
);

-- Ensure expected columns exist on legacy reports tables
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'reports'
  ) then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reports' and column_name = 'reporter_id'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reports' and column_name = 'reporter_uid'
    ) then
      alter table public.reports rename column reporter_uid to reporter_id;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reports' and column_name = 'reporter_id'
    ) then
      alter table public.reports add column reporter_id uuid references auth.users(id);
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reports' and column_name = 'reported_id'
    ) then
      alter table public.reports add column reported_id uuid;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reports' and column_name = 'chat_id'
    ) then
      alter table public.reports add column chat_id uuid;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reports' and column_name = 'reason'
    ) then
      alter table public.reports add column reason text;
    end if;
  end if;
end $$;

create table if not exists public.study_partners (
  user_id uuid references auth.users(id) on delete cascade,
  partner_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, partner_id)
);

create table if not exists public.user_blocks (
  user_id uuid references auth.users(id) on delete cascade,
  blocked_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, blocked_id)
);

-- Presence columns on profiles (if table exists)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='profiles') then
    alter table public.profiles add column if not exists is_online boolean default false;
    alter table public.profiles add column if not exists last_seen timestamptz;
  end if;
end $$;

-- RLS
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.study_partners enable row level security;
alter table public.user_blocks enable row level security;

drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications for all using (auth.uid() = user_id);

-- Use reporter_id (existing column name in your DB)
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert with check (auth.uid() = reporter_id);

drop policy if exists study_partners_own on public.study_partners;
create policy study_partners_own on public.study_partners for all using (auth.uid() = user_id);

drop policy if exists user_blocks_own on public.user_blocks;
create policy user_blocks_own on public.user_blocks for all using (auth.uid() = user_id);

-- Realtime publication (ignore if already added)
do $$
begin
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then null;
  end;
end $$;
