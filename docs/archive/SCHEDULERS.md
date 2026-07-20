> **SUPERSEDED — archived for historical reference.**
> This document is no longer maintained and may contain claims that were
> true only at the time of writing. Its subject is now owned by
> [Scheduler Operations](../operations/SCHEDULER_OPERATIONS.md).
> Start at the [documentation index](../README.md). Kept to preserve the
> architectural evolution and decision history.

---

# ServiceOS — Schedulers & Secrets

**Status:** Operational reference. Every automatic (cron-driven) Edge Function in
ServiceOS, the secret that gates it, how to test it, and how to verify it ran.

**Last updated:** 2026-07-09

> This document contains **no secret values** — only secret _names_. Set the real
> values with `npx supabase secrets set …` (see the checklist below) and never
> commit them. Related: [DEPLOYMENT_AND_TEST_CHECKLIST.md](DEPLOYMENT_AND_TEST_CHECKLIST.md),
> [EVENT_ARCHITECTURE.md](EVENT_ARCHITECTURE.md).

---

## How scheduled functions are secured

Every scheduled function runs with **no Supabase user session** (cron has no JWT),
so each is deployed with `verify_jwt = false` (declared in
[supabase/config.toml](../supabase/config.toml)) and instead trusts a shared
secret sent in the **`x-schedule-secret`** header. The function compares it
(constant-time) against its own env secret and returns `403` on mismatch, `500`
if the secret isn't configured. It then does its work **server-to-server** for
every enabled tenant using the service-role key. One failing tenant never aborts
the others; a missed tick simply resumes on the next run.

**Secret → function map**

| Scheduled function                        | Required secret                   | Purpose                                                 |
| ----------------------------------------- | --------------------------------- | ------------------------------------------------------- |
| `phone-scheduled-sync`                    | `PHONE_SCHEDULE_SECRET`           | Ingest recent calls + recording metadata                |
| `phone-processing-scheduled-sync`         | `PHONE_PROCESSING_SECRET`         | Drain the download → transcribe → analyse backlog       |
| `email-scheduled-sync`                    | `EMAIL_SCHEDULE_SECRET`           | Ingest recent Gmail (OAuth) messages                    |
| `email-workspace-scheduled-sync`          | `EMAIL_WORKSPACE_SCHEDULE_SECRET` | Ingest recent Google Workspace (DWD) mail               |
| `email-workspace-backfill-scheduled-sync` | `EMAIL_WORKSPACE_BACKFILL_SECRET` | Historical Workspace mail backfill                      |
| `interactions-scheduled-sync`             | `SIGNAL_SYNC_SECRET`              | Refresh the canonical `interactions` timeline           |
| `identity-scheduled-sync`                 | `IDENTITY_SYNC_SECRET`            | Run the Identity Engine over ready/pending interactions |
| `business-graph-scheduled-sync`           | `GRAPH_SYNC_SECRET`               | Project the system of record into the Business Graph    |
| `customer-card-scheduled-sync`            | `CARD_SYNC_SECRET`                | Project the graph into customer_cards.context           |
| `recommendation-scheduled-sync`           | `RECOMMENDATION_SYNC_SECRET`      | Generate rule-based recommendations from card state     |

All also require the platform secrets `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`; the phone/email ingest and AI steps additionally
need their provider secrets (`SIMWOOD_USERNAME` / `SIMWOOD_PASSWORD`,
`OPENAI_API_KEY`, Google Workspace keys) — see the ingest specs.

---

## Secrets checklist

Set the scheduler secrets (generate long random values, e.g.
`openssl rand -hex 32`). **Names only — never paste real values into the repo.**

