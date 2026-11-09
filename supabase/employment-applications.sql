-- PARROTHIT Work With PARROTHIT / employment applications
-- Run once in Supabase SQL Editor before deploying parrothit-employment.
create extension if not exists pgcrypto;

create table if not exists public.employment_roles (
  id text primary key,
  title text not null unique,
  description text not null default '',
  job_description text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.employment_roles (id,title,description,job_description,sort_order) values
('news-editor','News Editor','Edit, verify and prepare news reports for publication.','Review and edit news submissions for accuracy, clarity, balance and house style. Verify sources and names, improve headlines, coordinate with reporters, flag sensitive stories for owner review, protect unpublished material and maintain editorial standards.',10),
('news-reporter','News Reporter / Correspondent','Research, report and submit accurate news stories.','Research and report assigned stories; verify facts with reliable sources; conduct interviews ethically; provide clear headlines, summaries and supporting media; disclose conflicts of interest; correct errors promptly; meet agreed deadlines and follow editorial standards.',20),
('sports-editor','Sports Editor / Football Desk','Manage sports coverage, match reports and football content.','Coordinate sports coverage, prepare match previews and reports, verify scores and competition information, review sports-related submissions, maintain accuracy in LiveScore-linked editorial content and follow source attribution and media rights requirements.',30),
('social-media','Social Media Manager','Publish approved content and engage with the PARROTHIT audience.','Schedule and publish approved content on authorised social channels, maintain consistent brand voice, monitor audience feedback, escalate complaints and breaking-news issues, report performance and protect account credentials.',40),
('community-manager','Community Manager / Moderator','Support community participation and moderate user activity.','Promote constructive participation, review reported content, apply community rules consistently, escalate threats or sensitive matters, protect member privacy and maintain clear moderation records.',50),
('graphics-designer','Graphics Designer','Create original visual assets for stories and campaigns.','Design original editorial graphics, social cards and promotional materials; follow brand guidelines; use properly licensed assets; provide editable source files when requested; and avoid misleading or unauthorised imagery.',60),
('video-producer','Video Editor / Multimedia Producer','Prepare video and multimedia assets for publication.','Edit and package authorised video/audio content, add captions where appropriate, maintain accurate context, use licensed media, export to approved formats and follow the editorial review workflow.',70),
('advertising-executive','Advertising & Business Development Executive','Support advertiser enquiries, client communication and campaigns.','Respond professionally to advertiser enquiries, explain approved advertising packages, maintain accurate client records, coordinate campaign requirements with the owner and never promise placements, reach or results that have not been approved.',80),
('technology-admin','Technology / Website Support Administrator','Assist with website operations, quality checks and technical support.','Perform assigned website checks, report bugs with reproducible details, maintain documentation, protect credentials and personal data, follow change-control procedures and never deploy code or alter production settings without approval.',90),
('research-factcheck','Research & Fact-checking Assistant','Support research, source verification and content quality.','Verify factual claims against credible sources, maintain source notes, identify uncertainty and conflicting information, check dates and figures, and escalate claims that require editorial judgement.',100),
('audience-support','Audience Support / Customer Relations','Help visitors and advertisers with general enquiries.','Respond courteously to public enquiries using approved information, route complaints to the right team, avoid requesting passwords or payment credentials and protect personal information shared by visitors.',110),
('content-assistant','Content & Publishing Assistant','Support article preparation, formatting and publishing operations.','Prepare approved copy for publishing, check links and formatting, enter metadata accurately, coordinate scheduled content and follow the approval workflow. Do not publish unapproved content.',120)
on conflict (id) do update set title=excluded.title, description=excluded.description, job_description=excluded.job_description, sort_order=excluded.sort_order, updated_at=now();

create table if not exists public.employment_applications (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  middle_name text,
  last_name text not null,
  email text not null,
  phone text not null,
  date_of_birth date,
  gender text,
  country text not null default '',
  city text not null default '',
  address text,
  role_id text not null references public.employment_roles(id) on update cascade,
  role_title text not null,
  application_letter text not null check (char_length(application_letter) between 20 and 10000),
  education jsonb not null default '{}'::jsonb,
  experience jsonb not null default '{}'::jsonb,
  skills text not null default '',
  certifications text not null default '',
  languages text not null default '',
  portfolio_url text,
  linkedin_url text,
  referee jsonb not null default '{}'::jsonb,
  passport_path text,
  resume_path text,
  passport_mime text,
  resume_mime text,
  passport_size bigint,
  resume_size bigint,
  draft_token_hash text,
  consent boolean not null default false check (consent = true),
  status text not null default 'draft' check (status in ('draft','pending','accepted','rejected')),
  decision_note text,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  employment_type text,
  start_date text,
  reporting_to text,
  compensation text,
  final_job_description text,
  employee_admin_user_id uuid references auth.users(id) on delete set null,
  employment_letter text,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employment_applications add column if not exists passport_mime text;
alter table public.employment_applications add column if not exists resume_mime text;
alter table public.employment_applications add column if not exists passport_size bigint;
alter table public.employment_applications add column if not exists resume_size bigint;
alter table public.employment_applications add column if not exists draft_token_hash text;
alter table public.employment_applications alter column status set default 'draft';

create index if not exists employment_applications_created_at_idx on public.employment_applications(created_at desc);
create index if not exists employment_applications_status_idx on public.employment_applications(status, created_at desc);
create index if not exists employment_applications_draft_idx on public.employment_applications(id) where status='draft';
create index if not exists employment_applications_email_created_idx on public.employment_applications(email, created_at desc);

alter table public.admin_profiles add column if not exists job_title text;
alter table public.admin_profiles add column if not exists employment_application_id uuid references public.employment_applications(id) on delete set null;

alter table public.employment_roles enable row level security;
alter table public.employment_applications enable row level security;
-- No direct browser access. All reads/writes run through the service-role Edge Function,
-- which verifies the Admin 1 owner for every administrative action.
revoke all on table public.employment_roles from anon, authenticated;
revoke all on table public.employment_applications from anon, authenticated;
grant all on table public.employment_roles to service_role;
grant all on table public.employment_applications to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employment-private','employment-private',false,52428800,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=52428800, allowed_mime_types=array['image/jpeg','image/png','image/webp'];

-- No anon/authenticated storage policies are created. Documents are private and viewed
-- only through five-minute signed URLs issued by the owner-verified Edge Function.
