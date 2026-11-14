-- PARROTHIT LiveScore Highlights TV
-- Run once in Supabase SQL Editor. Safe to re-run.
-- Stations are owner-managed. Public visitors can only read active station metadata.

create extension if not exists pgcrypto;

-- The owner helper is repeated here so this migration remains independently deployable.
create or replace function public.is_parrothit_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_profiles
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
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parrothit_highlight_source_id_check check (
    (source_type = 'youtube_video' and youtube_video_id is not null and youtube_playlist_id is null)
    or
    (source_type = 'youtube_playlist' and youtube_playlist_id is not null)
  )
);

create index if not exists parrothit_livescore_highlight_active_order_idx
  on public.parrothit_livescore_highlight_stations (is_active, display_order, name);
create index if not exists parrothit_livescore_highlight_category_idx
  on public.parrothit_livescore_highlight_stations (category);

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

alter table public.parrothit_livescore_highlight_stations enable row level security;
alter table public.parrothit_livescore_highlights_settings enable row level security;

-- Public pages may read active stations. Admin 1 can read active and inactive records.
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

-- Public player needs only the global display/playback settings. Writes remain Admin 1 only.
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
  'Owner-managed list of authorised YouTube football highlights videos and playlists displayed on PARROTHIT LiveScore Highlights TV.';
comment on table public.parrothit_livescore_highlights_settings is
  'Public display and playback defaults for PARROTHIT LiveScore Highlights TV.';
