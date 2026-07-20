# Scheduler Operations

**Status:** Canonical operational runbook. Every cron-driven scheduled function in
ServiceOS, the schedule secret that gates it, its cadence, a test curl, the
expected success shape, and the verification SQL, plus how the cron itself is
deployed as config-as-code (pg_cron + pg_net + Vault) via
`serviceos_schedule_all()`.

**Applies to:** the `serviceos-backend-foundation` branch (the real Supabase
Intelligence to Automation backend).

> This document contains **no secret values**, only secret _names_. Set real
> values with `npx supabase secrets set …` and in Vault with
> `vault.create_secret(…)`; never commit them.
>
> Cross-references:
> [../architecture/00_GLOSSARY.md](../architecture/00_GLOSSARY.md) (vocabulary
> authority), [./OBSERVABILITY_HEALTH.md](./OBSERVABILITY_HEALTH.md) (the
> authority for cadence-versus-staleness and the scheduler-health model),
> [./VERIFICATION_AND_ACCEPTANCE.md](./VERIFICATION_AND_ACCEPTANCE.md) (acceptance
> gates), [../reference/BACKEND_RUNTIME.md](../reference/BACKEND_RUNTIME.md) (the
> `platform-worker` queue runtime),
> [../reference/EVENT_ARCHITECTURE.md](../reference/EVENT_ARCHITECTURE.md) (the
> `platform_events` bus).

---

## Current reality: the cron exists and is versioned

The cron **is defined in this repository** as config-as-code. Any older note that
claimed "there is no cron definition anywhere in this repository" is stale and has
been retired: the schedule, its helpers, and its config table are shipped by
migration
[`20260709180000_scheduler_cron.sql`](../../supabase/migrations/20260709180000_scheduler_cron.sql)
and extended by
[`20260803120000_intelligence_activation.sql`](../../supabase/migrations/20260803120000_intelligence_activation.sql).

