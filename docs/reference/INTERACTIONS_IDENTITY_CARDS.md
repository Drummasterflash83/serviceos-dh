# Interactions, Identity, Cards & Recommendations

_The deterministic v1 projection stack: how a raw Signal becomes an
identity-resolved, card-projected, recommendation-bearing subject. This is the
tie-broken, code-grounded merge of four earlier specs (Signal Processing,
Identity Engine, Customer Card Engine, Recommendation Engine). Where those specs
disagreed, this document states the one canonical answer, matched to the code._

Vocabulary follows [../architecture/00_GLOSSARY.md](../architecture/00_GLOSSARY.md).
This stack maps onto three stages of [../architecture/02_CORE_LOOP.md](../architecture/02_CORE_LOOP.md):
**Signal to Interaction** (stage 1), **Observation to Card** (stage 3), and
**Card to Recommendation** (stage 4), with **Identity** as the connective tissue
that resolves who and what each interaction is about.

The **Observation stage proper** — the eligible, scored, explainable unit of
understanding produced by `intelligence.observe` — lives in
[./INTELLIGENCE_INGEST_BRIDGE.md](./INTELLIGENCE_INGEST_BRIDGE.md). This document
describes the **deterministic v1 projection stack that runs alongside it**: no
AI, evidence-only, rule-based, every number carrying its inputs.

---

## The one pipeline

```
Signal ──▶ interactions ──▶ [Identity: resolveIdentity] ──▶ people / companies
 (raw)      (canonical)          who? what company?             (graph entities)
                                        │
                                        ▼
                        customer_cards  (a PROJECTION, not a system of record)
                          ├─ identity-resolve       seeds identity + priority score
                          └─ customer-card-sync      owns context.projection + health/activity
                                        │
                                        ▼
                        recommendations  (recommendation.sync owns the rule set)
                                        │
                                        ▼
                        My Day · Customer page · Operations Centre
```

Cards read from the **Business Graph** as their memory — see
[../architecture/03_BUSINESS_GRAPH.md](../architecture/03_BUSINESS_GRAPH.md). A
card holds only calculated summaries; it is **rebuildable at any time** from the
graph plus `interactions`. Delete every card and re-run the sync jobs and the
same cards return. They are projections, not the system of record.

---

## Stage 1 — Signal to Interaction

A **Signal** is one raw thing that happened (a call, an email, a webhook, a job
update). Its canonical, channel-neutral record is one row in **`interactions`**,
written idempotently by a connector's sync job. Phone and email are the two live
implementations; Slack, forms, WhatsApp and a job system add projectors into the
same table without changing anything downstream.

Each interaction carries the customer-side identifiers the resolver keys on
(`from_address`, `to_addresses`, `phone_from`, `phone_to`, `from_name`,
`direction`), the link columns it will later fill (`related_person_id`,
`related_company_id`, `related_job_id`, `related_task_id`), a `sentiment`, and a
lifecycle field.

### Interaction status (canonical)

`processing_status` moves **`pending` to `ready` to `enriched`**.

- **`pending`** — captured, not yet fully processed at source.
- **`ready`** — processed at source (transcribed, extracted), eligible for identity resolution.
- **`enriched`** — identity resolved, linked, and projected onto a card.

**`analysed` is a retired synonym for `ready`** — do not introduce it. The
identity job consumes rows in `("pending", "ready")` and sets `enriched`.

---

## Identity — the connective tissue

**The one question:** "Who and what is this interaction about?" Code:
[../../supabase/functions/_shared/identity.ts](../../supabase/functions/_shared/identity.ts)
(`resolveIdentity`). It is an **evidence engine, not CRM matching**: it never
fabricates certainty, never silently merges weak matches, and every conclusion
is explainable and reversible.

### Evidence model (v1, deterministic)

`resolveIdentity` is read-only. It resolves a person and a company candidate
against the tenant's existing rows using **exact evidence only**:

| Evidence | Candidate | Score | Confidence |
|---|---|---|---|
| Exact email vs `people.primary_email` | person | 0.95 | `confirmed` |
| Exact phone vs `people.primary_phone` | person | 0.92 | `confirmed` |
| Company inherited from matched person | company | 0.90 | `confirmed` |
| Email domain matches `companies.domain` (free-mail excluded) | company | 0.85 | `likely` |
| Business domain, no company row yet | company | 0.40 | `possible` |
| Prior interactions, no person row | person | 0.40 | `possible` |
| Nothing | person | 0 | `unknown` |

`site`, `job` and `asset` candidates are structural placeholders — always
`unknown` in v1 — the Commusoft-ready slots a job system fills later without an
engine change. Person-name is a label only, never a match on its own. Free-mail
domains (`gmail.com`, `outlook.com`, …) never create a company.

