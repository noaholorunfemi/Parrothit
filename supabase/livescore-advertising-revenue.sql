-- PARROTHIT LiveScore Advertising & Revenue (isolated from the News Advertising system)
-- Run this additive migration in Supabase SQL Editor before uploading the patch files.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.livescore_advertisers (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  contact_name text not null default '',
  email text not null default '',
  phone text not null default '',
  notes text not null default '',
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.livescore_ad_inquiries (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  contact_name text not null,
  email text not null,
  phone text not null,
  website text not null default '',
  requested_placements text[] not null default '{}',
  preferred_format text not null default 'image',
  duration text not null default '',
  budget_range text not null default '',
  message text not null default '',
  status text not null default 'new' check (status in ('new','reviewing','contacted','converted','rejected')),
  admin_notes text not null default '',
  advertiser_id uuid references public.livescore_advertisers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(business_name) between 2 and 140),
  check (char_length(contact_name) between 2 and 120),
  check (char_length(email) between 5 and 180),
  check (char_length(phone) between 5 and 60),
  check (website = '' or website ~* '^https://'),
  check (cardinality(requested_placements) between 1 and 6),
  check (char_length(message) <= 2000)
);

create table if not exists public.livescore_ad_placements (
  id text primary key,
  label text not null,
  description text not null default '',
  enabled boolean not null default true,
  max_ads integer not null default 1 check (max_ads between 1 and 4),
  sort_order integer not null default 100,
  updated_at timestamptz not null default now()
);

insert into public.livescore_ad_placements (id,label,description,enabled,max_ads,sort_order) values
 ('scores_top','Scores page — top banner','Wide banner above the LiveScore date and match filters.',true,1,10),
 ('scores_inline','Scores page — between matches','In-feed creative inserted after the sixth visible match card.',true,1,20),
 ('scores_mobile','Scores page — mobile feed','Mobile-only creative inserted after the twelfth visible match card.',true,1,30),
 ('scores_sidebar','Scores page — news sidebar','Partner placement in the LiveScore sports-news rail on wide screens.',true,1,40),
 ('competition_sponsor','Competition sponsor','Sponsor creative targeted to a competition name.',true,1,50),
 ('match_centre','Match centre sponsor','Sponsor creative in the match centre; optionally target a specific team or fixture.',true,1,60)
on conflict (id) do nothing;

create table if not exists public.livescore_ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.livescore_advertisers(id) on delete restrict,
  advertiser_label text not null default '',
  title text not null,
  description text not null default '',
  creative_type text not null default 'image' check (creative_type in ('image','gif','video')),
  asset_url text not null,
  destination_url text not null default '',
  cta_text text not null default 'Learn more',
  placement text not null references public.livescore_ad_placements(id) on update cascade on delete restrict,
  target_competition text not null default '',
  target_match text not null default '',
  status text not null default 'draft' check (status in ('draft','active','paused','completed','rejected')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null default (now() + interval '30 days'),
  contract_value_ngn numeric(14,2) not null default 0 check (contract_value_ngn >= 0),
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (destination_url = '' or destination_url ~* '^https?://')
);

create table if not exists public.livescore_ad_revenue_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.livescore_ad_campaigns(id) on delete set null,
  source_type text not null check (source_type in ('direct_advertiser','adsense','affiliate','sponsorship','other')),
  payer_name text not null default '',
  amount_ngn numeric(14,2) not null check (amount_ngn > 0),
  payment_method text not null default 'other' check (payment_method in ('bank_transfer','cash','paystack','flutterwave','adsense_payout','affiliate_payout','other')),
  reference text not null default '',
  earned_on date not null default current_date,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.livescore_ad_events (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.livescore_ad_campaigns(id) on delete cascade,
  event_type text not null check (event_type in ('impression','click')),
  visitor_key_hash text not null,
  event_day date not null default current_date,
  page_path text not null default '',
  created_at timestamptz not null default now(),
  unique (campaign_id,event_type,visitor_key_hash,event_day)
);

