# Marketing Provider Connections — Operations Runbook (Phase 10A)

_Operator reference for the provider-connection layer. Everything here
assumes the deployed stack; in the current build NOTHING is deployed and no
real provider adapter exists — the runbooks below become live at launch.
Required permission for every mutating recovery: role owner/admin AND
`marketing.ads.manage`. Every action below is auditable in `audit_logs`
(`marketing.connections.*`) and the append-only account version history._

## How the layer behaves (context for every runbook)

- `connected` is reachable ONLY through the service-role adapter seam with
  verification evidence. The UI/API path queues a validation job; the worker
  runs the adapter and reports the genuine outcome.
- Sync runs are single-flight per connection, lease-safe, and retire at
  attempt 10 as `failed/max_attempts_exhausted`.
- Facts are append-only with digest convergence and revision supersession —
  re-syncs can never duplicate or double-count.
- Reporting never converts absence into zero: unavailable numbers are `null`
  with an exact reason (`no_spend_facts`, `mixed_currencies`, `zero_leads`,
  `no_lead_facts`, `metrics_unavailable`).
- Credentials live only in the tenant Vault broker (`mkt-conn-<account>`)
  behind a mark-before-write idempotency gate with a bounded 86400 s
  rotation overlap.

## Runbooks

| Symptom | Likely cause | Safe diagnosis | Safe recovery | Prohibited | Escalate when |
| --- | --- | --- | --- | --- | --- |
| Connection stuck `connecting` | validation job lost before the seam reported | check `platform_jobs` for `mkconn:<account>`; account version history shows `connect_attempt` without `connect_result` | re-run the worker tick; if the job is dead-lettered, Revoke → recreate, or re-trigger connect after the account is moved to error via a seam `verified:false` report by an operator with service access | never UPDATE the account row directly to `connected` | stuck > 1h with a live worker |
| `error / invalid_credential` | provider credential invalid or expired | version history `connect_result`; run history `invalid_credential` | rotate the credential (UI → Rotate credential), then Attempt connect | retrying without a new credential; pasting credentials anywhere outside the credential field | repeated failures with a known-good credential |
| `error / missing_scope` | provider principal lacks required scope | run history `missing_scope` | re-authorise at the provider with the documented scopes, rotate credential, reconnect | widening provider scopes beyond the documented minimum | provider scope model changed |
| `error / no_adapter` | provider has no reviewed adapter (ALL real providers in this build) | catalogue shows implemented:false | none — this is the honest state until an adapter ships | presenting the connection as connectable | n/a |
| External account vanished from provider | account removed/permissions changed provider-side | discovery list vs selected ref; sync failures | reconnect to re-discover; re-select | guessing/typing raw external refs | provider confirms the account is gone |
| Sync runs repeatedly failing (`provider_unavailable` / `rate_limited`) | provider outage or throttling | run history attempts climbing; error classes | wait — retries are lease-driven and bounded; reduce cadence if chronic | raising the attempts ceiling; deleting runs | attempts ≥ 5 across multiple connections (provider incident) |
| Run at `failed / max_attempts_exhausted` (poison) | 10 attempts burned | inspect run stats + error class of prior attempts | fix the underlying cause, then request a manual sync (a NEW run) | resurrecting the retired run | recurring poison on one connection |
| `degraded` (metrics unavailable, feed fine) | metrics endpoint failing | report `metrics_status.reason` | retry later (manual sync); the feed keeps serving; earlier facts are preserved | zeroing metrics; hiding the error | metrics down > 24h |
| Stale data (`stale` badge) | no successful sync inside `stale_after` window | last run outcomes; scheduler health | manual sync; check cadence config; check scheduler heartbeat | widening `stale_after` to hide the problem | scheduler heartbeat absent |
| Mixed-currency totals unavailable | genuinely mixed currencies in facts | report `currencies` array | expected behaviour — per-currency facts remain; no FX conversion exists | approving ad-hoc FX conversion | product decides an FX policy |
| Vault failure during credential set | Vault write failed AFTER the mark | credential_state `configured` but consumers fail closed | re-rotate the credential (a fresh request id) | manual Vault edits | Vault errors persist |
| Revocation during queued/running sync | operator revoked mid-flight | queued runs retire as `account_revoked`; a running worker re-checks before provider access | none needed — this is designed behaviour | re-opening a revoked connection (create a new one) | n/a |
| Suspected tenant-isolation incident | cross-tenant data visible | verify with two test tenants via the API; capture exact requests/responses | STOP feature work; treat as a security incident | continuing writes on the affected surface | IMMEDIATELY — preserve evidence (requests, audit_logs, versions) |
| Marketing release rollback | bad deploy | identify the deployed function versions + migration | redeploy previous function versions; migrations are additive run-once — never dropped in place; disable the capability at the registry/UI level first | destructive down-migrations on shared tables | data-shape regression suspected |

## Scheduler (design — NOT installed in this build)

- Due-computation: `marketing_provider_sync_due` (connected + cadence
  elapsed + no active run). Enqueue: `marketing_provider_sync_enqueue_due`
  per tenant — structurally idempotent (single-flight index + deduped drain
  job), safe under overlapping invocations (proven).
- Recommended production shape: the existing 1-minute platform cron invokes
  the worker; a per-tenant enqueue tick every 5 minutes with ±30 s jitter;
  lease 300 s; batch 5; fairness = per-tenant enqueue + the worker's global
  batch claim; disable switch = do not register the enqueue tick (nothing
  else polls).
- Launch step (DO NOT run in this build): register the enqueue tick in the
  platform scheduler alongside the existing schedule definitions, then
  verify one full scheduled cycle on staging.

## Monitoring contract (defined — NOT activated)

Counters/gauges to wire at launch, all derivable from existing tables:
connection validation failures (`connect_result` error reasons/day) ·
credential failures (`invalid_credential`, `credential_missing`) · sync
success rate + duration (`marketing_provider_sync_runs`) · runs with
attempts ≥ 5 · permanently failed runs (`max_attempts_exhausted`) · stale
connected accounts (freshness = stale) · never-run connected accounts ·
provider rate-limit / timeout classes (`rate_limited`,
`provider_unavailable`) · ingestion rejections (`fact_rejected`,
`schema_invalid`) · mixed-currency unavailability (report reason) ·
permission denials (42501 in function logs) · cross-tenant NOT_FOUND rate ·
scheduler heartbeat (enqueue tick recency) · webhook-signature metrics stay
with the Phase-8 ads webhook.
