-- PARROTHIT community profile schema and policies. Run in Supabase SQL Editor.
-- This migration adds username support while retaining existing member records.
create table if not exists public.community_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default 'Community member',
  username text,
  rules_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.community_members add column if not exists username text;
alter table public.community_members add column if not exists rules_accepted_at timestamptz;
alter table public.community_members enable row level security;

-- Normalize existing usernames; empty legacy values remain NULL until profile completion.
create unique index if not exists community_members_username_unique
  on public.community_members (lower(username)) where username is not null and length(trim(username)) > 0;

drop policy if exists "Members can read own community profile" on public.community_members;
create policy "Members can read own community profile" on public.community_members
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Members can create own community profile" on public.community_members;
create policy "Members can create own community profile" on public.community_members
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Members can update own community profile" on public.community_members;
create policy "Members can update own community profile" on public.community_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.register_parrothit_community_member()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  meta_username text;
begin
  meta_username := lower(trim(coalesce(new.raw_user_meta_data->>'username','')));
  insert into public.community_members (user_id,email,display_name,username,rules_accepted_at,last_seen_at)
  values (
    new.id,
    new.email,
    left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),nullif(trim(new.raw_user_meta_data->>'full_name'),''),nullif(split_part(coalesce(new.email,''),'@',1),''),'Community member'),80),
    case when meta_username ~ '^[a-z0-9_]{3,24}$' then meta_username else null end,
    case when coalesce((new.raw_user_meta_data->>'rules_accepted')::boolean,false) then now() else null end,
    now()
  )
  on conflict (user_id) do update set email=excluded.email,last_seen_at=now();
  return new;
end;
$$;

drop trigger if exists parrothit_community_member_signup on auth.users;
create trigger parrothit_community_member_signup after insert on auth.users
for each row execute function public.register_parrothit_community_member();

-- Allows a signed-in member to check availability without reading other profiles.
create or replace function public.parrothit_username_available(candidate text)
returns boolean language sql stable security definer set search_path=public
as $$
  select lower(trim(coalesce(candidate,''))) ~ '^[a-z0-9_]{3,24}$'
     and not exists (select 1 from public.community_members m where lower(m.username)=lower(trim(candidate)));
$$;
revoke all on function public.parrothit_username_available(text) from public;
grant execute on function public.parrothit_username_available(text) to anon, authenticated;
