-- ============================================================================
-- Universal Intelligence Foundation — ACTION LOOP (additive, backwards-compatible)
-- ============================================================================
-- Action is NOT a new table. It is a first-class object_class within the
-- universal intelligence_objects spine. This migration adds only the connective
-- tissue the loop needs: a CONTROLLED object-class registry (observation vs
-- action vs …), universal object-to-object links (derived_from), the Automation
-- INTENT boundary with a future-safe data-driven lifecycle, and a learning
-- pointer. Everything else is reused.
-- ============================================================================

-- ── Controlled object-class registry (sensing vs work vs insight …). ────────
-- object_class is validated against this table by FK — new classes are added by
-- INSERT (config), never by ad-hoc strings.
create table if not exists object_classes (
  class       text primary key,
  label       text not null,
  description text
);
insert into object_classes (class, label, description) values
  ('observation','Observation','A sensed fact — something that happened or is true'),
  ('action','Action','Work to be done'),
  ('insight','Insight','A derived recommendation, opportunity or assessment'),
  ('issue','Issue','A problem requiring resolution'),
  ('relationship','Relationship','A connection between entities'),
  ('unknown','Unknown','Unclassified')
on conflict (class) do nothing;

-- ── Taxonomy columns + learning pointer (nullable ⇒ FK validates non-null). ─
alter table intelligence_objects add column if not exists object_class    text;
alter table intelligence_objects add column if not exists learning_applied uuid;   -- config_versions.id (soft ref)
alter table domain_object_types  add column if not exists object_class    text;
create index if not exists io_class on intelligence_objects (tenant_id, object_class, status);

-- Enforce the controlled registry (idempotent drop-then-add, like profiles_role_check).
alter table intelligence_objects drop constraint if exists intelligence_objects_object_class_fk;
alter table intelligence_objects add  constraint intelligence_objects_object_class_fk
  foreign key (object_class) references object_classes(class);
alter table domain_object_types  drop constraint if exists domain_object_types_object_class_fk;
alter table domain_object_types  add  constraint domain_object_types_object_class_fk
  foreign key (object_class) references object_classes(class);

-- ── Universal object-to-object relationships (the loop's arrows). ───────────
create table if not exists object_links (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  from_object_id uuid not null references intelligence_objects(id) on delete cascade,
  to_object_id   uuid not null references intelligence_objects(id) on delete cascade,
  relation       text not null
                   check (relation in ('derived_from','produces','relates_to','supersedes','blocks')),
  created_at     timestamptz not null default now(),
  unique (from_object_id, to_object_id, relation)
);
create index if not exists object_links_from on object_links (from_object_id, relation);
create index if not exists object_links_to   on object_links (to_object_id, relation);

-- ── Automation INTENT lifecycle — a future-safe, DATA-DRIVEN state model. ───
-- Mirrors the platform's "states are data" principle so the Automation Engine
-- can evolve the lifecycle without a schema change.
create table if not exists automation_intent_states (
  state       text primary key,
  label       text not null,
  is_terminal boolean not null default false,
  description text
);
insert into automation_intent_states (state, label, is_terminal, description) values
  ('pending','Pending',false,'Emitted by intelligence; awaiting the Automation Engine'),
  ('claimed','Claimed',false,'Claimed by the Automation Engine'),
  ('approved','Approved',false,'Cleared to execute'),
  ('rejected','Rejected',true,'Declined; will not execute'),
  ('executing','Executing',false,'Execution in progress'),
  ('succeeded','Succeeded',true,'Executed successfully'),
  ('failed','Failed',false,'Execution failed (may retry)'),
  ('cancelled','Cancelled',true,'Cancelled before execution'),
  ('expired','Expired',true,'Not actioned within its validity window')
on conflict (state) do nothing;

create table if not exists automation_intent_transitions (
  from_state text not null references automation_intent_states(state),
  to_state   text not null references automation_intent_states(state),
  primary key (from_state, to_state)
);
insert into automation_intent_transitions (from_state, to_state) values
  ('pending','claimed'), ('pending','cancelled'), ('pending','expired'),
  ('claimed','approved'), ('claimed','rejected'), ('claimed','cancelled'),
  ('approved','executing'), ('approved','cancelled'),
  ('executing','succeeded'), ('executing','failed'),
  ('failed','executing')  -- retry
on conflict do nothing;

-- Automation INTENT — emitted by intelligence, executed by a separate engine.
-- Recording an intent NEVER runs anything; the Automation Engine claims it and
-- decides. This boundary is what keeps the intelligence layer pure.
create table if not exists automation_intents (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  action_object_id uuid not null references intelligence_objects(id) on delete cascade,
  intent_type      text not null,
  parameters       jsonb not null default '{}',
  status           text not null default 'pending' references automation_intent_states(state),
  claimed_by       text,
  claimed_at       timestamptz,
  decided_by       text,
  decided_at       timestamptz,
  attempts         int  not null default 0,
  last_error       text,
  result           jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists automation_intents_queue  on automation_intents (status, created_at);
create index if not exists automation_intents_action on automation_intents (action_object_id);

drop trigger if exists automation_intents_set_updated_at on automation_intents;
create trigger automation_intents_set_updated_at before update on automation_intents
  for each row execute function set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Registries are non-secret platform metadata (readable by any authenticated user).
alter table object_classes enable row level security;
drop policy if exists object_classes_select on object_classes;
create policy object_classes_select on object_classes for select to authenticated using (true);

alter table automation_intent_states enable row level security;
drop policy if exists ais_select on automation_intent_states;
create policy ais_select on automation_intent_states for select to authenticated using (true);

alter table automation_intent_transitions enable row level security;
drop policy if exists ait_select on automation_intent_transitions;
create policy ait_select on automation_intent_transitions for select to authenticated using (true);

-- Tenant data.
alter table object_links enable row level security;
drop policy if exists object_links_select on object_links;
create policy object_links_select on object_links for select to authenticated
  using (tenant_id = current_tenant_id() or is_openfolk());

alter table automation_intents enable row level security;
drop policy if exists automation_intents_select on automation_intents;
create policy automation_intents_select on automation_intents for select to authenticated
  using (tenant_id = current_tenant_id() or is_openfolk());
