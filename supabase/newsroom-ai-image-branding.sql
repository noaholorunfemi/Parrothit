-- PARROTHIT AI Image Branding Engine
-- Creates a private-admin-managed history table and a public read-only image bucket.
-- Edge Function uploads are performed with the Supabase service role; no browser API key is used for writes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'parrothit-newsroom-branding',
  'parrothit-newsroom-branding',
  true,
  6291456,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.newsroom_image_branding_assets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  source_image_url text,
  original_path text not null,
  branded_path text not null,
  original_image_url text not null,
  branded_image_url text not null,
  mode text not null default 'review' check (mode in ('automatic','review','manual')),
  created_by uuid references auth.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  restored_at timestamptz
);

create index if not exists newsroom_image_branding_assets_post_created_idx
  on public.newsroom_image_branding_assets (post_id, created_at desc);

create unique index if not exists newsroom_image_branding_assets_one_active_per_post
  on public.newsroom_image_branding_assets (post_id)
  where is_active = true;

alter table public.newsroom_image_branding_assets enable row level security;
-- Intentionally no anon/authenticated policies. Only the authenticated, active-admin
-- Edge Function uses the service role to read or write branding history.
