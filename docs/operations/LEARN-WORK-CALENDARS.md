# Company calendars for evidenced working time

Local backend/API candidate, 11 October 2026. **Not deployed and not yet connected
to card collection or a settings screen.** TEST remains on release 049. No company
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

Calendar versions and publications are append-only, tenant owner/admin readable
with RLS and no direct client/service writes, deletes or truncation. The existing
collection access gate checks actual profile role/tenant and rejects View-As,
holding the profile lock against concurrent revocation. Save/publication use shared
request and company locks. Cross-use of a request ID between those operations is
refused. No new operator authority, profile, provider connection or capture is created.

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
- Seven client tests and application TypeScript pass. Actual SQL read and preview
  responses pass the production parsers; their windows feed the existing desk-time
  interval function with the independently expected 1,920 minutes.
- Development runs exposed a reserved SQL alias, ambiguous variable/fixture names
  and integer-looking JSON decimals. These were corrected; the final full suite
  passes. These results do not establish hosted or browser acceptance.

```sh
python3 scripts/verify/learn-work-calendars.py
node --test src/lib/learn-work-calendars.test.ts
npx --no-install tsc --noEmit
```

## Required integration

1. Build the owner calendar settings and preview screen, with durable exact-request
   recovery for save and publish. Display current published hours separately from
   unsaved/saved drafts, and require an explicit reason for publication.
2. Add retained, scoped approval/reversal evidence for delay exclusions. A waiting
   or blocked work state must not automatically become an approved exclusion.
3. Connect calendar snapshots, selected work states and approved exclusions to the
   resumable collector using a distinct working-time contract. Preserve existing
   elapsed ownership/handoff meanings, freeze all inputs, retain full proof and
   withhold unknown history. Keep collection separate from human score review.
4. Verify the actual browser flows and scoring adapter, prepare an additive pinned
   TEST release against 049, preserve existing datasets/access, and perform hosted
   owner acceptance before any production promotion.
