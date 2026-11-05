-- PARROTHIT Advertiser Account Recovery + Safe Cancellation
-- Run this once in Supabase SQL Editor before deploying the updated Edge Function.
-- Requires the existing advertisement-management-complete.sql migration.

create extension if not exists pgcrypto;

-- Phone lookups use a normalized index so that 080..., +23480... and 23480...
-- resolve to the same stored Nigerian number.
alter table public.advertisement_customers
  add column if not exists phone_normalized text;

update public.advertisement_customers
set phone_normalized = nullif(
  case
    when length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) = 11
      and left(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 1) = '0'
    then '234' || substring(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') from 2)
    else regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
  end,
  ''
)
where phone is not null;

create index if not exists advertisement_customers_phone_normalized_idx
  on public.advertisement_customers(phone_normalized)
  where phone_normalized is not null;

create or replace function public.advertisement_set_customer_phone_normalized()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  digits text;
begin
  digits := regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g');
  if digits = '' then
    new.phone_normalized := null;
  elsif length(digits) = 11 and left(digits, 1) = '0' then
    new.phone_normalized := '234' || substring(digits from 2);
  elsif length(digits) = 10 then
    new.phone_normalized := '234' || digits;
  else
    new.phone_normalized := digits;
  end if;
  return new;
end;
$$;

drop trigger if exists advertisement_customers_phone_normalized on public.advertisement_customers;
create trigger advertisement_customers_phone_normalized
before insert or update on public.advertisement_customers
for each row execute function public.advertisement_set_customer_phone_normalized();
revoke all on function public.advertisement_set_customer_phone_normalized() from public, anon, authenticated;

-- Cancellation is a retained status, not a hard delete. Permit it on invoices.
alter table public.advertisement_invoices
  drop constraint if exists advertisement_invoices_status_check;
alter table public.advertisement_invoices
  add constraint advertisement_invoices_status_check
  check (status in ('unpaid','pending','paid','void','refunded','cancelled'));

-- One-time verification challenges. Only hashes are stored; the code itself is
-- delivered to the existing email/phone on the advertiser record.
create table if not exists public.advertisement_recovery_challenges (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.advertisement_customers(id) on delete cascade,
  purpose text not null check (purpose in ('recover_id','reset_pin')),
  channel text not null check (channel in ('email','sms')),
  scope_hash text not null,
  ip_hash text not null,
  contact_hash text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists advertisement_recovery_scope_created_idx
  on public.advertisement_recovery_challenges(scope_hash, created_at desc);
create index if not exists advertisement_recovery_ip_created_idx
  on public.advertisement_recovery_challenges(ip_hash, created_at desc);
create index if not exists advertisement_recovery_customer_created_idx
  on public.advertisement_recovery_challenges(customer_id, created_at desc);

alter table public.advertisement_recovery_challenges enable row level security;
revoke all on public.advertisement_recovery_challenges from public, anon, authenticated;
grant all on public.advertisement_recovery_challenges to service_role;

-- Atomically consume one attempt, so parallel guesses cannot bypass the limit.
create or replace function public.advertisement_recovery_attempt(p_challenge_id uuid)
returns table(customer_id uuid, purpose text, otp_hash text, attempt_count integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.advertisement_recovery_challenges c
     set attempt_count = c.attempt_count + 1
   where c.id = p_challenge_id
     and c.consumed_at is null
     and c.expires_at > now()
     and c.attempt_count < 5
  returning c.customer_id, c.purpose, c.otp_hash, c.attempt_count;
end;
$$;

-- A challenge may complete only once, even when multiple verify requests arrive together.
create or replace function public.advertisement_recovery_consume(p_challenge_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.advertisement_recovery_challenges
     set consumed_at = now()
   where id = p_challenge_id
     and consumed_at is null
     and expires_at > now()
     and attempt_count between 1 and 5;
  return found;
end;
$$;

revoke all on function public.advertisement_recovery_attempt(uuid) from public, anon, authenticated;
revoke all on function public.advertisement_recovery_consume(uuid) from public, anon, authenticated;
grant execute on function public.advertisement_recovery_attempt(uuid) to service_role;
grant execute on function public.advertisement_recovery_consume(uuid) to service_role;

comment on table public.advertisement_recovery_challenges is
  'Private one-time Customer ID recovery and tracking PIN reset challenges. Codes are hashed, expire after 10 minutes, and allow at most five attempts.';
