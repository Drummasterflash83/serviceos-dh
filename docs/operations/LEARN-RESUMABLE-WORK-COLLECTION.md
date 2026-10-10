# Resumable collection for retained work

Local backend and card UI candidate, 11 October 2026. **Wired and verified locally;
not deployed.** The protected TEST site still uses release 048 and the
existing bounded collectors. Production remains unchanged.

A read-only count at 10 October 23:09:09 UTC found **14,394 intelligence objects**
in the production company. The existing 2,000-item cap therefore prevents those
collectors from evaluating its full retained population. This candidate processes
a frozen population in batches instead of raising a one-request cap or truncating
its evidence. The offline test contains 14,500 synthetic work items.

## Snapshot and progress contract

`learn_work_collection_begin` accepts an exact tenant, actor-bound request, subject,
collector kind, saved policy revision, completed period and reason. It acquires the
existing request/cell locks, refuses duplicate cells or reused identities, and
checks the same member/team rules and source contracts as the original collectors.

One SQL statement freezes the whole observed roster, team directory, work population,
each object's first capture and last visible capture sequence. The current source
state must reconcile with that head. Each item gets a fixed ordinal. Nothing starts
capture, creates a historical baseline, imports a provider record, changes a source,
or derives earlier ownership from a present directory row.

`learn_work_collection_step` processes at most 100 frozen items. Its expected prior
checkpoint is mandatory. Two simultaneous calls with the same checkpoint return
the same committed progress, rather than processing twice. A lost-reply retry
cannot advance an extra batch. Source history is read only through each frozen
head; later insertions, assignments, membership changes and baselines do not enter
the calculation. The original roster and directory are used throughout.

The three kinds retain their existing meanings:

- `handoffs`: recorded outgoing member ownership transfers, deduplicating aliases.
- `residence`: member-owned elapsed item-minutes across all recorded states.
- `teamResidence`: direct team time and members' observed team affiliations, counted
  once per item segment.

The source/metric/unit identifiers remain the existing `@1` measure contracts.
Frozen team resolution additionally requires its directory creation time to precede
the attributed segment. These are workload/transfer measures, not working hours,
productivity, job quality or automatic pay decisions.

No observation is saved until every frozen item has been examined. Finalization
uses the existing cell lock and performance append function. A complete receipt
and inferred measurement commit atomically; an append failure rolls the final
batch back. Incomplete history saves a withheld value with explicit coverage,
never a guessed zero. `sourceThrough` is the frozen snapshot time, not completion
time. Human review remains separate.

A newer saved policy revision cannot alter a running request's original revision.
Existing revision immutability is preserved. If its actual original policy becomes
unavailable/different, or another collector has already saved that cell, the run
ends as `superseded` without a competing observation. Explicit abandonment retains
all snapshots and any processed evidence; it is not deletion. Begin/step/status/
abandon remain bound to the original actor. Ending a saved request whose start was
not acknowledged records a terminal cancellation intent under the same request
lock; a delayed begin cannot resurrect it. The complete original descriptor and
both reasons are retained, even when no population was frozen. Each mutation rechecks current role,
tenant and View-As, holding the profile lock against revocation.

## Retention and review

`learn_work_collection_runs` holds the frozen request/identity context, aggregate
progress and final summary. `learn_work_collection_items` holds the population,
source boundaries and each item's completed calculation proof. Scope fields and
completed evidence are immutable; neither table permits client/service writes,
deletes or truncation. Tenant owner/admin SELECT is protected by RLS.

`learn_work_collection_evidence` exposes only completed calculations, separating
its overview, frozen membership, frozen teams and item pages. Item pages are ordered
by ordinal, contain at most 100 items and approximately 2 MiB of retained proof,
and report an exact continuation. It never shortens an item's evidence. Capture
sequence IDs travel as strings to preserve 64-bit precision. The append evidence
allowlist admits the new run table only when the referenced run is completed.
Existing member/team receipt tables and their rows remain unchanged.

The population has no 2,000-item limit or single 1 MiB aggregate-proof limit. Resource
bounds still apply per item: 1,000 selected history events, 10,000 attribution
segments and 1 MiB item proof. The existing frozen-roster reader remains bounded to
500 members, 5,000 selected events and 2 MiB. The frozen team directory is limited
to 2 MiB; periods remain at most 366 days. Exceeding a bound refuses the relevant
transaction. Very large snapshot creation/history scans still need production-scale
latency observation; the population test is not a universal throughput guarantee.

