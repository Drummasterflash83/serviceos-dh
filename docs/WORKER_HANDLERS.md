# ServiceOS — Shared Worker Handlers

**Status:** v1 landed (incremental). Framework + registry live; three engines
migrated to direct handlers; the rest run via HTTP fallback until migrated the
same way.

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
  "graph.sync": handleBusinessGraphSync, // migrated ✓
  "customer_card.sync": handleCustomerCardSync, // migrated ✓
  "recommendation.sync": handleRecommendationSync, // migrated ✓
};
```

The worker calls `getWorkerHandler(job_type)`. **If a handler exists it runs
in-process; otherwise the worker falls back to invoking the Edge Function over
HTTP** (unchanged path). So migration is incremental and always backwards-safe.

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

| job_type                | before (worker → …)          | after                                                                                                                                                 |
| ----------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graph.sync`            | HTTP → business-graph-sync   | **in-process handler**                                                                                                                                |
| `customer_card.sync`    | HTTP → customer-card-sync    | **in-process handler**                                                                                                                                |
| `recommendation.sync`   | HTTP → recommendation-sync   | **in-process handler**                                                                                                                                |
| `interactions.sync`     | HTTP → interactions-sync     | HTTP (fallback) — next to migrate                                                                                                                     |
| `identity.resolve`      | HTTP → identity-resolve      | HTTP (fallback) — next to migrate                                                                                                                     |
| `phone.process_pending` | HTTP → phone-process-pending | HTTP (fallback); the per-recording pipeline (download→transcribe→analyse) stays HTTP by design — those are separate provider/OpenAI/storage functions |

Three worker→function HTTP hops eliminated; the remaining three keep working
unchanged.

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

Manual endpoints and the worker produce identical results (same handler). Prove:

```sql
select id, job_type, status, attempt_count, records_processed, result, last_error, created_at
from platform_jobs order by created_at desc limit 30;
```

- A `graph.sync` / `customer_card.sync` / `recommendation.sync` row completed by
  the worker (`claimed_by` set) vs by a manual call — same `result` shape.
- No duplicate active rows for the same `(tenant, job_key)`.
- Retries/dead-letter still driven by the structured error contract.
