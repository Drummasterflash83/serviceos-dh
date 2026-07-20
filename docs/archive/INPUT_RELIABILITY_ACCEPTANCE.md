> **SUPERSEDED — archived for historical reference.**
> This document is no longer maintained and may contain claims that were
> true only at the time of writing. Its subject is now owned by
> [Verification & Acceptance](../operations/VERIFICATION_AND_ACCEPTANCE.md).
> Start at the [documentation index](../README.md). Kept to preserve the
> architectural evolution and decision history.

---

# Input Reliability Acceptance (Phone + Gmail + Workspace)

The input layer must run a full working day with **no false stale warnings, no
repeated full projection, and no manual buttons**. This documents the two fixes in
"Input Reliability Finalisation v1", their acceptance criteria, and a one-step-at-a-
time verification sequence.

## Part A — Phone projection goes clean (content version)

**Root cause:** the marker `interactions.source_updated_at =
max(phone_calls.updated_at, insight.updated_at)` chased a moving target —
`phone-scheduled-sync → simwood-sync-calls` re-upserts `phone_calls` every 5 min, and
`set_updated_at` bumps `phone_calls.updated_at = now()` on every **no-op** re-upsert, so
`pc.updated_at > source_updated_at` was true again every cycle → `phone_selected/updated
= 221` forever.

**Fix:** `interactions.source_version` = deterministic `md5` of the _projected content_
(call fields + latest insight summary/sentiment), computed once in SQL
(`phone_projection_version`) and used by the selector, the projector and the finaliser.
No-op re-upsert → identical content → same hash → **not selected**. Genuine call/insight
change → new hash → selected exactly once. No `now()`, no timestamp comparison.

Acceptance:

- After deploy, one repair pass sets `source_version` for existing rows
  (`phone_updated ≈ 221`); the **next** run is `{phone_processed:0, interactions_upserted:0}`.
- A no-op `phone_calls` re-upsert (bumps `updated_at`) does **not** reselect.
- New call → one projection; changed insight → one refresh; then zero again.
- No duplicate interaction, no duplicate `interaction.ready` (event only for new).

## Part B — Truthful health (no false stale)

| Symptom                                                                                                   | Root cause                                                                                                                                          | Fix                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Workspace email sync stale / expected every 5 min", "Gmail OAuth sync stale", "Workspace backfill stale" | the email-phase scheduler rewrite made schedulers enqueue-and-return, **dropping** the `email_sync_runs` heartbeat rows `scheduler-health.ts` reads | each scheduler writes a lightweight per-tenant heartbeat row (`sync_type` = `scheduled_sync` / `workspace_scheduled_sync` / `workspace_backfill_scheduled`, `status='success'`) every tick — a **no-op run is healthy** |
| "Phone / VoIP sync stale" while polling succeeds                                                          | the connector card read `tenant_connectors.last_successful_sync_at`, which the scheduled poll never updates (it writes `phone_sync_runs`)           | `ops-metrics.ts` `connectorLastSuccess = phoneLast ?? account watermark` — a successful poll (incl. a no-op poll) now refreshes the card                                                                                |
| Email dead-letter jobs from before the handler was deployed shown as current                              | `dead_letter_count` counted **all-time** dead-letters                                                                                               | `email-connector-status` counts a dead-letter as **current only** when no later succeeded job exists for the same `job_key`; older ones are historical                                                                  |

Separated signals (already exposed by `phone-pipeline-status` / `email-connector-status`,
and rendered by the Operations Centre business cards): scheduler acceptance, worker
execution, provider ingestion, useful processing, last interaction — a no-op success on
any one never reads stale, and historical failures resolved by a later success are not
current.

## One-step-at-a-time verification (I have no live DB here)

Run one, confirm the expected result, then continue.

1. `supabase db push` → expect: migration applied. Confirm:
   `select exists(select 1 from pg_proc where proname='phone_projection_version');` → `t`.
2. **Diagnose Part A before the handler redeploy:**
   `select dirty_reason, count(*) from phone_projection_diagnostics('<tenant>', 500) group by 1;`
   → expect mostly `version_changed` or `missing_source_marker` (the live cause).
3. Deploy functions (below). Wait one `interactions.sync` cycle. Then:
   `select result from platform_jobs where job_type='interactions.sync' order by created_at desc limit 1;`
   → expect `phone_processed:0, interactions_upserted:0` (after the one repair pass).
4. Re-run step 2 → expect **all `clean`**.
5. `select dirty_reason from phone_projection_diagnostics('<tenant>',500) where dirty_reason<>'clean';`
   → expect 0 rows even though `phone-scheduled-sync` keeps re-upserting calls.
6. Deploy the frontend. Open Operations Centre → Phone, Gmail, Workspace cards show
   Healthy with no "stale"/"expected every 5 min"/"Reconnect"/"Re-test" unless a genuine
   current condition exists.
7. Scheduler health panel: all email + phone rows show a recent `lastRunAt` and `healthy`.

## Deployment

```bash
supabase db push
supabase functions deploy platform-worker interactions-sync phone-process-pipeline \
  email-scheduled-sync email-workspace-scheduled-sync email-workspace-backfill-scheduled-sync \
  email-connector-status
# frontend
bun run lint && bun run build
```

`platform-worker` redeploys because it imports the changed handler; `phone-process-pipeline`
imports the changed finaliser. Additive migration only; no cron change; RLS/tenant/service-role
unchanged. Tests: `psql "$DATABASE_URL" -f supabase/tests/phone_projection.test.sql`.
