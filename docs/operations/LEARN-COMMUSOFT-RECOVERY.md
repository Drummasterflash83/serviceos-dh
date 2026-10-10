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

## Located package and retained validator — 10 October

The existing files are at
`/Users/chrisdrummond/Documents/DH Works/prepared_packages/commusoft_canonical_v4`.
The package contains **1,613 customers, 962 sites and 4,000 jobs**. All three
file hashes and row counts match their manifest, and the manifest seal verifies.
The 4,000 jobs comprise 2,796 completed, 250 open and 954 aborted records. These
are historical package statuses, not fresh provider observations.

The later historical package contract, pure preparation core and offline verifier
have now been recovered into `scripts/commusoft/`. Provenance: contract commit
`c4b332df34e8ad6619e12492947167bd54f60d6b`, core commit
`4a5d14c0b0eb4e898856a410c489b15dff0541ba`, verifier commit
`0d8bee179c20cc02c683d558ff25fc19bbdb32d6`. The contract comment was corrected to
describe its existing accepted version 4. The verifier uses this branch's actual
importer coercion. Older package versions remain historical evidence.

The current package **does not pass the full contract**. Of 228 exact job/site
references, 227 align with the job's customer; one points to a site owned by a
different customer. No external IDs are duplicated and no customer/site references
are missing. This is an ownership contradiction, not an absent-site fallback. The
validator refuses the package and the existing database resolver also refuses such
a link. The original source files were left unchanged, and no import was attempted.
Private external-ID references for review are retained only in ignored verification
output; no customer rows were copied into this repository.

The customer and address source seals match the retained source-evidence record,
whose classification remains `locally_sealed_recovered_export`. They are not
register-verified originals. Registered job-related source hashes match the evidence
register. The derived financial package remains unclassified in this verifier;
it is not part of the three-file canonical import.

The nearby derived diary file
`/Users/chrisdrummond/Documents/DH Works/output/v2_analysis/normalized/diary_events.csv`
contains **8,889 rows** with engineer names, visit statuses, diary/creation dates,
travel and on-site durations. Only 5,419 rows have a job record number. Its values
must be traced through the original exports and normalization rules; filled cells
do not establish completeness, reliable time measurement or confirmed identity.
There is no stable event-ID column in this derived CSV. Engineer names need a
reviewed source-to-member mapping before they can support individual scores.

All 4,000 prepared jobs have blank engineer and completed-date fields. 3,046 have
created dates, with no explicit timezone offsets. Consequently this package cannot
by itself establish engineer assignment, completion elapsed time, desk residence,
return-visit cause or driving performance. Those gaps remain unassessed.

Reproduce the read-only package check:

```sh
node scripts/commusoft/verify-canonical-package.mjs --package '/Users/chrisdrummond/Documents/DH Works/prepared_packages/commusoft_canonical_v4' --source-evidence '/Users/chrisdrummond/Documents/DH Works/prepared_packages/source_evidence/commusoft_source_evidence.json' --register '/Users/chrisdrummond/Documents/DH Works/output/v2_analysis/normalized/evidence_register.csv'
node --test scripts/commusoft/package-contract.test.mjs scripts/import-pure.test.mjs scripts/learn-import-contract.test.mjs
```

The real-package command correctly exits 1 for the ownership contradiction. All 22
synthetic/import tests pass, including four new tests for same-customer links,
cross-customer refusal, file/manifest/profile drift, historical versions, phone
coercion and honest provenance. The old broad test runners were not run because
they inspect the separate historical database; the new tests use only synthetic
in-memory packages.

See [package and source-shape evidence](evidence/learn-commusoft-package-recovery-2026-10-10.json).
Next: reconcile the disputed link from authoritative source records without
guessing, trace diary identities/timestamps, and finish the governed import's TEST
release and ordinary-user preview/apply path. Package consistency is not a live
Commusoft connection or scoring acceptance.

## Ownership contradiction traced and preparation guarded — 10 October

The offline trace verifies the package manifest/output hashes and all five sealed
supporting source files. Exactly one row in the sealed May–August diary names the
disputed job, its job customer and the disputed site. None of the other four
supporting exports names that job. The current-window job export also passes its
manifest hash check. This explains where the prepared reference came from; it
does not settle which source is correct. The prepared site master associates that
site with a different customer. No address/name inference or automatic repair was
made, and the package remains refused by the full validator.

The recovered preparation core previously tested only site existence. It now
requires an exact site-to-customer map and classifies mismatched ownership as
`conflict_or_duplicate`, with a separate `site_customer_conflicts` count. It emits
no reconstructed row for that conflict. Duplicate site-master IDs are rejected
before creating the map. Existence-only callers fail explicitly; any subsequently
recovered preparation CLI must pass `siteCustomers: indexSiteCustomers(sites)`.
The separate historical checkout and its CLI are unchanged.

Five new synthetic regressions cover aligned ownership, conflicting ownership,
missing/malformed ownership evidence, duplicate site IDs and existing unresolved
reference behavior. All 27 focused preparation/package/import tests pass. Running
the real sealed evidence through the guarded core classifies the one disputed
job as a conflict with zero reconstructed rows. This was an in-memory analysis:
all original 4,000 package job rows, other source files and hosted data remain
untouched. No revised package was generated or imported.

Reproduce the aggregate-only, read-only trace:

```sh
node scripts/commusoft/trace-site-ownership.mjs '/Users/chrisdrummond/Documents/DH Works/prepared_packages/commusoft_canonical_v4' '/Users/chrisdrummond/Documents/DH Works/source_data/v2/commusoft' '/Users/chrisdrummond/Documents/DH Works/source_data/commusoft/profit_by_job_2026-05-01_to_2026-08-04.json'
node --test scripts/commusoft/prepare-site-ownership.test.mjs scripts/commusoft/package-contract.test.mjs scripts/import-pure.test.mjs scripts/learn-import-contract.test.mjs
```

See [retained aggregate trace](evidence/learn-commusoft-ownership-trace-2026-10-10.json).
Other diary windows were not silently incorporated. The site master retains its
`locally_sealed_recovered_export` provenance. Authoritative ownership clarification
is still needed before resolving this job; unrelated import recovery can continue.

Historical Phase 11O/11T records in the old checkout also describe 4,000 imported
jobs and later site-link repairs in its earlier local environment. Those records
must not be confused with the zero jobs observed in the currently inspected
production project. Later site-identity evidence, incidents, acquisition contracts
and repair history remain candidates for selective recovery, not proof that they
are installed in current TEST or production.
