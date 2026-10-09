-- Generated TEST-only measurement/review release. No tenant data, imports or baseline.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ declare n text;begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_scorecard_conflict_codes_v1'
 and project_ref='saatxzwxvdvqevbnskxy' and source_sha256='554a7020f1ae8370f730016d10cfdd9a40b5fe08250974165de67f25802d3479') then raise exception 'Verified rules prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='learn_measurements_reviews_v1') then raise exception 'Measurement release already exists';end if;
 foreach n in array array['objective_types','objective_statuses','objective_health_statuses','metric_directions','objective_link_relations','contribution_states','objective_reason_codes','metric_definitions','measurements','objectives','objective_metrics','objective_constraints','objective_links','objective_health','objective_verification_states','learn_performance_reviews'] loop
  if to_regclass('public.'||n) is not null then raise exception 'Measurement table already exists: %',n;end if;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['objectives_strategic_guard','objectives_child_guard','metric_definitions_guard','objectives_append_only','learn_metric_scope_guard','learn_performance_append','learn_performance_review','learn_performance_insert_guard','learn_member_group_covers'])) then raise exception 'Measurement function already exists';end if;
end $$;
-- SOURCE 20260720120000_objectives.sql
-- Original SHA-256 7a5d3b6f5c8149b5f4b1b2edb743c8be038fa1eaa1fd532bfabd01f608003ff4
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

-- SOURCE 20260720120100_objectives_hardening.sql
-- Original SHA-256 9778b7d9c26b024b60cdec49b8ae995ca587e0946b4c14fd035a21521d863fbf
-- ============================================================================
-- Universal Objectives & Outcomes — HARDENING (additive, backwards-compatible)
-- ============================================================================
-- (1) Strategic versioning & approval: published objectives, their targets and
--     constraints are immutable IN PLACE — a strategic change creates a new
--     version that supersedes. AI-created objectives are always draft; AI cannot
--     publish/activate; publishing requires an authorised tenant role or OpenFolk
--     workflow. Measurements and objective-health snapshots stay append-only.
-- (2) Objective-context provenance: a controlled verification-state on each link.
-- Nothing blocks legitimate measurement inserts or derived health snapshots.
-- ============================================================================

-- ── (2) Objective-link verification-state registry + column. ────────────────
create table if not exists objective_verification_states (state text primary key, description text);
insert into objective_verification_states (state, description) values
  ('verified_published','Same-tenant published/active objective'),
  ('approved_link','From an approved objective_links record'),
  ('proposed','Proposed; not yet verified'),
  ('inferred_unverified','AI-inferred or caller-supplied; unverified'),
  ('rejected','Rejected (e.g. cross-tenant)')
on conflict (state) do nothing;

alter table objective_links add column if not exists verification_state text
  references objective_verification_states(state) default 'proposed';

alter table objective_verification_states enable row level security;
drop policy if exists ovs_select on objective_verification_states;
create policy ovs_select on objective_verification_states for select to authenticated using (true);

-- ── (1) Approval provenance columns on objectives. ──────────────────────────
alter table objectives add column if not exists created_by     text;
alter table objectives add column if not exists published_by    text;
alter table objectives add column if not exists published_role  text;

-- ── (1) Strategic guard: AI-draft-only, authorised publishing, published-immutable.
create or replace function objectives_strategic_guard() returns trigger language plpgsql as $$
declare
  ai_sources       text[] := array['approved_ai_proposal','derived'];
  authorised_roles text[] := array['tenant_owner','tenant_admin','openfolk_authorised'];
  authorised       boolean;
