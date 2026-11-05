-- PARROTHIT Video & GIF Advertising
-- Additive migration. Existing image advertisements and monetization tables are not modified.
-- Run in Supabase SQL Editor before deploying the frontend patch.

create extension if not exists pgcrypto;

create table if not exists public.parrothit_video_gif_campaigns (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.advertisement_customers(id) on delete set null,
  advertiser_name text not null check (char_length(trim(advertiser_name)) between 2 and 160),
  campaign_name text not null check (char_length(trim(campaign_name)) between 3 and 180),
  media_type text not null check (media_type in ('video','gif')),
  media_url text not null,
  media_path text,
  click_url text,
  ad_description text not null default '',
  cta_text text not null default 'Visit advertiser',
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  status text not null default 'draft' check (status in ('draft','active','paused','expired')),
  start_at timestamptz,
  end_at timestamptz,
  rejection_reason text,
  submission_source text not null default 'admin' check (submission_source in ('admin','advertiser')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at is null or start_at is null or end_at > start_at)
);

create index if not exists parrothit_video_gif_campaigns_status_idx
  on public.parrothit_video_gif_campaigns(review_status,status,start_at,end_at);
create index if not exists parrothit_video_gif_campaigns_customer_idx
  on public.parrothit_video_gif_campaigns(customer_id,created_at desc);

create table if not exists public.parrothit_video_gif_allocations (
  target_page text not null,
  ad_slot smallint not null check (ad_slot in (1,2)),
  campaign_id uuid not null references public.parrothit_video_gif_campaigns(id) on delete cascade,
  allocated_by uuid references auth.users(id) on delete set null,
  allocated_at timestamptz not null default now(),
  primary key (target_page,ad_slot),
  unique (campaign_id)
);

-- Per-destination display controls. These settings affect only the new video/GIF cards.
alter table public.parrothit_video_gif_allocations
  add column if not exists is_enabled boolean not null default true,
  add column if not exists autoplay boolean not null default true,
  add column if not exists max_width_px integer not null default 1200 check (max_width_px between 320 and 1600),
  add column if not exists max_height_px integer not null default 440 check (max_height_px between 180 and 900);

alter table public.parrothit_video_gif_campaigns enable row level security;
alter table public.parrothit_video_gif_allocations enable row level security;

drop policy if exists "Public can read live approved video gif campaigns" on public.parrothit_video_gif_campaigns;
create policy "Public can read live approved video gif campaigns"
  on public.parrothit_video_gif_campaigns for select to anon,authenticated
  using (
    review_status='approved' and status='active'
    and (start_at is null or start_at <= now())
    and (end_at is null or end_at > now())
  );

drop policy if exists "PARROTHIT admins manage video gif campaigns" on public.parrothit_video_gif_campaigns;
create policy "PARROTHIT admins manage video gif campaigns"
  on public.parrothit_video_gif_campaigns for all to authenticated
  using (public.is_parrothit_admin())
  with check (public.is_parrothit_admin());

drop policy if exists "Public can read video gif card destinations" on public.parrothit_video_gif_allocations;
create policy "Public can read video gif card destinations"
  on public.parrothit_video_gif_allocations for select to anon,authenticated
  using (true);

drop policy if exists "PARROTHIT admins manage video gif allocations" on public.parrothit_video_gif_allocations;
create policy "PARROTHIT admins manage video gif allocations"
  on public.parrothit_video_gif_allocations for all to authenticated
  using (public.is_parrothit_admin())
  with check (public.is_parrothit_admin());

grant select on public.parrothit_video_gif_campaigns to anon,authenticated;
grant select,insert,update,delete on public.parrothit_video_gif_campaigns to authenticated;
grant select on public.parrothit_video_gif_allocations to anon,authenticated;
grant select,insert,update,delete on public.parrothit_video_gif_allocations to authenticated;

create or replace function public.parrothit_video_gif_set_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at=now(); return new; end; $$;
drop trigger if exists parrothit_video_gif_campaigns_updated_at on public.parrothit_video_gif_campaigns;
create trigger parrothit_video_gif_campaigns_updated_at
  before update on public.parrothit_video_gif_campaigns
  for each row execute function public.parrothit_video_gif_set_updated_at();

-- The campaign manager uploads as a signed-in administrator. Advertiser uploads use
-- a time-limited signed upload URL generated by the protected Edge Function.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('parrothit-video-gif-ads','parrothit-video-gif-ads',true,52428800,array['video/mp4','image/gif'])
on conflict (id) do update set
  name=excluded.name,
  public=true,
  file_size_limit=52428800,
  allowed_mime_types=array['video/mp4','image/gif'];

drop policy if exists "Public can view PARROTHIT video gif ad media" on storage.objects;
create policy "Public can view PARROTHIT video gif ad media"
  on storage.objects for select to anon,authenticated
  using (bucket_id='parrothit-video-gif-ads');

drop policy if exists "Admins upload PARROTHIT video gif ad media" on storage.objects;
create policy "Admins upload PARROTHIT video gif ad media"
  on storage.objects for insert to authenticated
  with check (bucket_id='parrothit-video-gif-ads' and public.is_parrothit_admin());

drop policy if exists "Admins update PARROTHIT video gif ad media" on storage.objects;
create policy "Admins update PARROTHIT video gif ad media"
  on storage.objects for update to authenticated
  using (bucket_id='parrothit-video-gif-ads' and public.is_parrothit_admin())
  with check (bucket_id='parrothit-video-gif-ads' and public.is_parrothit_admin());

drop policy if exists "Admins delete PARROTHIT video gif ad media" on storage.objects;
create policy "Admins delete PARROTHIT video gif ad media"
  on storage.objects for delete to authenticated
  using (bucket_id='parrothit-video-gif-ads' and public.is_parrothit_admin());

comment on table public.parrothit_video_gif_campaigns is
  'Separate video/GIF ad format. Campaign review and allocation are independent of payment verification.';
comment on table public.parrothit_video_gif_allocations is
  'Two dedicated video/GIF destinations per public page. One active allocation per page/slot.';
