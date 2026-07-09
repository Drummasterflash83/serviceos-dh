-- ServiceOS — Identity Resolution Engine v1 (evidence engine, not CRM matching).
--
-- Every new interaction asks: who is this? what company? what site? what job? what
-- previous conversations? what next? The answers are EVIDENCE-LED — every match
-- stores its evidence, an explanation and a confidence, is explainable, and is
-- reversible. Nothing is silently merged on weak evidence, and nothing is faked.
--
-- This migration is additive/non-destructive foundation:
--   • recommendations                — the recommendation engine's output
--   • customer_cards: ownership + a live priority score + locked_fields (protect
--     manually-confirmed data) + identity confidence
--   • people / companies: verified + created_source (mark auto-provisioned records)
--
-- The generic `context` jsonb already on customer_cards is the Commusoft-ready
-- linking model (jobs/sites/assets/engineers/quotes/invoices/service_history/
-- documents/photos). RLS: tenant-scoped SELECT; service-role writes. Reuses
-- set_updated_at() + current_tenant_id().

-- ---------------------------------------------------------------------------
-- recommendations — computed, explainable next-actions (never auto-executed in v1)
-- severity: critical | high | medium | low | info
-- status:   open | actioned | dismissed | expired
-- ---------------------------------------------------------------------------
create table if not exists recommendations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  type               text not null,                 -- e.g. repeat_contact_today | review_new_contact
  title              text not null,
  detail             text,
  severity           text not null default 'medium',
  status             text not null default 'open',
  card_id            uuid references customer_cards (id) on delete cascade,
  interaction_id     uuid references interactions (id) on delete set null,
  person_id          uuid,
  company_id         uuid,
  evidence           jsonb not null default '[]'::jsonb,
  recommended_action text,
  confidence         numeric,
  created_by         text not null default 'system', -- system | ai | user id
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  resolved_at        timestamptz
);
create index if not exists recommendations_tenant_status_idx
  on recommendations (tenant_id, status, created_at desc);
create index if not exists recommendations_tenant_type_idx on recommendations (tenant_id, type);
create index if not exists recommendations_tenant_card_idx on recommendations (tenant_id, card_id);
-- At most one OPEN recommendation of a given type per card → idempotent generation.
create unique index if not exists recommendations_open_uk
  on recommendations (tenant_id, card_id, type)
  where status = 'open' and card_id is not null;

drop trigger if exists recommendations_set_updated_at on recommendations;
create trigger recommendations_set_updated_at
  before update on recommendations for each row execute function set_updated_at();
alter table recommendations enable row level security;

drop policy if exists recommendations_select_tenant on recommendations;
create policy recommendations_select_tenant on recommendations
  for select to authenticated using (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- customer_cards — ownership, live priority, and protection of manual data.
-- ---------------------------------------------------------------------------
alter table customer_cards
  add column if not exists assigned_team_id   uuid,
  add column if not exists watchers           jsonb   not null default '[]'::jsonb,
  add column if not exists followers          jsonb   not null default '[]'::jsonb,
  add column if not exists helper_suggestions jsonb   not null default '[]'::jsonb,
  add column if not exists priority_score     numeric,
  add column if not exists priority_inputs    jsonb   not null default '{}'::jsonb,
  -- Column names a human has manually confirmed — the engine NEVER overwrites these.
  add column if not exists locked_fields      text[]  not null default '{}',
  add column if not exists confidence         numeric;

create index if not exists customer_cards_tenant_score_idx
  on customer_cards (tenant_id, priority_score desc);

-- ---------------------------------------------------------------------------
-- people / companies — provenance so auto-provisioned records are honest.
-- created_source: interaction | manual | import
-- ---------------------------------------------------------------------------
alter table people
  add column if not exists verified       boolean not null default false,
  add column if not exists created_source text;

alter table companies
  add column if not exists verified       boolean not null default false,
  add column if not exists created_source text;
