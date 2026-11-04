-- PARROTHIT: single active admin session per admin account.
-- Apply this migration before deploying parrothit-admin-session.

create table if not exists public.admin_active_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auth_session_id uuid not null,
  session_token_hash text not null,
  device_fingerprint text,
  device_name text not null default 'Unknown device',
  user_agent text,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists admin_active_sessions_last_activity_idx
  on public.admin_active_sessions (last_activity_at desc);
create index if not exists admin_active_sessions_auth_session_idx
  on public.admin_active_sessions (auth_session_id);

alter table public.admin_active_sessions enable row level security;
revoke all on public.admin_active_sessions from anon, authenticated;
grant all on public.admin_active_sessions to service_role;

create table if not exists public.admin_session_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  target_user_id uuid,
  action text not null,
  device_name text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_session_audit_created_at_idx
  on public.admin_session_audit (created_at desc);
create index if not exists admin_session_audit_target_idx
  on public.admin_session_audit (target_user_id, created_at desc);

alter table public.admin_session_audit enable row level security;
revoke all on public.admin_session_audit from anon, authenticated;
grant all on public.admin_session_audit to service_role;

-- One atomic claim per admin. A fresh session with a different token blocks the
-- new device. A session idle for more than five minutes is treated as abandoned.
create or replace function public.parrothit_claim_admin_session(
  p_user_id uuid,
  p_auth_session_id uuid,
  p_session_token_hash text,
  p_device_fingerprint text,
  p_device_name text,
  p_user_agent text
)
returns table (
  accepted boolean,
  active_device_name text,
  active_since timestamptz,
  active_last_activity timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.admin_active_sessions%rowtype;
begin
  if p_user_id is null or p_auth_session_id is null or p_session_token_hash is null or length(p_session_token_hash) <> 64 then
    raise exception 'Invalid session claim.' using errcode = '22023';
  end if;

  -- Serializes simultaneous attempts for the same admin account.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

  select * into v_current
  from public.admin_active_sessions s
  where s.user_id = p_user_id
  for update;

  if found
     and v_current.expires_at > pg_catalog.now()
     and v_current.last_activity_at > pg_catalog.now() - interval '5 minutes' then
    if v_current.session_token_hash = p_session_token_hash then
      update public.admin_active_sessions
      set auth_session_id = p_auth_session_id,
          last_activity_at = pg_catalog.now(),
          expires_at = pg_catalog.now() + interval '30 days',
          device_name = coalesce(nullif(p_device_name, ''), device_name),
          user_agent = coalesce(nullif(p_user_agent, ''), user_agent),
          device_fingerprint = coalesce(nullif(p_device_fingerprint, ''), device_fingerprint)
      where user_id = p_user_id;
      return query select true, v_current.device_name, v_current.created_at, pg_catalog.now();
      return;
    end if;

    return query select false, v_current.device_name, v_current.created_at, v_current.last_activity_at;
    return;
  end if;

  delete from public.admin_active_sessions where user_id = p_user_id;
  insert into public.admin_active_sessions (
    user_id, auth_session_id, session_token_hash, device_fingerprint, device_name,
    user_agent, created_at, last_activity_at, expires_at
  ) values (
    p_user_id, p_auth_session_id, p_session_token_hash, nullif(p_device_fingerprint, ''),
    coalesce(nullif(p_device_name, ''), 'Unknown device'),
    nullif(p_user_agent, ''), pg_catalog.now(), pg_catalog.now(), pg_catalog.now() + interval '30 days'
  );

  return query select true, coalesce(nullif(p_device_name, ''), 'Unknown device'), pg_catalog.now(), pg_catalog.now();
end;
$$;

revoke all on function public.parrothit_claim_admin_session(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.parrothit_claim_admin_session(uuid, uuid, text, text, text, text) to service_role;

-- The current Supabase Auth session_id claim binds the database lock to the JWT.
-- This restrictive policy is ANDed with each table's existing permissive RLS rules.
-- Non-admin authenticated users pass unchanged; administrators must hold the exact
-- registered Auth session and a fresh (five-minute) activity lease.
create or replace function public.parrothit_is_active_admin_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from public.admin_profiles p where p.user_id = auth.uid()
  ) then (
    exists (
      select 1 from public.admin_profiles p
      where p.user_id = auth.uid()
        and lower(coalesce(p.role, '')) in ('owner', 'admin')
        and p.is_suspended is not true
    )
    and exists (
      select 1 from public.admin_active_sessions s
      where s.user_id = auth.uid()
        and s.auth_session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.expires_at > pg_catalog.now()
        and s.last_activity_at > pg_catalog.now() - interval '5 minutes'
    )
  ) else true end;
$$;
revoke all on function public.parrothit_is_active_admin_session() from public, anon;
grant execute on function public.parrothit_is_active_admin_session() to authenticated, service_role;

do $$
declare
  target record;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and c.relrowsecurity = true
      and c.relname not in ('admin_active_sessions', 'admin_session_audit')
  loop
    execute pg_catalog.format('drop policy if exists %I on %I.%I',
      'parrothit_single_admin_session_guard', target.schema_name, target.table_name);
    execute pg_catalog.format(
      'create policy %I on %I.%I as restrictive for all to authenticated using (public.parrothit_is_active_admin_session()) with check (public.parrothit_is_active_admin_session())',
      'parrothit_single_admin_session_guard', target.schema_name, target.table_name
    );
  end loop;
end;
$$;

comment on table public.admin_active_sessions is
  'PARROTHIT single active admin browser/device session lock. Service-role access only.';
comment on table public.admin_session_audit is
  'PARROTHIT admin session security events. Service-role access only.';


-- Make all existing policy/helper checks depend on the same live device lock.
-- This also hardens SECURITY DEFINER RPCs that call these shared predicates.
create or replace function public.is_parrothit_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admin_profiles p
    where p.user_id = auth.uid()
      and p.is_suspended is not true
  ) and public.parrothit_is_active_admin_session();
