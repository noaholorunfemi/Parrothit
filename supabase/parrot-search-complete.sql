-- PARROTHIT Parrot Search: indexed search of public published news, categories, and approved public community posts/comments.
-- Run in the Supabase SQL Editor. Public-search functions filter out unpublished news and unapproved community posts.

create index if not exists parrothit_posts_public_search_gin
on public.posts using gin (
  to_tsvector('simple',
    coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body, '') || ' ' ||
    coalesce(author_name, '') || ' ' || coalesce(source_name, '') || ' ' ||
    coalesce(source_url, '') || ' ' || coalesce(slug, '') || ' ' ||
    coalesce(seo_title, '') || ' ' || coalesce(seo_description, '')
  )
);

create or replace function public.parrothit_search_public(search_term text, result_limit integer default 35)
returns table (
  id uuid,
  title text,
  slug text,
  summary text,
  body text,
  category_id uuid,
  category_name text,
  author_name text,
  source_name text,
  source_url text,
  published_at timestamptz,
  seo_title text,
  seo_description text,
  rank real
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with q as (
    select websearch_to_tsquery('simple', nullif(trim(coalesce(search_term, '')), '')) as query
  ), indexed as (
    select
      p.id, p.title, p.slug, p.summary, p.body, p.category_id,
      c.name as category_name, p.author_name, p.source_name, p.source_url,
      p.published_at, p.seo_title, p.seo_description,
      to_tsvector('simple',
        coalesce(p.title, '') || ' ' || coalesce(p.summary, '') || ' ' || coalesce(p.body, '') || ' ' ||
        coalesce(p.author_name, '') || ' ' || coalesce(p.source_name, '') || ' ' ||
        coalesce(p.source_url, '') || ' ' || coalesce(p.slug, '') || ' ' ||
        coalesce(p.seo_title, '') || ' ' || coalesce(p.seo_description, '')
      ) as document,
      q.query
    from public.posts p
    left join public.categories c on c.id = p.category_id
    cross join q
    where p.status = 'published'
      and (p.published_at is null or p.published_at <= now())
      and q.query is not null
  )
  select
    indexed.id, indexed.title, indexed.slug, indexed.summary, indexed.body,
    indexed.category_id, indexed.category_name, indexed.author_name, indexed.source_name,
    indexed.source_url, indexed.published_at, indexed.seo_title, indexed.seo_description,
    ts_rank_cd(indexed.document, indexed.query)::real as rank
  from indexed
  where indexed.document @@ indexed.query
     or coalesce(indexed.title, '') ilike '%' || trim(search_term) || '%'
     or coalesce(indexed.summary, '') ilike '%' || trim(search_term) || '%'
     or coalesce(indexed.body, '') ilike '%' || trim(search_term) || '%'
     or coalesce(indexed.author_name, '') ilike '%' || trim(search_term) || '%'
     or coalesce(indexed.source_name, '') ilike '%' || trim(search_term) || '%'
     or coalesce(indexed.source_url, '') ilike '%' || trim(search_term) || '%'
     or coalesce(indexed.slug, '') ilike '%' || trim(search_term) || '%'
     or coalesce(indexed.seo_title, '') ilike '%' || trim(search_term) || '%'
     or coalesce(indexed.seo_description, '') ilike '%' || trim(search_term) || '%'
     or coalesce(indexed.category_name, '') ilike '%' || trim(search_term) || '%'
  order by rank desc, indexed.published_at desc nulls last
  limit greatest(1, least(coalesce(result_limit, 35), 100));
$$;

revoke all on function public.parrothit_search_public(text, integer) from public;
grant execute on function public.parrothit_search_public(text, integer) to anon, authenticated;

-- Approved comments on published news stories are searchable; pending/hidden comments are not.
DO $public_comment_search_setup$
BEGIN
  IF to_regclass('public.comments') IS NOT NULL THEN
    EXECUTE $public_comment_index$
      CREATE INDEX IF NOT EXISTS parrothit_approved_comments_search_gin
      ON public.comments USING gin (to_tsvector('simple', coalesce(visitor_name, '') || ' ' || coalesce(body, '')))
      WHERE status = 'approved'
    $public_comment_index$;
    EXECUTE $public_comment_function$
      CREATE OR REPLACE FUNCTION public.parrothit_search_public_comments(search_term text, result_limit integer DEFAULT 35)
      RETURNS TABLE (
        id uuid,
        post_id uuid,
        post_title text,
        post_slug text,
        visitor_name text,
        body text,
        commented_at timestamptz,
        rank real
      )
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $public_comment_body$
        WITH q AS (SELECT websearch_to_tsquery('simple', nullif(trim(coalesce(search_term, '')), '')) AS query),
        indexed AS (
          SELECT c.id, c.post_id, p.title AS post_title, p.slug AS post_slug,
                 c.visitor_name, c.body, c.created_at AS commented_at,
                 to_tsvector('simple', coalesce(c.visitor_name, '') || ' ' || coalesce(c.body, '')) AS document,
                 q.query
          FROM public.comments c
          JOIN public.posts p ON p.id = c.post_id
          CROSS JOIN q
          WHERE c.status = 'approved'
            AND p.status = 'published'
            AND (p.published_at IS NULL OR p.published_at <= now())
            AND q.query IS NOT NULL
        )
        SELECT i.id, i.post_id, i.post_title, i.post_slug, i.visitor_name, i.body, i.commented_at,
               ts_rank_cd(i.document, i.query)::real AS rank
        FROM indexed i
        WHERE i.document @@ i.query
           OR coalesce(i.visitor_name, '') ILIKE '%' || trim(search_term) || '%'
           OR coalesce(i.body, '') ILIKE '%' || trim(search_term) || '%'
           OR coalesce(i.post_title, '') ILIKE '%' || trim(search_term) || '%'
        ORDER BY rank DESC, i.commented_at DESC NULLS LAST
        LIMIT greatest(1, least(coalesce(result_limit, 35), 100));
      $public_comment_body$;
    $public_comment_function$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.parrothit_search_public_comments(text, integer) FROM public';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.parrothit_search_public_comments(text, integer) TO anon, authenticated';
  END IF;
END
$public_comment_search_setup$;

-- Public visitors still do not get write permissions or unpublished article records.
grant select on public.posts, public.categories to anon, authenticated;


-- Category labels and slugs are public searchable vocabulary too.
create index if not exists parrothit_categories_name_search_idx on public.categories using gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(slug, '')));

