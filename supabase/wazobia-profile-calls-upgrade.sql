-- PARROTHIT Wazobia Trends: public profiles, owner-controlled profile privacy,
-- direct-call permissions and WebRTC call signalling.
-- Run AFTER supabase/wazobia-direct-messages.sql and supabase/wazobia-trends.sql.
-- Safe to re-run.

alter table public.wazobia_profiles add column if not exists cover_url text;

create table if not exists public.wazobia_profile_details (
  user_id uuid primary key references public.wazobia_profiles(user_id) on delete cascade,
  age smallint,
  education text not null default '',
  location text not null default '',
  interests text not null default '',
  profile_visibility text not null default 'public' check (profile_visibility in ('public','private')),
  show_age boolean not null default true,
  show_education boolean not null default true,
  show_location boolean not null default true,
  show_interests boolean not null default true,
  allow_messages boolean not null default true,
  allow_calls boolean not null default true,
  show_active_status boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint wazobia_profile_age_range check (age is null or age between 13 and 120),
  constraint wazobia_profile_education_length check (char_length(education) <= 160),
  constraint wazobia_profile_location_length check (char_length(location) <= 120),
  constraint wazobia_profile_interests_length check (char_length(interests) <= 500)
);

alter table public.wazobia_profile_details enable row level security;
drop policy if exists "Members read their private Wazobia profile details" on public.wazobia_profile_details;
create policy "Members read their private Wazobia profile details"
  on public.wazobia_profile_details for select to authenticated using (user_id = auth.uid());
drop policy if exists "Members create their private Wazobia profile details" on public.wazobia_profile_details;
create policy "Members create their private Wazobia profile details"
  on public.wazobia_profile_details for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Members update their private Wazobia profile details" on public.wazobia_profile_details;
create policy "Members update their private Wazobia profile details"
  on public.wazobia_profile_details for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.wazobia_profile_details from anon, authenticated;
revoke all on public.wazobia_profile_details from public;
grant select, insert, update on public.wazobia_profile_details to authenticated;

-- Public-safe profile lookup. Sensitive values are only returned when the owner
-- is viewing their own profile or the relevant field is marked visible.
create or replace function public.wazobia_get_public_profile(target_user uuid)
returns table (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  cover_url text,
  bio text,
  created_at timestamptz,
  age smallint,
  education text,
  location text,
  interests text,
  profile_visibility text,
  allow_messages boolean,
  allow_calls boolean,
  show_active_status boolean,
  is_owner boolean
)
language sql stable security definer set search_path = public
as $$
  select
    p.user_id,
    p.display_name,
    p.username,
    p.avatar_url,
    case when auth.uid() = p.user_id or coalesce(d.profile_visibility,'public') = 'public' then p.cover_url else null end,
    case when auth.uid() = p.user_id or coalesce(d.profile_visibility,'public') = 'public' then p.bio else '' end,
    p.created_at,
    case when auth.uid() = p.user_id or (coalesce(d.profile_visibility,'public') = 'public' and coalesce(d.show_age,true)) then d.age else null end,
    case when auth.uid() = p.user_id or (coalesce(d.profile_visibility,'public') = 'public' and coalesce(d.show_education,true)) then coalesce(d.education,'') else '' end,
    case when auth.uid() = p.user_id or (coalesce(d.profile_visibility,'public') = 'public' and coalesce(d.show_location,true)) then coalesce(d.location,'') else '' end,
    case when auth.uid() = p.user_id or (coalesce(d.profile_visibility,'public') = 'public' and coalesce(d.show_interests,true)) then coalesce(d.interests,'') else '' end,
    coalesce(d.profile_visibility,'public'),
    coalesce(d.allow_messages,true),
    coalesce(d.allow_calls,true),
    coalesce(d.show_active_status,true),
    (auth.uid() = p.user_id)
  from public.wazobia_profiles p
  left join public.wazobia_profile_details d on d.user_id = p.user_id
  where p.user_id = target_user;
$$;
revoke all on function public.wazobia_get_public_profile(uuid) from public;
grant execute on function public.wazobia_get_public_profile(uuid) to anon, authenticated;

