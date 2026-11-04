-- PARROTHIT Advertisement Management System
-- Additive migration. Run AFTER monetization-phase1.sql, monetization-phase2.sql
-- and monetization-phase3-advertiser-branding.sql.
-- Customer credentials, payments and publication actions are handled by trusted Edge Functions.

create extension if not exists pgcrypto;

-- 1) Admin-configurable plans and prices.
create table if not exists public.advertisement_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  format text not null default 'Wide banner',
  placement text not null default 'Homepage advertisement',
  duration_days integer not null default 7 check (duration_days between 1 and 365),
  price_ngn numeric(14,2) not null check (price_ngn > 0),
  target_page text not null default 'index',
  audience text not null default 'news' check (audience in ('news','interaction','both')),
  ad_position integer not null default 1 check (ad_position between 1 and 3),
  is_active boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed editable examples as drafts. Admin must activate plans before customers can buy them.
insert into public.advertisement_plans
  (name,slug,description,format,placement,duration_days,price_ngn,target_page,audience,ad_position,is_active,sort_order)
values
  ('Starter Advertisement','starter-advertisement','A short campaign to introduce your business to PARROTHIT readers.','Wide banner','Homepage advertisement',7,5000,'index','news',1,false,10),
  ('Standard Advertisement','standard-advertisement','A two-week campaign for products, services and events.','Wide banner','Homepage advertisement',14,10000,'index','news',1,false,20),
  ('Premium Advertisement','premium-advertisement','A month-long campaign with a premium news placement.','Wide banner','Homepage advertisement',30,20000,'index','news',1,false,30),
  ('Featured Advertisement','featured-advertisement','A high-visibility featured campaign for a business or product.','Featured card','Homepage advertisement',30,35000,'index','news',2,false,40),
  ('Sponsored Article','sponsored-article','A clearly disclosed sponsored editorial placement.','Sponsored article','Article page',30,50000,'article','news',1,false,50)
on conflict (slug) do nothing;

-- Keep plan price explicit and strictly positive if this migration is re-run.
alter table public.advertisement_plans alter column price_ngn drop default;
alter table public.advertisement_plans drop constraint if exists advertisement_plans_price_ngn_check;
alter table public.advertisement_plans add constraint advertisement_plans_price_ngn_check check (price_ngn > 0);

-- 2) Advertiser identity. The tracking PIN is stored as a SHA-256 hash only.
create table if not exists public.advertisement_customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text not null unique,
  business_name text not null,
  contact_name text not null,
  email text not null,
  phone text,
  tracking_pin_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) Extend the existing monetization campaigns without replacing legacy records.
alter table public.monetization_campaigns
  add column if not exists customer_id uuid references public.advertisement_customers(id) on delete restrict,
  add column if not exists plan_id uuid references public.advertisement_plans(id) on delete set null,
  add column if not exists campaign_code text,
  add column if not exists duration_days_snapshot integer,
  add column if not exists review_status text not null default 'not_required',
  add column if not exists renewal_preference text not null default 'manual',
  add column if not exists ad_image_url text,
  add column if not exists ad_description text,
  add column if not exists cta_text text not null default 'Learn more',
  add column if not exists target_page text not null default 'index',
  add column if not exists ad_audience text not null default 'news',
  add column if not exists ad_position integer not null default 1,
  add column if not exists impressions bigint not null default 0,
  add column if not exists clicks bigint not null default 0,
  add column if not exists published_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists expired_at timestamptz,
  add column if not exists stopped_at timestamptz,
  add column if not exists is_paused boolean not null default false,
  add column if not exists paused_at timestamptz,
  add column if not exists pause_reason text,
  add column if not exists rejection_reason text,
  add column if not exists renewal_of uuid references public.monetization_campaigns(id) on delete set null;

create unique index if not exists monetization_campaigns_campaign_code_uidx
  on public.monetization_campaigns(campaign_code) where campaign_code is not null;
create index if not exists monetization_campaigns_customer_created_idx
  on public.monetization_campaigns(customer_id,created_at desc);
