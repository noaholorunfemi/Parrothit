-- PARROTHIT community member registry for Parrots Interaction.
-- Run this file in Supabase SQL Editor. Does not disable RLS.
create table if not exists public.community_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default 'Community member',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.community_members enable row level security;

drop policy if exists "Members can read own community profile" on public.community_members;
create policy "Members can read own community profile"
  on public.community_members for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Members can create own community profile" on public.community_members;
create policy "Members can create own community profile"
  on public.community_members for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Members can update own community profile" on public.community_members;
create policy "Members can update own community profile"
  on public.community_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Record each new auth account, including users who must confirm email before first login.
create or replace function public.register_parrothit_community_member()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.community_members (user_id, email, display_name, last_seen_at)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), nullif(split_part(coalesce(new.email,''),'@',1),''), 'Community member'),
    now()
  )
  on conflict (user_id) do update set email = excluded.email, last_seen_at = now();
  return new;
end;
$$;

drop trigger if exists parrothit_community_member_signup on auth.users;
create trigger parrothit_community_member_signup
after insert on auth.users
for each row execute function public.register_parrothit_community_member();
