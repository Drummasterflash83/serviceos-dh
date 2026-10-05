> **SUPERSEDED — archived for historical reference.**
> This document is no longer maintained and may contain claims that were
> true only at the time of writing. Its subject is now owned by
> [Interactions, Identity, Cards & Recommendations](../reference/INTERACTIONS_IDENTITY_CARDS.md).
> Start at the [documentation index](../README.md). Kept to preserve the
> architectural evolution and decision history.

---

# ServiceOS — Customer Card Engine

**Status:** v1 landed — projection engine + explainable health/activity + the
three read surfaces (Customer page, My Day, Operations Centre).

**Last updated:** 2026-07-09

---

## What a Customer Card is

A Customer Card is an **operational surface**, not a CRM record. It answers, at a
glance:

- **Who are they?** — identity (name, company, contacts)
- **What is happening?** — communication (last contact, count, trend, channels)
- **What needs doing next?** — operations (urgent / waiting actions, blockers)
- **What is at risk?** — business (health, sentiment, response time)
- **What should we do?** — recommendations + activity signal

Crucially: **Customer Cards are NOT the source of truth. They are projections of
the Business Graph.** The card stores only _calculated summaries_ — never
duplicated source rows — inside `customer_cards.context.projection`. Ownership of
the underlying facts stays in the graph and its source tables.

## The flow

```
Business Graph            ← canonical memory (nodes / edges / events)
      │
      ▼
customer-card-sync        ← PROJECTION ENGINE (this doc)
  reads: graph edges, interactions, recommendations, people, companies
  writes: customer_cards.context.projection  (calculated summaries only)
      │
      ▼
Customer Card             ← one operational projection per customer
      │
      ├──► My Day            (customers needing attention, critical, waiting)
      ├──► Customer page     (read-only operational card)
      ├──► Operations Centre (customer-health summary + Build override)
      ├──► Live Call popup    (future — same projection)
      └──► Recommendations    (surfaced from the projection)
```

Everything downstream reads the **same** projection — one calculation, many
surfaces. The graph never waits on cards; cards _subscribe_ to it (a best-effort
trigger from identity + the reliable `customer-card-scheduled-sync` cron).

## The projection (`customer_cards.context.projection`)

```jsonc
{
  "version": 1,
  "generated_at": "…",
  "identity":      { "display_name", "company_name", "primary_contact", "emails": [], "phones": [] },
  "communication": { "last_interaction_at", "interaction_count", "trend": "up|flat|down", "channels": [] },
  "operations":    { "open_recommendations", "urgent": [], "waiting": [], "blockers": [] },
  "business":      { "confidence", "health", "health_reasons": [], "sentiment",
                     "avg_response_hours", "activity_score", "activity_inputs", "relationship_count" },
  "timeline":      [ { "at", "kind", "label" } ]      // human-readable, never source content
}
```

Manually-confirmed fields (`customer_cards.locked_fields`) are **never**
overwritten by the engine.

## Health Engine (explainable)

`computeHealth()` ([`_shared/customer_card.ts`](../supabase/functions/_shared/customer_card.ts))
returns one of **excellent · good · attention · critical** plus a `reasons[]`
list so the UI can show _why_. First matching tier wins:

| Tier        | When                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `critical`  | any urgent recommendation, OR an overdue action, OR (negative sentiment AND an unanswered inbound) |
| `attention` | any open recommendation, unanswered inbound, waiting action, or negative sentiment                 |
| `good`      | nothing outstanding                                                                                |

(`excellent` is reserved for a demonstrably healthy, active relationship; v1 maps
clean cards to `good`.) Health also maps to the existing traffic-light
`customer_cards.status` (green / amber / red) unless `status` is locked.

## Activity Score (0–100, never random)

`computeActivityScore()` is deterministic and returns its contribution breakdown
in `activity_inputs`:

| Signal                             | Contribution                                       |
| ---------------------------------- | -------------------------------------------------- |
| Recency of last interaction        | ≤1d **30** · ≤7d **20** · ≤30d **10**              |
| Volume                             | `min(20, 2 × interactions)`                        |
| Velocity (last 7d vs prior 7d)     | accelerating **15** · steady **8** · slowing **3** |
| Responsiveness (avg inbound→reply) | ≤4h **20** · ≤24h **12** · ≤72h **6**              |
| Engagement (open recommendations)  | `min(10, 3 × open recs)`                           |

Sum, clamped 0–100.

## Timeline

`humanizeInteraction()` turns graph/interaction facts into short human lines
("Phone call received", "Email sent", "Recommendation: …") — **projection only,
never transcript/audio content**. Source remains the graph.

## Evidence & honesty

- Nothing is fabricated: every number is derived from real interactions /
  recommendations / graph edges, and scores carry their inputs.
- Empty is honest: an un-projected card reads "Projection pending"; an
  unreadable table reads "unavailable" — never a fake zero.
- The projection run is a `platform_jobs` row (`customer_card.sync`) — observable
  and retryable.

## Security

- No service role in the frontend — the surfaces read `customer_cards` under RLS;
  all writes are the service-role `customer-card-sync` function.
- Tenant-bound throughout; no cross-tenant reads.
- No secrets and no full transcript/audio in `context` — only calculated
  summaries and short human labels.

## Why this matters

The platform now has a **reusable projection engine**. The same pattern —
read the graph, compute an explainable operational summary, store it in a
`context` projection, read it from many surfaces — makes future cards trivial:

> Engineer Card · Site Card · Asset Card · Team Card · Supplier Card

Everything becomes **projection-driven** rather than CRUD-driven.

## Verification SQL

```sql
-- how many cards have a projection
select count(*) filter (where context ? 'projection') as projected, count(*) as total
from customer_cards;

-- health distribution
select context->'projection'->'business'->>'health' as health, count(*)
from customer_cards where context ? 'projection'
group by 1 order by 1;

-- a projected card, newest first
select id, status,
       context->'projection'->'business'->>'health'         as health,
       context->'projection'->'business'->>'activity_score' as activity,
       context->'projection'->'communication'->>'interaction_count' as interactions
from customer_cards
where context ? 'projection'
order by updated_at desc
limit 20;

-- the projection job
select job_type, status, records_processed, result, created_at
from platform_jobs where job_type = 'customer_card.sync'
order by created_at desc limit 20;
```
