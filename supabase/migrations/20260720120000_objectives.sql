-- ============================================================================
-- Universal Objectives & Outcomes Engine v1 — schema (additive, hybrid)
-- ============================================================================
-- Strategic layer. Hybrid architecture (approved direction): dedicated
-- high-integrity Objective + Measurement tables (NOT overloading
-- intelligence_objects); a universal link table to operational objects; controlled
-- registries; graph node-types for projection. Objectives are strategic config →
-- versioned via config_versions. Nothing here executes, routes or decides.
-- Tenant-scoped, RLS-protected (incl. future OpenFolk provider read), idempotent.
-- ============================================================================

-- ── Controlled registries (FK-enforced; extended by INSERT, not by code) ────
create table if not exists objective_types (objective_type text primary key, label text);
insert into objective_types (objective_type, label) values
  ('strategic_direction','Strategic direction'),('north_star','North Star'),
  ('annual_objective','Annual objective'),('quarterly_priority','Quarterly priority'),
  ('initiative','Initiative'),('project','Project'),('operational_target','Operational target'),
  ('financial_target','Financial target'),('customer_target','Customer target'),
  ('service_target','Service target'),('product_target','Product target'),
  ('people_target','People target'),('compliance_target','Compliance target'),
  ('sustainability_target','Sustainability target'),('risk_reduction','Risk reduction'),
  ('capacity_target','Capacity target'),('optimisation_target','Optimisation target')
on conflict (objective_type) do nothing;

create table if not exists objective_statuses (status text primary key, description text);
insert into objective_statuses (status, description) values
  ('draft','Drafted, not yet published'),('active','Published and in effect'),
  ('paused','Temporarily paused'),('cancelled','Cancelled'),('archived','Archived / superseded')
on conflict (status) do nothing;

create table if not exists objective_health_statuses (status text primary key, description text);
insert into objective_health_statuses (status, description) values
  ('unknown','Insufficient/stale data'),('on_track','On track'),('at_risk','At risk'),
  ('off_track','Off track'),('blocked','Blocked by a dependency'),
  ('achieved','Target achieved'),('missed','Target missed')
on conflict (status) do nothing;

create table if not exists metric_directions (direction text primary key, description text);
insert into metric_directions (direction, description) values
  ('increase','Higher is better'),('decrease','Lower is better'),('maintain','Hold at a value'),
  ('range','Stay within a range'),('threshold','Cross a threshold'),('binary','Yes/no'),
  ('milestone','A qualitative milestone')
on conflict (direction) do nothing;

create table if not exists objective_link_relations (relation text primary key, description text);
insert into objective_link_relations (relation, description) values
  ('supports','Supports'),('contributes_to','Contributes to'),('blocks','Blocks'),
  ('risks','Puts at risk'),('conflicts_with','Conflicts with'),('depends_on','Depends on'),
  ('measures','Measures'),('caused_by','Caused by'),('supersedes','Supersedes')
on conflict (relation) do nothing;

create table if not exists contribution_states (state text primary key, description text);
insert into contribution_states (state, description) values
  ('proposed','Proposed'),('expected','Expected (no outcome yet)'),('in_progress','In progress'),
  ('outcome_observed','Outcome observed'),('contribution_confirmed','Confirmed by measurement'),
  ('contribution_rejected','Contradicted by measurement'),('inconclusive','Insufficient evidence')
on conflict (state) do nothing;

create table if not exists objective_reason_codes (code text primary key, category text not null);
insert into objective_reason_codes (code, category) values
  ('dependency_blocked','dependency'),('measurement_missing','data'),('measurement_stale','data'),
  ('unit_mismatch','data'),('currency_mismatch','data'),('milestone_reached','progress'),
  ('milestone_pending','progress'),('target_achieved','progress'),('target_missed','progress'),
  ('metric_deteriorating','progress'),('off_track','progress'),('at_risk','progress'),
  ('on_track','progress'),('constraint_violated','constraint')
on conflict (code) do nothing;

-- ── Metric definitions + measurements (first-class, NOT buried in JSON). ────
create table if not exists metric_definitions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  key          text not null,
  name         text not null,
  unit         text,
  currency     text,
  direction    text references metric_directions(direction),
  source_system text,
  calculation_method text,
  update_cadence text,
  owner        jsonb,
  version_id   uuid references config_versions(id),
  created_at   timestamptz not null default now(),
  unique (tenant_id, key)
);

create table if not exists measurements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  metric_id     uuid not null references metric_definitions(id) on delete cascade,
  value         numeric,
  unit          text,
  currency      text,
  window_start  timestamptz,
  window_end    timestamptz,
  measured_at   timestamptz not null default now(),
  source        text,
  calculation_method text,
  confidence    numeric,
  freshness     text,
  evidence      jsonb not null default '[]',
  milestone_reached boolean,
  created_at    timestamptz not null default now()
);
create index if not exists measurements_series on measurements (tenant_id, metric_id, measured_at desc);

