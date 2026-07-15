-- ============================================================================
-- Universal Automation Engine v1 — schema (additive, backwards-compatible)
-- ============================================================================
-- The safe execution layer. It turns an already-authorised Automation Intent into
-- controlled, idempotent, auditable execution. It NEVER re-decides business policy
-- (that is the immutable Decision Package). This migration adds only the execution
-- substrate: intent-type + connector-capability registries, execution-attempt and
-- guard-decision history (append-only), an approval record, the first-class
-- append-only Outcomes foundation, controlled reason/event registries, the missing
-- lifecycle states/transitions + an enforcement trigger, and the execution columns
-- the intent was missing. It computes NOTHING here — no guard logic in SQL. Nothing
-- is seeded for any real tenant. All changes are additive and idempotent.
-- ============================================================================

-- ── Generic append-only guard (facts are never edited or deleted). ──────────
create or replace function automation_append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only (execution facts are never edited)', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

-- ── Controlled reason-code registry (the pure guard emits only these). ──────
create table if not exists automation_reason_codes (code text primary key, category text not null);
insert into automation_reason_codes (code, category) values
  ('intent_not_pending','lifecycle'),('intent_already_claimed','lifecycle'),('intent_expired','lifecycle'),
  ('decision_not_authorised','authorisation'),('decision_superseded','authorisation'),
  ('approval_missing','approval'),('approval_wrong_authority','approval'),
  ('operational_mode_blocks_execution','mode'),('policy_version_revoked','version'),('authority_expired','authority'),
  ('dependency_unmet','dependency'),('connector_missing','connector'),('connector_disabled','connector'),
  ('connector_unhealthy','connector'),('capability_disabled','connector'),('intent_type_unsupported','registry'),
  ('idempotency_already_succeeded','idempotency'),('retry_limit_reached','retry'),('lease_active','lease'),
  ('payload_invalid','payload'),('action_missing','integrity'),('cross_tenant_reference','security'),
  ('execution_allowed','ok'),('transient_connector_failure','result'),('permanent_connector_failure','result'),
  ('external_result_unknown','result')
on conflict (code) do nothing;

-- ── Controlled automation event registry. ───────────────────────────────────
create table if not exists automation_event_types (event_type text primary key, description text);
insert into automation_event_types (event_type, description) values
  ('automation.intent.claimed','Engine claimed an intent lease'),
  ('automation.execution.started','Execution began'),
  ('automation.execution.succeeded','Execution succeeded'),
  ('automation.execution.failed','Execution failed'),
  ('automation.execution.unknown','External result unknown — parked for status/review'),
  ('automation.execution.blocked','Execution blocked by a guard'),
  ('automation.execution.waiting','Execution waiting (dependency/lease/health)'),
  ('automation.intent.expired','Intent expired unexecuted'),
  ('automation.retry.scheduled','A bounded retry was scheduled'),
  ('automation.outcome.recorded','An immutable operational outcome was recorded')
on conflict (event_type) do nothing;

-- ── Connector capability registry (only SAFE internal capabilities in v1). ──
create table if not exists automation_connector_capabilities (
  capability_key      text primary key,
  description         text not null,
  external_side_effect boolean not null default false,
  risk_category       text not null default 'low'
);
insert into automation_connector_capabilities (capability_key, description, external_side_effect, risk_category) values
  ('internal.record_execution','Record a controlled internal execution (no external effect)', false, 'none'),
  ('internal.create_note','Create an internal platform note (no external effect)', false, 'low')
on conflict (capability_key) do nothing;
-- NOTE: dangerous capabilities (email.send, calendar.create_event, service.schedule_visit,
-- purchasing.create_order, inventory.adjust, …) are DELIBERATELY NOT registered or
-- enabled in v1. Adding one is an explicit, reviewed, additive change.

