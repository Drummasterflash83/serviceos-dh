# Recovered roster workflow

Local recovery checkpoint, 9 October 2026. No live schema, staff record, permission,
communication or provider connection has been changed.

## Provenance and integration

Recovered the Directory → Roster screen, navigation, client calls, operator route,
six Edge action branches and original migration from local `serviceos-dh` commit
`ed84c9133250ba39d048f63e1e0859e97e347cd3`. Recovered the later responsibility
supersede tenant guard from `217b9369c73ae2d5a3a64563546359e1dedf5d0b`. The source
checkout and its uncommitted files remain unchanged. The historical staff seed
was not copied or executed: existing Drummonds people must be reconciled, not
duplicated from an old seed.

The real operator application now exposes the recovered roster alongside People,
Identity review and Ownership. It supports person/title/target-role changes,
leaving/rejoining, shared responsibilities, weekday cover, scoped authority and
existing person-hub/Command Centre preview navigation. Responsibilities and grants
can now be confirmed from their proposed state with a recorded reason. Failure
to end a responsibility/grant retains the entered reason for a retry.

Writes retain the existing platform-operator admin gate, real actor and required
reason. A tenant owner alone is not a platform operator. Machine callers cannot
use roster actions. Profile/grant/View-As read errors, ambiguous View-As reads
and malformed expiry now prevent authorization. SQL writers remain service-only;
interactive callers reach them through the Edge function, never directly.

## Recovery fixes

Additive migration `20261029200000_learn_roster_recovery_guards.sql` replaces the
recovered functions with guarded versions while retaining the original migrations
for provenance. It requires actor/reason/no View-As, validates tenant team
references, bounds weekday masks and rejects invalid date ordering. A team grant
must identify an actual team in the same tenant; the UI's team option supplies the
member's team and is unavailable when that team is unknown.
Re-proposing an ended grant resets it to proposed unless the operator explicitly
confirms it again; its old confirmation cannot silently reactivate.

A tenant-scoped transaction lock serializes these roster writers. Two attempts to
supersede one responsibility cannot create two open successors. The old assignment
is ended and the new assignment plus immutable audit entry commit together.
Legacy/background writes outside these functions do not acquire this lock; this
is not a claim that every writer has gained optimistic concurrency or retry receipts.

Reactivation now starts a new current membership period. The previous period
remains in the change log; old duties and permissions are not automatically
restored. Ending a person also closes scheduled duties, using an empty interval
when their scheduled start lies after leaving. Lifecycle changes cannot be dated
in the future through this RPC. Scheduling needs a separate accepted lifecycle
workflow rather than partially ending duties early.

The roster reader checks exact counts, tenant ownership and unique IDs for members,
open/scheduled responsibilities and grants. Unavailable, truncated or oversized
inventories fail explicitly instead of appearing to be an empty team. Each read
is limited to 2,000 records; larger rosters need pagination before acceptance.

## Verification and limits

```sh
node --test scripts/learn-roster-recovery.test.mjs src/lib/openfolk-workspace-nav.test.ts
python3 scripts/verify/learn-roster-recovery.py
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

The SQL runner reads only schema and role names from the existing local Supabase
container, then uses a disposable network-isolated clone with synthetic tenants.
It copies no table data, passwords or storage. Assertions cover lifecycle,
proposed defaults, tenant/team boundaries, invalid dates/weekdays, audit preservation,
transaction rollback and execute grants. Two real concurrent sessions produce
exactly one replacement. The clone is removed afterward; the source is untouched.

Six focused Node tests execute the real Edge handler and authorization module
with mocked I/O, plus the real roster reader and workspace response assembly. All six actions, missing platform
authority, View-As, failed reads, machine rejection, reason enforcement and database
failure acknowledgements are covered. This does not establish Deno/HTTP acceptance.
The 23 navigation tests and application type check pass.

Application and preview builds/type checks pass, including the 47 build prerequisite
tests. Browser review confirms both responsibility and authority confirmations
require a reason and remove the proposed label after a successful synthetic
response. No browser console errors were observed. The browser fixture exposed
and prompted a fix for cramped member-header layout. Existing bundle warnings remain.

The local `/roster-review` route mounts the actual recovered component with synthetic
in-memory actions. It does not test real auth, audit persistence or provider data.

## Remaining release and scoring work

Reconcile target migration history and apply the two recovered migrations plus the
guard migration only on a verified test target before releasing the new reader,
Edge function and UI together. Verify real operator/viewer/user sessions and
source-stack compatibility before production. Staff creation and grant operations
do not yet have replay receipts; refresh after uncertain writes before retrying.

Roster configuration is not immutable historical membership coverage. The current
member row and historical changes can inform a future history reader, but the
ledger does not prove that all old direct/background changes were captured. Do not
rate earlier periods using today's group or title. Membership history, coverage,
business calendars, exclusions and eligible work populations still need connecting
to the performance measurement adapter. Weekday/timezone cover resolution and
team-scoped work authority remain separate recovery work; this increment configures
their inputs and does not claim they are already enforced by work-transition.
