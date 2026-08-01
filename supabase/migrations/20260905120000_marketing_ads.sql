-- ============================================================================
-- Marketing Phase 8 — Ads Lead Capture, Attribution, Metrics & Source Health.
-- Additive, run-once. Builds on the committed Phase 0–7 chain (through
-- 20260904120000_marketing_templates_reporting_ai.sql).
--
-- ADS CAPTURES AND ATTRIBUTES LEADS; IT DOES NOT CREATE OR EDIT ADVERTS.
--
-- One factual flow: configured source → authenticated signed webhook event →
-- append-only provider-event ledger → canonical inbound Interaction →
-- canonical identity resolution (marketing_create_contact, superset below) →
-- Person/relationship through the EXISTING governed authorities → append-only
-- attribution touchpoint → source/lead/metric reporting → live-derived health.
--
-- NO second identity, relationship, interaction, import, event, job or
-- connector-health system is created. Provider credentials live ONLY in the
-- tenant Vault broker (provider_secret_store/read). Meta / Google Ads /
-- LinkedIn / Sheet remain truthfully Not connected: no adapter exists, no
-- metric is fabricated, no manual sync is offered. The ONE operational mode
-- is the provider-neutral SIGNED WEBHOOK (HMAC-SHA256 over timestamp + raw
-- body), honestly labelled as such.
-- ============================================================================

-- ── PART A · AD SOURCES — tenant-scoped, versioned/audited configuration ────

create table marketing_ad_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  provider text not null
    check (provider in ('meta', 'google_ads', 'linkedin', 'webhook', 'sheet')),
  mode text not null check (mode in ('api', 'webhook', 'sheet')),
  name text not null check (length(name) between 1 and 120 and name !~ '[[:cntrl:]]'),
  description text check (description is null
                          or (length(description) <= 500 and description !~ '[[:cntrl:]]')),
  account_ref text check (account_ref is null or length(account_ref) <= 200),
  campaign_ref text check (campaign_ref is null or length(campaign_ref) <= 200),
  ad_ref text check (ad_ref is null or length(ad_ref) <= 200),
  form_ref text check (form_ref is null or length(form_ref) <= 200),
  status text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  -- the OPAQUE public route key for webhook mode (non-enumerable, never
  -- carries tenant/person/secret material). Globally unique for lookup.
  public_key text unique check (public_key is null or public_key ~ '^[0-9a-f]{48}$'),
  -- presence flags only — the signing secret itself lives in the Vault broker
  credential_state text not null default 'unconfigured'
    check (credential_state in ('unconfigured', 'configured')),
  -- when the CURRENT secret was last rotated (a previous secret was retained).
  -- Bounds the rotation overlap: the webhook accepts the previous secret ONLY
  -- inside ADS_WEBHOOK_ROTATION_OVERLAP after this instant, so a rotated-away
  -- secret is retired on a definite schedule, never valid indefinitely. Null on
  -- first configuration (there is no previous secret to honour).
  credential_rotated_at timestamptz,
  default_tag_id uuid,
  default_relationship_type text
    check (default_relationship_type is null or length(default_relationship_type) <= 60),
  default_lifecycle_stage_key text
    check (default_lifecycle_stage_key is null or length(default_lifecycle_stage_key) <= 60),
  default_owner_id uuid,
  notify_attention boolean not null default true,
  timezone text not null default 'UTC' check (length(timezone) <= 60),
  sync_cadence_minutes int check (sync_cadence_minutes is null
                                  or sync_cadence_minutes between 5 and 1440),
  cursor jsonb not null default '{}'::jsonb,
  current_version_id uuid,
  version int not null default 1 check (version >= 1),
  -- projection caches only — health is DERIVED from the append-only ledgers
  last_event_at timestamptz,
  last_processed_at timestamptz,
  created_by uuid,
  updated_by uuid,
  archived_at timestamptz,
  archived_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
alter table marketing_ad_sources
  add constraint mas_created_by_fk foreign key (tenant_id, created_by)
    references profiles (tenant_id, id) on delete set null,
  add constraint mas_updated_by_fk foreign key (tenant_id, updated_by)
    references profiles (tenant_id, id) on delete set null,
  add constraint mas_archived_by_fk foreign key (tenant_id, archived_by)
    references profiles (tenant_id, id) on delete set null,
  add constraint mas_tag_fk foreign key (tenant_id, default_tag_id)
    references marketing_tags (tenant_id, id) on delete set null,
  add constraint mas_owner_fk foreign key (tenant_id, default_owner_id)
    references profiles (tenant_id, id) on delete set null,
  -- the provider/mode pairing is FIXED vocabulary — an api-mode webhook or a
  -- webhook-mode Meta source is structurally impossible
  add constraint mas_provider_mode check (
    (provider in ('meta', 'google_ads', 'linkedin') and mode = 'api')
    or (provider = 'webhook' and mode = 'webhook')
    or (provider = 'sheet' and mode = 'sheet')),
  add constraint mas_webhook_key check (
    (mode = 'webhook') = (public_key is not null));
create index marketing_ad_sources_tenant_idx
  on marketing_ad_sources (tenant_id, status, created_at desc, id);
create trigger marketing_ad_sources_set_updated_at
  before update on marketing_ad_sources
  for each row execute function set_updated_at();

-- identity/lifecycle guard: identity + provider/mode are immutable (a
-- semantic change is a NEW source); version never moves backwards; archive
-- facts move only with their transition
create or replace function marketing_ad_source_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' then
      raise exception 'an ad source is born active' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id
     or new.created_at <> old.created_at
     or new.provider <> old.provider or new.mode <> old.mode
     or new.public_key is distinct from old.public_key then
    raise exception 'ad source identity, provider, mode and public key are immutable — a provider/mode change is a NEW source'
      using errcode = 'restrict_violation';
  end if;
  if new.version < old.version then
    raise exception 'an ad source version can never move backwards' using errcode = '22023';
  end if;
  if new.status = 'archived' and new.archived_at is null then
    raise exception 'archiving records when and by whom' using errcode = '22023';
  end if;
  if new.status <> 'archived' and new.archived_at is not null then
    raise exception 'a restored ad source clears its archive facts' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger marketing_ad_sources_guard
  before insert or update on marketing_ad_sources
  for each row execute function marketing_ad_source_guard();

alter table marketing_ad_sources enable row level security;
create policy marketing_ad_sources_select on marketing_ad_sources
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_ad_sources to authenticated;
grant select, insert, update on marketing_ad_sources to service_role;
revoke delete, truncate on marketing_ad_sources from anon, authenticated, service_role;

-- ── APPEND-ONLY configuration versions — every change is immutable history;
--    lead processing PINS the version that was current at receipt ──
create table marketing_ad_source_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  source_id uuid not null,
  version_number int not null check (version_number >= 1),
  change_kind text not null check (change_kind in
    ('create', 'revise', 'enable', 'disable', 'archive', 'restore',
     'rotate_credential')),
  config jsonb not null,
  changed_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, source_id, version_number)
);
alter table marketing_ad_source_versions
  add constraint masv_source_fk foreign key (tenant_id, source_id)
    references marketing_ad_sources (tenant_id, id) on delete cascade,
  add constraint masv_actor_fk foreign key (tenant_id, changed_by)
    references profiles (tenant_id, id) on delete set null;
alter table marketing_ad_sources
  add constraint mas_current_version_fk foreign key (tenant_id, current_version_id)
    references marketing_ad_source_versions (tenant_id, id) on delete set null;
create index marketing_ad_source_versions_idx
  on marketing_ad_source_versions (tenant_id, source_id, version_number desc);
create trigger marketing_ad_source_versions_append_only_update
  before update on marketing_ad_source_versions
  for each row execute function marketing_history_append_only();
create trigger marketing_ad_source_versions_append_only_delete
  before delete on marketing_ad_source_versions
  for each row execute function marketing_history_append_only();
alter table marketing_ad_source_versions enable row level security;
create policy marketing_ad_source_versions_select on marketing_ad_source_versions
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_ad_source_versions to authenticated;
grant select, insert on marketing_ad_source_versions to service_role;
revoke update, delete, truncate on marketing_ad_source_versions
  from anon, authenticated, service_role;

-- ── PART B · APPEND-ONLY PROVIDER-EVENT LEDGER ──────────────────────────────
-- Identity and payload are immutable; ONLY the processing-state machine and
-- its result references may move, forward-only, through the guard below.

create table marketing_ad_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  source_id uuid not null,
  source_version_id uuid not null,
  provider text not null,
  mode text not null,
  provider_event_id text not null
    check (length(provider_event_id) between 1 and 120
           and provider_event_id !~ '[[:cntrl:]]'),
  body_digest text not null check (body_digest ~ '^[0-9a-f]{64}$'),
  schema_version text not null check (length(schema_version) <= 40),
  received_at timestamptz not null default now(),
  occurred_at timestamptz not null,
  -- the BOUNDED, validated, redaction-safe normalised envelope — never the
  -- raw provider body, never signatures, never secrets
  envelope jsonb not null,
  replay_count int not null default 0 check (replay_count >= 0),
  processing_state text not null default 'pending'
    check (processing_state in
      ('pending', 'processing', 'resolved', 'review', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  error_class text check (error_class is null or length(error_class) <= 60),
  lease_worker text,
  lease_expires_at timestamptz,
  correlation_id uuid not null,
  interaction_id uuid,
  person_id uuid,
  relationship_id uuid,
  identity_conflict_id uuid,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  -- the DEDUP key: one logical provider event per source
  unique (tenant_id, source_id, provider_event_id)
);
alter table marketing_ad_events
  add constraint mae_source_fk foreign key (tenant_id, source_id)
    references marketing_ad_sources (tenant_id, id) on delete cascade,
  add constraint mae_source_version_fk foreign key (tenant_id, source_version_id)
    references marketing_ad_source_versions (tenant_id, id);
create index marketing_ad_events_pending_idx
  on marketing_ad_events (tenant_id, received_at)
  where processing_state = 'pending';
create index marketing_ad_events_feed_idx
  on marketing_ad_events (tenant_id, received_at desc, id);
create index marketing_ad_events_source_idx
  on marketing_ad_events (tenant_id, source_id, received_at desc);
create index marketing_ad_events_person_idx
  on marketing_ad_events (tenant_id, person_id) where person_id is not null;

-- identity/payload immutable; state machine forward-only; result references
-- write-once; replay_count/lease/attempts move only through legal transitions
create or replace function marketing_ad_event_guard()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id or new.tenant_id <> old.tenant_id
     or new.source_id <> old.source_id
     or new.source_version_id <> old.source_version_id
     or new.provider <> old.provider or new.mode <> old.mode
     or new.provider_event_id <> old.provider_event_id
     or new.body_digest <> old.body_digest
     or new.schema_version <> old.schema_version
     or new.received_at <> old.received_at
     or new.occurred_at <> old.occurred_at
     or new.envelope <> old.envelope
     or new.correlation_id <> old.correlation_id
     or new.created_at <> old.created_at then
    raise exception 'ad event identity and payload are immutable' using errcode = 'restrict_violation';
  end if;
  if new.replay_count < old.replay_count then
    raise exception 'replay evidence can never decrease' using errcode = '22023';
  end if;
  if new.processing_state <> old.processing_state then
    if not ((old.processing_state = 'pending' and new.processing_state = 'processing')
         or (old.processing_state = 'processing'
             and new.processing_state in ('resolved', 'review', 'failed'))
         or (old.processing_state in ('failed', 'review')
             and new.processing_state = 'pending')) then
      raise exception 'illegal ad event state transition % -> %',
        old.processing_state, new.processing_state using errcode = '22023';
    end if;
  end if;
  -- result references are write-once facts
  if (old.interaction_id is not null and new.interaction_id is distinct from old.interaction_id)
     or (old.person_id is not null and new.person_id is distinct from old.person_id)
     or (old.relationship_id is not null
         and new.relationship_id is distinct from old.relationship_id)
     or (old.identity_conflict_id is not null
         and new.identity_conflict_id is distinct from old.identity_conflict_id) then
    raise exception 'ad event processing results are write-once' using errcode = 'restrict_violation';
  end if;
  return new;
end $$;
create trigger marketing_ad_events_guard
  before update on marketing_ad_events
  for each row execute function marketing_ad_event_guard();
create trigger marketing_ad_events_append_only_delete
  before delete on marketing_ad_events
  for each row execute function marketing_history_append_only();

alter table marketing_ad_events enable row level security;
create policy marketing_ad_events_select on marketing_ad_events
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_ad_events to authenticated;
grant select, insert, update on marketing_ad_events to service_role;
revoke delete, truncate on marketing_ad_events from anon, authenticated, service_role;

-- ── same-event/different-body conflicts — digests only, never payloads ──
create table marketing_ad_event_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  source_id uuid not null,
  provider_event_id text not null,
  stored_digest text not null check (stored_digest ~ '^[0-9a-f]{64}$'),
  offered_digest text not null check (offered_digest ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  unique (tenant_id, id)
);
alter table marketing_ad_event_conflicts
  add constraint maec_source_fk foreign key (tenant_id, source_id)
    references marketing_ad_sources (tenant_id, id) on delete cascade;
create index marketing_ad_event_conflicts_idx
  on marketing_ad_event_conflicts (tenant_id, source_id, received_at desc);
create trigger marketing_ad_event_conflicts_append_only_update
  before update on marketing_ad_event_conflicts
  for each row execute function marketing_history_append_only();
create trigger marketing_ad_event_conflicts_append_only_delete
  before delete on marketing_ad_event_conflicts
  for each row execute function marketing_history_append_only();
alter table marketing_ad_event_conflicts enable row level security;
create policy marketing_ad_event_conflicts_select on marketing_ad_event_conflicts
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_ad_event_conflicts to authenticated;
grant select, insert on marketing_ad_event_conflicts to service_role;
revoke update, delete, truncate on marketing_ad_event_conflicts
  from anon, authenticated, service_role;

-- ── PART C · APPEND-ONLY ATTRIBUTION TOUCHPOINTS ────────────────────────────
-- One touchpoint per FACTUAL provider event (unique per event → replay-safe).
-- Everything is immutable except the Person link, which is WRITE-ONCE (null →
-- value) so governed reconciliation can attach a later-resolved Person
-- without ever rewriting evidence.

create table marketing_ad_touchpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  source_id uuid not null,
  source_version_id uuid not null,
  provider text not null,
  campaign_ref text,
  ad_ref text,
  form_ref text,
  event_id uuid not null,
  interaction_id uuid,
  person_id uuid,
  company_id uuid,
  kind text not null default 'lead_capture' check (kind in ('lead_capture')),
  confidence text not null
    check (confidence in ('exact', 'review', 'unresolved')),
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  correlation_id uuid not null,
  created_source text not null default 'marketing-ads',
  unique (tenant_id, id),
  unique (tenant_id, event_id)
);
alter table marketing_ad_touchpoints
  add constraint mat_source_fk foreign key (tenant_id, source_id)
    references marketing_ad_sources (tenant_id, id) on delete cascade,
  add constraint mat_source_version_fk foreign key (tenant_id, source_version_id)
    references marketing_ad_source_versions (tenant_id, id),
  add constraint mat_event_fk foreign key (tenant_id, event_id)
    references marketing_ad_events (tenant_id, id) on delete cascade,
  -- the resolved Person/Company links are STRUCTURALLY tenant-bound (repo
  -- precedent: marketing_audience_members / marketing_broadcast_dispatches). A
  -- service-role write — including a future governed reconciliation — can never
  -- forge a cross-tenant or non-existent attribution target. NULL stays legal
  -- while a touchpoint is unresolved/review; the append-only delete trigger
  -- keeps the evidence itself permanent.
  add constraint mat_person_fk foreign key (tenant_id, person_id)
    references people (tenant_id, id) on delete cascade,
  add constraint mat_company_fk foreign key (tenant_id, company_id)
    references companies (tenant_id, id) on delete cascade;
