-- PARROTHIT LiveScore Highlights TV — consolidated activation and diagnostics repair
-- Safe to re-run. Run once in Supabase SQL Editor after backing up the project.
-- This file consolidates the original highlights schema, playback-health columns,
-- and 50-preset support. It can also be used on an installation where only the
-- original highlights migration has already been applied.

create extension if not exists pgcrypto;

-- Re-use the PARROTHIT Admin 1 (Owner) role as the RLS security boundary.
create or replace function public.is_parrothit_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_profiles
    where user_id = auth.uid()
      and role = 'owner'
      and is_suspended = false
  );
$$;
revoke all on function public.is_parrothit_owner() from public;
grant execute on function public.is_parrothit_owner() to anon, authenticated;

create table if not exists public.parrothit_livescore_highlight_stations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  category text not null default 'General Football' check (char_length(btrim(category)) between 2 and 80),
  source_type text not null check (source_type in ('youtube_video', 'youtube_playlist')),
  source_url text not null check (source_url ~* '^https://'),
  youtube_video_id text,
  youtube_playlist_id text,
  thumbnail_url text,
  description text not null default '' check (char_length(description) <= 500),
  display_order integer not null default 100 check (display_order between 0 and 1000000),
  is_active boolean not null default false,
  playback_status text not null default 'UNTESTED',
  playback_checked_at timestamptz,
  playback_error text,
  preset_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parrothit_highlight_source_id_check check (
    (source_type = 'youtube_video' and youtube_video_id is not null and youtube_playlist_id is null)
    or
    (source_type = 'youtube_playlist' and youtube_playlist_id is not null)
  ),
  constraint parrothit_highlight_playback_status_check check (
    playback_status in ('UNTESTED','PLAYABLE','EMBEDDING RESTRICTED','UNAVAILABLE')
  )
);

-- Upgrade any existing table without deleting configured stations.
alter table public.parrothit_livescore_highlight_stations
  add column if not exists playback_status text not null default 'UNTESTED',
  add column if not exists playback_checked_at timestamptz,
  add column if not exists playback_error text,
  add column if not exists preset_key text;

update public.parrothit_livescore_highlight_stations
set playback_status = 'UNTESTED'
where playback_status is null or playback_status not in ('UNTESTED','PLAYABLE','EMBEDDING RESTRICTED','UNAVAILABLE');

alter table public.parrothit_livescore_highlight_stations
  alter column playback_status set default 'UNTESTED',
  alter column playback_status set not null;

alter table public.parrothit_livescore_highlight_stations
  drop constraint if exists parrothit_highlight_playback_status_check;
alter table public.parrothit_livescore_highlight_stations
  add constraint parrothit_highlight_playback_status_check
  check (playback_status in ('UNTESTED','PLAYABLE','EMBEDDING RESTRICTED','UNAVAILABLE'));

create index if not exists parrothit_livescore_highlight_active_order_idx
  on public.parrothit_livescore_highlight_stations (is_active, display_order, name);
create index if not exists parrothit_livescore_highlight_category_idx
  on public.parrothit_livescore_highlight_stations (category);
create index if not exists parrothit_livescore_highlight_preset_key_idx
  on public.parrothit_livescore_highlight_stations (preset_key)
  where preset_key is not null;

