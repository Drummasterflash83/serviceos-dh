# Discovery and sync history

The previous history API read one capped response from each of Phone runs, Email
runs and file imports, then sorted/paged that partial union. Query failures became
empty arrays, totals could be understated and older records silently disappeared.
The connection detail referred to a history panel that was not rendered.

The controller now merges bounded per-source cursor pages, ordered by start time
(descending), source and UUID. Timestamp comparisons retain PostgreSQL microseconds.
Imports with no start time remain visible at the end; no time is invented. Exact
company/provider/status filters apply before paging. A fixed start-time cutoff and
import creation cutoff exclude later/future records for that traversal. The cursor
binds company, filters, page size, cutoff and source counts. Count changes require a
refresh; failed, missing-count, truncated, foreign or out-of-order reads fail.
Per-source remaining counts verify short pages rather than assuming a small server
response means the end. No full historical inventory is downloaded to serve a page.

The real operator connection page now includes a read-only history panel: 25 runs
per page, next/previous navigation, exact provider/status filters, refresh, error
recovery, recorded failures and run references. A new request clears prior results;
late replies after filter changes/unmount do not restore stale history. The demo
uses 57 synthetic rows and a named synthetic read-error fixture. No provider requests
or source writes are part of browsing history.

## Verification

- Eight reader tests cover 7,509 rows across three sources under a lower server cap,
  timestamp/source/UUID ties, microseconds/timezones, null times, filters, future and
  foreign rows, count changes, missing counts, early empty pages, malformed/cross-
  company cursors and Unicode provider names.
- Route checks confirm the existing operator gate, exact cursor/filter forwarding
  and no writes. Together with connection, roster, ownership, readiness, identity,
  health and deployment guards, 83 targeted tests pass.
- Actual isolated PostgREST v14.5 and the installed client traverse 2,203 Phone runs,
  200 Email runs and 100 imports: 2,503 unique source/run references over 26 pages,
  under a 37-row cap. Five untimed imports remain; foreign/future rows are excluded.
  A separate filter finds all 314 failed Phone runs in the total. All 362 requests
  are reads, including 241 exact-count HEADs; synthetic fingerprints are unchanged.
  This proves transport behavior on synthetic table shapes, not hosted schema or
  positive signed-in operator acceptance.
- Application/module TypeScript and the full build pass, including 47 prebuild
  checks; existing bundler warnings remain.

Reproduce with `node --test scripts/learn-discovery-history.test.mjs` and
`python3 scripts/verify/learn-discovery-history-http.py`. The isolated check uses
cached Docker images, no external network, host mounts or published ports.

## Release and limits

Reviewed runtime: 24 files,
`2ae3d36d9ab0c8e371febcf9490f6ed429363f61ca4a8bc303181d9b9cb7f9c1`.
The prepared TEST replacement requires controller v7 and the installed catalogs,
journals 101 preservation fingerprints before one submission, and checks afterward.
This local checkpoint does not yet claim deployment or browser acceptance.

The first-page response retains existing fields and adds `next_cursor`/`as_of`.
Subsequent navigation requires the returned cursor; arbitrary page-number jumps
are rejected instead of scanning or returning incomplete history. Page size is
1–100. Each source returns at most page-size-plus-one candidates; read budgets are
150 requests and 2 MiB per source/page. Error excerpts are capped at 2,000 characters.

This is a checked live traversal, not a transactionally frozen audit snapshot.
Count-preserving updates or backdated edits may still change results; refresh
starts a new traversal. Sync rows without connection IDs cannot be attributed to
one specific domain account. LEARN connector schedules, Slack ingestion logs,
signed-in hosted acceptance, live capture and recovery remain separate work.
