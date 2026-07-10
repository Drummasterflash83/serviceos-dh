# ServiceOS — Scheduler Deployment

**Status:** Deployment runbook. Turns the `*-scheduled-sync` functions into real,
automatic, verifiable cron jobs using **pg_cron + pg_net**, config-as-code.

**Last updated:** 2026-07-09

> Companion to [INPUT_RELIABILITY.md](INPUT_RELIABILITY.md) (why this is needed) and
> [SCHEDULERS.md](SCHEDULERS.md) (per-scheduler reference + test curls). The
> versioned schedule + helpers live in migration
> [`20260709180000_scheduler_cron.sql`](../supabase/migrations/20260709180000_scheduler_cron.sql).

---

## What the migration ships (and what it does NOT do)

The migration is **non-destructive and does not schedule anything on apply**. It
only creates:

- `scheduler_config` — a one-row table holding this project's Edge Functions
  `base_url`.
- `serviceos_schedule_defs()` — the versioned schedule (job name, function,
  secret, cron expression) for all 10 schedulers.
- `serviceos_schedule_all(base_url?)` — (re)schedules every job. Idempotent.
- `serviceos_unschedule_all()` — pauses/removes every job. Idempotent.

Every `cron` / `pg_net` / `vault` reference inside the helpers is **dynamic SQL**,
so the migration applies cleanly **even before pg_cron/pg_net/Vault are enabled**.
Scheduling happens only when _you_ run `serviceos_schedule_all()`.

**No secrets are in the repo.** The cron body reads each `x-schedule-secret` from
**Supabase Vault** at run time.

---

## Step-by-step

### 1. Apply the migration

```bash
npx supabase db push          # applies 20260709180000_scheduler_cron.sql
```

### 2. Enable the extensions (once)

Supabase → Database → Extensions → enable **`pg_cron`** and **`pg_net`**. Or via SQL:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

### 3. Set the secrets — in BOTH places (they must match)

Each `x-schedule-secret` value must exist in **two** stores, with the **same
value**:

1. **Edge Function env** (so the function can compare the header):
   ```bash
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
   npx supabase secrets set WORKER_SECRET="…"
   ```
2. **Postgres Vault** (so the cron job can send the header). In the SQL editor:
   ```sql
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
   select vault.create_secret('<same-value>', 'WORKER_SECRET');
   -- to rotate later: select vault.update_secret((select id from vault.secrets where name='…'), '<new>');
   ```

> Generate values with `openssl rand -hex 32`. Never commit them. If the two
> stores disagree, the scheduler gets `403 forbidden` (the function rejects the
> header) — see Troubleshooting.

### 4. Set the base URL + schedule everything

```sql
insert into scheduler_config (base_url)
values ('https://<project-ref>.functions.supabase.co')
on conflict (id) do update set base_url = excluded.base_url, updated_at = now();

select serviceos_schedule_all();   -- returns e.g. "Scheduled 10 ServiceOS cron jobs against …"
```

`serviceos_schedule_all()` is idempotent — re-run it any time (e.g. after a cadence
change) and it re-schedules cleanly.

---

## Verify

### Cron jobs are registered

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname like 'serviceos-%'
order by jobname;
-- expect 10 rows, active = true
```

### Cron jobs are actually running + succeeding

```sql
select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname like 'serviceos-%'
order by d.start_time desc
limit 40;
-- status 'succeeded' with recent start_time = healthy
```

### The application saw the work (per-scheduler freshness)

```sql
select sync_type, status, max(started_at) as last_run from phone_sync_runs group by 1 order by 1;
select provider, sync_type, status, max(started_at) as last_run from email_sync_runs group by 1,2,3 order by 1;
select job_type, status, max(created_at) as last_run from platform_jobs group by 1,2 order by 1;
```

The **Operations Centre → Scheduler health** card reads these watermarks and shows
each of the 10 schedulers as **never / stale / healthy** (4× cadence grace). No
fake healthy states — "never" means the cron isn't running yet.

---

## Cadence (as scheduled)

| Cron job                        | Function                                  | Cadence | Secret                            |
| ------------------------------- | ----------------------------------------- | ------- | --------------------------------- |
| `serviceos-worker`              | `platform-worker`                         | \* (1m) | `WORKER_SECRET`                   |
| `serviceos-phone-sync`          | `phone-scheduled-sync`                    | */5     | `PHONE_SCHEDULE_SECRET`           |
| `serviceos-phone-processing`    | `phone-processing-scheduled-sync`         | */2     | `PHONE_PROCESSING_SECRET`         |
| `serviceos-email-sync`          | `email-scheduled-sync`                    | */5     | `EMAIL_SCHEDULE_SECRET`           |
| `serviceos-email-workspace`     | `email-workspace-scheduled-sync`          | */5     | `EMAIL_WORKSPACE_SCHEDULE_SECRET` |
| `serviceos-email-wksp-backfill` | `email-workspace-backfill-scheduled-sync` | */15    | `EMAIL_WORKSPACE_BACKFILL_SECRET` |
| `serviceos-interactions`        | `interactions-scheduled-sync`             | */5     | `SIGNAL_SYNC_SECRET`              |
| `serviceos-identity`            | `identity-scheduled-sync`                 | */5     | `IDENTITY_SYNC_SECRET`            |
| `serviceos-business-graph`      | `business-graph-scheduled-sync`           | */5     | `GRAPH_SYNC_SECRET`               |
| `serviceos-customer-cards`      | `customer-card-scheduled-sync`            | */5     | `CARD_SYNC_SECRET`                |
| `serviceos-recommendations`     | `recommendation-scheduled-sync`           | */5     | `RECOMMENDATION_SYNC_SECRET`      |

Ordering (interactions → identity → graph → cards → recommendations) is NOT
required — every function is idempotent, so a shared 5-minute tick advances the
chain one hop and self-heals.

---

## Manual test (before/after scheduling)

Each scheduled function can be POSTed directly with its `x-schedule-secret`. Full
per-function curls (with expected success shapes + verification SQL) are in
[SCHEDULERS.md](SCHEDULERS.md). Generic form:

```bash
curl -sS -X POST "https://<project-ref>.functions.supabase.co/phone-processing-scheduled-sync" \
  -H "x-schedule-secret: $PHONE_PROCESSING_SECRET" \
  -H "content-type: application/json" -d '{}'
