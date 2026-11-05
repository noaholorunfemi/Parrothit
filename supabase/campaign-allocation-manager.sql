-- PARROTHIT Campaign Allocation Manager
-- Run in Supabase SQL Editor. Review RLS/admin policies for your deployment before enabling writes.
create table if not exists public.advertisement_destinations (
 destination_id text primary key,
 page_name text not null,
 page_url text not null,
 card_number integer not null check(card_number > 0),
 destination_name text not null,
 card_width integer,
 card_height integer,
 is_active boolean not null default true,
 is_occupied boolean not null default false,
 created_at timestamptz not null default now(),
 unique(page_name,card_number)
);
create table if not exists public.advertisement_campaign_allocations (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.monetization_campaigns(id) on delete restrict,
 destination_id text not null references public.advertisement_destinations(destination_id) on delete restrict,
 start_date date not null,
 end_date date not null,
 status text not null default 'allocated' check(status in ('allocated','scheduled','active','completed','cancelled','replaced')),
 admin_note text,
 allocated_by uuid,
 created_at timestamptz not null default now(),
 check(end_date >= start_date)
);
create index if not exists idx_ad_alloc_campaign on public.advertisement_campaign_allocations(campaign_id);
create index if not exists idx_ad_alloc_dest_dates on public.advertisement_campaign_allocations(destination_id,start_date,end_date);
-- Prevent overlapping active/scheduled allocations to the same destination.
create extension if not exists btree_gist;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='ad_alloc_no_overlap') then
  alter table public.advertisement_campaign_allocations add constraint ad_alloc_no_overlap
  exclude using gist (destination_id with =, daterange(start_date,end_date,'[]') with &&)
  where (status in ('allocated','scheduled','active'));
 end if;
end $$;
-- Seed examples only; edit these rows to match real page URLs/cards before allocation.
insert into public.advertisement_destinations(destination_id,page_name,page_url,card_number,destination_name,is_active)
values
 ('BUSINESS-AD-001','Business.html','/Business.html',1,'Business Ads Card 1',true),
 ('BUSINESS-AD-002','Business.html','/Business.html',2,'Business Ads Card 2',true),
 ('BUSINESS-AD-003','Business.html','/Business.html',3,'Business Ads Card 3',true),
 ('SPORTS-AD-001','Sports.html','/Sports.html',1,'Sports Ads Card 1',true),
 ('SPORTS-AD-002','Sports.html','/Sports.html',2,'Sports Ads Card 2',true),
 ('ENTERTAINMENT-AD-001','Entertainment.html','/Entertainment.html',1,'Entertainment Ads Card 1',true)
on conflict(destination_id) do nothing;
alter table public.advertisement_destinations enable row level security;
alter table public.advertisement_campaign_allocations enable row level security;
-- Admin policies are intentionally not guessed here. Add policies using your existing admin
-- authorization function/profile table, and grant SELECT/INSERT to authenticated admins only.