create index marketing_ad_touchpoints_person_idx
  on marketing_ad_touchpoints (tenant_id, person_id, occurred_at, id)
  where person_id is not null;
create index marketing_ad_touchpoints_source_idx
  on marketing_ad_touchpoints (tenant_id, source_id, occurred_at desc);

create or replace function marketing_ad_touchpoint_guard()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id or new.tenant_id <> old.tenant_id
     or new.source_id <> old.source_id
     or new.source_version_id <> old.source_version_id
     or new.provider <> old.provider
     or new.campaign_ref is distinct from old.campaign_ref
     or new.ad_ref is distinct from old.ad_ref
     or new.form_ref is distinct from old.form_ref
     or new.event_id <> old.event_id
     or new.kind <> old.kind
     or new.occurred_at <> old.occurred_at
     or new.recorded_at <> old.recorded_at
     or new.correlation_id <> old.correlation_id
     or new.created_source <> old.created_source then
    raise exception 'attribution touchpoints are immutable evidence' using errcode = 'restrict_violation';
  end if;
  -- the Person/Company/Interaction links + confidence move ONCE, from
  -- unresolved to a governed resolution — never away from a recorded value
  if (old.person_id is not null and new.person_id is distinct from old.person_id)
     or (old.company_id is not null and new.company_id is distinct from old.company_id)
     or (old.interaction_id is not null
         and new.interaction_id is distinct from old.interaction_id) then
    raise exception 'a touchpoint person/company/interaction link is write-once'
      using errcode = 'restrict_violation';
  end if;
  if new.confidence <> old.confidence
     and not (old.confidence in ('unresolved', 'review') and new.confidence = 'exact') then
    raise exception 'touchpoint confidence can only move to exact through governed reconciliation'
      using errcode = '22023';
  end if;
  return new;
end $$;
create trigger marketing_ad_touchpoints_guard
  before update on marketing_ad_touchpoints
  for each row execute function marketing_ad_touchpoint_guard();
create trigger marketing_ad_touchpoints_append_only_delete
  before delete on marketing_ad_touchpoints
  for each row execute function marketing_history_append_only();

alter table marketing_ad_touchpoints enable row level security;
create policy marketing_ad_touchpoints_select on marketing_ad_touchpoints
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_ad_touchpoints to authenticated;
grant select, insert, update on marketing_ad_touchpoints to service_role;
revoke delete, truncate on marketing_ad_touchpoints
  from anon, authenticated, service_role;

-- ── PART D · APPEND-ONLY PROVIDER METRIC FACTS + SYNC RUNS ──────────────────
-- Facts arrive ONLY from a genuinely connected adapter (none exists yet) or
-- from test fixtures through the governed recorder. Corrections APPEND with a
-- supersession reference; browsers can never write here.

create table marketing_ad_sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  source_id uuid not null,
  kind text not null check (kind in ('manual', 'scheduled')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'unknown')),
  started_at timestamptz,
  finished_at timestamptz,
  cursor_before jsonb,
  cursor_after jsonb,
  stats jsonb not null default '{}'::jsonb,
  error_class text check (error_class is null or length(error_class) <= 60),
  requested_by uuid,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
alter table marketing_ad_sync_runs
  add constraint masr_source_fk foreign key (tenant_id, source_id)
    references marketing_ad_sources (tenant_id, id) on delete cascade,
  add constraint masr_actor_fk foreign key (tenant_id, requested_by)
    references profiles (tenant_id, id) on delete set null;
create index marketing_ad_sync_runs_idx
  on marketing_ad_sync_runs (tenant_id, source_id, created_at desc);
create or replace function marketing_ad_sync_run_guard()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id or new.tenant_id <> old.tenant_id
     or new.source_id <> old.source_id or new.kind <> old.kind
     or new.created_at <> old.created_at
     or new.correlation_id <> old.correlation_id then
    raise exception 'sync run identity is immutable' using errcode = 'restrict_violation';
  end if;
  if new.status <> old.status
     and not ((old.status = 'queued' and new.status in ('running', 'failed'))
           or (old.status = 'running'
               and new.status in ('succeeded', 'failed', 'unknown'))) then
    raise exception 'illegal sync run transition % -> %', old.status, new.status
      using errcode = '22023';
  end if;
  return new;
end $$;
create trigger marketing_ad_sync_runs_guard
  before update on marketing_ad_sync_runs
  for each row execute function marketing_ad_sync_run_guard();
create trigger marketing_ad_sync_runs_append_only_delete
  before delete on marketing_ad_sync_runs
  for each row execute function marketing_history_append_only();
alter table marketing_ad_sync_runs enable row level security;
create policy marketing_ad_sync_runs_select on marketing_ad_sync_runs
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_ad_sync_runs to authenticated;
grant select, insert, update on marketing_ad_sync_runs to service_role;
revoke delete, truncate on marketing_ad_sync_runs from anon, authenticated, service_role;

create table marketing_ad_metric_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  source_id uuid not null,
  provider text not null,
  window_start date not null,
  window_end date not null,
  account_ref text,
  campaign_ref text,
  ad_ref text,
  form_ref text,
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  spend numeric(14, 4) check (spend is null or spend >= 0),
  impressions bigint check (impressions is null or impressions >= 0),
  clicks bigint check (clicks is null or clicks >= 0),
  provider_leads int check (provider_leads is null or provider_leads >= 0),
  provider_conversions int
    check (provider_conversions is null or provider_conversions >= 0),
  provider_value numeric(14, 4)
    check (provider_value is null or provider_value >= 0),
  observed_at timestamptz not null,
  provider_fact_ref text check (provider_fact_ref is null
                                or length(provider_fact_ref) <= 200),
  adapter_version text not null check (length(adapter_version) <= 40),
  evidence jsonb not null default '{}'::jsonb,
  supersedes_id uuid,
  sync_run_id uuid,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint mamf_window check (window_end >= window_start),
  -- spend without a currency is meaningless and therefore impossible
  constraint mamf_currency check (spend is null or currency is not null)
);
alter table marketing_ad_metric_facts
  add constraint mamf_source_fk foreign key (tenant_id, source_id)
    references marketing_ad_sources (tenant_id, id) on delete cascade,
  add constraint mamf_supersedes_fk foreign key (tenant_id, supersedes_id)
    references marketing_ad_metric_facts (tenant_id, id),
  add constraint mamf_sync_run_fk foreign key (tenant_id, sync_run_id)
    references marketing_ad_sync_runs (tenant_id, id);
create index marketing_ad_metric_facts_idx
  on marketing_ad_metric_facts (tenant_id, source_id, window_start desc);
create trigger marketing_ad_metric_facts_append_only_update
  before update on marketing_ad_metric_facts
  for each row execute function marketing_history_append_only();
create trigger marketing_ad_metric_facts_append_only_delete
  before delete on marketing_ad_metric_facts
  for each row execute function marketing_history_append_only();
alter table marketing_ad_metric_facts enable row level security;
create policy marketing_ad_metric_facts_select on marketing_ad_metric_facts
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_ad_metric_facts to authenticated;
grant select, insert on marketing_ad_metric_facts to service_role;
revoke update, delete, truncate on marketing_ad_metric_facts
  from anon, authenticated, service_role;

-- ── PART E · canonical Person-creation superset — accurate ad provenance ────
-- The ONE identity authority (marketing_create_contact) gains an OPTIONAL
-- bounded provenance detail: source in ('manual','ad_lead') + an optional
-- source_record_ref. Every existing behaviour is preserved verbatim — the
-- fingerprint only changes when the NEW keys are supplied, so every stored
-- pre-upgrade request replays byte-identically.

