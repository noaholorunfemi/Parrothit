-- Read-only diagnostic: inspect the latest article notification image references.
-- Run in Supabase SQL Editor. This query does not modify data.
select
  id,
  post_id,
  title,
  image_url,
  status,
  onesignal_message_id,
  error_message,
  created_at,
  sent_at
from public.parrothit_push_notification_events
order by created_at desc
limit 25;

-- Check whether recently published posts have a public image URL.
select
  id,
  title,
  status,
  image_url,
  published_at,
  created_at
from public.posts
where status = 'published'
order by published_at desc nulls last, created_at desc
limit 25;
