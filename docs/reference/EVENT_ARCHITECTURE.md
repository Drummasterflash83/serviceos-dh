# ServiceOS — Event Architecture (interaction.ready)

**Status:** Foundation landed. The producing side (phone) and the first
subscriber (Identity Engine) are wired; the event log is real and observable. The
dispatcher is intentionally not built yet, so subscribers poll.

**Last updated:** 2026-07-09

**Where this sits.** This is the event backbone under [Core Loop](../architecture/02_CORE_LOOP.md)
stages 1 to 3 (Signal to Interaction, Interaction to Observation, Observation to
Card). A connector produces a canonical Interaction, marks it `ready`, and
publishes `interaction.ready` to the `platform_events` bus; downstream work runs
as independent, idempotent subscribers. Vocabulary follows
[00_GLOSSARY](../architecture/00_GLOSSARY.md).

> **"Event" means three tables, always qualify (glossary, Event collision).**
> This document is about the **Platform event** bus (`platform_events`), *the*
> event backbone. It is **not** the **Graph event** (`graph_events`, a Business
> Graph mutation, see [../architecture/03_BUSINESS_GRAPH.md](../architecture/03_BUSINESS_GRAPH.md))
> and **not** the **Call event** (`live_call_events`, a raw VoIP webhook event,
> see [./LIVE_CALL_CARD.md](./LIVE_CALL_CARD.md)). Every use of "event" below
> means a Platform event unless qualified otherwise.

---

## The principle

ServiceOS is moving from _building features_ to _building an event-driven
operating system_. A connector pipeline must **never** know about identity
resolution, customer cards, recommendations, the business graph, search, or any
future capability. A pipeline has exactly one job:

> **Produce a fully-processed canonical `interaction`, mark it READY, and publish
> an event. Then stop.**

Everything after that is a **subscriber** to the Platform event:

```
Phone call
  → recording downloaded
  → transcript created
  → AI analysis complete
  → canonical interaction upserted
  → interaction.processing_status = ready
  → publish  interaction.ready   (to platform_events)
                      │
                      └── Identity Engine   (built: the one subscriber today)
                              │  runs inline, inside identity resolution:
                              ├── customer-card enrichment
                              ├── recommendation creation
                              ├── best-effort Business Graph sync trigger
                              └── marks the interaction.ready event consumed

           (future independent subscribers, e.g. Timeline / Search Index, and
            any card / recommendation / graph work later split back out,
            attach here without touching the producer)
```

Every subscriber runs **independently, retries independently, cannot block
another, is idempotent, and reports to Platform Jobs**. Because the pipeline only
publishes a Platform event, adding a capability is "another subscriber to the
event", never "another dependency inside the pipeline". The same shape is reused
for **email, Slack, WhatsApp, forms, Commusoft, calendar** and every future
connector: _everything produces an interaction; everything publishes the same
Platform event; everything enriches the same graph._