### Confidence enum (canonical)

Lowercase, five levels: **`unknown · possible · likely · confirmed · rejected`**.
Older docs used uppercase and `unmatched`; those are the same enum, normalised to
this. In code the TypeScript `Confidence` type is upper-case
(`UNKNOWN|POSSIBLE|LIKELY|CONFIRMED|REJECTED`) and `matchLevelOf()` maps it to the
lowercase value **persisted** in `interaction_match_suggestions.match_level` and
everywhere else. Treat lowercase as canonical; the upper-case identifiers are an
internal enum detail.

`confirmed` means strong exact evidence **or** an explicit human action — never
weak or AI inference. A `rejected` match is never re-suggested unless **new**
evidence appears.

### Evidence storage

Every concrete existing-match candidate is written to
**`interaction_match_suggestions`** with `{ evidence[], confidence, explanation,
recommended_action }`, `match_level`, `status = 'pending'`,
`created_by = 'system'`, keyed uniquely on
`(tenant_id, interaction_id, target_type, target_id)` so re-running never
duplicates. This is the v1 stack's weaker analogue of an Observation: an
evidence-led link proposal, resolved by a human or a strong-evidence auto-linker.

---

## The job: `identity.resolve`

Runs as an observable, retryable `platform_jobs` row (`job_type =
'identity.resolve'`), triggered by the `identity-resolve` edge function or the
`platform-worker` (both call the one shared handler
[`_shared/worker_handlers/identity_resolve.ts`](../../supabase/functions/_shared/worker_handlers/identity_resolve.ts)),
and scheduled by `identity-scheduled-sync` (secret `IDENTITY_SYNC_SECRET`).

It reads pending/ready interactions **oldest-first** (starvation-free: a
newest-first window permanently strands a historical backfill tail), and for each:

1. Resolves identity via `resolveIdentity`.
2. Writes explainable **suggestions** for concrete existing matches.
3. **Provisionally creates** the person and/or company from real email/phone/
   domain evidence — `verified = false`, `created_source = 'interaction'`,
   reversible. Free-mail domains never create a company.
4. **Links** the interaction (`related_person_id`, `related_company_id`) and marks
   it **`enriched`**.
5. **Seeds and scores the customer card** (see ownership below).
6. **Seeds** up to two recommendations (see ownership below).
7. Marks the `interaction.ready` event consumed and best-effort triggers a
   Business Graph sync (identity does not depend on the graph — fire-and-forget).

Each interaction is failure-isolated: one bad row never aborts the batch.

---

## Stage 3 — Observation to Card

A **Customer Card** (`customer_cards`, unqualified "Card") is an **operational
surface**, one per customer, that gathers everything known about one subject:
who they are, what is happening, what needs doing, what is at risk, what to do
next. It is a **projection of the Business Graph**, storing only calculated
summaries in `customer_cards.context.projection` — never duplicated source rows.

### The projection shape (`context.projection`)

```jsonc
{
  "version": 1,
  "generated_at": "…",
  "identity":      { "display_name", "company_name", "primary_contact", "emails": [], "phones": [] },
  "communication": { "last_interaction_at", "interaction_count", "trend": "up|flat|down", "channels": [] },
  "operations":    { "open_recommendations", "urgent": [], "waiting": [], "blockers": [] },
  "business":      { "confidence", "health", "health_reasons": [], "sentiment",
                     "avg_response_hours", "activity_score", "activity_inputs", "relationship_count" },
  "timeline":      [ { "at", "kind", "label" } ]   // human-readable, never source content
}
```

### CANONICAL RESOLUTION 1 — who owns card writes

Both engines write to `customer_cards`; they own **different fields**, and both
respect `locked_fields` (manually-confirmed data is never overwritten).

**`identity.resolve` owns the identity seed and the priority score.** It upserts
the card row (creating it if the person has none), seeds the FK/identity fields
(`person_id`, `company_id`, `title`, `confidence`, `latest_activity_at`), and
writes the **priority** columns: `priority` (bucket), `priority_score`, and
`priority_inputs`. It does **not** compute `context.projection`.

**`customer_card.sync` owns the computed projection.** It reads the graph,
interactions and recommendations and writes `context.projection` (the whole blob
above, including `health`, `activity_score` and `activity_inputs`), plus the
traffic-light `status` (from health) and `latest_activity_at`. It does **not**
touch `priority`/`priority_score`.

So: identity resolves and seeds identity + priority; customer-card-sync owns the
projection and health/activity. Earlier docs that claimed either engine owned
"the card" were each describing half the division.