create or replace function marketing_create_contact(
  p_tenant uuid, p_actor uuid, p_details jsonb, p_idempotency_key uuid
) returns jsonb
language plpgsql
as $$
declare
  v_actor_tenant uuid;
  v_name text;
  v_first text;
  v_last text;
  v_email text;
  v_phone text;
  v_company uuid;
  v_owner uuid;
  v_candidates jsonb;
  v_ident jsonb;
  v_pids uuid[];
  v_n int;
  v_truncated boolean := false;
  v_person uuid;
  v_rel uuid;
  v_default_type text;
  v_default_stage text;
  v_actor_label text;
  v_fp_obj jsonb;
  v_fingerprint text;
  v_stored marketing_request_keys%rowtype;
  v_result jsonb;
  v_conflict uuid;
  v_source text;
  v_srcref text;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  -- The idempotency key and a REAL same-tenant actor are mandatory: a null
  -- key would let racing browser retries bypass the ledger entirely.
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  if p_actor is null then
    raise exception 'actor required' using errcode = '22023';
  end if;
  select tenant_id into v_actor_tenant from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  -- STRICT SHAPE: arrays and scalars are rejected, never coerced or ignored.
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'details must be an object' using errcode = '22023';
  end if;
  v_name := nullif(trim(coalesce(p_details ->> 'display_name', '')), '');
  v_first := nullif(trim(coalesce(p_details ->> 'first_name', '')), '');
  v_last := nullif(trim(coalesce(p_details ->> 'last_name', '')), '');
  v_email := marketing_normalize_endpoint('email', p_details ->> 'email');
  v_phone := marketing_normalize_endpoint('phone', p_details ->> 'phone');
  begin
    v_company := (p_details ->> 'company_id')::uuid;
    v_owner := (p_details ->> 'owner_id')::uuid;
  exception when others then
    raise exception 'invalid detail value' using errcode = '22023';
  end;
  if v_name is null or length(v_name) > 200
     or length(coalesce(v_first, '')) > 200 or length(coalesce(v_last, '')) > 200 then
    raise exception 'display_name required (names max 200 chars)' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_details ->> 'email', '')), '') is not null and v_email is null then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_details ->> 'phone', '')), '') is not null and v_phone is null then
    raise exception 'invalid phone' using errcode = '22023';
  end if;
  if v_company is not null and not exists (
    select 1 from companies where id = v_company and tenant_id = p_tenant) then
    raise exception 'company not found in tenant' using errcode = 'P0002';
  end if;
  if v_owner is not null then
    perform marketing_validate_owner(p_tenant, v_owner);
  end if;
  -- Phase 8: OPTIONAL bounded provenance. 'manual' (the default, byte-exact
  -- legacy behaviour) or 'ad_lead' (the vocabulary the relationship model
  -- already reserves). Anything else refuses — provenance can never lie.
  v_source := coalesce(nullif(trim(coalesce(p_details ->> 'source', '')), ''), 'manual');
  if v_source not in ('manual', 'ad_lead') then
    raise exception 'source must be manual|ad_lead' using errcode = '22023';
  end if;
  v_srcref := nullif(trim(coalesce(p_details ->> 'source_record_ref', '')), '');
  if v_srcref is not null and length(v_srcref) > 200 then
    raise exception 'source_record_ref is bounded to 200 chars' using errcode = '22023';
  end if;

  -- Canonical collision-resistant fingerprint over EVERY material field.
  -- jsonb text rendering is canonical (sorted keys) and stored verbatim —
  -- equality is exact, no lossy hash. The Phase-8 provenance keys join the
  -- fingerprint ONLY when supplied, so every stored pre-upgrade request
  -- replays byte-identically.
  v_fp_obj := jsonb_build_object(
    'name', v_name, 'first', v_first, 'last', v_last,
    'email', v_email, 'phone', v_phone,
    'company', v_company, 'owner', v_owner,
    'type', nullif(p_details ->> 'relationship_type', ''),
    'stage', nullif(p_details ->> 'lifecycle_stage_key', ''));
  if v_source <> 'manual' or v_srcref is not null then
    v_fp_obj := v_fp_obj
      || jsonb_build_object('source', v_source, 'source_record_ref', v_srcref);
  end if;
  v_fingerprint := v_fp_obj::text;

  -- SERIALISE THE KEY FIRST: the tenant+key advisory lock is taken BEFORE the
  -- ledger read, so two same-key requests can never both see an empty ledger
  -- and each commit a Person (the old name-only/same-key race). The ledger is
  -- read UNDER the lock and returns/conflicts before any identity or Person
  -- mutation. The unique (tenant, key) constraint below stays as defence in
  -- depth only.
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|idem|' || p_idempotency_key::text, 42));
  select * into v_stored from marketing_request_keys
   where tenant_id = p_tenant and idempotency_key = p_idempotency_key;
  if found then
    if v_stored.action <> 'create_contact'
       or v_stored.actor is distinct from p_actor
       or v_stored.fingerprint <> v_fingerprint then
      raise exception 'idempotency key was used for a different request'
        using errcode = '55000';
    end if;
    return v_stored.result;
  end if;

  -- One advisory lock PER supplied identifier, deterministic order (always
  -- after the key lock, email before phone): any strong-identifier overlap
  -- serialises; name-only creates take no identity lock.
  if v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|email|' || v_email, 42));
  end if;
  if v_phone is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|phone|' || v_phone, 42));
  end if;

  -- Per-identifier candidate evidence (locked re-check).
  with matches as (
    select distinct src.channel, src.person_id
    from (
      select 'email' as channel, pp.id as person_id from people pp
       where v_email is not null and pp.tenant_id = p_tenant
         and marketing_normalize_endpoint('email', pp.primary_email) = v_email
      union all
      select 'email', cp.person_id from contact_points cp
       where v_email is not null and cp.tenant_id = p_tenant
         and cp.channel = 'email' and cp.normalized_value = v_email
      union all
      select 'phone', pp2.id from people pp2
       where v_phone is not null and pp2.tenant_id = p_tenant
         and marketing_normalize_endpoint('phone', pp2.primary_phone) = v_phone
      union all
      select 'phone', cp2.person_id from contact_points cp2
       where v_phone is not null and cp2.tenant_id = p_tenant
         and cp2.channel = 'phone' and cp2.normalized_value = v_phone
    ) src
    join people p on p.id = src.person_id and p.tenant_id = p_tenant
  ),
  people_matched as (
    select m.person_id, p.display_name,
           array_agg(distinct m.channel order by m.channel) as matched_on
    from matches m join people p on p.id = m.person_id and p.tenant_id = p_tenant
    group by m.person_id, p.display_name
    order by m.person_id
    limit 7
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'person_id', pm.person_id, 'display_name', pm.display_name,
      'matched_on', to_jsonb(pm.matched_on))), '[]'::jsonb),
    count(*)
  into v_candidates, v_n
  from people_matched pm;

  -- Per-identifier evidence for the conflict record (never mislabelled).
  -- TENANT-SAFE ON BOTH SIDES: every contact-point candidate joins its Person
  -- back to p_tenant, so a corrupt cross-tenant reference can never leak a
  -- foreign Person id into stored evidence. Stored arrays are BOUNDED (25 ids,
  -- per-identifier truncated flag) — never an unlimited UUID list.
  v_ident := '[]'::jsonb;
  if v_email is not null then
    select array_agg(pid) into v_pids from (
      select u.pid from (
        select pp.id as pid from people pp
         where pp.tenant_id = p_tenant
           and marketing_normalize_endpoint('email', pp.primary_email) = v_email
        union
        select cpx.person_id from contact_points cpx
          join people pj on pj.id = cpx.person_id and pj.tenant_id = p_tenant
         where cpx.tenant_id = p_tenant and cpx.channel = 'email'
           and cpx.normalized_value = v_email
      ) u order by u.pid limit 26) b;
    if v_pids is not null then
      v_ident := v_ident || jsonb_build_array(jsonb_build_object(
        'channel', 'email', 'value', v_email,
        'candidate_person_ids', to_jsonb(v_pids[1:25]),
        'truncated', coalesce(array_length(v_pids, 1), 0) > 25));
    end if;
  end if;
  if v_phone is not null then
    select array_agg(pid) into v_pids from (
      select u.pid from (
        select pp2.id as pid from people pp2
         where pp2.tenant_id = p_tenant
           and marketing_normalize_endpoint('phone', pp2.primary_phone) = v_phone
        union
        select cpy.person_id from contact_points cpy
          join people pj2 on pj2.id = cpy.person_id and pj2.tenant_id = p_tenant
         where cpy.tenant_id = p_tenant and cpy.channel = 'phone'
           and cpy.normalized_value = v_phone
      ) u order by u.pid limit 26) b;
    if v_pids is not null then
      v_ident := v_ident || jsonb_build_array(jsonb_build_object(
        'channel', 'phone', 'value', v_phone,
        'candidate_person_ids', to_jsonb(v_pids[1:25]),
        'truncated', coalesce(array_length(v_pids, 1), 0) > 25));
    end if;
  end if;

  if v_n > 6 then
    v_truncated := true;
    v_n := 6;
    v_candidates := (select jsonb_agg(e) from (
      select e from jsonb_array_elements(v_candidates) with ordinality x(e, i)
       where x.i <= 6) s);
  end if;

  v_actor_label := coalesce((select email from profiles where id = p_actor),
                            p_actor::text, 'service');

  if v_n = 1 then
    v_result := jsonb_build_object(
      'created', false, 'status', 'existing', 'candidate', v_candidates -> 0);
  elsif v_n > 1 then
    insert into marketing_identity_conflicts
      (tenant_id, identifiers, candidate_person_ids, truncated, requested,
       idempotency_key, created_by)
    values
      (p_tenant, v_ident,
       (select array_agg(distinct (e ->> 'person_id')::uuid)
          from jsonb_array_elements(v_candidates) e),
       v_truncated,
       jsonb_build_object('display_name', v_name),
       p_idempotency_key, p_actor)
    returning id into v_conflict;
    insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
    values (p_tenant, v_actor_label, 'marketing.contact.create_ambiguous',
            'marketing_identity_conflict', v_conflict::text, 'ok',
            jsonb_build_object('candidates', v_n, 'truncated', v_truncated,
                               'idempotency_key', p_idempotency_key));
    perform marketing_event_append(p_tenant, 'marketing.identity_conflict.created',
      'marketing_identity_conflict', v_conflict, 'marketing-contacts',
      jsonb_build_object('k', 'created:' || v_conflict,
        'candidates', v_n, 'truncated', v_truncated,
        'actor', v_actor_label, 'at', now()));
    v_result := jsonb_build_object(
      'created', false, 'status', 'ambiguous',
      'conflict_id', v_conflict, 'candidates', v_candidates,
      'truncated', v_truncated);
  else
    select coalesce(ms.default_relationship_type, 'lead'),
           coalesce(ms.default_lifecycle_stage_key, 'new_lead')
      into v_default_type, v_default_stage
      from marketing_settings ms where ms.tenant_id = p_tenant;
    if not found then
      v_default_type := 'lead'; v_default_stage := 'new_lead';
    end if;

    insert into people (tenant_id, company_id, display_name, first_name, last_name,
                        primary_email, primary_phone, created_source, verified)
    values (p_tenant, v_company, v_name, v_first, v_last,
            v_email, nullif(trim(coalesce(p_details ->> 'phone', '')), ''), v_source, false)
    returning id into v_person;

    if v_email is not null then
      insert into contact_points (tenant_id, person_id, channel, value, normalized_value,
                                  is_primary, source, source_record_ref)
      values (p_tenant, v_person, 'email', p_details ->> 'email', v_email, true,
              v_source, v_srcref);
    end if;
    if v_phone is not null then
      insert into contact_points (tenant_id, person_id, channel, value, normalized_value,
                                  is_primary, source, source_record_ref)
      values (p_tenant, v_person, 'phone', p_details ->> 'phone', v_phone, true,
              v_source, v_srcref);
    end if;

    insert into contact_relationships (tenant_id, person_id, relationship_type,
                                       lifecycle_stage_key, owner_id, source,
                                       source_record_ref, created_by, updated_by)
    values (p_tenant, v_person,
            coalesce(nullif(p_details ->> 'relationship_type', ''), v_default_type),
            coalesce(nullif(p_details ->> 'lifecycle_stage_key', ''), v_default_stage),
            v_owner, v_source, v_srcref, p_actor, p_actor)
    returning id into v_rel;

    insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
    values (p_tenant, v_actor_label, 'marketing.contact.created', 'person', v_person::text,
            'ok', jsonb_build_object('relationship_id', v_rel,
                                     'idempotency_key', p_idempotency_key));
    perform marketing_event_append(p_tenant, 'marketing.contact.created', 'person', v_person,
      'marketing-contacts',
      jsonb_build_object('k', 'created:' || v_person, 'relationship_id', v_rel,
                         'actor', v_actor_label, 'at', now()));

    v_result := jsonb_build_object('created', true, 'person_id', v_person,
                                   'relationship_id', v_rel);
  end if;

  -- Defence in depth only: under the tenant+key advisory lock this insert can
  -- never race itself, but the unique (tenant, key) constraint stays and a
  -- violation still converges on the stored result.
  begin
    insert into marketing_request_keys
      (tenant_id, idempotency_key, actor, action, fingerprint, result)
    values (p_tenant, p_idempotency_key, p_actor, 'create_contact', v_fingerprint, v_result);
  exception when unique_violation then
    select * into v_stored from marketing_request_keys
     where tenant_id = p_tenant and idempotency_key = p_idempotency_key;
    if v_stored.action <> 'create_contact'
       or v_stored.actor is distinct from p_actor
       or v_stored.fingerprint <> v_fingerprint then
      raise exception 'idempotency key was used for a different request'
        using errcode = '55000';
    end if;
    return v_stored.result;
  end;

  return v_result;
end $$;

-- ── PART F · ADS ACTOR GATE — the owner/admin STRUCTURAL ceiling +
--    marketing.ads.manage (the committed foundation permission) ──
create or replace function marketing_require_ads_actor(p_tenant uuid, p_actor uuid)
returns text
language plpgsql
as $$
declare
  v_role text;
  v_actor_tenant uuid;
  v_verdict jsonb;
begin
  if p_tenant is null or p_actor is null then
    raise exception 'tenant and actor required' using errcode = '22023';
  end if;
  select tenant_id, role into v_actor_tenant, v_role from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  if v_role not in ('owner', 'admin') then
    raise exception 'ad source management requires an owner/admin actor'
      using errcode = '42501';
  end if;
  v_verdict := marketing_effective_permissions(p_actor);
  if (v_verdict ->> 'enabled') is distinct from 'true'
     or not ((v_verdict -> 'permissions') ? 'marketing.ads.manage') then
    raise exception 'actor lacks marketing.ads.manage' using errcode = '42501';
  end if;
  return coalesce((select email from profiles where id = p_actor), p_actor::text);
end $$;

