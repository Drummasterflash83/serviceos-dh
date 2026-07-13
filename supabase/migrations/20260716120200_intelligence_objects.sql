-- ============================================================================
-- Universal Intelligence Foundation — P2 INTELLIGENCE OBJECTS + STATE ENGINE
-- ============================================================================
-- One table, one language. object_type is DATA (domain_object_types), not an
-- enum, so ServiceOS/ProductOS add types without a migration. attributes jsonb
-- is validated per-type by a pack-supplied JSON Schema. Generalizes the existing
-- `recommendations` table (which becomes one object_type via the compat layer).
-- See docs §3, §4.
-- ============================================================================

create table if not exists intelligence_objects (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  domain              text not null,               -- 'core' | 'serviceos' | 'productos'
  object_type         text not null,               -- Task|Commitment|Blocker|Risk|... (pack-registered)
  subject             text not null,
  -- ownership HOT cache (authoritative full RACI lives in ownership_assignments)
  responsible_ref     jsonb,                        -- {kind, ref}
  accountable_ref     jsonb,
  waiting_on_ref      jsonb,
  -- scoring inputs for confidence routing (§6.2)
  priority            text,                         -- pack-defined vocabulary
  severity            text,
  confidence          numeric check (confidence   is null or (confidence   between 0 and 1)),
  ambiguity           numeric check (ambiguity    is null or (ambiguity    between 0 and 1)),
  risk                numeric check (risk         is null or (risk         between 0 and 1)),
  reversibility       numeric check (reversibility is null or (reversibility between 0 and 1)),
  -- lifecycle
  status              text not null default 'unknown',   -- UNIVERSAL state
  domain_state        text,                          -- pack sub-state (nullable)
  deadline            timestamptz,
  blocking            uuid[] not null default '{}',  -- other objects this one blocks
  -- provenance / evidence
  evidence            jsonb not null default '[]',   -- [{source, detail}] — existing shared primitive
  source_interactions uuid[] not null default '{}',  -- interactions.id[]
  source_entities     uuid[] not null default '{}',  -- graph_nodes.id[]
  created_by          text,                          -- system|ai|<user id>
  created_from        text,                          -- extractor/rule name
  policy_applied      uuid,                          -- policies.id that decided this (soft ref)
  decision_id         uuid,                          -- decision_log.id (soft ref)
  attributes          jsonb not null default '{}',   -- type-specific, JSON-Schema validated by the pack
  version             int  not null default 1,       -- object revision (optimistic concurrency)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists io_lookup   on intelligence_objects (tenant_id, domain, object_type, status);
create index if not exists io_deadline on intelligence_objects (tenant_id, status, deadline);
create index if not exists io_entities on intelligence_objects using gin (source_entities);
create index if not exists io_srcint   on intelligence_objects using gin (source_interactions);

-- ── Object-type registry (core seeds the 22; packs extend). ─────────────────
create table if not exists domain_object_types (
  domain            text not null,
  object_type       text not null,
  label             text not null,
  attributes_schema jsonb not null default '{}',   -- JSON Schema for intelligence_objects.attributes
  description       text,
  primary key (domain, object_type)
);

-- ── Universal states + DATA-driven domain state machines (§4). ──────────────
create table if not exists state_definitions (
  domain           text not null,
  object_type      text not null,
  state            text not null,
  maps_to_universal text not null,              -- every domain state rolls up to a core state
  is_terminal      boolean not null default false,
  primary key (domain, object_type, state)
);
create table if not exists state_transitions (
  domain      text not null,
  object_type text not null,
  from_state  text not null,
  to_state    text not null,
  guard       jsonb,                            -- optional declarative condition
  primary key (domain, object_type, from_state, to_state)
);

-- ── Append-only transition history (audit + simulation substrate). ──────────
create table if not exists object_state_history (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  object_id   uuid not null references intelligence_objects(id) on delete cascade,
  from_state  text,
  to_state    text not null,
  actor       jsonb,
  reason      text,
  decision_id uuid,
  occurred_at timestamptz not null default now()
);
create index if not exists osh_object on object_state_history (object_id, occurred_at);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table intelligence_objects enable row level security;
drop policy if exists io_select on intelligence_objects;
create policy io_select on intelligence_objects for select to authenticated
  using (tenant_id = current_tenant_id() or is_openfolk());

alter table object_state_history enable row level security;
drop policy if exists osh_select on object_state_history;
create policy osh_select on object_state_history for select to authenticated
  using (tenant_id = current_tenant_id() or is_openfolk());

-- Registries are non-secret platform metadata: readable by any authenticated user.
alter table domain_object_types enable row level security;
drop policy if exists dot_select on domain_object_types;
create policy dot_select on domain_object_types for select to authenticated using (true);

alter table state_definitions enable row level security;
drop policy if exists sd_select on state_definitions;
create policy sd_select on state_definitions for select to authenticated using (true);

alter table state_transitions enable row level security;
drop policy if exists st_select on state_transitions;
create policy st_select on state_transitions for select to authenticated using (true);

-- ── triggers ────────────────────────────────────────────────────────────────
drop trigger if exists io_set_updated_at on intelligence_objects;
create trigger io_set_updated_at before update on intelligence_objects
  for each row execute function set_updated_at();
