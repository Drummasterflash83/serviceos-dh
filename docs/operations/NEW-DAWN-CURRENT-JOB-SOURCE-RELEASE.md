# Reliable job Home totals · 21 October 2026

The signed-in MD Home has intermittently timed out while counting saved Commusoft jobs. Its separate paged job reader works, but the status-summary RPC repeatedly scans retained source history and can leave the Home showing dated last-good totals. A successful warm read is not a durable fix. This release gives the existing audited summary a transactional current-source projection; it does not add a provider request or publish a score.

## Exact scope

- LIVE project: `tgbnakbxwcqjeimygroz`.
- Stage 1: `20261113000000_new_dawn_commusoft_current_job_source.sql`, SHA-256 `d1a2c9e754b285d6a8360427d5e75db1d7359a969871b53fb09365981e1ef46c`. It creates a private tenant/connection/external-ID keyed projection and an observation-insert trigger. Each new retained page updates this projection in the same transaction. The immutable page, version and observation rows remain the source of truth.
- Stage 2: `20261113010000_new_dawn_open_job_summary_current_source.sql`, SHA-256 `7a1b8501a7e65ccd1f6ff18fe3ead729ad7a8109c7b2a871ae51eb30d4e51888`. It backfills the projection from retained observations, then changes only the source-selection CTE inside `new_dawn_open_job_status_summary`. The RPC's identity, actor, tenant, flag, audit, output and grant contract stays unchanged.
- An equal-time tie between different source versions is marked ambiguous and withheld. A later unambiguous version resolves that hold. The projection exposes no direct table grants, including to authenticated users and the service role; only the existing audited RPC can return aggregate counts.
- No customer/site/job link, source row, provider setting, client flag, login, score or accounting record changes. The frontend still clearly dates a prior successful read if the new read fails.

## Guard and rollback

The release is two separate transactions. Each inserts its exact SQL source into the migration ledger under a lock. Stage 2 runs only after independent readback of Stage 1. Both stages stop if the function hash, projection/trigger state or ledger differs. A lost acknowledgement is resolved by readback; never replay a write blindly. The expected prior function SHA-256 is `1a373342368cc703a09860bc6162c0a98a8116cebd104719d212449fb9603f9a`; the candidate is `9219b20578e4213f927785ffd4c0714066cdb5972997b7b02e9024ef0fff4e23`.

The exact rollback at `supabase/release/new-dawn-current-job-source/rollback.sql` checks the candidate hash, restores the original audited summary definition, then removes only the derived trigger, function and table in one transaction. Source history is untouched. The migration ledger remains as release history and a later reinstall would require a separately reviewed version.

## Evidence and release steps

- A disposable PostgreSQL 17 rehearsal applied the production-baseline function, both migrations, and the exact rollback. Synthetic cases passed: newer open/pending/closed versions, equal-time conflict withheld, later conflict resolution, tenant separation, direct-grant denial, and unchanged summary output. The rollback restored the exact baseline hash and counts.
- The focused release-script tests pass. A read-only production preflight on 21 October returned `ready_exact`: both ledger versions absent, projection and trigger absent, exact prior function hash and grants present. This is preflight, not a LIVE install or speed measurement.
- After review, run `node scripts/verify/new-dawn-current-job-source-release.mjs --live-read-only`; set `NEW_DAWN_CURRENT_JOB_SOURCE_PROJECT=tgbnakbxwcqjeimygroz` and the two exact `NEW_DAWN_CURRENT_JOB_SOURCE_SHA_1` / `_SHA_2` values above; then run `--live-install-exact` once. Independently run `--live-installed-read-only` and `node scripts/verify/new-dawn-current-job-source-parity.mjs --live-read-only`; the latter compares every projected key and version with retained history using one read-only aggregate query. Open the signed-in MD Home and check current open/on-hold/pending totals, linked/awaiting totals, first and second job pages, customer groups and a second reload. Record actual RPC duration. If the result is uncertain, use readback only.
- The projection should reduce repeated history scans to current keys; real LIVE latency improvement remains an inference until the post-install readback. If it does not improve Home reliability, do not call this outcome accepted. Use the exact rollback after checking the current function and ledger.