$$;
revoke all on function public.is_parrothit_admin() from public;
grant execute on function public.is_parrothit_admin() to anon, authenticated;

create or replace function public.is_parrothit_owner()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admin_profiles p
    where p.user_id = auth.uid()
      and lower(coalesce(p.role, '')) = 'owner'
      and p.is_suspended is not true
  ) and public.parrothit_is_active_admin_session();
$$;
revoke all on function public.is_parrothit_owner() from public, anon;
grant execute on function public.is_parrothit_owner() to authenticated;


-- Harden existing SECURITY DEFINER admin RPCs without changing their behavior.
create or replace function public.approve_category_card_review(
  p_queue_id uuid,
  p_title text,
  p_summary text,
  p_body text,
  p_image_url text default null,
  p_source_url text default null,
  p_source_name text default null,
  p_review_notes text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue public.category_card_review_queue%rowtype;
  v_post public.posts%rowtype;
  v_now timestamptz := now();
begin
  if not exists (
    select 1 from public.admin_profiles ap
    where ap.user_id = auth.uid()
      and ap.role in ('owner','admin')
      and ap.is_suspended = false
      and public.parrothit_is_active_admin_session()
  ) then
    raise exception 'Active PARROTHIT administrator access is required.';
  end if;
  if coalesce(length(trim(p_title)),0) < 5 then raise exception 'Enter a valid article headline.'; end if;
  if coalesce(length(trim(p_summary)),0) < 20 then raise exception 'Enter an article summary of at least 20 characters.'; end if;
  if coalesce(length(trim(p_body)),0) < 250 then raise exception 'The article body must contain at least 250 characters before approval.'; end if;

  select * into v_queue from public.category_card_review_queue
  where id = p_queue_id for update;
  if not found then raise exception 'The article was not found in the Category Card review queue.'; end if;
  if v_queue.review_status not in ('in_review','changes_required') then
    raise exception 'Only articles awaiting human review can be approved.';
  end if;

  select * into v_post from public.posts where id = v_queue.post_id for update;
  if not found then raise exception 'The linked article no longer exists.'; end if;

  update public.posts set
    title = trim(p_title),
    summary = trim(p_summary),
    body = trim(p_body),
    image_url = nullif(trim(coalesce(p_image_url,'')),''),
    source_url = nullif(trim(coalesce(p_source_url,'')),''),
    source_name = nullif(trim(coalesce(p_source_name,'')),''),
    status = 'draft',
    published_at = null,
    reviewed_by = auth.uid(),
    reviewed_at = v_now,
    updated_at = v_now
  where id = v_queue.post_id;

  update public.category_card_review_queue set
    review_status = 'approved',
    review_notes = coalesce(p_review_notes,''),
    reviewed_by = auth.uid(),
    reviewed_at = v_now,
    updated_at = v_now
  where id = p_queue_id;

  return jsonb_build_object('ok',true,'queue_id',p_queue_id,'post_id',v_queue.post_id,'review_status','approved');
end;
$$;

create or replace function public.publish_category_card_assignment(
  p_queue_id uuid,
  p_category_id uuid,
  p_category_key text,
  p_card_position integer,
  p_confirm_replace boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue public.category_card_review_queue%rowtype;
  v_post public.posts%rowtype;
  v_category public.categories%rowtype;
  v_existing public.category_card_assignments%rowtype;
  v_settings jsonb;
  v_category_settings jsonb;
  v_current_card jsonb;
  v_new_card jsonb;
  v_now timestamptz := now();
  v_occupied boolean := false;
  v_old_post_id uuid;
  v_occupied_standard integer := 0;
begin
  if not exists (
    select 1 from public.admin_profiles ap
    where ap.user_id = auth.uid()
      and ap.role in ('owner','admin')
      and ap.is_suspended = false
      and public.parrothit_is_active_admin_session()
  ) then
    raise exception 'Active PARROTHIT administrator access is required.';
  end if;
  if p_card_position is null or p_card_position < 1 or p_card_position > 32767 then
    raise exception 'Choose a valid news card position from 1 to 32767.';
  end if;
  if p_category_key is null or p_category_key !~ '^[a-z0-9-]{1,80}$' then
    raise exception 'Invalid category page key.';
  end if;
  select * into v_category from public.categories where id = p_category_id;
  if not found then raise exception 'Choose a valid category.'; end if;

  select * into v_queue from public.category_card_review_queue
  where id = p_queue_id for update;
  if not found then raise exception 'The review queue item was not found.'; end if;
  if v_queue.review_status <> 'approved' then
    raise exception 'Human review approval is required before a news card can be published.';
  end if;
  select * into v_post from public.posts where id = v_queue.post_id for update;
  if not found then raise exception 'The approved article no longer exists.'; end if;
  if v_post.status not in ('draft','in_review') then
    raise exception 'This article is not in an unpublished state.';
  end if;

  select * into v_existing from public.category_card_assignments
  where category_key = p_category_key and card_position = p_card_position for update;
  if found and v_existing.post_id <> v_post.id then
    v_occupied := true;
    v_old_post_id := v_existing.post_id;
  end if;

  select value into v_settings from public.site_settings where key = 'category_cards' for update;
  v_settings := coalesce(v_settings, '{}'::jsonb);
  v_category_settings := coalesce(v_settings -> p_category_key, '{}'::jsonb);

  -- Positions 7+ are legal only after all six original category cards are occupied.
  -- Count both normalized assignment rows and the shared JSON records used by public pages.
  if p_card_position > 6 then
    select count(*) into v_occupied_standard
    from generate_series(1, 6) as slot(position)
    where exists (
      select 1 from public.category_card_assignments a
      where a.category_key = p_category_key and a.card_position = slot.position
    ) or (
      jsonb_typeof(v_category_settings -> slot.position::text) = 'object'
      and (
        coalesce(v_category_settings -> slot.position::text ->> 'postId', '') <> ''
        or coalesce(v_category_settings -> slot.position::text ->> 'newsroomPostId', '') <> ''
        or coalesce(v_category_settings -> slot.position::text ->> 'title', '') <> ''
        or coalesce(v_category_settings -> slot.position::text ->> 'text', '') <> ''
        or coalesce(v_category_settings -> slot.position::text ->> 'image', '') <> ''
        or coalesce(v_category_settings -> slot.position::text ->> 'imageUrl', '') <> ''
      )
    );
    if v_occupied_standard < 6 then
      raise exception 'ADDITIONAL_CARD_NOT_ALLOWED: Use an available original category card (1–6) before creating an additional card.';
    end if;
  end if;

  v_current_card := v_category_settings -> p_card_position::text;
  if v_current_card is not null and v_current_card <> 'null'::jsonb then
    if coalesce(v_current_card ->> 'postId', v_current_card ->> 'newsroomPostId','') <> v_post.id::text then
      if coalesce(v_current_card ->> 'title','') <> '' or coalesce(v_current_card ->> 'text','') <> '' or coalesce(v_current_card ->> 'image','') <> '' or coalesce(v_current_card ->> 'imageUrl','') <> '' then
        v_occupied := true;
      end if;
    end if;
  end if;
  if v_occupied and not coalesce(p_confirm_replace,false) then
    raise exception 'CARD_SLOT_OCCUPIED: This category card already contains an article. Confirm replacement to continue.';
  end if;

  update public.posts set
    category_id = p_category_id,
    status = 'published',
    published_at = v_now,
    reviewed_by = coalesce(reviewed_by, auth.uid()),
    reviewed_at = coalesce(reviewed_at, v_now),
    updated_at = v_now
  where id = v_post.id;

  v_new_card := jsonb_build_object(
    'title', v_post.title,
    'text', coalesce(nullif(v_post.summary,''), left(v_post.body,500)),
    'image', coalesce(v_post.image_url,''),
    'imageUrl', coalesce(v_post.image_url,''),
    'targetUrl', 'article.html?slug=' || v_post.slug,
    'enabled', true,
    'updatedAt', v_now,
    'createdAt', coalesce(v_post.published_at, v_now),
    'postId', v_post.id::text,
    'newsroomPostId', v_post.id::text
  );

  v_category_settings := jsonb_set(v_category_settings, array[p_card_position::text], v_new_card, true);
  v_settings := jsonb_set(v_settings, array[p_category_key], v_category_settings, true);
  insert into public.site_settings(key, value, updated_at)
  values ('category_cards', v_settings, v_now)
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  insert into public.category_card_assignments(category_key, category_id, card_position, post_id, assigned_by, assigned_at)
  values (p_category_key, p_category_id, p_card_position, v_post.id, auth.uid(), v_now)
  on conflict (category_key, card_position) do update set
    category_id = excluded.category_id,
    post_id = excluded.post_id,
    assigned_by = excluded.assigned_by,
    assigned_at = excluded.assigned_at;

  update public.category_card_review_queue set
    review_status = 'published',
    assigned_category_id = p_category_id,
    assigned_category_key = p_category_key,
    assigned_card = p_card_position,
    assigned_at = v_now,
    published_at = v_now,
    reviewed_by = coalesce(reviewed_by, auth.uid()),
    reviewed_at = coalesce(reviewed_at, v_now),
    updated_at = v_now
  where id = p_queue_id;

  update public.newsroom_candidates set status = 'imported', updated_at = v_now
  where id = v_queue.candidate_id;


  return jsonb_build_object('ok',true,'post_id',v_post.id,'category',v_category.name,'category_key',p_category_key,'card_position',p_card_position,'replaced_post_id',v_old_post_id,'published_at',v_now);
end;
$$;

create or replace function public.remove_category_card_assignment(
  p_category_key text,
  p_card_position integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
  v_category_settings jsonb;
  v_card jsonb;
  v_post_id text;
  v_now timestamptz := now();
begin
  if not exists (
    select 1 from public.admin_profiles ap
    where ap.user_id = auth.uid()
      and ap.role in ('owner','admin')
      and ap.is_suspended = false
      and public.parrothit_is_active_admin_session()
  ) then
    raise exception 'Active PARROTHIT administrator access is required.';
  end if;

  if p_category_key is null or p_category_key !~ '^[a-z0-9-]{1,80}$' then
    raise exception 'Invalid category page key.';
  end if;
  if p_card_position is null or p_card_position < 1 or p_card_position > 32767 then
    raise exception 'Choose a valid category card position.';
  end if;

  select value into v_settings
  from public.site_settings
  where key = 'category_cards'
  for update;
  v_settings := coalesce(v_settings, '{}'::jsonb);
  v_category_settings := coalesce(v_settings -> p_category_key, '{}'::jsonb);
  v_card := v_category_settings -> p_card_position::text;
  v_post_id := nullif(coalesce(v_card ->> 'postId', v_card ->> 'newsroomPostId'), '');

  delete from public.category_card_assignments
  where category_key = p_category_key
    and card_position = p_card_position;

  v_category_settings := v_category_settings - p_card_position::text;
  v_settings := jsonb_set(v_settings, array[p_category_key], v_category_settings, true);

  insert into public.site_settings(key, value, updated_at)
  values ('category_cards', v_settings, v_now)
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'category_key', p_category_key,
    'card_position', p_card_position,
    'removed_post_id', v_post_id,
    'article_remains_published', true
  );
end;
$$;

create or replace function public.parrothit_search_admin_analytics()
returns table(searches_last_7_days bigint,zero_result_searches bigint,top_terms jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.admin_profiles ap where ap.user_id=auth.uid() and coalesce(ap.is_suspended,false)=false
      and public.parrothit_is_active_admin_session()) then
  raise exception 'Administrator access required';
 end if;
 return query
 select (select count(*) from public.parrothit_search_analytics where searched_at>now()-interval '7 days'),
        (select count(*) from public.parrothit_search_analytics where searched_at>now()-interval '7 days' and result_count=0),
        (select coalesce(jsonb_agg(jsonb_build_object('term',term,'count',n) order by n desc),'[]'::jsonb) from
          (select min(search_term) term,count(*) n from public.parrothit_search_analytics where searched_at>now()-interval '30 days' group by lower(search_term) order by count(*) desc limit 20) t);
end;$$;

create or replace function public.parrothit_search_admin_dashboard(
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer := greatest(7, least(coalesce(p_days, 30), 90));
  v_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.admin_profiles ap
    where ap.user_id = auth.uid()
      and coalesce(ap.is_suspended, false) = false
      and public.parrothit_is_active_admin_session()
  ) then
    raise exception 'Administrator access required';
  end if;

  select jsonb_build_object(
    'period_days', v_days,
    'today_searches', (
      select count(*)
      from public.parrothit_search_analytics
      where searched_at >= date_trunc('day', now())
    ),
    'week_searches', (
      select count(*)
      from public.parrothit_search_analytics
      where searched_at >= now() - interval '7 days'
    ),
    'month_searches', (
      select count(*)
      from public.parrothit_search_analytics
      where searched_at >= now() - interval '30 days'
    ),
    'zero_result_searches', (
      select count(*)
      from public.parrothit_search_analytics
      where searched_at >= now() - make_interval(days => v_days)
        and result_count = 0
    ),
    'successful_searches', (
      select count(*)
      from public.parrothit_search_analytics
      where searched_at >= now() - make_interval(days => v_days)
        and result_count > 0
    ),
    'success_rate', coalesce((
      select round(
        100.0 * count(*) filter (where result_count > 0) / nullif(count(*), 0),
        1
      )
      from public.parrothit_search_analytics
      where searched_at >= now() - make_interval(days => v_days)
    ), 0),
    'daily', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'day', d.day::date,
          'searches', coalesce(a.search_count, 0)
        )
        order by d.day
      )
      from generate_series(
        date_trunc('day', now()) - make_interval(days => v_days - 1),
        date_trunc('day', now()),
        interval '1 day'
      ) as d(day)
      left join (
        select
          date_trunc('day', searched_at) as search_day,
          count(*) as search_count
        from public.parrothit_search_analytics
        where searched_at >= date_trunc('day', now()) - make_interval(days => v_days - 1)
        group by date_trunc('day', searched_at)
      ) as a
        on a.search_day = d.day
    ), '[]'::jsonb),
    'top_terms', coalesce((
      select jsonb_agg(
        jsonb_build_object('term', term, 'searches', n)
        order by n desc
      )
      from (
        select min(search_term) as term, count(*) as n
        from public.parrothit_search_analytics
        where searched_at >= now() - make_interval(days => v_days)
        group by lower(search_term)
        order by count(*) desc
        limit 15
      ) as t
    ), '[]'::jsonb),
    'zero_terms', coalesce((
      select jsonb_agg(
        jsonb_build_object('term', term, 'searches', n)
        order by n desc
      )
      from (
        select min(search_term) as term, count(*) as n
        from public.parrothit_search_analytics
        where searched_at >= now() - make_interval(days => v_days)
          and result_count = 0
        group by lower(search_term)
        order by count(*) desc
        limit 15
      ) as z
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object('category', category, 'searches', n)
        order by n desc
      )
      from (
        select category_name as category, count(*) as n
        from public.parrothit_search_analytics
        where searched_at >= now() - make_interval(days => v_days)
          and category_name is not null
        group by category_name
        order by count(*) desc
        limit 22
      ) as c
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;


revoke all on function public.approve_category_card_review(uuid,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.approve_category_card_review(uuid,text,text,text,text,text,text,text) to authenticated;
revoke all on function public.publish_category_card_assignment(uuid,uuid,text,integer,boolean) from public, anon;
grant execute on function public.publish_category_card_assignment(uuid,uuid,text,integer,boolean) to authenticated;
revoke all on function public.remove_category_card_assignment(text,integer) from public, anon;
grant execute on function public.remove_category_card_assignment(text,integer) to authenticated;
revoke all on function public.parrothit_search_admin_analytics() from public;
grant execute on function public.parrothit_search_admin_analytics() to authenticated;
revoke all on function public.parrothit_search_admin_dashboard(integer) from public;
grant execute on function public.parrothit_search_admin_dashboard(integer) to authenticated;


-- Periodically remove idle/expired rows. If pg_cron is not installed, stale rows
-- are still reclaimed transactionally on the next login and removed on validation.
do $$
declare
  existing_job_id bigint;
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    select jobid into existing_job_id from cron.job where jobname = 'parrothit-admin-session-cleanup' limit 1;
    if existing_job_id is not null then
      perform cron.unschedule(existing_job_id);
    end if;
    perform cron.schedule(
      'parrothit-admin-session-cleanup',
      '*/5 * * * *',
      $job$delete from public.admin_active_sessions where expires_at <= now() or last_activity_at <= now() - interval '5 minutes';$job$
    );
  end if;
end;
$$;

notify pgrst, 'reload schema';
