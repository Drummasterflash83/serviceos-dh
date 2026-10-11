# Company calendars for evidenced working time

Local backend/API and owner settings candidate, 11 October 2026. **Not deployed
and not yet connected to working-time card collection.** TEST remains on release 049. No company
calendar has been chosen or published for Drummonds, and no score or source record
has changed.

The existing desk-time function accepts explicit ownership, business-hour windows
and approved exclusions. It did not have governed company calendars behind those
windows. This candidate supplies versioned calendar definitions and publication
history; it does not yet supply approved delays, employee working-hours policies
or the finished working-time measurement adapter.

## Calendar definition and publication

Each tenant can maintain a company calendar with a name, named timezone, weekly
local-clock windows and date overrides. There is no assumed Monday–Friday or UK
schedule. ISO weekdays run Monday 1 through Sunday 7. Minute windows are half-open,
from 0 to 1440, and must not overlap within a day. Split shifts use separate windows;
overnight shifts are split explicitly between dates. An empty date override means
closed and replaces that day's weekly hours. Empty weekly hours are also explicit,
not missing configuration. Limits are 84 weekly windows, 366 date overrides and
12 windows per overridden date; the definition is bounded to 256 KiB.

Saving creates an immutable tenant revision. It requires the current owner/admin,
the expected previous revision, a request ID and a reason. Exact retries return
the retained result; changed identities or stale revisions conflict. Saving alone
does not activate hours. A separate publication requires the latest saved version
and the expected current publication. Its effective time is assigned by the server
after the company lock, never supplied or backdated by the browser. Later drafts
leave the published calendar unchanged, and later publications preserve the past.

Calendar versions, publications and cancellation receipts are append-only, tenant owner/admin readable
with RLS and no direct client/service writes, deletes or truncation. The existing
collection access gate checks actual profile role/tenant and rejects View-As,
holding the profile lock against concurrent revocation. Save/publication use shared
request and company locks. Cross-use of a request ID between those operations is
refused. No new operator authority, profile, provider connection or capture is created.

## Owner settings and interrupted-request recovery

Company cards now offer **Manage company calendar** to the actual company owner
or admin. The editor starts without assumed hours or timezone. It supports split
weekly windows, end-of-day boundaries, closed dates and custom date windows.
Published hours, effective timestamp and reason are shown separately from the
latest saved revision and unsaved edits. Save and publish each require a reason;
publishing requires the editor to match the saved revision. Saved-version preview
shows its exact revision, UTC period, named timezone, every expanded window and
eligible-minute total, explicitly as a simulation. Invalid/failed previews retain
any earlier result with its original dates and revision clearly displayed.

One durable browser request per backend/actor/company covers both save and
publication. It is retained and read back before the first RPC, coordinated with
Web Locks, and cannot be overwritten by a different request. Recovery displays the
original reason and definition or version/publication references and offers check,
retry-original, and cancel-pending actions. Scope, access and stored details are
checked across asynchronous boundaries; closing settings or changing role stops
subsequent calls. Invalid or unavailable browser storage prevents a new write.

The fifth owner RPC, `learn_work_calendar_resolve`, shares the original write's
request lock. Exact recorded requests resolve to their retained timestamp, even
if the current draft/publication has advanced. Cancelling an unrecorded request
appends an immutable cancellation receipt; any delayed save/publication with that
ID is refused. Cancelling a completed operation reports it as recorded and does
not undo it. Canonical payload construction is shared with save/publication and
binds tenant, actor, operation, exact definition/version, expected head and reason.
Changed identities conflict. A terminal server receipt is required before clearing
browser recovery details. A failed refresh after that receipt is reported separately
from the confirmed outcome and disables new changes until a successful reload.

## Time conversion and retained history

The compiler evaluates real UTC minutes in the configured local clock and groups
contiguous eligible minutes into windows, clipping the first/last window to the
exact supplied period. It supports at most 366 days, between 2000 and the end of
2200. Date overrides use the local calendar date. Both occurrences of a repeated
clock hour count if they fall inside the schedule; skipped clock minutes do not
exist. These are elapsed minutes inside company opening hours, not evidence that
someone was working or should receive a particular reward.

