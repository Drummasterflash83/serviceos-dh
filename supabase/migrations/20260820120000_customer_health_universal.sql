-- ============================================================================
-- Universal Customer Health — schema (additive, thin, tenant-agnostic)
-- ============================================================================
-- A deliberately thin, UNIVERSAL Health model. It records the fact that a tenant
-- evaluates a canonical subject with a Health type, the append-only history of that
-- evaluation, and the PRE-WORK commitment proposals a Health assessment produces.
--
-- What this is NOT:
--   • not a second task/work system — proposals never become intelligence_objects,
--     Actions, automation intents, approvals, notifications or Outcomes;
--   • not a copy of person/company/customer/job/site data — Health Objects reference
--     a canonical subject by (subject_type, subject_id) only;
--   • not tenant-specific — NO Drummonds tenant UUID, DDI, extension, queue or staff
--     name appears here. All of that is tenant configuration (a later migration).
--
-- It mirrors the established Objectives & Outcomes patterns (20260720120000 /
-- 20260721120000): dedicated high-integrity tables, controlled FK registries, an
-- append-only hash-idempotent snapshot history, a config_versions-backed policy
-- pointer, an evaluator_version stamp, tenant-scoped RLS, and pure evaluators in TS
-- (the SQL computes nothing). Everything additive and idempotent.
--
-- Shadow-only in v1: every write carries mode='shadow'. The 'live' mode exists in the
-- vocabulary but is inert until Track B materialises proposals into canonical work.
-- ============================================================================

-- ── Controlled registries (FK-enforced; extended by INSERT, never by code) ──
create table if not exists health_types (health_type text primary key, label text);
insert into health_types (health_type, label) values
  ('customer_health','Customer Health')
on conflict (health_type) do nothing;

-- The canonical subject KINDS a Health Object may point at. Free of person/company
-- data — just the entity table the subject_id refers to.
create table if not exists health_subject_types (subject_type text primary key, label text);
insert into health_subject_types (subject_type, label) values
  ('company','Company (companies)'),
  ('person','Person (people)'),
  ('customer_card','Customer Card (customer_cards)')
on conflict (subject_type) do nothing;

-- Canonical internal Health states (stable for v1; tenant labels may map later).
create table if not exists health_states (state text primary key, description text);
insert into health_states (state, description) values
  ('unknown','Insufficient / stale evidence'),
  ('healthy','No open issue'),
  ('watch','An obligation is open and within expectation'),
  ('at_risk','An obligation is overdue or repeated'),
  ('critical','Overdue plus repeated contact (per policy)'),
  ('recovering','A verified resolution has been observed')
on conflict (state) do nothing;

create table if not exists health_trends (trend text primary key, description text);
insert into health_trends (trend, description) values
  ('unknown','Not enough history to establish a trend'),
  ('improving','State improved vs the prior assessment'),
  ('stable','State unchanged vs the prior assessment'),
  ('worsening','State deteriorated vs the prior assessment')
on conflict (trend) do nothing;

-- Pre-work commitment kinds. v1 ships only 'callback'.
create table if not exists health_commitment_types (commitment_type text primary key, label text);
insert into health_commitment_types (commitment_type, label) values
  ('callback','Return call owed to a customer')
on conflict (commitment_type) do nothing;

-- Shadow lifecycle states for a commitment proposal (never live work).
create table if not exists health_proposal_states (state text primary key, description text);
insert into health_proposal_states (state, description) values
  ('proposed','Proposed by the shadow evaluator, awaiting review'),
  ('confirmed','Confirmed by the reviewer as a real obligation'),
  ('rejected','Rejected by the reviewer — not a real obligation'),
  ('corrected','Reviewer corrected the outcome/title/responsibility/due'),
  ('attached','Attached to another live shadow proposal (same obligation)'),
  ('needs_context','Cannot be established — routed to uncertainty'),
  ('deferred','Deferred by the reviewer'),
  ('resolution_possible','Possible resolution evidence observed (unverified)'),
  ('resolved_shadow','Resolution verified in shadow (terminal, no canonical Outcome)'),
  ('superseded','Superseded by a newer proposal for the same obligation')
