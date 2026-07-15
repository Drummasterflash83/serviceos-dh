# Remote Verification Harness

A repository-owned way to verify the **linked remote Supabase project** without copying
SQL into the dashboard. It queries the project, asserts schema/registry/behaviour, runs
the controlled Automation slice end-to-end, prints a pass/fail report, and cleans up its
own fixtures — repeatably, from the command line.

```bash
npm run verify:remote          # core schema/registry/behaviour checks
npm run verify:automation      # full controlled execution slice (fixtures → run → assert → cleanup)
npm run verify:objectives      # objective registries + append-only behaviour
npm run verify:intelligence    # decision/mode registries + append-only behaviour
npm run verify:all             # all suites
npm run verify:automation:dry-run   # print the plan; never connect, never mutate
npm run verify:test            # harness unit tests (no DB)
```

(`bun run …` works too — every script just calls `node scripts/verify/index.ts`. Use
`npm run` since Bun may not be installed locally.)

## Purpose
Replace the slow manual loop (assistant writes SQL → paste into dashboard → copy results
back) with a safe, deterministic, source-controlled runner. No query results are ever
copied into chat.

## Architecture
- **Node/TypeScript runner** under `scripts/verify/`, run with `node` (the repo already
  runs `.ts` via Node). No new dependency — it reuses the already-present
  `@supabase/supabase-js` (lazy-imported, so dry-run/unit-tests load nothing).
- `lib.ts` — **pure core** (env, redaction, run-id, fixture tagging, cleanup scoping,
  project allowlist, bounded polling, reporting). Fully unit-tested with injected mocks.
- `client.ts` — the **only** networked module: service-role client + `platform-worker`
  invocation. A narrow, allowlisted surface — **no arbitrary-SQL endpoint**.
- `suites.ts` — the four suites; each has `plan()` (dry-run) and `run()` (live).
- `index.ts` — CLI: args, env, project confirmation, run, redacted terminal + JSON report.

### Why no arbitrary remote SQL
A general remote-SQL endpoint (or an RPC that runs caller-supplied SQL) would be a
production foot-gun and an injection surface. Instead the harness verifies **behaviour**:
it creates a run-tagged fixture, attempts the illegal mutation (update an append-only row,
an illegal transition, a business outcome without verification) and asserts the database
**rejects** it — proving the trigger/RPC works, not merely that it exists. Registry/data
facts are read via PostgREST; source-of-truth facts (registered job types, migrations,
disabled intents) are checked against repo files.

## Environment setup
Copy `.env.verify.example` → `.env.verify` (git-ignored) and fill in:

| Var | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | ✅ | linked project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | service-role key (redacted from all output) |
| `WORKER_SECRET` | for automation | invoke the deployed `platform-worker` |
| `VERIFY_ALLOW_PROJECT_REF` | **for mutation** | exact allowlist; must equal the project ref or the run is refused |
| `SUPABASE_PROJECT_REF` | recommended | matched against the allowlist (else derived from the URL) |
| `VERIFY_TENANT` | optional | fixture tenant (defaults to the seeded Drummond tenant) |
| `VERIFY_CI` | optional | `true` to allow non-interactive CI |

The service-role key lives **only** in `.env.verify` (git-ignored, never `VITE_`-prefixed,
never in the public `.env.example`). A missing var prints a clear setup error and exits 2.

## Safety controls
- **Redaction** — the service-role key and worker secret are stripped from every log line
  and JSON artifact; JWT/token-shaped strings are masked generically.
- **Exact project allowlist (no bypass)** — mutation requires
  `SUPABASE_PROJECT_REF === VERIFY_ALLOW_PROJECT_REF` **exactly**, checked *before* the
  client is created. `--confirm-project` (or `VERIFY_CI=true`) is an **additional
  acknowledgement** on top of the match — never a way around an unknown/mismatched
  project. Project + tenant are printed before any mutation.
- **`--dry-run`** — prints the ordered plan, connects to nothing, mutates nothing, and
  takes **no lease**.
- **CI** — non-interactive only when `VERIFY_CI=true`.
- **Failure-safe restoration** — the Automation suite captures the exact pre-run state
  (mode entry, connector, capability) and restores it in a `finally` that runs after
  success, an assertion failure, a worker/polling timeout, or any exception. A
  **pre-existing** connector/capability is restored to its prior values, **never
  deleted**; only rows this run created (and tagged) are deleted. Every fixture is
  classified `restored | deleted | retained | cleanup_failed`; a `cleanup_failed`
  **fails the suite** and is reported.
- **Mutating-run lease** — a mutating suite acquires a `(tenant, suite)` lease
  (`verification_locks` + `verification_acquire_lock`/`verification_release_lock`,
  migration `20260723120000`); a second concurrent run is refused, abandoned leases
  expire and can be reclaimed, only the owning run can release, and release happens in
  a `finally`. Dry-run takes no lease. This is a narrow lease table + two RPCs — **not**
  a remote-control or SQL endpoint.
- **Hard-blocked forever** — enabling `schedule_engineer_visit`, real connectors, emails,
  messages, calendar events, orders, inventory, spend, real strategy, or any Operational
  Mode / authority bypass. The Automation suite drives only the side-effect-free
  `controlled_test` adapter.

## Fixture & cleanup model
- Every fixture is tagged `{ verification: true, verification_run_id, source:
  "remote-verification-harness" }` in its `parameters`/`settings`/`metadata`.
- Cleanup deletes **only** run-tagged rows in **mutable** tables (connector, capability,
  config version, mode override, platform_jobs).
- **Immutable audit is never deleted** (`automation_execution_attempts`, `outcomes`,
  `automation_execution_guard_decisions`, `automation_approvals`, `decision_log`,
  `objective_health`, `measurements`). Their ids are **retained and reported**. The
  controlled Automation intent is retained (its attempts FK-cascade), not deleted.

## Automation suite flow
registries → append-only behaviour → controlled action + immutable `AUTOMATION_AUTHORISED`
decision → controlled connector + capability → controlled `record_controlled_execution`
intent → **assert Discovery blocks** → temporary tenant **Trusted** override (dedicated
verification `config_version`) → process via `platform-worker` → **assert** guard allowed,
in-flight + terminal attempts, intent succeeded, exactly one `system_observed` operational
Outcome, no business outcome, no Objective-Health write, synthetic external ref → **retry
⇒ already_completed**, no duplicate attempt/outcome → **restore mode** → cleanup.

## Troubleshooting
- *Setup error / exit 2* — env not configured, or project not allowlisted/confirmed.
- *`WORKER_SECRET is required`* — the automation suite needs it to process jobs.
- *job timed out* — the deployed `platform-worker` isn't reachable or the secret is wrong.
- *append-only probe skipped* — the table had no row to probe yet (safe no-op).

## CI considerations
Set `VERIFY_CI=true`, provide secrets via the CI secret store (never committed), and set
`VERIFY_ALLOW_PROJECT_REF` to pin the target. Use `--json` for machine-readable artifacts
under `.verification-results/` (git-ignored). Exit code is non-zero on any failure.

## Adding a future suite
Add a `Suite` (`plan()` + `run()`) to `suites.ts`, register it in `SUITES`, add a
`verify:<name>` script. Reuse `enqueueAndProcess`, `count`, `expectRejected`, the run
collector, and fixture tagging. Keep new suites read-mostly and fixture-tagged.

See also: [UNIVERSAL_AUTOMATION_ENGINE.md](UNIVERSAL_AUTOMATION_ENGINE.md),
[WORKER_HANDLERS.md](WORKER_HANDLERS.md).
