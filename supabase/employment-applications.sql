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

alter table public.employment_applications add column if not exists state text;
alter table public.employment_applications add column if not exists local_government text;
alter table public.employment_applications add column if not exists town text;
alter table public.employment_applications add column if not exists street_address text;
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

-- Applicant documents remain private. Browser uploads use short-lived signed TUS upload tokens minted by the service-role Edge Function; no public storage object policies are required. Documents are viewed only through five-minute signed URLs issued by the owner-verified Edge Function.

-- Keep the role descriptions comprehensive and consistent in the public vacancy list.
update public.employment_roles set job_description = $job$
ROLE PURPOSE
Lead the editorial quality and daily preparation of PARROTHIT news content. The News Editor ensures that published material is accurate, fair, readable, appropriately sourced and consistent with the publication's editorial standards.

KEY RESPONSIBILITIES
Review submitted reports, headlines, captions and supporting material before publication; verify names, dates, locations, figures and quotations; assess source credibility and request corroboration for material claims; edit copy for clarity, grammar, balance, legal sensitivity and house style; assign stories and coordinate deadlines with reporters; identify breaking-news updates and corrections; ensure headlines accurately represent article content; flag allegations, privacy issues and high-risk stories to Admin 1 before publication; maintain a clear record of edits and corrections; and protect embargoed or unpublished information.

EXPECTED DELIVERABLES
Publication-ready articles, accurate headlines and summaries, documented fact-check notes, correction requests where needed, and a reliable editorial handover at the end of each shift.

REQUIRED COMPETENCIES
Excellent writing and editing, sound news judgement, attention to detail, source verification, deadline management, discretion and the ability to give constructive feedback. Journalism, English, communications or equivalent practical experience is desirable. The employee must follow the PARROTHIT approval workflow and may not publish restricted material without authorisation.
$job$ where id='news-editor';

update public.employment_roles set job_description = $job$
ROLE PURPOSE
Research, gather and submit accurate, original and timely news reports for PARROTHIT. The reporter is responsible for establishing what happened, identifying reliable sources and presenting verified information in clear language.

KEY RESPONSIBILITIES
Monitor assigned beats and credible public sources; propose story ideas with clear public-interest value; conduct interviews respectfully and record the context of statements; verify claims with primary documents, named sources or independent corroboration where practical; distinguish confirmed facts from allegations, estimates and opinion; provide accurate names, dates, locations, figures, quotations, image captions and source notes; submit concise headlines, summaries and complete copy; obtain permission for supplied photographs or recordings; disclose conflicts of interest; protect confidential sources and unpublished material; correct factual errors promptly; and meet agreed editorial deadlines.

EXPECTED DELIVERABLES
Original story drafts, interview notes, source links, supporting images with rights information, follow-up updates and accurate field reports.

REQUIRED COMPETENCIES
Strong communication, curiosity, ethical interviewing, research skills, clear writing, digital literacy, initiative and the ability to work independently. Journalism training or demonstrable reporting experience is desirable but a strong portfolio may be considered. Reporters submit stories for editorial review and do not publish directly unless specifically authorised.
$job$ where id='news-reporter';

update public.employment_roles set job_description = $job$
ROLE PURPOSE
Coordinate PARROTHIT's football and wider sports coverage, ensuring that match reports, previews, results and sports features are accurate, timely and properly attributed.

KEY RESPONSIBILITIES
Plan coverage of major leagues, competitions and sporting events; assign previews, reports, interviews and features; verify match scores, goal times, cards, team names, competition names and fixture dates against reliable sources; check that automated LiveScore data is presented in the correct context; edit sports copy and headlines; coordinate contributors and deadlines; identify breaking sports stories; ensure statistics are not presented without a reliable source; respect image, video and broadcast rights; review team and competition logos for accuracy; and escalate corrections or sensitive allegations to Admin 1.

EXPECTED DELIVERABLES
Match previews and reports, sports news updates, editorial schedules, verified score and statistic notes, contributor assignments and clear post-event summaries.

REQUIRED COMPETENCIES
Strong knowledge of football and other covered sports, sports writing and editing, research, data checking, deadline discipline and an understanding of competition structures. Experience in sports journalism, communications or content operations is desirable. The role does not permit changing API credentials or production LiveScore settings unless separately authorised.
$job$ where id='sports-editor';

update public.employment_roles set job_description = $job$
ROLE PURPOSE
Manage approved PARROTHIT social publishing and audience engagement while protecting the publication's voice, reputation and account security.

KEY RESPONSIBILITIES
Prepare channel-specific copy and creative briefs from approved articles; schedule and publish only authorised material; maintain an accurate content calendar; adapt headlines without distorting the facts; monitor comments, messages and audience feedback; identify misinformation, impersonation, abusive activity and urgent editorial issues; escalate complaints and breaking-news developments; track reach, engagement, referrals and other agreed performance indicators; produce periodic reports; coordinate campaigns with the editorial and advertising teams; and keep social account access confidential.