```bash
# Scheduler gate secrets (one per scheduled function)
npx supabase secrets set PHONE_SCHEDULE_SECRET="…"
npx supabase secrets set PHONE_PROCESSING_SECRET="…"
npx supabase secrets set EMAIL_SCHEDULE_SECRET="…"
npx supabase secrets set EMAIL_WORKSPACE_SCHEDULE_SECRET="…"
npx supabase secrets set EMAIL_WORKSPACE_BACKFILL_SECRET="…"
npx supabase secrets set SIGNAL_SYNC_SECRET="…"
npx supabase secrets set IDENTITY_SYNC_SECRET="…"
npx supabase secrets set GRAPH_SYNC_SECRET="…"
npx supabase secrets set CARD_SYNC_SECRET="…"
npx supabase secrets set RECOMMENDATION_SYNC_SECRET="…"

# Platform + provider secrets the schedulers rely on (set once)
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY="…"
npx supabase secrets set OPENAI_API_KEY="…"
```

Verify names are present (values are never printed):

```bash
npx supabase secrets list
```

> Calling convention for every test below: the function is `verify_jwt = false`,
> so no `Authorization` bearer is needed — only the `x-schedule-secret`. If the
> Supabase gateway rejects the request before it reaches the function, also add
> `-H "apikey: $SUPABASE_ANON_KEY"`. `$SUPABASE_URL` is your project URL.

---

## 1. `phone-scheduled-sync`

- **Purpose:** for each enabled Simwood tenant, invoke `simwood-sync-calls` then
  `simwood-sync-recordings` (recordings metadata; downloads happen in the
  processing pipeline, not here).
- **Recommended cadence:** every **5 minutes**.
- **Secret:** `PHONE_SCHEDULE_SECRET`.

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/phone-scheduled-sync" \
  -H "x-schedule-secret: $PHONE_SCHEDULE_SECRET" \
  -H "content-type: application/json" -d '{}'
```

- **Expected success shape:** `{ "success": true, "tenants": <n>, "results": [ … ] }`
- **Verify (SQL):**

```sql
select sync_type, status, records_processed, error_message, started_at
from phone_sync_runs
where sync_type in ('scheduled_sync', 'calls', 'recordings')
order by started_at desc
limit 20;
```

## 2. `phone-processing-scheduled-sync` ← the pipeline drainer

- **Purpose:** for each enabled Simwood tenant, invoke `phone-process-pending`,
  which runs the idempotent **download → transcribe → analyse** pipeline for a
  safe batch, then produces the canonical interaction and publishes
  `interaction.ready` (see [EVENT_ARCHITECTURE.md](EVENT_ARCHITECTURE.md)).
- **Recommended cadence:** every **2 minutes** (see §Throughput).
- **Secret:** `PHONE_PROCESSING_SECRET`.

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/phone-processing-scheduled-sync" \
  -H "x-schedule-secret: $PHONE_PROCESSING_SECRET" \
  -H "content-type: application/json" -d '{}'
```

- **Expected success shape:**

```json
{
  "success": true,
  "tenants": 1,
  "results": [
    {
      "tenant_id": "…",
      "ok": true,
      "processed": 5,
      "downloaded": 5,
      "transcribed": 5,
      "analysed": 5,
      "failed": 0,
      "skipped": 0
    }
  ]
}
```

- **Verify (SQL):**

```sql
select sync_type, status, records_processed, error_message, metadata, started_at
from phone_sync_runs
where sync_type = 'pipeline'
order by started_at desc
limit 20;

select job_type, status, records_processed, last_error, result, created_at
from platform_jobs
where job_type like 'phone.%'
order by created_at desc
limit 20;
```

## 3. `email-scheduled-sync`

- **Purpose:** ingest recent Gmail (OAuth) messages for each connected mailbox.
- **Recommended cadence:** every **5 minutes**.
- **Secret:** `EMAIL_SCHEDULE_SECRET`.

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/email-scheduled-sync" \
  -H "x-schedule-secret: $EMAIL_SCHEDULE_SECRET" \
  -H "content-type: application/json" -d '{}'