begin
  -- coalesce so a NULL published_role is definitively "not authorised" (a NULL
  -- would otherwise make `not authorised` NULL and silently skip the block).
  authorised := coalesce(new.published_role = any(authorised_roles), false)
                and lower(coalesce(new.published_by,'')) not in ('ai','system','');

  if tg_op = 'INSERT' then
    if new.source = any(ai_sources) and new.status is distinct from 'draft' then
      raise exception 'AI-created objectives must start as draft (source=%, status=%)', new.source, new.status
        using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'active' and not authorised then
      raise exception 'publishing an objective requires an authorised tenant role or OpenFolk workflow'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.tenant_id is distinct from new.tenant_id or old.id is distinct from new.id then
    raise exception 'objective tenant/id are immutable' using errcode = 'restrict_violation';
  end if;

  if old.status = 'draft' then
    if new.status = 'active' and not authorised then
      raise exception 'publishing an objective requires an authorised tenant role or OpenFolk workflow'
        using errcode = 'insufficient_privilege';
    end if;
    return new; -- drafts are editable
  end if;

  -- Published: the strategic definition is immutable in place.
  if old.title is distinct from new.title
     or old.description is distinct from new.description
     or old.objective_type is distinct from new.objective_type
     or old.parent_objective_id is distinct from new.parent_objective_id
     or old.priority is distinct from new.priority
     or old.weight is distinct from new.weight
     or old.starts_at is distinct from new.starts_at
     or old.target_at is distinct from new.target_at
     or old.review_cadence is distinct from new.review_cadence
     or old.source is distinct from new.source
     or old.stale_after_hours is distinct from new.stale_after_hours
     or old.domain_pack_keys is distinct from new.domain_pack_keys
     or old.capability_keys is distinct from new.capability_keys
     or old.version_id is distinct from new.version_id then
    raise exception 'published objective % is immutable — create a new version that supersedes it', old.id
      using errcode = 'restrict_violation';
  end if;
  if new.status = 'draft' then
    raise exception 'a published objective cannot return to draft' using errcode = 'restrict_violation';
  end if;
  -- Permitted on a published objective: lifecycle status, ownership, confidence,
  -- supersedes marking, updated_at. (Strategic fields are frozen above.)
  return new;
end;
$$;
drop trigger if exists objectives_strategic_guard on objectives;
create trigger objectives_strategic_guard before insert or update on objectives
  for each row execute function objectives_strategic_guard();

-- ── (1) A published objective's targets/constraints are immutable in place. ─
create or replace function objectives_child_guard() returns trigger language plpgsql as $$
declare parent_status text;
begin
  select status into parent_status from objectives
    where id = coalesce(old.objective_id, new.objective_id);
  if parent_status is not null and parent_status <> 'draft' then
    raise exception 'the target/constraint of a published objective is immutable — create a new objective version'
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists objective_metrics_guard on objective_metrics;
create trigger objective_metrics_guard before update or delete on objective_metrics
  for each row execute function objectives_child_guard();
drop trigger if exists objective_constraints_guard on objective_constraints;
create trigger objective_constraints_guard before update or delete on objective_constraints
  for each row execute function objectives_child_guard();

-- ── (1) A metric with measurements cannot change interpretation in place. ───
create or replace function metric_definitions_guard() returns trigger language plpgsql as $$
begin
  if (old.unit is distinct from new.unit
      or old.currency is distinct from new.currency
      or old.direction is distinct from new.direction
      or old.calculation_method is distinct from new.calculation_method)
     and exists (select 1 from measurements where metric_id = old.id) then
    raise exception 'metric % has measurements — unit/currency/direction/calculation are fixed (define a new metric)', old.key
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists metric_definitions_guard on metric_definitions;
create trigger metric_definitions_guard before update on metric_definitions
  for each row execute function metric_definitions_guard();

-- ── (1) Measurements + health snapshots are append-only facts. ──────────────
create or replace function objectives_append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only (facts are never edited)', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;
drop trigger if exists measurements_no_update on measurements;
create trigger measurements_no_update before update on measurements for each row execute function objectives_append_only();
drop trigger if exists measurements_no_delete on measurements;
create trigger measurements_no_delete before delete on measurements for each row execute function objectives_append_only();
drop trigger if exists objective_health_no_update on objective_health;
create trigger objective_health_no_update before update on objective_health for each row execute function objectives_append_only();
drop trigger if exists objective_health_no_delete on objective_health;
create trigger objective_health_no_delete before delete on objective_health for each row execute function objectives_append_only();

-- SOURCE 20261029150000_learn_performance_measurements.sql
-- Original SHA-256 1a65cade2ab26cffdc82ea2f17f0f25e82397d624cc15e7b93bb3f9871030a39
-- Add subject-scoped evidence to the existing measurement model. No data is
-- seeded or scored, and no historical communications are changed.
alter table public.metric_definitions add column measurement_scope text not null default 'tenant'
 check(measurement_scope in ('tenant','performance'));
