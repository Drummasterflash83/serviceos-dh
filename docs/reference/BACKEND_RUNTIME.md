# Backend Runtime: Queue & Handlers

This is the canonical reference for how ServiceOS runs asynchronous work. It merges
the former "Async Worker Queue" and "Shared Worker Handlers" notes into one current
account. It is the anchor that [08_BACKEND_PRINCIPLES](../architecture/08_BACKEND_PRINCIPLES.md)
references for the runtime qualities named there.

Terminology is governed by [00_GLOSSARY](../architecture/00_GLOSSARY.md). Read one
distinction before anything else: a **Worker** is the single runtime process
(`platform-worker`) that claims jobs and runs handlers. An **Agent** is a product
concept (a supervised AI worker with an owner, permissions and a health score). An
Agent's work may be carried out by the Worker, but the Worker is never an Agent and
no Agent is the Worker. This document is only about the Worker.

---

## The execution model

Triggering is decoupled from executing. A heavy scheduled function can exceed
pg_net's roughly 5 second timeout, so a cron that both triggers and does the work
records a timeout even when the work completed, and can be aborted mid-run. The
model removes that failure mode:

1. A **scheduler, webhook or user action ENQUEUES** a job and returns in well under
   a second (`{ success, queued }`). It does no heavy work itself.
2. The single generic **`platform-worker`** cron CLAIMS due jobs off the queue
   (lease, retry with backoff, dead-letter) and runs the matching **shared handler
   IN-PROCESS**. There is no worker-to-orchestrator HTTP hop.
3. The **per-type Edge Function** is a thin wrapper (CORS, parse, auth, validate)
   over the *same* handler. One copy of the logic, two callers, zero duplication.

```
scheduler / webhook / user action
        │  enqueueJob()   (idempotent via job_key) → returns { success, queued }
        ▼
   platform_jobs (queued)
        │  platform-worker (cron, every minute, WORKER_SECRET-gated)
        ▼
   platform_jobs_claim  (FOR UPDATE SKIP LOCKED) → running + lease + attempt+1
        │  getWorkerHandler(job_type) → shared handler, in-process
        ▼
   succeeded │ retrying (backoff) │ dead_letter
        │
        ▼
   Operations Centre (Worker queue card)
```

The event bus is a distinct concept. Handlers publish and stages react through
`platform_events` (for example `interaction.ready`), documented separately in
[./EVENT_ARCHITECTURE.md](./EVENT_ARCHITECTURE.md). The queue moves *work*; the
event bus moves *facts*. This document does not absorb it.

---

## The queue is `platform_jobs`

There is no second queue. `platform_jobs` was already most of a queue (priority,
`attempt_count`, `max_attempts`, `next_run_at`, `error_count`, `last_error`,
`completed_at`/`failed_at`/`cancelled_at`, and the active-`job_key` unique index for
idempotent enqueue). Migration
[`20260710120000_platform_job_queue.sql`](../../supabase/migrations/20260710120000_platform_job_queue.sql)
adds only the missing lease and claim machinery, additively:

- **Columns:** `available_at` (claimable at or after; null means now), `claimed_at`,
  `claimed_by` (worker id, never a secret), `lease_expires_at`, `last_attempt_at`,
  `dead_lettered_at`, `error_code` (machine-readable, safe), `parent_job_id`.
- **RPC `platform_jobs_claim(p_worker, p_batch, p_lease_seconds, p_job_types[])`** —
  the atomic claim function (see below).
- **Unique index `platform_jobs_active_job_key_uk (tenant_id, job_key)
  WHERE status IN ('queued','running','retrying')`** — the one-active-row invariant.
  `retrying` is included (migration `20260804120000`) because the worker claims
  `queued`/`retrying` jobs, so a job in retry backoff is still active and must not be
  enqueued again as a duplicate.

Status lifecycle: `queued → running → succeeded`, on failure
`running → retrying → running → …`, exhausted or terminal `→ dead_letter`, operator
`→ cancelled`. `dead_letter` is the one new status value; status is free text so no
constraint changed.

