# ServiceOS — Async Worker Queue

**Status:** v1 landed. Schedulers enqueue and return fast; a generic worker claims
and processes jobs asynchronously, with retries and dead-letters.

**Last updated:** 2026-07-10

> Related: [SCHEDULER_DEPLOYMENT.md](SCHEDULER_DEPLOYMENT.md),
> [INPUT_RELIABILITY.md](INPUT_RELIABILITY.md), [EVENT_ARCHITECTURE.md](EVENT_ARCHITECTURE.md).

---

## Why

Heavy scheduled functions can exceed pg_net's ~5s timeout, so cron calls recorded
timeouts even when the work completed (and the function could be aborted mid-run).
The fix: **decouple triggering from executing.** Schedulers now _enqueue_ work and
return in well under a second; a **worker** processes the queue independently, so
pg_net timeouts stop being expected behaviour.

## Architecture decision — extend `platform_jobs`, don't duplicate

`platform_jobs` was already ~80% a queue (priority, attempt_count, max_attempts,
next_run_at, error_count, last_error, completed/failed/cancelled timestamps, and
the ACTIVE-`job_key` unique index for idempotent enqueue). So the queue **is**
`platform_jobs` — [migration `20260710120000`](../supabase/migrations/20260710120000_platform_job_queue.sql)
adds only the missing lease/claim columns (`available_at`, `claimed_at`,
`claimed_by`, `lease_expires_at`, `last_attempt_at`, `dead_lettered_at`,
`error_code`, `parent_job_id`) and one atomic claim function. No second queue
system, no duplicated visibility.

```
scheduler / webhook / user action
        │  enqueueJob()  (idempotent via job_key)
        ▼
   platform_jobs (queued)        ← returns immediately: { success, queued }
        │
        │  platform-worker (cron, every minute)
        ▼
   claim (FOR UPDATE SKIP LOCKED) → running + lease
        │  dispatch by job_type → existing worker function
        ▼
   succeeded │ retrying (backoff) │ dead_letter
        │
        ▼
   Operations Centre (Worker queue card)
```

## Lifecycle

`queued → running → succeeded` · on failure `running → retrying → running → …` ·
exhausted/terminal `→ dead_letter` · operator `→ cancelled`. (`dead_letter` is a
new status value; existing values are unchanged.)

## Idempotent enqueue

`enqueueJob()` inserts a `queued` row keyed by `job_key`. The partial unique index
`platform_jobs_active_job_key_uk (tenant_id, job_key) WHERE status IN
('queued','running')` means an active job with the same key is **not** enqueued
twice — a duplicate enqueue returns the existing job (`duplicate: true`).

**The one-row invariant:** each scheduler enqueues with the _same_ `job_key` its
worker function already uses (e.g. `phone.process_pending:<tenant>`). When the
worker claims the job (→ `running`) and invokes that function, the function's own
`createPlatformJob` sees the active row and **defers** (its de-dup returns a
duplicate, so it skips creating a second row). Result: exactly one
`platform_jobs` row per unit of work, owned by the queue — **no business logic is
duplicated in the worker.**

## Claim model (atomic, no double work)

`platform_jobs_claim(worker, batch, lease_seconds, job_types[])` runs a single
`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT batch)` — two workers
can never claim the same job. It selects `queued`/`retrying` jobs that are due
(`available_at <= now`), unleased (`lease_expires_at` null/expired), ordered by
`priority ASC, created_at ASC`, and stamps `running` + lease + `attempt_count+1`.
`EXECUTE` is granted to `service_role` only — the browser can never claim.

## Lease model

Each claim sets `lease_expires_at = now + lease` (300s). If a worker dies mid-run,
`releaseExpiredLeases()` moves expired-lease `running` jobs back to `retrying`
(available now) so the next tick reclaims them. `heartbeatLease()` can extend a
lease for long jobs.

## The worker

[`platform-worker`](../supabase/functions/platform-worker/index.ts) (cron, every
minute, gated by `WORKER_SECRET`): release expired leases → claim a small batch →
dispatch each job to its authoritative function → complete/retry/dead-letter. The
heavy dispatch runs inside `EdgeRuntime.waitUntil`, so it **completes even if the
pg_net caller disconnects at 5s**; the response carries the outcome when it
finishes in time. Returns `{ claimed, succeeded, retrying, dead_lettered, failed,
duration_ms }`.

Dispatched job types (v1): `phone.process_pending`, `interactions.sync`,
`identity.resolve`, `graph.sync`, `customer_card.sync`, `recommendation.sync`.

