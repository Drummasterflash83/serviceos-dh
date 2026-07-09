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
