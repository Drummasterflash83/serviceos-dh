# Operations Centre — Health Model (engineering reference)

The Operations Centre reports operational health from **one authoritative
model**. Every panel, badge and KPI derives freshness from a single formula, so
they always agree. This document is the reference for every metric: its source,
refresh, calculation, and healthy/warning/error bands.

## The one staleness rule

A scheduler / connector / worker is **stale** when its newest success is older
than its cadence times a shared multiplier:

```
staleAfterSec = expectedIntervalSec × HEALTH_STALE_MULTIPLIER   (multiplier = 4)
```

Defined once per runtime and mirrored:

- Frontend: [`src/lib/health-model.ts`](../src/lib/health-model.ts)
- Edge (Deno): [`supabase/functions/_shared/health_model.ts`](../../supabase/functions/_shared/health_model.ts)

`HEALTH_STALE_MULTIPLIER` (default **4**) = how many missed ticks are tolerated
before "stale". Change it in **one place** to retune the whole platform. There
are no magic minute constants anywhere else.

Worked examples:

| Scheduler cadence | Stale after |
|---|---|
| 2 min (`*/2`) | 8 min |
| 5 min (`*/5`) | 20 min |
| 15 min (`*/15`) | 60 min |

### Cadence registry

`CADENCE_SEC` MUST match the cron schedules in
[`20260709180000_scheduler_cron.sql`](../../supabase/migrations/20260709180000_scheduler_cron.sql)
and [`20260710120000_platform_job_queue.sql`](../../supabase/migrations/20260710120000_platform_job_queue.sql).

| Logical scheduler | Cron | Cadence | Stale after (×4) |
|---|---|---|---|
| platform-worker | `* * * * *` | 60 s | 4 min |
| phone-processing | `*/2 * * * *` | 120 s | 8 min |
| phone-sync | `*/5 * * * *` | 300 s | 20 min |
| gmail / workspace sync | `*/5 * * * *` | 300 s | 20 min |
| workspace backfill | `*/15 * * * *` | 900 s | 60 min |
| interactions / identity / graph / cards / recs | `*/5 * * * *` | 300 s | 20 min |

## Two truths, never in conflict

Health is measured two ways, both now routed through the same formula so they
cannot disagree:

1. **Edge engine** (service-role RPCs): `phone-pipeline-status`,
   `email-connector-status`. Drives the system **panels**.
2. **Runtime-provider engine** (browser RLS snapshot + `freshness.ts`): drives
   the **KPI row** (Healthy/Warnings/Critical) and the **ConnectorCards**.

Both call `staleAfterSec(cadence)`. Where two surfaces track *different*
schedulers for the same connector (e.g. phone **sync** freshness vs phone
**worker** freshness), the windows differ **because the cadences differ** —
that is correct, not a conflict.

## Historical vs current — the golden rule

A metric labelled "current" must never surface resolved history. Two rules
enforce it:

- **Failures**: a failure is current only when it is newer than the latest
  success (`isCurrentFailure`). A later success always resolves an earlier
  failure. Never a latched flag.
- **Dead-letters**: a dead-lettered job is current only when **no later
  succeeded job for the same `job_key`** has recovered it. Applied in email
  (`email-connector-status`), phone (`phone_pipeline_health`) and the global
  worker-queue card (`platform-jobs.ts`). All-time counts are never shown as
  current.

## Per-metric reference

| Metric | Source (authoritative) | Refresh | Calculation | Healthy / Warning / Error |
|---|---|---|---|---|
| **Phone** (system health) | `phone-pipeline-status` → `phone_pipeline_health` RPC | on view load / manual refresh | derived from backlog, current failures, current dead-letters, worker freshness | healthy: draining normally · warning: backlog building / worker late / current failure · critical: current dead-letter, oldest eligible >30 min, or backlog with no worker run |
| **Gmail** | `email-connector-status` → `deriveGmailState` | on load | state from evidence (auth, current failure, last_success_at) | healthy · stale: no success in 20 min · failing/auth_expired: current failure |
| **Workspace** | `email-connector-status` → `deriveWorkspaceState` | on load | as Gmail + delegation/mailbox checks | healthy · stale: no success in 20 min · delegation_failed: current delegation failure |
| **Pipeline Health** (phone) | `phone_pipeline_health` | on load | same object as Phone | as Phone |
| **Backlog** (email) | `email_connector_health` `unprojected` | on load | `email_messages` with no `interactions` projection (`NOT EXISTS`) | 0–few normal · rising with oldest age >15 min ⇒ warning |
| **Backlog** (phone) | `phone_pipeline_health` `eligible_backlog` | on load | incomplete recordings needing a stage advance | >10 waiting ⇒ warning |
| **Failures** | `current_unresolved_failures` (phone) / current-failure flags (email) | on load | latest per-unit run failed **and** still unresolved | 0 healthy · >0 warning |
| **Dead Letters** | phone `dead_letter_count`, email `dead_letter_count`, global `platform-jobs` | on load | dead-letters **not superseded** by a later same-key success | 0 healthy · >0 critical (operator action) |
| **Scheduler** | `scheduler-health.ts` (per scheduler) + `phone_pipeline_health.last_scheduler_at` | on load | last run age vs `staleAfterSec(cadence)` | healthy ≤ window · stale > window · never: no run |
| **Worker** | `phone_pipeline_health.last_worker_success_at` | on load | last succeeded `phone.process_pending` age vs `staleAfterSec(phoneProcessing)` = 8 min | healthy ≤ 8 min · stale > 8 min |
| **Throughput** | `phone_pipeline_health` `throughput_total_per_hour` | on load | stage advances in the last 60 min | informational |
| **Useful Processing** | `phone_pipeline_health.last_useful_at` | on load | latest run with `records_processed > 0` | informational (distinct from a healthy no-op) |
| **Oldest Pending** | phone `oldest_eligible_age_seconds` / email `oldest_unprojected_age_seconds` | on load | age of oldest waiting item | <15 min normal · >15 min warning · >30 min critical (phone) |

> Note — "Active jobs" on the email strip counts only `email.%` ingestion jobs.
> The projector that clears the email backlog is the `interactions.sync` job
> (its own 5-min cron), which is intentionally **not** in that count. Backlog is
> a data-state count, drained on the next projection tick.
