-- PARROTHIT LiveScore: 50-station preset catalogue support
-- Run AFTER supabase/parrothit-livescore-highlights.sql has been applied.
-- Safe to re-run. Preset definitions are shipped in js/livescore-highlight-presets.js.
-- Only configured video/playlist records are stored in the public stations table.

alter table public.parrothit_livescore_highlight_stations
  add column if not exists preset_key text;

create index if not exists parrothit_livescore_highlight_preset_key_idx
  on public.parrothit_livescore_highlight_stations (preset_key)
  where preset_key is not null;

comment on column public.parrothit_livescore_highlight_stations.preset_key is
  'Optional key linking a configured station to one of the 50 PARROTHIT starter presets. Null for custom stations.';
