# Work ownership and transition evidence

Local implementation checkpoint, 9 October 2026. No live work records, historical
communications, hosted schema or deployed endpoints were changed.

## Why this is needed

Desk-time and handoff metrics require the actual owner before and after a change,
not only today's owner or an actor's name in a status log. The recovered snapshot
also wrote history, object state and an optional objective link separately. An
interrupted operation could leave history describing a state change that failed.

The older build already had an atomic transaction in commit
`27eb4ad0642f9a34c8f8af4ce9a7c8bb163c0a42`. The new migration adapts that transaction
and extends the **existing** `object_state_history` ledger with paired ownership/
state snapshots. The pure transition decision module was recovered from
`097c44cf654b5eab3965063bc1139c5eff5fb9df`, including its missing ownership gate,
then tightened so accepting work cannot take someone else's assigned item without
ownership/assignment authority.

## Implemented path

The work projection now includes the canonical object's revision. The Command
Centre sends that revision with the requested action. The Edge handler rejects a
stale card, missing revision, unresolved authority reads and active View-As state.
The service-only SQL transaction locks the object and checks the revision again,
then saves the new object state, immutable history and objective link together.
Two requests based on one revision cannot both succeed. An uncertain response
requires a refresh; this is optimistic concurrency, not a replay-receipt API.

The database captures `work_before`, `work_after` and `transition_verb` from the
locked row and actual updated row. Each snapshot contains status, version,
responsible/accountable/waiting-on references and attributes. The event uses the
database clock after the lock, and records the authenticated profile ID and
resolved member ID. New ownership references must resolve inside the tenant;
new member targets must be active and confirmed. Linked objectives must belong
to the same tenant. Action classification comes from the object or type registry,
so tenant-specific action types can use the same path.

Structured rows cannot be rewritten, deleted or retrofitted onto legacy rows.
Because the existing ledger uses a cascading object FK, deleting an object with
structured history is refused by this guard too. Any future retention/archive
workflow must preserve those records explicitly. This migration performs no delete
or historical backfill. Existing legacy rows retain NULL snapshots and cannot be
presented as verified ownership intervals.

The Edge authority gate now distinguishes ownership from a waiting-on dependency,
checks reference kinds, and uses confirmed, effective company grants for elevated
actions. Self/team grants are not silently widened to company scope. A subsequent
local increment now resolves scoped authority and weekday/timezone-aware cover in
SQL and rechecks it at save time, including confirmed viewer-role staff self-service.
Collection visibility, UI affordances and real-session acceptance remain pending.
See [work authority](LEARN-WORK-AUTHORITY.md).

## Verification

```sh
node --test scripts/learn-work-transition.test.mjs
node --test src/lib/learn-work-history.test.ts
node scripts/work-projection.test.mjs
python3 scripts/verify/learn-work-history-sql.py
npx tsc --noEmit
npm run build
```

Ten targeted tests now pass, including actual Edge-handler execution with mocked I/O,
ownership/acceptance gates, completion evidence, stable actor IDs, revision
propagation, failed authority reads and database conflicts. Existing work projection
assertions and all 47 build prerequisite tests pass. Application type checking and
production build pass, with existing bundle warnings. A local type check of the
Edge handler using installed Supabase types and declared Deno globals also passes;
that does not establish actual Deno runtime acceptance.

The SQL runner uses a disposable, offline PostgreSQL 15 container with the actual
intelligence/history foundation migration and synthetic dependency fixtures. It
tests preserved legacy history, paired snapshots, same-state handoffs, immutable
history, foreign member/objective rejection, View-As, downstream failure rollback
and two genuinely concurrent database sessions. The concurrency result is exactly
one successful transition, one history row and one version conflict. No live
credentials, network service, source data or host-mounted database is involved.

The historical `scripts/work-transition.test.mjs` still describes the pre-recovery
split-write path and is not evidence for this implementation. Use the new tests
above; actual local-stack HTTP and ordinary-user acceptance remain to be added.

## Forward capture and card review

Migration `20261029190000_learn_work_source_capture.sql` adds a database trigger
to capture the same snapshot fields on **every** intelligence-object insert and
relevant update, including background writers that bypass the transition RPC or
do not increment the version. Each capture has a monotonic sequence, database
time and before/after state. It rolls back with the source write. Subject-only
changes do not invent ownership events. The original attributed transition row
remains separate; calculations consume only canonical capture rows, so a governed
transition is not counted twice. The capture actor is explicitly the system, not
a guessed employee.

An explicit service-only baseline RPC records an existing item's current state
once under a row lock. Coverage begins at that instant, never at `created_at`.
The migration does not run this baseline over existing items or reconstruct old
assignments. Existing history is retained, including rows without snapshots.

The owner/admin reader returns a single database snapshot of the requested
completed period, one preceding state and the capture watermark. It rejects a
disabled capture trigger, a current-state mismatch, chronological regression or
an unexplained break anywhere in the captured snapshot chain. Its period is at
most 366 days, with at most 1,000 returned events and a 2 MiB payload. Over-budget
results fail rather than truncate. These checks do not prove that a privileged
database administrator has never temporarily disabled capture; operational
controls and monitoring remain part of deployment acceptance.

Cards now offer **Ownership & time on this work** beneath each finding. The
reader validates scope, counts, timestamps, event sequence and snapshot continuity
before calculating elapsed intervals and owner changes. Times before the first
capture remain explicitly unknown. Handoffs count a recorded change between two
non-null owner references within the half-open period; initial assignment is not
a handoff. Current directory labels are optional, tenant-checked display aids;
ambiguous profiles and legacy email references do not become staff identities.

The table shows responsible/accountable/waiting-on references, raw state, elapsed
minutes and source history IDs. Elapsed calculations use millisecond precision;
sequence order preserves same-time events. Waiting, blocked and terminal states
remain visible raw intervals. Business calendars and approved exclusions have
not been applied, and this panel creates no performance measurements or scores.

Ten focused reader tests cover clipping, partial/missing coverage, timestamp ties,
half-open periods, malformed/disconnected evidence, directory ambiguity and
fractional-minute rounding. The expanded SQL suite covers background writes,
baseline idempotency, capture rollback, owner/tenant access, disabled capture,
state gaps and both response limits. Its actual SQL JSON response is fed into the
TypeScript timeline calculator, in addition to the synthetic unit fixtures.
Browser fixtures are synthetic and do not establish ordinary-user production RLS.
Application and preview type checks/builds pass, along with the 47 build
prerequisites. Browser checks confirm partial coverage (8,064 known / 2,016 unknown
minutes), complete coverage (10,080 / 0), source-reference disclosure and an
unavailable read that withholds durations. No browser console errors were observed;
existing build bundle warnings remain.

## Remaining work and release order

This is collection and factual review infrastructure, not a desk-time score. The
new trigger covers forward writes once deployed; periods before capture remain
unknown. A scoring adapter still needs historical identity/team membership,
complete eligible populations, approved calendars/exclusions and policy revision
selection. It must not infer historical performance from today's ownership or
treat a waiting/blocked state as an automatically approved exclusion.

Reconcile target migration history and the recovered scoped authority/cover dependencies,
and verify both additive migrations on the correct test target. Release the work
projection, transition endpoint and client together: the new client requires a
projected revision and the new endpoint requires the snapshot transaction. Verify
ordinary user permissions and the full UI/HTTP journey before any live release.
Plan a bounded service-run baseline for pre-existing items if needed, explicitly
recording when new coverage begins. Then connect validated work intervals to the
subject/period measurement and human review flow, including the currently missing
work-history evidence allowlist. No live migration, baseline or deployment has
been performed by this increment.