create index if not exists livescore_ad_campaigns_public_idx on public.livescore_ad_campaigns(status,placement,starts_at,ends_at,priority desc);
create index if not exists livescore_ad_campaigns_advertiser_idx on public.livescore_ad_campaigns(advertiser_id,created_at desc);
create index if not exists livescore_ad_revenue_date_idx on public.livescore_ad_revenue_entries(earned_on desc,source_type);
create index if not exists livescore_ad_events_campaign_day_idx on public.livescore_ad_events(campaign_id,event_day desc,event_type);

-- The public view exposes only creative fields for currently-running campaigns.
-- The base campaign/advertiser/payment/event tables remain inaccessible to anonymous clients.
create or replace view public.livescore_public_ad_slots as
select id,label,description,enabled,max_ads,sort_order
from public.livescore_ad_placements
where enabled = true;

create or replace view public.livescore_public_ads as
select c.id,c.advertiser_label,c.title,c.description,c.creative_type,c.asset_url,
       c.destination_url,c.cta_text,c.placement,c.target_competition,c.target_match,c.priority
from public.livescore_ad_campaigns c
join public.livescore_ad_placements p on p.id=c.placement and p.enabled=true
join public.livescore_advertisers a on a.id=c.advertiser_id and a.status='active'
where c.status='active' and c.starts_at <= now() and c.ends_at > now();

-- A small opaque browser-session key is hashed server-side. One impression/click per
-- campaign, event type, browser session and Lagos-local date is counted.
create or replace view public.livescore_ad_campaign_performance with (security_invoker=true) as
select c.id as campaign_id,
       (count(e.id) filter (where e.event_type='impression')) as impressions,
       (count(e.id) filter (where e.event_type='click')) as clicks
from public.livescore_ad_campaigns c
left join public.livescore_ad_events e on e.campaign_id=c.id
group by c.id;

