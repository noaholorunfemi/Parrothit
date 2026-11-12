-- PARROTHIT Homepage Image Ads Push Notifications
-- Run once in the Supabase SQL Editor. This does not modify the article-push queue.

create table if not exists public.parrothit_homepage_ad_push_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null default '',
  slides jsonb not null default '[]'::jsonb,
  cover_image_url text,
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed','no_subscribers')),
  onesignal_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint parrothit_home_ad_slides_array check (jsonb_typeof(slides) = 'array')
);

create index if not exists parrothit_home_ad_push_events_created_idx
  on public.parrothit_homepage_ad_push_events(created_at desc);

alter table public.parrothit_homepage_ad_push_events enable row level security;
revoke all on table public.parrothit_homepage_ad_push_events from anon, authenticated;
-- The gallery is public content, but visitors can only read the public ad snapshot fields.
grant select (id, title, summary, slides, cover_image_url, created_at)
  on table public.parrothit_homepage_ad_push_events to anon, authenticated;
grant all on table public.parrothit_homepage_ad_push_events to service_role;

drop policy if exists "public can read homepage ad notification snapshots"
  on public.parrothit_homepage_ad_push_events;
create policy "public can read homepage ad notification snapshots"
  on public.parrothit_homepage_ad_push_events
  for select to anon, authenticated
  using (status in ('pending','sending','sent'));

create or replace function public.queue_parrothit_homepage_ad_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  homepage_record jsonb;
  previous_homepage_record jsonb;
  active_slides jsonb := '[]'::jsonb;
  active_count integer := 0;
  cover_image text;
  slides_source jsonb;
begin
  -- This trigger is attached only to site_settings, but guard the key as well.
  if new.key <> 'category_images' then
    return new;
  end if;

  homepage_record := new.value #> '{__category_ad_sliders,index}';
  if homepage_record is null or jsonb_typeof(homepage_record) <> 'object' then
    return new;
  end if;

  -- Updates to other categories must not notify Homepage ad subscribers.
  if tg_op = 'UPDATE' then
    previous_homepage_record := old.value #> '{__category_ad_sliders,index}';
    if previous_homepage_record is not distinct from homepage_record then
      return new;
    end if;
  end if;

  -- A disabled Homepage slider should not generate a push notification.
  if coalesce((homepage_record ->> 'enabled')::boolean, true) = false then
    return new;
  end if;

  slides_source := case
    when jsonb_typeof(homepage_record -> 'slides') = 'array' then homepage_record -> 'slides'
    else '[]'::jsonb
  end;

  select coalesce(jsonb_agg(s.item order by
    case when coalesce(s.item ->> 'slot', '') ~ '^[0-9]+$'
      then (s.item ->> 'slot')::integer else 999 end
  ), '[]'::jsonb)
  into active_slides
  from (
    select value as item
    from jsonb_array_elements(slides_source) as source(value)
    where coalesce((value ->> 'enabled')::boolean, true) = true
      and nullif(trim(coalesce(value ->> 'image', '')), '') is not null
    order by case when coalesce(value ->> 'slot', '') ~ '^[0-9]+$'
      then (value ->> 'slot')::integer else 999 end
    limit 10
  ) as s;

  active_count := jsonb_array_length(active_slides);
  if active_count = 0 then
    return new;
  end if;

  select item ->> 'image'
    into cover_image
  from jsonb_array_elements(active_slides) as item
  limit 1;

  insert into public.parrothit_homepage_ad_push_events
    (title, summary, slides, cover_image_url)
  values (
    'PARROTHIT Homepage Ads Updated',
    'The Homepage advertising slider has been updated. Browse ' || active_count::text ||
      ' image ad' || case when active_count = 1 then '' else 's' end ||
      ' and explore each advertiser.',
    active_slides,
    cover_image
  );

  return new;
end;
$$;

revoke all on function public.queue_parrothit_homepage_ad_push() from public, anon, authenticated;

drop trigger if exists parrothit_queue_homepage_ad_push on public.site_settings;
create trigger parrothit_queue_homepage_ad_push
  after insert or update of value on public.site_settings
  for each row
  when (new.key = 'category_images')
  execute function public.queue_parrothit_homepage_ad_push();

comment on table public.parrothit_homepage_ad_push_events is
  'Public snapshots of committed PARROTHIT Homepage image-ad slider updates for OneSignal notifications and the ad gallery.';
