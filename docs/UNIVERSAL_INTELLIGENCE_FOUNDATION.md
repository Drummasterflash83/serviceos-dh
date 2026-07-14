# Universal Intelligence Foundation — Architecture

**Status:** Design for review. No migrations written, nothing committed, nothing
deployed. This document is deliverables 1–10, 13–14; it recommends a better
shape than the brief in three places (marked **▲ RECOMMENDATION**) and asks you
to choose the architecture **before** any implementation.

---

## 0. Architecture review (deliverable 1)

### 0.1 The reframing: this is a refactor, not a greenfield build

The brief describes a `Universal Intelligence Engine → Tenant Operating Profile
→ Domain Pack → Policy Engine → Automations → UI` stack as if from zero. But the
codebase already contains most of the substrate, and — critically — it already
contains **separate intelligence engines**, which is the exact thing the core
principle forbids. Any design that adds a *new* engine alongside them fails the
principle on day one.

What already exists and what it maps to:

| Brief concept | Already in the repo | Verdict |
|---|---|---|
| Entity substrate (`source_entities`) | `graph_nodes` + `graph_edges` + `graph_events` — universal, `node_type`/`edge_type` discriminated, jsonb `properties`/`evidence` | **Reuse as-is.** A universal graph already exists. |
| Timeline (`source_interactions`) | `interactions` (`source_table`/`source_id` provenance, immutable projection) | **Reuse as-is.** |
| Intelligence Object | `recommendations` (has id, type, severity=priority, confidence, status, due_at, evidence, created_by, source_rule) | **Generalize.** ~half the target envelope. |
| Event backbone | `platform_events` (append log; **no outbox, no dispatcher, no actor/occurred_at**) | **Reuse + harden.** |
| Automation extension point | `platform_jobs` + `WORKER_HANDLERS` registry | **Reuse as-is.** |
| Config precedent | `tenant_connectors` (typed columns + `settings jsonb`) + child accounts | **Mirror the shape.** |
| Domain pack / licensing skeleton | `src/lib/modules/*` registry with `license` tiers + `TODO(openfolk)` per-tenant enablement | **Promote to DB.** |
| Versioning | *nothing* (closest: `status` strings, `source_version` md5, `audit_logs`) | **New ground.** |
| Tenant identity | bare `tenant_id uuid` (no `tenants` table); `profiles.role` CHECK (owner/admin/ops/viewer); `current_tenant_id()`/`current_user_role()` RLS helpers | **Extend.** |

**Consequence:** the five existing engines (Identity, Business Graph, Customer
Card, Recommendation, Live Call) must be *subsumed*, not paralleled:

- **Business Graph** = the entity substrate (nodes/edges). Not an "engine" under
  the spine; it *is* the spine's entity layer.
- **Identity Resolution** = entity resolution that produces `source_entities`
  and match-suggestion objects. Its recommendation-writing path folds into the
  policy engine.
- **Recommendation Engine** = the first *producer* of Intelligence Objects. Its
  output table is generalized into `intelligence_objects`; "Recommendation"
  becomes one `object_type` among many.
- **Customer Card** = a *projection/consumer* of objects + graph, not a peer
  engine.

If we skip this reframing we get two intelligence layers. The brief's own
principle is the argument for doing the refactor.

### 0.2 The load-bearing insight

Parts 7 (confidence routing), 8 (learning) and 12 (simulation) are **not three
features** — they are three consumers of the same three mechanisms:

1. **One versioning lifecycle** (draft → simulation → review → published →
   archived, with `supersedes` + audit) applied uniformly to profiles, policies
   and packs.
2. **An append-only decision log** — every policy evaluation records its inputs
   (by reference + hash), the profile/policy versions used, the rules that
   fired, and the outputs.
3. **Append-only histories** — object state transitions, corrections, events.

If any of the three is missing, routing/learning/simulation cannot work. So they
are designed *first*, as the backbone, before breadth of object types.

---

## 1. Recommended architecture (deliverables 3–7)

