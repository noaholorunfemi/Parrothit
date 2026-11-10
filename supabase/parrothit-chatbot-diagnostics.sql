-- PARROTHIT CHATBOT READ-ONLY DATABASE DIAGNOSTIC
-- Run this first query in Supabase SQL Editor. It does not change any data.
-- Each row should show table_exists=true, rls_enabled=true,
-- service_role_can_select=true and anon_can_select=false.

with required_tables(table_name) as (
  values
    ('parrothit_chatbot_settings'),
    ('parrothit_chat_conversations'),
    ('parrothit_chat_messages'),
    ('parrothit_chat_rate_limits')
)
select
  r.table_name,
  to_regclass('public.' || r.table_name) is not null as table_exists,
  coalesce(c.relrowsecurity, false) as rls_enabled,
  case when c.oid is null then false else has_table_privilege('service_role', c.oid, 'select') end as service_role_can_select,
  case when c.oid is null then false else has_table_privilege('service_role', c.oid, 'insert') end as service_role_can_insert,
  case when c.oid is null then false else has_table_privilege('service_role', c.oid, 'update') end as service_role_can_update,
  case when c.oid is null then false else has_table_privilege('service_role', c.oid, 'delete') end as service_role_can_delete,
  case when c.oid is null then false else has_table_privilege('anon', c.oid, 'select') end as anon_can_select
from required_tables r
left join pg_class c on c.oid = to_regclass('public.' || r.table_name)
order by r.table_name;

-- Run this second query only after all four tables exist.
-- It should return exactly one row.
select count(*) as chatbot_settings_rows
from public.parrothit_chatbot_settings
where id = true;