-- ── Intent-type registry (metadata; the universal core acts on these facts). ─
create table if not exists automation_intent_types (
  intent_type          text primary key,
  connector_capability text references automation_connector_capabilities(capability_key),
  risk_category        text not null default 'low',
  external_side_effect boolean not null default false,
  supports_idempotency boolean not null default true,
  supports_status_lookup boolean not null default false,
  requires_approval    boolean not null default false,
  default_expiry_seconds int not null default 86400,
  schema_version       text not null default '1',
  enabled              boolean not null default false
);
insert into automation_intent_types
  (intent_type, connector_capability, risk_category, external_side_effect, supports_idempotency, supports_status_lookup, requires_approval, default_expiry_seconds, schema_version, enabled) values
  ('record_controlled_execution','internal.record_execution','none', false, true,  false, false, 86400, '1', true),
  ('record_internal_note',       'internal.create_note',     'low',  false, true,  false, false, 86400, '1', true),
  -- The pre-existing seeded intent stays UNSUPPORTED until a real connector + policy
  -- are explicitly configured. It must never execute in v1.
  ('schedule_engineer_visit',    null,                       'high', true,  false, false, true,  86400, '1', false)
on conflict (intent_type) do nothing;

-- ── Per-tenant connector capability enablement. ─────────────────────────────
create table if not exists tenant_connector_capabilities (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  connector_id   text not null,
  capability_key text not null references automation_connector_capabilities(capability_key),
  enabled        boolean not null default false,
  config         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, connector_id, capability_key)
);
create index if not exists tcc_lookup on tenant_connector_capabilities (tenant_id, connector_id, enabled);

-- ── Execution columns the intent was missing (additive, nullable). ──────────
alter table automation_intents add column if not exists idempotency_key   text;
alter table automation_intents add column if not exists expires_at        timestamptz;
alter table automation_intents add column if not exists lease_expires_at  timestamptz;
alter table automation_intents add column if not exists connector_id      text;
alter table automation_intents add column if not exists capability_key    text;
alter table automation_intents add column if not exists decision_id       uuid;   -- soft ref to decision_log
alter table automation_intents add column if not exists execution_version text;
alter table automation_intents add column if not exists schema_version    text;
alter table automation_intents add column if not exists correlation_id    uuid;
alter table automation_intents add column if not exists max_attempts      int not null default 5;
create index if not exists automation_intents_lease on automation_intents (status, lease_expires_at);
create index if not exists automation_intents_expiry on automation_intents (status, expires_at);

-- ── Missing lifecycle state (external result lost) + transitions. ───────────
insert into automation_intent_states (state, label, is_terminal, description) values
  ('unknown','Unknown result',false,'Executed but the external result is unknown — awaiting status lookup or review')
on conflict (state) do nothing;
insert into automation_intent_transitions (from_state, to_state) values
  ('executing','unknown'), ('unknown','succeeded'), ('unknown','failed'), ('unknown','cancelled'),
  ('failed','cancelled'), ('failed','expired'),
  ('claimed','pending'),   -- release an abandoned pre-execution claim (lease recovery)
  ('pending','executing')  -- atomic claim-and-start (RPC): claim + durable attempt in one txn
on conflict do nothing;

-- ── Transition enforcement (data-driven; NONE existed before). ──────────────
-- Only enforced when status actually changes, so lease/attempt updates are free.
create or replace function automation_intents_transition_guard() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if not exists (
      select 1 from automation_intent_transitions
      where from_state = old.status and to_state = new.status
    ) then
      raise exception 'illegal automation-intent transition % -> %', old.status, new.status
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists automation_intents_transition_guard on automation_intents;
create trigger automation_intents_transition_guard before update on automation_intents
  for each row execute function automation_intents_transition_guard();

-- ── Append-only execution-attempt history (never mutable intent fields only). ─
create table if not exists automation_execution_attempts (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  automation_intent_id   uuid not null references automation_intents(id) on delete cascade,
  action_object_id       uuid references intelligence_objects(id) on delete set null,
  connector_id           text,
  capability_key         text,
  operation_type         text not null,
  idempotency_key        text not null,
  attempt_number         int not null,
  worker                 text,
  started_at             timestamptz not null default now(),
  completed_at           timestamptz,
  status                 text not null default 'in_flight'
                           check (status in ('in_flight','succeeded','failed_transient','failed_permanent','unknown')),
  request_fingerprint    text,
  request_snapshot       jsonb not null default '{}'::jsonb, -- SANITIZED; never secrets/tokens
  external_reference     text,
  response_class         text,
  result                 jsonb,                              -- SANITIZED
  error_code             text,
  error_class            text,
  retryable              boolean not null default false,
  retry_at               timestamptz,
  correlation_id         uuid,
  previous_attempt_id    uuid references automation_execution_attempts(id),
  execution_engine_version text,
  created_at             timestamptz not null default now()
);
create index if not exists aea_intent on automation_execution_attempts (tenant_id, automation_intent_id, started_at desc);
create index if not exists aea_retry  on automation_execution_attempts (status, retry_at);
-- EXACTLY-ONCE guard: at most one SUCCEEDED attempt per idempotency key per tenant.
create unique index if not exists aea_idem_success_uk
  on automation_execution_attempts (tenant_id, idempotency_key)
  where status = 'succeeded';

