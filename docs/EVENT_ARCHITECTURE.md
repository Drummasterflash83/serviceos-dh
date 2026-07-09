# ServiceOS — Event Architecture (interaction.ready)

**Status:** Foundation landed. The producing side (phone) and the first
subscriber (Identity Engine) are wired; the event log is real and observable. The
dispatcher is intentionally not built yet — subscribers poll.

**Last updated:** 2026-07-09

---

## The principle

ServiceOS is moving from _building features_ to _building an event-driven
operating system_. A connector pipeline must **never** know about identity
resolution, customer cards, recommendations, the business graph, search, or any
future capability. A pipeline has exactly one job:

> **Produce a fully-processed canonical `interaction`, mark it READY, and publish
> an event. Then stop.**

Everything after that is a **subscriber** to the event:

```
Phone call
  → recording downloaded
  → transcript created
  → AI analysis complete
  → canonical interaction upserted
  → interaction.processing_status = READY
  → publish  interaction.ready
                      │
                      ├── Identity Engine        (built — consumes READY)
                      ├── Customer Card Engine    (future subscriber)
                      ├── Recommendation Engine   (future subscriber)
                      ├── Business Graph Engine    (future subscriber)
                      ├── Timeline / Search Index  (future subscriber)
                      └── … any future capability
```

Every subscriber runs **independently, retries independently, cannot block
another, is idempotent, and reports to Platform Jobs**. Because the pipeline only
publishes an event, adding a capability is "another subscriber to the event",
never "another dependency inside the pipeline". The same shape is reused for
**email, Slack, WhatsApp, forms, Commusoft, calendar** and every future
connector: _everything produces an interaction; everything publishes the same
event; everything enriches the same graph._

---

## What exists today

### The bus — `platform_events`

A durable, queryable append log (migration
[`20260709150000_platform_events.sql`](../supabase/migrations/20260709150000_platform_events.sql)),
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

Helper: [`_shared/events.ts`](../supabase/functions/_shared/events.ts) —
`publishEvent()` (best-effort, failure-isolated) and `markEventsConsumed()`.

### The producer — phone pipeline

[`phone-process-pipeline`](../supabase/functions/phone-process-pipeline/index.ts)
runs download → transcribe → analyse, then calls
[`_shared/phone_enrich.ts`](../supabase/functions/_shared/phone_enrich.ts)
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

### The first subscriber — Identity Engine

[`identity-resolve`](../supabase/functions/identity-resolve/index.ts) consumes
interactions in `('pending','ready')`, resolves who/company from evidence,
enriches customer cards + recommendations, marks the interaction `enriched`, and
best-effort marks the `interaction.ready` event **consumed**. It runs on its own
cron ([`identity-scheduled-sync`](../supabase/functions/identity-scheduled-sync/index.ts),
gated by `IDENTITY_SYNC_SECRET`).

---

## The canonical interaction lifecycle

```
pending  → projected, not yet fully processed (awaiting transcript/AI, etc.)
ready    → fully processed at source; interaction.ready published; awaiting
           downstream enrichment
enriched → identity / customer-card enrichment complete (terminal)
```

`processing_status` stays free-text (no CHECK) so a new connector can add a state
without a migration. `analysed` is the pre-events synonym for `ready` and is
still accepted by subscribers and the UI.

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
