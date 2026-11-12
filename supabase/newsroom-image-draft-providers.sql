-- PARROTHIT AI image drafting provider selection and reversible draft-image history.
-- Provider API credentials remain in Supabase Edge Function Secrets.

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
  provider_id text not null check (provider_id in ('cloudflare','ovh','huggingface','pollinations','stability','replicate')),
  model text not null,
  prompt text not null,
  created_by uuid references auth.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  restored_at timestamptz
);

create index if not exists newsroom_image_draft_assets_post_created_idx on public.newsroom_image_draft_assets(post_id,created_at desc);
create unique index if not exists newsroom_image_draft_assets_one_active_per_post on public.newsroom_image_draft_assets(post_id) where is_active=true;

alter table public.newsroom_image_draft_assets enable row level security;
-- No anon/authenticated table policies: reads and writes are performed through the
-- already session-checked newsroom Edge Function using the Supabase service role.