-- helper: snapshot the CURRENT semantic configuration of a source
create or replace function marketing_ad_source_snapshot(p_row marketing_ad_sources)
returns jsonb
language sql
immutable
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'provider', p_row.provider, 'mode', p_row.mode, 'name', p_row.name,
    'description', p_row.description,
    'account_ref', p_row.account_ref, 'campaign_ref', p_row.campaign_ref,
    'ad_ref', p_row.ad_ref, 'form_ref', p_row.form_ref,
    'status', p_row.status, 'credential_state', p_row.credential_state,
    'default_tag_id', p_row.default_tag_id,
    'default_relationship_type', p_row.default_relationship_type,
    'default_lifecycle_stage_key', p_row.default_lifecycle_stage_key,
    'default_owner_id', p_row.default_owner_id,
    'notify_attention', p_row.notify_attention,
    'timezone', p_row.timezone,
    'sync_cadence_minutes', p_row.sync_cadence_minutes));
$$;

-- ── PART G · SOURCE LIFECYCLE RPCs — request-id idempotent through the
--    canonical marketing_template_request_gate + marketing_request_keys ──

create or replace function marketing_ad_source_create(p_tenant uuid, p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_provider text;
  v_mode text;
  v_name text;
  v_request_id text;
  v_fp text;
  v_stored jsonb;
  v_result jsonb;
  v_source uuid := gen_random_uuid();
  v_version uuid := gen_random_uuid();
  v_public text;
  v_row marketing_ad_sources%rowtype;
begin
  v_label := marketing_require_ads_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('provider', 'name', 'description', 'account_ref', 'campaign_ref',
                     'ad_ref', 'form_ref', 'default_tag_id', 'default_relationship_type',
                     'default_lifecycle_stage_key', 'default_owner_id', 'notify_attention',
                     'timezone', 'request_id') then
      raise exception 'unknown source create argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'ad_source_create',
    'args', p_args - 'request_id')::text, 'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'ad_source_create',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored;
  end if;
  v_provider := p_args ->> 'provider';
  if v_provider is null
     or v_provider not in ('meta', 'google_ads', 'linkedin', 'webhook', 'sheet') then
    raise exception 'provider must be meta|google_ads|linkedin|webhook|sheet'
      using errcode = '22023';
  end if;
  v_mode := case when v_provider = 'webhook' then 'webhook'
                 when v_provider = 'sheet' then 'sheet'
                 else 'api' end;
  v_name := nullif(trim(coalesce(p_args ->> 'name', '')), '');
  if v_name is null or length(v_name) > 120 or v_name ~ '[[:cntrl:]]' then
    raise exception 'name required (max 120 clean chars)' using errcode = '22023';
  end if;
  if p_args ? 'default_owner_id' and jsonb_typeof(p_args -> 'default_owner_id') <> 'null' then
    perform marketing_validate_owner(p_tenant, (p_args ->> 'default_owner_id')::uuid);
  end if;
  if p_args ? 'default_tag_id' and jsonb_typeof(p_args -> 'default_tag_id') <> 'null'
     and not exists (select 1 from marketing_tags t
                      where t.id = (p_args ->> 'default_tag_id')::uuid
                        and t.tenant_id = p_tenant and t.active) then
    raise exception 'default tag not found or inactive' using errcode = 'P0002';
  end if;
  if p_args ? 'default_lifecycle_stage_key'
     and jsonb_typeof(p_args -> 'default_lifecycle_stage_key') <> 'null'
     and not exists (select 1 from marketing_lifecycle_stages s
                      where s.tenant_id = p_tenant
                        and s.stage_key = p_args ->> 'default_lifecycle_stage_key'
                        and s.active) then
    -- a default MUST be an ACTIVE stage — mirrors marketing_settings_update, so
    -- ad leads are never pinned onto a retired stage (a silently-invalid default)
    raise exception 'default lifecycle stage not found or inactive for tenant'
      using errcode = 'P0002';
  end if;
  -- the opaque, non-enumerable public route key (webhook mode only)
  if v_mode = 'webhook' then
    v_public := encode(extensions.gen_random_bytes(24), 'hex');
  end if;

  insert into marketing_ad_sources
    (id, tenant_id, provider, mode, name, description, account_ref, campaign_ref,
     ad_ref, form_ref, status, public_key, default_tag_id,
     default_relationship_type, default_lifecycle_stage_key, default_owner_id,
     notify_attention, timezone, created_by, updated_by, version)
  values
    (v_source, p_tenant, v_provider, v_mode, v_name,
     nullif(trim(coalesce(p_args ->> 'description', '')), ''),
     nullif(p_args ->> 'account_ref', ''), nullif(p_args ->> 'campaign_ref', ''),
     nullif(p_args ->> 'ad_ref', ''), nullif(p_args ->> 'form_ref', ''),
     'active', v_public,
     nullif(p_args ->> 'default_tag_id', '')::uuid,
     nullif(p_args ->> 'default_relationship_type', ''),
     nullif(p_args ->> 'default_lifecycle_stage_key', ''),
     nullif(p_args ->> 'default_owner_id', '')::uuid,
     coalesce((p_args ->> 'notify_attention')::boolean, true),
     coalesce(nullif(p_args ->> 'timezone', ''), 'UTC'),
     p_actor, p_actor, 1);
  select * into v_row from marketing_ad_sources where id = v_source;
  insert into marketing_ad_source_versions
    (id, tenant_id, source_id, version_number, change_kind, config, changed_by)
  values (v_version, p_tenant, v_source, 1, 'create',
          marketing_ad_source_snapshot(v_row), p_actor);
  update marketing_ad_sources set current_version_id = v_version where id = v_source;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.ads.source_created', 'marketing_ad_source',
          v_source::text, 'ok', jsonb_build_object('provider', v_provider, 'mode', v_mode));
  perform marketing_event_append(p_tenant, 'marketing.ads.source_created',
    'marketing_ad_source', v_source, 'marketing-ads',
    jsonb_build_object('k', 'created:' || v_source, 'provider', v_provider,
                       'actor', v_label, 'at', now()));

  v_result := jsonb_build_object('id', v_source, 'provider', v_provider, 'mode', v_mode,
    'status', 'active', 'version', 1, 'public_key', v_public,
    'credential_state', v_row.credential_state);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('ad_source_create:' || v_request_id)::uuid, p_actor,
          'ad_source_create', v_fp, v_result);
  return v_result;
end $$;

create or replace function marketing_ad_source_revise(
  p_tenant uuid, p_actor uuid, p_source uuid, p_args jsonb, p_expected_version int
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_row marketing_ad_sources%rowtype;
  v_request_id text;
  v_fp text;
  v_stored jsonb;
  v_result jsonb;
  v_version uuid := gen_random_uuid();
begin
  v_label := marketing_require_ads_actor(p_tenant, p_actor);
  if p_source is null or p_expected_version is null then
    raise exception 'source and expected_version required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object'
     or p_args - 'request_id' = '{}'::jsonb then
    raise exception 'changes must be a non-empty object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('name', 'description', 'account_ref', 'campaign_ref', 'ad_ref',
                     'form_ref', 'default_tag_id', 'default_relationship_type',
                     'default_lifecycle_stage_key', 'default_owner_id',
                     'notify_attention', 'timezone', 'request_id') then
      if v_key in ('provider', 'mode') then
        raise exception 'provider/mode are immutable — a semantic change is a NEW source'
          using errcode = '22023';
      end if;
      raise exception 'unknown source revise argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'ad_source_revise',
    'source', p_source, 'expected_version', p_expected_version,
    'args', p_args - 'request_id')::text, 'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'ad_source_revise',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored;
  end if;
  select * into v_row from marketing_ad_sources
   where id = p_source and tenant_id = p_tenant for update;
  if not found then
    raise exception 'ad source not found for tenant' using errcode = 'P0002';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'ad source changed since it was read' using errcode = 'MK409';
  end if;
  if v_row.status = 'archived' then
    raise exception 'an archived ad source cannot be revised — restore it first'
      using errcode = '22023';
  end if;
  if p_args ? 'default_owner_id' and jsonb_typeof(p_args -> 'default_owner_id') <> 'null' then
    perform marketing_validate_owner(p_tenant, (p_args ->> 'default_owner_id')::uuid);
  end if;
  if p_args ? 'default_tag_id' and jsonb_typeof(p_args -> 'default_tag_id') <> 'null'
     and not exists (select 1 from marketing_tags t
                      where t.id = (p_args ->> 'default_tag_id')::uuid
                        and t.tenant_id = p_tenant and t.active) then
    raise exception 'default tag not found or inactive' using errcode = 'P0002';
  end if;
  if p_args ? 'default_lifecycle_stage_key'
     and jsonb_typeof(p_args -> 'default_lifecycle_stage_key') <> 'null'
     and not exists (select 1 from marketing_lifecycle_stages s
                      where s.tenant_id = p_tenant
                        and s.stage_key = p_args ->> 'default_lifecycle_stage_key'
                        and s.active) then
    -- a default MUST be an ACTIVE stage — mirrors marketing_settings_update, so
    -- ad leads are never pinned onto a retired stage (a silently-invalid default)
    raise exception 'default lifecycle stage not found or inactive for tenant'
      using errcode = 'P0002';
  end if;

  update marketing_ad_sources set
    name = case when p_args ? 'name'
                then nullif(trim(coalesce(p_args ->> 'name', '')), '') else name end,
    description = case when p_args ? 'description'
                       then nullif(trim(coalesce(p_args ->> 'description', '')), '')
                       else description end,
    account_ref = case when p_args ? 'account_ref'
                       then nullif(p_args ->> 'account_ref', '') else account_ref end,
    campaign_ref = case when p_args ? 'campaign_ref'
                        then nullif(p_args ->> 'campaign_ref', '') else campaign_ref end,
    ad_ref = case when p_args ? 'ad_ref'
                  then nullif(p_args ->> 'ad_ref', '') else ad_ref end,
    form_ref = case when p_args ? 'form_ref'
                    then nullif(p_args ->> 'form_ref', '') else form_ref end,
    default_tag_id = case when p_args ? 'default_tag_id'
                          then nullif(p_args ->> 'default_tag_id', '')::uuid
                          else default_tag_id end,
    default_relationship_type = case when p_args ? 'default_relationship_type'
                                     then nullif(p_args ->> 'default_relationship_type', '')
                                     else default_relationship_type end,
    default_lifecycle_stage_key = case when p_args ? 'default_lifecycle_stage_key'
                                       then nullif(p_args ->> 'default_lifecycle_stage_key', '')
                                       else default_lifecycle_stage_key end,
    default_owner_id = case when p_args ? 'default_owner_id'
                            then nullif(p_args ->> 'default_owner_id', '')::uuid
                            else default_owner_id end,
    notify_attention = coalesce((p_args ->> 'notify_attention')::boolean, notify_attention),
    timezone = coalesce(nullif(p_args ->> 'timezone', ''), timezone),
    updated_by = p_actor,
    version = version + 1
  where id = p_source
  returning * into v_row;
  insert into marketing_ad_source_versions
    (id, tenant_id, source_id, version_number, change_kind, config, changed_by)
  values (v_version, p_tenant, p_source, v_row.version, 'revise',
          marketing_ad_source_snapshot(v_row), p_actor);
  update marketing_ad_sources set current_version_id = v_version where id = p_source;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.ads.source_revised', 'marketing_ad_source',
          p_source::text, 'ok', jsonb_build_object('version', v_row.version));
  perform marketing_event_append(p_tenant, 'marketing.ads.source_revised',
    'marketing_ad_source', p_source, 'marketing-ads',
    jsonb_build_object('k', 'revised:' || v_version, 'version', v_row.version,
                       'actor', v_label, 'at', now()));

  v_result := jsonb_build_object('id', p_source, 'version', v_row.version);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('ad_source_revise:' || v_request_id)::uuid, p_actor,
          'ad_source_revise', v_fp, v_result);
  return v_result;
end $$;