```

- **Expected success shape:** `{ "success": true, "tenants": <n>, "results": [ … ] }`
- **Verify (SQL):**

```sql
select provider, status, records_processed, error_message, started_at
from email_sync_runs
order by started_at desc
limit 20;
```

## 4. `email-workspace-scheduled-sync`

- **Purpose:** ingest recent Google Workspace (domain-wide-delegation) mail for
  discovered mailboxes.
- **Recommended cadence:** every **5–10 minutes**.
- **Secret:** `EMAIL_WORKSPACE_SCHEDULE_SECRET`.

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/email-workspace-scheduled-sync" \
  -H "x-schedule-secret: $EMAIL_WORKSPACE_SCHEDULE_SECRET" \
  -H "content-type: application/json" -d '{}'
```

- **Expected success shape:** `{ "success": true, "tenants": <n>, "results": [ … ] }`
- **Verify:** same `email_sync_runs` query as §3.

## 5. `email-workspace-backfill-scheduled-sync`

- **Purpose:** page through **historical** Workspace mail (long-running backfill),
  one bounded chunk per tick.
- **Recommended cadence:** every **10–15 minutes** until backfill is complete,
  then disable.
- **Secret:** `EMAIL_WORKSPACE_BACKFILL_SECRET`.

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/email-workspace-backfill-scheduled-sync" \
  -H "x-schedule-secret: $EMAIL_WORKSPACE_BACKFILL_SECRET" \
  -H "content-type: application/json" -d '{}'
```

- **Expected success shape:** `{ "success": true, "tenants": <n>, "results": [ … ] }`
- **Verify:** `email_sync_runs` (look for the backfill `sync_type`).

## 6. `interactions-scheduled-sync`

- **Purpose:** refresh the canonical `interactions` timeline by projecting
  `phone_calls` + `email_messages` (idempotent upsert). Calls that already have an
  AI insight are marked **`ready`**; others stay `pending`.
- **Recommended cadence:** every **5 minutes**.
- **Secret:** `SIGNAL_SYNC_SECRET`.

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/interactions-scheduled-sync" \
  -H "x-schedule-secret: $SIGNAL_SYNC_SECRET" \
  -H "content-type: application/json" -d '{}'
```

- **Expected success shape:** `{ "success": true, "tenants": <n>, "results": [ … ] }`
- **Verify (SQL):**

```sql
select processing_status, count(*)
from interactions
group by processing_status
order by 1;
```

## 7. `identity-scheduled-sync`

- **Purpose:** run the Identity Engine (`identity-resolve`) as the **subscriber**
  to `interaction.ready`: it consumes `ready`/`pending` interactions, resolves
  who/company, enriches customer cards + recommendations, marks them `enriched`,
  and marks the event consumed.
- **Recommended cadence:** every **2–5 minutes**.
- **Secret:** `IDENTITY_SYNC_SECRET`.

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/identity-scheduled-sync" \
  -H "x-schedule-secret: $IDENTITY_SYNC_SECRET" \
  -H "content-type: application/json" -d '{}'
```

- **Expected success shape:** `{ "success": true, "tenants": <n>, "results": [ … ] }`
- **Verify (SQL):**

```sql
select status, count(*)
from platform_events
where event_type = 'interaction.ready'
group by status;

select job_type, status, records_processed, result, created_at
from platform_jobs
where job_type = 'identity.resolve'
order by created_at desc
limit 20;
```

---

## 8. `business-graph-scheduled-sync`

- **Purpose:** for each operational tenant, invoke `business-graph-sync`, which
  projects people/companies/customer_cards/interactions/recommendations into the
  Business Graph (`graph_nodes` / `graph_edges` / `graph_events`). Idempotent and
  additive — the source tables are never modified. See
  [BUSINESS_GRAPH.md](BUSINESS_GRAPH.md). Identity-resolve also best-effort
  triggers a sync on enrichment; this scheduler is the reliable backstop.
- **Recommended cadence:** every **5 minutes**.
- **Secret:** `GRAPH_SYNC_SECRET`.

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/business-graph-scheduled-sync" \
  -H "x-schedule-secret: $GRAPH_SYNC_SECRET" \
  -H "content-type: application/json" -d '{}'
```

