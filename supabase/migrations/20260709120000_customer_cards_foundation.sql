-- ServiceOS — Signal Processing & Customer Cards Foundation v1.
--
-- The platform is moving from "sync records" to "process signals": every canonical
-- interaction (phone/email now; Slack/forms/WhatsApp later) becomes a signal that
-- helps build cleaner customer/company/job/task cards over time. This migration
-- lays the DATA foundation only — no CRM logic, no AI matching, no fake data.
--
-- New tables (all additive, non-destructive):
--   • companies                     — organisations
--   • people                        — individuals (optionally linked to a company)
--   • customer_cards                — the operational "what needs attention" card
--   • interaction_match_suggestions — evidence-led link proposals (never silent merges)
--
-- The existing `interactions` table already carries the link columns
-- (related_person_id / related_company_id / related_job_id / related_task_id) and
-- processing_status/priority — this migration provides their targets. Nothing is
-- populated here; a future enrichment/matching phase fills these safely.
--
-- RLS: tenant-scoped SELECT for authenticated users; NO write policies (service
-- role Edge Functions own writes). Reuses set_updated_at() + current_tenant_id().
-- Status/priority/level values are conventions documented inline (free text, like
-- the rest of the schema) — no premature CHECK constraints.

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------
create table if not exists companies (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  name         text not null,
  domain       text,
  phone        text,
  address_text text,
  postcode     text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists companies_tenant_idx on companies (tenant_id);
create index if not exists companies_tenant_domain_idx on companies (tenant_id, domain);

drop trigger if exists companies_set_updated_at on companies;
create trigger companies_set_updated_at
  before update on companies for each row execute function set_updated_at();
alter table companies enable row level security;

-- ---------------------------------------------------------------------------
-- people
-- ---------------------------------------------------------------------------
create table if not exists people (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  company_id    uuid references companies (id) on delete set null,
  display_name  text,
  first_name    text,
  last_name     text,
  primary_email text,
  primary_phone text,
  address_text  text,
  postcode      text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists people_tenant_idx on people (tenant_id);
create index if not exists people_tenant_email_idx on people (tenant_id, primary_email);
create index if not exists people_tenant_phone_idx on people (tenant_id, primary_phone);
create index if not exists people_tenant_company_idx on people (tenant_id, company_id);

drop trigger if exists people_set_updated_at on people;
create trigger people_set_updated_at
  before update on people for each row execute function set_updated_at();
alter table people enable row level security;

-- ---------------------------------------------------------------------------
-- customer_cards — the daily "what needs attention" surface (foundation only).
-- status   (traffic-light): grey | green | amber | red
-- priority (queue):         critical | high | medium | low | waiting | done
-- ---------------------------------------------------------------------------
create table if not exists customer_cards (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  person_id          uuid references people (id) on delete set null,
  company_id         uuid references companies (id) on delete set null,
  title              text,
  summary            text,
  status             text not null default 'grey',
  priority           text not null default 'medium',
  owner_id           uuid,                         -- profiles.id (no FK: avoids auth coupling)
  due_at             timestamptz,
  latest_activity_at timestamptz,
  recommended_action text,
  context            jsonb not null default '{}'::jsonb,
  completed_at       timestamptz,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists customer_cards_tenant_status_idx on customer_cards (tenant_id, status);
create index if not exists customer_cards_tenant_priority_idx on customer_cards (tenant_id, priority);
create index if not exists customer_cards_tenant_person_idx on customer_cards (tenant_id, person_id);
create index if not exists customer_cards_tenant_company_idx on customer_cards (tenant_id, company_id);
create index if not exists customer_cards_tenant_activity_idx
  on customer_cards (tenant_id, latest_activity_at desc);

drop trigger if exists customer_cards_set_updated_at on customer_cards;
create trigger customer_cards_set_updated_at
  before update on customer_cards for each row execute function set_updated_at();
alter table customer_cards enable row level security;

-- ---------------------------------------------------------------------------
-- interaction_match_suggestions — evidence-led link proposals. The system NEVER
-- silently merges on weak AI evidence: matches are proposed here with a confidence
-- score, the evidence used, an explanation and a recommended action, and a human
-- (or a strong-evidence auto-linker, later) resolves them.
-- match_level: confirmed | likely | possible | rejected
-- status:      pending | accepted | rejected | superseded
-- target_type: person | company | customer_card | interaction
-- ---------------------------------------------------------------------------
create table if not exists interaction_match_suggestions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  interaction_id     uuid not null references interactions (id) on delete cascade,
  target_type        text not null,
  target_id          uuid,
  match_level        text not null default 'possible',
  confidence         numeric(5, 4),               -- 0.0000–1.0000
  evidence           jsonb not null default '{}'::jsonb, -- signals used (email/phone/name/…)
  explanation        text,
  recommended_action text,
  status             text not null default 'pending',
  created_by         text,                        -- 'ai' | 'system' | user id
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, interaction_id, target_type, target_id)
);
create index if not exists ims_tenant_status_idx
  on interaction_match_suggestions (tenant_id, status);
create index if not exists ims_tenant_level_idx
  on interaction_match_suggestions (tenant_id, match_level);
create index if not exists ims_tenant_interaction_idx
  on interaction_match_suggestions (tenant_id, interaction_id);

drop trigger if exists ims_set_updated_at on interaction_match_suggestions;
create trigger ims_set_updated_at
  before update on interaction_match_suggestions for each row execute function set_updated_at();
alter table interaction_match_suggestions enable row level security;

-- ---------------------------------------------------------------------------
-- Tenant-scoped SELECT policies (read-only). Writes are service-role via Edge
-- Functions — no direct client writes, no cross-tenant leakage.
-- ---------------------------------------------------------------------------
drop policy if exists companies_select_tenant on companies;
create policy companies_select_tenant on companies
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists people_select_tenant on people;
create policy people_select_tenant on people
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists customer_cards_select_tenant on customer_cards;
create policy customer_cards_select_tenant on customer_cards
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists ims_select_tenant on interaction_match_suggestions;
create policy ims_select_tenant on interaction_match_suggestions
  for select to authenticated using (tenant_id = current_tenant_id());
