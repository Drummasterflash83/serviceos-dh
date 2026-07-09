# ServiceOS — Business Graph

**Status:** v1 landed — projection layer only (nodes, edges, events + one graph
sync). No graph reasoning engine and no visual canvas yet.

**Last updated:** 2026-07-09

---

## What the Business Graph is

The Business Graph is the **canonical relationship layer** — the shared memory
layer for ServiceOS, ProductOS and future OpenFolk products. Instead of every
feature re-deriving "who is this, what do we know, what's related", each reads one
graph. Everything in the business becomes a **node**, an **edge**, or an **event**.

It is deliberately a **projection** of the existing systems of record, not a
replacement. `people`, `companies`, `customer_cards`, `interactions` and
`recommendations` remain authoritative; `business-graph-sync` mirrors them into
`graph_nodes` / `graph_edges` idempotently. Nothing in the source tables is
modified. See the migration
[`20260709160000_business_graph.sql`](../supabase/migrations/20260709160000_business_graph.sql).

## The model

### Nodes (`graph_nodes`)

One node per system-of-record row, keyed by `(tenant_id, node_type, source_table,
source_id)` so re-syncing is idempotent. v1 projects these real node types:

| node_type        | source_table      | label                |
| ---------------- | ----------------- | -------------------- |
| `person`         | `people`          | name / email / phone |
| `company`        | `companies`       | name / domain        |
| `customer_card`  | `customer_cards`  | card title           |
| `interaction`    | `interactions`    | type · date          |
| `recommendation` | `recommendations` | title                |

Future connectors add `site`, `job`, `asset`, `engineer`, `document`, `quote`,
`invoice`, `order`, `product`, `automation`, `agent`, … without schema changes —
`node_type` is free text and `source_id` may be null for synthetic nodes.

### Edges (`graph_edges`)

One edge per `(tenant_id, edge_type, from_node_id, to_node_id)`. **Only real
foreign-key links become edges — never a fabricated relationship.** v1 edges:

| edge_type    | from → to                      | derived from                         | confidence |
| ------------ | ------------------------------ | ------------------------------------ | ---------- |
| `works_for`  | person → company               | `people.company_id`                  | 1.0        |
| `represents` | customer_card → person         | `customer_cards.person_id`           | 1.0        |
| `represents` | customer_card → company        | `customer_cards.company_id`          | 1.0        |
| `contacted`  | interaction → person           | `interactions.related_person_id`     | 1.0        |
| `relates_to` | interaction → company          | `interactions.related_company_id`    | 1.0        |
| `relates_to` | interaction → customer_card    | person shared with a card (inferred) | 0.9        |
| `concerns`   | recommendation → customer_card | `recommendations.card_id`            | 1.0        |

### Events (`graph_events`)

An append-only log of graph mutations — `node.created`, `node.updated`,
`edge.created`, `edge.updated`, `graph.enriched`, `graph.conflict_detected`. v1
emits **one `graph.enriched` per sync** carrying the run's counts and
`avg_confidence` (kept bounded — not one event per node). It is the seed for
future graph-driven subscribers, exactly as `platform_events` is for
`interaction.ready`.

## Evidence & confidence

- Every edge stores small, **non-secret** `evidence` (the source column + a short
  human detail) via `safeEvidence()` — never transcript/audio/PII content.
- `confidence` is honest: **1.0** for direct foreign-key edges (the link provably
  exists in the source), **< 1.0** for inferred edges (e.g. an interaction related
  to a card _via a shared person_), and **null** where genuinely unknown. The
  engine never fabricates certainty.
- `graph.enriched.payload.avg_confidence` is the mean edge confidence for the run
  — surfaced in the Operations Centre "Business Graph" card.

## How ServiceOS and ProductOS use it

- **ServiceOS** (this app): the Operations Centre reads graph health; future
  customer cards, timelines, recommendations and automations read relationships
  from the graph instead of re-joining source tables per feature.
- **ProductOS / future OpenFolk products**: share the _same_ graph as their memory
  layer, so a person/company/relationship known in one product is known in all —
  one tenant-scoped source of relational truth.

## How connectors enrich it

Every connector already follows the event-driven pattern
([EVENT_ARCHITECTURE.md](EVENT_ARCHITECTURE.md)): produce a canonical
`interaction`, mark it `ready`, publish `interaction.ready`. The Identity Engine
subscribes, resolves people/companies/cards, and then **best-effort triggers a
graph sync** (fire-and-forget — identity never depends on the graph). The
scheduled `business-graph-scheduled-sync` is the reliable backstop. So a new
connector enriches the graph for free: it just has to produce interactions.

```
connector → interaction.ready → identity-resolve → (best-effort) business-graph-sync
                                                  ↘ business-graph-scheduled-sync (cron backstop)
```

## Why it is the platform memory layer

One tenant-scoped, queryable relationship store means new capabilities become
"read the graph" rather than "re-join five tables and hope". It is additive
(source tables stay authoritative), idempotent (safe to rebuild), observable
(events + platform_jobs `graph.sync`), and honest (evidence + real confidence, no
fake links).

## Future AI / automation use

The graph is the substrate for: graph-powered customer cards and timelines,
relationship-aware recommendations ("this company has 3 open jobs and a negative
last call"), automations that traverse edges, `graph.conflict_detected` when two
sources disagree, per-node/per-edge events for granular subscribers, and — later —
a visual explorer. None of these require a migration; they read what's already
here.

## Security

- No service role in the frontend — the browser reads `graph_*` under RLS
  (tenant-scoped `SELECT` only); all writes are service-role Edge Functions.
- All writes are tenant-bound; both endpoints of an edge are written under the
  same `tenant_id` — **no cross-tenant links**.
- No secrets and no full transcript/audio in `properties` / `evidence` (raw
  email/phone are not copied into nodes — only `has_email` / `has_phone`).

## Verification SQL

```sql
select node_type, count(*) from graph_nodes group by node_type;
select edge_type, count(*) from graph_edges group by edge_type;
select event_type, count(*) from graph_events group by event_type;

select * from graph_nodes order by created_at desc limit 20;
select * from graph_edges order by created_at desc limit 20;

-- platform jobs for graph syncs
select job_type, status, records_processed, result, created_at
from platform_jobs where job_type = 'graph.sync' order by created_at desc limit 20;
```