The scheduled functions (`*-scheduled-sync`) are secret-gated HTTP endpoints. A
timer must POST to them. That timer is **pg_cron inside Postgres**: each cron row
calls `net.http_post(...)` (pg_net) with an `x-schedule-secret` header whose value
is read from **Supabase Vault** at run time. Nothing runs until an operator enables
the extensions, loads the secrets, sets the base URL, and runs
`serviceos_schedule_all()` (see [Deploying the cron](#deploying-the-cron-config-as-code)).

---

## How scheduled functions are secured

Every scheduled function runs with **no Supabase user session** (cron carries no
JWT), so each is deployed with `verify_jwt = false` (declared in
[../../supabase/config.toml](../../supabase/config.toml)) and instead trusts a
shared secret in the **`x-schedule-secret`** header. The function compares it
against its own env secret and returns:

- `403` (`forbidden` / "Invalid or missing x-schedule-secret") on mismatch.
- `500` (`config_error`) when the env secret is not configured.

It then does its work **server-to-server** for every enabled tenant using the
service-role key. One failing tenant never aborts the others; a missed tick simply
resumes on the next run. The internal pipeline children (invoked with the
service-role key plus an `x-internal-tenant-id` header) surface `invalid_auth` or
the distinct `internal_auth_mismatch` code when the service-role key is not
matching at the gateway; see [Troubleshooting](#troubleshooting).

---

## Canonical cadence and secret table

This is the single authoritative table. Cadence values are taken from the live
`serviceos_schedule_defs()` (the cron migrations), which is the authority for what
actually fires. **[./OBSERVABILITY_HEALTH.md](./OBSERVABILITY_HEALTH.md) is the
authority for cadence-versus-staleness** (the "never / stale / healthy" grace
windows the Operations Centre draws from these cadences); if a cadence changes,
reconcile it there.

| Cron job | Function | Cadence | Schedule secret |
| --- | --- | --- | --- |
| `serviceos-worker` | `platform-worker` | `* * * * *` (every 1 min) | `WORKER_SECRET` |
| `serviceos-phone-sync` | `phone-scheduled-sync` | `*/5 * * * *` | `PHONE_SCHEDULE_SECRET` |
| `serviceos-phone-processing` | `phone-processing-scheduled-sync` | `*/2 * * * *` | `PHONE_PROCESSING_SECRET` |
| `serviceos-email-sync` | `email-scheduled-sync` | `*/5 * * * *` | `EMAIL_SCHEDULE_SECRET` |
| `serviceos-email-workspace` | `email-workspace-scheduled-sync` | `*/5 * * * *` | `EMAIL_WORKSPACE_SCHEDULE_SECRET` |
| `serviceos-email-wksp-backfill` | `email-workspace-backfill-scheduled-sync` | `*/15 * * * *` | `EMAIL_WORKSPACE_BACKFILL_SECRET` |
| `serviceos-interactions` | `interactions-scheduled-sync` | `*/5 * * * *` | `SIGNAL_SYNC_SECRET` |
| `serviceos-identity` | `identity-scheduled-sync` | `*/5 * * * *` | `IDENTITY_SYNC_SECRET` |
| `serviceos-business-graph` | `business-graph-scheduled-sync` | `*/5 * * * *` | `GRAPH_SYNC_SECRET` |
| `serviceos-customer-cards` | `customer-card-scheduled-sync` | `*/5 * * * *` | `CARD_SYNC_SECRET` |
| `serviceos-recommendations` | `recommendation-scheduled-sync` | `*/5 * * * *` | `RECOMMENDATION_SYNC_SECRET` |
| `serviceos-intelligence-ingest` | `intelligence-ingestion-scheduled-sync` | `*/5 * * * *` | `INTELLIGENCE_INGEST_SECRET` |

All functions additionally require the platform secrets `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` (auto-injected). Phone and email ingest and the AI
steps also need their provider secrets (`SIMWOOD_USERNAME` / `SIMWOOD_PASSWORD`,
`OPENAI_API_KEY`, the Google Workspace and Gmail OAuth keys); see the ingest specs.

### Two stranded-alias / counting notes (read these once)

- **`SIGNAL_SYNC_SECRET` is a stranded alias.** It gates
  `interactions-scheduled-sync` (the refresh of the canonical `interactions`
  timeline). It is **not** a distinct "Signal" object. Per
  [../architecture/00_GLOSSARY.md](../architecture/00_GLOSSARY.md), a Signal is a
  single raw input captured as an **Interaction** row; the secret name predates
  that reconciliation. Do not read it as a separate engine or table.

- **`serviceos-worker` is a cron row but not a "scheduler".** It is the queue
  worker: the single `platform-worker` process that claims jobs off the
  `platform_jobs` queue and runs handlers
  ([../reference/BACKEND_RUNTIME.md](../reference/BACKEND_RUNTIME.md)). It is a
  runtime **Worker**, never a product **Agent**, and never one of the
  ingest/projection **schedulers**. This is why the counts differ: the original
  cron migration shipped **10 schedulers** (11 cron rows once the worker is
  counted); the current `serviceos_schedule_defs()` returns **12 cron rows** =
  1 worker + 11 schedulers, `serviceos-intelligence-ingest` having been added by
  the `20260803120000` migration. When a doc says "10 schedulers, 11 cron rows",
  it is counting the worker as the extra row.

> Two further `*-scheduled-sync` functions exist in the repository but are **not**
> yet in `serviceos_schedule_defs()`: `automation-execution-scheduled-sync`
> (`AUTOMATION_EXEC_SECRET`) and `objective-evaluation-scheduled-sync`
> (`OBJECTIVE_EVAL_SECRET`). They are secret-gated the same way but are invoked
> manually or by a future schedule extension; add them to the defs when they go
> onto a timer.

---

## Deploying the cron (config-as-code)

The schedule, its helpers, and its config table are shipped by migration
[`20260709180000_scheduler_cron.sql`](../../supabase/migrations/20260709180000_scheduler_cron.sql)
and superseded by
[`20260803120000_intelligence_activation.sql`](../../supabase/migrations/20260803120000_intelligence_activation.sql).
What the migrations create:

- **`scheduler_config`** — a one-row table holding this project's Edge Functions
  `base_url`.
- **`serviceos_schedule_defs()`** — the versioned schedule (job name, function,
  secret, cron expression). This is the authoritative source for cadence.
- **`serviceos_schedule_all(base_url?)`** — (re)schedules every job. Idempotent
  (it unschedules each job by name, then reschedules).
- **`serviceos_unschedule_all()`** — pauses/removes every job. Idempotent.

The migration is **non-destructive and schedules nothing on apply.** Every
`cron` / `pg_net` / `vault` reference inside the helpers is dynamic SQL, so the
migration applies cleanly even before those extensions are enabled. Scheduling
happens only when an operator runs `serviceos_schedule_all()`. **No secret is in
the repo:** the cron body reads each `x-schedule-secret` from
`vault.decrypted_secrets` at run time.

### 1. Apply the migration

```bash
npx supabase db push
```

### 2. Enable the extensions (once)

Supabase → Database → Extensions → enable **`pg_cron`** and **`pg_net`**, or:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

### 3. Set each schedule secret in BOTH stores (they must match)

Each `x-schedule-secret` value must exist in **two** places, with the **same**
value, or the function returns `403`:

1. **Edge Function env** (so the function can compare the header):

   ```bash
   npx supabase secrets set WORKER_SECRET="…"
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
   npx supabase secrets set INTELLIGENCE_INGEST_SECRET="…"
   ```

2. **Postgres Vault** (so the cron job can send the header). In the SQL editor:

   ```sql
   select vault.create_secret('<same-value>', 'WORKER_SECRET');
   select vault.create_secret('<same-value>', 'PHONE_SCHEDULE_SECRET');
   select vault.create_secret('<same-value>', 'PHONE_PROCESSING_SECRET');
   select vault.create_secret('<same-value>', 'EMAIL_SCHEDULE_SECRET');
   select vault.create_secret('<same-value>', 'EMAIL_WORKSPACE_SCHEDULE_SECRET');
   select vault.create_secret('<same-value>', 'EMAIL_WORKSPACE_BACKFILL_SECRET');
   select vault.create_secret('<same-value>', 'SIGNAL_SYNC_SECRET');
   select vault.create_secret('<same-value>', 'IDENTITY_SYNC_SECRET');
   select vault.create_secret('<same-value>', 'GRAPH_SYNC_SECRET');
   select vault.create_secret('<same-value>', 'CARD_SYNC_SECRET');
   select vault.create_secret('<same-value>', 'RECOMMENDATION_SYNC_SECRET');
   select vault.create_secret('<same-value>', 'INTELLIGENCE_INGEST_SECRET');
   -- rotate later:
   -- select vault.update_secret((select id from vault.secrets where name='…'), '<new>');
   ```

Generate values with `openssl rand -hex 32`. If the two stores disagree, the
scheduler gets `403 forbidden` (see [Troubleshooting](#troubleshooting)).

### 4. Set the base URL and schedule everything

```sql
insert into scheduler_config (base_url)
values ('https://<project-ref>.functions.supabase.co')
on conflict (id) do update set base_url = excluded.base_url, updated_at = now();

select serviceos_schedule_all();
-- returns e.g. "Scheduled 12 ServiceOS cron jobs against …"
```

`serviceos_schedule_all()` is idempotent: re-run it any time (for example after a
cadence change) and it reschedules cleanly.

### Verify the cron is registered and succeeding

```sql
-- registered?
select jobid, jobname, schedule, active
from cron.job
where jobname like 'serviceos-%'
order by jobname;
-- expect one row per cron job above, active = true

-- actually running and succeeding?
select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname like 'serviceos-%'
order by d.start_time desc
limit 40;
-- status 'succeeded' with a recent start_time = healthy
```

### Pause / rollback

```sql
-- pause ONE cron job (keep it, stop it firing)
update cron.job set active = false where jobname = 'serviceos-phone-processing';
update cron.job set active = true  where jobname = 'serviceos-phone-processing';

-- remove ONE
select cron.unschedule('serviceos-phone-processing');

-- pause / remove ALL ServiceOS cron jobs (idempotent)
select serviceos_unschedule_all();
```

Removing the cron stops automatic processing; the manual override buttons in Admin
still work, and nothing is destroyed. Re-run `serviceos_schedule_all()` to restore.

> **Why there is no `scheduler_runs` table.** Run visibility already lives in three
> layers: `cron.job_run_details` (each cron POST), `platform_jobs` (each worker's
> durable job row with records processed, result, errors), and
> `phone_sync_runs` / `email_sync_runs` (per-connector sync-run history including
> the phone pipeline `trace`). The Operations Centre scheduler-health card consumes
> these, so no extra table is added.

---

## Per-function reference

For each scheduled function: purpose, cadence, secret, a direct test curl, the
expected success shape, and the verification SQL. Calling convention: the function
is `verify_jwt = false`, so no `Authorization` bearer is needed, only the
`x-schedule-secret`. If the gateway rejects the request before it reaches the
function, also add `-H "apikey: $SUPABASE_ANON_KEY"`. `$SUPABASE_URL` is your
project URL (or the `https://<project-ref>.functions.supabase.co` host).

### `platform-worker` (the queue worker, not a scheduler)

- **Purpose:** claim jobs off the `platform_jobs` queue and run their handlers
  (`phone.process_pending`, `interactions.sync`, `identity.resolve`, `graph.sync`,
  `customer_card.sync`, `recommendation.sync`, and so on). Runtime **Worker**, not
  a product Agent. See [../reference/BACKEND_RUNTIME.md](../reference/BACKEND_RUNTIME.md).
- **Cadence:** every **1 minute**. **Secret:** `WORKER_SECRET`.
- **Verify (SQL):**

  ```sql
  select job_type, status, records_processed, last_error, max(created_at) as last_run
  from platform_jobs
  group by job_type, status, records_processed, last_error
  order by max(created_at) desc
  limit 40;
  ```

### 1. `phone-scheduled-sync`

- **Purpose:** for each enabled Simwood tenant, invoke `simwood-sync-calls` then
  `simwood-sync-recordings` (recording metadata; downloads happen in the processing
  pipeline, not here).
- **Cadence:** every **5 minutes**. **Secret:** `PHONE_SCHEDULE_SECRET`.

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

### 2. `phone-processing-scheduled-sync` (the pipeline drainer)

- **Purpose:** for each enabled Simwood tenant, invoke `phone-process-pending`,
  which runs the idempotent **download → transcribe → analyse** pipeline for a safe
  batch, produces the canonical interaction, and publishes `interaction.ready`.
- **Cadence:** every **2 minutes** (see [Throughput](#throughput-phone-processing)).
  **Secret:** `PHONE_PROCESSING_SECRET`.

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
    { "tenant_id": "…", "ok": true, "processed": 5, "downloaded": 5,
      "transcribed": 5, "analysed": 5, "failed": 0, "skipped": 0 }
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

### 3. `email-scheduled-sync`

- **Purpose:** ingest recent Gmail (OAuth) messages for each connected mailbox.
- **Cadence:** every **5 minutes**. **Secret:** `EMAIL_SCHEDULE_SECRET`.

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

### 4. `email-workspace-scheduled-sync`

- **Purpose:** ingest recent Google Workspace (domain-wide-delegation) mail for
  discovered mailboxes.
- **Cadence:** every **5 minutes**. **Secret:** `EMAIL_WORKSPACE_SCHEDULE_SECRET`.

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/email-workspace-scheduled-sync" \
  -H "x-schedule-secret: $EMAIL_WORKSPACE_SCHEDULE_SECRET" \
  -H "content-type: application/json" -d '{}'
```

- **Expected success shape:** `{ "success": true, "tenants": <n>, "results": [ … ] }`
- **Verify:** same `email_sync_runs` query as §3.

### 5. `email-workspace-backfill-scheduled-sync`

- **Purpose:** page through **historical** Workspace mail (long-running backfill),
  one bounded chunk per tick.
- **Cadence:** every **15 minutes** until backfill is complete, then disable.
  **Secret:** `EMAIL_WORKSPACE_BACKFILL_SECRET`.

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/email-workspace-backfill-scheduled-sync" \
  -H "x-schedule-secret: $EMAIL_WORKSPACE_BACKFILL_SECRET" \
  -H "content-type: application/json" -d '{}'
```

- **Expected success shape:** `{ "success": true, "tenants": <n>, "results": [ … ] }`
- **Verify:** `email_sync_runs` (look for the backfill `sync_type`).

### 6. `interactions-scheduled-sync`

- **Purpose:** refresh the canonical `interactions` timeline by projecting
  `phone_calls` + `email_messages` (idempotent upsert). Calls that already have an
  AI insight are marked **`ready`**; others stay `pending`.
- **Cadence:** every **5 minutes**. **Secret:** `SIGNAL_SYNC_SECRET` (a stranded
  alias: it gates the interactions sync, not a distinct "Signal" object).

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

### 7. `identity-scheduled-sync`

- **Purpose:** run the Identity Engine (`identity-resolve`) as the subscriber to
  `interaction.ready`: consume `ready`/`pending` interactions oldest-first, resolve
  who/company, enrich customer cards + recommendations, mark them `enriched`, and
  mark the event consumed.
- **Cadence:** every **5 minutes**. **Secret:** `IDENTITY_SYNC_SECRET`.

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

### 8. `business-graph-scheduled-sync`

- **Purpose:** for each operational tenant, invoke `business-graph-sync`, which
  projects people/companies/customer_cards/interactions/recommendations into the
  Business Graph (`graph_nodes` / `graph_edges` / `graph_events`). Idempotent and
  additive; the source tables are never modified.
- **Cadence:** every **5 minutes**. **Secret:** `GRAPH_SYNC_SECRET`.

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

### 9. `customer-card-scheduled-sync`

- **Purpose:** for each operational tenant, invoke `customer-card-sync`, which
  projects the Business Graph + its source facts into
  `customer_cards.context.projection` (identity / communication / operations /
  business / timeline) with an explainable health + activity score. Runs after the
  graph.
- **Cadence:** every **5 minutes** (a step behind the graph sync). **Secret:**
  `CARD_SYNC_SECRET`.

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

select id, status,
       context->'projection'->'business'->>'health'         as health,
       context->'projection'->'business'->>'activity_score' as activity
from customer_cards
where context ? 'projection'
order by updated_at desc
limit 20;
```

### 10. `recommendation-scheduled-sync`

- **Purpose:** for each operational tenant, invoke `recommendation-sync`, which
  applies deterministic rules to customer-card projections and writes explainable
  recommendations. Runs after customer-card sync (Graph → Cards → Recommendations).
  No AI, no auto-execution.
- **Cadence:** every **5 minutes** (a step behind the card sync). **Secret:**
  `RECOMMENDATION_SYNC_SECRET`.

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/recommendation-scheduled-sync" \
  -H "x-schedule-secret: $RECOMMENDATION_SYNC_SECRET" \
  -H "content-type: application/json" -d '{}'
```

- **Expected success shape:** `{ "success": true, "tenants": <n>, "results": [ { "tenant_id": "…", "ok": true, "created": <n>, "updated": <n>, "closed": <n>, "failed": 0 } ] }`
- **Verify (SQL):**

```sql
select type, severity as priority, status, count(*)
from recommendations
group by type, severity, status
order by type, priority, status;
```

### 11. `intelligence-ingestion-scheduled-sync`

- **Purpose:** for each tenant, run the Intelligence / Observation bridge over a
  bounded batch of eligible interactions (`PER_TENANT_LIMIT = 25` per tick,
  self-healing over successive runs), queueing observations into the
  `intelligence_ingestions` ledger and `intelligence_objects`. See
  [../architecture/00_GLOSSARY.md](../architecture/00_GLOSSARY.md) for the
  Observation vocabulary.
- **Cadence:** every **5 minutes**. **Secret:** `INTELLIGENCE_INGEST_SECRET`.

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/intelligence-ingestion-scheduled-sync" \
  -H "x-schedule-secret: $INTELLIGENCE_INGEST_SECRET" \
  -H "content-type: application/json" -d '{}'
```

- **Expected success shape:** `{ "success": true, "tenants": <n>, "candidates": <n>, "queued": <n>, "duplicates": <n> }`
- **Verify (SQL):**

```sql
select object_type, count(*) from intelligence_objects group by object_type order by 1;
select outcome, count(*) from intelligence_ingestions group by outcome order by 1;
```

---

## Throughput (phone processing)

The phone pipeline downloads audio, calls OpenAI transcription, then OpenAI
analysis, **serially per recording**. The drainer (`phone-process-pending`)
processes a **safe small batch** so a backlog clears over several ticks rather than
one huge run. Prefer reliable small batches over unreliable big ones.

| Setting | Value | Why |
| --- | --- | --- |
| Batch size (`DEFAULT_BATCH`) | **5** (max 10) | 5 serial download+transcribe+analyse chains fit one invocation |
| Processor cadence | **every 2 minutes** | 5 recordings / 2 min ≈ 150/hour drain, ample for a single branch |
| Per-recording work | **serial** | Bounded, predictable wall-clock; avoids OpenAI rate spikes |
| Ordering | **newest first** | Live intelligence stays fresh; the tail drains behind it |

**Drain math:** batch 5 every 2 min clears a 200-item backlog in ~80 minutes. If
backlogs routinely exceed that, raise cadence to every 1 minute before raising the
batch size. Live drain rate, oldest-pending age and estimated catch-up time appear
in **Admin › Phone Operations**, computed by `phone-pipeline-status`.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `serviceos_schedule_all()` returns "pg_cron/pg_net is not installed" | extensions off | enable them (step 2), re-run |
| returns "No base_url set" | `scheduler_config` empty | step 4 |
| `cron.job_run_details.status = 'failed'` | check `return_message` | usually a bad/missing Vault secret or wrong base_url |
| function responds `403 forbidden` | Vault value ≠ Edge env value | re-set both to the same value (step 3) |
| function responds `500 config_error` | the env secret is not set | `npx supabase secrets set <NAME>=…`, redeploy |
| function responds `invalid_auth` / "Invalid or expired session" | service-role / gateway | confirm `verify_jwt = false` deploy; see below |
| a NEW pipeline run's `trace.error_code` is `internal_auth_mismatch` | service-role key not matching at the gateway | realign the service-role key, confirm the deploy |
| scheduler shows "never" in Ops Centre | cron not running yet | verify `cron.job` + `cron.job_run_details` |

**`invalid_auth` on the phone pipeline is usually stale.** The internal chain
forwards **no** user JWT; children are invoked with the service-role key plus an
`x-internal-tenant-id` header. A run failing `invalid_auth` is either a failure
from before the service-role fix (still shown as "latest") or a genuine key/gateway
mismatch (surfaced as the distinct `internal_auth_mismatch`). Confirm which:

```sql
select
  max(started_at) filter (where status = 'success') as last_success,
  max(started_at) filter (where status = 'failed')  as last_failure
from phone_sync_runs
where sync_type = 'pipeline';
-- last_success newer than last_failure ⇒ the invalid_auth is resolved history.
```

Each pipeline run records a safe per-step trace (no transcript/audio, no secrets)
in `phone_sync_runs.metadata.trace`
(`download`/`transcribe`/`analyse`/`interaction`/`event` status, `failed_step`,
`error_code`, `error_message_safe`):

```sql
select started_at, status, metadata->'trace' as trace
from phone_sync_runs
where sync_type = 'pipeline'
order by started_at desc
limit 10;
```

---

## Verification: end-to-end input proof (phone and email)

Once the cron is live, one call and one email must flow all the way through with no
manual button press. These are the acceptance proofs; see
[./VERIFICATION_AND_ACCEPTANCE.md](./VERIFICATION_AND_ACCEPTANCE.md) for the wider
acceptance gates and [./OBSERVABILITY_HEALTH.md](./OBSERVABILITY_HEALTH.md) for the
health model that reads these same watermarks.

### Per-scheduler freshness (are the crons actually feeding the app?)

```sql
select sync_type, status, max(started_at) as last_run
from phone_sync_runs group by sync_type, status order by 1;

select provider, status, max(started_at) as last_run
from email_sync_runs group by provider, status order by 1;

select job_type, status, max(created_at) as last_run
from platform_jobs group by job_type, status order by 1;
```

"never" means the cron is not configured yet, not that code is broken.

### Phone end-to-end proof

Pick one pending recording and trace it through the whole chain.

```sql
-- 0) choose a recording that still needs work
select id, provider_call_id, started_at, storage_path
from phone_recordings where storage_path is null
order by started_at desc limit 1;

-- 1) audio downloaded → storage_path set
select id, storage_path is not null as downloaded
from phone_recordings where id = '<REC_ID>';

-- 2) transcript created
select status, length(transcript_text) as chars
from phone_transcripts where recording_id = '<REC_ID>';

-- 3) AI insight created (call_id back-filled)
select id, call_id, intent, urgency, sentiment
from phone_ai_insights where recording_id = '<REC_ID>';

-- 4) the per-run trace (self-diagnosing; safe, no content/secrets)
select started_at, status, metadata->'trace' as trace
from phone_sync_runs
where sync_type = 'pipeline' and metadata->>'recording_id' = '<REC_ID>'
order by started_at desc limit 5;

-- 5) interaction.ready published
select pe.status, pe.published_at
from platform_events pe
join interactions i on i.id = pe.subject_id
join phone_calls c on c.id = i.source_id
where c.provider_call_id = '<PROVIDER_CALL_ID>'
  and pe.event_type = 'interaction.ready';

-- 6) canonical interaction ready/enriched
select i.processing_status, i.related_person_id, i.related_company_id
from interactions i join phone_calls c on c.id = i.source_id
where c.provider_call_id = '<PROVIDER_CALL_ID>';

