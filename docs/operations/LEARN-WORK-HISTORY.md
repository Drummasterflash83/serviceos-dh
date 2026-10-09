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
actions. Self/team grants are not silently widened to company scope. Team-scoped
authority and weekday/timezone-aware cover still require the older roster/cover
dependency chain to be recovered and accepted. Viewer-role self-service was also
present in the older branch but is not enabled by this increment. These limitations
must be addressed before the final operational release.

## Verification

```sh
node --test scripts/learn-work-transition.test.mjs
node scripts/work-projection.test.mjs
python3 scripts/verify/learn-work-history-sql.py
npx tsc --noEmit
npm run build
```

Seven targeted tests pass, including actual Edge-handler execution with mocked I/O,
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

## Remaining work and release order

This is collection infrastructure, not a desk-time score. Other writers can still
change intelligence objects outside this RPC and may have legacy history without
snapshots. A future adapter must establish complete source coverage, detect gaps,
use historical identity/team membership and refuse to reconstruct missing periods
from today's ownership. Waiting/blocked states are not automatically approved
performance exclusions. Calendars, exclusions, handoff semantics and review remain
explicit scoring inputs.

Reconcile target migration history, restore scoped authority/cover dependencies,
and verify this additive migration on the correct test target. Release the work
projection, transition endpoint and client together: the new client requires a
projected revision and the new endpoint requires the snapshot transaction. Verify
ordinary user permissions and the full UI/HTTP journey before any live release.
Then connect validated work intervals to the subject/period measurement and human
review flow. Do not infer historical employee performance from this migration.
