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

## Governed import TEST candidate — 10 October

A fresh read verified TEST release 021: 91 tables, 22 receipts and fingerprint
`d43c705d217934f0d69506425b703b7734b9a49f1ac32e912bbdd66166b2f042`.
The recovered import functions are absent. The earlier old-schema integration test
therefore did not establish deployability into current TEST.

Candidate release `022_governed_imports.sql` adds four tables (`contact_points`,
`import_entity_links`, `import_conflicts`, `import_row_results`), two parent
uniqueness indexes, 25 functions and three governed platform profiles. It recovers
the historical contact endpoint primitive/normalizer without enabling marketing
permission or sending machinery. Contact endpoints additionally require the same
tenant as their person through a composite foreign key. All import functions,
including trigger helpers, have explicit server-only execute grants. Clients can
read tenant-scoped contact endpoints, identity links and conflicts; the row ledger
remains private.

`scripts/verify/learn-import-bundle.mjs` generates the candidate deterministically
and records each historical source checksum. The four previously recovered import
migrations are included unchanged. Prerequisites are narrow extracts from the
historical marketing foundation/projection. The TEST transaction requires release
021, refuses colliding objects or prepared profiles, and records its receipt
atomically. Installation creates configuration only; it does not apply a file.

The new isolated runner reads the verified schema-only catalog, restoring eleven
import-related tables with their actual constraints, indexes, policies and
triggers, including the foundation and work-authority guards. It creates a fresh,
network-isolated PostgreSQL 17 container and removes it afterward. No existing
container or hosted database is used by that runner. Checks passed for:

- Deployment under a non-superuser owner, explicit rollback and receipt-failure
  rollback with unchanged pre-existing definitions and synthetic canonical rows.
- Only the intended parent indexes augment pre-existing table metadata; the three
  new profiles are the only pre-existing-table rows added by installation.
- Historical identity, replay, ledger, held/conflicting rows and tenant boundaries,
  plus multiple phone numbers, exact site resolution, timestamp preservation and
  no engineer assignment from a name alone.
- Composite endpoint ownership, tenant-scoped endpoint reads and private helpers.

Auth is a fixture stand-in; profiles are inserted explicitly in the historical
fixture. Marketing eligibility/suppression assertions are explicitly excluded
because that subsystem is absent from TEST. No mocked eligibility function was
installed to make them pass. These results do not prove actual signed-in Edge/UI
acceptance, hosted compatibility, live provider capture or a real package import.

Reproduce the local candidate check using a freshly verified 021 catalog:

```sh
node scripts/verify/learn-import-bundle.mjs --write
python3 scripts/verify/learn-import-test-projection.py .verification-results/learn-import-prerequisite-catalog.json
node --test scripts/verify/learn-test-import-release.test.mjs
```

The pinned release tool compares expected table/function/profile definitions,
retains all previous release checks, requires a fresh matching hosted rollback
rehearsal before apply, and inspects an uncertain write without replaying it.
The real package's disputed site remains unresolved and no source package is
altered by preparing this release.

### Hosted verification and installation

At **04:17:21 UTC**, the hosted rollback rehearsal was acknowledged and left
identical before/after import-catalog fingerprints. At **04:18:20 UTC**, installation
was acknowledged and the complete expected import schema/configuration matched.
Removing only this release's additions reproduces the prior schema fingerprint.
TEST now contains **95 tables and 23 receipts**. Source SQL SHA-256:
`0294ba3ef802b53ad158ee98570a79dc713840496bb45d53a4263d3f26ecea9d`.

All three import release-tool tests pass, including source/config drift, existing
profiles, wrong targets, expired rehearsals and uncertain writes without replay.
The two preceding thread-release tests also passed. The ordinary TEST UI server,
fixture and Slack fixture now require release 022; their imported release checks
continue to validate all preceding releases.

No real import, Edge deployment, provider call, schedule or production change was
performed. The next acceptance gate is actual signed-in governed preview/apply and
its review surface. The retained Drummonds package still requires ownership
clarification; installing import machinery is not approval of that package.
See [local and hosted release evidence](evidence/learn-governed-import-test-release-2026-10-10.json).

## Governed endpoint and atomic import authority — 10 October