# → { "success": true, "tenants": N, "results": [ … ] }
```

---

## Pause / rollback

```sql
-- pause ONE scheduler (keep the job, stop it firing)
update cron.job set active = false where jobname = 'serviceos-phone-processing';
-- resume it
update cron.job set active = true  where jobname = 'serviceos-phone-processing';

-- remove ONE scheduler
select cron.unschedule('serviceos-phone-processing');

-- pause / remove ALL ServiceOS schedulers
select serviceos_unschedule_all();
```

Removing the cron jobs stops automatic processing; the manual override buttons in
Admin still work. Nothing is destroyed — re-run `serviceos_schedule_all()` to
restore.

---

## Why there is no `scheduler_runs` table

Run visibility already exists in three layers — a new table would duplicate it:

- **`cron.job_run_details`** — every cron invocation (status, return_message,
  timing) for the POST itself.
- **`platform_jobs`** — each worker's durable job row (`phone.process_pending`,
  `interactions.sync`, `identity.resolve`, `graph.sync`, `customer_card.sync`,
  `recommendation.sync`) with records processed + result + errors.
- **`phone_sync_runs` / `email_sync_runs`** — per-connector sync-run history with
  status + error_message + metadata (incl. the phone pipeline `trace`).

The Operations Centre scheduler-health card consumes these, so per §3 of the spec
no `scheduler_runs` table is added.

---

## Safety (how the schedulers stay safe)

- **Non-destructive:** schedulers only read + upsert; the auto-close in the
  Recommendation Engine is a soft `status='resolved'`. No deletes, no messages,
  no outbound customer contact.
- **Idempotent:** every function dedupes/upserts, so a double tick or overlap
  converges — it never double-processes.
- **Failure-isolated:** one failing tenant or record never aborts the batch; a
  missed tick resumes next run.
- **Safe cadence:** 2–5 min with bounded batch sizes; the drainers process small
  batches so a backlog clears over several ticks rather than one huge run.
- **No infinite loops:** each run is a bounded batch and returns; there is no
  self-re-invocation.
- **No user-flow blocking:** all runs are server-to-server background work.
- **No secret leaks:** secrets live in Vault / Edge env, never in logs, payloads,
  evidence, or this repo.

---

## Troubleshooting

| Symptom                                                           | Cause                                                                      | Fix                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| `serviceos_schedule_all()` returns "pg_cron/pg_net not installed" | extensions off                                                             | enable them (Step 2), re-run                         |
| returns "No base_url set"                                         | `scheduler_config` empty                                                   | Step 4                                               |
| `cron.job_run_details.status = 'failed'`                          | check `return_message`                                                     | usually a bad/missing Vault secret or wrong base_url |
| function responds `403 forbidden`                                 | Vault value ≠ Edge env value                                               | re-set both to the same value (Step 3)               |
| function responds `invalid_auth` / "Invalid or expired session"   | service-role/gateway — see [INPUT_RELIABILITY.md](INPUT_RELIABILITY.md) §7 | confirm `verify_jwt=false` deploy                    |
| scheduler shows "never" in Ops Centre                             | cron not running yet                                                       | verify `cron.job` + `job_run_details`                |
