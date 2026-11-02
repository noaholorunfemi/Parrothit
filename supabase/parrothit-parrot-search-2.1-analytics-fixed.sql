-- PARROTHIT PARROT SEARCH 2.1 — analytics dashboard upgrade (FIXED)
-- Run AFTER the working PARROT SEARCH 2.0 SQL migration.
-- Safe additive migration: preserves existing search analytics rows.
--
-- Fix: use the non-reserved/explicit alias "search_day" in the daily
-- analytics subquery instead of "day".

alter table public.parrothit_search_analytics
  add column if not exists category_name text;

create index if not exists parrothit_search_analytics_category_date_idx
  on public.parrothit_search_analytics(category_name, searched_at desc);

-- Replace the old 2-argument logger so category filters can be measured.
drop function if exists public.parrothit_log_search(text, integer);

create or replace function public.parrothit_log_search(
  search_term text,
  result_count integer default 0,
  category_name text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if length(trim(coalesce(search_term, ''))) between 2 and 160 then
    insert into public.parrothit_search_analytics
      (search_term, result_count, category_name)
    values (
      left(trim(search_term), 160),
      greatest(0, least(coalesce(result_count, 0), 1000)),
      nullif(left(trim(coalesce(category_name, '')), 100), '')
    );
  end if;
end;
$$;

revoke all on function public.parrothit_log_search(text, integer, text) from public;
grant execute on function public.parrothit_log_search(text, integer, text) to anon, authenticated;

-- One admin-only RPC supplies the dashboard metrics and chart datasets.
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

revoke all on function public.parrothit_search_admin_dashboard(integer) from public;
grant execute on function public.parrothit_search_admin_dashboard(integer) to authenticated;