```
                 ┌─────────────────────────────────────────────┐
                 │              CONTROL PLANE (OpenFolk)         │  provider scope
                 │  packs · policies · profiles · flags ·        │
                 │  review queue · learning queue · versions     │
                 └───────────────────────┬─────────────────────┘
                                          │ versioned config (published pointers)
   INPUTS                                 ▼                         OUTPUTS
 interactions ─┐        ┌───────────────────────────────┐      ┌───────────────┐
 graph_nodes  ─┼──▶ EXTRACTORS ──▶ intelligence_objects ─┼─▶ POLICY ENGINE ─▶ decisions
 graph_edges  ─┘   (domain-generic,   (one envelope,     │   (pure, versioned)   │
                    pack-driven)        ~22 types)        │        │              │
                                             │            │        ▼              ▼
                                    ownership_assignments │   decision_log   review_tasks
                                    object_state_history  │  (replayable)   (routing gate)
                                             │            │        │
                                             ▼            ▼        ▼
                                        platform_events (outbox + dispatcher)
                                             │
                                             ▼
                                  automations / agents (future) · projections (customer_card)
                                             │
                                             ▼
                                             UI
```

The engine code is **universal and generic**. All behaviour comes from three
data inputs: the **effective Tenant Operating Profile**, the **Domain Pack**, and
the **published Policy set**. No branch anywhere reads a tenant id or industry
name.

---

## 2. Tenant Operating Profile (Part 1)

### 2.1 ▲ RECOMMENDATION E — the profile is *layered*, not one blob

"No hard-coded industries" is guaranteed structurally if industry is just a
config layer. The effective profile is resolved, in order, from:

```
platform defaults
  → industry template        (e.g. "hvac", "wholesale" — pure data rows)
    → domain pack defaults    (serviceos / productos)
      → tenant overrides
        → department overrides
          → team overrides
            → user overrides
```

A deterministic **resolver** deep-merges these into an *effective profile
snapshot* (versioned, hashable, cacheable). The engine reads the snapshot; it
never re-derives from tenant identity. Industry = data; adding an industry =
inserting rows, never code.

### 2.2 Schema (design DDL — not applied)

A `tenants` table is finally justified (today `tenant_id` is a bare uuid). Then a
single **profile-layers** table + a resolved-snapshot table.

```sql
-- The missing anchor. tenant_id stops being a floating uuid.
create table tenants (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  display_name text not null,
  industry     text,                    -- a template key, NOT a code path
  status       text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every profile "fact" is a scoped, versioned key/value. Scope is the layer.
create table operating_profile_entries (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid,                       -- null = platform/industry default layer
  scope_kind  text not null,             -- platform|industry|domain|tenant|department|team|user
  scope_ref   text,                       -- industry key / domain id / dept id / team id / user id
  domain      text,                       -- null = applies to all domains
  namespace   text not null,             -- 'sla' | 'escalation' | 'ai_permissions' | 'terminology' | ...
  key         text not null,
  value       jsonb not null,
  -- versioning mixin (see §11) via a shared config_version fk
  version_id  uuid not null references config_versions(id),
  created_at timestamptz not null default now()
);
create index on operating_profile_entries (tenant_id, namespace, key);
```

The brief's long list (departments, teams, roles, escalation chains, approval
hierarchy, SLA, customer priority, supplier models, AI permissions, review
routing, risk appetite, confidence thresholds, terminology, automation
maturity, domain packs enabled …) are all **namespaces** of entries, not
columns. That is what keeps it open-ended and industry-neutral.

Departments / teams / escalation chains that need referential integrity get thin
typed tables (`org_units`, `org_unit_members`) keyed to `tenants`, mirroring the
`tenant_connectors` parent/child idiom; their *policies* (who escalates to whom,
thresholds) live as profile entries.

