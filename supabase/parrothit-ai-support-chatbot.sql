-- PARROTHIT AI CUSTOMER SUPPORT CHATBOT
-- Run once in Supabase SQL Editor. No public table access is granted; all access is through the Edge Function.
create extension if not exists pgcrypto;

create table if not exists public.parrothit_chatbot_settings (
  id boolean primary key default true check (id = true),
  is_enabled boolean not null default true,
  sitewide_enabled boolean not null default true,
  advertiser_enabled boolean not null default true,
  use_ai boolean not null default true,
  welcome_message text not null default 'Hello! Welcome to PARROTHIT Support. How can we help you today?',
  handoff_message text not null default 'Your message has been sent to our support team. An administrator will reply here.',
  knowledge_base text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.parrothit_chatbot_settings(id, knowledge_base)
values (true, $$PARROTHIT CUSTOMER SUPPORT KNOWLEDGE BASE
PARROTHIT is a news and information website. Public sections include news, categories, sports, football LiveScore, community/interaction features, and advertising services.
ADVERTISING PACKAGES (NGN): Starter Advertisement ₦5,000 for 7 days; Standard Advertisement ₦10,000 for 14 days; Premium Advertisement ₦20,000 for 30 days; Featured Advertisement ₦35,000 for 30 days; Sponsored Article ₦50,000 for 30 days. Customers should verify the exact current details on the live advertising application page before applying.
HOW TO ADVERTISE: Visit advertise.html, choose an image-ad plan on advertisement-application.html, submit the campaign details, and follow the displayed payment instructions. Campaign approval and placement are handled by PARROTHIT administrators. The chatbot cannot confirm payment or approve a campaign.
VIDEO/GIF ADS: Video and animated GIF campaigns use a separate submission/review/allocation flow. Payment verification is not required for submission or allocation. Admin review is still required.
ADVERTISER DASHBOARD: Customer ID and tracking PIN are issued through the advertiser application/portal flow. Use the website's advertiser dashboard/status pages for account-specific records. Never share a PIN, password, card details, bank OTP, or other private payment credential in chat.
PAYMENTS: Do not claim that a payment has been received. Only the official PARROTHIT payment/backend verification process can confirm payment. Never ask visitors for OTP, card PIN, passwords, or full bank credentials.
SUPPORT: For unresolved enquiries, ask the customer to leave a concise message in this chat. An administrator can take over the conversation and reply here.
LIVESCORE: PARROTHIT LiveScore displays football match information when a configured football data provider is available. Provider/API outages should be reported to support; do not invent live scores, fixtures, lineups, statistics, or results.
EMPLOYMENT: Employment applications are submitted through the official Work with PARROTHIT/Careers page. The chatbot cannot guarantee acceptance or provide private application outcomes.
PRIVACY: Collect only information needed to respond. Do not request passwords, tracking PINs, OTPs, full payment credentials, or sensitive personal information.$$)
on conflict (id) do nothing;

create table if not exists public.parrothit_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  visitor_key_hash text not null,
  source_ip_hash text,
  channel text not null default 'website' check (channel in ('website','advertiser')),
  page_path text not null default '/',
  visitor_name text,
  visitor_email text,
  status text not null default 'open' check (status in ('open','human','closed')),
  assigned_admin uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists parrothit_chat_conversations_recent_idx on public.parrothit_chat_conversations(last_message_at desc);
create index if not exists parrothit_chat_conversations_ip_recent_idx on public.parrothit_chat_conversations(source_ip_hash, created_at desc);

create table if not exists public.parrothit_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.parrothit_chat_conversations(id) on delete cascade,
  sender_role text not null check (sender_role in ('visitor','assistant','admin')),
  message text not null check (length(message) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists parrothit_chat_messages_conversation_idx on public.parrothit_chat_messages(conversation_id, created_at asc);

create table if not exists public.parrothit_chat_rate_limits (
  id bigint generated always as identity primary key,
  source_ip_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists parrothit_chat_rate_limits_recent_idx on public.parrothit_chat_rate_limits(source_ip_hash, created_at desc);

alter table public.parrothit_chatbot_settings enable row level security;
alter table public.parrothit_chat_conversations enable row level security;
alter table public.parrothit_chat_messages enable row level security;
alter table public.parrothit_chat_rate_limits enable row level security;
revoke all on public.parrothit_chatbot_settings from anon, authenticated;
revoke all on public.parrothit_chat_conversations from anon, authenticated;
revoke all on public.parrothit_chat_messages from anon, authenticated;
revoke all on public.parrothit_chat_rate_limits from anon, authenticated;
grant all on public.parrothit_chatbot_settings, public.parrothit_chat_conversations, public.parrothit_chat_messages, public.parrothit_chat_rate_limits to service_role;
grant usage, select on sequence public.parrothit_chat_rate_limits_id_seq to service_role;
-- service_role bypasses RLS and is used only by the protected Edge Function.