alter table public.measurements
 add column subject_kind text not null default 'tenant' check(subject_kind in ('tenant','member','team','job','customer')),
 add column subject_id uuid,
 add column policy_version_id uuid references public.config_versions(id),
 add column policy_id uuid,
 add column policy_revision integer,
 add column metric_key text,
 add column sample_count bigint,
 add column covered_count bigint,
 add column eligible_count bigint,
 add column source_through timestamptz,
 add column review_state text,
 add column exclusions jsonb,
 add column supersedes uuid references public.measurements(id),
 add column group_ids uuid[],
 add column request_payload jsonb,
 add column change_reason text;
alter table public.measurements add constraint measurements_performance_shape check(
 (subject_kind='tenant' and subject_id is null and policy_version_id is null and policy_id is null
  and policy_revision is null and metric_key is null and review_state is null and request_payload is null)
 or (subject_kind<>'tenant' and subject_id is not null and policy_version_id is not null
  and policy_id is not null and policy_revision is not null and policy_revision>0 and metric_key is not null
  and sample_count>=0 and sample_count<=9007199254740991 and sample_count is not null
  and covered_count>=0 and covered_count<=9007199254740991 and covered_count is not null
  and (eligible_count is null or (eligible_count>=covered_count and eligible_count<=9007199254740991))
  and window_start is not null and window_end is not null and isfinite(window_start) and isfinite(window_end)
  and window_start<window_end and isfinite(measured_at) and measured_at>=window_end
  and (source_through is null or (isfinite(source_through) and source_through<=measured_at))
  and review_state in ('inferred','confirmed','disputed') and review_state is not null
  and exclusions is not null and jsonb_typeof(exclusions)='array'
  and group_ids is not null and request_payload is not null and jsonb_typeof(request_payload)='object'
  and length(btrim(change_reason)) between 1 and 1000 and change_reason is not null)
);
create index measurements_performance_series on public.measurements
 (tenant_id,policy_id,policy_revision,subject_kind,subject_id,window_start,window_end)
 where subject_kind<>'tenant';
create unique index measurements_one_correction on public.measurements(supersedes) where supersedes is not null;
-- Existing tenant-wide objective reads remain unchanged; staff performance starts
-- with owner/admin visibility until explicit team/self access is implemented.
create policy measurements_performance_read on public.measurements as restrictive for select to authenticated
 using(subject_kind='tenant' or (tenant_id=public.current_tenant_id()
  and coalesce(public.current_user_role(),'') in ('owner','admin')));

create function public.learn_metric_scope_guard() returns trigger language plpgsql as $$
declare d public.metric_definitions%rowtype;
begin
 if tg_table_name='metric_definitions' then
  if new.measurement_scope is distinct from old.measurement_scope
   or (old.measurement_scope='performance' and (new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id or new.key is distinct from old.key
    or new.version_id is distinct from old.version_id)) then
   raise exception 'Metric scope is immutable' using errcode='23514';
  end if;
  return new;
 end if;
 if new.metric_id is null then return new; end if;
 select * into d from public.metric_definitions where id=new.metric_id for share;
 if not found or d.tenant_id<>new.tenant_id then
  raise exception 'Metric belongs to another tenant or is missing' using errcode='23514';
 end if;
 if tg_table_name='measurements' then
  if (new.subject_kind='tenant') is distinct from (d.measurement_scope='tenant') then
   raise exception 'Measurement and metric scopes differ' using errcode='23514';
  end if;
 elsif d.measurement_scope<>'tenant' then
  raise exception 'Performance metrics cannot drive company objectives' using errcode='23514';
 end if;
 return new;
end $$;
create trigger learn_metric_scope_guard before update on public.metric_definitions for each row execute function public.learn_metric_scope_guard();
create trigger learn_measurement_scope_guard before insert on public.measurements for each row execute function public.learn_metric_scope_guard();
create trigger learn_objective_metric_scope_guard before insert or update on public.objective_metrics for each row execute function public.learn_metric_scope_guard();
create trigger learn_objective_constraint_scope_guard before insert or update on public.objective_constraints for each row execute function public.learn_metric_scope_guard();