create index if not exists monetization_campaigns_status_dates_idx
  on public.monetization_campaigns(status,is_paused,end_date);

-- 4) Customer invoices, manual bank-transfer submissions, messages and campaign timeline.
create table if not exists public.advertisement_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  customer_id uuid not null references public.advertisement_customers(id) on delete restrict,
  campaign_id uuid not null references public.monetization_campaigns(id) on delete restrict,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'NGN' check (currency='NGN'),
  description text not null,
  status text not null default 'unpaid' check (status in ('unpaid','pending','paid','void','refunded')),
  issued_at timestamptz not null default now(),
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.advertisement_manual_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.advertisement_customers(id) on delete restrict,
  campaign_id uuid not null references public.monetization_campaigns(id) on delete restrict,
  invoice_id uuid references public.advertisement_invoices(id) on delete set null,
  reference text not null,
  depositor_name text not null,
  amount numeric(14,2) not null check (amount > 0),
  transfer_date date not null default current_date,
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  admin_note text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);
create unique index if not exists advertisement_manual_payment_reference_uidx
  on public.advertisement_manual_payments(reference);
create index if not exists advertisement_manual_payment_status_idx
  on public.advertisement_manual_payments(status,submitted_at desc);

create table if not exists public.advertisement_notifications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.advertisement_customers(id) on delete restrict,
  campaign_id uuid references public.monetization_campaigns(id) on delete set null,
  notification_key text not null unique,
  notification_type text not null,
  subject text not null,
  message text not null,
  channel text not null default 'in_app' check (channel in ('in_app','email','sms','whatsapp')),
  status text not null default 'queued' check (status in ('queued','sent','failed','read')),
  recipient text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz
);
create index if not exists advertisement_notifications_customer_idx
  on public.advertisement_notifications(customer_id,created_at desc);

create table if not exists public.advertisement_notification_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  trigger_days integer not null,
  subject text not null,
  body text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.advertisement_notification_templates(code,trigger_days,subject,body,enabled) values
('renew_7',7,'Your PARROTHIT advertisement expires in 7 days','Hello {{customer_name}}, your advertisement "{{advertisement_title}}" ({{campaign_id}}) expires on {{expiration_date}}. There are {{days_remaining}} days remaining. Sign in to your advertiser dashboard to renew and keep your campaign running: {{dashboard_url}}. Thank you for advertising with PARROTHIT — NEWS THAT SPEAKS!',true),
('renew_3',3,'Your PARROTHIT advertisement expires in 3 days','Hello {{customer_name}}, your advertisement "{{advertisement_title}}" expires on {{expiration_date}}. Only {{days_remaining}} days remain. Renew from your PARROTHIT advertiser dashboard: {{dashboard_url}}. Thank you for choosing PARROTHIT.',true),
('renew_1',1,'Final reminder: your PARROTHIT advertisement expires tomorrow','Hello {{customer_name}}, your advertisement "{{advertisement_title}}" expires on {{expiration_date}}. Please renew today if you want your campaign to continue: {{dashboard_url}}.',true),
('expires_0',0,'Your PARROTHIT advertisement expires today','Hello {{customer_name}}, your advertisement "{{advertisement_title}}" reaches its final scheduled day today ({{expiration_date}}). Renew from your dashboard to arrange another campaign: {{dashboard_url}}.',true),
('expired_1',-1,'Your PARROTHIT advertisement has expired','Hello {{customer_name}}, your advertisement "{{advertisement_title}}" expired on {{expiration_date}} and is no longer running. You can renew it at any time from your PARROTHIT advertiser dashboard: {{dashboard_url}}. Thank you for advertising with us.',true)
on conflict (code) do nothing;

create table if not exists public.advertisement_campaign_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.monetization_campaigns(id) on delete cascade,
  customer_id uuid references public.advertisement_customers(id) on delete set null,
  event_type text not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists advertisement_campaign_events_campaign_idx
  on public.advertisement_campaign_events(campaign_id,created_at desc);