-- Respect the recipient's independent message privacy setting when opening chats.
create or replace function public.wazobia_start_direct_conversation(target_user uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  first_member uuid;
  second_member uuid;
  conversation_id uuid;
begin
  if current_user_id is null then
    raise exception 'Log in to start a conversation.' using errcode = '28000';
  end if;
  if target_user is null or target_user = current_user_id then
    raise exception 'Choose another Wazobia member to message.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.wazobia_profiles p where p.user_id = target_user) then
    raise exception 'This Wazobia member could not be found.' using errcode = 'P0002';
  end if;
  if not coalesce((select d.allow_messages from public.wazobia_profile_details d where d.user_id = target_user), true) then
    raise exception 'This member is not accepting new private messages.' using errcode = '42501';
  end if;
  if current_user_id < target_user then
    first_member := current_user_id; second_member := target_user;
  else
    first_member := target_user; second_member := current_user_id;
  end if;
  insert into public.wazobia_conversations(participant_one, participant_two, created_by)
  values(first_member, second_member, current_user_id)
  on conflict (participant_one, participant_two) do nothing;
  select c.id into conversation_id from public.wazobia_conversations c
  where c.participant_one = first_member and c.participant_two = second_member;
  return conversation_id;
end;
$$;
revoke all on function public.wazobia_start_direct_conversation(uuid) from public;
grant execute on function public.wazobia_start_direct_conversation(uuid) to authenticated;

-- SECURITY DEFINER checks are used by RLS because profile details are owner-only.
create or replace function public.wazobia_user_allows_messages(target_user uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select d.allow_messages from public.wazobia_profile_details d where d.user_id=target_user),true); $$;
revoke all on function public.wazobia_user_allows_messages(uuid) from public;
grant execute on function public.wazobia_user_allows_messages(uuid) to authenticated;
drop policy if exists "Members send messages as themselves" on public.wazobia_messages;
create policy "Members send messages as themselves"
  on public.wazobia_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and recipient_id <> auth.uid()
    and public.wazobia_user_allows_messages(recipient_id)
    and exists (
      select 1 from public.wazobia_conversations c
      where c.id = conversation_id
        and ((c.participant_one = auth.uid() and c.participant_two = recipient_id)
          or (c.participant_two = auth.uid() and c.participant_one = recipient_id))
    )
  );

create or replace function public.wazobia_user_allows_calls(target_user uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select d.allow_calls from public.wazobia_profile_details d where d.user_id=target_user),true); $$;
revoke all on function public.wazobia_user_allows_calls(uuid) from public;
grant execute on function public.wazobia_user_allows_calls(uuid) to authenticated;

create table if not exists public.wazobia_call_signals (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null,
  sender_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  recipient_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  signal_type text not null check (signal_type in ('offer','answer','ice','reject','hangup')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint wazobia_call_signal_distinct_members check (sender_id <> recipient_id)
);
create index if not exists wazobia_call_signals_recipient_created_idx
  on public.wazobia_call_signals(recipient_id, created_at desc);
create index if not exists wazobia_call_signals_call_id_idx
  on public.wazobia_call_signals(call_id, created_at asc);
alter table public.wazobia_call_signals enable row level security;
drop policy if exists "Call participants read their call signals" on public.wazobia_call_signals;
create policy "Call participants read their call signals"
  on public.wazobia_call_signals for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists "Members send call signals when both allow calls" on public.wazobia_call_signals;
create policy "Members send call signals when both allow calls"
  on public.wazobia_call_signals for insert to authenticated
  with check (
    sender_id = auth.uid()
    and recipient_id <> auth.uid()
    and public.wazobia_user_allows_calls(sender_id)
    and public.wazobia_user_allows_calls(recipient_id)
  );
drop policy if exists "Call participants clear their call signals" on public.wazobia_call_signals;
create policy "Call participants clear their call signals"
  on public.wazobia_call_signals for delete to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());
revoke all on public.wazobia_call_signals from anon, authenticated;
revoke all on public.wazobia_call_signals from public;
grant select, insert, delete on public.wazobia_call_signals to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='wazobia_call_signals') then
      execute 'alter publication supabase_realtime add table public.wazobia_call_signals';
    end if;
  end if;
end $$;

-- Optional housekeeping: run periodically to clear expired call setup packets.
-- delete from public.wazobia_call_signals where created_at < now() - interval '48 hours';
