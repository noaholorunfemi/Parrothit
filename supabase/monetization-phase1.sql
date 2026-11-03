-- PARROTHIT Monetization Phase 1
-- Run in Supabase SQL Editor. Additive migration; does not alter existing ad controls.
create extension if not exists pgcrypto;

create table if not exists public.advertiser_inquiries (
 id uuid primary key default gen_random_uuid(),
 business_name text not null check (char_length(trim(business_name)) between 2 and 120),
 contact_name text not null check (char_length(trim(contact_name)) between 2 and 100),
 email text not null check (char_length(trim(email)) <= 180),
 phone text,
 campaign_type text not null,
 duration text not null default 'To be discussed',
 details text,
 consent boolean not null default false check (consent = true),
 status text not null default 'new' check (status in ('new','reviewing','contacted','converted','rejected')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.monetization_campaigns (
 id uuid primary key default gen_random_uuid(),
 advertiser_name text not null,
 campaign_name text not null,
 placement text not null,
 start_date date,
 end_date date,
 status text not null default 'draft' check(status in ('draft','pending_payment','active','completed','cancelled')),
 agreed_amount numeric(14,2) not null default 0 check(agreed_amount >= 0),
 payment_status text not null default 'unpaid' check(payment_status in ('unpaid','pending','paid','refunded')),
 destination_url text,
 notes text,
 created_by uuid default auth.uid(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(end_date is null or start_date is null or end_date >= start_date)
);
create table if not exists public.monetization_revenue (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.monetization_campaigns(id) on delete restrict,
 amount numeric(14,2) not null check(amount > 0),
 transaction_reference text,
 received_at date not null default current_date,
 payment_method text not null,
 notes text,
 recorded_by uuid default auth.uid(),
 created_at timestamptz not null default now()
);
create index if not exists advertiser_inquiries_created_idx on public.advertiser_inquiries(created_at desc);
create index if not exists advertiser_inquiries_status_idx on public.advertiser_inquiries(status);
create index if not exists monetization_campaigns_created_idx on public.monetization_campaigns(created_at desc);
create index if not exists monetization_revenue_received_idx on public.monetization_revenue(received_at desc);
create index if not exists monetization_revenue_campaign_idx on public.monetization_revenue(campaign_id);

alter table public.advertiser_inquiries enable row level security;
alter table public.monetization_campaigns enable row level security;
alter table public.monetization_revenue enable row level security;

drop policy if exists "public submit advertiser inquiries" on public.advertiser_inquiries;
create policy "public submit advertiser inquiries" on public.advertiser_inquiries
 for insert to anon, authenticated with check (
  consent = true and status = 'new'
  and char_length(trim(business_name)) between 2 and 120
  and char_length(trim(contact_name)) between 2 and 100
  and char_length(trim(email)) between 5 and 180
 );
drop policy if exists "admins manage advertiser inquiries" on public.advertiser_inquiries;
create policy "admins manage advertiser inquiries" on public.advertiser_inquiries
 for all to authenticated using (public.is_parrothit_admin()) with check (public.is_parrothit_admin());

drop policy if exists "admins manage monetization campaigns" on public.monetization_campaigns;
create policy "admins manage monetization campaigns" on public.monetization_campaigns
 for all to authenticated using (public.is_parrothit_admin()) with check (public.is_parrothit_admin());

drop policy if exists "admins manage monetization revenue" on public.monetization_revenue;
create policy "admins manage monetization revenue" on public.monetization_revenue
 for all to authenticated using (public.is_parrothit_admin()) with check (public.is_parrothit_admin());

grant insert on public.advertiser_inquiries to anon, authenticated;
grant select, update, delete on public.advertiser_inquiries to authenticated;
grant select, insert, update, delete on public.monetization_campaigns to authenticated;
grant select, insert, update, delete on public.monetization_revenue to authenticated;

create or replace function public.monetization_set_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at=now(); return new; end; $$;
drop trigger if exists advertiser_inquiries_updated_at on public.advertiser_inquiries;
create trigger advertiser_inquiries_updated_at before update on public.advertiser_inquiries
for each row execute function public.monetization_set_updated_at();
drop trigger if exists monetization_campaigns_updated_at on public.monetization_campaigns;
create trigger monetization_campaigns_updated_at before update on public.monetization_campaigns
for each row execute function public.monetization_set_updated_at();