Release 023 replaces only the private import-row authority helper. It requires an
active company and an owner/admin actor outside any active View As context, including
one targeting a different company. It acquires the existing registry/roster locks in
the established order and requires READ COMMITTED isolation. Local PostgreSQL tests
prove role, company and View As changes cannot race an active row operation. Explicit
and failed-receipt rollback restore the earlier definition and retained fixture rows.

The hosted rollback rehearsal passed at **04:32:31 UTC**; installation verified at
**04:33:12 UTC**. TEST has **95 tables and 24 receipts**. No original source rows were
changed by the release. Release SQL SHA-256:
`8e30b2e65b43de7b39b873b3ee515dd9a44da98a5964d5ae704a66ec8ef2de86`.

The existing `data-import` engine now lives in a shared handler. The legacy entry
point retains its routes; the new `learn-data-import` facade permits only governed
customer/site/job profiles and runs. It bounds declared and streamed requests at
16 MiB, requires a real signed-in company user, refuses View As writes and preserves
the explicit sealed profile/checksum contract. Read/matcher/save errors produce a
failure rather than an empty list, invalid-row classification or false success.
Apply stops on lost authority or missing durable outcomes.

The new endpoint alone was deployed to TEST at **04:39:07 UTC**, version 1, JWT
verification enabled. All earlier schema checks pass and all other endpoint metadata
is unchanged. Ten bundled source files have SHA-256:
`215aba93f37688636d45885916e34d498c34189c9ac888e7fa426833700ddc04`.
The TEST UI tools require its exact recorded metadata in addition to release 023.
The legacy endpoint was not redeployed; no frontend or production deployment ran.

Validation includes 27 handler/request/profile tests, two authority-release tests,
three deployment tests and two endpoint-catalog tests, plus strict Edge TypeScript
checking with local remote-module declarations. The local handler harness substitutes
Auth/DB I/O and the CSV parser; it is not hosted Deno acceptance. The separate actual
Auth/HTTP acceptance runner retains synthetic records, compares existing TEST source
fingerprints, and bans/rotates/demotes its temporary identities on completion.

Actual Auth/HTTP acceptance passed at **04:42:22 UTC**. It retained one synthetic
person customer, one exact-linked site, one job, three imports and three durable
outcomes. Preview left canonical tables empty; completed replay did not duplicate
records. Changed files, View As, company suspension, insufficient role, foreign
company/run access and demotion of an existing session were refused. The actual
hosted CSV parser and row functions were exercised. Pre-existing communications,
canonical entities and import evidence had identical fingerprints afterward. All
three fixture identities were banned, password-rotated and demoted.

Two earlier test attempts are retained in the evidence: one stopped before fixture
creation because its snapshot assumed a legacy table absent from TEST; the other
expected HTTP 403 for an internal service request that returned HTTP 401.
The latter's users were retired and source fingerprints matched. Neither imported
a row. These were acceptance-tool corrections; no endpoint redeployment was needed.

Hosted conflict/held-retry and large-file behavior, the browser review surface and
the real package remain outstanding. No production preservation scan ran in this
increment. See [release and signed-in evidence](evidence/learn-governed-import-endpoint-test-2026-10-10.json).

## Hosted conflict recovery and file review screen — 10 October

The expanded actual Auth/HTTP check passed at **04:45:16 UTC** against the unchanged
TEST endpoint v1. A missing customer held a job without creating an orphan. After
its customer and site were imported, retrying the exact saved file created one
correctly linked job with attempt 2. Replay created no duplicate. A cross-customer
exact site was flagged at preview and retained as a blocking conflict; a plausible
matching address did not override it. Corrected bytes were refused on that run and
required a new preview. Its original conflict/outcome remained intact. A duplicate
upload was flagged and linked the existing source identity rather than creating it.

The fixture retained **2 people, 2 sites, 3 jobs, 9 imports and 9 row outcomes**.
Pre-existing TEST communications, canonical and import evidence fingerprints
matched. Temporary users were banned, password-rotated and demoted. No original
source package, provider, production or endpoint deployment changed in this step.

