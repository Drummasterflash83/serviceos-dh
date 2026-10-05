# The Business Graph & Data Model

_How the platform represents everything a business is made of, and the principles
that govern how that data is stored. This is the [Knowledge](06_LEARNING_CENTRE.md)
layer's relationship substrate and the memory every [Core Loop](02_CORE_LOOP.md)
stage reads and writes._

---

## What the Business Graph is

The Business Graph is the **canonical relationship layer**: one tenant-scoped,
queryable store of who and what exists in a business and how it all connects.
Instead of every feature re-deriving "who is this, what do we know, what is
related", each capability reads one graph.

Everything in the business becomes a **node**, an **edge**, or a **graph event**.

It is deliberately a **projection** of the systems of record, not a replacement.
`people`, `companies`, `customer_cards`, `interactions` and `recommendations` remain
authoritative; `business-graph-sync` mirrors them into `graph_nodes` / `graph_edges`
idempotently, modifying nothing in the source. This is the first application of the
data-model principle that **derived data is always rebuildable and never
authoritative** (see [below](#database-principles)). Migration:
[`20260709160000_business_graph.sql`](../../supabase/migrations/20260709160000_business_graph.sql).

---

## Entities (nodes)

An **Entity** is any noun the business operates on; its row in the graph is a
**node** (`graph_nodes`), keyed by `(tenant_id, node_type, source_table, source_id)`
so re-syncing is idempotent. `node_type` is free text, so new entity types arrive
with connectors and need no schema change.

**Live today** (projected from real tables):

| Entity | node_type | Source of truth |
|---|---|---|
| Person | `person` | `people` |
| Company | `company` | `companies` |
| Customer Card | `customer_card` | `customer_cards` |
| Interaction | `interaction` | `interactions` |
| Recommendation | `recommendation` | `recommendations` |

**Arriving with future connectors** (no migration required): `site`, `job`,
`asset`, `engineer`, `document`, `quote`, `invoice`, `order`, `product`,
`supplier`, `automation`, `agent`. Each becomes a node type the moment a connector
produces the interactions or records that imply it. This is how the graph grows to
"understand everything happening inside a business" without becoming a bespoke
schema per industry.

The full entity set the platform is aiming at — People, Customers, Companies, Jobs,
Interactions, Signals (as interactions), Observations, Cards, Recommendations,
Agents, Knowledge, Workflows, Approvals, Documents, Assets — all resolve to nodes of
one graph. That is what makes them relatable to one another.

---

## Relationships (edges)

An **edge** (`graph_edges`) is one `(tenant_id, edge_type, from_node, to_node)`.
**Only real foreign-key links become edges, never a fabricated relationship.** Live
edge types:

| edge_type | from → to | derived from | confidence |
|---|---|---|---|
| `works_for` | person → company | `people.company_id` | 1.0 |
| `represents` | customer_card → person / company | `customer_cards.person_id` / `.company_id` | 1.0 |
| `contacted` | interaction → person | `interactions.related_person_id` | 1.0 |
| `relates_to` | interaction → company / card | FK, or inferred via shared person | 1.0 / 0.9 |
| `concerns` | recommendation → customer_card | `recommendations.card_id` | 1.0 |

**Confidence is honest**: `1.0` for direct foreign-key links (the relationship
provably exists), `< 1.0` for inferred links, `null` where genuinely unknown. The
graph never fabricates certainty, and it stores small, non-secret `evidence` (the
source column plus a short human detail) via `safeEvidence()`, never transcript,
audio, or PII content.

---

## Identity: how entities get resolved

Nodes only exist because **Identity resolution** first works out who and what an
interaction is about. When an interaction becomes `ready`, the Identity engine
(`resolveIdentity` / `identity-resolve`) reads its evidence (phone, email, name,
and later site/job/asset), resolves or provisionally creates the person and company,
and links the interaction to them. It is an **evidence engine, not CRM matching**:
every resolution carries its evidence and a [canonical confidence
level](00_GLOSSARY.md#terms-that-collide-resolved-here-once)
(`unknown · possible · likely · confirmed · rejected`), and every decision is
reversible. Full mechanics, and the resolution of which engine owns card and
recommendation writes, are in
[reference/INTERACTIONS_IDENTITY_CARDS](../reference/INTERACTIONS_IDENTITY_CARDS.md).

Identity is what turns a stream of anonymous events into a graph of known entities,
so it is the bridge between [Core Loop](02_CORE_LOOP.md) stage 1 (Interaction) and
stage 3 (Card).

---

## Graph events

`graph_events` is an append-only log of graph mutations (`node.created`,
`node.updated`, `edge.created`, `graph.enriched`, `graph.conflict_detected`). v1
emits one bounded `graph.enriched` per sync carrying the run's counts and
`avg_confidence`. These are **graph events, distinct from the platform events**
(`interaction.ready`) that drive the [event bus](../reference/EVENT_ARCHITECTURE.md),
and distinct again from `live_call_events`. The [glossary](00_GLOSSARY.md#terms-that-collide-resolved-here-once)
holds that three-way distinction; keep it.

`graph.conflict_detected` is the seed of a future capability: when two sources
disagree about a relationship, the graph records the conflict rather than silently
picking a winner, feeding it to [Knowledge](06_LEARNING_CENTRE.md) and human review.

---

## Why the graph is the memory layer

One tenant-scoped, queryable relationship store means new capability is "read the
graph", not "re-join five tables and hope". It is additive (source tables stay
authoritative), idempotent (safe to rebuild), observable (graph events plus
`platform_jobs` of type `graph.sync`), and honest (real evidence and confidence, no
fake links). It is the shared memory for ServiceOS, ProductOS, and every future
OpenFolk product: a person, company, or relationship known in one is known in all,
without any cross-tenant leakage.

The graph is the substrate for relationship-aware intelligence: cards and timelines
read it, recommendations reason over it ("this company has three open jobs and a
negative last call"), and future automations traverse it. None of those require a
migration; they read what is already there.

---

## <a id="database-principles"></a>Database principles

The graph is the clearest instance of a set of rules that govern **all** ServiceOS
data. State them once here; they apply everywhere.

**1. Canonical entities are authoritative and minimal.** Each real-world thing has
exactly one system-of-record table (`people`, `companies`, `interactions`,
`customer_cards`, `objectives`, …). No concept has two owners. When two engines
appear to write the same table, that ownership is resolved explicitly, never left
ambiguous.

**2. Derived data is rebuildable and never authoritative.** Read models —
`graph_nodes/edges`, `customer_cards.context.projection`, `objective_health`
snapshots — are projections of canonical data. They can be dropped and rebuilt from
source at any time. Nothing downstream may treat a projection as truth.

**3. Read models and write models are separated.** Writes happen only through
service-role Edge Functions with validation, idempotency, and audit; the browser
never mutates tables directly. Reads happen through tenant-scoped `SELECT` under
RLS, often against purpose-built projections and read views. This CQRS-like split is
what keeps the write path safe and the read path fast.

**4. History is append-only and immutable.** The platform keeps several distinct
histories, and none of them are ever updated in place, only appended and superseded:

| History | Table(s) | What it records |
|---|---|---|
| Event history | `platform_events` | Every domain event (`interaction.ready`, …) |
| Graph history | `graph_events` | Every relationship mutation |
| Decision history | `decision_log` | Every ruling, with `supersedes` |
| Execution/audit history | `automation_execution_attempts`, `audit_logs` | Every action attempt |
| Outcome history | `outcomes` | Every result, three layers |
| Objective/learning history | `objective_health`, `measurements` | Every health snapshot and measurement |
| Agent history | agent run/health records | Every agent action and health change (see [05_AGENTS](05_AGENTS.md)) |
| Config history | config/policy versions | Every governed change (`draft → … → archived`) |

Append-only history is what makes the platform **replayable, auditable, and
recoverable** — the [backend principles](08_BACKEND_PRINCIPLES.md) that everything
else depends on.

**5. Everything is `tenant_id`-scoped, always.** Every table carries `tenant_id`;
RLS enforces tenant isolation on reads; both endpoints of a graph edge are written
under the same tenant, so there are **no cross-tenant links**. Tenant isolation is a
data-model invariant, not an application-layer courtesy.

**6. Confidence and evidence travel with the data.** Wherever the system asserts
something it did not directly observe (an inferred edge, a resolved identity, an
objective's health), it stores the confidence and the evidence beside the assertion.
Data the system cannot justify, it does not get to act on.

---

## Verification

```sql
select node_type, count(*) from graph_nodes group by node_type;
select edge_type, count(*) from graph_edges group by edge_type;
select event_type, count(*) from graph_events group by event_type;
select job_type, status, records_processed, created_at
  from platform_jobs where job_type = 'graph.sync' order by created_at desc limit 20;
```

See [operations/OBSERVABILITY_HEALTH](../operations/OBSERVABILITY_HEALTH.md) for how
graph freshness is monitored.