-- Trusted adapters may append unconfirmed observations. Human review/publication
-- is separate: callers cannot claim a confirmed score through this RPC.
create function public.learn_performance_append(p_tenant_id uuid,p_measurement jsonb,p_reason text)
 returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 p jsonb:=p_measurement;
 mid uuid:=(p->>'id')::uuid;
 pid uuid:=(p->>'policyId')::uuid;
 revision integer:=(p->>'policyVersion')::integer;
 sid uuid:=(p#>>'{subject,id}')::uuid;
 kind text:=p#>>'{subject,kind}';
 start_at timestamptz:=(p#>>'{period,start}')::timestamptz;
 end_at timestamptz:=(p#>>'{period,end}')::timestamptz;
 observed timestamptz:=(p->>'observedAt')::timestamptz;
 through_at timestamptz:=(p->>'sourceThrough')::timestamptz;
 previous uuid:=(p->>'supersedes')::uuid;
 policy jsonb;
 rule jsonb;
 v_version_id uuid;
 metric uuid;
 existing public.measurements%rowtype;
 parent public.measurements%rowtype;
 member public.team_members%rowtype;
 groups uuid[]:='{}';
 source_table text;
 ref jsonb;
 exclusion jsonb;
 exists_ref boolean;
begin
 if p_tenant_id is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>262144
  or mid is null or pid is null or sid is null or revision is null or revision<1
  or (p->>'tenantId')::uuid is distinct from p_tenant_id
  or coalesce(kind,'') not in ('member','team','job','customer')
  or coalesce(p->>'review','')<>'inferred'
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000
  or start_at is null or end_at is null or observed is null or not isfinite(start_at) or not isfinite(end_at)
  or not isfinite(observed) or start_at>=end_at or observed<end_at or observed>clock_timestamp()
  or (through_at is not null and (not isfinite(through_at) or through_at>observed))
  or jsonb_typeof(p->'value') not in ('number','null') or not (p ? 'value')
  or abs((p->>'value')::numeric)>1.7976931348623157e308
  or jsonb_typeof(p->'sampleCount') is distinct from 'number'
  or jsonb_typeof(p->'coveredCount') is distinct from 'number'
  or jsonb_typeof(p->'eligibleCount') not in ('number','null') or not (p ? 'eligibleCount')
  or (p->>'sampleCount')::numeric<>trunc((p->>'sampleCount')::numeric)
  or (p->>'coveredCount')::numeric<>trunc((p->>'coveredCount')::numeric)
  or ((p->>'eligibleCount')::numeric is not null and (p->>'eligibleCount')::numeric<>trunc((p->>'eligibleCount')::numeric))
  or jsonb_typeof(p->'evidence') is distinct from 'array' or jsonb_typeof(p->'exclusions') is distinct from 'array' then
  raise exception 'Invalid performance observation' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-performance:'||mid::text,0));
 select * into existing from public.measurements where id=mid;
 if found then
  if existing.tenant_id<>p_tenant_id or existing.request_payload is distinct from p
   or existing.change_reason is distinct from btrim(p_reason) then
   raise exception 'Measurement request identity changed' using errcode='40001';
  end if;
  return jsonb_build_object('measurementId',mid,'reused',true);
 end if;
 select e.value,c.id into policy,v_version_id from public.operating_profile_entries e
  join public.config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
  where e.tenant_id=p_tenant_id and e.namespace='learn_scorecards' and e.scope_kind='tenant'
   and e.key like 'definition.%' and e.value->>'id'=pid::text and e.value->>'version'=revision::text
   and c.artifact_kind='learn_scorecard' and c.version=revision and c.status in ('draft','published');
 if not found or policy->>'subjectKind' is distinct from kind then
  raise exception 'Unknown scorecard revision or subject kind' using errcode='22023';
 end if;
 select r into rule from jsonb_array_elements(policy->'metrics') r where r->>'key'=p->>'metricKey';
 if rule is null or rule->>'unit' is distinct from p->>'unit'
  or not coalesce((rule->'sourceSystems') ? (p->>'sourceSystem'),false) then
  raise exception 'Unknown measure, unit or source' using errcode='22023';
 end if;
 source_table:=case kind when 'member' then 'team_members' when 'team' then 'org_units'
  when 'job' then 'jobs' when 'customer' then 'customer_cards' end;
 execute format('select exists(select 1 from public.%I where tenant_id=$1 and id=$2)',source_table)
  into exists_ref using p_tenant_id,sid;
 if not exists_ref then raise exception 'Unknown tenant subject' using errcode='22023'; end if;
 if policy->>'groupId' is not null then
  if kind='team' and sid=(policy->>'groupId')::uuid then groups:=array[sid];
  elsif kind='member' then
   select * into member from public.team_members where id=sid and tenant_id=p_tenant_id for share;
   if member.org_unit_id is distinct from (policy->>'groupId')::uuid or member.confirmed_at is null
    or member.effective_from>start_at or (member.effective_to is not null and member.effective_to<end_at) then
    raise exception 'Team membership does not establish the entire period' using errcode='22023';
   end if;
   groups:=array[member.org_unit_id];
  else raise exception 'Subject differs from policy team' using errcode='22023'; end if;
 end if;
 if jsonb_array_length(p->'evidence') not between 1 and 1000 or jsonb_array_length(p->'exclusions')>100 then
  raise exception 'Evidence bounds exceeded' using errcode='22023';
 end if;
 for exclusion in select value from jsonb_array_elements(p->'exclusions') loop
  if jsonb_typeof(exclusion) is distinct from 'object' or length(btrim(coalesce(exclusion->>'reason',''))) not between 1 and 200
   or jsonb_typeof(exclusion->'count') is distinct from 'number' or (exclusion->>'count')::numeric<0
   or (exclusion->>'count')::numeric>9007199254740991
   or (exclusion->>'count')::numeric<>trunc((exclusion->>'count')::numeric)
   or jsonb_typeof(exclusion->'evidence') is distinct from 'array' then
   raise exception 'Invalid exclusion' using errcode='22023';
  end if;
  if jsonb_array_length(exclusion->'evidence') not between 1 and 1000 then
   raise exception 'Exclusion evidence required' using errcode='22023';
  end if;
 end loop;
 for ref in select value from jsonb_array_elements(p->'evidence')
  union all select ev.value from jsonb_array_elements(p->'exclusions') ex cross join lateral jsonb_array_elements(ex->'evidence') ev loop
  if coalesce(ref->>'table','') not in ('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members')
   or ref->>'id' is null then raise exception 'Unsupported evidence reference' using errcode='22023'; end if;
  execute format('select exists(select 1 from public.%I where tenant_id=$1 and id=$2)',ref->>'table')
   into exists_ref using p_tenant_id,(ref->>'id')::uuid;
  if not exists_ref then raise exception 'Missing or foreign evidence' using errcode='22023'; end if;
 end loop;
 insert into public.metric_definitions(tenant_id,key,name,unit,source_system,calculation_method,version_id,measurement_scope)
  values(p_tenant_id,'learn.scorecard.'||v_version_id::text||'.'||(p->>'metricKey'),rule->>'label',rule->>'unit',
   'learn_performance','evidence_adapter',v_version_id,'performance') on conflict(tenant_id,key) do nothing;
 select id into metric from public.metric_definitions where tenant_id=p_tenant_id
  and key='learn.scorecard.'||v_version_id::text||'.'||(p->>'metricKey')
  and measurement_scope='performance' and unit=rule->>'unit' and metric_definitions.version_id=v_version_id;
 if metric is null then raise exception 'Metric registry conflict' using errcode='40001'; end if;
 if previous is not null then
  select * into parent from public.measurements where id=previous for update;
  if not found or parent.tenant_id<>p_tenant_id or parent.metric_id<>metric
   or parent.subject_kind<>kind or parent.subject_id<>sid or parent.window_start<>start_at or parent.window_end<>end_at
   or parent.measured_at>=observed or exists(select 1 from public.measurements where supersedes=previous) then
   raise exception 'Correction history changed or differs in scope' using errcode='40001';
  end if;
 end if;
 insert into public.measurements(id,tenant_id,metric_id,value,unit,window_start,window_end,measured_at,source,evidence,
  subject_kind,subject_id,policy_version_id,policy_id,policy_revision,metric_key,sample_count,covered_count,eligible_count,
  source_through,review_state,exclusions,supersedes,group_ids,request_payload,change_reason)
 values(mid,p_tenant_id,metric,(p->>'value')::numeric,p->>'unit',start_at,end_at,observed,p->>'sourceSystem',p->'evidence',
  kind,sid,v_version_id,pid,revision,p->>'metricKey',(p->>'sampleCount')::bigint,(p->>'coveredCount')::bigint,(p->>'eligibleCount')::bigint,
  through_at,'inferred',p->'exclusions',previous,groups,p,btrim(p_reason));
 return jsonb_build_object('measurementId',mid,'reused',false);
end $$;
revoke all on function public.learn_performance_append(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.learn_performance_append(uuid,jsonb,text) to service_role;

-- SOURCE 20261029160000_learn_performance_reviews.sql
-- Original SHA-256 d177f4426dc7e35189b04569a78c3094b512e642243b96c7500aabca4cb261f1
-- Human review is an append-only ledger, separate from immutable source facts.
-- Confirming an observation must never refresh its source timestamp or coverage.
create table public.learn_performance_reviews (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 measurement_id uuid not null references public.measurements(id),
 revision integer not null check(revision>0),
 decision text not null check(decision in ('confirmed','disputed')),
 reviewed_by uuid not null references public.profiles(id),
 reason text not null check(length(btrim(reason)) between 1 and 1000),
 created_at timestamptz not null default clock_timestamp(),
 unique(measurement_id,revision)
);
alter table public.learn_performance_reviews enable row level security;
create policy learn_performance_review_read on public.learn_performance_reviews for select to authenticated
 using(tenant_id=public.current_tenant_id() and coalesce(public.current_user_role(),'') in ('owner','admin'));
revoke all on public.learn_performance_reviews from public,anon,authenticated,service_role;
grant select on public.learn_performance_reviews to authenticated,service_role;
create trigger learn_performance_reviews_immutable before update or delete on public.learn_performance_reviews
 for each row execute function public.objectives_append_only();
create function public.learn_performance_review(
 p_tenant_id uuid,p_measurement_id uuid,p_request_id uuid,p_expected_revision integer,p_decision text,p_reason text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 prior public.learn_performance_reviews%rowtype;
 observed public.measurements%rowtype;
 current_revision integer;
begin
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id()
  or coalesce(public.current_user_role(),'') not in ('owner','admin')
  or exists(select 1 from public.view_as_context where actor_user_id=auth.uid()
   and ended_at is null and (expires_at is null or expires_at>now())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';
 end if;
 if p_measurement_id is null or p_request_id is null or p_expected_revision is null
  or p_expected_revision<0 or p_expected_revision>=2147483647
  or coalesce(p_decision,'') not in ('confirmed','disputed')
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
  raise exception 'A measurement, review decision, revision and reason are required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-performance-review:'||p_request_id::text,0));
 select * into prior from public.learn_performance_reviews where id=p_request_id;
 if found then
  if prior.tenant_id<>p_tenant_id or prior.measurement_id<>p_measurement_id or prior.reviewed_by<>auth.uid()
   or prior.revision<>p_expected_revision+1 or prior.decision<>p_decision or prior.reason<>btrim(p_reason) then
   raise exception 'Review request identity changed' using errcode='40001';
  end if;
  return jsonb_build_object('reviewId',prior.id,'measurementId',prior.measurement_id,'revision',prior.revision,'decision',prior.decision,'reused',true);
 end if;
 -- The adapter correction path takes this same row lock. A stale card cannot
 -- approve an observation that has already been replaced by a new source fact.
 select * into observed from public.measurements where id=p_measurement_id and tenant_id=p_tenant_id for update;
 if not found or observed.subject_kind='tenant' then
  raise exception 'Performance observation unavailable' using errcode='22023';
 end if;
 if exists(select 1 from public.measurements where supersedes=observed.id) then
  raise exception 'Observation was corrected; reload before reviewing' using errcode='40001';
 end if;
 select coalesce(max(revision),0) into current_revision from public.learn_performance_reviews where measurement_id=observed.id;
 if current_revision<>p_expected_revision then
  raise exception 'Review changed; reload before reviewing' using errcode='40001';
 end if;
 insert into public.learn_performance_reviews(id,tenant_id,measurement_id,revision,decision,reviewed_by,reason)
  values(p_request_id,p_tenant_id,observed.id,current_revision+1,p_decision,auth.uid(),btrim(p_reason));
 return jsonb_build_object('reviewId',p_request_id,'measurementId',observed.id,'revision',current_revision+1,'decision',p_decision,'reused',false);
end $$;
revoke all on function public.learn_performance_review(uuid,uuid,uuid,integer,text,text) from public,anon,service_role;
grant execute on function public.learn_performance_review(uuid,uuid,uuid,integer,text,text) to authenticated;

-- SOURCE 20261030040000_learn_measurement_conflicts_retention.sql
-- Original SHA-256 b06d2d58de4a1a2ede326a83279832b23657cd330cd17d708fd2df660a98327e
-- Manual business conflicts must not request database serialization retries.
-- Preserve whichever retained append implementation is installed (the work
-- collector later extends its evidence allowlist without changing this contract).
do $$ declare signature text; definition text; expected_count int; begin
 foreach signature in array array[
  'public.learn_performance_append(uuid,jsonb,text)',
  'public.learn_performance_review(uuid,uuid,uuid,integer,text,text)'
 ] loop
  if to_regprocedure(signature) is null then raise exception 'Measurement writer prerequisite missing';end if;
  select pg_get_functiondef(to_regprocedure(signature)) into definition;
  expected_count:=(length(definition)-length(replace(definition,'errcode=''40001''','')))/length('errcode=''40001''');
  if expected_count<>3 then raise exception 'Unexpected measurement conflict contract';end if;
  execute replace(definition,'errcode=''40001''','errcode=''PT409''');
 end loop;
end $$;
-- Row-level guards do not fire for TRUNCATE. Retain all evidence ledgers even
-- when a privileged maintenance caller attempts to truncate the whole table.
create trigger learn_measurements_no_truncate before truncate on public.measurements
 for each statement execute function public.objectives_append_only();
create trigger learn_performance_reviews_no_truncate before truncate on public.learn_performance_reviews
 for each statement execute function public.objectives_append_only();
create trigger learn_objective_health_no_truncate before truncate on public.objective_health
 for each statement execute function public.objectives_append_only();
-- Existing service writers may still insert company-wide objective measurements.
-- Staff performance observations must pass the validated SECURITY DEFINER adapter;
-- the service role cannot bypass it and insert a self-confirmed performance fact.
create function public.learn_performance_insert_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if new.subject_kind<>'tenant' and current_user is distinct from
   (select r.rolname from pg_class c join pg_roles r on r.oid=c.relowner where c.oid=tg_relid) then
  raise exception 'Use the validated performance append adapter' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.learn_performance_insert_guard() from public,anon,authenticated,service_role;
create trigger learn_performance_insert_guard before insert on public.measurements
 for each row execute function public.learn_performance_insert_guard();

-- SOURCE 20261030050000_learn_measurement_group_history.sql
-- Original SHA-256 c8c7d49b891ee1586822dc6f369de956b9ea97624a8210db4f2612c87349d702
-- A current roster row cannot prove that somebody belonged to a team for an
-- earlier assessment period. Use retained, reconciled observed membership.
create function public.learn_member_group_covers(p_tenant uuid,p_member uuid,p_group uuid,p_start timestamptz,p_end timestamptz)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare m team_members%rowtype; h learn_member_history%rowtype; previous learn_member_history%rowtype;
 head learn_member_history%rowtype; n int; cursor_at timestamptz; segment_end timestamptz; s jsonb;
begin
 if p_tenant is null or p_member is null or p_group is null or p_start is null or p_end is null
   or not isfinite(p_start) or not isfinite(p_end) or p_start>=p_end or p_end>statement_timestamp() then return false;end if;
 select * into m from team_members where id=p_member and tenant_id=p_tenant for share;
 if not found or not exists(select 1 from org_units where id=p_group and tenant_id=p_tenant) then return false;end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.team_members'::regclass
   and tgname='learn_capture_member_change' and tgenabled in ('O','A')) then
  raise exception 'Membership capture unavailable' using errcode='55000';end if;
 select count(*) into n from learn_member_history where tenant_id=p_tenant and member_id=p_member;
 if n>1000 then raise exception 'Membership history exceeds bounded proof' using errcode='54000';end if;
 if n=0 then return false;end if;
 select * into head from learn_member_history where tenant_id=p_tenant and member_id=p_member order by sequence desc limit 1;
 if head.after_state is distinct from learn_member_snapshot(m) or head.observed_at>statement_timestamp() then
  raise exception 'Current membership does not reconcile with history' using errcode='55000';end if;
 cursor_at:=p_start;
 for h in select * from learn_member_history where tenant_id=p_tenant and member_id=p_member order by sequence loop
  if previous.id is not null then
   if h.observed_at<previous.observed_at or h.before_state is distinct from previous.after_state then
    raise exception 'Membership history has an unexplained gap' using errcode='55000';end if;
   segment_end:=least(h.observed_at,p_end);
   if segment_end>cursor_at then
    if previous.observed_at>cursor_at then return false;end if;
    s:=previous.after_state;
    if s->>'teamId' is distinct from p_group::text or s->>'confirmedAt' is null
      or (s->>'confirmedAt')::timestamptz>cursor_at or s->>'effectiveFrom' is null
      or (s->>'effectiveFrom')::timestamptz>cursor_at
      or (s->>'effectiveTo' is not null and (s->>'effectiveTo')::timestamptz<segment_end) then return false;end if;
    cursor_at:=segment_end;
   end if;
  end if;
  previous:=h;
 end loop;
 if cursor_at<p_end then
  if previous.observed_at>cursor_at then return false;end if;
  s:=previous.after_state;
  if s->>'teamId' is distinct from p_group::text or s->>'confirmedAt' is null
    or (s->>'confirmedAt')::timestamptz>cursor_at or s->>'effectiveFrom' is null
    or (s->>'effectiveFrom')::timestamptz>cursor_at
    or (s->>'effectiveTo' is not null and (s->>'effectiveTo')::timestamptz<p_end) then return false;end if;
 end if;
 return true;
end $$;
revoke all on function public.learn_member_group_covers(uuid,uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
-- Retain all existing adapter validation and its current evidence allowlist.
do $patch$ declare definition text; original text; replacement text; begin
 select pg_get_functiondef('public.learn_performance_append(uuid,jsonb,text)'::regprocedure) into definition;
 original:=$old$   select * into member from public.team_members where id=sid and tenant_id=p_tenant_id for share;
   if member.org_unit_id is distinct from (policy->>'groupId')::uuid or member.confirmed_at is null
    or member.effective_from>start_at or (member.effective_to is not null and member.effective_to<end_at) then
    raise exception 'Team membership does not establish the entire period' using errcode='22023';
   end if;
   groups:=array[member.org_unit_id];$old$;
 replacement:=$new$   if not public.learn_member_group_covers(p_tenant_id,sid,(policy->>'groupId')::uuid,start_at,end_at) then
    raise exception 'Observed team membership does not cover the entire period' using errcode='22023';
   end if;
   groups:=array[(policy->>'groupId')::uuid];$new$;
 if strpos(definition,original)=0 or array_length(string_to_array(definition,original),1)<>2 then
  raise exception 'Unexpected adapter membership contract';end if;
 execute replace(definition,original,replacement);
end $patch$;

-- Explicit role access, with an unconditional tenant boundary over legacy provider reads.
do $$ declare t text;begin
 foreach t in array array['objective_types','objective_statuses','objective_health_statuses','metric_directions','objective_link_relations','contribution_states','objective_reason_codes','metric_definitions','measurements','objectives','objective_metrics','objective_constraints','objective_links','objective_health','objective_verification_states','learn_performance_reviews'] loop
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated,service_role',t);
 end loop;
 foreach t in array array['metric_definitions','measurements','objectives','objective_metrics','objective_constraints','objective_links','objective_health','learn_performance_reviews'] loop
  execute format('create policy learn_measurement_tenant_boundary on public.%I as restrictive for select to authenticated using (tenant_id=public.current_tenant_id())',t);
  execute format('create trigger learn_measurement_reference_guard before insert or update on public.%I for each row execute function public.learn_foundation_reference_guard()',t);
 end loop;
 -- Trusted objective/measurement adapters retain DML; immutable ledgers reject edits.
 foreach t in array array['metric_definitions','measurements','objectives','objective_metrics','objective_constraints','objective_links','objective_health'] loop
  execute format('grant insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
-- Trigger-only functions do not need direct application execution.
revoke all on function public.objectives_strategic_guard(),public.objectives_child_guard(),
 public.metric_definitions_guard(),public.objectives_append_only(),public.learn_metric_scope_guard()
 from public,anon,authenticated,service_role;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'learn_measurements_reviews_v1','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