create table if not exists public.parrothit_livescore_highlights_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  autoplay_muted boolean not null default true,
  auto_advance boolean not null default true,
  default_station_id uuid references public.parrothit_livescore_highlight_stations(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.parrothit_livescore_highlights_settings (id, enabled, autoplay_muted, auto_advance)
values (1, true, true, true)
on conflict (id) do nothing;

-- Activation guard: require a recent successful player test only when a source
-- is first activated or its playable URL/ID is changed. Ordinary edits to an
-- already-active station (e.g. description/order) are not blocked.
create or replace function public.parrothit_guard_highlight_station_activation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_active then
    if tg_op = 'INSERT' then
      if new.playback_status <> 'PLAYABLE'
         or new.playback_checked_at is null
         or new.playback_checked_at < now() - interval '30 minutes' then
        raise exception 'Station activation blocked: run a fresh YouTube preview and confirm PLAYABLE within the last 30 minutes.';
      end if;
    elsif tg_op = 'UPDATE' and (
      old.is_active is distinct from new.is_active
      or old.source_url is distinct from new.source_url
      or old.youtube_video_id is distinct from new.youtube_video_id
      or old.youtube_playlist_id is distinct from new.youtube_playlist_id
    ) then
      if new.playback_status <> 'PLAYABLE'
         or new.playback_checked_at is null
         or new.playback_checked_at < now() - interval '30 minutes' then
        raise exception 'Station activation blocked: run a fresh YouTube preview and confirm PLAYABLE within the last 30 minutes.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists parrothit_guard_highlight_station_activation
  on public.parrothit_livescore_highlight_stations;
create trigger parrothit_guard_highlight_station_activation
before insert or update on public.parrothit_livescore_highlight_stations
for each row execute function public.parrothit_guard_highlight_station_activation();

-- Keep the public player read-only; only Admin 1 may manage stations/settings.
alter table public.parrothit_livescore_highlight_stations enable row level security;
alter table public.parrothit_livescore_highlights_settings enable row level security;

drop policy if exists "Public reads active PARROTHIT highlights stations" on public.parrothit_livescore_highlight_stations;
create policy "Public reads active PARROTHIT highlights stations"
  on public.parrothit_livescore_highlight_stations
  for select to anon, authenticated
  using (is_active = true or public.is_parrothit_owner());

drop policy if exists "Owner inserts PARROTHIT highlights stations" on public.parrothit_livescore_highlight_stations;
create policy "Owner inserts PARROTHIT highlights stations"
  on public.parrothit_livescore_highlight_stations
  for insert to authenticated
  with check (public.is_parrothit_owner());

drop policy if exists "Owner updates PARROTHIT highlights stations" on public.parrothit_livescore_highlight_stations;
create policy "Owner updates PARROTHIT highlights stations"
  on public.parrothit_livescore_highlight_stations
  for update to authenticated
  using (public.is_parrothit_owner())
  with check (public.is_parrothit_owner());

drop policy if exists "Owner deletes PARROTHIT highlights stations" on public.parrothit_livescore_highlight_stations;
create policy "Owner deletes PARROTHIT highlights stations"
  on public.parrothit_livescore_highlight_stations
  for delete to authenticated
  using (public.is_parrothit_owner());

drop policy if exists "Public reads PARROTHIT highlights settings" on public.parrothit_livescore_highlights_settings;
create policy "Public reads PARROTHIT highlights settings"
  on public.parrothit_livescore_highlights_settings
  for select to anon, authenticated
  using (true);

drop policy if exists "Owner manages PARROTHIT highlights settings" on public.parrothit_livescore_highlights_settings;
create policy "Owner manages PARROTHIT highlights settings"
  on public.parrothit_livescore_highlights_settings
  for all to authenticated
  using (public.is_parrothit_owner())
  with check (public.is_parrothit_owner());

revoke all on table public.parrothit_livescore_highlight_stations from public;
revoke all on table public.parrothit_livescore_highlights_settings from public;
grant select on table public.parrothit_livescore_highlight_stations to anon, authenticated;
grant insert, update, delete on table public.parrothit_livescore_highlight_stations to authenticated;
grant select on table public.parrothit_livescore_highlights_settings to anon, authenticated;
grant insert, update, delete on table public.parrothit_livescore_highlights_settings to authenticated;

comment on table public.parrothit_livescore_highlight_stations is
  'Owner-managed list of authorised YouTube football highlights videos and playlists shown on PARROTHIT LiveScore Highlights TV.';
comment on column public.parrothit_livescore_highlight_stations.playback_status is
  'Last owner-side YouTube IFrame API result. PLAYABLE requires an actual PLAYING event; playlist entries may have separate restrictions.';
comment on column public.parrothit_livescore_highlight_stations.playback_checked_at is
  'Timestamp of the last owner-side embedded playback test.';
comment on column public.parrothit_livescore_highlight_stations.playback_error is
  'Short diagnostic from the last owner-side playback test.';
comment on column public.parrothit_livescore_highlight_stations.preset_key is
  'Optional key connecting a configured station to a PARROTHIT starter preset.';
comment on table public.parrothit_livescore_highlights_settings is
  'Public display and playback defaults for PARROTHIT LiveScore Highlights TV.';

-- Final object checks for operators running this migration in Supabase SQL Editor.
select 'parrothit_livescore_highlight_stations' as object_name,
       count(*) as configured_station_count
from public.parrothit_livescore_highlight_stations;
