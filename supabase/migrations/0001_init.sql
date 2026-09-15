-- Spamtext: schema for spam text / robocall reporting and recovery pipeline.
-- Apply with: supabase db push   (or paste into the Supabase SQL editor)

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type report_kind as enum ('sms', 'call', 'voicemail');

create type report_status as enum (
  'received',          -- uploaded from phone
  'identifying',       -- lookup + LLM extraction running
  'identified',        -- sender/entity resolved as far as we can
  'needs_identification', -- could not resolve; retried weekly
  'closed',
  'error'
);

create type complaint_agency as enum ('ftc', 'fcc', 'dnc');
create type complaint_status as enum ('pending', 'running', 'submitted', 'failed', 'manual', 'skipped');

create type claim_status as enum (
  'assessing',         -- collecting messages / evaluating strength
  'not_yet_viable',    -- e.g. only 1 message so far, waiting for a second
  'demand_hold',       -- letter generated, cancel window open
  'demand_sent',       -- letter mailed / emailed
  'awaiting_response', -- inside 30-day window
  'responded',         -- company replied (manual update)
  'small_claims_ready',-- deadline passed, packet generated
  'filed',             -- user filed in Justice Court (manual)
  'settled',
  'closed'
);

-- ---------------------------------------------------------------------------
-- Entities: the real company behind a number (best effort)
-- ---------------------------------------------------------------------------
create table entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  aliases text[] not null default '{}',
  domain text,
  website text,
  email text,
  phone text,
  mailing_address jsonb,           -- {line1,line2,city,state,zip,country,source}
  registered_agent jsonb,          -- {name,address,source}
  az_sos_registered boolean,       -- Arizona telephone solicitor registration (null = unchecked)
  confidence numeric not null default 0, -- 0..1
  sources jsonb not null default '[]',   -- [{type,url,note}]
  notes text,
  manual boolean not null default false, -- user-entered via Telegram/dashboard
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index entities_name_idx on entities (lower(name));
create index entities_domain_idx on entities (lower(domain));

-- ---------------------------------------------------------------------------
-- Senders: phone numbers / short codes that sent something
-- ---------------------------------------------------------------------------
create table senders (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,      -- E.164 or short code as received
  is_short_code boolean not null default false,
  line_type text,                  -- mobile, landline, voip, tollFree, ... (Twilio)
  carrier text,
  caller_name text,
  lookup_json jsonb,
  looked_up_at timestamptz,
  entity_id uuid references entities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Reports: one per spam text / call / voicemail reported from the phone
-- ---------------------------------------------------------------------------
create table reports (
  id uuid primary key default gen_random_uuid(),
  kind report_kind not null,
  sender_phone text not null,
  sender_id uuid references senders(id) on delete set null,
  body text,                        -- SMS text or voicemail transcript
  audio_path text,                  -- storage path for voicemail audio
  received_at timestamptz not null, -- when the message/call arrived on the phone
  duration_seconds int,             -- calls
  prerecorded boolean,              -- user-tagged: recorded/robocall voice
  forwarded_7726 boolean not null default false,
  forwarded_7726_at timestamptz,
  device_id text,
  dedupe_key text not null unique,  -- sha256(kind|phone|received_at|body)
  status report_status not null default 'received',
  is_marketing boolean,             -- LLM classification
  category text,                    -- LLM: e.g. debt_relief, solar, political, scam, ...
  extracted jsonb,                  -- LLM extraction result
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reports_sender_idx on reports (sender_phone, received_at desc);
create index reports_status_idx on reports (status);

-- ---------------------------------------------------------------------------
-- Complaint jobs: government filings done by the browser worker
-- ---------------------------------------------------------------------------
create table complaint_jobs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  agency complaint_agency not null,
  status complaint_status not null default 'pending',
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  confirmation text,                -- reference number if the site gives one
  screenshot_path text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, agency)
);
create index complaint_jobs_pending_idx on complaint_jobs (status, run_after);

-- ---------------------------------------------------------------------------
-- Claims: one per entity (or per unknown sender phone) = the money track
-- ---------------------------------------------------------------------------
create table claims (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references entities(id) on delete set null,
  sender_phone text,                -- used when entity unknown
  status claim_status not null default 'assessing',
  violation_count int not null default 0,
  basis jsonb not null default '{}',      -- {tcpa_c5:bool, tcpa_b3:bool, cfr_1200d:bool, az_1282:bool, reasons:[]}
  estimated_min_cents bigint not null default 0,   -- count * $500
  estimated_max_cents bigint not null default 0,   -- count * $1500
  demand_amount_cents bigint,
  demand_letter_path text,
  demand_hold_until timestamptz,
  demand_sent_at timestamptz,
  demand_channel text,              -- lob_certified | email | manual
  lob_letter_id text,
  lob_tracking jsonb,
  response_deadline date,
  small_claims_packet_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index claims_entity_open_idx on claims (entity_id) where entity_id is not null and status not in ('settled','closed');
create unique index claims_phone_open_idx on claims (sender_phone) where entity_id is null and sender_phone is not null and status not in ('settled','closed');

create table claim_reports (
  claim_id uuid not null references claims(id) on delete cascade,
  report_id uuid not null references reports(id) on delete cascade,
  primary key (claim_id, report_id)
);

-- ---------------------------------------------------------------------------
-- Spend: every paid action, for the monthly cap
-- ---------------------------------------------------------------------------
create table spend (
  id uuid primary key default gen_random_uuid(),
  category text not null,           -- twilio_lookup | anthropic | lob | other
  amount_cents int not null,
  description text,
  ref text,
  created_at timestamptz not null default now()
);
create index spend_month_idx on spend (created_at);

-- ---------------------------------------------------------------------------
-- Monitor hits: enforcement actions / settlements mentioning an entity
-- ---------------------------------------------------------------------------
create table monitor_hits (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references entities(id) on delete cascade,
  source text not null,             -- ftc_press | fcc_news | class_action
  title text not null,
  url text not null,
  summary text,
  notified boolean not null default false,
  found_at timestamptz not null default now(),
  unique (entity_id, url)
);

-- ---------------------------------------------------------------------------
-- Settings (single user) and event log
-- ---------------------------------------------------------------------------
create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table events (
  id bigint generated always as identity primary key,
  report_id uuid references reports(id) on delete cascade,
  claim_id uuid references claims(id) on delete cascade,
  level text not null default 'info', -- info | warn | error
  message text not null,
  data jsonb,
  created_at timestamptz not null default now()
);
create index events_report_idx on events (report_id, created_at desc);
create index events_claim_idx on events (claim_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['entities','senders','reports','complaint_jobs','claims','settings']
  loop
    execute format('create trigger %I_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage bucket for PDFs, screenshots and voicemail audio (private)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS: everything is accessed with the service role from the backend/worker.
-- Lock the anon/authenticated roles out entirely.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['entities','senders','reports','complaint_jobs','claims','claim_reports','spend','monitor_hits','settings','events']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Default settings
insert into settings (key, value) values
  ('monthly_cap_cents', '2000'),
  ('demand_hold_hours', '24'),
  ('state', '"AZ"')
on conflict (key) do nothing;
