-- PARROTHIT Advertisement Receipts + Notification Delivery
-- Run once in Supabase SQL Editor before deploying the updated advertiser/payment Edge Functions.
create extension if not exists pgcrypto;

create table if not exists public.advertisement_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  customer_id uuid not null references public.advertisement_customers(id) on delete restrict,
  campaign_id uuid not null references public.monetization_campaigns(id) on delete restrict,
  invoice_id uuid references public.advertisement_invoices(id) on delete restrict,
  payment_reference text not null,
  payment_method text not null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(campaign_id),
  unique(payment_reference)
);
create index if not exists advertisement_receipts_customer_paid_idx
  on public.advertisement_receipts(customer_id, paid_at desc);
alter table public.advertisement_receipts enable row level security;
drop policy if exists "admins read advertisement receipts" on public.advertisement_receipts;
create policy "admins read advertisement receipts" on public.advertisement_receipts
 for select to authenticated using (public.is_parrothit_admin());
revoke all on public.advertisement_receipts from anon, authenticated;
grant select on public.advertisement_receipts to authenticated;
comment on table public.advertisement_receipts is 'Immutable payment receipt records created only by trusted Edge Functions after payment verification.';