```sql
create table org_units (            -- department | team | crew | pod (kind is data)
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  kind text not null,               -- 'department' | 'team' | ... (from pack/profile)
  parent_id uuid references org_units(id),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

**Effective snapshot** (what the engine actually reads):

```sql
create table effective_profiles (
  tenant_id   uuid not null references tenants(id),
  domain      text not null,
  resolved    jsonb not null,        -- deep-merged layers
  input_hash  text not null,         -- hash of contributing version ids
  computed_at timestamptz not null default now(),
  primary key (tenant_id, domain)
);
```

Snapshotting matters for **simulation**: a decision made last Tuesday must be
replayable against the profile *as it was* then — so decisions reference the
`effective_profiles.input_hash` (or a point-in-time snapshot id).

---

## 3. Universal Intelligence Object (Part 2)

### 3.1 ▲ RECOMMENDATION A — one table, typed attributes, JSON-Schema-validated

Three options were considered:

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Dedicated table per object type** (22 tables) | strong typing, FK integrity | 22× policy/ownership/routing wiring; cross-type queries ("everything blocking job X") become 22-way unions; new type = migration | ✗ violates "one language" |
| **B. Pure EAV** (object + attribute rows) | infinitely flexible | unqueryable, no constraints, slow, unreadable | ✗ |
| **C. One `intelligence_objects` table** with a common envelope + `attributes jsonb` validated per-type by a JSON Schema stored in the domain pack, hot fields promoted to generated columns | one language, uniform policy/ownership/routing, trivial cross-type queries, new type = a pack row | ✓ **recommended** |

Option C is exactly how `graph_nodes` already works (`node_type` + jsonb
`properties`), so it's proven in this codebase.

### 3.2 Schema (generalize `recommendations`)

```sql
create table intelligence_objects (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  domain             text not null,               -- 'core' | 'serviceos' | 'productos'
  object_type        text not null,               -- Task|Commitment|MissingInformation|Blocker|... (pack-registered)
  subject            text not null,
  -- ownership: denormalized HOT cache (full RACI in ownership_assignments, §5)
  responsible_ref    jsonb,                        -- {kind, ref}
  accountable_ref    jsonb,
  waiting_on_ref     jsonb,
  -- scoring
  priority           text,                         -- pack-defined vocabulary
  severity           text,
  confidence         numeric,                      -- 0..1
  ambiguity          numeric,                      -- 0..1  (for routing, Part 7)
  risk               numeric,                      -- 0..1
  reversibility      numeric,                      -- 0..1
  -- lifecycle
  status             text not null default 'unknown',   -- UNIVERSAL state (§4)
  domain_state       text,                          -- pack sub-state (§4)
  deadline           timestamptz,
  blocking           uuid[] default '{}',           -- other intelligence_objects this blocks
  -- provenance
  evidence           jsonb not null default '[]',   -- [{source, detail}] — the existing shared primitive
  source_interactions uuid[] default '{}',          -- interactions.id[]
  source_entities    uuid[] default '{}',           -- graph_nodes.id[]
  created_by         text,                          -- system|ai|<user>
  created_from       text,                          -- extractor/rule name (was source_rule)
  policy_applied     uuid references policies(id),  -- which policy version decided this
  decision_id        uuid,                          -- link to decision_log (§6)
  attributes         jsonb not null default '{}',   -- type-specific, validated by pack JSON Schema
  version            int not null default 1,        -- object revision (optimistic concurrency)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on intelligence_objects (tenant_id, domain, object_type, status);
create index on intelligence_objects (tenant_id, status, deadline);
create index on intelligence_objects using gin (source_entities);
```

Object types are **not** an enum — they are rows in `domain_object_types` (§4),
so ServiceOS/ProductOS add types without a migration. The 22 in the brief seed
the `core` domain; packs add more.

### 3.3 Migration of `recommendations`

`recommendations` has two live producers and a live consumer (`customer_card`
projection). ▲ **Recommend new table + back-compat view + dual-write, then
cutover** (see §12 migration plan) rather than an in-place ALTER — the producers
and the customer-card reader stay green throughout.

---

## 4. Universal State Engine (Part 4)

- **Universal states** (core, reusable): `unknown, waiting, blocked, ready,
  monitoring, escalated, approved, rejected, complete, cancelled`. Stored in
  `intelligence_objects.status`.
- **Domain sub-states** live in the pack (`domain_state`), never in core.
- **Transitions are data, not code** — a `state_transitions` table per
  `(domain, object_type)` defines allowed moves; the engine validates against
  it. ServiceOS and ProductOS define their own machines without touching engine
  code.
- **Every transition is appended** to `object_state_history` (immutable) — the
  audit + simulation substrate.

```sql
create table state_definitions (
  domain text not null, object_type text not null,
  state text not null, is_terminal boolean default false,
  maps_to_universal text not null,           -- every domain state rolls up to a core state
  primary key (domain, object_type, state)
);
create table state_transitions (
  domain text not null, object_type text not null,
  from_state text not null, to_state text not null,
  guard jsonb,                               -- optional declarative condition
  primary key (domain, object_type, from_state, to_state)
);
create table object_state_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, object_id uuid not null references intelligence_objects(id),
  from_state text, to_state text not null,
  actor jsonb, reason text, decision_id uuid,
  occurred_at timestamptz not null default now()
);
```

---

## 5. Ownership Engine (Part 3)

### 5.1 ▲ RECOMMENDATION B — polymorphic RACI edges + hot cache

The brief lists both flat fields (Part 2: `owner`, `accountable_owner`,
`waiting_on`) and a rich model (Part 3: RACI + Approver + Observer across 10
party kinds). These reconcile as: **full assignments in an edge table; the three
hottest roles cached on the object** (§3.2) for fast filtering.

Party reference is polymorphic — and note that customer/supplier/engineer/
external-party are already **graph_nodes**, so ownership reuses the entity graph:

```sql
create table ownership_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  object_id uuid not null references intelligence_objects(id) on delete cascade,
  raci_role text not null,          -- responsible|accountable|consulted|informed|waiting_on|approver|observer
  party_kind text not null,         -- user|role|department|team|customer|supplier|engineer|external|ai_agent|automation
  party_ref  text not null,         -- user uuid | role slug | org_unit id | graph_node id | agent/automation id
  assigned_by text, assigned_at timestamptz not null default now(),
  unique (object_id, raci_role, party_kind, party_ref)
);
```

Ownership **resolution** is a pure function `(object, effective_profile,
pack) → assignments`, run by the policy engine (owner is a policy output, §6).
`party_kind='role'|'department'|'team'` are *late-bound*: a role assignment
resolves to concrete users at notification time via `org_units`/`profiles`, so
reorganisations don't rewrite history.

---

## 6. Policy Engine (Part 6) + Confidence Routing (Part 7)

### 6.1 ▲ RECOMMENDATION C — versioned declarative decision tables, pure eval

Policies are **configuration, evaluated by a pure function**, never code. A
Turing-complete embedded language would make simulation and audit intractable;
instead:

- A **policy** is an ordered set of rules. Each rule = `when (condition) then
  (effects)`.
- **Conditions** are a constrained, serializable expression tree (JSON-logic
  style) over: object fields, `attributes`, confidence/ambiguity/risk/
  reversibility, entity facts (via graph), and effective-profile values. No I/O,
  no loops, no clock except an injected `now`.
- **Effects** are typed and closed: set `priority`, `deadline`, `owner/RACI`,
  `recommended_action`, `automation_permission`, `escalation`, `review_route`,
  `notifications`. Nothing else.
- **Escape hatch without code-per-tenant:** a small library of *named
  predicates/effect functions* registered centrally; policies *select* them by
  name with parameters. Adding one is a platform change, reviewed once; tenants
  never ship code.

```sql
create table policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,                    -- null = platform/industry/domain default policy
  domain text not null,
  scope_kind text not null,          -- platform|industry|domain|tenant
  name text not null,
  rules jsonb not null,              -- [{when:<condition-tree>, then:<effects>}], ordered
  priority int not null default 100, -- evaluation order across policies
  version_id uuid not null references config_versions(id),
  created_at timestamptz not null default now()
);
```

**Evaluation** = deterministic, ordered, first-/all-match per effect, producing a
**decision** plus a full explanation. Every evaluation writes:

```sql
create table decision_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  object_id uuid not null,
  object_snapshot jsonb not null,        -- inputs AS THEY WERE (replayability)
  effective_profile_hash text not null,
  policy_version_ids uuid[] not null,
  matched_rules jsonb not null,          -- which rules fired + why
  outputs jsonb not null,                -- owner, priority, deadline, route, ...
  input_hash text not null,              -- hash(object_snapshot + profile_hash + policy_versions)
  evaluated_at timestamptz not null default now()
);
```

This one table is the backbone of Parts 7, 8 and 12.

### 6.2 Confidence routing (Part 7) is a policy *output*, not a separate system

Routing level is computed from `(confidence, ambiguity, risk, reversibility)`
against thresholds in the **effective profile** (`namespace='confidence'` /
`risk_appetite`). The router emits `review_route ∈ {auto, openfolk,
tenant_senior, manual}` and, when human review is required, creates a
`review_tasks` row. A **hard gate** at the publish/projection boundary enforces
"nothing low-confidence reaches customers" — enforced by the engine uniformly,
tuned by profile data.

```sql
create table review_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  object_id uuid not null references intelligence_objects(id),
  route text not null,               -- openfolk | tenant_senior | manual
  reason text, decision_id uuid,
  status text not null default 'pending',  -- pending|claimed|resolved|dismissed
  resolved_by text, resolution jsonb, resolved_at timestamptz,
  created_at timestamptz not null default now()
);
```

### 6.3 Update — routing is now the Universal Decision Engine (v1, implemented)

The design above (routing as a policy output) has been realised and **elevated
into one deterministic authority**: the Universal Decision Engine. The earlier
`review_route` was split between `policy.ts` and the observe handler; that scatter
is gone. `evaluateDecision()` now consumes a fully-resolved input and returns one
immutable **Decision Package** — the single downstream authority for *every*
routing choice — evaluating five independent axes (confidence, authority, risk,
reversibility, impact) through one data-driven precedence. Confidence routing
remains a policy/profile output; it is simply now one axis inside the engine
rather than a standalone concept. Persistence extends `decision_log` (no parallel
audit table); the review queue gains the `customer`/`escalate` routes. Handlers
persist and execute; they no longer decide. Full detail:
[UNIVERSAL_DECISION_ENGINE.md](UNIVERSAL_DECISION_ENGINE.md).

Between the DecisionPackage and execution sits a second pure engine — the
**Operational Modes Engine** — which decides *how much autonomy* the platform
currently has for a tenant (discovery → recommendation → assisted → trusted →
optimisation). It only constrains execution, never the decision; mode behaviour is
data-driven; the mode lives in the Tenant Operating Profile and defaults to
discovery; and promotion is recommended, never automatic. See §2b of the Decision
Engine doc.

Above all of this sits the **Objectives & Outcomes Engine** — the strategic layer
that asks *what is the business trying to achieve, and did our decisions move it
closer?* It adds dedicated (versioned) objective and measurement tables, a
universal link table, pure Objective-Health and Contribution evaluators, and a
descriptive `objectiveContext` on the DecisionPackage. It never executes, routes or
decides, and objective context can never bypass authority, risk, policy or
Operational Mode. See [UNIVERSAL_OBJECTIVES_ENGINE.md](UNIVERSAL_OBJECTIVES_ENGINE.md).

---

## 7. Learning Model (Part 8)

Every human correction is an **immutable fact**; the *learned adjustment* is a
separate, versioned config change that flows through the normal lifecycle
(draft → simulation → review → publish). Corrections are never applied silently.

```sql
create table corrections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  object_id uuid, decision_id uuid,     -- what was corrected
  before jsonb not null, after jsonb not null,
  correction_kind text not null,        -- engine_mistake | tenant_preference | industry_preference | new_pattern
  scope_hint text,                       -- which layer a resulting adjustment should target
  actor text not null, review_level text,
  created_at timestamptz not null default now()
);
```

- `engine_mistake` → a bug/rule fix proposal (platform layer).
- `tenant_preference` → a proposed override at the tenant layer.
- `industry_preference` → aggregated across tenants at the **control plane**
  (privacy-guarded; no PII crosses tenants), proposed to the industry template
  layer.
- `new_pattern` → a candidate new rule/extractor for review.

The correction never overwrites; it *proposes* a versioned delta a human
publishes. This is what makes learning auditable and reversible.

---

## 8. OpenFolk Control Plane (Part 9)

Provider operations, not customer operations. ▲ Modeled as an explicit
**provider scope** distinct from tenant scope:

- A provider principal (an OpenFolk operator) gets cross-tenant read on
  control-plane tables via a `is_openfolk()` RLS predicate (mirrors the existing
  `current_user_role()` helper pattern) — tenants can **never** see the control
  plane.
- The control plane *operates on the same tables* (profiles, policies, packs,
  flags, review/learning queues, versions) through elevated scope; it does not
  touch operational rows (jobs, interactions).
- Feature flags, pack enablement (the `TODO(openfolk)` in `useModules`) and
  policy publication all live here as versioned config.

```sql
create table feature_flags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,                    -- null = global default
  flag text not null, value jsonb not null,
  version_id uuid not null references config_versions(id)
);
```

---

## 9. Automation Readiness (Part 10) — events, no automations

▲ RECOMMENDATION F — harden `platform_events` incrementally into an outbox +
dispatcher, but **do not build automations now**. Every object create /
state-transition / decision **publishes a typed event**; automations/agents are
future subscribers.

Deltas to the existing envelope (which lacks `actor`, `occurred_at`, `domain`):

```sql
alter table platform_events add column actor jsonb;
alter table platform_events add column occurred_at timestamptz;   -- real event time
alter table platform_events add column domain text;
alter table platform_events add column correlation_id uuid;       -- trace a causal chain
-- Outbox: write the event in the SAME tx as the state change (a DB function or
--         trigger), replacing today's best-effort separate insert.
-- Dispatcher: a platform_jobs handler ('events.dispatch') fans pending events to
--             subscribers registered in a `subscriptions` table.
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,                    -- null = platform subscriber
  event_type text not null, handler_job_type text not null,
  enabled boolean not null default true,
  version_id uuid references config_versions(id)
);
```

New automation = a `WORKER_HANDLERS` entry + a `subscriptions` row. No engine
change. That is the extension point.

---

## 10. Versioning (Part 11) & Simulation (Part 12)

### 10.1 ▲ RECOMMENDATION D — one lifecycle, shared spine

Every configurable artifact (profile entries, policies, packs, ownership rules,
AI behaviour, flags) references a single `config_versions` row:

```sql
create table config_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,                    -- null = platform/industry
  artifact_kind text not null,       -- operating_profile | policy | domain_pack | subscription | feature_flag
  artifact_key text not null,
  version int not null,
  status text not null,              -- draft | simulation | review | published | archived
  supersedes uuid references config_versions(id),
  author text not null, note text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (artifact_kind, artifact_key, version)
);
-- exactly one published version per artifact:
create unique index config_versions_published_uk
  on config_versions (artifact_kind, artifact_key)
  where status = 'published';