on conflict (state) do nothing;

-- Evidence source kinds a proposal may link.
create table if not exists health_source_kinds (source_kind text primary key, description text);
insert into health_source_kinds (source_kind, description) values
  ('interaction','A canonical interaction (the candidate communication)'),
  ('recommendation','A legacy recommendation used as candidate evidence only'),
  ('related_evidence','Other supporting evidence'),
  ('resolution_interaction','A later interaction that may / does resolve the obligation')
on conflict (source_kind) do nothing;

-- Health driver codes (machine-readable "why", like objective_reason_codes).
create table if not exists health_driver_codes (code text primary key, category text not null);
insert into health_driver_codes (code, category) values
  ('no_open_callback','baseline'),
  ('explicit_callback_open','obligation'),
  ('callback_due_soon','timing'),
  ('callback_overdue','timing'),
  ('repeated_contact_same_obligation','repetition'),
  ('resolution_evidence_possible','resolution'),
  ('resolution_evidence_verified','resolution'),
  ('evidence_stale','freshness'),
  ('uncertainty','uncertainty')
on conflict (code) do nothing;

-- Reviewer decision verbs (the Chris-only shadow actions).
create table if not exists health_decision_types (decision text primary key, description text);
insert into health_decision_types (decision, description) values
  ('confirm','Confirm the proposal is a real obligation'),
  ('reject','Reject the proposal (not a real obligation)'),
  ('correct','Correct the proposed outcome / title'),
  ('correct_responsibility','Correct the proposed responsibility'),
  ('correct_due','Correct the proposed due expectation'),
  ('attach','Attach to an existing shadow proposal'),
  ('needs_context','Mark as needing more context'),
  ('defer','Defer the proposal'),
  ('confirm_resolution','Confirm the callback occurred (verified shadow resolution)'),
  ('undo','Undo / correct the latest review decision (governed)')
on conflict (decision) do nothing;

-- ── Health Objects (mutable current-state; identity = subject × health_type). ─
create table if not exists health_objects (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  health_type              text not null references health_types(health_type),
  subject_type             text not null references health_subject_types(subject_type),
  subject_id               uuid not null,
  active_policy_version_id uuid references config_versions(id),
  -- Optional current accountable pointer (a responsibility ref, e.g. a team/queue).
  -- It is a small reference, NEVER a copy of person/company data.
  accountable_ref          jsonb,
  mode                     text not null default 'shadow' check (mode in ('shadow','live')),
  attributes               jsonb not null default '{}',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- IDENTITY: one Health Object per (tenant, health_type, subject).
  unique (tenant_id, health_type, subject_type, subject_id)
);
create index if not exists health_objects_tenant on health_objects (tenant_id, health_type);
create index if not exists health_objects_subject on health_objects (tenant_id, subject_type, subject_id);
drop trigger if exists health_objects_set_updated_at on health_objects;
create trigger health_objects_set_updated_at before update on health_objects
  for each row execute function set_updated_at();