**Dispatch is now handler-first** (see [WORKER_HANDLERS.md](WORKER_HANDLERS.md)):
if a shared handler is registered for the job type, the worker runs it
**in-process (no HTTP)**; otherwise it falls back to invoking the Edge Function
over HTTP. `graph.sync`, `customer_card.sync` and `recommendation.sync` run as
direct handlers today; the rest migrate the same way (add a handler + registry
line — no worker change).

## Retries (exponential backoff)

On a retryable failure with attempts remaining, the job goes `retrying` with
`available_at` pushed out: **attempt 1 → +1m · 2 → +5m · 3 → +15m · 4 → +60m**,
then **dead_letter** at attempt 5 (`max_attempts` default 5).

- **Retryable:** timeout, network, rate-limit (429/408), transient DB, 5xx.
- **Non-retryable (dead-letter immediately):** `config_error`, `invalid_*`,
  `not_found`, `tenant_mismatch`, `forbidden`, `invalid_auth`,
  `internal_auth_mismatch`, `malformed_response`, `empty_transcript`,
  `unsupported_job`, and other 4xx.

Stored per job: `error_code`, safe `last_error`, `attempt_count`, `available_at`.

## Dead-letters

Exhausted/terminal jobs become `status='dead_letter'` with `dead_lettered_at`,
`error_code`, safe `last_error`, and the full `attempt_count`. **Never auto-deleted,
never retried forever.** Operator requeue: `retryJob()` (helper) or SQL
`update platform_jobs set status='queued', available_at=now(), attempt_count=0,
dead_lettered_at=null where id='…';`.

## Chaining (no coupling)

Stages stay decoupled and event-driven (see EVENT_ARCHITECTURE.md): a phone job
publishes `interaction.ready`; the identity/graph/card/recommendation stages are
each their own idempotent job, enqueued on their own cadence (or, in future, from
the event). `parent_job_id` records a chain when one job enqueues another. Each
stage is independent, idempotent, and failure/retry-isolated.

## Relationship to Platform Jobs & schedulers

- **Platform Jobs** IS the queue — same table, same Operations Centre visibility.
- **Schedulers** now enqueue + return `{ success, queued }`. Heavy work is the
  worker's.
- **`platform-worker`** runs every minute (added to the cron schedule in
  [SCHEDULER_DEPLOYMENT.md](SCHEDULER_DEPLOYMENT.md)); gated by `WORKER_SECRET`.

## Operations Centre

A **Worker queue** card shows queued, running, retrying, dead-letter, succeeded/
failed today, oldest-queued age, avg duration and expired leases — truthful state,
no fake healthy.

## Manual controls (§15)

The Admin override buttons should _enqueue_ and return; the worker does the heavy
lifting. (v1 keeps the existing direct-invoke override buttons working — they call
the functions directly for an immediate one-off — while normal operation is fully
queued.)

## Security

- No service role in the frontend; the browser cannot enqueue or claim (RLS
  SELECT-only; `platform_jobs_claim` EXECUTE is `service_role`-only).
- The worker endpoint is secret-gated (`WORKER_SECRET`), cross-tenant, no user JWT.
- Payloads/metadata carry **no** secrets and **no** transcript/audio/email content;
  dead-letter messages are length-capped and sanitised.
- Claiming is tenant-safe (each claimed row carries its `tenant_id`; the worker
  invokes the child bound to that tenant).

## Rollback

- Stop the worker: `select cron.unschedule('serviceos-worker');` (jobs simply wait).
- The schedulers still enqueue; nothing is lost. To revert to synchronous cron
  processing, restore the pre-queue scheduler bodies (git) — no data migration
  needed (the queue columns are additive).

## Verification SQL

```sql
select status, count(*) from platform_jobs group by status order by status;

select job_type, status, attempt_count, max_attempts, available_at, claimed_at,
       lease_expires_at, last_error, created_at
from platform_jobs order by created_at desc limit 50;

select * from platform_jobs where status = 'dead_letter';

-- expired leases (should be reclaimed within a minute)
select id, job_type, claimed_by, lease_expires_at
from platform_jobs where status = 'running' and lease_expires_at < now();
```

Confirm: scheduler returns quickly (`{ "success": true, "queued": N }`); the worker
claims atomically (no two workers share a job); duplicate enqueue is prevented
(same `job_key` → one active row); retries reschedule with backoff; dead-letter on
exhaustion; expired leases reclaim on the next tick.
