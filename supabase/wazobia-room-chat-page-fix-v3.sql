-- Wazobia category room group-chat repair (v3)
-- Run after community-interaction.sql, community-social-features.sql and community-admin-controls.sql.
begin;

alter table public.community_rooms add column if not exists is_active boolean not null default true;
alter table public.community_rooms add column if not exists sort_order integer not null default 100;

create table if not exists public.community_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_slug text not null references public.community_rooms(slug) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists community_room_messages_room_created_idx on public.community_room_messages(room_slug,created_at asc);
create index if not exists community_room_messages_sender_created_idx on public.community_room_messages(sender_id,created_at desc);

create or replace function public.parrothit_can_access_wazobia_room(p_room_slug text)
returns boolean language sql stable security definer set search_path=public,pg_temp set row_security=off
as $$
  select auth.uid() is not null
    and coalesce((select s.interaction_enabled and s.room_chat_enabled from public.community_interaction_settings s where s.id=1),false)
    and not coalesce((select p.is_suspended from public.community_social_profiles p where p.user_id=auth.uid()),false)
    and exists (select 1 from public.community_room_members m join public.community_rooms r on r.slug=m.room_slug where m.room_slug=p_room_slug and m.user_id=auth.uid() and r.is_active=true);
$$;
revoke all on function public.parrothit_can_access_wazobia_room(text) from public,anon;
grant execute on function public.parrothit_can_access_wazobia_room(text) to authenticated;

alter table public.community_room_messages enable row level security;
drop policy if exists "Room members read room chat messages" on public.community_room_messages;
create policy "Room members read room chat messages" on public.community_room_messages for select to authenticated using (public.parrothit_can_access_wazobia_room(room_slug));
drop policy if exists "Room members send their own chat messages" on public.community_room_messages;
create policy "Room members send their own chat messages" on public.community_room_messages for insert to authenticated with check (sender_id=auth.uid() and char_length(trim(body)) between 1 and 4000 and public.parrothit_can_access_wazobia_room(room_slug));
drop policy if exists "Members delete their own room chat messages" on public.community_room_messages;
create policy "Members delete their own room chat messages" on public.community_room_messages for delete to authenticated using (sender_id=auth.uid() and public.parrothit_can_access_wazobia_room(room_slug));
revoke all on public.community_room_messages from anon,public;
grant select,insert,delete on public.community_room_messages to authenticated;

do $realtime$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='community_room_messages') then
    execute 'alter publication supabase_realtime add table public.community_room_messages';
  end if;
end $realtime$;

commit;

select 'community_room_messages' as object_name, c.relrowsecurity as rls_enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='community_room_messages';
