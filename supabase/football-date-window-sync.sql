-- PARROTHIT LiveScore: date-window sync cache support.
-- Safe to run more than once. Does not modify API credentials or provider activation.

-- The public function reads date-only provider cache entries by a stable cache-key prefix.
-- This index improves prefix scans and fetched_at ordering as the cache grows.
create index if not exists football_public_cache_key_fetched_pattern_idx
  on public.football_public_cache (cache_key text_pattern_ops, fetched_at);

comment on table public.football_public_cache is
  'Private server-side cache for PARROTHIT football provider responses, date-window sync cursors and match-feed results. Access is restricted to service_role.';
