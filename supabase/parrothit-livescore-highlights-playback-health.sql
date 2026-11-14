-- PARROTHIT Highlights TV playback health and embed verification upgrade
-- Run in Supabase SQL Editor AFTER the original highlights migration. Safe to re-run.
alter table public.parrothit_livescore_highlight_stations
  add column if not exists playback_status text not null default 'UNTESTED',
  add column if not exists playback_checked_at timestamptz,
  add column if not exists playback_error text;

alter table public.parrothit_livescore_highlight_stations
  drop constraint if exists parrothit_highlight_playback_status_check;
alter table public.parrothit_livescore_highlight_stations
  add constraint parrothit_highlight_playback_status_check
  check (playback_status in ('UNTESTED','PLAYABLE','EMBEDDING RESTRICTED','UNAVAILABLE'));

comment on column public.parrothit_livescore_highlight_stations.playback_status is
  'Last owner-side YouTube IFrame API result. PLAYABLE requires an actual PLAYING event; playlist items can still differ.';
comment on column public.parrothit_livescore_highlight_stations.playback_checked_at is
  'Timestamp of the last owner-side embedded playback test.';
comment on column public.parrothit_livescore_highlight_stations.playback_error is
  'Short diagnostic from the last owner-side YouTube playback test.';

-- Existing RLS already permits owner-only station updates and public read-only access
-- to active station metadata. No public write permission is added.

-- Database-side activation guard: active stations must have a recent successful
-- owner-side playback check. Existing active rows are not mass-deactivated by
-- this migration; the guard applies when they are next inserted/updated.
create or replace function public.parrothit_guard_highlight_station_activation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_active and (
    new.playback_status <> 'PLAYABLE'
    or new.playback_checked_at is null
    or new.playback_checked_at < now() - interval '30 minutes'
  ) then
    raise exception 'Station activation blocked: run a fresh YouTube preview and confirm PLAYABLE within the last 30 minutes.';
  end if;
  return new;
end;
$$;

drop trigger if exists parrothit_guard_highlight_station_activation
  on public.parrothit_livescore_highlight_stations;
create trigger parrothit_guard_highlight_station_activation
before insert or update on public.parrothit_livescore_highlight_stations
for each row execute function public.parrothit_guard_highlight_station_activation();