The `priority_score`, `priority_inputs` and `locked_fields` columns are added by
migration `20260709140000_identity_engine.sql` (the base
`customer_cards`/`people`/`companies`/`interaction_match_suggestions` tables come
from `20260709120000_customer_cards_foundation.sql`). Note `activity_inputs`
lives **inside** `context.projection.business` (JSON), whereas `priority_inputs`
is a **top-level column**.

### The projection job: `customer_card.sync`

Runs as a `platform_jobs` row (`job_type = 'customer_card.sync'`) via the
`customer-card-sync` edge function or the worker (shared handler
[`_shared/worker_handlers/customer_card_sync.ts`](../../supabase/functions/_shared/worker_handlers/customer_card_sync.ts)),
scheduled reliably by `customer-card-scheduled-sync`. Identity fires it
best-effort; the cron guarantees it. Pure calculators live in
[../../supabase/functions/_shared/customer_card.ts](../../supabase/functions/_shared/customer_card.ts).

### Health Engine (explainable)

`computeHealth()` returns one of **`excellent · good · attention · critical`**
plus `reasons[]`. First matching tier wins:

| Tier | When |
|---|---|
| `critical` | any urgent recommendation, OR an overdue action, OR (negative sentiment AND an unanswered inbound) |
| `attention` | any open recommendation, unanswered inbound, waiting action, or negative sentiment |
| `good` | nothing outstanding |

`excellent` is reserved for a demonstrably healthy, active relationship; v1 maps
clean cards to `good`. Health maps to `status` via `healthToCardStatus()`
(`green`/`amber`/`red`) unless `status` is locked.

---

## CANONICAL RESOLUTION 4 — the two scores

There are **two distinct 0–100 scores** on a customer card. They measure
different things, are computed by different engines, and are stored in different
places. They are **not** the same number.

### Priority score — "what do I deal with first?"

Owner: `identity.resolve` (`computePriority` in `identity_resolve.ts`).
Written to the **`priority_score`** column, with the bucket in **`priority`** and
inputs in **`priority_inputs`**.

```
base 20
+ min(30, 5 × interaction_count)
+ open_rec_score          (+20 repeat-today rec, +5 new-contact rec)
+ 20 if negative sentiment
+ 15 if contacted again today
clamp 0–100
```

Bucket: `≥75 critical · ≥50 high · ≥25 medium · else low`.

### Activity score — "how live is this relationship?"

Owner: `customer_card.sync` (`computeActivityScore` in `customer_card.ts`).
Written inside **`context.projection.business.activity_score`**, breakdown in
**`activity_inputs`** (same JSON object).

| Signal | Contribution |
|---|---|
| Recency of last interaction | ≤1d **30** · ≤7d **20** · ≤30d **10** |
| Volume | `min(20, 2 × interactions)` |
| Velocity (last 7d vs prior 7d) | accelerating **15** · steady **8** · slowing **3** |
| Responsiveness (avg inbound→reply) | ≤4h **20** · ≤24h **12** · ≤72h **6** |
| Engagement (open recommendations) | `min(10, 3 × open recs)` |

Sum, clamped 0–100.

### Timeline