The LEARN portal now includes a file review dialog using `learn-data-import`.
It offers explicit governed profile selection, prepared CSV attachment, saved
preview counts/mapping, duplicate warnings, saved results and bounded row outcomes.
CSV content stays in memory. Applying requires the exact saved checksum, current
company/profile evidence and an explicit review checkbox; the server independently
checks authority. Unknown writes are never automatically retried. The screen disables
another apply until a successful reload and displays completed-with-invalid rows
distinctly from a clean finish.

Seven client contract tests pass, including wrong-company/configuration responses,
malformed counts/mappings, changed bytes, completed runs, uncertain writes and request
limits. Application typecheck/build and both isolated/existing preview builds pass.
The actual component/client passed synthetic browser checks for file reattachment,
approval, apply, lost-response recovery, ops read-only controls and unavailable reads.
The preview uses React StrictMode, has no credentials and blocks network connections;
it is separate from hosted Auth acceptance. Its owned tab and server were closed.

Still required: actual signed-in integrated browser acceptance, larger-file behavior,
history/row pagination and a governed conflict-resolution workflow. Earlier conflict
records remain open even after a separately corrected file succeeds. The real
package's ownership contradiction is not resolved by these synthetic tests.
See [hosted and browser evidence](evidence/learn-import-review-test-2026-10-10.json).

## Actual signed-in browser import and customer-card gap — 10 October

The actual local app, using the verified hosted TEST backend, passed owner sign-in,
governed profile selection, CSV preview, saved mapping review and apply. An interrupted
browser turn was recovered by opening the same saved preview and reattaching its
original file; no second preview was created. Approval remained disabled until the
file matched and the review checkbox was selected. The real applied response showed
one created row, attempt 1. A later full page reload was started but its reopened
result was interrupted; that particular browser check is not claimed as passed.

At **06:20:10 UTC**, final read-only inspection confirmed one completed import,
one person, one source link, one outcome and one provenance record. The 17 captured
pre-existing TEST source/import table fingerprints matched. The temporary owner
was banned, password-rotated and demoted; its members were retired. Fixture evidence
remains, its plaintext password file was removed, and the owned server/browser tabs
are closed. No source package, production, provider or deployment changed.

This exposed a concrete card integration gap: the imported person has **zero
customer cards**. The LEARN customer list reads `customer_cards`; governed customer
imports create/link `people` or `companies`. The legacy identity resolver creates
cards from interactions, while customer-card sync refreshes existing cards. Import
success therefore does not yet make an import-only customer visible as a card.

Next work must connect those canonical identities to the card projection, preserve
existing card IDs/locked fields and avoid manufacturing interaction activity, health
or performance scores. The real package remains refused for its unresolved site
ownership contradiction. Large-file behavior remains untested in the hosted runtime.
See [signed-in evidence and retained finding](evidence/learn-import-hosted-browser-2026-10-10.json).

## Customer-card projection candidate — 10 October

Migration `20261031070000_learn_import_customer_cards.sql` connects new governed
customer links to the existing `customer_cards` store. It reuses a person's card
or the company's own card and never updates an existing card, including archived
cards and protected fields. New cards receive the canonical display name and an
import-link metadata reference; activity, summary, ownership, confidence and numeric
priority score remain unset. A named person's card may still refer to their company;
it is distinct from a company-only card. Existing default grey/medium card fields
remain defaults, not derived health or performance assessments.

Three private invoker functions provide identity projection, the after-link trigger
and explicit repair in pages of at most 200 existing customer links. Installation
does not run repair or change source rows. Shared registry/roster locks use the
existing authority lock order. Two partial unique indexes prevent concurrent writers
from splitting a canonical customer's card history. Existing duplicate identities
refuse installation; nothing is merged or deleted. These indexes also apply to
legacy writers and can refuse a person-deletion SET NULL transition that would
collide with an existing company-only card. Identity reconciliation must handle that
explicitly; legacy interaction-worker race behavior still requires acceptance.

Verified TEST preflight found four cards, four imported customer links and no
duplicate person/company-only groups. Individual service table privileges were
captured because the old local projection's all-DML boolean did not reproduce
read-only service access to tenants/profiles. `--cards` now restores those verified
privileges and all twelve relevant table definitions, guards and policies. The Auth
stand-in creates only missing profiles, allowing the historical suite to run again
after the new trigger is installed.