-- 7) identity → graph → customer card
select n.node_type, count(*) from graph_nodes n group by 1;
select cc.id, cc.status, cc.context ? 'projection' as projected
from customer_cards cc where cc.person_id = '<PERSON_ID>';
```

**Pass** = downloaded → transcript `completed` → insight row → `interaction.ready`
consumed → interaction `enriched` → a `customer_card` with a `projection`.

### Email end-to-end proof

```sql
-- 1) message ingested
select id, provider_message_id, from_email, received_at
from email_messages order by received_at desc limit 1;

-- 2) projected to a canonical interaction (interactions-scheduled-sync)
select processing_status, related_person_id from interactions
where source_table = 'email_messages' and source_id = '<EMAIL_MSG_ID>';

-- 3) identity resolved → enriched
select processing_status, related_person_id, related_company_id from interactions
where source_table = 'email_messages' and source_id = '<EMAIL_MSG_ID>';

-- 4) graph + customer card
select cc.id, cc.status, cc.context ? 'projection' as projected
from customer_cards cc where cc.person_id = '<PERSON_ID>';
```

**Pass** = message row → interaction `pending` → `enriched` → customer card with a
projection. No "Build timeline" click is required once
`interactions-scheduled-sync` is on a cron.

### Connector health (are the resolved errors genuinely current?)

```sql
-- Gmail OAuth token expiry
select email_address, status, token_expires_at, last_error
from email_accounts where provider = 'gmail';

-- Workspace (DWD) delegation
select email_address, enabled from google_workspace_mailboxes order by 1;
```

A past `last_error` with a **newer** successful `email_sync_runs` row is resolved,
not current; the connector health treats it as such.

---

## Safety (how the schedulers stay safe)

- **Non-destructive:** schedulers only read + upsert; the Recommendation Engine
  auto-close is a soft `status='resolved'`. No deletes, no messages, no outbound
  customer contact.
- **Idempotent:** every function dedupes/upserts, so a double tick converges.
- **Failure-isolated:** one failing tenant or record never aborts the batch; a
  missed tick resumes next run.
- **Bounded:** small batches, no self-re-invocation, no infinite loops; the cron
  supplies the repetition.
- **No secret leaks:** secrets live in Vault / Edge env, never in logs, payloads,
  evidence, or this repo.