-- Search needs to read only the same public display settings that the public homepage uses.
-- This allowlist deliberately excludes private preferences, secrets, auth/admin settings and logs.
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read searchable display settings" ON public.site_settings;
CREATE POLICY "Public read searchable display settings" ON public.site_settings
  FOR SELECT TO anon, authenticated
  USING (key IN ('homepage_slides','home_video','category_images','ads','moving_text','home_tickler','news_cards','advertisement_cards','category_cards','news_ads_appearance','homepage_cards','sports_streams'));
GRANT SELECT ON public.site_settings TO anon, authenticated;


-- Community search is created only when the optional social tables exist. It returns
-- approved public posts/comments and never returns private email/contact/profile fields.
DO $community_search_setup$
BEGIN
  IF to_regclass('public.community_shared_posts') IS NOT NULL
     AND to_regclass('public.community_post_comments') IS NOT NULL THEN
    EXECUTE $community_post_index$CREATE INDEX IF NOT EXISTS parrothit_community_posts_search_gin ON public.community_shared_posts USING gin (to_tsvector('simple', coalesce(post_data::text, '')))$community_post_index$;
    EXECUTE $community_comment_index$CREATE INDEX IF NOT EXISTS parrothit_community_comments_search_gin ON public.community_post_comments USING gin (to_tsvector('simple', coalesce(comment_data::text, '')))$community_comment_index$;

    EXECUTE $community_function$
      CREATE OR REPLACE FUNCTION public.parrothit_search_community_public(search_term text, result_limit integer DEFAULT 35)
      RETURNS TABLE (
        post_id text,
        room_slug text,
        title text,
        body text,
        author_name text,
        published_at timestamptz,
        match_type text,
        rank real
      )
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $community_body$
        WITH q AS (
          SELECT websearch_to_tsquery('simple', nullif(trim(coalesce(search_term, '')), '')) AS query
        ), post_matches AS (
          SELECT
            p.post_id,
            p.room_slug,
            coalesce(nullif(p.post_data->>'title', ''), nullif(p.post_data->>'caption', ''), 'Community post')::text AS title,
            left(concat_ws(' ', nullif(p.post_data->>'text', ''), nullif(p.post_data->>'status_text', ''), nullif(p.post_data->>'feeling', ''), nullif(p.post_data->>'room', ''), coalesce(p.post_data->'tagged_usernames', 'null'::jsonb)::text), 4000)::text AS body,
            coalesce(nullif(p.post_data->>'display_name', ''), nullif(p.post_data->>'author_name', ''), nullif(p.post_data->>'username', ''), 'Community member')::text AS author_name,
            p.created_at AS published_at,
            'Post'::text AS match_type,
            ts_rank_cd(to_tsvector('simple', coalesce(p.post_data::text, '')), q.query)::real AS rank,
            to_tsvector('simple', coalesce(p.post_data::text, '')) AS document,
            q.query
          FROM public.community_shared_posts p
          CROSS JOIN q
          WHERE p.approved = true AND q.query IS NOT NULL
        ), comment_matches AS (
          SELECT
            c.post_id,
            p.room_slug,
            (coalesce(nullif(c.comment_data->>'author_name', ''), nullif(c.comment_data->>'username', ''), 'Community member') || ' comment')::text AS title,
            left(coalesce(c.comment_data->>'text', ''), 4000)::text AS body,
            coalesce(nullif(c.comment_data->>'display_name', ''), nullif(c.comment_data->>'author_name', ''), nullif(c.comment_data->>'username', ''), 'Community member')::text AS author_name,
            c.created_at AS published_at,
            'Comment'::text AS match_type,
            ts_rank_cd(to_tsvector('simple', coalesce(c.comment_data::text, '')), q.query)::real AS rank,
            to_tsvector('simple', coalesce(c.comment_data::text, '')) AS document,
            q.query
          FROM public.community_post_comments c
          JOIN public.community_shared_posts p ON p.post_id = c.post_id AND p.approved = true
          CROSS JOIN q
          WHERE q.query IS NOT NULL
        ), matches AS (
          SELECT * FROM post_matches
          UNION ALL
          SELECT * FROM comment_matches
        )
        SELECT m.post_id, m.room_slug, m.title, m.body, m.author_name, m.published_at, m.match_type, m.rank
        FROM matches m
        WHERE m.document @@ m.query
           OR coalesce(m.title, '') ILIKE '%' || trim(search_term) || '%'
           OR coalesce(m.body, '') ILIKE '%' || trim(search_term) || '%'
           OR coalesce(m.author_name, '') ILIKE '%' || trim(search_term) || '%'
        ORDER BY m.rank DESC, m.published_at DESC NULLS LAST
        LIMIT greatest(1, least(coalesce(result_limit, 35), 100));
      $community_body$;
    $community_function$;

    EXECUTE 'REVOKE ALL ON FUNCTION public.parrothit_search_community_public(text, integer) FROM public';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.parrothit_search_community_public(text, integer) TO anon, authenticated';
  END IF;
END
$community_search_setup$;
