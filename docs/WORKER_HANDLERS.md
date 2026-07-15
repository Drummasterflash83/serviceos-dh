# ServiceOS — Shared Worker Handlers

**Status:** v1.1 complete. **All six** supported job types run through direct
in-process handlers; the worker's HTTP dispatch fallback is removed. Only phone's
per-recording child pipeline remains HTTP (by design — see below).

**Last updated:** 2026-07-10

> Related: [ASYNC_WORKER_QUEUE.md](ASYNC_WORKER_QUEUE.md),
> [EVENT_ARCHITECTURE.md](EVENT_ARCHITECTURE.md).

---

## The idea

Business logic moves out of Edge Functions into **shared handlers** so the
`platform-worker` runs it **in-process** (no HTTP hop) and the Edge Function
becomes a thin wrapper calling the _same_ handler. One copy of the logic, two
callers, zero duplication.

```
Scheduler / Webhook / User Action → enqueue job → platform_jobs
                                                        │
platform-worker  ─claims─►  getWorkerHandler(job_type) ─► shared handler ─► DB
   (in-process, no HTTP)                                     │
                                              complete / retry / dead-letter

Edge Function (manual):  HTTP → auth+validate → same shared handler → response
```

## The contract ([`_shared/worker_handlers/index.ts`](../supabase/functions/_shared/worker_handlers/index.ts))

```ts
interface WorkerHandlerContext {
  supabaseAdmin: SupabaseClient; // service-role client
  tenantId: string; // ALREADY validated by the caller — never from browser input
  jobId: string | null; // the authoritative platform_jobs row (reused, never re-created)
  payload: Record<string, unknown>;
  signal?: AbortSignal;
}
interface WorkerHandlerError {
  code: string;
  message: string;
  retryable: boolean;
  failedStep?: string;
}
interface WorkerHandlerResult {
  success: boolean;
  recordsProcessed?: number;
  result?: object;
  error?: WorkerHandlerError;
}
type WorkerHandler = (ctx: WorkerHandlerContext) => Promise<WorkerHandlerResult>;
```

A handler is **pure business logic**: it reads/writes via `supabaseAdmin`, scoped
to the caller-validated `tenantId`, and returns a structured result. It **never**
touches the `platform_jobs` row lifecycle (create/complete) — the caller owns
that — and **never** derives the tenant from browser input.

## Registry

```ts
export const WORKER_HANDLERS: Record<string, WorkerHandler> = {
  "phone.process_pending": handlePhoneProcessPending,
  "interactions.sync": handleInteractionsSync,
  "identity.resolve": handleIdentityResolve,
  "graph.sync": handleBusinessGraphSync,
  "customer_card.sync": handleCustomerCardSync,
  "recommendation.sync": handleRecommendationSync,
  "email.gmail_sync": handleEmailGmailSync,
  "email.workspace_sync": handleEmailWorkspaceSync,
  "email.workspace_backfill": handleEmailWorkspaceBackfill,
  "email.mailbox_discovery": handleEmailMailboxDiscovery,
  "intelligence.evaluate": handleIntelligenceEvaluate,
  "intelligence.ingest_interaction": handleIntelligenceIngest,
  "intelligence.observe": handleIntelligenceObserve,
  "intelligence.review_resolve": handleIntelligenceReviewResolve,
  "objective.evaluate": handleObjectiveEvaluate,
  "automation.execute": handleAutomationExecute,
};
```

`intelligence.ingest_interaction` is the **channel-neutral bridge** from the canonical
`interactions` projection into `intelligence.observe`. It maps an enriched interaction
(phone/email/…) to a channel-neutral `ObservationDraft` and enqueues `intelligence.observe`
— it never evaluates a Decision or creates an Automation Intent itself. Idempotency is
enforced by the `intelligence_ingestions` ledger (atomic claim on
`(tenant, interaction, mapper_version)`) plus the deterministic observe job key; it
processes only explicit, bounded interaction ids (no history sweep). Full seam +
idempotency model: **docs/INTELLIGENCE_INGEST_BRIDGE.md**.