> **Current reality (do not read the diagram as fully fanned-out).** Today the
> **only** independent subscriber to `interaction.ready` is the **Identity
> Engine**. Customer-card enrichment, recommendation creation, and the Business
> Graph sync trigger are **not** separate subscribers yet: they run **inline
> inside identity resolution** (see
> [`_shared/worker_handlers/identity_resolve.ts`](../../supabase/functions/_shared/worker_handlers/identity_resolve.ts)
> and [`identity-resolve`](../../supabase/functions/identity-resolve/index.ts),
> whose header lists "card enrichment ... recommendation creation ... best-effort
> graph trigger"). The independent-subscriber model above is the **target
> shape**; splitting cards, recommendations, and graph into their own subscribers
> is deferred, and the foundation supports it without a rewrite.

---

## What exists today

### The bus — `platform_events`

A durable, queryable append log (migration
[`20260709150000_platform_events.sql`](../../supabase/migrations/20260709150000_platform_events.sql)),
the exact analogue of `platform_jobs`: **tracking + visibility first**. There is
no dispatcher engine yet — subscribers poll. Adding a real dispatcher later
requires **no rewrite** of producers or subscribers.

| Column                        | Meaning                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| `event_type`                  | e.g. `interaction.ready`                                     |
| `subject_type` / `subject_id` | e.g. `interaction` / `interactions.id`                       |
| `source`                      | publisher, e.g. `phone-process-pipeline`                     |
| `status`                      | `pending` → `consumed` (`dead` reserved)                     |
| `payload`                     | small context, e.g. `{ source_type, call_id, recording_id }` |

A **partial unique index** allows at most one `pending` event per
`(tenant, event_type, subject)`, so re-running an idempotent producer no-ops
instead of stacking duplicates. Writes are service-role only; RLS grants
tenant-scoped `SELECT`.

Helper: [`_shared/events.ts`](../../supabase/functions/_shared/events.ts) —
`publishEvent()` (best-effort, failure-isolated) and `markEventsConsumed()`.

### The producer — phone pipeline

[`phone-process-pipeline`](../../supabase/functions/phone-process-pipeline/index.ts)
runs download → transcribe → analyse, then calls
[`_shared/phone_enrich.ts`](../../supabase/functions/_shared/phone_enrich.ts)
`finalizeInteractionForRecording()` which:

1. back-fills `phone_ai_insights.call_id` (insights are written keyed only by
   `recording_id`; the canonical projection joins AI by `call_id`),
2. upserts the one canonical `interactions` row for the call,
3. marks it **READY** (never downgrading an already-`enriched` row),
4. **publishes `interaction.ready`**.

This step is best-effort and failure-isolated: a failure here never fails the
already-successful analysis, and it is recorded in the pipeline run's metadata
(`interaction_id`, `interaction_ready`, `event_published`, `finalize_skipped`).
The pipeline references **no** downstream engine.

### The one subscriber today: Identity Engine

[`identity-resolve`](../../supabase/functions/identity-resolve/index.ts) consumes
interactions in `('pending','ready')`, resolves who/company from evidence, and
then, **within the same identity-resolution pass**, enriches customer cards,
creates recommendations, best-effort triggers a Business Graph sync, marks the
interaction `enriched`, and best-effort marks the `interaction.ready` Platform
event **consumed**. It runs on its own cron
([`identity-scheduled-sync`](../../supabase/functions/identity-scheduled-sync/index.ts),
gated by `IDENTITY_SYNC_SECRET`). So the card, recommendation, and graph work
happens **inside** this subscriber, not as sibling subscribers.

> Since Async Worker Queue v1.1, this logic is a **shared worker handler**
> ([`_shared/worker_handlers/identity_resolve.ts`](../../supabase/functions/_shared/worker_handlers/identity_resolve.ts))
> that the `platform-worker` runs **in-process** and the `identity-resolve` Edge
> Function calls as a thin wrapper, so there is one copy of the logic. See
> [BACKEND_RUNTIME.md](BACKEND_RUNTIME.md).

---

## The canonical interaction lifecycle

Canonical lifecycle is `pending -> ready -> enriched` (glossary, Interaction
status):

```
pending  → projected, not yet fully processed (awaiting transcript/AI, etc.)
ready    → fully processed at source; interaction.ready published; awaiting
           downstream enrichment
enriched → identity / customer-card enrichment complete (terminal)
```

`processing_status` stays free-text (no CHECK) so a new connector can add a state
without a migration. **`analysed` is a retired synonym for `ready`**: it is the
pre-events name, still accepted by subscribers and the UI for back-compatibility,
but do not introduce it in new work.

---

## Adding the next subscriber (the pattern)

1. Poll `interactions` (or, once a dispatcher exists, subscribe to
   `platform_events where event_type='interaction.ready' and status='pending'`).
2. Do your idempotent work; record a `platform_jobs` row for visibility.
3. On success, advance the interaction (or your own state) and — if you are the
   terminal consumer — `markEventsConsumed()`.
4. Never call back into a producer; never block another subscriber.

## Deliberately NOT built yet

- A dispatcher/queue engine (subscribers poll today).
- A dead-letter queue / replay UI (the `dead` status is reserved for it).
- Multi-subscriber fan-out bookkeeping (today a single terminal subscriber marks
  `consumed`; when several subscribers exist, per-subscriber delivery rows or a
  dispatcher will track partial consumption).

These are natural next steps that this foundation supports without a rewrite.

## Scheduled projector vs live finaliser (no event storms)

Phone `interaction.ready` has two producers, and they do not duplicate events:

- **Live finaliser** (`_shared/phone_enrich.ts`, on the pipeline) creates/refreshes
  the interaction for a recording-based call and publishes `interaction.ready` once
  (skipped when already `enriched`).
- **Scheduled projector** (`interactions.sync` → `phone_select_projectable`) is the
  repair/backfill path. It publishes `interaction.ready` **only for genuinely-new
  interactions** (calls with no prior interaction — e.g. calls without a recording).
  A _refresh_ (source/insight changed) upserts the row but emits no event.

Because the finaliser already created the interaction for recording-based calls, the
projector sees them as existing and never re-emits. Combined with the incremental
selector (unchanged calls are never selected) this guarantees no per-cycle event
storm and no needless identity/graph/card/recommendation work. `publishEvent` remains
idempotent (one pending event per `(tenant, event_type, subject)`).