`humanizeInteraction()` turns interaction facts into short human lines ("Phone
call received", "Email sent", "Recommendation: …") — projection only, never
transcript or audio. The source stays in the graph.

---

## Stage 4 — Card to Recommendation

A **Recommendation** is a proposed next action for a human or agent, with
evidence and confidence. In the wider platform it is one `object_type` of an
Intelligence Object, not a separate system; in this deterministic v1 stack it is
a row in **`recommendations`**, generated by rules.

### CANONICAL RESOLUTION 2 — who owns recommendation generation

**`recommendation.sync` is the single canonical owner** of the recommendation
rule set. Pure rules live in
[../../supabase/functions/_shared/recommendations.ts](../../supabase/functions/_shared/recommendations.ts)
(`buildRecommendationsForCard`); the job runs as a `platform_jobs` row
(`job_type = 'recommendation.sync'`) via the `recommendation-sync` edge function
or the worker (shared handler `_shared/worker_handlers/recommendation_sync.ts`),
scheduled by `recommendation-scheduled-sync`.

`identity.resolve` seeds **at most two** recommendations at resolution time —
`repeat_contact_today` and `review_new_contact` — via its own `ensureRecommendation`
helper (insert-if-no-open-row of that type, `created_by = 'system'`). These are a
**subset seed** so a card is never empty the instant it is created. They are not a
second engine: `recommendation.sync` **owns, enriches, and auto-closes** them
thereafter. The database enforces one open recommendation of a `type` per card
(`recommendations_open_uk`), so when `recommendation.sync` re-runs it **adopts and
enriches** identity's seeded row of the same type rather than duplicating it.

### CANONICAL RESOLUTION 3 — rule identifiers

The two source docs disagreed because a recommendation row carries **two
distinct fields**: `type` (the stable machine key, unique-per-open-card) and
`source_rule` (which rule produced it). Both spellings are real — they name
different columns. Canonical set (`ENGINE_TYPES` plus each rule's `source_rule`):

| `source_rule` | `type` | Fires when | Severity |
|---|---|---|---|
| `repeated_contact_today` | `repeat_contact_today` | ≥2 interactions today | 2 → high, 3+ → critical |
| `card_health` | `customer_needs_attention` | projection health attention/critical | attention → high, critical → critical |
| `unanswered_inbound` | `respond_to_customer` | latest interaction is inbound | <4h medium · <24h high · ≥24h critical |
| `new_customer_review` | `review_new_contact` | person is unverified (auto-created) | medium |
| `negative_sentiment` | `check_unhappy_customer` | projection sentiment negative | confidence ≥0.7 critical, else high |
| `stale_card` | `card_needs_review` | ≥14d since activity AND open actions remain | medium |

So `repeat_contact_today`/`review_new_contact` are the canonical **types** and
`repeated_contact_today`/`new_customer_review` are their canonical
**`source_rule`s** — neither doc was wrong, they were naming different fields.
No job/quote/invoice rules exist yet; they arrive when that data does.

### Priority, evidence, lifecycle

`priorityForRecommendation(rule, inputs)` maps rule + inputs to
`critical`/`high`/`medium` deterministically, stored in `severity`.
`recommendationEvidence()` keeps evidence to small structured `{ source, detail }`
hints — never transcript, audio or secrets. Each run:

- **inserts** as `open`; on the unique-conflict it **enriches** the existing open row;
- **auto-closes** (`status = 'resolved'`) engine-owned rows whose rule no longer
  fires — only `created_by = 'system'` rows of an `ENGINE_TYPE`, never
  human-authored ones;
- returns `{ created, updated, closed, skipped, failed }`.

Recommendations are the **contract** a future Automation Engine consumes; nothing
in v1 sends a message or executes anything.

---

## Read surfaces

One projection, many surfaces (all read under RLS; every write is a service-role
sync function):

- **My Day / Command Centre** — customers needing attention; a Recommendations
  panel grouped Critical / High / Waiting / Review. Empty is honest ("Nothing
  urgent right now").
- **Customer page** — the read-only operational card with its open
  recommendations (explanation, next action, "if ignored" impact). No execution.
- **Operations Centre** — customer-health summary, a recommendations health card,
  and manual **Generate** / **Build** overrides (recovery only).

An un-projected card reads "Projection pending"; an unreadable table reads
"unavailable" — never a fake zero.

---

## Honesty, security, reversibility

- **Nothing fabricated.** Every number derives from real interactions,
  recommendations or graph edges, and each score carries its inputs
  (`priority_inputs`, `activity_inputs`, `health_reasons`, `evidence[]`).
- **Never a silent merge.** Weak evidence yields `possible`/`unknown` and a
  suggestion, never an auto-link.
- **Everything reversible.** Provisional people/companies are `verified = false`,
  `created_source = 'interaction'`; every link carries its evidence and can be
  undone. This is the trust boundary that lets the platform grow from "assist the
  human" to "safely automate" without ever silently corrupting a record.
- **Cards are projections, not systems of record** — rebuildable from the
  Business Graph plus `interactions`. Ownership of the underlying facts stays in
  the graph and its source tables.
- **Tenant-bound throughout**; no cross-tenant reads; no service role in the
  frontend; no secrets or full transcript/audio in any `context`, `evidence` or
  `detail`.

---

## Provider-agnostic by design

The stack is a shared platform capability: generic evidence sources, generic
confidence levels, a generic candidate/context model. ServiceOS resolves callers
to customers and jobs; a future ProductOS resolves the same signals to
accounts/orders/tickets with the identical engine — only the evidence tables
differ. `context.projection` and the resolver's `site`/`job`/`asset` slots are
where a job system (e.g. Commusoft) plugs in without an engine change.

---

## Related

- [../architecture/02_CORE_LOOP.md](../architecture/02_CORE_LOOP.md) — the one lifecycle this stack sits inside.
- [../architecture/03_BUSINESS_GRAPH.md](../architecture/03_BUSINESS_GRAPH.md) — the memory cards project from.
- [./INTELLIGENCE_INGEST_BRIDGE.md](./INTELLIGENCE_INGEST_BRIDGE.md) — the Observation stage proper.
- [../architecture/00_GLOSSARY.md](../architecture/00_GLOSSARY.md) — the terminology authority.
</content>
</invoke>