-- 5) Private configuration for transfer instructions and enabled gateways/channels.
create table if not exists public.advertisement_payment_settings (
  id boolean primary key default true check (id=true),
  bank_transfer_enabled boolean not null default false,
  bank_name text not null default '',
  account_name text not null default '',
  account_number text not null default '',
  transfer_instructions text not null default 'Use your invoice number as the transfer narration. Your campaign will not run until the transfer is verified.',
  paystack_enabled boolean not null default false,
  flutterwave_enabled boolean not null default false,
  ussd_enabled boolean not null default true,
  bank_gateway_enabled boolean not null default true,
  email_notifications_enabled boolean not null default true,
  sms_notifications_enabled boolean not null default false,
  whatsapp_notifications_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.advertisement_payment_settings(id) values(true) on conflict(id) do nothing;

-- 6) Row-level security: direct customer data is never exposed to anonymous browser clients.
alter table public.advertisement_plans enable row level security;
alter table public.advertisement_customers enable row level security;
alter table public.monetization_campaigns enable row level security;
alter table public.advertisement_invoices enable row level security;
alter table public.advertisement_manual_payments enable row level security;
alter table public.advertisement_notifications enable row level security;
alter table public.advertisement_notification_templates enable row level security;
alter table public.advertisement_campaign_events enable row level security;
alter table public.advertisement_payment_settings enable row level security;

drop policy if exists "public read active advertisement plans" on public.advertisement_plans;
create policy "public read active advertisement plans" on public.advertisement_plans
  for select to anon, authenticated using (is_active=true);
drop policy if exists "admins manage advertisement plans" on public.advertisement_plans;
create policy "admins manage advertisement plans" on public.advertisement_plans
  for all to authenticated using (public.is_parrothit_admin()) with check (public.is_parrothit_admin());

-- Admins can review/manage the new advertiser records. Public access is via the portal Edge Function only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['advertisement_customers','advertisement_invoices','advertisement_manual_payments','advertisement_notifications','advertisement_notification_templates','advertisement_campaign_events','advertisement_payment_settings'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'admins manage '||t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_parrothit_admin()) WITH CHECK (public.is_parrothit_admin())', 'admins manage '||t, t);
  END LOOP;
END $$;

revoke all on public.advertisement_customers from anon, authenticated;
revoke all on public.advertisement_invoices from anon;
revoke all on public.advertisement_manual_payments from anon;
revoke all on public.advertisement_notifications from anon;
revoke all on public.advertisement_campaign_events from anon;
revoke all on public.advertisement_payment_settings from anon, authenticated;
revoke all on public.advertisement_notification_templates from anon;
grant select on public.advertisement_plans to anon, authenticated;
grant select, insert, update, delete on public.advertisement_plans to authenticated;
grant select, insert, update, delete on public.advertisement_customers to authenticated;
grant select, insert, update, delete on public.advertisement_invoices to authenticated;
grant select, insert, update, delete on public.advertisement_manual_payments to authenticated;
grant select, insert, update, delete on public.advertisement_notifications to authenticated;
grant select, insert, update, delete on public.advertisement_notification_templates to authenticated;
grant select, insert, update, delete on public.advertisement_campaign_events to authenticated;
grant select, insert, update, delete on public.advertisement_payment_settings to authenticated;

-- 7) Customer campaign creative upload support, extending the existing branding bucket.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('advertiser-branding','advertiser-branding',true,5242880,array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp']::text[];
drop policy if exists "public upload advertiser campaign creatives" on storage.objects;
create policy "public upload advertiser campaign creatives" on storage.objects
  for insert to anon, authenticated with check (
    bucket_id='advertiser-branding'
    and (storage.foldername(name))[1]='campaign-creatives'
    and (lower(name) like '%.jpg' or lower(name) like '%.jpeg' or lower(name) like '%.png' or lower(name) like '%.webp')
  );

drop policy if exists "public read advertiser campaign creatives" on storage.objects;
create policy "public read advertiser campaign creatives" on storage.objects
  for select to public using (bucket_id='advertiser-branding' and (storage.foldername(name))[1]='campaign-creatives');

grant insert,select on storage.objects to anon,authenticated;

-- 8) Updated-at triggers for editable configuration rows.
drop trigger if exists advertisement_plans_updated_at on public.advertisement_plans;
create trigger advertisement_plans_updated_at before update on public.advertisement_plans
for each row execute function public.monetization_set_updated_at();
drop trigger if exists advertisement_customers_updated_at on public.advertisement_customers;
create trigger advertisement_customers_updated_at before update on public.advertisement_customers
for each row execute function public.monetization_set_updated_at();

