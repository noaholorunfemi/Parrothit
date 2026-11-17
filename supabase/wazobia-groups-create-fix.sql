-- PARROTHIT Wazobia Groups: group creation RLS repair
-- Run this in Supabase SQL Editor. Safe to run more than once.
create or replace function public.wazobia_create_group(
  p_name text,
  p_description text default '',
  p_privacy text default 'public'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_group_id uuid;
  v_name text := trim(coalesce(p_name,''));
  v_description text := coalesce(p_description,'');
  v_privacy text := coalesce(p_privacy,'public');
begin
  if v_user_id is null then
    raise exception 'Sign in before creating a group.';
  end if;
  if char_length(v_name) < 3 or char_length(v_name) > 80 then
    raise exception 'Group name must be between 3 and 80 characters.';
  end if;
  if char_length(v_description) > 600 then
    raise exception 'Group description must be 600 characters or fewer.';
  end if;
  if v_privacy not in ('public','private') then
    raise exception 'Choose public or private group privacy.';
  end if;

  insert into public.wazobia_groups(name,description,privacy,created_by)
  values(v_name,v_description,v_privacy,v_user_id)
  returning id into v_group_id;
  return v_group_id;
end;
$$;
revoke all on function public.wazobia_create_group(text,text,text) from public, anon;
grant execute on function public.wazobia_create_group(text,text,text) to authenticated;


-- Compatibility for clients still performing a direct insert: allow only the
-- authenticated member to create a group with their own auth.uid() as owner.
grant select, insert on public.wazobia_groups to authenticated;
drop policy if exists "Members create Wazobia groups" on public.wazobia_groups;
create policy "Members create Wazobia groups"
on public.wazobia_groups for insert to authenticated
with check (created_by = (select auth.uid()));
