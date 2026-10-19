# M2 Commusoft shared lease — LIVE release handoff

Status: **prepared, not released**. This note supplements
`NEW-DAWN-M2-LEASE-COEXISTENCE-REVIEW.md`. The database backup rehearsal must
finish and its result be reviewed before changing LIVE. Do not treat a quiet
moment in the rolling import queue as permission to run a provider GET.

## Read-only baseline, 19 October 2026

The scoped preflight observed the LIVE project `tgbnakbxwcqjeimygroz` with
`learn-commusoft-worker` v10 (JWT on), `learn-commusoft-job-detail` v1 (JWT off),
and `learn-commusoft-opportunity-probe` v1 (JWT off). Their runtime IDs and
bundle hashes are pinned in `scripts/verify/new-dawn-m2-live-preflight.mjs`.
Migrations `20261106150000`, `20261106160000`, and `20261106180000` and all
four relevant tenant flags were absent. The source queue was active on the
first read and briefly idle on the second; this is a rolling import, not a
durable idle window. Both reads changed no production state and made no
Commusoft request.

The current Edge source was downloaded into a Git-ignored, private directory.
The downloader's nested `_shared` files were normalized into a per-function
`rollback-stage/supabase/functions/` tree, all relative imports resolved and
parsed, and runtime metadata remained stable before and after capture. The
worker v10 source closure has nine files. This is a source-level recovery
artifact, not a cryptographic copy of the deployed executable bundle. Do not
substitute the local current branch for this artifact when rolling back.
The private manifest and source live at
`/Users/chrisdrummond/Documents/ChatGPT/ServiceOS/.verification-results/m2-live-rollback-20261019-final/`;
the release owner must preserve this directory and verify its manifest before
any deploy. Never commit it or copy its source into a public ticket.

The candidate local Edge closure SHA-256 was
`882fdf3879ff8df4e321ab9555802609f5805df61354cf7e8d1764730ff5a277`.
The exact migration source hashes are recorded in the private manifest. These
values describe the checked-out candidate, so rerun preflight after any main
branch change.

## Required preflight

Run from the exact reviewed Git head with the existing saved Supabase CLI
login. Choose a fresh path each time; the script refuses reuse. It performs
only Management API reads and Edge source downloads:

```sh
NEW_DAWN_M2_ALLOW_PROJECT=tgbnakbxwcqjeimygroz \
  node scripts/verify/new-dawn-m2-live-preflight.mjs --live-read-only \
  --out .verification-results/m2-lease-release-YYYYMMDD-HHMM
```

Stop if the script fails, any function version/ID/hash or JWT setting changes,
one of the three SQL versions or four flags appears, the project is not
healthy, the downloaded import closure is incomplete, or the backup rehearsal
is unverified. The current script deliberately supports only the pinned
pre-release state; it must not be used to infer post-release success.

Before mutation, review the three migration files and the candidate Edge
closure, confirm the source job/connection is the expected Drummonds tenant,
and run the existing rolled-back TEST fixture
`node scripts/verify/new-dawn-commusoft-shared-routes-rehearse.mjs` plus focused
worker, permit, exact-job and opportunity tests. The TEST fixture makes no
provider GET and leaves no SQL installation. Do not open up a client flag as
part of these checks.

## Exact release order (separate release-owner action)

1. Deploy the reviewed `learn-commusoft-worker` first, preserving JWT
   verification. Read back its new ACTIVE version, distinct bundle hash and
   source-job health. Its parser accepts both old and classified waits. Stop
   before SQL if the worker does not settle or source job errors rise.
2. Install only the exact additive SQL versions `20261106150000`,
   `20261106160000`, then `20261106180000`, in that order. Each migration has
   a transaction and a short lock timeout. Confirm the schema migration ledger
   records each exact version and source file after application; do not use
   the obsolete M2 `20261106140000` filename, which conflicts with a LIVE
   QuickBooks migration. Leave all four tenant flags absent.
3. Deploy the reviewed exact-job and opportunity Edge routes, preserving their
   existing JWT-off settings and route-level authority checks. Read back new
   ACTIVE versions and distinct bundle hashes. Confirm the source worker still
   completes ordinary pages without a new failure/backoff pattern. There is
   no reason to invoke either manual route while the default-off checks are
   being proven.
4. Run the read-only installed-state check below. It requires all three newer
   active Edge versions, all three migrations, lease columns/functions, and
   all four flags still absent. If any result is uncertain, stop with flags off.
5. Only after a separate reviewed trial decision, consider one bounded,
   source-linked manual read for the Drummonds tenant. Check the queue and
   credential state immediately before it, record the request ID and receipt,
   and watch the source page and manual lease until both settle. Keep the
   coexistence flag off unless the explicit overlap trial is approved.

```sh
NEW_DAWN_M2_ALLOW_PROJECT=tgbnakbxwcqjeimygroz \
  node scripts/verify/new-dawn-m2-live-preflight.mjs --post-release-read-only
```

## Rollback and stop conditions

On an unexpected source failure or manual read, stop further manual starts
and leave `new_dawn.m2_commusoft_coexistence` absent/false. A false/absent flag
retains the original queued/running/retrying source guard. Let an in-flight
read finish, or wait for its 40-second lease expiry, then read the source job,
gate and receipt state. Keep the lease-aware worker deployed while the new SQL
is installed and source jobs run. These migrations are additive; do not drop
their columns/functions or erase pending jobs during an active import.

**Worker v10 is not an immediate post-SQL rollback.** Its retained parser
accepts only `{state, retryAt}` for a wait, while migration `180000` can add
`waitKind`; a v10 worker would reject that response. The private v10 source is
preserved for a controlled recovery only after the release owner proves the
database response is compatible again or safely restores the old function
contract with no active work. Reverting an Edge route alone also needs its
matching SQL function signature, so prefer flags off and the new routes
parked over mixing old Edge with new SQL. A failed or partial migration must
be diagnosed from the transaction result and ledger before any retry.

If the release cannot reach the installed-state check, report the exact last
verified worker/SQL/route step and keep the manual coexistence flag off. Do
not claim a provider read, visit, engineer identity, quote, or job status from
this installation alone.