- **Expected success shape:** `{ "success": true, "tenants": <n>, "results": [ { "tenant_id": "…", "ok": true, "nodes_upserted": <n>, "edges_upserted": <n>, "failed": 0 } ] }`
- **Verify (SQL):**

```sql
select node_type, count(*) from graph_nodes group by node_type order by 1;
select edge_type, count(*) from graph_edges group by edge_type order by 1;
select event_type, count(*) from graph_events group by event_type order by 1;
```

## 9. `customer-card-scheduled-sync`

- **Purpose:** for each operational tenant, invoke `customer-card-sync`, which
  projects the Business Graph + its source facts into
  `customer_cards.context.projection` (identity / communication / operations /
  business / timeline) with an explainable health + activity score. Runs AFTER
  the graph — the graph never waits on cards. See
  [CUSTOMER_CARD_ENGINE.md](CUSTOMER_CARD_ENGINE.md).
- **Recommended cadence:** every **5 minutes** (a minute or two behind the graph
  sync so it projects fresh graph data).
- **Secret:** `CARD_SYNC_SECRET`.

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/customer-card-scheduled-sync" \
  -H "x-schedule-secret: $CARD_SYNC_SECRET" \
  -H "content-type: application/json" -d '{}'
```

- **Expected success shape:** `{ "success": true, "tenants": <n>, "results": [ { "tenant_id": "…", "ok": true, "cards_projected": <n>, "failed": 0 } ] }`
- **Verify (SQL):**

```sql
select count(*) filter (where context ? 'projection') as projected,
       count(*)                                       as total
from customer_cards;

select id, status, context->'projection'->'business'->>'health'        as health,
       context->'projection'->'business'->>'activity_score'            as activity
from customer_cards
where context ? 'projection'
order by updated_at desc
limit 20;
```

## 10. `recommendation-scheduled-sync`

- **Purpose:** for each operational tenant, invoke `recommendation-sync`, which
  applies deterministic rules to customer-card projections and writes explainable
  recommendations. Runs AFTER customer-card sync (Graph → Cards → Recommendations
  → My Day). No AI, no auto-execution. See
  [RECOMMENDATION_ENGINE.md](RECOMMENDATION_ENGINE.md).
- **Recommended cadence:** every **5 minutes** (a step behind the card sync).
- **Secret:** `RECOMMENDATION_SYNC_SECRET`.

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/recommendation-scheduled-sync" \
  -H "x-schedule-secret: $RECOMMENDATION_SYNC_SECRET" \
  -H "content-type: application/json" -d '{}'
```

- **Expected success shape:** `{ "success": true, "tenants": <n>, "results": [ { "tenant_id": "…", "ok": true, "created": <n>, "updated": <n>, "closed": <n>, "failed": 0 } ] }`
- **Verify (SQL):**

```sql
select type, priority, status, count(*)
from (select type, severity as priority, status from recommendations) r
group by type, priority, status
order by type, priority, status;
```

## Throughput recommendation (phone processing)

The phone pipeline downloads audio, calls OpenAI transcription, then OpenAI
analysis — **serially per recording** inside `phone-process-pipeline`. The
backlog drainer (`phone-process-pending`) processes a **safe small batch** to
stay well under the Edge Function wall-clock, and repeated cron ticks drain the
rest. Prefer reliable small batches over unreliable big ones.

**Recommended settings:**

| Setting                      | Value               | Why                                                                                                 |
| ---------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| Batch size (`DEFAULT_BATCH`) | **5** (max 10)      | 5 serial download+transcribe+analyse chains fit comfortably in one invocation                       |
| Processor cadence            | **every 2 minutes** | 5 recordings / 2 min ≈ **150/hour** drain rate — ample for a single-branch installer, with headroom |
| Per-recording work           | **serial**          | Bounded, predictable wall-clock; avoids OpenAI rate spikes and partial-batch failures               |
| Ordering                     | **newest first**    | Live intelligence stays fresh; the tail drains behind it                                            |