## Card controls and browser recovery

The member and team card controls now use the resumable API. Before network dispatch,
the browser persists the exact backend, account, tenant, card, collector, request ID,
policy revision, dates and reason. A Web Lock serializes work for that scope; dates
and policy revisions do not change the storage key. Reload and card closure stop
further dispatch while preserving the original request. Access changes, another
tab changing the saved request, and an explicit pause also stop further batches.
An in-flight request may finish; Check collection progress reads the server before
continuing. Unknown or collecting requests cannot be cleared. Explicit ending and
clearing a verified finished reminder are separate actions.

Recovery controls remain available even when selected rules are unavailable or the
current dates differ. A completed request can reopen its frozen rules and exact
period as a labelled draft simulation. This does not publish rules or activate a
pay score. The measurement reader accepts completed run evidence; the card routes
it to a dedicated full-proof viewer. The overview is labelled a summary. Previous/
next item pages, full individual proof, frozen roster and team directory can be
inspected separately. Failed page reads retain the displayed page and allow retry.

Saved reminders are browser-local, not cross-device recovery. Clearing a completed
reminder leaves its database evidence intact; a general server-side collection
history picker remains a future recovery/usability improvement.

## Verification

- The disposable, network-isolated PostgreSQL 17 runner uses a schema-only local
  clone and synthetic data. It never copies real data or credentials.
- 14,500 items complete across 145 batches and match an independent elapsed-time
  sum. Later inserts, work changes and membership changes do not change the result.
- All three small-population results match their existing collectors, including
  alias handoffs and team attribution. Previous measurements and receipts remain.
- Lost replies, duplicate cells/IDs, foreign tenants, wrong actors, revoked roles,
  View-As, immutable rows, abandonment, immutable/new policy revisions, older-collector
  competition, missing history, later baselines and final-append rollback pass.
- Two actual database sessions advance the same batch checkpoint once. Both older
  member/team same-cell races continue to pass.
- All 14,500 retained item proofs are traversed using deterministic evidence paging.
- The exact no-identity role probe checks all five public RPCs, private helper
  permissions and both table boundaries for anon, authenticated and service roles.
- Actual SQL progress, overview, identity snapshots and the first evidence page pass
  the new client API parsers. The actual completed SQL measurement also passes the
  card measurement parser and scorer: separate confirmation permits a draft score,
  while removing that review withholds it.
- All 45 focused client tests pass, including eight durable outbox tests, API,
  older collector, measurement, review and scoring regressions. Application and
  preview TypeScript, production build (47 prebuild checks) and preview build pass.
- Synthetic actual-browser verification covers completed team collection, all three
  item pages (100/100/50), full 64-bit capture sequence, frozen identity inspection,
  failed-page retry retaining the current page, human confirmation, reload with
  changed default dates, original-rule review, lost batch reply/reload/resume,
  pause with an in-flight batch, rule selection changes and retained abandonment.
  Incomplete 249/250 coverage remains unassessed even after human confirmation.
- Cancel-before-start and a delayed begin are verified in SQL and outbox tests;
  they are not claimed as a separate hosted/browser acceptance run.
- During test development, malformed/colliding synthetic IDs and incorrect assumptions
  about the existing append privilege and immutable-revision error code were corrected.
  Those initial runs failed; the final complete suite passes.

```sh
python3 scripts/verify/learn-resumable-work.py
node --test src/lib/learn-work-collection-outbox.test.ts src/lib/learn-resumable-work.test.ts src/lib/learn-work-collection.test.ts src/lib/learn-performance-measurements.test.ts src/lib/learn-performance-reviews.test.ts src/lib/learn-scorecards.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

## Required before release

1. Pin an additive TEST release against 048, preserving its 91 datasets plus the
   existing team receipt ledger and all existing function/table access contracts.
2. Rehearse rollback, install, deploy the paired frontend and verify hosted owner
   acceptance. Do not deploy frontend calls before the backend exists.
3. Observe real population latency and history coverage before production promotion;
   the synthetic offline and browser checks do not establish production readiness.

Commusoft continuation approval and its retained credentials/scope are unchanged.