```

Lifecycle: **Draft → Simulation → Review → Publish → (Rollback = republish a
prior version) → Audit (the append-only trail is the whole table).** One
mechanism, not five bespoke ones.

### 10.2 Simulation foundation (Part 12) — replay, no UI

Because (a) policy evaluation is pure, (b) every decision is logged with its
inputs + versions (`decision_log`), and (c) histories are append-only,
"**if this rule had existed for the last 30 days…**" is:

```
take decision_log rows (or the objects) in window W
  → re-evaluate each against candidate policy/profile version V
    → diff new outputs vs recorded outputs
      → report deltas (owner changes, routing changes, would-have-escalated, ...)
```

No new engine — the *same* pure evaluator over historical inputs. The design
requirement this imposes (and why purity/immutability above are non-negotiable):
the evaluator must never read "now" except via an injected clock, and must never
do I/O during evaluation.

---

## 11. Domain Packs (Part 5)

A pack is **data + generic extractors**, never tenant/industry code:

```sql
create table domain_packs (
  id text primary key,               -- 'serviceos' | 'productos'
  display_name text not null,
  version_id uuid references config_versions(id)
);
create table domain_object_types (   -- extends the 22 core types
  domain text not null, object_type text not null,
  attributes_schema jsonb not null,  -- JSON Schema validating intelligence_objects.attributes
  primary key (domain, object_type)
);
create table domain_entity_types (   -- graph node_types the pack introduces
  domain text not null, node_type text not null,
  properties_schema jsonb not null,
  primary key (domain, node_type)
);
create table domain_terminology (    -- Business terminology per Part 1
  domain text not null, tenant_id uuid, term_key text not null, label text not null,
  primary key (domain, coalesce(tenant_id,'0'::uuid), term_key)
);
```

- **ServiceOS** registers entity types Job, Visit, Engineer, Asset, Site, Part,
  Appointment, Compliance, Maintenance — as `node_type`s in the graph with
  JSON-Schema'd properties. Object types add e.g. `VisitBlocker`,
  `ComplianceIssue` sub-states.
- **ProductOS** registers Product, SKU, Stock, Supplier, PurchaseOrder,
  Manufacturing, Fulfilment, Return, Quality, Inventory the same way.
- Neither duplicates core logic; both feed the *same* `intelligence_objects` +
  `graph_nodes`.

**Strong-integrity exception:** where a domain genuinely needs relational
integrity (e.g. purchase-order financials), a pack may register a dedicated
system-of-record table that **projects into** the graph (exactly as
`people`/`companies` do today). Still config-registered; still no `if industry==`.

---

## 12. Migration plan (deliverable 8)

Phased, each phase independently shippable and reversible. **No phase rewrites
published git history; every push leaves the branch working** (per CLAUDE.md /
Lovable).

| Phase | Delivers | Risk | Reversible? |
|---|---|---|---|
| **P0 Backbone** | `tenants`, `config_versions`, RLS helpers `is_openfolk()`, `set_updated_at` triggers | low | drop tables |
| **P1 Profile** | `operating_profile_entries`, `org_units`, `effective_profiles` + resolver (pure fn) | low | additive |
| **P2 Objects** | `intelligence_objects` + `domain_object_types`; back-compat `recommendations` **view**; seed 22 core types | med (dual-write) | view keeps readers green |
| **P3 Ownership+State** | `ownership_assignments`, `state_*`, `object_state_history` | low | additive |
| **P4 Policy+Routing** | `policies`, `decision_log`, `review_tasks`; pure evaluator; wire as interceptor at the two recommendation producers | **high** (behaviour) | feature-flag off → engines write as before |
| **P5 Learning** | `corrections`; correction→versioned-delta flow | low | additive |
| **P6 Packs** | `domain_packs`, `domain_entity_types`, `domain_terminology`; move `useModules` enablement to DB | med | keep TS registry as fallback |
| **P7 Events** | envelope columns, outbox fn, `subscriptions`, `events.dispatch` handler | med | dispatcher behind flag |
| **P8 Control plane** | provider RLS scope, `feature_flags`, review/learning queues surfaced to OpenFolk | low | additive |

**`recommendations` cutover (P2→P4):** add `intelligence_objects`; make
`recommendations` a **view** over it (or dual-write behind a flag); retarget
`recommendation.sync` and `identity.resolve` to emit objects *through the policy
engine*; verify the customer_card projection still reads the same shape; then
retire the old writes. The two producers and the card reader stay green
throughout.

---

## 13. Acceptance criteria (deliverable 9)

1. **Two domains, one core:** the identical object lifecycle runs for a ServiceOS
   "Job blocker" and a ProductOS "Stock issue" using **only** pack + policy +
   profile data — zero engine code differences.
2. **No industry/tenant branching:** conformance check (grep + import test) finds
   no `tenant ==`, no industry literal, no tenant-id literal in `core` engine
   modules; packs import core, never the reverse.
3. **Everything versioned:** every profile/policy/pack change produces a
   `config_versions` row; exactly one `published` per artifact; rollback works.
4. **Everything auditable & tenant-scoped:** RLS denies cross-tenant reads;
   control-plane tables invisible to tenants; every decision/state-change/
   correction is append-only and attributable.
5. **Ownership always resolves:** every object yields a Responsible + Accountable
   (or an explicit `unknown` with a review task) via policy, across all 10 party
   kinds.
6. **Confidence gate holds:** no object below the profile's customer-facing
   threshold is ever projected to a customer surface; low-confidence routes to
   OpenFolk.
7. **Learning never overwrites:** a correction creates an immutable fact + a
   *proposed* versioned delta; nothing auto-mutates published config.
8. **Simulation replay works:** re-evaluating a 30-day `decision_log` window
   against a candidate policy version yields a deterministic diff, with no writes
   to operational tables.
9. **Events published:** every object create/transition/decision emits a typed
   `platform_events` row with `actor`, `occurred_at`, `domain`, `correlation_id`.
10. **Existing engines subsumed:** `recommendations` is a view/projection of
    `intelligence_objects`; no second intelligence engine exists.

---

## 14. Implementation order (deliverable 10) — thin slice first

▲ Do **not** build all 22 types × 10 party kinds × full sim/learning at once.
Prove the spine with one vertical slice, then widen.

1. **P0 + P1** backbone + profile resolver (no behaviour change).
2. **Vertical slice:** one object type end-to-end — recommend **`Commitment`**
   (or `MissingInformation`) on ServiceOS — through extractor → object → policy →
   ownership → routing → event → correction. This exercises every mechanism once.
3. **Prove the second domain:** run the *same* slice for a ProductOS
   `Stock issue` using only pack/policy data (acceptance #1).
4. **Widen object types** (seed the rest of the 22) once the slice is green.
5. **P5 learning**, then **P7 events hardening**, then **P8 control plane**.
6. Simulation replay (P4 artifacts make it nearly free) last.

Rationale: the risk is in the *mechanisms* (policy purity, versioning, routing,
ownership resolution), not in the *count* of types. One proven slice de-risks the
whole foundation; breadth is then mechanical.

---

## 15. Quality gate (deliverable 13)

Because this phase is architecture, the gate is **conformance**, enforced as
automated checks before any merge:

- **G1 No-branching lint:** CI grep bans `tenant ==`, `tenantId ===` literals,
  industry string comparisons, and hard-coded tenant uuids in `core` engine
  paths.
- **G2 Dependency direction test:** an import test asserts `core` imports no
  `domain-pack` module; packs may import `core`.
- **G3 Two-domain test:** the vertical slice passes for both ServiceOS and
  ProductOS from config only (acceptance #1).
- **G4 Purity test:** the policy evaluator, given identical inputs + injected
  clock, is deterministic and performs no I/O (fake the client; assert no calls).
- **G5 Versioning invariant:** DB constraint test — at most one `published`
  version per artifact; rollback restores prior published pointer.
- **G6 RLS test:** cross-tenant read denied; control-plane invisible to tenants.
- **G7 Existing gate:** `tsc --noEmit`, `eslint`, `vite build` stay green;
  `recommendations` consumers unaffected through the cutover.

---

## 16. Tradeoffs — every major decision (deliverable 14)

| Decision | Chosen | Alternative | Why chosen / cost accepted |
|---|---|---|---|
| Build vs refactor | **Refactor** onto existing graph/interactions/recommendations | Greenfield engine | Greenfield creates a 2nd engine → violates the core principle. Cost: careful `recommendations` cutover. |
| Object storage | **One table + jsonb attributes + JSON Schema** | 22 tables / EAV | One language, uniform policy/ownership; proven by `graph_nodes`. Cost: weaker column constraints → mitigated by JSON Schema + generated columns + typed views. |
| Entities | **Reuse universal `graph_nodes`/`edges`**; pack registers node_types; SoR tables only where integrity demands | Dedicated tables per entity type | Same core for both OS. Cost: query ergonomics → typed views; reporting → materialized projections. |
| Ownership | **Polymorphic RACI edges + hot cache** | Flat owner columns (brief Part 2) | Supports multi-consulted/informed + 10 party kinds + late-bound roles. Cost: a join for full RACI → cache covers hot path. |
| States | **Universal states + data-driven transitions + history** | Per-domain state code | No service-specific states in core; packs own machines as data. Cost: an extra transitions table. |
| Policy | **Declarative decision tables, pure eval, decision_log** | Embedded imperative rules | Enables simulation + audit + learning; safe. Cost: less raw expressiveness → named-predicate escape hatch. |
| Confidence routing | **A policy output** | Separate routing subsystem | One evaluation path; profile-tuned thresholds. Cost: none material. |
| Learning | **Immutable corrections → proposed versioned deltas** | Auto-tune published config | Auditable, reversible, no silent drift. Cost: a human publish step (intended). |
| Versioning | **One `config_versions` lifecycle** | Bespoke per artifact | Uniform draft/sim/review/publish/rollback. Cost: a generic table + per-artifact fk. |
| Profile | **Layered resolution → effective snapshot** | One tenant blob | Structurally guarantees "industry = data". Cost: a resolver + snapshot cache. |
| Events | **Harden `platform_events` to outbox+dispatcher, later** | New event bus / keep best-effort | Reuse proven log; reliability when automations arrive. Cost: outbox tx work, deferred. |
| Scope | **Thin vertical slice first** | Full breadth up front | De-risks mechanisms before volume. Cost: fewer types initially (intended). |

---

## 17. Open decisions for you (before implementation)

1. **Entity strategy:** universal graph + pack-registered node_types (recommended)
   vs dedicated per-entity tables. This is the single biggest fork.
2. **`recommendations` cutover:** new table + back-compat view + dual-write
   (recommended) vs in-place generalization.
3. **First slice scope:** one object type × two domains end-to-end (recommended)
   vs land the full schema breadth first.
4. **Event hardening timing:** defer outbox/dispatcher to P7 (recommended) vs
   build it into the backbone now.