create or replace function marketing_ad_source_set_status(
  p_tenant uuid, p_actor uuid, p_source uuid, p_args jsonb, p_expected_version int
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_row marketing_ad_sources%rowtype;
  v_status text;
  v_kind text;
  v_request_id text;
  v_fp text;
  v_stored jsonb;
  v_result jsonb;
  v_version uuid := gen_random_uuid();
begin
  v_label := marketing_require_ads_actor(p_tenant, p_actor);
  if p_source is null or p_expected_version is null then
    raise exception 'source and expected_version required' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_args, '{}'::jsonb)) loop
    if v_key not in ('status', 'request_id') then
      raise exception 'unknown set_status argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_status := p_args ->> 'status';
  if v_status is null or v_status not in ('active', 'disabled', 'archived') then
    raise exception 'status must be active|disabled|archived' using errcode = '22023';
  end if;
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'ad_source_status',
    'source', p_source, 'expected_version', p_expected_version,
    'args', p_args - 'request_id')::text, 'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'ad_source_status',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored;
  end if;
  select * into v_row from marketing_ad_sources
   where id = p_source and tenant_id = p_tenant for update;
  if not found then
    raise exception 'ad source not found for tenant' using errcode = 'P0002';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'ad source changed since it was read' using errcode = 'MK409';
  end if;
  if v_row.status = v_status then
    raise exception 'ad source is already %', v_status using errcode = '22023';
  end if;
  v_kind := case
    when v_status = 'archived' then 'archive'
    when v_status = 'disabled' then 'disable'
    when v_row.status = 'archived' then 'restore'
    else 'enable' end;

  update marketing_ad_sources set
    status = v_status,
    archived_at = case when v_status = 'archived' then now() else null end,
    archived_by = case when v_status = 'archived' then p_actor else null end,
    updated_by = p_actor,
    version = version + 1
  where id = p_source
  returning * into v_row;
  insert into marketing_ad_source_versions
    (id, tenant_id, source_id, version_number, change_kind, config, changed_by)
  values (v_version, p_tenant, p_source, v_row.version, v_kind,
          marketing_ad_source_snapshot(v_row), p_actor);
  update marketing_ad_sources set current_version_id = v_version where id = p_source;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.ads.source_' || v_kind, 'marketing_ad_source',
          p_source::text, 'ok', '{}'::jsonb);
  perform marketing_event_append(p_tenant, 'marketing.ads.source_status',
    'marketing_ad_source', p_source, 'marketing-ads',
    jsonb_build_object('k', v_kind || ':' || p_source || ':v' || v_row.version,
                       'status', v_status, 'actor', v_label, 'at', now()));

  v_result := jsonb_build_object('id', p_source, 'status', v_status,
                                 'version', v_row.version);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('ad_source_status:' || v_request_id)::uuid, p_actor,
          'ad_source_status', v_fp, v_result);
  return v_result;
end $$;

-- credential rotation EVIDENCE (the secret itself is stored by the Edge
-- function straight into the tenant Vault broker and returned exactly once;
-- this RPC only records the factual rotation and flips the presence flag)
create or replace function marketing_ad_source_credential_mark(
  p_tenant uuid, p_actor uuid, p_source uuid, p_args jsonb, p_expected_version int
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_row marketing_ad_sources%rowtype;
  v_request_id text;
  v_fp text;
  v_stored jsonb;
  v_result jsonb;
  v_rotated boolean;
  v_version uuid := gen_random_uuid();
begin
  v_label := marketing_require_ads_actor(p_tenant, p_actor);
  if p_source is null or p_expected_version is null then
    raise exception 'source and expected_version required' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_args, '{}'::jsonb)) loop
    if v_key not in ('request_id') then
      raise exception 'unknown credential argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'ad_source_credential',
    'source', p_source, 'expected_version', p_expected_version)::text,
    'sha256'), 'hex');
  -- REPLAY convergence: on a repeated request_id the gate returns the stored
  -- result and we flag it `replayed` so the Edge function performs NO Vault
  -- rotation and NEVER re-reveals a secret. This is the idempotency lock that
  -- makes "rotate the secret" safe to retry — a repeated setup/rotation request
  -- id can never rotate twice.
  v_stored := marketing_template_request_gate(p_tenant, 'ad_source_credential',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored || jsonb_build_object('replayed', true);
  end if;
  select * into v_row from marketing_ad_sources
   where id = p_source and tenant_id = p_tenant for update;
  if not found then
    raise exception 'ad source not found for tenant' using errcode = 'P0002';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'ad source changed since it was read' using errcode = 'MK409';
  end if;
  if v_row.mode <> 'webhook' then
    raise exception 'only a signed-webhook source carries a webhook signing credential'
      using errcode = '22023';
  end if;
  if v_row.status = 'archived' then
    raise exception 'an archived ad source cannot rotate credentials — restore it first'
      using errcode = '22023';
  end if;
  -- a rotation (there WAS a configured secret) starts the bounded overlap clock;
  -- a first configuration has no previous secret, so no overlap is granted
  v_rotated := (v_row.credential_state = 'configured');

  update marketing_ad_sources set
    credential_state = 'configured',
    credential_rotated_at = case when v_rotated then now() else null end,
    updated_by = p_actor, version = version + 1
  where id = p_source
  returning * into v_row;
  insert into marketing_ad_source_versions
    (id, tenant_id, source_id, version_number, change_kind, config, changed_by)
  values (v_version, p_tenant, p_source, v_row.version, 'rotate_credential',
          marketing_ad_source_snapshot(v_row), p_actor);
  update marketing_ad_sources set current_version_id = v_version where id = p_source;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.ads.credential_rotated', 'marketing_ad_source',
          p_source::text, 'ok',
          jsonb_build_object('note', 'secret stored in the tenant Vault broker — never here'));
  perform marketing_event_append(p_tenant, 'marketing.ads.credential_rotated',
    'marketing_ad_source', p_source, 'marketing-ads',
    jsonb_build_object('k', 'rotated:' || v_version, 'actor', v_label, 'at', now()));

  -- the stored result carries `rotated` (so the Edge knows whether to preserve
  -- the outgoing secret as `signing_key_previous`) and `replayed:false`. The
  -- one-time secret is NEVER part of this stored result — it is minted and
  -- returned by the Edge function exactly once, outside the ledger.
  v_result := jsonb_build_object('id', p_source, 'credential_state', 'configured',
                                 'version', v_row.version, 'rotated', v_rotated,
                                 'replayed', false);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('ad_source_credential:' || v_request_id)::uuid, p_actor,
          'ad_source_credential', v_fp, v_result);
  return v_result;
end $$;

-- manual sync: TRUTHFUL capability gating. No v1 adapter supports polling, so
-- every request refuses with the stable UNSUPPORTED classification — never a
-- fabricated queued/succeeded answer.
create or replace function marketing_ad_manual_sync(
  p_tenant uuid, p_actor uuid, p_source uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_row marketing_ad_sources%rowtype;
begin
  perform marketing_require_ads_actor(p_tenant, p_actor);
  select * into v_row from marketing_ad_sources
   where id = p_source and tenant_id = p_tenant;
  if not found then
    raise exception 'ad source not found for tenant' using errcode = 'P0002';
  end if;
  raise exception 'provider % does not support sync: no adapter implements polling in this build — the signed webhook delivers events push-only',
    v_row.provider using errcode = 'MK430';
end $$;

-- ── PART H · EVENT INGEST (post-signature), CLAIM, PROCESS, RETRY ───────────

-- Called by the webhook Edge function ONLY AFTER the HMAC signature verified
-- over the exact raw bytes. Deduplicates by (source, provider_event_id):
-- identical replays converge and count; a different body under the same id is
-- a data-integrity CONFLICT recorded as digests only.
create or replace function marketing_ad_event_ingest(
  p_tenant uuid, p_source uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_row marketing_ad_sources%rowtype;
  v_eid text;
  v_digest text;
  v_existing marketing_ad_events%rowtype;
  v_event uuid := gen_random_uuid();
  v_occurred timestamptz;
begin
  if p_tenant is null or p_source is null
     or p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'tenant, source and args required' using errcode = '22023';
  end if;
  select * into v_row from marketing_ad_sources
   where id = p_source and tenant_id = p_tenant;
  if not found then
    raise exception 'ad source not found for tenant' using errcode = 'P0002';
  end if;
  -- commit-time re-check (webhook-hardening precedent): resolution alone is
  -- not sufficient authority for a service-role write
  if v_row.status <> 'active' or v_row.mode <> 'webhook'
     or v_row.credential_state <> 'configured' then
    raise exception 'ad source is not accepting events' using errcode = '22023';
  end if;
  v_eid := p_args ->> 'provider_event_id';
  v_digest := p_args ->> 'body_digest';
  if v_eid is null or length(v_eid) > 120 or v_eid ~ '[[:cntrl:]]'
     or v_digest is null or v_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'provider_event_id and body_digest required' using errcode = '22023';
  end if;
  begin
    v_occurred := (p_args ->> 'occurred_at')::timestamptz;
  exception when others then
    raise exception 'occurred_at must be a timestamp' using errcode = '22023';
  end;
  -- BOUND the client-supplied occurrence time: a signed lead-capture webhook is
  -- real-time, so occurred_at must sit in a sane window around receipt. Without
  -- this, an untrusted ancient (e.g. year 1900) or far-future (e.g. year 3000)
  -- value would silently steal a Person's first/last attribution touch and skew
  -- the metric time-window filters. Outside the window is refused, not clamped.
  if v_occurred > now() + interval '1 day'
     or v_occurred < now() - interval '30 days' then
    raise exception 'occurred_at is outside the acceptable window (received_at -30d .. +1d)'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_args -> 'envelope') <> 'object'
     or length((p_args -> 'envelope')::text) > 16384 then
    raise exception 'envelope must be a bounded object' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|adevent|' || p_source::text || '|' || v_eid, 42));
  select * into v_existing from marketing_ad_events
   where tenant_id = p_tenant and source_id = p_source and provider_event_id = v_eid;
  if found then
    if v_existing.body_digest = v_digest then
      update marketing_ad_events set replay_count = replay_count + 1
       where id = v_existing.id;
      perform marketing_event_append(p_tenant, 'marketing.ads.event_replayed',
        'marketing_ad_event', v_existing.id, 'marketing-ad-webhook',
        jsonb_build_object('k', 'replay:' || v_existing.id || ':' ||
                                (v_existing.replay_count + 1), 'at', now()));
      return jsonb_build_object('event_id', v_existing.id, 'outcome', 'replayed');
    end if;
    insert into marketing_ad_event_conflicts
      (tenant_id, source_id, provider_event_id, stored_digest, offered_digest)
    values (p_tenant, p_source, v_eid, v_existing.body_digest, v_digest);
    perform marketing_event_append(p_tenant, 'marketing.ads.event_conflicted',
      'marketing_ad_event', v_existing.id, 'marketing-ad-webhook',
      jsonb_build_object('k', 'conflict:' || v_existing.id || ':' || v_digest,
                         'at', now()));
    return jsonb_build_object('event_id', v_existing.id, 'outcome', 'conflicted');
  end if;

  insert into marketing_ad_events
    (id, tenant_id, source_id, source_version_id, provider, mode,
     provider_event_id, body_digest, schema_version, occurred_at, envelope,
     correlation_id)
  values
    (v_event, p_tenant, p_source, v_row.current_version_id, v_row.provider,
     v_row.mode, v_eid, v_digest,
     coalesce(nullif(p_args ->> 'schema_version', ''), 'ads-lead@1'),
     v_occurred, p_args -> 'envelope', gen_random_uuid());
  update marketing_ad_sources set last_event_at = now() where id = p_source;
  perform marketing_event_append(p_tenant, 'marketing.ads.event_received',
    'marketing_ad_event', v_event, 'marketing-ad-webhook',
    jsonb_build_object('k', 'received:' || v_event, 'source', p_source, 'at', now()));
  return jsonb_build_object('event_id', v_event, 'outcome', 'accepted');
end $$;

-- lease-safe bounded claim (FOR UPDATE SKIP LOCKED; expired leases reclaimable)
create or replace function marketing_ad_claim_events(
  p_tenant uuid, p_worker text, p_batch int default 5, p_lease_seconds int default 300
) returns setof marketing_ad_events
language plpgsql
as $$
begin
  -- POISON GUARD: a genuinely poison event (one that crashes the worker before
  -- it can classify itself, leaving 'processing' + an expired lease) would be
  -- re-leased forever. Bound it: once it has burned the attempt budget it is
  -- retired to 'failed' (a governed human retry may still reopen it, but the
  -- automatic reclaim loop can never spin on it). Mirrors the attempts>=10
  -- ceiling enforced in marketing_ad_event_retry.
  update marketing_ad_events e
     set processing_state = 'failed',
         error_class = 'max_attempts_exhausted',
         lease_worker = null,
         lease_expires_at = null
   where e.tenant_id = p_tenant
     and e.processing_state = 'processing'
     and e.lease_expires_at < now()
     and e.attempts >= 10;
  return query
  update marketing_ad_events e
     set processing_state = 'processing',
         attempts = e.attempts + 1,
         lease_worker = left(coalesce(p_worker, 'worker'), 80),
         lease_expires_at = now() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 300)))
   where e.id in (
     select e2.id from marketing_ad_events e2
      where e2.tenant_id = p_tenant
        and (e2.processing_state = 'pending'
             or (e2.processing_state = 'processing' and e2.lease_expires_at < now()))
        and e2.attempts < 10
      order by e2.received_at
      limit least(greatest(coalesce(p_batch, 5), 1), 20)
      for update skip locked)
   returning e.*;
end $$;

-- THE canonical lead-processing transaction — one claimed event in, one
-- factual result out. Reuses ONLY governed authorities: the Interactions
-- projection contract, marketing_create_contact (identity),
-- marketing_classify_contact (relationship), marketing_tag_mutate (tag).
create or replace function marketing_ad_lead_process(p_tenant uuid, p_event uuid)
returns jsonb
language plpgsql
as $$
declare
  v_e marketing_ad_events%rowtype;
  v_src marketing_ad_sources%rowtype;
  v_ver marketing_ad_source_versions%rowtype;
  v_cfg jsonb;
  v_actor uuid;
  v_lead jsonb;
  v_name text;
  v_email text;
  v_phone text;
  v_interaction uuid;
  v_person uuid;
  v_rel uuid;
  v_conflict uuid;
  v_state text;
  v_conf text;
  v_evidence jsonb := '{}'::jsonb;
  v_r jsonb;
  v_err text;
