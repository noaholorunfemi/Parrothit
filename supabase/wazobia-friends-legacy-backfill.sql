-- One-time, repeat-safe migration of legacy Interaction friendships into Wazobia Trends.
-- Run after supabase/wazobia-trends.sql and supabase/wazobia-friends-and-header-fix.sql.
-- Existing Wazobia friendships are preserved; accepted status wins over pending.
-- Legacy public-safe profile fields are copied first so older friends remain discoverable.

do $$
begin
  if to_regclass('public.wazobia_profiles') is null or to_regclass('public.wazobia_friendships') is null then
    raise exception 'Run wazobia-trends.sql and wazobia-friends-and-header-fix.sql before this backfill.';
  end if;

  if to_regclass('public.community_social_profiles') is not null then
    insert into public.wazobia_profiles
      (user_id, display_name, username, avatar_url, bio, created_at, updated_at)
    select
      c.user_id,
      left(coalesce(nullif(trim(c.display_name),''),'Wazobia member'),60),
      case
        when c.username ~ '^[a-z0-9_]{3,24}$'
          and not exists (
            select 1 from public.wazobia_profiles p
            where lower(p.username)=lower(c.username) and p.user_id<>c.user_id
          )
        then lower(c.username)
        else 'wz_' || left(replace(c.user_id::text,'-',''),21)
      end,
      c.avatar_url,
      left(coalesce(c.bio,''),240),
      coalesce(c.created_at,now()),
      coalesce(c.updated_at,c.created_at,now())
    from public.community_social_profiles c
    join auth.users u on u.id=c.user_id
    on conflict (user_id) do nothing;
  end if;

  if to_regclass('public.community_friendships') is not null then
    insert into public.wazobia_friendships as current_friendship
      (member_one, member_two, requested_by, status, created_at, updated_at)
    select
      least(f.requester_id, f.addressee_id),
      greatest(f.requester_id, f.addressee_id),
      f.requester_id,
      f.status,
      coalesce(f.created_at, now()),
      coalesce(f.updated_at, f.created_at, now())
    from public.community_friendships f
    where f.status in ('pending','accepted')
      and f.requester_id <> f.addressee_id
      and exists (select 1 from public.wazobia_profiles p where p.user_id=f.requester_id)
      and exists (select 1 from public.wazobia_profiles p where p.user_id=f.addressee_id)
    on conflict (member_one, member_two) do update
      set status = case
            when current_friendship.status='accepted' or excluded.status='accepted' then 'accepted'
            else current_friendship.status
          end,
          updated_at = now();
  end if;
end $$;
