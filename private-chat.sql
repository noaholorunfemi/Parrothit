-- PARROTHIT private one-to-one messaging
-- Run after community-social-features.sql in Supabase SQL Editor.
create table if not exists public.community_direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  constraint community_direct_messages_no_self check (sender_id <> recipient_id)
);
create index if not exists community_direct_messages_pair_created
  on public.community_direct_messages (sender_id, recipient_id, created_at);
alter table public.community_direct_messages enable row level security;
drop policy if exists "Members read their own private messages" on public.community_direct_messages;
create policy "Members read their own private messages"
on public.community_direct_messages for select to authenticated
using (auth.uid() = sender_id or auth.uid() = recipient_id);
drop policy if exists "Members send private messages to friends" on public.community_direct_messages;
create policy "Members send private messages to friends"
on public.community_direct_messages for insert to authenticated
with check (
  auth.uid() = sender_id
  and exists (
    select 1 from public.community_friendships f
    where f.status = 'accepted'
      and ((f.requester_id = sender_id and f.addressee_id = recipient_id)
        or (f.requester_id = recipient_id and f.addressee_id = sender_id))
  )
);
grant select, insert on public.community_direct_messages to authenticated;