-- ── Append-only Health assessment history (the pure evaluator's output). ─────
create table if not exists health_assessments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  health_object_id  uuid not null references health_objects(id) on delete cascade,
  state             text not null references health_states(state),
  trend             text references health_trends(trend),
  drivers           jsonb not null default '[]',   -- [{code, detail}]  (code ∈ health_driver_codes)
  risks             jsonb not null default '[]',
  opportunities     jsonb not null default '[]',
  confidence        numeric check (confidence is null or (confidence between 0 and 1)),
  freshness         text,
  evidence          jsonb not null default '[]',   -- [{source, detail}] — safe hints, no PII/transcript
  evaluator_version text not null,
  policy_version_id uuid references config_versions(id),
  mode              text not null default 'shadow' check (mode in ('shadow','live')),
  input_hash        text,                          -- deterministic evaluation identity (derived in TS)
  triggered_by      text,                          -- candidate|resolution|manual|backfill
  changed           jsonb not null default '{}',   -- what changed vs the prior assessment
  job_id            uuid references platform_jobs(id),
  correlation_id    uuid,
  supersedes_id     uuid references health_assessments(id),
  evaluated_at      timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create index if not exists health_assessments_series on health_assessments (tenant_id, health_object_id, evaluated_at desc);
create index if not exists health_assessments_supersedes on health_assessments (supersedes_id);
-- IDEMPOTENCY: at most one snapshot per (tenant, object, input_hash). A retry with
-- identical inputs collapses to one row; a changed input ⇒ a new hash ⇒ a new row.
create unique index if not exists health_assessments_idem_uk
  on health_assessments (tenant_id, health_object_id, input_hash)
  where input_hash is not null;

-- ── Commitment proposals (PRE-WORK; mutable current-state, reviewed in shadow). ─
create table if not exists health_commitment_proposals (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  health_object_id         uuid not null references health_objects(id) on delete cascade,
  commitment_type          text not null references health_commitment_types(commitment_type),
  proposed_title           text,
  proposed_outcome         text,
  proposed_done_when       text,
  proposed_due_at          timestamptz,
  proposed_accountable_ref jsonb,
  proposed_handler_ref     jsonb,
  proposed_waiting_on      jsonb,
  state                    text not null default 'proposed' references health_proposal_states(state),
  confidence               numeric check (confidence is null or (confidence between 0 and 1)),
  ambiguity                numeric check (ambiguity  is null or (ambiguity  between 0 and 1)),
  policy_version_id        uuid references config_versions(id),
  classifier_version       text,
  -- Obligation identity. One LIVE proposal per (tenant, group_key). Derived from
  -- subject + obligation signature — NEVER from customer text alone — so the same
  -- obligation across many interactions folds to one proposal, while a different
  -- obligation for the same customer stays separate.
  group_key                text not null,
  mode                     text not null default 'shadow' check (mode in ('shadow','live')),
  -- Possible resolution evidence is kept DISTINCT from verified completion.
  resolution_state         text not null default 'none' check (resolution_state in ('none','possible','verified')),
  attributes               jsonb not null default '{}',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists hcp_object on health_commitment_proposals (tenant_id, health_object_id);
create index if not exists hcp_group on health_commitment_proposals (tenant_id, group_key);
-- Dedup: at most one LIVE proposal per obligation group (terminal states excluded so
-- a fresh obligation for the same group_key can later open a new proposal).
create unique index if not exists hcp_group_live_uk
  on health_commitment_proposals (tenant_id, group_key)
  where state not in ('rejected','superseded','resolved_shadow');
drop trigger if exists hcp_set_updated_at on health_commitment_proposals;
create trigger hcp_set_updated_at before update on health_commitment_proposals
  for each row execute function set_updated_at();

-- ── Proposal evidence links (append-only; a proposal has several). ───────────
create table if not exists health_proposal_sources (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  proposal_id uuid not null references health_commitment_proposals(id) on delete cascade,
  source_kind text not null references health_source_kinds(source_kind),
  source_ref  text not null,             -- interaction/recommendation id (soft ref)
  role        text not null default 'candidate_evidence'
                check (role in ('candidate_evidence','resolution_possible','resolution_verifying','related')),
  excerpt     text,                      -- BOUNDED, minimal, redacted — never a transcript
  confidence  numeric,
  evidence    jsonb not null default '{}',
  observed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (proposal_id, source_kind, source_ref, role)
);
create index if not exists hps_proposal on health_proposal_sources (tenant_id, proposal_id);

-- ── Append-only shadow review history (Chris's decisions). ──────────────────
-- The proposal.state is the mutable "current" pointer; this is the immutable HISTORY.
-- Correction-class decisions ALSO emit a canonical `corrections` row (linked here) so
-- the existing learning structures are fed — but review history lives here, not in
-- decision_log (which is the policy engine's evaluation log, a different concept).
create table if not exists health_proposal_decisions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  proposal_id      uuid not null references health_commitment_proposals(id) on delete cascade,
  health_object_id uuid not null references health_objects(id) on delete cascade,
  decision         text not null references health_decision_types(decision),
  actor            text not null,        -- reviewer ref (email / member ref)
  actor_member_id  uuid,                 -- team_members.id when resolved
  from_state       text,
  to_state         text,
  before           jsonb not null default '{}',
  after            jsonb not null default '{}',
  reason           text,
  correction_id    uuid references corrections(id),           -- set for correction-class decisions
  supersedes_id    uuid references health_proposal_decisions(id), -- for undo/correct-latest
  mode             text not null default 'shadow' check (mode in ('shadow','live')),
  created_at       timestamptz not null default now()
);
create index if not exists hpd_proposal on health_proposal_decisions (tenant_id, proposal_id, created_at desc);
create index if not exists hpd_supersedes on health_proposal_decisions (supersedes_id);

-- ── Append-only enforcement: facts and history are never edited or deleted. ──
create or replace function health_append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only (Health facts/history are never edited)', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['health_assessments','health_proposal_sources','health_proposal_decisions']
  loop
    execute format('drop trigger if exists %I on %I', t||'_no_update', t);
    execute format('create trigger %I before update on %I for each row execute function health_append_only()', t||'_no_update', t);
    execute format('drop trigger if exists %I on %I', t||'_no_delete', t);
    execute format('create trigger %I before delete on %I for each row execute function health_append_only()', t||'_no_delete', t);
  end loop;
end $$;

-- ── Tenant-Superadmin resolver (server-side gate, used by RLS). ──────────────
-- Health shadow data is Chris-ONLY. This makes the Tenant-Superadmin gate a DATA
-- invariant, not frontend hiding: an ordinary tenant user reading these tables
-- directly (even with the anon key) sees ZERO rows. Writes remain service-role only.
create or replace function current_user_is_tenant_superadmin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.team_members tm
    join public.authority_grants ag
      on ag.member_id = tm.id and ag.tenant_id = tm.tenant_id
    where tm.profile_id = auth.uid()
      and tm.tenant_id = public.current_tenant_id()
      and tm.effective_to is null
      and ag.permission = 'tenant.superadmin'
      and coalesce(ag.effective_from, '-infinity'::timestamptz) <= now()
      and coalesce(ag.effective_to,   'infinity'::timestamptz)  >  now()
  );
$$;

-- ── Table grants. Hosted Supabase supplies these via default privileges; local /
-- self-hosted stacks need them EXPLICIT (same pattern as 20260811120000
-- provider_connections and 20260814120000 universal_imports — see the note there).
-- Writes are service-role only; authenticated gets SELECT gated by the RLS below;
-- anon gets NOTHING. Append-only history stays enforced by the triggers above even
-- for service_role (grants ≠ trigger bypass).
do $$
declare t text;
begin
  foreach t in array array['health_objects','health_assessments','health_commitment_proposals','health_proposal_sources','health_proposal_decisions']
  loop
    execute format('grant select, insert, update, delete on %I to service_role', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
  foreach t in array array['health_types','health_subject_types','health_states','health_trends','health_commitment_types','health_proposal_states','health_source_kinds','health_driver_codes','health_decision_types']
  loop
    execute format('grant select on %I to service_role', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;

-- ── RLS: tenant Superadmin read (or OpenFolk provider); registries public-read.
do $$
declare t text;
begin
  foreach t in array array['health_objects','health_assessments','health_commitment_proposals','health_proposal_sources','health_proposal_decisions']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_select', t);
    execute format('create policy %I on %I for select to authenticated using ((tenant_id = current_tenant_id() and current_user_is_tenant_superadmin()) or is_openfolk())', t||'_select', t);
  end loop;
  foreach t in array array['health_types','health_subject_types','health_states','health_trends','health_commitment_types','health_proposal_states','health_source_kinds','health_driver_codes','health_decision_types']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_select', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t||'_select', t);
  end loop;
end $$;

-- ── NO tenant Health policy, subject, assessment or proposal is seeded here. ─
-- This migration ships only the universal engine + platform registries. The
-- Drummond Heating customer_health policy, callback definition, source/DDI/queue
-- allowlist (disabled until explicitly selected), due expectations, ownership map,
-- privacy rules and terminology live in the SEPARATE tenant-configuration migration
-- (20260820120100). No real Health Object is created until a candidate is processed
-- in shadow mode against a published tenant policy.
