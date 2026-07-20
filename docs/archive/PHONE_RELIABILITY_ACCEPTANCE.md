> **SUPERSEDED — archived for historical reference.**
> This document is no longer maintained and may contain claims that were
> true only at the time of writing. Its subject is now owned by
> [Verification & Acceptance](../operations/VERIFICATION_AND_ACCEPTANCE.md).
> Start at the [documentation index](../README.md). Kept to preserve the
> architectural evolution and decision history.

---

# Phone Input — Reliability Acceptance

The Phone / VoIP input must run for an entire working day with **no manual
intervention**. This document defines the production acceptance test, the initial
service targets, and the verification SQL that proves the pipeline is healthy.

The targets below are **initial** service levels — tune them once real production
throughput is observed.

## Architecture recap

```
simwood-sync-recordings ──▶ phone_recordings (metadata, storage_path=null)
        (every 5 min)
phone-processing-scheduled-sync ──enqueue──▶ platform_jobs (phone.process_pending)
        (every 2 min)
platform-worker ──claim──▶ handlePhoneProcessPending
        (every 1 min)          │
                               ├─ phone_select_pending()  ← OLDEST incomplete first
                               └─ per recording: phone-process-pipeline
                                     download → transcribe → analyse → finalise
```

Selection and all health math are **database-side** (migration
`20260711120000_phone_pipeline_selection.sql`): the view
`phone_recording_pipeline_state` and functions `phone_select_pending`,
`phone_pipeline_health`, `phone_pipeline_diagnostics`. There is no bounded scan
window, so old recordings can never starve, and "failed" always means _currently
blocked_, never all-time history.

## Selection & fairness policy

1. **Oldest incomplete first** — `phone_select_pending` orders by
   `coalesce(started_at, created_at) ASC`, so the longest-waiting work is always
   chosen. No permanent starvation.
2. **Bounded batch** — default 5, max 10 per worker tick.
3. **Download readiness delay** — a recording in the `download` stage waits
   `MIN_DOWNLOAD_AGE_SECONDS` (120s) before its first fetch, because provider
   audio may not be ready immediately. This delay applies **only** to the download
   stage; already-downloaded recordings needing transcription/analysis are never
   delayed, so it never blocks older eligible work.
4. **Retry backoff respected** — a retryable failure re-queues with exponential
   backoff via `platform_jobs.available_at` (1m → 5m → 15m → 60m → dead-letter).
5. **Non-retryable excluded** — `provider_recording_missing`, `invalid_recording`,
   `malformed_provider_id`, `cross_tenant_mismatch`, `unsupported_format` dead-letter
   immediately and await operator action.

## Retry classification (download)

| Provider outcome            | Safe code                    | Retryable |
| --------------------------- | ---------------------------- | --------- |
| 404 within retention window | `recording_not_ready`        | ✅        |
| 404 past retention (45d)    | `provider_recording_missing` | ❌        |
| 429                         | `provider_rate_limited`      | ✅        |
| network / timeout           | `provider_timeout`           | ✅        |
| 5xx / read error            | `download_failed`            | ✅        |
| storage upload failure      | `storage_failed`             | ✅        |
| no `provider_recording_id`  | `invalid_recording`          | ❌        |

No provider credentials, signed URLs, transcript text or audio URLs are ever stored
in job errors or diagnostics.

## Initial service targets (one-day test)

| Metric                    | Target                                                        |
| ------------------------- | ------------------------------------------------------------- |
| Scheduler acceptance      | ≥ 99% of ticks enqueue (or dedupe) cleanly                    |
| Worker success            | ≥ 99% of claimed jobs complete (succeed or intentional no-op) |
| Download latency          | 95% downloaded within 10 min of availability                  |
| Transcription latency     | 95% of transcripts within 15 min                              |
| Analysis latency          | 95% of analyses within 20 min                                 |
| Interaction-ready latency | 95% finalised within 25 min                                   |
| Oldest eligible age       | no eligible item older than **30 min** in normal operation    |
| Backlog trend             | no unexplained queue growth over the day                      |
| Current failure rate      | 0 unresolved failures at end of day (after retries)           |
| Dead-letter count         | 0 (any dead-letter is an operator alert)                      |
| Manual processing         | **none required** during the test day                         |

`phone-pipeline-status` maps these to health: **warning** at 15 min oldest / >10
backlog / any current failure / stale worker; **critical** at 30 min oldest / any
dead-letter / backlog with no worker run yet.

## Verification SQL

Run in the Supabase SQL editor (service role). Replace `<tenant>` with the tenant id.

### Backlog snapshot (run before and after a worker tick)

```sql
select
  count(*) as total,
  count(*) filter (where storage_path is null) as not_downloaded,
  count(*) filter (where storage_path is not null) as downloaded,
  min(started_at) filter (where storage_path is null) as oldest_not_downloaded,
  max(started_at) filter (where storage_path is null) as newest_not_downloaded
from phone_recordings
where tenant_id = '<tenant>';
```

### Stage backlog (DB-side, no scan window)

```sql
select stage, count(*)
from phone_recording_pipeline_state
where tenant_id = '<tenant>' and is_incomplete
group by stage order by stage;
```

### What the drainer will select next (oldest first — proves starvation is fixed)

```sql
-- what SHOULD run (oldest undownloaded)
select id, started_at, storage_path
from phone_recordings
where tenant_id = '<tenant>' and storage_path is null
order by started_at asc limit 10;

-- what NOW runs (same order, via the selection function)
select id, stage, sort_at from phone_select_pending('<tenant>', 5, 120);
```

### One-shot health (the numbers both UIs render)

```sql
select jsonb_pretty(phone_pipeline_health('<tenant>'));
```

### Unresolved-item diagnostics (per recording)

```sql
select * from phone_pipeline_diagnostics('<tenant>', 50);
```

### Recent queue runs (`skipped:40` must be gone)

```sql
select status, attempt_count, claimed_by, records_processed, result, last_error, created_at
from platform_jobs
where job_type = 'phone.process_pending'
order by created_at desc limit 30;
```

A healthy no-op now reads `{"processed":0,"skipped":0,"eligible_backlog":0,
"reason":"no_eligible_recordings"}` — never `skipped:40`.

## Automatic-recovery acceptance test (§12)

1. Confirm old undownloaded recordings exist (backlog snapshot → `not_downloaded > 0`,
   `oldest_not_downloaded` days old).
2. Let the scheduler enqueue `phone.process_pending` (or trigger
   `phone-processing-scheduled-sync` once).
3. The worker claims the job and calls `phone_select_pending` → oldest eligible rows.
4. At least one old recording advances a stage.
5. Re-run the backlog snapshot: `not_downloaded` **decreases** and
   `oldest_not_downloaded` **moves forward**.
6. The worker job completes successfully — **no manual button pressed**.

Repeat over a working day; `eligible_backlog` should trend to 0 and stay there.

## Deployment runbook

```bash
supabase db push                       # applies 20260711120000_phone_pipeline_selection.sql
supabase functions deploy platform-worker phone-process-pending \
  phone-pipeline-status simwood-download-recording
# frontend
bun run lint && bun run build
```

`platform-worker` is redeployed because it imports the changed shared handler
(`_shared/worker_handlers/phone_process_pending.ts`). No secrets, cron schedule or
`serviceos_schedule_defs()` change is required — the cadence is unchanged.
