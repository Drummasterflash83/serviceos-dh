-- ============================================================================
-- Universal Intelligence Foundation — P3/P4/P5 OWNERSHIP · POLICY · LEARNING
-- ============================================================================
-- Ownership as polymorphic RACI edges (§5). Policy as versioned declarative
-- decision tables with a pure evaluator; every evaluation logged for replay
-- (§6). Confidence routing is a policy OUTPUT (review_tasks). Learning stores
-- immutable corrections that PROPOSE versioned deltas, never overwrite (§7).
-- ============================================================================

-- ── Ownership (RACI + waiting_on + approver + observer), polymorphic party. ─
create table if not exists ownership_assignments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  object_id   uuid not null references intelligence_objects(id) on delete cascade,
  raci_role   text not null
                check (raci_role in ('responsible','accountable','consulted','informed','waiting_on','approver','observer')),
  party_kind  text not null
                check (party_kind in ('user','role','department','team','customer','supplier','engineer','external','ai_agent','automation')),
  party_ref   text not null,                  -- user uuid | role slug | org_unit id | graph_node id | agent/automation id
  assigned_by text,
  assigned_at timestamptz not null default now(),
  unique (object_id, raci_role, party_kind, party_ref)
);
create index if not exists oa_object on ownership_assignments (object_id);
create index if not exists oa_party  on ownership_assignments (tenant_id, party_kind, party_ref);

-- ── Policy: ordered declarative rules, evaluated PURELY. Config, not code. ───
create table if not exists policies (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references tenants(id) on delete cascade,   -- null = platform/industry/domain default
  domain      text not null,
  scope_kind  text not null check (scope_kind in ('platform','industry','domain','tenant')),
  name        text not null,
  rules       jsonb not null default '[]',    -- [{when:<condition-tree>, then:<effects>}], ordered
  priority    int  not null default 100,      -- evaluation order across policies (lower = earlier)
  enabled     boolean not null default true,
  version_id  uuid not null references config_versions(id),
  created_at  timestamptz not null default now()
);
create index if not exists policies_lookup on policies (domain, scope_kind, enabled, priority);

-- ── Decision log — the backbone of routing, learning AND simulation (§6.1). ─
create table if not exists decision_log (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  object_id              uuid not null,                  -- soft ref (object may be re-evaluated)
  object_snapshot        jsonb not null,                 -- inputs AS THEY WERE (replayability)
  effective_profile_hash text not null,
  policy_version_ids     uuid[] not null default '{}',
  matched_rules          jsonb not null default '[]',    -- which rules fired + why
  outputs                jsonb not null default '{}',    -- owner, priority, deadline, route, ...
  input_hash             text not null,                  -- hash(snapshot + profile_hash + policy_versions)
  evaluated_at           timestamptz not null default now()
);
create index if not exists decision_log_object on decision_log (tenant_id, object_id, evaluated_at);
create index if not exists decision_log_window on decision_log (tenant_id, evaluated_at);

-- ── Confidence routing output — human review queue (OpenFolk / tenant / manual). ─
create table if not exists review_tasks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  object_id   uuid not null references intelligence_objects(id) on delete cascade,
  route       text not null check (route in ('openfolk','tenant_senior','manual')),
  reason      text,
  decision_id uuid,
  status      text not null default 'pending' check (status in ('pending','claimed','resolved','dismissed')),
  claimed_by  text,
  resolved_by text,
  resolution  jsonb,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists review_tasks_queue on review_tasks (route, status, created_at);

-- ── Learning: immutable corrections → PROPOSED versioned deltas (§7). ───────
create table if not exists corrections (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  object_id       uuid,
  decision_id     uuid,
  before          jsonb not null,
  after           jsonb not null,
  correction_kind text not null
                    check (correction_kind in ('engine_mistake','tenant_preference','industry_preference','new_pattern')),
  scope_hint      text,                          -- which layer a resulting adjustment should target
  actor           text not null,
  review_level    text,
  proposed_version_id uuid references config_versions(id),  -- the delta this correction proposes (if any)
  created_at      timestamptz not null default now()
);
create index if not exists corrections_lookup on corrections (tenant_id, correction_kind, created_at);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table ownership_assignments enable row level security;
drop policy if exists oa_select on ownership_assignments;
create policy oa_select on ownership_assignments for select to authenticated
  using (tenant_id = current_tenant_id() or is_openfolk());

alter table decision_log enable row level security;
drop policy if exists dl_select on decision_log;
create policy dl_select on decision_log for select to authenticated
  using (tenant_id = current_tenant_id() or is_openfolk());

alter table corrections enable row level security;
drop policy if exists corr_select on corrections;
create policy corr_select on corrections for select to authenticated
  using (tenant_id = current_tenant_id() or is_openfolk());

-- Policies are provider-managed config; review queue is provider + tenant-senior.
alter table policies enable row level security;
drop policy if exists policies_select on policies;
create policy policies_select on policies for select to authenticated
  using (tenant_id is null or tenant_id = current_tenant_id() or is_openfolk());

alter table review_tasks enable row level security;
drop policy if exists review_tasks_select on review_tasks;
create policy review_tasks_select on review_tasks for select to authenticated
  using (tenant_id = current_tenant_id() or is_openfolk());