EXPECTED DELIVERABLES
A maintained social calendar, approved platform posts, campaign reports, engagement summaries and documented escalations.

REQUIRED COMPETENCIES
Excellent writing, platform knowledge, visual judgement, analytics literacy, tact, time management and sound editorial judgement. Experience managing professional social accounts is desirable. The employee must use approved brand assets, comply with platform rules, avoid misleading engagement tactics and never share passwords or access tokens. Paid promotions and commercial claims require prior owner approval.
$job$ where id='social-media';

update public.employment_roles set job_description = $job$
ROLE PURPOSE
Maintain a safe, respectful and useful PARROTHIT community by supporting members and applying published community standards consistently.

KEY RESPONSIBILITIES
Review reports and flagged posts; assess content against community rules; remove or escalate content only within assigned authority; document moderation actions; identify spam, harassment, threats, impersonation, scams and attempts to expose private information; provide clear, neutral explanations to members when appropriate; escalate credible threats, safeguarding concerns and legal requests immediately; support room organisation and community announcements; protect member information; and avoid favouritism or discriminatory moderation.

EXPECTED DELIVERABLES
Timely moderation queues, clear action notes, escalated safety reports, member-support responses and periodic community health summaries.

REQUIRED COMPETENCIES
Calm communication, fairness, confidentiality, attention to context, sound judgement and familiarity with online community safety. Previous moderation, customer support or trust-and-safety experience is helpful. Moderators must not access private messages or account data outside their assigned authority, promise outcomes, or share screenshots containing personal information. Serious cases must be referred to Admin 1.
$job$ where id='community-manager';

update public.employment_roles set job_description = $job$
ROLE PURPOSE
Produce clear, original and brand-consistent visual material that supports PARROTHIT journalism, sports coverage, social channels and approved campaigns.

KEY RESPONSIBILITIES
Create editorial graphics, article illustrations, social cards, thumbnails, charts and promotional designs from approved briefs; follow PARROTHIT brand colours and logo rules; check spelling, names, numbers and visual context; use only original, licensed or otherwise authorised assets; keep source files organised; provide exports in requested dimensions and accessible formats; prepare revisions after editorial review; maintain a record of asset sources and licences; and avoid visuals that materially misrepresent an event or person.

EXPECTED DELIVERABLES
Editable design source files, approved web and social exports, campaign artwork, organised asset folders and licence/source notes.

REQUIRED COMPETENCIES
Strong layout, typography, image-editing and composition skills; proficiency with relevant design tools; attention to detail; responsiveness to feedback; and knowledge of digital image formats and accessibility. A portfolio is expected. The designer must not use copyrighted imagery without permission, create deceptive images or publish artwork independently without approval.
$job$ where id='graphics-designer';

update public.employment_roles set job_description = $job$
ROLE PURPOSE
Edit and prepare authorised video and multimedia material for PARROTHIT's website and social channels while maintaining context, quality and rights compliance.

KEY RESPONSIBILITIES
Review supplied footage and production briefs; trim and assemble video and audio; add titles, captions, lower-thirds and approved branding; ensure names, dates, locations and quotations are accurate; maintain context and avoid misleading edits; balance audio and export suitable formats and aspect ratios; prepare thumbnails and transcripts where requested; keep project files and source assets organised; confirm usage rights for music, footage and images; and submit work for editorial approval before publication.

EXPECTED DELIVERABLES
Final approved videos, caption files, thumbnails, editable project files, source/rights notes and a clear list of any unavailable or unverified material.

REQUIRED COMPETENCIES
Video-editing, audio, storytelling, file-management and digital-publishing skills; an eye for detail; ability to meet deadlines; and a portfolio or sample work. The employee must not remove material context, fabricate footage, use unlicensed content or publish raw/unedited sensitive material without authorisation.
$job$ where id='video-producer';

update public.employment_roles set job_description = $job$
ROLE PURPOSE
Support the growth of PARROTHIT's advertising and commercial partnerships through accurate communication, organised follow-up and responsible campaign coordination.

KEY RESPONSIBILITIES
Respond to advertiser enquiries using approved rate cards and policies; explain available placements and submission requirements; collect campaign briefs and creative assets; coordinate with the advertising manager and Admin 1 on availability, pricing and approvals; maintain accurate prospect and client records; follow up on invoices and campaign milestones through authorised channels; check that published campaigns match approved terms; report delivery issues; and provide campaign summaries. Do not promise audience figures, editorial coverage, guaranteed results or discounts that have not been approved.

EXPECTED DELIVERABLES
Organised enquiry records, campaign briefs, client follow-ups, accurate status updates and periodic commercial activity reports.