---

## Idempotent enqueue and the one-active-row invariant

`enqueueJob()` (in [`_shared/platform_queue.ts`](../../supabase/functions/_shared/platform_queue.ts))
inserts a `queued` row keyed by `job_key`. The partial unique index
`platform_jobs_active_job_key_uk` means a second enqueue with the same
`(tenant_id, job_key)` while one is still `queued`, `running`, or `retrying` is not
inserted; the existing job is returned (`duplicate: true`).

Each scheduler enqueues with the *same* `job_key` its handler already uses (for
example `phone.process_pending:<tenant>`). So exactly one `platform_jobs` row exists
per unit of work at a time, and it is owned by the queue.

---

## Job ownership (stated once)

Exactly one `platform_jobs` row per unit of work, on both paths:

- **Worker path.** The claimed queue row *is* the job. The worker passes its id as
  `ctx.jobId`, runs the handler, then completes, retries or dead-letters that row
  from the handler's result. The handler creates nothing.
- **Manual (Edge) path.** The wrapper calls `createPlatformJob` with the same
  `job_key`. If a queue job is already active, the active-key index returns
  `duplicate` (`jobId=null`) and the wrapper skips its own tracking. No second row.

Because both paths key on the same `job_key`, they are interchangeable, and a
handler never touches the row lifecycle — it only reports progress on the row it was
handed.

---

## Claim model (atomic, no double work)

`platform_jobs_claim` runs a single
`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT batch)`, so two workers
can never claim the same job. It selects `queued`/`retrying` rows that are due
(`available_at` null or in the past) and unleased (`lease_expires_at` null or
expired), optionally filtered to `p_job_types`, ordered `priority ASC, created_at
ASC`, and stamps `running`, `claimed_by`, the lease, `attempt_count + 1`,
`last_attempt_at` and `started_at`. `EXECUTE` is granted to `service_role` only;
`public` and `authenticated` are revoked, so the browser can never claim.

## Lease model

Each claim sets `lease_expires_at = now() + p_lease_seconds`, floored at 30s; the
worker uses **300s** (`LEASE_SECONDS`). If a worker dies mid-run,
`releaseExpiredLeases()` moves expired-lease `running` jobs back to `retrying`
(available now) so the next tick reclaims them. `heartbeatLease()` extends a lease
for a long handler that chooses to hold its claim.

---

## The worker

[`platform-worker`](../../supabase/functions/platform-worker/index.ts) runs on a
one-minute cron, secret-gated, cross-tenant, no user JWT. Each tick:

1. `releaseExpiredLeases(admin)` — reclaim jobs whose worker died.
2. `claimJobs` — claim a small batch (`DEFAULT_BATCH` 3, `MAX_BATCH` 20) via the
   RPC.
3. For each claimed row: `getWorkerHandler(job_type)` and run it in-process, then
   `completeJob` / `failJob` / `deadLetterJob`, each job independent and
   failure-isolated. Success and failure also emit a health check keyed to the job's
   sensor component (see [../operations/OBSERVABILITY_HEALTH.md](../operations/OBSERVABILITY_HEALTH.md)).

The batch of `processOne` promises runs inside `EdgeRuntime.waitUntil`, so dispatch
**completes even if the pg_net caller disconnects at its 5s timeout**; the work is
also awaited, so the response carries the outcome when it finishes in time. The
worker returns `{ claimed, succeeded, retrying, dead_lettered, failed, duration_ms }`.

An unregistered `job_type` is dead-lettered immediately with `unsupported_job` —
never retried forever.

Scheduler cron rows, secrets and operational runbooks live in
[../operations/SCHEDULER_OPERATIONS.md](../operations/SCHEDULER_OPERATIONS.md). The
worker's own cron row is `serviceos-worker` (`* * * * *`), gated by the
`WORKER_SECRET` secret, defined in `serviceos_schedule_defs()`.

---

## The handler contract