**Drain math:** with batch 5 every 2 min, a 200-item backlog clears in ~80
minutes. If backlogs routinely exceed that, raise cadence to every 1 minute
before raising the batch size — more frequent small batches degrade more
gracefully than larger ones. The live drain rate, oldest-pending age and
estimated catch-up time are shown in **Admin › Phone Operations** (and summarised
in the Operations Centre "Phone system" card), computed by
`phone-pipeline-status` — the single source of truth.

Do **not** blow the function limits: keep work serial, keep the batch small, and
let the scheduler do the repetition.

---

## Troubleshooting: `invalid_auth` / "Invalid or expired session"

The internal pipeline is **service-role only**: `phone-process-pending` →
`phone-process-pipeline` → `simwood-download-recording` / `phone-transcribe-recording`
/ `phone-analyse-transcript`, and `simwood-sync-recordings`'s background trigger,
**all** invoke siblings with `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` as the
bearer plus an `x-internal-tenant-id` header ([_shared/phone_pipeline.ts](../supabase/functions/_shared/phone_pipeline.ts)).
No user JWT is ever forwarded. So a pipeline run failing with
`invalid_auth` / "Invalid or expired session" means one of two things:

1. **It's stale** — a failure from before the service-role migration, still shown
   as "latest". `phone-pipeline-status` now returns `last_failure_is_current`
   (true only when the latest failure is newer than the latest success); the UI
   shows non-current failures as resolved history. Confirm with:

   ```sql
   select
     max(started_at) filter (where status = 'success') as last_success,
     max(started_at) filter (where status = 'failed')  as last_failure
   from phone_sync_runs
   where sync_type = 'pipeline';
   -- last_success newer than last_failure ⇒ the invalid_auth is resolved history.
   ```

2. **The service-role key isn't matching at runtime** — rotated key, or a project
   on the newer non-JWT secret-key format that the gateway rejects. `authz.ts` now
   returns a **distinct** `internal_auth_mismatch` code in this case (instead of
   the misleading "expired session"), which surfaces in the trace. If a NEW run's
   `trace.error_code` is `internal_auth_mismatch`, the fix is to realign the
   service-role key, or set `verify_jwt = false` for the pipeline child functions
   in [config.toml](../supabase/config.toml) so the gateway doesn't pre-reject the
   service-role bearer (authz still fully enforces auth inside the function).

Each pipeline run records a safe per-step trace in `phone_sync_runs.metadata.trace`
(`download`/`transcribe`/`analyse`/`interaction`/`event` status, `failed_step`,
`error_code`, `error_message_safe`) — no transcript/audio content, no secrets:

```sql
select started_at, status, metadata->'trace' as trace
from phone_sync_runs
where sync_type = 'pipeline'
order by started_at desc
limit 10;
```

## Full verification SQL (copy/paste)

```sql
-- Recording download progress (today)
select count(*)                                              as recordings_total,
       count(*) filter (where storage_path is not null)      as downloaded,
       count(*) filter (where storage_path is null)          as not_downloaded
from phone_recordings
where started_at >= date_trunc('day', now());

-- Transcript status distribution
select status, count(*)
from phone_transcripts
group by status;

-- AI insight count
select count(*) from phone_ai_insights;

-- Recent pipeline runs
select sync_type, status, records_processed, error_message, metadata, started_at
from phone_sync_runs
where sync_type = 'pipeline'
order by started_at desc
limit 20;

-- Recent phone platform jobs
select job_type, status, records_processed, last_error, created_at
from platform_jobs
where job_type like 'phone.%'
order by created_at desc
limit 20;

-- Event bus: interaction.ready fan-out state
select status, count(*)
from platform_events
where event_type = 'interaction.ready'
group by status;

-- Canonical interaction lifecycle
select processing_status, count(*)
from interactions
group by processing_status
order by 1;
```