REQUIRED COMPETENCIES
Professional communication, organisation, customer relationship skills, basic sales knowledge, spreadsheet literacy and integrity. Sales or advertising experience is desirable. All payments must go through approved PARROTHIT payment channels; employees must never collect funds into personal accounts or request clients' passwords, PINs or card details.
$job$ where id='advertising-executive';

update public.employment_roles set job_description = $job$
ROLE PURPOSE
Support reliable day-to-day website operations through structured testing, documentation and first-line technical assistance under the direction of Admin 1.

KEY RESPONSIBILITIES
Check public pages and approved admin workflows; reproduce and document bugs with page, browser, device, steps and screenshots; review broken links, layout issues and basic performance; assist with content and media troubleshooting; maintain technical notes and release checklists; test approved changes in a safe environment; report suspicious activity; protect API keys, passwords and database credentials; and follow change-control and backup procedures. Production deployments, access changes, database migrations and credential rotation require explicit owner authorisation.

EXPECTED DELIVERABLES
Reproducible issue reports, routine site-check records, updated documentation, test results and escalations of security or availability problems.

REQUIRED COMPETENCIES
Web fundamentals, careful testing, troubleshooting, documentation, confidentiality and clear communication. Familiarity with HTML, CSS, JavaScript, Supabase or hosting tools is useful but does not grant independent production access. The employee must never copy private user data to personal storage or make unapproved changes to the live website.
$job$ where id='technology-admin';

update public.employment_roles set job_description = $job$
ROLE PURPOSE
Help PARROTHIT maintain factual accuracy by researching claims, checking sources and identifying gaps or uncertainty before publication.

KEY RESPONSIBILITIES
Verify names, dates, figures, quotations, locations and chronology; locate primary documents and credible independent sources; check the original context of photos, videos and social posts; distinguish fact from allegation, analysis and opinion; identify manipulated or recycled media indicators; record links, publication dates and relevant extracts; flag conflicting accounts and unresolved questions; review statistical claims and calculations; and provide concise fact-check notes to editors. Never silently rewrite a source or present an unverified claim as established fact.

EXPECTED DELIVERABLES
Source lists, claim-check notes, verification summaries, corrections recommendations and clear records of uncertainty.

REQUIRED COMPETENCIES
Strong research, critical thinking, source evaluation, digital verification, careful writing and independence. Experience in research, journalism, law, data or related fields is an advantage. The assistant must protect confidential sources, disclose conflicts of interest and escalate high-risk claims rather than making legal or editorial decisions beyond their authority.
$job$ where id='research-factcheck';

update public.employment_roles set job_description = $job$
ROLE PURPOSE
Provide courteous first-line assistance to PARROTHIT visitors, applicants, advertisers and community members, and route requests to the appropriate team.

KEY RESPONSIBILITIES
Respond to enquiries using current approved information; clarify the nature of a request without collecting unnecessary personal data; record and route complaints, corrections, advertising questions and technical issues; explain published processes and expected next steps; identify urgent safety or account-security concerns; maintain professional response times; follow up on open cases; and prepare recurring enquiry summaries. Never ask users for passwords, one-time codes, payment PINs or full card details, and never promise refunds, publication or employment decisions without authority.

EXPECTED DELIVERABLES
Accurate enquiry records, courteous responses, resolved routine requests, appropriately escalated cases and service-quality summaries.

REQUIRED COMPETENCIES
Written and verbal communication, patience, empathy, organisation, confidentiality and basic digital literacy. Customer service experience is desirable. The employee must follow identity-verification rules for account matters and use only approved support channels.
$job$ where id='audience-support';

update public.employment_roles set job_description = $job$
ROLE PURPOSE
Assist the editorial and publishing teams by preparing approved material for accurate, consistent and timely publication.

KEY RESPONSIBILITIES
Format approved articles in the publishing system; check headings, paragraphs, links, images, captions, alt text and metadata; enter categories, tags and summaries carefully; confirm that links work and media files are suitable; prepare drafts for scheduled publication; maintain a publishing checklist; coordinate revisions with editors; flag missing sources or unusual claims; and ensure that only content marked as approved is scheduled or published. Do not change the meaning of a story or bypass editorial review.

EXPECTED DELIVERABLES
Well-formatted drafts, complete metadata, publishing checklists, link/media checks and accurate handover notes.

REQUIRED COMPETENCIES
Good written English, attention to detail, time management, basic web publishing and willingness to follow documented processes. Experience with content-management systems is helpful. The assistant must protect login credentials, avoid copying confidential material to personal accounts and refer editorial decisions to the News Editor or Admin 1.
$job$ where id='content-assistant';

-- Remove the prior anonymous policy helper, if an earlier patch installed it.
-- Signed TUS upload tokens are the authorization mechanism; the bucket remains private.
drop policy if exists "employment_private_draft_upload_insert" on storage.objects;
drop function if exists public.employment_upload_path_allowed(text);