The disposable local PostgreSQL run passed rollback, duplicate-history refusal,
protected-card/source preservation, actual service-role insertion, company-scoped
authenticated reads, private-function denial, suspended-company refusal, bounded
repair, historical row regressions and concurrent service projection to one card.
The owned container was removed. No hosted migration or repair ran; signed-in card
visibility and larger-file performance remain open. Next is the pinned TEST release,
hosted rollback rehearsal, explicit synthetic repair and actual card read acceptance.
See [local evidence](evidence/learn-import-card-projection-local-2026-10-10.json).

## Customer-card projection installed and read in TEST — 10 October

Release `024_import_customer_cards.sql` is installed in TEST: 95 tables and 25
receipts, with the existing import endpoint unchanged. The exact wrapper passed a
fresh hosted rollback at 06:36 UTC and installation at 06:37 UTC. All 18 monitored
source/card table row fingerprints stayed identical across each operation; the
migration itself performed no backfill. Local replay also forced a receipt failure
and verified that all indexes, functions, trigger definitions and retained rows
rolled back. The three private functions, trigger and two unique indexes are pinned
by actual PostgreSQL metadata. The final reader additionally verifies the trigger
is enabled and both indexes are valid, ready, live and unique, preserving the exact
checks for all earlier releases and endpoints.

Explicit bounded service-role repair created one missing customer card for the
retired synthetic browser import from the earlier test. Its one person, source
link, outcome and provenance remain retained; all pre-existing source rows and
cards were unchanged. No retired login was reactivated. The repair tool saves its
baseline before attempting the write, refuses a repeated audit path and reports
uncertain outcomes for inspection rather than retrying.

A fresh actual-Auth/Edge acceptance run then imported two customers, two sites and
three jobs through nine retained imports/outcomes. The same `readLearnCards`
function used by LEARN read both customer cards through owner and viewer sessions;
another company's session saw none. Card titles came from canonical people and
metadata retained the import identity. No activity, summary, ownership, confidence
or numeric priority score was invented. Existing-source and existing-card
fingerprints matched, all three temporary logins were banned/password-rotated and
roles demoted, and all fixture rows were retained.

The ordinary TEST UI/server/import tools now require release 024's exact catalog.
Visual browser rendering of these newly projected cards still needs a separate
check. Larger-file performance, governed conflict resolution, legacy interaction
writer race acceptance, and the real package ownership contradiction remain open.
No production/provider/frontend change ran. See
[release, preservation and authenticated evidence](evidence/learn-import-cards-test-release-2026-10-10.json).

## Browser customer-card acceptance — 10 October

The repaired import-only customer was visibly listed in the real TEST-backed app
and opened as a card. A fresh synthetic owner then selected the governed customer
profile and original CSV, inspected the sealed mapping, approved the saved preview
and applied it. Browser observation was interrupted immediately after submission;
no second apply was sent. Inspection confirmed one completed import, one person,
one source link, one outcome, one provenance row and one customer card. A fresh
page displayed that customer and opened its evidence detail successfully.

The performance panel explicitly reported that no scoring rules were configured
for this scope and kept published-assessment saving disabled. It did not manufacture
a score, finding, communication history or pay change. The earlier repaired card
was viewed through a demoted viewer session and correctly withheld owner/admin
communications. That observation also confirms existing JWTs can retain viewer read
access after Auth ban/password rotation until sign-out/expiry; retirement removes
write authority, not instant JWT validity. The prior viewer was explicitly signed
out before the fresh owner test.

The fresh fixture is retired: login banned, password rotated, profile demoted and
memberships ended. All rows remain retained; 17 pre-existing source-table fingerprints
matched. The local server was stopped, owned browser tabs closed and the temporary
plaintext password removed. Screenshot and database evidence are recorded in
[browser acceptance](evidence/learn-import-cards-browser-2026-10-10.json).

## Import volume failure and bounded batch candidate — 10 October

The installed endpoint previewed 1,200 synthetic customers in **50.482 seconds** and
applied them in **81.724 seconds**. It retained exactly 1,200 people, cards, links,
outcomes and provenance rows, with attempt 1 throughout. Completed replay returned
HTTP 200 and unchanged counts. The first harness then stopped on an incorrect
response assertion (`status` instead of `import.status`); it did not reach the
outcome-window/card-pagination checks. The assertion is now corrected.

