-- PARROTHIT Wazobia Trends: dashboard photos and owner-managed comments.
-- Additive migration. Run once in Supabase SQL Editor after the original Wazobia setup.
-- Does not drop tables, posts, profiles, comments, or existing member data.

alter table public.wazobia_profiles
  add column if not exists cover_url text;

-- The profile table contains public display information only. RLS still restricts writes to each owner.
alter table public.wazobia_profiles enable row level security;
alter table public.wazobia_comments enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.wazobia_profiles, public.wazobia_comments to anon, authenticated;
grant insert, update on public.wazobia_profiles, public.wazobia_comments to authenticated;

drop policy if exists "Wazobia profiles are public" on public.wazobia_profiles;
create policy "Wazobia profiles are public"
  on public.wazobia_profiles for select to anon, authenticated
  using (true);

drop policy if exists "Members update own Wazobia profile" on public.wazobia_profiles;
create policy "Members update own Wazobia profile"
  on public.wazobia_profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Wazobia comments are public" on public.wazobia_comments;
create policy "Wazobia comments are public"
  on public.wazobia_comments for select to anon, authenticated
  using (is_deleted = false);

drop policy if exists "Members create own Wazobia comments" on public.wazobia_comments;
create policy "Members create own Wazobia comments"
  on public.wazobia_comments for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists "Members update own Wazobia comments" on public.wazobia_comments;
create policy "Members update own Wazobia comments"
  on public.wazobia_comments for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create index if not exists wazobia_comments_author_created_idx
  on public.wazobia_comments(author_id, created_at desc);

comment on column public.wazobia_profiles.cover_url is
  'Public URL of the member-owned Wazobia profile cover image.';

-- Photo uploads use the existing wazobia-media bucket and existing owner-folder storage policy:
-- <auth.uid()>/profile/<filename>. No new public write policy is created.