PostgreSQL's timestamp/timezone conversion supplies the local date and clock for
each real instant. See the [PostgreSQL 17 date/time documentation](https://www.postgresql.org/docs/17/functions-datetime.html#FUNCTIONS-DATETIME-ZONECONVERT)
and [date/time type semantics](https://www.postgresql.org/docs/17/datatype-datetime.html).
The candidate avoids resolving an ambiguous local opening time to one guessed UTC
instant. The actual expanded windows must be retained by the eventual collector;
timezone databases can change, so later recompilation is not a historical receipt.

The private snapshot reader considers only publications visible at its observation
time. It clips each revision to its effective interval and returns the exact
calendar definitions, publication/actor/reason references, windows and uncovered
periods. Time before the first applicable publication is explicitly missing; an
absent calendar cannot turn into zero eligible working time. A snapshot with gaps
must withhold any derived performance value. At most 100 publications may overlap
one snapshot. The public preview deliberately labels its result a simulation,
including when previewing a saved draft or future dates.

## Verified locally

- Offline PostgreSQL 17 schema-only clone, with synthetic fixtures and no copied
  source data or credentials: rollback rehearsal and migration pass.
- Weekly/date-window validation, split shifts, adjacent-window merging, holiday
  replacement, invalid dates, numeric forms, unsupported timezones and size/period
  boundaries pass. A 366-day all-hours calendar produces all 527,040 minutes.
- London spring and autumn transitions, New York skipped/repeated hours,
  Lord Howe's half-hour transition, Apia's skipped date and sub-second period
  clipping pass against real PostgreSQL timezone behaviour.
- Save/publish exact retries, changed requests, stale versions/publications, no
  draft activation, prospective publication, immutable rows, preserved earlier
  snapshots, foreign tenants, revoked owner access, View-As and no-identity RPC
  denials pass. Two actual database sessions saving revision 3 yield one winner.
- Existing measurements, resumable collection receipts and work-history fingerprints
  remain unchanged through the calendar operations. The earlier 14,500-item work
  collection assertions run in the same disposable database.
- Twenty-one calendar/client recovery tests and fourteen scorer tests pass; application
  and preview TypeScript and builds pass (including 47 application prebuild checks). Actual SQL read and preview
  responses pass the production parsers; their windows feed the existing desk-time
  interval function with the independently expected 1,920 minutes.
- Development runs exposed a reserved SQL alias, ambiguous variable/fixture names
  and integer-looking JSON decimals. These were corrected; the final full suite
  passes. Browser verification also caught native time/date edits disappearing on
  subsequent renders; input handling was corrected and the actual save flow rechecked.
- Offline recovery assertions cover exact recorded/cancelled/pending outcomes,
  cancel-before-write, late request refusal, stale-head cancellation, malformed or
  changed payloads, cross-kind/actor/tenant identities, immutable cancellation rows,
  revoked access, View-As, no-identity RPC denials and source/measurement preservation.
  Actual SQL resolution passes the production client parser. Concurrent real database
  sessions racing save/cancel and publish/cancel each retain one stable outcome.
- The actual local browser verifies explicit hours and a closed-date override,
  a saved draft remaining unpublished, the expected 480-minute preview, a later
  draft leaving publication revision 1 intact, overlap rejection, invalid preview
  retaining its labelled earlier result, and management hidden for a viewer.
  Lost save and publication replies survive reload with the original request;
  recovery does not create another revision. Cancelling an already committed
  publication reports success without retracting it; cancelling an unrecorded
  request leaves no saved revision. No browser console errors were observed.
- Synthetic browser fixtures use session storage only and never call a provider.
  These checks do not establish hosted owner acceptance or real company hours.

```sh
python3 scripts/verify/learn-work-calendars.py
node --test src/lib/learn-work-calendars.test.ts src/lib/learn-work-calendar-outbox.test.ts src/lib/learn-scorecards.test.ts
npx --no-install tsc --noEmit
```

## Required integration

1. Add retained, scoped approval/reversal evidence for delay exclusions. A waiting
   or blocked work state must not automatically become an approved exclusion.
2. Connect calendar snapshots, selected work states and approved exclusions to the
   resumable collector using a distinct working-time contract. Preserve existing
   elapsed ownership/handoff meanings, freeze all inputs, retain full proof and
   withhold unknown history. Keep collection separate from human score review.
3. Verify the finished scoring adapter and its browser flows, prepare an additive pinned
   TEST release against 049, preserve existing datasets/access, and perform hosted
   owner acceptance before any production promotion.