`automation.execute` is the **Universal Automation Engine** — it turns an already-authorised
Automation Intent into controlled, idempotent, auditable execution via a connector adapter,
appends an immutable execution attempt + operational Outcome, and never re-decides business
policy. Enqueued by
[`enqueueAutomationExecution`](../supabase/functions/_shared/automation_execution_enqueue.ts)
or the `automation-execution-scheduled-sync` repair scanner. See
[UNIVERSAL_AUTOMATION_ENGINE.md](UNIVERSAL_AUTOMATION_ENGINE.md).

`objective.evaluate` is the **Objective Evaluation Worker** — it turns measurements
into immutable `objective_health` snapshots via the pure evaluator. Enqueued by
[`enqueueObjectiveEvaluation`](../supabase/functions/_shared/objective_evaluation_enqueue.ts)
(app-owned) or the `objective-evaluation-scheduled-sync` repair scanner. See
[OBJECTIVE_EVALUATION_WORKER.md](OBJECTIVE_EVALUATION_WORKER.md).

The worker calls `getWorkerHandler(job_type)` and runs it **in-process**. There is
no internal-HTTP dispatch for the six supported types; an unregistered job_type is
dead-lettered (`unsupported_job`), never retried forever.

## Platform-job ownership (§10)

Exactly **one** `platform_jobs` row per unit of work, always:

- **Worker path:** the claimed queue job is the row. The worker passes its id as
  `ctx.jobId`, runs the handler, then completes/retries/dead-letters that row from
  the handler's result. The handler creates nothing.
- **Manual (Edge) path:** the wrapper `createPlatformJob`s — but the active
  `job_key` unique index dedups against a live queue job, so if one is active the
  wrapper gets `duplicate` (jobId=null) and skips its own tracking. No second row.

Because the wrapper enqueues/creates with the **same `job_key`** the queue uses,
the two paths are interchangeable.

## Error contract & retries (§12)

Handlers return `{ code, message, retryable, failedStep? }`. The worker's
`failJob` uses `retryable` + the queue backoff (1/5/15/60 min → dead-letter). The
Edge wrapper maps the same error to an HTTP response. `message` is always safe —
**never a provider secret or customer content** (length-capped).

## Internal HTTP paths — before vs after

| job_type                | before (worker → …)          | after                                                                                                                                          |
| ----------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `graph.sync`            | HTTP → business-graph-sync   | **in-process handler**                                                                                                                         |
| `customer_card.sync`    | HTTP → customer-card-sync    | **in-process handler**                                                                                                                         |
| `recommendation.sync`   | HTTP → recommendation-sync   | **in-process handler**                                                                                                                         |
| `interactions.sync`     | HTTP → interactions-sync     | **in-process handler**                                                                                                                         |
| `identity.resolve`      | HTTP → identity-resolve      | **in-process handler**                                                                                                                         |
| `phone.process_pending` | HTTP → phone-process-pending | **in-process handler**; the per-recording chain (phone-process-pipeline → download/transcribe/analyse) stays HTTP — see "Remaining child HTTP" |

**All six** worker→orchestrator HTTP hops are eliminated.

### Remaining child HTTP (justified)