drop trigger if exists aea_no_update on automation_execution_attempts;
create trigger aea_no_update before update on automation_execution_attempts
  for each row execute function automation_append_only();
drop trigger if exists aea_no_delete on automation_execution_attempts;
create trigger aea_no_delete before delete on automation_execution_attempts
  for each row execute function automation_append_only();

-- ── Append-only guard-decision audit (why an intent did / didn't execute). ──
create table if not exists automation_execution_guard_decisions (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  automation_intent_id uuid not null references automation_intents(id) on delete cascade,
  outcome              text not null,
  reason_codes         text[] not null default '{}',
  evaluated_at         timestamptz not null default now(),
  correlation_id       uuid,
  job_id               uuid references platform_jobs(id),
  created_at           timestamptz not null default now()
);
create index if not exists aegd_intent on automation_execution_guard_decisions (tenant_id, automation_intent_id, evaluated_at desc);
drop trigger if exists aegd_no_update on automation_execution_guard_decisions;
create trigger aegd_no_update before update on automation_execution_guard_decisions
  for each row execute function automation_append_only();
drop trigger if exists aegd_no_delete on automation_execution_guard_decisions;
create trigger aegd_no_delete before delete on automation_execution_guard_decisions
  for each row execute function automation_append_only();

-- ── Append-only execution APPROVAL (approver kind is authoritative). ────────
create table if not exists automation_approvals (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  automation_intent_id uuid not null references automation_intents(id) on delete cascade,
  decision_id          uuid,
  approver_kind        text not null check (approver_kind in ('openfolk','tenant_senior','customer','external')),
  approver_ref         text,
  authority_basis      text,
  decision             text not null check (decision in ('approved','rejected')),
  review_task_id       uuid references review_tasks(id) on delete set null,
  granted_at           timestamptz not null default now(),
  expires_at           timestamptz,
  evidence             jsonb not null default '{}'::jsonb,
  correlation_id       uuid,
  created_at           timestamptz not null default now()
);
create index if not exists aa_intent on automation_approvals (tenant_id, automation_intent_id, granted_at desc);
drop trigger if exists aa_no_update on automation_approvals;
create trigger aa_no_update before update on automation_approvals
  for each row execute function automation_append_only();
drop trigger if exists aa_no_delete on automation_approvals;
create trigger aa_no_delete before delete on automation_approvals
  for each row execute function automation_append_only();

-- ── First-class immutable OUTCOMES foundation (contribution prerequisite). ──
-- Three layers, kept distinct: execution result vs operational outcome vs BUSINESS
-- outcome. Only execution/operational types are registered in v1 — the outcome_type
-- FK therefore makes a BUSINESS-value outcome structurally impossible until one is
-- explicitly, reviewably registered. This is what the Objective Worker's contribution
-- boundary will eventually consume; it does NOT loosen that boundary now.
create table if not exists outcome_layers (layer text primary key, description text);
insert into outcome_layers (layer, description) values
  ('execution','A connector operation completed'),
  ('operational','The intended operational state occurred'),
  ('business','A measurable business effect occurred (requires verified evidence)')
on conflict (layer) do nothing;

create table if not exists outcome_types (
  outcome_type text primary key,
  layer        text not null references outcome_layers(layer),
  description  text
);
insert into outcome_types (outcome_type, layer, description) values
  ('controlled_execution_recorded','operational','A controlled internal execution was recorded'),
  ('internal_note_recorded','operational','An internal platform note was recorded')
on conflict (outcome_type) do nothing;
-- NO 'business' outcome type is seeded in v1 (see note above).

create table if not exists outcome_statuses (status text primary key, description text);
insert into outcome_statuses (status, description) values
  ('observed','Observed and recorded'),('superseded','Superseded by a later outcome'),
  ('corrected','Corrected by a later outcome'),('rejected','Rejected on review')
on conflict (status) do nothing;

create table if not exists outcomes (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  action_object_id     uuid references intelligence_objects(id) on delete set null,
  automation_intent_id uuid references automation_intents(id) on delete set null,
  execution_attempt_id uuid references automation_execution_attempts(id) on delete set null,
  outcome_type         text not null references outcome_types(outcome_type),
  outcome_layer        text not null references outcome_layers(layer),
  status               text not null default 'observed' references outcome_statuses(status),
  observed_at          timestamptz not null default now(),
  evidence             jsonb not null default '[]'::jsonb,
  confidence           numeric,
  source               text,
  external_reference   text,
  correlation_id       uuid,
  supersedes           uuid references outcomes(id),
  created_at           timestamptz not null default now()
);
create index if not exists outcomes_series on outcomes (tenant_id, action_object_id, observed_at desc);
create index if not exists outcomes_intent on outcomes (automation_intent_id);
create index if not exists outcomes_supersedes on outcomes (supersedes);
drop trigger if exists outcomes_no_update on outcomes;
create trigger outcomes_no_update before update on outcomes
  for each row execute function automation_append_only();
drop trigger if exists outcomes_no_delete on outcomes;
create trigger outcomes_no_delete before delete on outcomes
  for each row execute function automation_append_only();

-- ── RLS: tenant-scoped read + OpenFolk provider read; registries public-read. ─
do $$
declare t text;
begin
  foreach t in array array['tenant_connector_capabilities','automation_execution_attempts',
    'automation_execution_guard_decisions','automation_approvals','outcomes']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_select', t);
    execute format('create policy %I on %I for select to authenticated using (tenant_id = current_tenant_id() or is_openfolk())', t||'_select', t);
  end loop;
  foreach t in array array['automation_reason_codes','automation_event_types','automation_connector_capabilities',
    'automation_intent_types','outcome_layers','outcome_types','outcome_statuses','outcome_verification_states']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_select', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t||'_select', t);
  end loop;
end $$;

-- ── HARDENING 1: authorised intent business fields are IMMUTABLE in place. ──
-- An Automation Intent exists only because a Decision authorised it. Once it leaves
-- 'pending' its business definition is frozen — changing it requires a NEW intent, so
-- the executor's idempotency key and trust can never be moved under it. Lifecycle,
-- lease and result fields still change (through legal transitions only).
create or replace function automation_intents_immutable_business() returns trigger language plpgsql as $$
begin
  if old.status <> 'pending' then
    if new.action_object_id is distinct from old.action_object_id
       or new.intent_type    is distinct from old.intent_type
       or new.parameters     is distinct from old.parameters
       or new.connector_id   is distinct from old.connector_id
       or new.capability_key is distinct from old.capability_key
       or new.decision_id    is distinct from old.decision_id
       or new.schema_version is distinct from old.schema_version
       or new.execution_version is distinct from old.execution_version
       or new.idempotency_key   is distinct from old.idempotency_key then
      raise exception 'authorised automation intent business fields are immutable — create a new intent'
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists automation_intents_immutable_business on automation_intents;
create trigger automation_intents_immutable_business before update on automation_intents
  for each row execute function automation_intents_immutable_business();

-- ── HARDENING 2: ATOMIC claim + durable in-flight attempt (one transaction). ─
-- Validates state + lease eligibility + retry budget, atomically claims the intent to
-- 'executing', increments attempts EXACTLY once, and creates the immutable in-flight
-- attempt — all or nothing. Two concurrent workers cannot both claim (FOR UPDATE lock +
-- the state precondition). If the attempt insert fails the whole txn rolls back, leaving
-- the intent unchanged. Connector execution begins only after this returns an attempt.
create or replace function automation_claim_and_start(
  p_intent_id      uuid,
  p_tenant_id      uuid,
  p_worker         text,
  p_lease_seconds  int,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_engine_version text
) returns table (attempt_id uuid, attempt_number int) language plpgsql as $$
declare
  v      automation_intents%rowtype;
  v_next int;
  v_id   uuid;
begin
  select * into v from automation_intents
    where id = p_intent_id and tenant_id = p_tenant_id
    for update;
  if not found then return; end if;                                  -- unknown/cross-tenant
  if v.status not in ('pending','failed') then return; end if;       -- not claimable
  if v.lease_expires_at is not null and v.lease_expires_at > now() then return; end if; -- lease active
  if v.expires_at is not null and v.expires_at < now() then return; end if;             -- expired
  if v.attempts >= v.max_attempts then return; end if;               -- retry budget spent

  v_next := v.attempts + 1;
  update automation_intents set
    status = 'executing',
    attempts = v_next,
    lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
    claimed_by = p_worker,
    claimed_at = now(),
    idempotency_key = coalesce(idempotency_key, p_idempotency_key),
    correlation_id = coalesce(p_correlation_id, correlation_id),
    execution_version = p_engine_version,
    decided_at = now()
  where id = p_intent_id;

  insert into automation_execution_attempts
    (tenant_id, automation_intent_id, action_object_id, connector_id, capability_key,
     operation_type, idempotency_key, attempt_number, worker, status, request_fingerprint,
     correlation_id, execution_engine_version)
  values
    (v.tenant_id, v.id, v.action_object_id, v.connector_id, v.capability_key,
     v.intent_type, p_idempotency_key, v_next, p_worker, 'in_flight', p_idempotency_key,
     p_correlation_id, p_engine_version)
  returning id into v_id;

  attempt_id := v_id;
  attempt_number := v_next;
  return next;
end;
$$;

-- ── HARDENING 3: Outcome PROVENANCE + verification authority. ────────────────
create table if not exists outcome_verification_states (state text primary key, description text);
insert into outcome_verification_states (state, description) values
  ('system_observed','Observed by the platform itself (e.g. a controlled execution)'),
  ('externally_verified','Verified against an external source of truth'),
  ('human_verified','Verified by a human reviewer'),
  ('inferred_unverified','Inferred/derived; not verified'),
  ('rejected','Rejected on review')
on conflict (state) do nothing;

alter table outcomes add column if not exists verification_state text
  references outcome_verification_states(state) default 'system_observed';
alter table outcomes add column if not exists source_kind      text;     -- e.g. automation_execution
alter table outcomes add column if not exists source_record_id uuid;     -- the producing record

-- A BUSINESS-value outcome may never be merely system_observed/inferred — it needs
-- external/human verification. (No business outcome_type is even registered in v1, so
-- this is a belt-and-braces guard for when one is.)
create or replace function outcomes_business_needs_verification() returns trigger language plpgsql as $$
begin
  if new.outcome_layer = 'business'
     and new.verification_state not in ('externally_verified','human_verified') then
    raise exception 'a business outcome requires external/human verification (got %)', new.verification_state
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists outcomes_business_needs_verification on outcomes;
create trigger outcomes_business_needs_verification before insert on outcomes
  for each row execute function outcomes_business_needs_verification();

-- Cross-tenant evidence references are rejected where enforceable: the action,
-- intent and execution attempt an Outcome cites must all belong to its own tenant.
create or replace function outcomes_tenant_consistency() returns trigger language plpgsql as $$
begin
  if new.action_object_id is not null
     and (select tenant_id from intelligence_objects where id = new.action_object_id) is distinct from new.tenant_id then
    raise exception 'cross-tenant action reference on outcome' using errcode = 'restrict_violation';
  end if;
  if new.automation_intent_id is not null
     and (select tenant_id from automation_intents where id = new.automation_intent_id) is distinct from new.tenant_id then
    raise exception 'cross-tenant intent reference on outcome' using errcode = 'restrict_violation';
  end if;
  if new.execution_attempt_id is not null
     and (select tenant_id from automation_execution_attempts where id = new.execution_attempt_id) is distinct from new.tenant_id then
    raise exception 'cross-tenant attempt reference on outcome' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists outcomes_tenant_consistency on outcomes;
create trigger outcomes_tenant_consistency before insert on outcomes
  for each row execute function outcomes_tenant_consistency();

-- ── NO tenant automation, intent, execution, approval or outcome is seeded. ──
-- The controlled verification slice (a record_controlled_execution intent through
-- the controlled_test adapter) lives ONLY in tests and the deployment runbook.