-- ── Objectives (dedicated, versioned, hierarchical). ────────────────────────
create table if not exists objectives (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  objective_type      text not null references objective_types(objective_type),
  title               text not null,
  description         text,
  parent_objective_id uuid references objectives(id) on delete set null,
  status              text not null default 'draft' references objective_statuses(status),
  priority            text,
  weight              numeric,
  starts_at           timestamptz,
  target_at           timestamptz,
  review_cadence      text,
  source              text not null default 'tenant_configuration',
  confidence          numeric,
  stale_after_hours   int,
  owner               jsonb,
  accountable_owner   jsonb,
  domain_pack_keys    text[] not null default '{}',
  capability_keys     text[] not null default '{}',
  version_id          uuid not null references config_versions(id),
  supersedes          uuid references objectives(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists objectives_tenant on objectives (tenant_id, status);
create index if not exists objectives_parent on objectives (parent_objective_id);

-- Objective ↔ metric (target spec; supports multiple metrics per objective).
create table if not exists objective_metrics (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  objective_id   uuid not null references objectives(id) on delete cascade,
  metric_id      uuid not null references metric_definitions(id) on delete cascade,
  role           text not null default 'primary' check (role in ('primary','supporting','constraint')),
  direction      text not null references metric_directions(direction),
  baseline_value numeric, baseline_unit text, baseline_currency text,
  target_value   numeric, target_unit text, target_currency text,
  target_range_min numeric, target_range_max numeric,
  weight         numeric,
  unique (objective_id, metric_id, role)
);

create table if not exists objective_constraints (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  objective_id  uuid not null references objectives(id) on delete cascade,
  key           text not null,
  kind          text not null check (kind in ('hard','soft','guardrail')),
  description   text not null,
  metric_id     uuid references metric_definitions(id) on delete set null,
  direction     text references metric_directions(direction),
  threshold     numeric,
  unit          text,
  authority_required boolean not null default false,
  version_id    uuid references config_versions(id),
  created_at    timestamptz not null default now(),
  unique (objective_id, key)
);

-- Universal link from objectives to operational objects (controlled relations).
create table if not exists objective_links (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  objective_id       uuid not null references objectives(id) on delete cascade,
  target_kind        text not null
                       check (target_kind in ('intelligence_object','decision','action','automation_intent','outcome','graph_node','capability','policy','initiative','metric')),
  target_ref         text not null,
  relation           text not null references objective_link_relations(relation),
  expected_contribution text,
  actual_contribution   text,
  contribution_state text references contribution_states(state),
  confidence         numeric,
  rationale          text,
  evidence           jsonb not null default '[]',
  created_by         text,
  approved           boolean not null default false,
  version_id         uuid references config_versions(id),
  created_at         timestamptz not null default now()
);
create index if not exists objective_links_obj on objective_links (tenant_id, objective_id);
create index if not exists objective_links_target on objective_links (target_kind, target_ref);

-- Append-only Objective Health snapshots (the pure evaluator's output over time).
create table if not exists objective_health (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  objective_id      uuid not null references objectives(id) on delete cascade,
  status            text not null references objective_health_statuses(status),
  progress          numeric,
  confidence        numeric,
  reasons           text[] not null default '{}',
  blockers          text[] not null default '{}',
  stale_measurements text[] not null default '{}',
  evaluated_at      timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create index if not exists objective_health_series on objective_health (tenant_id, objective_id, evaluated_at desc);

-- ── Graph projection: objectives/metrics are node types (core). ─────────────
insert into domain_entity_types (domain, node_type, label, is_high_integrity) values
  ('core','Objective','Objective',true),
  ('core','Metric','Metric',true)
on conflict (domain, node_type) do nothing;

-- ── RLS: tenant-scoped read + OpenFolk provider read; registries public-read. ─
do $$
declare t text;
begin
  foreach t in array array['metric_definitions','measurements','objectives','objective_metrics','objective_constraints','objective_links','objective_health']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_select', t);
    execute format('create policy %I on %I for select to authenticated using (tenant_id = current_tenant_id() or is_openfolk())', t||'_select', t);
  end loop;
  foreach t in array array['objective_types','objective_statuses','objective_health_statuses','metric_directions','objective_link_relations','contribution_states','objective_reason_codes']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_select', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t||'_select', t);
  end loop;
end $$;

-- ── NO tenant strategy is seeded. ──────────────────────────────────────────
-- Objectives are customer strategy: we do NOT create an active North Star,
-- baseline, target, measurement or claimed outcome for Drummond Heating or any
-- real tenant to demonstrate the architecture. Only the platform registries and
-- graph node types above are seeded (production-safe metadata). The illustrative
-- ServiceOS and ProductOS example configurations live entirely in the test
-- fixtures (objectives.verify.ts) and the versioning SQL test — never in live
-- value reporting, and never implying customer approval.
