-- PARROTHIT Highlights TV: YouTube playlist discovery / embeddability metadata.
-- Run AFTER parrothit-livescore-highlights-activation-repair.sql.
-- Safe to re-run. Existing stations and activation rules are preserved.

alter table public.parrothit_livescore_highlight_stations
  add column if not exists youtube_api_verification_status text not null default 'NOT_CHECKED',
  add column if not exists youtube_api_verified_at timestamptz,
  add column if not exists youtube_api_sampled_count integer not null default 0,
  add column if not exists youtube_api_embeddable_count integer not null default 0,
  add column if not exists youtube_api_blocked_count integer not null default 0,
  add column if not exists youtube_api_unavailable_count integer not null default 0,
  add column if not exists youtube_api_publisher_title text,
  add column if not exists youtube_api_playlist_title text,
  add column if not exists youtube_api_note text;

alter table public.parrothit_livescore_highlight_stations
  drop constraint if exists parrothit_highlight_youtube_api_status_check;
alter table public.parrothit_livescore_highlight_stations
  add constraint parrothit_highlight_youtube_api_status_check check (
    youtube_api_verification_status in (
      'NOT_CHECKED',
      'ALL_SAMPLED_EMBEDDABLE',
      'PARTIALLY_EMBEDDABLE',
      'NO_EMBEDDABLE_ITEMS',
      'NO_PUBLIC_ITEMS',
      'NO_PUBLIC_VIDEO_STATUS',
      'NOT_APPLICABLE',
      'CHECK_ERROR'
    )
  );

alter table public.parrothit_livescore_highlight_stations
  drop constraint if exists parrothit_highlight_youtube_api_counts_check;
alter table public.parrothit_livescore_highlight_stations
  add constraint parrothit_highlight_youtube_api_counts_check check (
    youtube_api_sampled_count between 0 and 5000
    and youtube_api_embeddable_count between 0 and 5000
    and youtube_api_blocked_count between 0 and 5000
    and youtube_api_unavailable_count between 0 and 5000
  );

create index if not exists parrothit_highlight_youtube_api_status_idx
  on public.parrothit_livescore_highlight_stations (youtube_api_verification_status);

comment on column public.parrothit_livescore_highlight_stations.youtube_api_verification_status is
  'YouTube Data API status for the latest sample of a playlist. This does not replace the owner-side iframe playback test.';
comment on column public.parrothit_livescore_highlight_stations.youtube_api_sampled_count is
  'Number of latest public playlist items sampled by the YouTube Data API, maximum 50 per candidate scan.';
comment on column public.parrothit_livescore_highlight_stations.youtube_api_embeddable_count is
  'Sampled videos whose status.embeddable property was true.';
comment on column public.parrothit_livescore_highlight_stations.youtube_api_blocked_count is
  'Sampled videos whose status.embeddable property was false.';
comment on column public.parrothit_livescore_highlight_stations.youtube_api_publisher_title is
  'Publisher channel title returned by YouTube; Admin 1 should review that this is the intended rights-holder channel.';