begin
  select * into v_e from marketing_ad_events
   where id = p_event and tenant_id = p_tenant for update;
  if not found then
    raise exception 'ad event not found for tenant' using errcode = 'P0002';
  end if;
  if v_e.processing_state <> 'processing' then
    raise exception 'event must be claimed before processing (state %)',
      v_e.processing_state using errcode = '22023';
  end if;
  -- already fully processed under a lost lease? converge on the stored facts
  if v_e.person_id is not null and v_e.interaction_id is not null then
    update marketing_ad_events set processing_state = 'resolved',
      processed_at = coalesce(processed_at, now()) where id = p_event;
    return jsonb_build_object('event_id', p_event, 'state', 'resolved',
                              'converged', true);
  end if;
  select * into v_src from marketing_ad_sources
   where id = v_e.source_id and tenant_id = p_tenant;
  if v_src.status <> 'active' then
    update marketing_ad_events set processing_state = 'failed',
      error_class = 'source_' || v_src.status where id = p_event;
    return jsonb_build_object('event_id', p_event, 'state', 'failed',
                              'error_class', 'source_' || v_src.status);
  end if;
  -- the PINNED configuration version — defaults come from here, never from
  -- the mutable head
  select * into v_ver from marketing_ad_source_versions
   where id = v_e.source_version_id and tenant_id = p_tenant;
  v_cfg := coalesce(v_ver.config, '{}'::jsonb);
  -- the authorising human: the admin who committed the pinned configuration
  v_actor := coalesce(v_ver.changed_by, v_src.created_by);
  if v_actor is null then
    update marketing_ad_events set processing_state = 'failed',
      error_class = 'actor_unavailable' where id = p_event;
    return jsonb_build_object('event_id', p_event, 'state', 'failed',
                              'error_class', 'actor_unavailable');
  end if;

  v_lead := coalesce(v_e.envelope -> 'lead', '{}'::jsonb);
  v_email := nullif(trim(coalesce(v_lead ->> 'email', '')), '');
  v_phone := nullif(trim(coalesce(v_lead ->> 'phone', '')), '');
  v_name := coalesce(
    nullif(trim(coalesce(v_lead ->> 'full_name', '')), ''),
    nullif(trim(coalesce(v_lead ->> 'first_name', '') || ' '
                || coalesce(v_lead ->> 'last_name', '')), ''),
    v_email, v_phone, 'Ad lead');
  v_name := left(v_name, 200);

  -- 1 · ONE canonical inbound Interaction, idempotent on the ledger row
  insert into interactions
    (tenant_id, source_connector_id, source_type, source_table, source_id,
     source_external_id, interaction_type, direction, occurred_at, subject,
     summary, from_address, from_name, phone_from, processing_status, metadata)
  values
    (p_tenant, 'marketing-ads', 'form', 'marketing_ad_events', p_event,
     v_e.provider_event_id, 'form_submission', 'inbound', v_e.occurred_at,
     left('Ad lead — ' || v_name, 200),
     left('Inbound ad lead via ' || v_src.provider || ' source "' || v_src.name || '"', 300),
     v_email, v_name, v_phone, 'enriched',
     jsonb_strip_nulls(jsonb_build_object(
       'ad_source_id', v_src.id, 'provider', v_src.provider,
       'campaign_ref', v_e.envelope ->> 'campaign_ref',
       'ad_ref', v_e.envelope ->> 'ad_ref',
       'form_ref', v_e.envelope ->> 'form_ref',
       'utm', v_e.envelope -> 'meta')))
  on conflict (tenant_id, source_table, source_id) do nothing;
  select id into v_interaction from interactions
   where tenant_id = p_tenant and source_table = 'marketing_ad_events'
     and source_id = p_event;

  -- 2 · canonical identity resolution through the ONE governed authority.
  -- The idempotency key derives from the EVENT, so any replay/retry converges
  -- in the canonical ledger and can never mint a duplicate Person.
  begin
    v_r := marketing_create_contact(p_tenant, v_actor,
      jsonb_strip_nulls(jsonb_build_object(
        'display_name', v_name,
        'first_name', nullif(trim(coalesce(v_lead ->> 'first_name', '')), ''),
        'last_name', nullif(trim(coalesce(v_lead ->> 'last_name', '')), ''),
        'email', v_email,
        'phone', v_phone,
        'relationship_type', v_cfg ->> 'default_relationship_type',
        'lifecycle_stage_key', v_cfg ->> 'default_lifecycle_stage_key',
        'owner_id', v_cfg ->> 'default_owner_id',
        'source', 'ad_lead',
        'source_record_ref', 'ad_event:' || p_event)),
      md5('ad-lead:' || p_event)::uuid);
  exception when others then
    v_err := left(sqlstate || ':' || sqlerrm, 60);
    update marketing_ad_events set processing_state = 'failed', error_class = v_err
     where id = p_event;
    perform marketing_event_append(p_tenant, 'marketing.ads.lead_failed',
      'marketing_ad_event', p_event, 'marketing-ads',
      jsonb_build_object('k', 'failed:' || p_event || ':' || v_e.attempts,
                         'class', v_err, 'at', now()));
    return jsonb_build_object('event_id', p_event, 'state', 'failed',
                              'error_class', v_err);
  end;

  if (v_r ->> 'created')::boolean then
    v_person := (v_r ->> 'person_id')::uuid;
    v_rel := (v_r ->> 'relationship_id')::uuid;
    v_state := 'resolved'; v_conf := 'exact';
    v_evidence := jsonb_build_object('resolution', 'created');
  elsif v_r ->> 'status' = 'existing' then
    v_person := (v_r -> 'candidate' ->> 'person_id')::uuid;
    v_state := 'resolved'; v_conf := 'exact';
    v_evidence := jsonb_build_object('resolution', 'existing',
      'matched_on', v_r -> 'candidate' -> 'matched_on');
    -- ensure ONE active relationship exists; NEVER overwrite an existing
    -- newer/manual classification — untouched when one is already active
    if not exists (select 1 from contact_relationships cr
                    where cr.tenant_id = p_tenant and cr.person_id = v_person
                      and cr.status = 'active') then
      begin
        v_r := marketing_classify_contact(p_tenant, v_person, v_actor,
          jsonb_strip_nulls(jsonb_build_object(
            'relationship_type',
              coalesce(v_cfg ->> 'default_relationship_type', 'lead'),
            'lifecycle_stage_key',
              coalesce(v_cfg ->> 'default_lifecycle_stage_key', 'new_lead'),
            'owner_id', v_cfg ->> 'default_owner_id')));
        v_rel := (v_r ->> 'relationship_id')::uuid;
      exception when others then
        v_evidence := v_evidence
          || jsonb_build_object('relationship_note',
               left('classification held: ' || sqlerrm, 200));
      end;
    else
      v_evidence := v_evidence
        || jsonb_build_object('relationship_note', 'existing active classification preserved');
    end if;
  else
    v_conflict := (v_r ->> 'conflict_id')::uuid;
    v_state := 'review'; v_conf := 'review';
    v_evidence := jsonb_build_object('resolution', 'ambiguous',
      'conflict_id', v_conflict, 'candidates', v_r -> 'candidates');
  end if;

  -- 3 · default tag through the canonical tag authority (idempotent assign)
  if v_person is not null and (v_cfg ->> 'default_tag_id') is not null then
    begin
      perform marketing_tag_mutate(p_tenant, v_actor, 'assign',
        jsonb_build_object('tag_id', v_cfg ->> 'default_tag_id',
                           'person_id', v_person));
    exception when others then
      -- an inactive/retired default is NEVER silently substituted — the exact
      -- reason surfaces in evidence and health
      v_evidence := v_evidence || jsonb_build_object('tag_note',
        left('default tag held: ' || sqlerrm, 200));
    end;
  end if;

  -- 4 · attach the Person to the canonical Interaction (write-once)
  if v_person is not null then
    update interactions set related_person_id = v_person
     where tenant_id = p_tenant and id = v_interaction
       and related_person_id is null;
  end if;

  -- 5 · ONE append-only attribution touchpoint per factual event
  insert into marketing_ad_touchpoints
    (tenant_id, source_id, source_version_id, provider, campaign_ref, ad_ref,
     form_ref, event_id, interaction_id, person_id, kind, confidence, evidence,
     occurred_at, correlation_id)
  values
    (p_tenant, v_e.source_id, v_e.source_version_id, v_e.provider,
     v_e.envelope ->> 'campaign_ref', v_e.envelope ->> 'ad_ref',
     v_e.envelope ->> 'form_ref', p_event, v_interaction, v_person,
     'lead_capture', coalesce(v_conf, 'unresolved'), v_evidence,
     v_e.occurred_at, v_e.correlation_id)
  on conflict (tenant_id, event_id) do nothing;

  -- 6 · factual processing result (write-once refs, forward-only state)
  update marketing_ad_events set
    processing_state = v_state,
    interaction_id = coalesce(interaction_id, v_interaction),
    person_id = coalesce(person_id, v_person),
    relationship_id = coalesce(relationship_id, v_rel),
    identity_conflict_id = coalesce(identity_conflict_id, v_conflict),
    processed_at = now(),
    error_class = null
  where id = p_event;
  update marketing_ad_sources set last_processed_at = now() where id = v_e.source_id;

  perform marketing_event_append(p_tenant,
    case when v_state = 'resolved' then 'marketing.ads.lead_resolved'
         else 'marketing.ads.lead_review' end,
    'marketing_ad_event', p_event, 'marketing-ads',
    jsonb_build_object('k', v_state || ':' || p_event,
                       'person', v_person, 'conflict', v_conflict, 'at', now()));

  return jsonb_build_object('event_id', p_event, 'state', v_state,
    'person_id', v_person, 'relationship_id', v_rel,
    'interaction_id', v_interaction, 'conflict_id', v_conflict);
end $$;

-- governed retry: failed/review → pending again (bounded), owner/admin +
-- marketing.ads.manage, request-id idempotent
create or replace function marketing_ad_event_retry(
  p_tenant uuid, p_actor uuid, p_event uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_e marketing_ad_events%rowtype;
  v_request_id text;
  v_fp text;
  v_stored jsonb;
  v_result jsonb;
begin
  v_label := marketing_require_ads_actor(p_tenant, p_actor);
  if p_event is null then
    raise exception 'event required' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_args, '{}'::jsonb)) loop
    if v_key not in ('request_id') then
      raise exception 'unknown retry argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'ad_event_retry',
    'event', p_event)::text, 'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'ad_event_retry',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored;
  end if;
  select * into v_e from marketing_ad_events
   where id = p_event and tenant_id = p_tenant for update;
  if not found then
    raise exception 'ad event not found for tenant' using errcode = 'P0002';
  end if;
  if v_e.processing_state not in ('failed', 'review') then
    raise exception 'only a failed/review event can be retried (state %)',
      v_e.processing_state using errcode = '22023';
  end if;
  if v_e.attempts >= 10 then
    raise exception 'retry budget exhausted for this event' using errcode = '22023';
  end if;
  update marketing_ad_events set processing_state = 'pending' where id = p_event;
  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.ads.event_retry', 'marketing_ad_event',
          p_event::text, 'ok', jsonb_build_object('attempts', v_e.attempts));
  v_result := jsonb_build_object('event_id', p_event, 'state', 'pending');
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('ad_event_retry:' || v_request_id)::uuid, p_actor,
          'ad_event_retry', v_fp, v_result);
  return v_result;
end $$;

