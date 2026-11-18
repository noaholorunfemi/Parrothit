-- PARROTHIT Wazobia Trends: private one-to-one Messenger.
-- Run this file once in Supabase SQL Editor. Safe to re-run.

create table if not exists public.wazobia_conversations (
  id uuid primary key default gen_random_uuid(),
  participant_one uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  participant_two uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  created_by uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint wazobia_conversation_distinct_members check (participant_one <> participant_two),
  constraint wazobia_conversation_sorted_members check (participant_one < participant_two),
  constraint wazobia_conversation_unique_pair unique (participant_one, participant_two)
);
create index if not exists wazobia_conversations_participant_one_idx on public.wazobia_conversations(participant_one, last_message_at desc nulls last);
create index if not exists wazobia_conversations_participant_two_idx on public.wazobia_conversations(participant_two, last_message_at desc nulls last);

create table if not exists public.wazobia_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.wazobia_conversations(id) on delete cascade,
  sender_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  recipient_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint wazobia_message_distinct_members check (sender_id <> recipient_id),
  constraint wazobia_message_body_length check (char_length(body) between 1 and 4000)
);
create index if not exists wazobia_messages_conversation_created_idx on public.wazobia_messages(conversation_id, created_at asc);
create index if not exists wazobia_messages_recipient_unread_idx on public.wazobia_messages(recipient_id, conversation_id) where read_at is null;

alter table public.wazobia_conversations enable row level security;
alter table public.wazobia_messages enable row level security;

drop policy if exists "Conversation members can read their conversations" on public.wazobia_conversations;
create policy "Conversation members can read their conversations"
  on public.wazobia_conversations for select to authenticated
  using (participant_one = auth.uid() or participant_two = auth.uid());

drop policy if exists "Conversation members can read their messages" on public.wazobia_messages;
create policy "Conversation members can read their messages"
  on public.wazobia_messages for select to authenticated
  using (exists (
    select 1 from public.wazobia_conversations c
    where c.id = conversation_id
      and (c.participant_one = auth.uid() or c.participant_two = auth.uid())
  ));

drop policy if exists "Members send messages as themselves" on public.wazobia_messages;
create policy "Members send messages as themselves"
  on public.wazobia_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and recipient_id <> auth.uid()
    and exists (
      select 1 from public.wazobia_conversations c
      where c.id = conversation_id
        and ((c.participant_one = auth.uid() and c.participant_two = recipient_id)
          or (c.participant_two = auth.uid() and c.participant_one = recipient_id))
    )
  );

drop policy if exists "Recipients mark their messages as read" on public.wazobia_messages;
create policy "Recipients mark their messages as read"
  on public.wazobia_messages for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- No browser-side user can create arbitrary conversation pairs. The RPC verifies
-- the target member and stores the two UUIDs in a canonical order.
create or replace function public.wazobia_start_direct_conversation(target_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
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

  if current_user_id < target_user then
    first_member := current_user_id;
    second_member := target_user;
  else
    first_member := target_user;
    second_member := current_user_id;
  end if;

  insert into public.wazobia_conversations(participant_one, participant_two, created_by)
  values(first_member, second_member, current_user_id)
  on conflict (participant_one, participant_two) do nothing;

  select c.id into conversation_id
  from public.wazobia_conversations c
  where c.participant_one = first_member and c.participant_two = second_member;
  return conversation_id;
end;
$$;
revoke all on function public.wazobia_start_direct_conversation(uuid) from public;
grant execute on function public.wazobia_start_direct_conversation(uuid) to authenticated;

-- A trusted trigger updates the conversation sort timestamp after every send.
create or replace function public.wazobia_touch_direct_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.wazobia_conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists wazobia_message_touch_conversation on public.wazobia_messages;
create trigger wazobia_message_touch_conversation
after insert on public.wazobia_messages
for each row execute function public.wazobia_touch_direct_conversation();

-- Grant only the operations needed by the Messenger UI. Recipients can update
-- read_at, but cannot edit another member's message body.
revoke all on public.wazobia_conversations from anon, authenticated;
revoke all on public.wazobia_conversations from public;
grant select on public.wazobia_conversations to authenticated;

revoke all on public.wazobia_messages from anon, authenticated;
revoke all on public.wazobia_messages from public;
grant select, insert on public.wazobia_messages to authenticated;
grant update (read_at) on public.wazobia_messages to authenticated;

-- Realtime delivers incoming messages; inbox refresh also has a polling fallback.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wazobia_messages'
     ) then
    execute 'alter publication supabase_realtime add table public.wazobia_messages';
  end if;
end $$;
