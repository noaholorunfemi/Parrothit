-- PARROTHIT Wazobia Trends: friend requests, friendship management and counts.
-- Run after wazobia-trends.sql, wazobia-direct-messages.sql, and
-- wazobia-profile-calls-upgrade.sql. Safe to run more than once.

create table if not exists public.wazobia_friendships (
  id uuid primary key default gen_random_uuid(),
  member_one uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  member_two uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  requested_by uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wazobia_friendships_distinct_members check (member_one < member_two),
  constraint wazobia_friendships_requester_is_member check (requested_by in (member_one, member_two)),
  constraint wazobia_friendships_pair_unique unique (member_one, member_two)
);

create index if not exists wazobia_friendships_member_one_idx on public.wazobia_friendships(member_one, status);
create index if not exists wazobia_friendships_member_two_idx on public.wazobia_friendships(member_two, status);
create index if not exists wazobia_friendships_pending_idx on public.wazobia_friendships(status, created_at desc) where status = 'pending';

alter table public.wazobia_friendships enable row level security;
drop policy if exists "Members view their own Wazobia friendships" on public.wazobia_friendships;
create policy "Members view their own Wazobia friendships"
  on public.wazobia_friendships for select to authenticated
  using (member_one = auth.uid() or member_two = auth.uid());

revoke all on public.wazobia_friendships from anon, authenticated;
revoke all on public.wazobia_friendships from public;
grant select on public.wazobia_friendships to authenticated;

-- Returns only the relationship state between the signed-in member and target.
create or replace function public.wazobia_friendship_status(target_user uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  current_member uuid := auth.uid();
  first_member uuid;
  second_member uuid;
  relation_status text;
  relation_requester uuid;
begin
  if current_member is null then return 'signed_out'; end if;
  if target_user is null or target_user = current_member then return 'self'; end if;
  first_member := least(current_member, target_user);
  second_member := greatest(current_member, target_user);
  select f.status, f.requested_by into relation_status, relation_requester
  from public.wazobia_friendships f
  where f.member_one = first_member and f.member_two = second_member;
  if not found then return 'none'; end if;
  if relation_status = 'accepted' then return 'friends'; end if;
  if relation_requester = current_member then return 'pending_outgoing'; end if;
  return 'pending_incoming';
end;
$$;
revoke all on function public.wazobia_friendship_status(uuid) from public, anon;
grant execute on function public.wazobia_friendship_status(uuid) to authenticated;

-- A new request is pending; a request received from this same member is
-- accepted when the recipient clicks Add friend (mutual confirmation).
create or replace function public.wazobia_send_friend_request(target_user uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  current_member uuid := auth.uid();
  first_member uuid;
  second_member uuid;
  relation_status text;
  relation_requester uuid;
begin
  if current_member is null then raise exception 'Sign in to add friends.' using errcode = '28000'; end if;
  if target_user is null or target_user = current_member then raise exception 'You cannot add yourself as a friend.' using errcode = '22023'; end if;
  if not exists (select 1 from public.wazobia_profiles p where p.user_id = target_user) then
    raise exception 'This Wazobia member could not be found.' using errcode = 'P0002';
  end if;
  first_member := least(current_member, target_user);
  second_member := greatest(current_member, target_user);
  insert into public.wazobia_friendships(member_one, member_two, requested_by, status)
  values(first_member, second_member, current_member, 'pending')
  on conflict (member_one, member_two) do nothing;
  select f.status, f.requested_by into relation_status, relation_requester
  from public.wazobia_friendships f
  where f.member_one = first_member and f.member_two = second_member
  for update;
  if relation_status = 'accepted' then return 'friends'; end if;
  if relation_requester = current_member then return 'pending_outgoing'; end if;
  update public.wazobia_friendships
  set status = 'accepted', updated_at = now()
  where member_one = first_member and member_two = second_member and status = 'pending';
  return 'friends';
end;
$$;
revoke all on function public.wazobia_send_friend_request(uuid) from public, anon;
grant execute on function public.wazobia_send_friend_request(uuid) to authenticated;

create or replace function public.wazobia_respond_friend_request(target_user uuid, accept_request boolean)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  current_member uuid := auth.uid();
  first_member uuid;
  second_member uuid;
  changed_rows integer;
begin
  if current_member is null then raise exception 'Sign in to manage friend requests.' using errcode = '28000'; end if;
  if target_user is null or target_user = current_member then raise exception 'Invalid friend request.' using errcode = '22023'; end if;
  first_member := least(current_member, target_user);
  second_member := greatest(current_member, target_user);
  if coalesce(accept_request, false) then
    update public.wazobia_friendships
    set status = 'accepted', updated_at = now()
    where member_one = first_member and member_two = second_member
      and status = 'pending' and requested_by = target_user;
    get diagnostics changed_rows = row_count;
    if changed_rows = 0 then raise exception 'This incoming friend request is no longer pending.' using errcode = 'P0002'; end if;
    return 'friends';
  else
    delete from public.wazobia_friendships
    where member_one = first_member and member_two = second_member
      and status = 'pending' and requested_by = target_user;
    get diagnostics changed_rows = row_count;
    if changed_rows = 0 then raise exception 'This incoming friend request is no longer pending.' using errcode = 'P0002'; end if;
    return 'none';
  end if;
end;
$$;
revoke all on function public.wazobia_respond_friend_request(uuid, boolean) from public, anon;
grant execute on function public.wazobia_respond_friend_request(uuid, boolean) to authenticated;

create or replace function public.wazobia_cancel_friend_request(target_user uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  current_member uuid := auth.uid();
  first_member uuid;
  second_member uuid;
  changed_rows integer;
begin
  if current_member is null then raise exception 'Sign in to cancel friend requests.' using errcode = '28000'; end if;
  if target_user is null or target_user = current_member then return false; end if;
  first_member := least(current_member, target_user);
  second_member := greatest(current_member, target_user);
  delete from public.wazobia_friendships
  where member_one = first_member and member_two = second_member
    and requested_by = current_member and status = 'pending';
  get diagnostics changed_rows = row_count;
  return changed_rows > 0;
end;
$$;
revoke all on function public.wazobia_cancel_friend_request(uuid) from public, anon;
grant execute on function public.wazobia_cancel_friend_request(uuid) to authenticated;

create or replace function public.wazobia_remove_friend(target_user uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  current_member uuid := auth.uid();
  first_member uuid;
  second_member uuid;
  changed_rows integer;
begin
  if current_member is null then raise exception 'Sign in to remove friends.' using errcode = '28000'; end if;
  if target_user is null or target_user = current_member then return false; end if;
  first_member := least(current_member, target_user);
  second_member := greatest(current_member, target_user);
  delete from public.wazobia_friendships
  where member_one = first_member and member_two = second_member and status = 'accepted';
  get diagnostics changed_rows = row_count;
  return changed_rows > 0;
end;
$$;
revoke all on function public.wazobia_remove_friend(uuid) from public, anon;
grant execute on function public.wazobia_remove_friend(uuid) to authenticated;

-- Publicly exposes only a number, never the member list or relationship data.
create or replace function public.wazobia_get_friend_count(target_user uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::integer
  from public.wazobia_friendships f
  where f.status = 'accepted' and target_user in (f.member_one, f.member_two);
$$;
revoke all on function public.wazobia_get_friend_count(uuid) from public;
grant execute on function public.wazobia_get_friend_count(uuid) to anon, authenticated;