comment on table public.advertisement_customers is 'Advertiser identities. Tracking PIN hashes only; all public access goes through a rate-limited portal Edge Function.';
comment on table public.advertisement_manual_payments is 'Customer-submitted bank transfer references awaiting authorized Admin verification.';
comment on table public.advertisement_notifications is 'In-app and optional email/SMS/WhatsApp advertiser campaign reminders.';
comment on table public.advertisement_plans is 'Admin-managed Nigerian Naira advertising plans and campaign placement configuration.';

-- 9) Rate-limit Customer ID + PIN checks. Only trusted Edge Functions can access this table/RPC.
create table if not exists public.advertisement_access_rate_limits (
  scope_hash text primary key,
  failure_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz
);
alter table public.advertisement_access_rate_limits enable row level security;
revoke all on public.advertisement_access_rate_limits from public, anon, authenticated;

create or replace function public.advertisement_access_is_blocked(p_scope_hash text)
returns boolean language sql security definer set search_path=public as $$
  select coalesce((select blocked_until > now() from public.advertisement_access_rate_limits where scope_hash=p_scope_hash), false);
$$;

create or replace function public.advertisement_access_failure(p_scope_hash text)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.advertisement_access_rate_limits(scope_hash,failure_count,window_started_at,blocked_until)
  values (p_scope_hash,1,now(),null)
  on conflict (scope_hash) do update set
    failure_count = case when advertisement_access_rate_limits.window_started_at < now() - interval '15 minutes' then 1 else advertisement_access_rate_limits.failure_count + 1 end,
    window_started_at = case when advertisement_access_rate_limits.window_started_at < now() - interval '15 minutes' then now() else advertisement_access_rate_limits.window_started_at end,
    blocked_until = case
      when advertisement_access_rate_limits.blocked_until > now() then advertisement_access_rate_limits.blocked_until
      when advertisement_access_rate_limits.window_started_at < now() - interval '15 minutes' then null
      when advertisement_access_rate_limits.failure_count + 1 >= 10 then now() + interval '15 minutes'
      else advertisement_access_rate_limits.blocked_until end;
end;
$$;

create or replace function public.advertisement_access_success(p_scope_hash text)
returns void language sql security definer set search_path=public as $$
  delete from public.advertisement_access_rate_limits where scope_hash=p_scope_hash;
$$;
revoke all on function public.advertisement_access_is_blocked(text) from public, anon, authenticated;
revoke all on function public.advertisement_access_failure(text) from public, anon, authenticated;
revoke all on function public.advertisement_access_success(text) from public, anon, authenticated;
grant execute on function public.advertisement_access_is_blocked(text) to service_role;
grant execute on function public.advertisement_access_failure(text) to service_role;
grant execute on function public.advertisement_access_success(text) to service_role;

-- 10) Atomic event counters. Only the trusted Edge Function service role may call this RPC.
create or replace function public.increment_advertisement_metric(p_campaign_id uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event not in ('impression','click') then
    raise exception 'Unsupported advertisement metric event.';
  end if;
  update public.monetization_campaigns
     set impressions = impressions + case when p_event='impression' then 1 else 0 end,
         clicks = clicks + case when p_event='click' then 1 else 0 end
   where id = p_campaign_id
     and status = 'active'
     and is_paused = false
     and (start_date is null or start_date <= current_date)
     and (end_date is null or end_date >= current_date);
end;
$$;
revoke all on function public.increment_advertisement_metric(uuid,text) from public, anon, authenticated;
grant execute on function public.increment_advertisement_metric(uuid,text) to service_role;