-- append-only provider metric recorder — service-role only (a future genuine
-- adapter or a test fixture; NEVER a browser). Corrections supersede.
create or replace function marketing_ad_metric_record(
  p_tenant uuid, p_source uuid, p_payload jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_key text;
  v_row marketing_ad_sources%rowtype;
  v_id uuid := gen_random_uuid();
  v_sup uuid;
begin
  if p_tenant is null or p_source is null
     or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'tenant, source and payload required' using errcode = '22023';
  end if;
  select * into v_row from marketing_ad_sources
   where id = p_source and tenant_id = p_tenant;
  if not found then
    raise exception 'ad source not found for tenant' using errcode = 'P0002';
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key not in ('window_start', 'window_end', 'account_ref', 'campaign_ref',
                     'ad_ref', 'form_ref', 'currency', 'spend', 'impressions',
                     'clicks', 'provider_leads', 'provider_conversions',
                     'provider_value', 'observed_at', 'provider_fact_ref',
                     'adapter_version', 'evidence', 'supersedes_id', 'sync_run_id') then
      raise exception 'unknown metric payload key %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_payload ? 'supersedes_id' and jsonb_typeof(p_payload -> 'supersedes_id') <> 'null' then
    v_sup := (p_payload ->> 'supersedes_id')::uuid;
    if not exists (select 1 from marketing_ad_metric_facts f
                    where f.id = v_sup and f.tenant_id = p_tenant
                      and f.source_id = p_source) then
      raise exception 'superseded fact not found for this source' using errcode = 'P0002';
    end if;
  end if;
  insert into marketing_ad_metric_facts
    (id, tenant_id, source_id, provider, window_start, window_end, account_ref,
     campaign_ref, ad_ref, form_ref, currency, spend, impressions, clicks,
     provider_leads, provider_conversions, provider_value, observed_at,
     provider_fact_ref, adapter_version, evidence, supersedes_id, sync_run_id,
     correlation_id)
  values
    (v_id, p_tenant, p_source, v_row.provider,
     (p_payload ->> 'window_start')::date, (p_payload ->> 'window_end')::date,
     nullif(p_payload ->> 'account_ref', ''), nullif(p_payload ->> 'campaign_ref', ''),
     nullif(p_payload ->> 'ad_ref', ''), nullif(p_payload ->> 'form_ref', ''),
     nullif(p_payload ->> 'currency', ''),
     (p_payload ->> 'spend')::numeric, (p_payload ->> 'impressions')::bigint,
     (p_payload ->> 'clicks')::bigint, (p_payload ->> 'provider_leads')::int,
     (p_payload ->> 'provider_conversions')::int,
     (p_payload ->> 'provider_value')::numeric,
     coalesce((p_payload ->> 'observed_at')::timestamptz, now()),
     nullif(p_payload ->> 'provider_fact_ref', ''),
     coalesce(nullif(p_payload ->> 'adapter_version', ''), 'test'),
     coalesce(p_payload -> 'evidence', '{}'::jsonb), v_sup,
     nullif(p_payload ->> 'sync_run_id', '')::uuid, gen_random_uuid());
  perform marketing_event_append(p_tenant,
    case when v_sup is null then 'marketing.ads.metric_recorded'
         else 'marketing.ads.metric_corrected' end,
    'marketing_ad_source', p_source, 'marketing-ads',
    jsonb_build_object('k', 'metric:' || v_id, 'supersedes', v_sup, 'at', now()));
  return jsonb_build_object('id', v_id, 'supersedes_id', v_sup);
end $$;

-- ── PART I · READ / REPORT / HEALTH PROJECTIONS (live-derived, never
--    fabricated; unknown is null with a reason, never zero) ──────────────────

create or replace function marketing_ad_source_list(p_tenant uuid, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_key text;
  v_status text;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_args, '{}'::jsonb)) loop
    if v_key not in ('status') then
      raise exception 'unknown list argument %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_args ? 'status' and jsonb_typeof(p_args -> 'status') <> 'null' then
    v_status := p_args ->> 'status';
    if v_status not in ('active', 'disabled', 'archived') then
      raise exception 'status filter must be active|disabled|archived' using errcode = '22023';
    end if;
  end if;
  return jsonb_build_object('sources',
    (select coalesce(jsonb_agg(jsonb_build_object(
       'id', s.id, 'provider', s.provider, 'mode', s.mode, 'name', s.name,
       'status', s.status, 'version', s.version,
       'credential_state', s.credential_state,
       'connection_state', case
          when s.mode = 'webhook' and s.credential_state = 'configured' then 'ready'
          when s.mode = 'webhook' then 'configuration_required'
          else 'not_connected' end,
       'public_key', s.public_key,
       'account_ref', s.account_ref, 'campaign_ref', s.campaign_ref,
       'form_ref', s.form_ref,
       'default_relationship_type', s.default_relationship_type,
       'default_lifecycle_stage_key', s.default_lifecycle_stage_key,
       'last_event_at', s.last_event_at, 'last_processed_at', s.last_processed_at,
       'created_at', s.created_at,
       'events_7d', (select count(*) from marketing_ad_events e
                      where e.tenant_id = p_tenant and e.source_id = s.id
                        and e.received_at > now() - interval '7 days'),
       'pending', (select count(*) from marketing_ad_events e
                    where e.tenant_id = p_tenant and e.source_id = s.id
                      and e.processing_state in ('pending', 'processing')),
       'failed', (select count(*) from marketing_ad_events e
                   where e.tenant_id = p_tenant and e.source_id = s.id
                     and e.processing_state = 'failed'),
       'review', (select count(*) from marketing_ad_events e
                   where e.tenant_id = p_tenant and e.source_id = s.id
                     and e.processing_state = 'review'))
       order by s.created_at desc), '[]'::jsonb)
      from marketing_ad_sources s
     where s.tenant_id = p_tenant
       and (v_status is null or s.status = v_status)));
end $$;

create or replace function marketing_ad_source_detail(p_tenant uuid, p_source uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_row marketing_ad_sources%rowtype;
begin
  if p_tenant is null or p_source is null then
    raise exception 'tenant and source required' using errcode = '22023';
  end if;
  select * into v_row from marketing_ad_sources
   where id = p_source and tenant_id = p_tenant;
  if not found then
    raise exception 'ad source not found for tenant' using errcode = 'P0002';
  end if;
  return marketing_ad_source_snapshot(v_row) || jsonb_build_object(
    'id', v_row.id, 'version', v_row.version, 'public_key', v_row.public_key,
    'created_at', v_row.created_at, 'updated_at', v_row.updated_at,
    'archived_at', v_row.archived_at,
    'last_event_at', v_row.last_event_at,
    'last_processed_at', v_row.last_processed_at,
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
        'version_number', v.version_number, 'change_kind', v.change_kind,
        'config', v.config, 'created_at', v.created_at,
        'changed_by_email', (select p.email from profiles p
                              where p.id = v.changed_by and p.tenant_id = p_tenant))
        order by v.version_number desc), '[]'::jsonb)
       from (select * from marketing_ad_source_versions v0
              where v0.tenant_id = p_tenant and v0.source_id = p_source
              order by v0.version_number desc limit 50) v));
end $$;

create or replace function marketing_ad_lead_feed(p_tenant uuid, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_key text;
  v_limit int := 25;
  v_window text := 'all';
  v_from timestamptz;
  v_source uuid;
  v_state text;
  v_cur jsonb;
  v_cur_at timestamptz;
  v_cur_id uuid;
  v_rows jsonb;
  v_next jsonb;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_args, '{}'::jsonb)) loop
    if v_key not in ('window', 'source_id', 'state', 'limit', 'cursor') then
      raise exception 'unknown lead feed argument %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_args ? 'window' and jsonb_typeof(p_args -> 'window') <> 'null' then
    v_window := p_args ->> 'window';
    if v_window not in ('today', '7d', '30d', 'all') then
      raise exception 'window must be today|7d|30d|all' using errcode = '22023';
    end if;
  end if;
  v_from := case v_window
    when 'today' then date_trunc('day', now())
    when '7d' then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    else null end;
  if p_args ? 'source_id' and jsonb_typeof(p_args -> 'source_id') <> 'null' then
    begin
      v_source := (p_args ->> 'source_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'source_id must be a uuid' using errcode = '22023';
    end;
  end if;
  if p_args ? 'state' and jsonb_typeof(p_args -> 'state') <> 'null' then
    v_state := p_args ->> 'state';
    if v_state not in ('pending', 'processing', 'resolved', 'review', 'failed') then
      raise exception 'invalid state filter' using errcode = '22023';
    end if;
  end if;
  if p_args ? 'limit' then
    if jsonb_typeof(p_args -> 'limit') <> 'number' or (p_args ->> 'limit') ~ '[.eE]' then
      raise exception 'limit must be an integer' using errcode = '22023';
    end if;
    v_limit := least(greatest((p_args ->> 'limit')::int, 1), 50);
  end if;
  if p_args ? 'cursor' and jsonb_typeof(p_args -> 'cursor') <> 'null' then
    v_cur := p_args -> 'cursor';
    if jsonb_typeof(v_cur) <> 'object'
       or jsonb_typeof(v_cur -> 'at') <> 'string'
       or jsonb_typeof(v_cur -> 'id') <> 'string'
       or (select count(*) from jsonb_object_keys(v_cur)) <> 2 then
      raise exception 'invalid cursor' using errcode = '22023';
    end if;
    begin
      v_cur_at := (v_cur ->> 'at')::timestamptz;
      v_cur_id := (v_cur ->> 'id')::uuid;
    exception when others then
      raise exception 'invalid cursor' using errcode = '22023';
    end;
  end if;

  select coalesce(jsonb_agg(row_j order by received_at desc, id desc), '[]'::jsonb)
    into v_rows from (
    select e.received_at, e.id, jsonb_build_object(
      'event_id', e.id, 'source_id', e.source_id,
      'source_name', (select s.name from marketing_ad_sources s
                       where s.id = e.source_id and s.tenant_id = p_tenant),
      'provider', e.provider,
      'state', e.processing_state, 'error_class', e.error_class,
      'received_at', e.received_at, 'occurred_at', e.occurred_at,
      'replay_count', e.replay_count,
      'lead_name', left(coalesce(
         nullif(trim(coalesce(e.envelope -> 'lead' ->> 'full_name', '')), ''),
         nullif(trim(coalesce(e.envelope -> 'lead' ->> 'first_name', '') || ' '
                     || coalesce(e.envelope -> 'lead' ->> 'last_name', '')), ''),
         e.envelope -> 'lead' ->> 'email', '—'), 120),
      'person_id', e.person_id,
      'person_name', (select p.display_name from people p
                       where p.id = e.person_id and p.tenant_id = p_tenant),
      'lifecycle', (select cr.lifecycle_stage_key from contact_relationships cr
                     where cr.tenant_id = p_tenant and cr.person_id = e.person_id
                       and cr.status = 'active'
                     order by cr.created_at desc limit 1),
      'conflict_id', e.identity_conflict_id,
      'interaction_id', e.interaction_id,
      'campaign_ref', e.envelope ->> 'campaign_ref',
      'form_ref', e.envelope ->> 'form_ref') as row_j
      from marketing_ad_events e
     where e.tenant_id = p_tenant
       and (v_from is null or e.received_at >= v_from)
       and (v_source is null or e.source_id = v_source)
       and (v_state is null or e.processing_state = v_state)
       and (v_cur_at is null or (e.received_at, e.id) < (v_cur_at, v_cur_id))
     order by e.received_at desc, e.id desc
     limit v_limit + 1
  ) page;

  if jsonb_array_length(v_rows) > v_limit then
    v_next := jsonb_build_object(
      'at', (v_rows -> (v_limit - 1)) ->> 'received_at',
      'id', (v_rows -> (v_limit - 1)) ->> 'event_id');
    v_rows := (select coalesce(jsonb_agg(t.e order by t.i), '[]'::jsonb)
                 from jsonb_array_elements(v_rows) with ordinality t(e, i)
                where t.i <= v_limit);
  end if;
  return jsonb_build_object(
    'leads', v_rows, 'next_cursor', v_next,
    'counts', (select jsonb_build_object(
        'received', count(*),
        'resolved', count(*) filter (where processing_state = 'resolved'),
        'review', count(*) filter (where processing_state = 'review'),
        'failed', count(*) filter (where processing_state = 'failed'),
        'pending', count(*) filter (where processing_state in ('pending', 'processing')))
       from marketing_ad_events e2
      where e2.tenant_id = p_tenant
        and (v_from is null or e2.received_at >= v_from)
        and (v_source is null or e2.source_id = v_source)
        and (v_state is null or e2.processing_state = v_state)));
end $$;

create or replace function marketing_ad_event_detail(p_tenant uuid, p_event uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_e marketing_ad_events%rowtype;
begin
  if p_tenant is null or p_event is null then
    raise exception 'tenant and event required' using errcode = '22023';
  end if;
  select * into v_e from marketing_ad_events
   where id = p_event and tenant_id = p_tenant;
  if not found then
    raise exception 'ad event not found for tenant' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'event_id', v_e.id, 'source_id', v_e.source_id,
    'source_version_id', v_e.source_version_id,
    'provider', v_e.provider, 'mode', v_e.mode,
    'provider_event_id', v_e.provider_event_id,
    'body_digest', v_e.body_digest,
    'schema_version', v_e.schema_version,
    'received_at', v_e.received_at, 'occurred_at', v_e.occurred_at,
    'replay_count', v_e.replay_count,
    'state', v_e.processing_state, 'attempts', v_e.attempts,
    'error_class', v_e.error_class,
    'envelope', v_e.envelope,
    'person_id', v_e.person_id, 'relationship_id', v_e.relationship_id,
    'interaction_id', v_e.interaction_id,
    'conflict_id', v_e.identity_conflict_id,
    'processed_at', v_e.processed_at,
    'touchpoint', (select jsonb_build_object('id', t.id,
        'confidence', t.confidence, 'evidence', t.evidence,
        'recorded_at', t.recorded_at)
       from marketing_ad_touchpoints t
      where t.tenant_id = p_tenant and t.event_id = p_event));
end $$;

create or replace function marketing_ad_attribution(p_tenant uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_key text;
  v_person uuid;
  v_history jsonb;
begin
  if p_tenant is null or p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'tenant and args required' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('person_id') then
      raise exception 'unknown attribution argument %', v_key using errcode = '22023';
    end if;
  end loop;
  begin
    v_person := (p_args ->> 'person_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'person_id must be a uuid' using errcode = '22023';
  end;
  if v_person is null or not exists (
    select 1 from people p where p.id = v_person and p.tenant_id = p_tenant) then
    raise exception 'person not found for tenant' using errcode = 'P0002';
  end if;
  -- complete touchpoint history, deterministic order (occurred_at, id) — the
  -- same key derives first/last touch; ties break on the stable uuid
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'source_id', t.source_id,
      'source_name', (select s.name from marketing_ad_sources s
                       where s.id = t.source_id and s.tenant_id = p_tenant),
      'provider', t.provider, 'campaign_ref', t.campaign_ref,
      'ad_ref', t.ad_ref, 'form_ref', t.form_ref,
      'kind', t.kind, 'confidence', t.confidence, 'evidence', t.evidence,
      'occurred_at', t.occurred_at, 'recorded_at', t.recorded_at,
      'event_id', t.event_id, 'interaction_id', t.interaction_id)
      order by t.occurred_at, t.id), '[]'::jsonb)
    into v_history
    from marketing_ad_touchpoints t
   where t.tenant_id = p_tenant and t.person_id = v_person;
  return jsonb_build_object(
    'person_id', v_person,
    'touchpoints', v_history,
    'first_touch', case when jsonb_array_length(v_history) > 0
                        then v_history -> 0 else null end,
    'last_touch', case when jsonb_array_length(v_history) > 0
                       then v_history -> (jsonb_array_length(v_history) - 1)
                       else null end,
    'note', 'Touchpoints are captured lead evidence — never job, quote, revenue or Objective contribution.');
