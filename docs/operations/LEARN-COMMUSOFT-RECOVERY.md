# Commusoft import recovery for LEARN

Local recovery checkpoint: 9 October 2026. No hosted migration, deployment,
provider call, real import or employee assessment was performed in this increment.

## Recovered work and provenance

The older checkout `/Users/chrisdrummond/serviceos-dh` contains substantial work
absent from the recovered OpenFolk snapshot. Its working changes were left intact.
Recovery is selective; this does **not** establish that every historical feature
has been reconciled into this branch.

| Historical commit | Work brought forward |
| --- | --- |
| `3e2e188eeee701129dbeef40cb0ddd92e5577538` | Governed customer/site/job import migration, Edge handler, UK phone normalization and SQL regression suite |
| `96294da717a807d3d7071666d2551be0186cb406` | Multi-phone primary-contact fix, SQLSTATE-only failure classification and pure assertions |
| `9a34b0c2da02a9b1f7f729794662ec59bc42565c` | Exact job-to-site resolution migration |

Historical migration files retain their names and contents. The Edge handler is
the first commit's version plus the later failure-classification patch, local
sealed-contract fallback hardening and two TypeScript null assertions after the
existing connection guard. This avoids enabling the later financial importer
before its missing schema and UI dependencies have been reconciled.

## Behavior now available locally

Explicitly selected governed profiles seal the definition, hash, mapping and
options at preview. Apply checks the source checksum and uses that saved contract.
Damaged governed contracts cannot downgrade into the legacy import path. Atomic
row RPCs retain outcomes, provenance, conflicts and external identity links;
replays do not create duplicate customers or jobs. Ambiguous identity and missing
dependencies remain reviewable rather than being silently guessed.

Customers may retain multiple phone numbers with one primary per channel. Exact
job site references take precedence over address matching; an invalid exact
reference creates a blocking conflict rather than falling back to another site.
Full source timestamps survive the prepared profile and database import. An
engineer name remains source metadata and is never enough to assign a person.

The new `20261029170000_learn_import_boundaries.sql` makes role grants explicit:
clients cannot read the row ledger or execute the later import helpers. Existing
tenant-scoped conflict/identity reads remain available. This was necessary because
the older local schema's default grants caused the historical ledger privacy test
to fail before hardening.

## Verification and its limits

Commands run successfully:

```sh
node supabase/functions/_shared/imports/imports.verify.ts
node --test scripts/import-pure.test.mjs scripts/learn-import-contract.test.mjs
python3 scripts/verify/learn-import-recovery.py
```

Fifteen import assertions, thirteen profile/masking tests and five Edge rejection
tests passed. The existing 21 performance reader/review/scorer tests also passed.
An isolated TypeScript check of the handler and real pure/auth helpers passed,
with Deno globals and network imports represented locally; it was not a Deno
runtime check. The Edge tests execute the real handler with mocked I/O and cover
invalid contracts, changed CSV, changed profile and unknown entities before writes.

The SQL runner reads **schema only** from the older local Supabase container. It
creates a disposable, network-isolated database with no host mounts, public ports,
source table data or copied role passwords, reapplies the recovered definitions,
and exercises the historical SQL suite plus supplemental regression assertions.
Checks include shared identities, cross-tenant refusal, immutable outcomes,
replay, multiple phone numbers, exact site failure, offset timestamps, no engineer
name guessing and explicit helper privileges. Temporary containers are removed.

This is integration against the historical local schema, not a clean replay of
every migration in this branch. Hosted migration reconciliation, a real Deno HTTP
preview/apply journey and ordinary user acceptance remain release gates. Do not
blindly run all pending migrations against production. Historical HTTP test scripts
in the older checkout mutate synthetic tenants and must not be run with production
credentials.

## Source status and remaining recovery

Read-only Drummonds metadata checks returned zero Commusoft provider connections,
tenant connector rows, source imports and source jobs in the production project
examined. This does not establish that exports, credentials or feeds do not exist
elsewhere. It also does not change the separately inventoried email/call history.

This restored path imports prepared files; it does not yet provide continuous
Commusoft API ingestion, assignment history, handoffs, repeat-visit classification
or vehicle telematics. Static job dates cannot establish individual responsibility
or time on someone's desk. Source timestamp timezone interpretation must be agreed
for exports without explicit offsets before they support elapsed-time scores.

The older checkout also contains financial truth/job cards, roster control,
work transitions, accounting/input reconciliation, job identity links and job
reference configuration. Those modules and their later migrations remain to be
compared with the current branch before reuse. Routes were deliberately not copied
wholesale over the current LEARN and receptionist work.

Next: reconcile those identity/work-history dependencies, locate the prepared
Commusoft exports and actual authorized connection configuration, then feed only
verified subject/period evidence into the existing performance append/review path.
No data gap should become a zero score or an assumed employee assignment.
