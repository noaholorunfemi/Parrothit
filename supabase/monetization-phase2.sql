-- PARROTHIT Monetization Phase 2: secure Paystack + Flutterwave checkout
-- Run AFTER supabase/monetization-phase1.sql.
-- Secret keys are stored only in Supabase Edge Function secrets, never in SQL or browser code.

alter table public.monetization_campaigns
  add column if not exists billing_email text;

create table if not exists public.monetization_payments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.monetization_campaigns(id) on delete restrict,
  provider text not null check (provider in ('paystack','flutterwave')),
  reference text not null unique,
  provider_transaction_id text,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  status text not null default 'initiated' check (status in ('initiated','pending','paid','failed','review')),
  checkout_url text,
  gateway_response jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  paid_at timestamptz
);

alter table public.monetization_revenue
  add column if not exists payment_id uuid references public.monetization_payments(id) on delete restrict;

create unique index if not exists monetization_revenue_payment_id_uidx
  on public.monetization_revenue(payment_id);
create index if not exists monetization_payments_campaign_created_idx
  on public.monetization_payments(campaign_id, created_at desc);
create index if not exists monetization_payments_provider_reference_idx
  on public.monetization_payments(provider, reference);
create index if not exists monetization_payments_status_idx
  on public.monetization_payments(status);

alter table public.monetization_payments enable row level security;

drop policy if exists "admins read monetization payments" on public.monetization_payments;
create policy "admins read monetization payments" on public.monetization_payments
  for select to authenticated using (public.is_parrothit_admin());

-- Payment creation and state changes are performed only by the trusted Edge Function
-- using the service-role key. Browser clients cannot insert/update payment records.
revoke all on public.monetization_payments from anon, authenticated;
grant select on public.monetization_payments to authenticated;

-- The public client must never alter financial settlement fields after Phase 2.
-- Campaign/payment writes for gateway settlements use service-role from the Edge Function.
comment on table public.monetization_payments is
  'Gateway checkout and verification records. Only trusted Edge Functions may create or modify rows.';
comment on column public.monetization_campaigns.billing_email is
  'Billing email supplied by advertiser; required before starting a hosted payment checkout.';