end $$;

create or replace function marketing_ad_metrics(p_tenant uuid, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_key text;
  v_source uuid;
  v_from date;
  v_to date;
  v_facts jsonb;
  v_currencies text[];
  v_spend numeric;
  v_provider_leads bigint;
  v_received bigint;
  v_resolved bigint;
  v_cpl_provider numeric;
  v_cpl_received numeric;
  v_reason text;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_args, '{}'::jsonb)) loop
    if v_key not in ('source_id', 'from', 'to') then
      raise exception 'unknown metrics argument %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_args ? 'source_id' and jsonb_typeof(p_args -> 'source_id') <> 'null' then
    begin
      v_source := (p_args ->> 'source_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'source_id must be a uuid' using errcode = '22023';
    end;
  end if;
  begin
    v_from := (p_args ->> 'from')::date;
    v_to := (p_args ->> 'to')::date;
  exception when others then
    raise exception 'from/to must be dates' using errcode = '22023';
  end;
  if v_from is not null and v_to is not null and v_to < v_from then
    raise exception 'reversed date range' using errcode = '22023';
  end if;

  -- CURRENT facts only: a superseded fact is history, never double-counted
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'source_id', f.source_id, 'provider', f.provider,
      'window_start', f.window_start, 'window_end', f.window_end,
      'currency', f.currency, 'spend', f.spend,
      'impressions', f.impressions, 'clicks', f.clicks,
      'provider_leads', f.provider_leads,
      'provider_conversions', f.provider_conversions,
      'observed_at', f.observed_at, 'supersedes_id', f.supersedes_id)
      order by f.window_start desc), '[]'::jsonb),
    array_agg(distinct f.currency) filter (where f.spend is not null),
    sum(f.spend), sum(f.provider_leads)
    into v_facts, v_currencies, v_spend, v_provider_leads
    from marketing_ad_metric_facts f
   where f.tenant_id = p_tenant
     and (v_source is null or f.source_id = v_source)
     and (v_from is null or f.window_end >= v_from)
     and (v_to is null or f.window_start <= v_to)
     and not exists (select 1 from marketing_ad_metric_facts f2
                      where f2.tenant_id = p_tenant and f2.supersedes_id = f.id);

  select count(*),
         count(*) filter (where e.processing_state = 'resolved')
    into v_received, v_resolved
    from marketing_ad_events e
   where e.tenant_id = p_tenant
     and (v_source is null or e.source_id = v_source)
     and (v_from is null or e.occurred_at >= v_from)
     and (v_to is null or e.occurred_at < v_to + 1);

  -- CPL only when GENUINELY derivable: real spend, one currency, factual
  -- denominator > 0 — otherwise null with the exact reason. Never zero-CPL.
  if v_spend is null then
    v_reason := 'no_spend_facts';
  elsif coalesce(array_length(v_currencies, 1), 0) > 1 then
    v_reason := 'mixed_currencies';
  else
    if coalesce(v_provider_leads, 0) > 0 then
      v_cpl_provider := round(v_spend / v_provider_leads, 2);
    end if;
    if coalesce(v_received, 0) > 0 then
      v_cpl_received := round(v_spend / v_received, 2);
    end if;
    if v_cpl_provider is null and v_cpl_received is null then
      v_reason := 'zero_leads';
    end if;
  end if;

  return jsonb_build_object(
    'facts', v_facts,
    'totals', jsonb_build_object(
      -- a cross-currency sum is meaningless: totals.spend is null (with the
      -- reason surfaced via cpl_unavailable_reason) whenever more than one
      -- currency is present. Per-currency facts remain in `facts`.
      'spend', case when coalesce(array_length(v_currencies, 1), 0) > 1
                    then null else v_spend end,
      'currency', case when coalesce(array_length(v_currencies, 1), 0) = 1
                       then v_currencies[1] else null end,
      'provider_leads', v_provider_leads,
      'received_events', v_received,
      'resolved_people', v_resolved),
    'cpl_provider', v_cpl_provider,
    'cpl_received', v_cpl_received,
    'cpl_unavailable_reason', v_reason,
    'note', 'Provider-reported leads, ServiceOS received events and resolved People are DIFFERENT facts and are never conflated.');
end $$;

create or replace function marketing_ad_source_health(p_tenant uuid)
returns jsonb
language plpgsql
stable
as $$
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  return jsonb_build_object('sources',
    (select coalesce(jsonb_agg(h order by (h ->> 'name')), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', s.id, 'name', s.name, 'provider', s.provider, 'mode', s.mode,
        'status', s.status,
        'connection_state', case
           when s.mode = 'webhook' and s.credential_state = 'configured' then 'ready'
           when s.mode = 'webhook' then 'configuration_required'
           else 'not_connected' end,
        'last_event_at', (select max(e.received_at) from marketing_ad_events e
                           where e.tenant_id = p_tenant and e.source_id = s.id),
        'last_processed_at', (select max(e.processed_at) from marketing_ad_events e
                               where e.tenant_id = p_tenant and e.source_id = s.id),
        'pending', (select count(*) from marketing_ad_events e
                     where e.tenant_id = p_tenant and e.source_id = s.id
                       and e.processing_state in ('pending', 'processing')),
        'failed', (select count(*) from marketing_ad_events e
                    where e.tenant_id = p_tenant and e.source_id = s.id
                      and e.processing_state = 'failed'),
        'review', (select count(*) from marketing_ad_events e
                    where e.tenant_id = p_tenant and e.source_id = s.id
                      and e.processing_state = 'review'),
        'oldest_pending_seconds', (select extract(epoch from (now() - min(e.received_at)))::bigint
                                    from marketing_ad_events e
                                   where e.tenant_id = p_tenant and e.source_id = s.id
                                     and e.processing_state in ('pending', 'processing')),
        'replay_conflicts', (select count(*) from marketing_ad_event_conflicts c
                              where c.tenant_id = p_tenant and c.source_id = s.id),
        'metric_freshness', (select max(f.observed_at) from marketing_ad_metric_facts f
                              where f.tenant_id = p_tenant and f.source_id = s.id),
        'sync_supported', false,
        'attention', (
          s.notify_attention and (
            exists (select 1 from marketing_ad_events e
                     where e.tenant_id = p_tenant and e.source_id = s.id
                       and e.processing_state in ('failed', 'review'))
            or (s.mode = 'webhook' and s.status = 'active'
                and s.credential_state <> 'configured')
            or exists (select 1 from marketing_ad_event_conflicts c
                        where c.tenant_id = p_tenant and c.source_id = s.id))),
        'remediation', case
          when s.mode = 'webhook' and s.status = 'active'
               and s.credential_state <> 'configured'
            then 'Generate the webhook signing secret to start accepting events'
          when exists (select 1 from marketing_ad_events e
                        where e.tenant_id = p_tenant and e.source_id = s.id
                          and e.processing_state = 'review')
            then 'Identity review required — resolve the ambiguous leads'
          when exists (select 1 from marketing_ad_events e
                        where e.tenant_id = p_tenant and e.source_id = s.id
                          and e.processing_state = 'failed')
            then 'Processing failures — inspect the failed events and retry'
          when exists (select 1 from marketing_ad_event_conflicts c
                        where c.tenant_id = p_tenant and c.source_id = s.id)
            then 'Replay conflicts detected — the sender re-used an event id with a different body'
          else null end) as h
      from marketing_ad_sources s
     where s.tenant_id = p_tenant) x));
end $$;

create or replace function marketing_ads_overview(p_tenant uuid)
returns jsonb
language plpgsql
stable
as $$
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'sources', (select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where status = 'active'),
        'disabled', count(*) filter (where status = 'disabled'),
        'archived', count(*) filter (where status = 'archived'))
       from marketing_ad_sources where tenant_id = p_tenant),
    'leads', (select jsonb_build_object(
        'today', count(*) filter (where received_at >= date_trunc('day', now())),
        'week', count(*) filter (where received_at > now() - interval '7 days'),
        'month', count(*) filter (where received_at > now() - interval '30 days'),
        'total', count(*),
        'resolved', count(*) filter (where processing_state = 'resolved'),
        'review', count(*) filter (where processing_state = 'review'),
        'failed', count(*) filter (where processing_state = 'failed'),
        'pending', count(*) filter (where processing_state in ('pending', 'processing')))
       from marketing_ad_events where tenant_id = p_tenant),
    'health', marketing_ad_source_health(p_tenant),
    'note', 'Ads captures and attributes leads; it does not create or edit advertisements.');
end $$;

-- ── PART J · FUNCTION AUTHORITY — every Phase-8 function is service-role
-- only. The Phase-8 SQL suite derives this set from the catalog and fails
-- loudly in BOTH directions (missing or extra). ──────────────────────────────
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'marketing_require_ads_actor(uuid, uuid)',
    'marketing_ad_source_guard()',
    'marketing_ad_event_guard()',
    'marketing_ad_touchpoint_guard()',
    'marketing_ad_sync_run_guard()',
    'marketing_ad_source_snapshot(marketing_ad_sources)',
    'marketing_ad_source_create(uuid, uuid, jsonb)',
    'marketing_ad_source_revise(uuid, uuid, uuid, jsonb, int)',
    'marketing_ad_source_set_status(uuid, uuid, uuid, jsonb, int)',
    'marketing_ad_source_credential_mark(uuid, uuid, uuid, jsonb, int)',
    'marketing_ad_manual_sync(uuid, uuid, uuid, jsonb)',
    'marketing_ad_event_ingest(uuid, uuid, jsonb)',
    'marketing_ad_claim_events(uuid, text, int, int)',
    'marketing_ad_lead_process(uuid, uuid)',
    'marketing_ad_event_retry(uuid, uuid, uuid, jsonb)',
    'marketing_ad_metric_record(uuid, uuid, jsonb)',
    'marketing_ad_source_list(uuid, jsonb)',
    'marketing_ad_source_detail(uuid, uuid)',
    'marketing_ad_lead_feed(uuid, jsonb)',
    'marketing_ad_event_detail(uuid, uuid)',
    'marketing_ad_attribution(uuid, jsonb)',
    'marketing_ad_metrics(uuid, jsonb)',
    'marketing_ad_source_health(uuid)',
    'marketing_ads_overview(uuid)'
  ] loop
    execute 'revoke all on function public.' || fn || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || fn || ' to service_role';
  end loop;
end $$;

-- ── PART K · TABLE-PRIVILEGE DETERMINISM — Supabase-managed databases carry
-- ALTER DEFAULT PRIVILEGES that grant browser roles table privileges on new
-- tables. RLS (enabled, no write policy) already denies every browser write,
-- but the PRIVILEGE boundary must be deterministic in EVERY environment too —
-- the same reasoning Part H applies to functions. ──────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'marketing_ad_sources', 'marketing_ad_source_versions',
    'marketing_ad_events', 'marketing_ad_event_conflicts',
    'marketing_ad_touchpoints', 'marketing_ad_metric_facts',
    'marketing_ad_sync_runs'
  ] loop
    execute 'revoke insert, update, delete, truncate on ' || t
         || ' from public, anon, authenticated';
  end loop;
end $$;