A handler is pure business logic. Given a validated tenant, a service-role client,
the payload and the authoritative job id, it does the work and returns a structured
result. It never creates or completes the `platform_jobs` row and never derives the
tenant from browser input. The contract lives in
[`_shared/worker_handlers/index.ts`](../../supabase/functions/_shared/worker_handlers/index.ts):

```ts
interface WorkerHandlerContext {
  supabaseAdmin: SupabaseClient; // service-role client (bypasses RLS)
  tenantId: string;             // ALREADY validated by the caller
  jobId: string | null;         // the authoritative platform_jobs row; progress only
  payload: Record<string, unknown>;
  signal?: AbortSignal;         // cooperative cancellation
}
interface WorkerHandlerError {
  code: string;
  message: string;  // safe: never a secret or customer content, length-capped
  retryable: boolean;
  failedStep?: string;
}
interface WorkerHandlerResult {
  success: boolean;
  recordsProcessed?: number;
  result?: Record<string, unknown>;
  error?: WorkerHandlerError; // present when success === false
}
type WorkerHandler = (ctx: WorkerHandlerContext) => Promise<WorkerHandlerResult>;
```

`getWorkerHandler(job_type)` returns the handler or null. `toHandlerError(e, code)`
turns a thrown error into the safe contract (length-capped, retryable by default).

---

## The registry (17 handlers)

`WORKER_HANDLERS` in `index.ts` is the live registry. It holds **seventeen** handlers,
not the "six" that both source notes carried in prose. This is the real, current
list:

