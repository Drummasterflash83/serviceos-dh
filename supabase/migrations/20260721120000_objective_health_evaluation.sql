-- ============================================================================
-- Objective Evaluation Worker v1 — schema (additive, backwards-compatible)
-- ============================================================================
-- Operationalises the PURE evaluator (evaluateObjectiveHealth / evaluateContribution
-- in objectives.ts). Adds only what the worker needs to make health snapshots
-- IDEMPOTENT, REPLAYABLE and AUDITABLE, plus an append-only contribution-assessment
-- log and a controlled event registry. It computes NOTHING here — no health formula
-- in SQL. Nothing is seeded for any real tenant.
--
-- All changes are additive: new columns are nullable, new tables are new, indexes
-- use IF NOT EXISTS. The existing objective_health append-only triggers (migration
-- 20260720120100) already protect these new columns from mutation.
-- ============================================================================

-- ── Controlled event registry (FK-style discipline; the worker emits only these).
create table if not exists objective_event_types (event_type text primary key, description text);
insert into objective_event_types (event_type, description) values
  ('objective.health.evaluated','A new immutable health snapshot was appended'),
  ('objective.health.changed','Health status changed vs the previous snapshot'),
  ('objective.at_risk','Health transitioned to at_risk'),
  ('objective.off_track','Health transitioned to off_track'),
  ('objective.blocked','Health transitioned to blocked (dependency/constraint)'),
  ('objective.achieved','Health transitioned to achieved'),
  ('objective.measurement.stale','A metric became newly stale'),
  ('objective.contribution.assessed','A contribution assessment was recorded')
on conflict (event_type) do nothing;

alter table objective_event_types enable row level security;
drop policy if exists objective_event_types_select on objective_event_types;
create policy objective_event_types_select on objective_event_types
  for select to authenticated using (true);

-- ── Evaluation identity + lineage on the append-only health snapshots. ──────
-- input_hash: the deterministic evaluation identity (tenant + objective version +
--   latest measurements + constraints + dependency state + evaluator version).
-- The worker derives it in TypeScript (buildObjectiveInputHash) — never in SQL.
alter table objective_health add column if not exists objective_version_id uuid references config_versions(id);
alter table objective_health add column if not exists evaluator_version    text;
alter table objective_health add column if not exists input_hash           text;
alter table objective_health add column if not exists triggered_by         text;
alter table objective_health add column if not exists snapshot             jsonb not null default '{}'::jsonb;
alter table objective_health add column if not exists job_id               uuid references platform_jobs(id);
alter table objective_health add column if not exists correlation_id       uuid;
alter table objective_health add column if not exists supersedes           uuid references objective_health(id);

-- triggered_by is a controlled vocabulary (mirrors the job payload). Left free of a
-- CHECK so new trigger sources can be added without a migration; documented values:
--   measurement | outcome | constraint_change | dependency_change | manual | backfill
comment on column objective_health.triggered_by is
  'What caused this evaluation: measurement|outcome|constraint_change|dependency_change|manual|backfill';
comment on column objective_health.input_hash is
  'Deterministic evaluation identity (buildObjectiveInputHash). Same inputs ⇒ same hash ⇒ idempotent.';
comment on column objective_health.snapshot is
  'Normalized evaluator input + measurement refs (ids/timestamps/values only). No raw content/secrets.';

-- IDEMPOTENCY: at most one snapshot per (tenant, objective, input_hash). A retry
-- collapses to the same logical snapshot; a changed input ⇒ a new hash ⇒ a new row.
-- A forced re-evaluation mixes a nonce into the hash, so it legitimately appends.
create unique index if not exists objective_health_idem_uk
  on objective_health (tenant_id, objective_id, input_hash)
  where input_hash is not null;
create index if not exists objective_health_supersedes on objective_health (supersedes);
create index if not exists objective_health_job on objective_health (job_id);

-- ── Append-only Contribution assessments (honest attribution over time). ────
-- objective_links.contribution_state is a single mutable "current" pointer; this is
-- the immutable HISTORY the pure evaluateContribution() produces, so a claim is
-- never silently overwritten. Append-only (same trigger discipline as health).
create table if not exists objective_contribution_assessments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  objective_id      uuid not null references objectives(id) on delete cascade,
  objective_link_id uuid references objective_links(id) on delete set null,
  metric_id         uuid references metric_definitions(id) on delete set null,
  state             text not null references contribution_states(state),
  confidence        numeric,
  observed_movement numeric,
  rationale         text[] not null default '{}',
  evidence          jsonb not null default '[]',
  input_hash        text,
  evaluator_version text,
  job_id            uuid references platform_jobs(id),
  correlation_id    uuid,
  evaluated_at      timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create index if not exists oca_series on objective_contribution_assessments (tenant_id, objective_id, evaluated_at desc);
create index if not exists oca_link on objective_contribution_assessments (objective_link_id);
-- Idempotent per (tenant, objective, link, input_hash); coalesce so a null link is
-- one logical bucket (SQL nulls are otherwise all-distinct and would never dedup).
create unique index if not exists oca_idem_uk
  on objective_contribution_assessments
     (tenant_id, objective_id, coalesce(objective_link_id, '00000000-0000-0000-0000-000000000000'::uuid), input_hash)
  where input_hash is not null;

-- Reuse the objectives append-only guard (facts are never edited or deleted).
drop trigger if exists oca_no_update on objective_contribution_assessments;
create trigger oca_no_update before update on objective_contribution_assessments
  for each row execute function objectives_append_only();
drop trigger if exists oca_no_delete on objective_contribution_assessments;
create trigger oca_no_delete before delete on objective_contribution_assessments
  for each row execute function objectives_append_only();

alter table objective_contribution_assessments enable row level security;
drop policy if exists oca_select on objective_contribution_assessments;
create policy oca_select on objective_contribution_assessments
  for select to authenticated using (tenant_id = current_tenant_id() or is_openfolk());

-- ── Objective hierarchy cycle prevention (parent chains must be acyclic). ───
-- The worker enqueues parent re-evaluation on child change; a cycle would loop
-- forever. Reject a parent link that would introduce a cycle (bounded walk).
create or replace function objectives_no_parent_cycle() returns trigger language plpgsql as $$
declare
  cursor_id uuid := new.parent_objective_id;
  hops      int := 0;
begin
  if new.parent_objective_id is null then return new; end if;
  if new.parent_objective_id = new.id then
    raise exception 'objective % cannot be its own parent', new.id using errcode = 'restrict_violation';
  end if;
  while cursor_id is not null and hops < 64 loop
    if cursor_id = new.id then
      raise exception 'objective parent link would create a cycle at %', new.id
        using errcode = 'restrict_violation';
    end if;
    select parent_objective_id into cursor_id from objectives where id = cursor_id;
    hops := hops + 1;
  end loop;
  return new;
end;
$$;
drop trigger if exists objectives_no_parent_cycle on objectives;
create trigger objectives_no_parent_cycle before insert or update of parent_objective_id on objectives
  for each row execute function objectives_no_parent_cycle();

-- ── NO tenant strategy, objective, measurement or health snapshot is seeded. ─
-- The worker produces health from the customer's own published objectives and
-- appended measurements. The live verification slice (objective
-- 1295f92c-…, metric b341661b-…, 6h→2h) exists ONLY in test fixtures and the
-- deployment verification runbook — never seeded here.