The `phone.process_pending` handler still calls `phone-process-pipeline` over HTTP
per recording, which chains to `simwood-download-recording`,
`phone-transcribe-recording` and `phone-analyse-transcript`. These are separate
provider (Simwood), OpenAI and object-storage functions; extracting them is out of
scope for this phase (they'd add regression risk for a smaller HTTP saving). The
worker→pending hop — the one that mattered — is gone. Identity's best-effort
`triggerGraphSyncBackground` also remains a fire-and-forget HTTP call by design
(the graph is a decoupled subscriber).

## Migrating the next engine (the whole recipe)

1. Create `_shared/worker_handlers/<name>.ts` — move the Edge Function's business
   logic (the try-block between auth and job-completion) into
   `handle<Name>(ctx)`; read inputs from `ctx.payload`, tenant from `ctx.tenantId`.
2. Add one line to the registry in `index.ts`.
3. Thin the Edge Function to: CORS + parse + auth + validate → `createPlatformJob`
   → call the handler → complete/fail + HTTP response (see the three migrated
   wrappers as the template).

**No worker change is ever needed** — it picks up the new handler automatically.
This is exactly what a future connector (Slack, Commusoft, Microsoft 365, Stripe,
…) does: register a handler.

## Timeouts & cancellation (§11)

`WorkerHandlerContext.signal` is available for cooperative cancellation; v1
handlers are bounded batches (small limits, `for`-loop, failure-isolated per item)
so they return promptly. Long handlers can `heartbeatLease` (queue helper) to hold
their claim. Distributed cancellation is intentionally not built yet.

## Security

- No service role in the frontend; handlers run only server-side.
- Tenant is always caller-validated — handlers never trust browser input for it.
- No secret or customer content in payloads, results, or error messages.
- Manual endpoints keep their full auth (owner/admin/ops) — auth is **not** moved
  into the handler, it stays in the wrapper.

## Verification

For repeatable, source-controlled verification of the **linked remote** project (schema,
registries, append-only behaviour, and the full controlled Automation slice) without
pasting SQL into the dashboard, use the **Remote Verification Harness** —
`npm run verify:remote` / `verify:automation` / `verify:all`. See
[REMOTE_VERIFICATION_HARNESS.md](REMOTE_VERIFICATION_HARNESS.md).

Manual endpoints and the worker produce identical results (same handler). Prove:

```sql
select id, job_type, status, attempt_count, records_processed, result, last_error, created_at
from platform_jobs order by created_at desc limit 30;
```

- A `graph.sync` / `customer_card.sync` / `recommendation.sync` row completed by
  the worker (`claimed_by` set) vs by a manual call — same `result` shape.
- No duplicate active rows for the same `(tenant, job_key)`.
- Retries/dead-letter still driven by the structured error contract.

## Incremental interaction projection (`interactions.sync`)

`interactions.sync` projects source rows (`phone_calls`, `email_messages`) into the
canonical `interactions` table. Both sides are **incremental** — a steady-state run
selects and upserts **zero** unchanged rows:

- **Email** selects via `email_select_unprojected(tenant, limit)` — source messages
  with no interaction yet, oldest first.
- **Phone** selects via `phone_select_projectable(tenant, limit)` — the _repair /
  backfill_ path only: calls with no interaction, calls whose source row or AI
  insight changed after projection, or legacy rows with no marker. Real-time phone
  projection is owned by the pipeline finaliser (`_shared/phone_enrich.ts`), which
  runs on `interaction.ready`; the scheduled projector no longer rewrites every call
  each cycle.

**Refresh marker.** `interactions.source_updated_at` holds the _max source timestamp_
(`phone_calls.updated_at`, latest `phone_ai_insights.updated_at`) at projection time.
Both the finaliser and `interactions.sync` write it. A call is re-selected only when a
real source timestamp is newer — never because of `interactions.updated_at`, which
churns on every no-op upsert. One canonical interaction per call is guaranteed by the
`unique (tenant_id, source_table, source_id)` index; a repeated projection of an
unchanged call is a no-op.

**Events.** The projector publishes `interaction.ready` only for genuinely-new
interactions (no prior row), never on a refresh — so unchanged rows never re-trigger
identity/graph/card/recommendation work.

**Result shape** (back-compat totals preserved, richer fields added):
`phone_selected/created/updated/skipped`, `email_selected/created/updated`,
`interactions_upserted`, plus `phone_processed`/`email_processed`. Steady state:
`{ "phone_processed": 0, "email_processed": 0, "interactions_upserted": 0 }`.