| `job_type` | Handler | Purpose |
|---|---|---|
| `phone.process_pending` | `handlePhoneProcessPending` | Drive pending phone calls through the enrichment pipeline (the one remaining child HTTP chain, see below). |
| `interactions.sync` | `handleInteractionsSync` | Project source rows (`phone_calls`, `email_messages`) into the canonical `interactions` table, incrementally. |
| `identity.resolve` | `handleIdentityResolve` | Resolve enriched interactions to identities (entities/nodes). |
| `graph.sync` | `handleBusinessGraphSync` | Sync resolved facts into the Business Graph (`graph_nodes`/`graph_edges`). |
| `customer_card.sync` | `handleCustomerCardSync` | Refresh the Customer Card projection (`customer_cards`). |
| `recommendation.sync` | `handleRecommendationSync` | Recompute recommendations from current state. |
| `email.gmail_sync` | `handleEmailGmailSync` | Pull email from a Gmail connection into `email_messages`. |
| `email.workspace_sync` | `handleEmailWorkspaceSync` | Pull email from a Google Workspace connection. |
| `email.workspace_backfill` | `handleEmailWorkspaceBackfill` | Backfill historical Workspace email on a slower cadence. |
| `email.mailbox_discovery` | `handleEmailMailboxDiscovery` | Discover the mailboxes available on a Workspace connection. |
| `intelligence.evaluate` | `handleIntelligenceEvaluate` | Run the intelligence evaluation step over eligible input. |
| `intelligence.ingest_interaction` | `handleIntelligenceIngest` | The channel-neutral bridge: map an enriched interaction to an `ObservationDraft` and enqueue `intelligence.observe`. |
| `intelligence.observe` | `handleIntelligenceObserve` | Produce an Observation from an `ObservationDraft` (`intelligence.observe`). |
| `intelligence.review_resolve` | `handleIntelligenceReviewResolve` | Resolve a queued intelligence review back into the loop. |
| `objective.evaluate` | `handleObjectiveEvaluate` | The Objective Evaluation Worker: turn measurements into immutable `objective_health` snapshots via the pure evaluator. |
| `automation.execute` | `handleAutomationExecute` | The Automation Engine handler: execute an already-authorised Automation Intent through a connector adapter. |
| `marketing.delivery_sync` | `handleMarketingDeliverySync` | Project the engine's immutable execution facts into Marketing delivery records (and, on confirmed submission, the canonical outbound `email_messages` row) via the governed SQL reconciler; enqueued after a test-send request, self-continues bounded by a payload ttl. |
| `marketing.broadcast_dispatch` | `handleMarketingBroadcastDispatch` | Bounded, lease-safe broadcast recipient preparation (Phase 5): claim ≤10 pending dispatches (FOR UPDATE SKIP LOCKED, quiet-hours deferral), recheck the canonical send authority, render deterministically from frozen inputs, create the complete governed engine lineage transactionally, enqueue automation execution + the delivery reconciler; continues only while safe claimable work remains. It also runs a bounded **recovery sweep**: a crash between the lineage transaction committing and the execution enqueue leaves a `queued` dispatch whose intent is still `pending` and which no claim query would ever revisit, so any such intent is re-enqueued idempotently (job-key de-dup + the engine's claim RPC remain the single-execution authority). Never calls a provider. |

Two of these have dedicated app-owned enqueue helpers and repair scanners rather
than a plain scheduler:

- `automation.execute` — enqueued by
  [`_shared/automation_execution_enqueue.ts`](../../supabase/functions/_shared/automation_execution_enqueue.ts)
  (`enqueueAutomationExecution`) or the `automation-execution-scheduled-sync` repair
  scanner. It turns an authorised Automation Intent into controlled, idempotent,
  auditable execution and never re-decides business policy. See
  [./AUTOMATION_ENGINE.md](./AUTOMATION_ENGINE.md).
- `objective.evaluate` — enqueued by
  [`_shared/objective_evaluation_enqueue.ts`](../../supabase/functions/_shared/objective_evaluation_enqueue.ts)
  (`enqueueObjectiveEvaluation`) or the `objective-evaluation-scheduled-sync` repair
  scanner.

`intelligence.ingest_interaction` enforces idempotency through the
`intelligence_ingestions` ledger (atomic claim on `(tenant, interaction,
mapper_version)`) plus the deterministic observe job key; the full seam is in
[./INTELLIGENCE_INGEST_BRIDGE.md](./INTELLIGENCE_INGEST_BRIDGE.md).

Adding a connector is a new handler file plus one registry line. The worker never
changes; it picks up the handler automatically.

---

## Error and retry contract (stated once)

A handler returns `{ code, message, retryable, failedStep? }`. `failJob` combines
`retryable` with the queue backoff to decide retry versus dead-letter; the Edge
wrapper maps the same error to an HTTP response. `message` is always safe — never a
provider secret or customer content, length-capped.

Backoff, by the attempt number that just failed (`attempt_count` is already
incremented at claim time): **attempt 1 → +1m, 2 → +5m, 3 → +15m, 4 → +60m**, then
**dead_letter** at attempt 5 (`max_attempts` default 5). Retrying jobs go `retrying`
with `available_at` pushed out; the next due tick reclaims them.

Classification (`isRetryable`, default retryable):

- **Retryable:** timeout, network, rate-limit (408/429), transient DB, 5xx.
- **Terminal (dead-letter immediately):** the `NON_RETRYABLE` set — `config_error`,
  `invalid_*`, `not_found`, `tenant_mismatch`, `forbidden`, `invalid_auth`,
  `internal_auth_mismatch`, `malformed_response`, `empty_transcript`,
  `unsupported_job`, and other 4xx.

Stored per job: `error_code`, safe `last_error`, `attempt_count`, `available_at`.

---

## Dead-letters

Exhausted or terminal jobs become `status='dead_letter'` with `dead_lettered_at`,
`error_code`, a safe `last_error` and the full `attempt_count`. They are never
auto-deleted and never retried forever. Operator requeue: `retryJob()` (helper), or
SQL that sets `status='queued'`, `available_at=now()`, `attempt_count=0`,
`dead_lettered_at=null`.

---

## Timeouts, cancellation and chaining

`ctx.signal` is available for cooperative cancellation where a handler honours it.
Handlers are bounded batches (small limits, per-item failure isolation) so they
return promptly; a long handler can `heartbeatLease` to hold its claim. Distributed
cancellation is intentionally not built yet.

Stages stay decoupled. Each stage (identity, graph, card, recommendation) is its own
idempotent job on its own cadence, or reacts to a `platform_event`. `parent_job_id`
records a chain when one job enqueues another. Each stage is independent, idempotent
and failure-isolated.

### Remaining child HTTP (by design)

The `phone.process_pending` handler still calls `phone-process-pipeline` over HTTP
per recording, which chains to `simwood-download-recording`,
`phone-transcribe-recording` and `phone-analyse-transcript` — separate provider
(Simwood), OpenAI and object-storage functions, out of scope to inline. Identity's
best-effort `triggerGraphSyncBackground` also stays a fire-and-forget HTTP call by
design (the graph is a decoupled subscriber). The worker-to-orchestrator hops that
mattered are gone.

---

## Security

- No service role in the frontend. The browser cannot enqueue or claim: RLS is
  SELECT-only and `platform_jobs_claim` EXECUTE is `service_role`-only.
- The worker endpoint is secret-gated (`WORKER_SECRET`), cross-tenant, no user JWT.
- Payloads, results and metadata carry no secrets and no transcript, audio or email
  content. Dead-letter messages are length-capped and sanitised.
- Claiming is tenant-safe: each claimed row carries its `tenant_id` and the worker
  acts per row.
- Manual endpoints keep their full auth (owner/admin/ops) in the wrapper; auth is
  never moved into the handler.

---

## How the queue delivers the backend principles

[08_BACKEND_PRINCIPLES](../architecture/08_BACKEND_PRINCIPLES.md) names six runtime
qualities. Concretely, the queue delivers each:

- **Event-driven** — schedulers enqueue and return; handlers publish
  `platform_events` and stages react on their own cadence, so no stage blocks
  another. Facts flow through the event bus, work through the queue.
- **Observable** — every unit of work is a `platform_jobs` row with `status`,
  `attempt_count`, `records_processed`, `result`, `last_error`, `claimed_by` and
  timings, surfaced on the Operations Centre Worker queue card and mirrored into
  health checks. Truthful state, no fake healthy.
- **Replayable** — a dead-lettered or completed job can be requeued with the same
  `job_key`; handlers are idempotent, so re-running a claim produces the same effect
  (a repeated projection of an unchanged row is a no-op).
- **Permissioned** — the claim RPC is `service_role`-only, the endpoint is
  `WORKER_SECRET`-gated, and the tenant is always caller-validated. The browser can
  observe (RLS SELECT) but never claim or mutate.
- **Attributable** — `claimed_by` records which worker ran a job, `parent_job_id`
  records the chain that produced it, and `error_code`/`last_error` record why it
  failed, all per row.
- **Recoverable** — leases reclaim a dead worker's jobs on the next tick; retryable
  failures back off and re-run; terminal failures dead-letter without loss and wait
  for an operator. Stopping the worker (`cron.unschedule('serviceos-worker')`) simply
  parks jobs; nothing is lost.

---

## Verification

```sql
select status, count(*) from platform_jobs group by status order by status;

select job_type, status, attempt_count, max_attempts, available_at, claimed_at,
       lease_expires_at, records_processed, result, last_error, created_at
from platform_jobs order by created_at desc limit 50;

select * from platform_jobs where status = 'dead_letter';

-- expired leases (should be reclaimed within a minute)
select id, job_type, claimed_by, lease_expires_at
from platform_jobs where status = 'running' and lease_expires_at < now();
```

Confirm: the scheduler returns quickly (`{ "success": true, "queued": N }`); the
worker claims atomically (no two workers share a job); a duplicate enqueue is
prevented (same `job_key` yields one active row); a worker-completed row and a
manual-call row share the same `result` shape; retries reschedule with backoff;
jobs dead-letter on exhaustion; expired leases reclaim on the next tick. For
source-controlled verification of the linked remote project, use the Remote
Verification Harness (see
[../operations/REMOTE_VERIFICATION_HARNESS.md](../operations/REMOTE_VERIFICATION_HARNESS.md)).