A separate **5,000-row** trial failed during preview with **HTTP 546 after 132.325
seconds**, leaving no saved import or canonical rows. This disproves readiness at
the endpoint's advertised file limit. The exact server resource constraint has not
been established; source inspection confirms one database round trip per valid
preview row and per applied row. Both synthetic trial accounts are retired and all
18 pre-existing source/card-table fingerprints matched. Evidence is retained in
[volume observations](evidence/learn-import-volume-2026-10-10.json).

Local migration `20261031080000_learn_import_batches.sql` adds three private invoker
helpers for current authority, matching batches and applying batches of 1–100 rows.
They reuse existing customer/site/job logic, sealed options, active-company and
owner/admin checks, cross-company View As refusal, and registry/roster lock order.
Preview creates no canonical records. Apply isolates row errors in subtransactions;
successful rows commit together at the batch boundary. Contract/authority errors
roll back the entire batch. Returned row failures contain SQLSTATE only, for the
existing Edge classifier/outcome recorder; a lost response requires inspecting the
durable ledger before continuing. Invalid-field outcomes are recorded inside the
batch after checking current authority. Terminal row replay remains idempotent.

The isolated TEST-schema projection passed 100-row customer preview/apply, replay,
invalid-row recording, injected row failure without raw error disclosure, continued
later rows, late contract rollback, duplicate/oversized batches, sealed-option
mismatch, foreign/demoted/suspended/View As refusal, and site/job creation with exact
site-owner contradiction refusal. Existing rows survived installation and rollback.
The batch helpers are **local only**: Edge integration, pinned TEST release,
endpoint deployment and repeated maximum-volume acceptance remain required.

## Bounded importer installed; 5,000-row acceptance passed — 10 October

TEST release 025 installs the three batch helpers without source-row changes. The
exact release passed local transaction/receipt-failure rollback, then hosted rollback
at 07:11 UTC and installation at 07:11 UTC. The 18 monitored source/card table
fingerprints stayed unchanged across both hosted operations. TEST now has 95 tables
and 26 release receipts.

The governed-only `learn-data-import` endpoint is version 2. Its pinned eleven-file
bundle uses 100-row database batches for valid preview rows and governed apply.
Every complete batch reply is checked for row identity, cardinality, duplicates,
action vocabulary and SQLSTATE shape before consumption. Missing/malformed or
uncertain replies halt without retry/finalisation; reload uses the durable ledger.
The existing per-row error classifier records returned SQLSTATE failures, never
raw database error messages. The legacy `data-import` entrypoint retains its
single-row behavior and was not deployed. All other hosted endpoints are unchanged.

Strict Edge typechecking, 18 handler/request/contract tests, two SQL release tests,
four deployment checks and two endpoint-catalog checks passed. The initial wider
command also selected `scripts/data-import.test.mjs`, a separate live legacy test
that exited with `MISSING env`; it was not supplied an environment or counted as
passed. The actual signed-in TEST suite then passed company/role/View As guards,
customer→site→job dependency recovery, exact-site contradiction retention, replay,
original-file checksum checks and imported-card visibility. Its fixtures are retired.

The previously failing **5,000-customer** trial now passes through the deployed
endpoint: **4.469 seconds preview, 18.090 seconds apply, 0.614 seconds completed
replay**. Exactly 5,000 people, customer cards, import links, row outcomes and
provenance rows remain, with no unexpected outcome/attempt. The first two card pages
return 24 distinct records each; page 209 returns the final eight and no next page.
The outcome endpoint correctly reports its current 1,000-row window as truncated,
with 5,000 outcomes stored. Full outcome pagination is still required.

Both new acceptance runs preserved all pre-existing source/card fingerprints, banned
and password-rotated temporary logins, removed their approving role and retained
fixtures/evidence. The real Commusoft package was not imported and its ownership
contradiction remains unresolved. This benchmark covers valid synthetic customers;
large site/job files, large mixed-failure files, interrupted hosted batch recovery,
full row-ledger navigation and production/frontend acceptance remain open. See
[installed batch release and volume evidence](evidence/learn-import-batches-test-release-2026-10-10.json).
