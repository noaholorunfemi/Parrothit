-- PARROTHIT newsroom AI image drafting: provider history and encrypted API-key vault.
-- Execute this migration in Supabase SQL Editor before deploying the updated Edge Function.
-- The encryption master key is NEWSROOM_IMAGE_DRAFT_ENCRYPTION_KEY in Edge Function Secrets;
-- never put the master key or provider API keys in this SQL file or a public environment.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('parrothit-newsroom-branding','parrothit-newsroom-branding',true,6291456,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=excluded.public,file_size_limit=greatest(storage.buckets.file_size_limit,excluded.file_size_limit),allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.newsroom_image_draft_assets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  original_image_path text,
  original_image_url text,
  generated_image_path text not null,
  generated_image_url text not null,
  provider_id text not null,
  model text not null,
  prompt text not null,
  created_by uuid references auth.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  restored_at timestamptz
);

-- Refresh the allow-list for the original six plus 14 added image services.
alter table public.newsroom_image_draft_assets
  drop constraint if exists newsroom_image_draft_assets_provider_id_check;
alter table public.newsroom_image_draft_assets
  add constraint newsroom_image_draft_assets_provider_id_check check (provider_id in (
    'cloudflare','ovh','huggingface','pollinations','stability','replicate',
    'openai','google','fal','runware','ideogram','leonardo','bfl','deepai',
    'getimg','novita','magnific','segmind','pixazo','recraft'
  ));

create index if not exists newsroom_image_draft_assets_post_created_idx
  on public.newsroom_image_draft_assets(post_id,created_at desc);
create unique index if not exists newsroom_image_draft_assets_one_active_per_post
  on public.newsroom_image_draft_assets(post_id) where is_active=true;

-- API keys and the optional Cloudflare Account ID are encrypted by the Edge Function
-- using AES-GCM before being written here. No plaintext credential is stored.
create table if not exists public.newsroom_image_provider_keys (
  provider_id text primary key check (provider_id in (
    'cloudflare','huggingface','pollinations','stability','replicate',
    'openai','google','fal','runware','ideogram','leonardo','bfl','deepai',
    'getimg','novita','magnific','segmind','pixazo','recraft'
  )),
  key_ciphertext text not null,
  key_iv text not null,
  extra_ciphertext text,
  extra_iv text,
  key_hint text not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.newsroom_image_draft_assets enable row level security;
alter table public.newsroom_image_provider_keys enable row level security;

-- Only the authenticated, session-checked Edge Function uses the Supabase service role.
-- Explicitly remove direct browser-role access; no anon/authenticated policies are created.
revoke all on table public.newsroom_image_provider_keys from anon, authenticated;
revoke all on table public.newsroom_image_draft_assets from anon, authenticated;
grant all on table public.newsroom_image_provider_keys to service_role;
grant all on table public.newsroom_image_draft_assets to service_role;
