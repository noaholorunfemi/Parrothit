-- PARROTHIT Wazobia Trends: repair missing PostgreSQL table privileges.
-- Safe to run more than once. Keeps RLS enabled; policies still control each row.

-- Allow PostgREST roles to resolve objects in the public schema.
grant usage on schema public to anon, authenticated;

-- Public feed data: readable by visitors and signed-in members.
grant select on table
  public.wazobia_profiles,
  public.wazobia_posts,
  public.wazobia_post_reactions,
  public.wazobia_comments,
  public.wazobia_comment_reactions,
  public.wazobia_follows
 to anon, authenticated;

-- Profile ownership is still enforced by the existing RLS policies.
grant insert, update on table public.wazobia_profiles to authenticated;

-- Members can publish and edit only their own posts (RLS checks author_id).
grant insert, update on table public.wazobia_posts to authenticated;

-- Social interactions: RLS checks the acting member's user_id/follower_id.
grant insert, update, delete on table public.wazobia_post_reactions to authenticated;
grant insert, update on table public.wazobia_comments to authenticated;
grant insert, delete on table public.wazobia_comment_reactions to authenticated;
grant insert, delete on table public.wazobia_follows to authenticated;

-- Private member data: never grant these tables to anon.
grant select, insert, delete on table public.wazobia_bookmarks to authenticated;
grant select, update on table public.wazobia_notifications to authenticated;
grant insert, select on table public.wazobia_reports to authenticated;

-- Username availability is intentionally callable before sign-in.
grant execute on function public.wazobia_username_available(text) to anon, authenticated;

-- Tell PostgREST to refresh its schema/privilege cache.
notify pgrst, 'reload schema';