create or replace function public.livescore_track_ad_event(
  p_campaign_id uuid,
  p_event_type text,
  p_session_key text,
  p_page_path text default ''
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_added integer;
begin
  if p_event_type not in ('impression','click') then return false; end if;
  if p_session_key is null or length(p_session_key) < 16 or length(p_session_key) > 160 then return false; end if;
  if not exists (
    select 1 from public.livescore_ad_campaigns c
    join public.livescore_ad_placements p on p.id=c.placement and p.enabled=true
    join public.livescore_advertisers a on a.id=c.advertiser_id and a.status='active'
    where c.id=p_campaign_id and c.status='active' and c.starts_at <= now() and c.ends_at > now()
  ) then return false; end if;

  v_hash := encode(extensions.digest(p_session_key, 'sha256'), 'hex');
  insert into public.livescore_ad_events(campaign_id,event_type,visitor_key_hash,event_day,page_path)
  values(p_campaign_id,p_event_type,v_hash,(now() at time zone 'Africa/Lagos')::date,left(coalesce(p_page_path,''),240))
  on conflict (campaign_id,event_type,visitor_key_hash,event_day) do nothing;
  get diagnostics v_added = row_count;
  return v_added > 0;
end;
$$;

-- Admin-only access to management and accounting records.
do $$
declare t text;
begin
  foreach t in array array['livescore_advertisers','livescore_ad_inquiries','livescore_ad_placements','livescore_ad_campaigns','livescore_ad_revenue_entries','livescore_ad_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I','parrothit admins manage '||t,t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_parrothit_admin()) with check (public.is_parrothit_admin())','parrothit admins manage '||t,t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  end loop;
end $$;

-- Public visitors may submit an advertising enquiry, but cannot read or manage enquiries.
drop policy if exists "public can submit LiveScore ad enquiries" on public.livescore_ad_inquiries;
create policy "public can submit LiveScore ad enquiries" on public.livescore_ad_inquiries
for insert to anon
with check (
  status='new' and advertiser_id is null
  and char_length(business_name) between 2 and 140
  and char_length(contact_name) between 2 and 120
  and char_length(email) between 5 and 180
  and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  and char_length(phone) between 5 and 60
  and (website = '' or website ~* '^https://')
  and cardinality(requested_placements) between 1 and 6
  and char_length(message) <= 2000
);
revoke all on public.livescore_ad_inquiries from anon;
grant insert (business_name,contact_name,email,phone,website,requested_placements,preferred_format,duration,budget_range,message,status) on public.livescore_ad_inquiries to anon;

revoke all on public.livescore_advertisers from anon;
revoke all on public.livescore_ad_placements from anon;
revoke all on public.livescore_ad_campaigns from anon;
revoke all on public.livescore_ad_revenue_entries from anon;
revoke all on public.livescore_ad_events from anon;
grant select on public.livescore_public_ad_slots to anon,authenticated;
grant select on public.livescore_public_ads to anon,authenticated;
grant select on public.livescore_ad_campaign_performance to authenticated;
-- Admin-only advertiser removal. Campaign events cascade; income rows survive with campaign_id set to NULL.
create or replace function public.livescore_delete_advertiser(p_advertiser_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaigns integer := 0;
  v_deleted integer := 0;
begin
  if not public.is_parrothit_admin() then
    raise exception 'Only PARROTHIT administrators can delete LiveScore advertisers.' using errcode = '42501';
  end if;
  update public.livescore_ad_inquiries
  set advertiser_id = null, status = 'reviewing', updated_at = now()
  where advertiser_id = p_advertiser_id;
  delete from public.livescore_ad_campaigns where advertiser_id = p_advertiser_id;
  get diagnostics v_campaigns = row_count;
  delete from public.livescore_advertisers where id = p_advertiser_id;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'Advertiser was not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('deleted', true, 'campaigns_removed', v_campaigns);
end;
$$;
revoke all on function public.livescore_delete_advertiser(uuid) from public;
grant execute on function public.livescore_delete_advertiser(uuid) to authenticated;

revoke all on function public.livescore_track_ad_event(uuid,text,text,text) from public;
grant execute on function public.livescore_track_ad_event(uuid,text,text,text) to anon,authenticated;

-- Public creative files; only PARROTHIT admins can upload/change/remove them.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('livescore-ad-creatives','livescore-ad-creatives',true,52428800,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm']::text[])
on conflict (id) do update set public=true,file_size_limit=52428800,
  allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm']::text[];

drop policy if exists "public read LiveScore ad creatives" on storage.objects;
create policy "public read LiveScore ad creatives" on storage.objects
for select to public using (bucket_id='livescore-ad-creatives');
drop policy if exists "PARROTHIT admins upload LiveScore ad creatives" on storage.objects;
create policy "PARROTHIT admins upload LiveScore ad creatives" on storage.objects
for insert to authenticated with check (bucket_id='livescore-ad-creatives' and public.is_parrothit_admin());
drop policy if exists "PARROTHIT admins update LiveScore ad creatives" on storage.objects;
create policy "PARROTHIT admins update LiveScore ad creatives" on storage.objects
for update to authenticated using (bucket_id='livescore-ad-creatives' and public.is_parrothit_admin())
with check (bucket_id='livescore-ad-creatives' and public.is_parrothit_admin());
drop policy if exists "PARROTHIT admins delete LiveScore ad creatives" on storage.objects;
create policy "PARROTHIT admins delete LiveScore ad creatives" on storage.objects
for delete to authenticated using (bucket_id='livescore-ad-creatives' and public.is_parrothit_admin());

comment on table public.livescore_advertisers is 'Advertisers for PARROTHIT LiveScore only; isolated from news advertising.';
comment on table public.livescore_ad_campaigns is 'LiveScore-only advertising campaigns and placements.';
comment on table public.livescore_ad_revenue_entries is 'Dedicated LiveScore revenue ledger; direct advertiser, AdSense, affiliate and sponsorship income.';
comment on table public.livescore_ad_events is 'Deduplicated LiveScore ad impressions and clicks; browser session keys are hashed.';

comment on table public.livescore_ad_inquiries is 'Public advertising requests submitted from the PARROTHIT LiveScore webpage; visible only to PARROTHIT admins.';
