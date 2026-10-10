# LEARN performance measurements

## Current implementation

Performance observations extend the existing `metric_definitions` and
`measurements` tables. The migration does not create observations, score people,
change pay, or alter historical email/phone records. TEST release 006 installed the
measurement/review prerequisites at 20:49 UTC on 9 October 2026; signed-in acceptance
passed at 20:50 UTC. Production remains unchanged. See
[TEST release and retained evidence](LEARN-TEST-MEASUREMENTS.md).

`learn_performance_append(tenant, measurement, reason)` is a service-role-only,
transactional entry point for trusted source adapters. The measurement uses the
`PerformanceMeasurement` contract in `src/lib/learn-scorecards.ts`. Its ID is the
retry identity: an identical retry returns the same ID; changed content or reason
under that ID is rejected. Adapter submissions must have `review: "inferred"`.
Human confirmation uses the separate review RPC described below. Prospective policy
publication and retained revisions are installed in TEST; see
[publication scope and release limits](LEARN-SCORECARD-PUBLICATION.md).

Each observation stores an exact tenant, subject, period, policy ID and revision,
metric, unit, value, samples, covered/eligible counts, source watermark, evidence,
exclusions and change reason. Missing values and unknown coverage remain missing.
The raw request is retained for replay comparison. The server resolves the policy
through its configuration version and checks the canonical subject and each
allowed evidence reference against the tenant. Evidence currently supports
interactions, email messages, phone calls/recordings, jobs and team members in TEST.
The later local work-adapter definition additionally supports immutable calculation
receipts; that writer must retain the new conflict/group-history follow-ups when released.
Existence and tenant ownership do not establish that a source proves the proposed
performance value; adapter calculations and human review remain necessary.

Team-specific observations require a matching team subject, or retained observed
membership that covers the entire period. The server derives the group identity.
The new internal `learn_member_group_covers` helper reconciles retained events with
the current row and checks every segment; effective dates alone do not establish
historical coverage. Periods before capture or across a team transfer are rejected.
A later transfer does not prevent correcting an earlier fully observed team period.

Corrections append a new row and name their predecessor. The predecessor must
have the same metric/policy revision, subject and period, and an earlier observation
time. It is locked during the correction; a unique index prevents two corrections
from replacing the same row. Independent observations can coexist and are treated
as conflicting candidates by the scorer, not resolved using “newest wins.”
Existing append-only measurement triggers preserve originals and corrections. The
follow-up also rejects whole-table truncation of measurements, reviews and objective
health, and denies direct service insertion of staff facts outside the validated RPC.

## Isolation from company objectives

Metric definitions have an immutable scope: existing metrics default to `tenant`;
performance metrics are registered separately for each policy revision and key.
Database guards prevent either scope from receiving the other's measurements,
and prevent performance metrics from becoming objective targets or constraints.
This protects the old objective worker as well as the updated worker: it cannot
reference these new metric IDs through an objective.

The updated worker and repair scanner additionally filter `subject_kind=tenant`.
The pure objective normalizer excludes explicit personal/team/job/customer or
malformed subject scopes. Its evaluator identity is now `obj-health@2`, so changed
normalization produces new health snapshots rather than silently reusing an old
logical evaluation. Legacy in-memory fixtures with no scope fields retain their
old tenant interpretation; production queries select the scope fields explicitly.

Existing tenant-objective reads retain their previous permissions. A restrictive
RLS policy limits new performance observations to the same tenant's owner/admin.
Team-lead and self-service access need an explicit permission design before being
enabled; existing broad provider-read policies do not bypass this restriction.

## Human review

`learn_performance_review` is an owner/admin authenticated RPC. It appends a
confirmation or dispute to `learn_performance_reviews` with actor, reason and a
monotonic revision; no source measurement column is updated. Review decisions
therefore cannot refresh `measured_at` or `source_through`, change coverage, or
replace the measured value. The client derives review state from the complete
ledger, never from a caller-supplied confirmation field on the source observation.

The RPC rejects missing roles, active view-as sessions, foreign/missing measurements,
stale expected review revisions and source observations that already have a
correction. It locks the same measurement row used by the source correction path.
A request UUID is retained across uncertain retries, and a reused receipt does not
claim that its decision is still the latest. The UI reloads the assessment after
a successful response. Service-role adapters have no execute grant on this review
RPC or direct insert grant on the ledger. Owners/admins see the review history;
ordinary viewers cannot read or write it.

Reviews do not resolve independent conflicting measurements or publish a scoring
policy. Those still withhold a score. Numerical corrections continue through the
source-observation append path and must be reviewed independently.

## Reading and scoring

`loadPerformanceMeasurements` uses the signed-in user's client and reads one exact
subject, period and policy revision. An exact database count must equal the full
returned history and be at most 500 rows. Unknown counts, row-cap truncation,
duplicates, foreign scope and malformed evidence reject the entire read. It then loads complete review histories in bounded batches (at most 1,000 total
review records), checks contiguous revisions and applies the latest decision to
each source observation. Missing or unverified ledger history cannot confirm it. The existing scorer handles incomplete
correction chains and withholds scores for unconfirmed, disputed, stale or
insufficient evidence. Draft policies can only produce draft simulations.

Cards now contain an expandable performance panel for owners/admins. It reads an
exact completed UTC date window and the saved rules for the selected card/group,
shows coverage, exclusions and correction/review history, and offers confirm or
dispute controls with a required reason. Confirmation also asks the reviewer to
attest that they checked the sources, calculation and exclusions. Linked sources
can be opened as tenant-authorised current excerpts or metadata. These are not
immutable source captures, and recording metadata is not audio playback.

The recorded-work-handoff adapter now calls the append RPC transactionally and is connected to the card collection flow. Communications/job outcome adapters remain incomplete. The remaining end-to-end
work includes verified source event and assignment histories, calculation adapters,
hosted numerical correction acceptance, saved assessment runs under published rules, agreed calendars and
exclusions and team aggregation.
No real person's score or reward is established by these tests.

The local work-transition path now captures immutable before/after ownership,
state and version snapshots atomically in the existing work history. This supplies
future work-interval evidence but does not backfill missing history or publish
measurements. See [scope, provenance and release dependencies](LEARN-WORK-HISTORY.md).

## Deployment and verification

1. Verify the target project and deployed migration history. Review dependencies
   on objectives/hardening, operating profiles, team members and scorecard drafts.
2. Apply only the reviewed additive migration
   `20261029150000_learn_performance_measurements.sql` on the verified test target.
   Existing rows receive tenant scope; no source records are rewritten. Assess
   table/index locking against the target's size before a production migration.
3. Apply `20261029160000_learn_performance_reviews.sql` before deploying the new
   card panel/reader; review history is required and missing tables fail closed.
4. Deploy the objective worker and scheduled repair scanner after the migration.
   Their new queries require the scope columns. Do not deploy them first, and do
   not drop scope protections while any scoped measurements remain.
5. Verify actual owner/admin and viewer RLS with normal user sessions, then verify
   source adapters and review flows end to end. No backfill or performance write has been enabled.

```sh
python3 scripts/verify/learn-performance-sql.py
node --test src/lib/learn-performance-measurements.test.ts src/lib/learn-performance-reviews.test.ts src/lib/learn-scorecards.test.ts
node supabase/functions/_shared/intelligence/objective_evaluation.verify.ts
npx tsc --noEmit
```

SQL checks run in a disposable, network-isolated PostgreSQL 15 container using the
real objectives and append-only hardening migrations. Other referenced tables are
minimal synthetic fixtures. Tests cover atomic replay, failed-write rollback,
correction history, tenant/evidence boundaries, membership-period rejection,
legacy compatibility, objective isolation, RLS and grants. They do not establish
full deployed-schema compatibility, live source correctness, or concurrent load
acceptance. The Node reader/scorer tests cover inferred observations, complete
history, scope rejection and correction simulation; the objective suite includes
personal observations that must leave company health unknown.

The review increment passed 21 focused reader/review/scorer tests and the SQL
suite, including immutable source timestamps through confirmation/dispute,
review retry/CAS, authority and ledger grants. Application and preview TypeScript
checks and both preview and production builds passed (47 existing prebuild checks).
Browser review used only synthetic records:
inferred evidence withheld the score, confirmation produced an 80/100 draft
simulation, and a later dispute withheld it again while retaining both reviews.
No actual employee measurement, review or pay decision occurred. The earlier local
checks above predate the later TEST release and real signed-in acceptance documented
in [LEARN-TEST-MEASUREMENTS.md](LEARN-TEST-MEASUREMENTS.md).

Forward member identity/team capture is installed in TEST and now supplies the
measurement append path's group-period proof. The work-interval attribution module
remains local. Neither reconstructs missing old membership. See [membership history](LEARN-MEMBERSHIP-HISTORY.md) for
the observed-time semantics, verification and remaining source-adapter dependencies.

See [the connected recorded-handoff adapter](LEARN-WORK-HANDOFF-MEASUREMENTS.md) for its exact population, limits and verification.

## Numerical corrections — local implementation, 10 October

The card now supports owner/admin corrections of the current numerical observation,
including explicit withholding (`NULL`). A required reason and actor are retained
in the immutable `learn_performance_corrections` ledger. The original measurement
and its review history remain intact. Correction changes neither the evidence,
counts, exclusions, unit, source coverage watermark nor assessment scope. It creates
a new inferred measurement; confirmation is a separate review action. That review
may currently be made by the same authorised manager; this is not a two-person
approval system and does not change pay.

`learn_performance_correct` binds the actual profile to the company, rejects active
View-As and checks the expected review revision while locking the predecessor.
Only one successor can be recorded. Request identity is immutable and exact retries
return the existing receipt. Ledger insertion and measurement append are atomic.
The ledger denies direct writes, updates, deletion and truncation. No email, call,
recording, interaction or work-source rows are changed by this migration or RPC.

Manual corrections retain the original source observation timestamp through the
entire manual correction chain. The new measurement time records the correction;
it cannot refresh stale evidence. The client reads only the manual-correction marker
from the original request JSON, requires complete ledger history, validates retained
scope and source facts against each predecessor, then applies the separate review
ledger. The scorer uses the original source time for freshness. Missing, malformed
or inconsistent correction history withholds the assessment.

The form freezes a submitted request for same-page retry after an uncertain reply.
Pending correction requests are not durably saved in browser storage. After a full
reload, reread the server history; the database's single-successor rule prevents a
second correction of an already-replaced observation. Cross-device receipt recovery
is not provided by this form.

Verification on 10 October:

- Isolated PostgreSQL 15 using the deployed append/review function bodies and minimal
  synthetic dependencies passed authority, View-As, revision, retry, preservation,
  immutable-ledger, failed-write rollback and two-session competing-correction checks.
- 38 focused client, review, scorer, publication and collector tests passed; both
  application and preview TypeScript checks, application build and synthetic preview build passed.
- The actual card component in the local browser retained an original 80, appended
  an inferred 90, withheld scoring until separate confirmation, then showed a 90/100
  draft simulation. A second correction withheld the value while retaining both
  predecessors and the confirmed review. The original source time stayed unchanged.
- All browser records were synthetic and in memory. This does not establish hosted
  Auth/PostgREST acceptance, provider capture, real employee scoring or payroll.

SQL results: [local evidence](evidence/learn-performance-corrections-local-2026-10-10.json).
Run `python3 scripts/verify/learn-performance-corrections.py` for the isolated checks.
The additive source migration is `20261031020000_learn_performance_corrections.sql`.
It has **not** been applied to TEST or production. TEST remains release 017.
Before release, pin and rehearse the migration against the current TEST catalog,
verify actual signed-in correction/read/review flows and source preservation, then
release the application with the required database contract. Saved assessments,
real source adapters, historical team attribution and reward review remain separate
work. Historical group membership acceptance for numerical corrections is not yet
established by the minimal SQL fixture.

## Numerical corrections accepted in TEST — 10 October

Release **018**, `learn_performance_corrections_v1`, installs the ledger and RPC in
TEST `saatxzwxvdvqevbnskxy`. Its pinned SQL checksum is
`da742d0a4ea5b20aa98e03fcbee02b85e9f2a0d93f3aed7dcd64a9c7205fea8d`.
The earlier local-only deployment statement is superseded for TEST. Production and
the frontend remain unchanged.

The PostgreSQL 17 rehearsal used recorded reference-column types under the
non-superuser deployment owner. Explicit rollback and injected receipt failure
both removed all additions. The hosted rehearsal acknowledged rollback, matched
before/after catalog fingerprints and preserved source and measurement/review
counts and full-row fingerprints. Installation matched the pinned new definitions,
RLS, all seven table privilege classes and RPC execution grants while retaining the
preceding catalog and Edge endpoint metadata. TEST now has 90 tables and 19 receipts.

Actual signed-in Auth/PostgREST acceptance exercised the application correction
client and measurement reader. It verified owner/admin correction, exact retry,
changed request and stale revision rejection, immutable originals, separate review,
company/role isolation, direct-write denial, View-As denial and immediate role
revocation. Two concurrent requests produced one successor and one HTTP 409.
Explicit withholding retained the chain and withheld the draft score. A correction
after a later team transfer retained the earlier period's observed team attribution.
The earlier minimal-fixture limitation on historical group acceptance is therefore
resolved for this synthetic observed-history case; missing historical membership
has not been reconstructed or inferred.

The initial acceptance run stopped when its scorer caller omitted `groupIds`.
The correction and reader had succeeded, but the scorer correctly rejected the
incomplete subject. The harness now uses the subject returned by the validated
measurement reader. Its failed run and evidence were preserved; a fresh run passed.
The first run retained two measurements, one review and one correction; the passing
run retained four measurements, two reviews and three corrections. Both runs' eight
synthetic logins were banned, passwords replaced and roles revoked; members were
ended. No guard was disabled and no fixture evidence was deleted.

Seven release/context tests and fourteen acceptance/client tests passed. The latter
include a no-network wrong-project rejection and the correction reader's fail-closed
provenance checks. Current browser fixture/server helpers now require release 018.
The browser interaction proof remains the earlier local synthetic preview, not a
hosted frontend test. None of this establishes real employee scores, provider source
completeness, reward approval or payroll.

Evidence:

- [PostgreSQL 17 release checks](evidence/learn-performance-corrections-release-local-2026-10-10.json)
- [Hosted rollback](evidence/learn-test-corrections-rehearsal-2026-10-10.json)
- [Rehearsal source preservation](evidence/learn-corrections-rehearsal-preservation-2026-10-10.json)
- [Installed release](evidence/learn-test-corrections-installed-2026-10-10.json)
- [Initial harness stop](evidence/learn-test-corrections-acceptance-initial-2026-10-10.json)
- [Passing signed-in acceptance](evidence/learn-test-corrections-acceptance-2026-10-10.json)
- [Final catalog, access retirement and source preservation](evidence/learn-test-corrections-final-2026-10-10.json)

The release runner accepts only the named TEST project and pinned SQL, requires a
matching rollback rehearsal no older than one hour, and inspects uncertain outcomes
without replaying the write. The acceptance command deliberately creates retained
synthetic evidence and retires its users:

```sh
LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy node scripts/verify/learn-test-corrections-acceptance.mjs --accept --existing-cli-login
```

Real source adapters, saved assessments under published rules, team aggregation,
agreed calendars/exclusions and manager-reviewed reward decisions remain unfinished.


## Saved assessments — local implementation, 10 October

Cards can retain and reopen assessments under the published rules covering an exact
subject and period. Draft simulations remain unsaved. Saving an incomplete assessment
retains the missing/disputed evidence state rather than manufacturing a zero.

`20261031040000_learn_saved_assessments.sql` adds an immutable `learn_assessments`
ledger and `learn_assessment_save` RPC. The caller provides a request UUID, publication,
subject, period, expected measurement IDs/review revisions, and reason. It cannot
submit a score, measurement value, policy body or arbitrary snapshot. The RPC reads
the authoritative publication and captures measurement rows, reviews and corrections
in one MVCC statement. It rejects changed evidence, another company/subject,
unpublished or out-of-interval rules, unfinished periods and unproven group scope.
For existing group-scoped measurements, retained observed group attribution survives
later roster changes; empty group-scoped assessments require the existing historical
membership proof.

The saved record includes canonical policy/input snapshots, its server capture time,
author and reason. `learn-assessment/1` binds these to `learn-scorecards/1`.
`evaluateScorecardV1` derives the advisory result from retained inputs at the retained
time. The current engine aliases V1; future engines must preserve V1 for historical
records. No browser-calculated score is stored as authoritative data. Existing
measurement, review and correction validation is shared between live and retained
reads, including complete correction chains and original source freshness. Unknown
snapshot/engine versions and mismatched scope fail closed.

Owners/admins can read company history. Saving additionally excludes View-As. Neither
anon nor service-role callers can execute the human save RPC; ordinary clients and
service-role credentials receive no direct writes to the ledger. Update, delete and
truncate are rejected. Request identity is bound to actor, company and complete input;
a repeated identical request returns its earlier receipt even after later evidence
changes. Concurrent same-request saves create one record. New requests append new
assessments and never supersede or rewrite earlier records.

The card displays the latest 20 records with the total count, retained score/coverage
status, rules revision, dates, reason and measurement/review/correction details.
The save form freezes its request until a confirmed receipt or explicit conflict.
An unknown reply retries the same request while the card remains open. Pending saves
are not yet durable across a page reload or closing the card. Older-history pagination
and durable pending-save recovery remain follow-up work. Retained inputs include
source reference IDs; they do not duplicate original email bodies, recordings or
source excerpts. This is an advisory assessment record, not payroll approval.

Verification completed locally:

- Thirty-five assessment/measurement/review/correction/scoring tests passed.
- A disposable network-isolated PostgreSQL 15 instance, using actual deployed
  append/review/published-policy bodies with synthetic dependencies, verified exact
  retry, simultaneous retry, stale evidence/publication rejection, authority and
  company boundaries, immutable history and injected insert failure.
- Actual SQL snapshots passed the application parser/scorer: disputed → unassessed;
  later confirmed → 58.33/100; later unreviewed numerical correction → unassessed.
  Earlier snapshots retained their original values, review state and result.
- Application and preview TypeScript checks and both builds passed, including the
  47 existing prebuild tests.
- Browser checks used the actual card component with in-memory synthetic records:
  a simulated lost response recovered without duplication, an unassessed record
  survived later confirmation and a saved 80/100 result, and the earlier record
  reopened unchanged. The final form/table layout was inspected; no console errors
  were reported.

[Isolated database evidence](evidence/learn-saved-assessments-local-2026-10-10.json)
and [SQL-to-client evidence](evidence/learn-saved-assessments-sql-client-2026-10-10.json).
The local browser image is `.verification-results/learn-saved-assessments-preview.jpg`.

At the local implementation milestone, TEST remained release 019 with 90 tables
and 20 receipts. Hosted release/acceptance is recorded below. No frontend deployment,
provider traffic, real employee assessment or payment occurred in the local increment.


## Saved assessments accepted in TEST — 10 October

Release `020_saved_assessments.sql` installs the immutable assessment ledger and
save RPC in TEST: 91 public tables and 21 release receipts. The source SHA-256 is
`728d46dcf93127cfcb917b355d86a006e46d72bb5249b784a485ba079bcd798a`.

The release pins the complete preceding release 019 plus the new table, functions,
constraints, indexes, policies, triggers, table grants and per-column permissions.
A matching acknowledged rollback rehearsal is required within one hour before
installation. Unknown responses trigger inspection rather than a write replay.
Eleven release-runner tests passed, including earlier communication/correction/source
contracts, drift rejection, stale/foreign prerequisites and lost-response handling.
The exact release also passed isolated PostgreSQL 17 non-superuser installation,
explicit rollback and rollback following an injected receipt failure.

Hosted rollback and installation matched their pinned catalogs. Actual synthetic
Auth/PostgREST clients then exercised the application publication, measurement,
correction, assessment-save and assessment-history readers. The fixture published
rules prospectively through the actual API; no publication was backdated. Empty
measurements used the actual historical-team proof. The sequence retained:

- Empty evidence: unassessed, without inventing zero.
- An unreviewed 30-minute observation: unassessed.
- Confirmed observation: 25/50.
- Separately reviewed correction to 20 minutes after a later team transfer: 33.33/50,
  retaining the original observed group and source freshness.
- A simultaneous identical save: one new assessment and one reused receipt.

All earlier saved results remained identical. A later prospective 100-point rules
publication left the earlier 50-point assessment unchanged. Stale inputs, changed
request identity, wrong publication, future period, foreign company, viewer, service,
direct insert, immutable-history mutation, View-As and same-session revocation checks
passed. Direct ledger reads remained company-scoped. Four test users were banned,
passwords rotated and roles demoted; memberships and previews ended. Five assessments,
two measurements, two reviews, one correction and two publications remain as evidence.

Existing email, call, recording, transcript, Slack, interaction, measurement, review
and correction rows retained identical counts/fingerprints across the complete
rehearsal, installation and acceptance. The acceptance also compared pre-existing
assessment rows, excluding only its two new synthetic tenants. TEST UI verification
helpers now require the exact release 020; their syntax checks passed.

Evidence: [isolated release](evidence/learn-test-assessments-local-release-2026-10-10.json),
[hosted rollback](evidence/learn-test-assessments-rehearsal-2026-10-10.json),
[installation](evidence/learn-test-assessments-install-2026-10-10.json),
[signed-in acceptance](evidence/learn-test-assessments-acceptance-2026-10-10.json),
[final catalog, preservation and retirement](evidence/learn-test-assessments-final-2026-10-10.json).
Final readback at 02:53:06 UTC confirmed the exact installed catalog, five retained
assessments and zero active fixture users, memberships or previews.

This is acceptance of retained synthetic TEST assessments, not real employee scoring,
complete provider capture, payroll approval or production deployment. The frontend
has not been deployed. Durable pending assessment saves, history pagination beyond
the latest 20 records, real-source adapters and approved operational definitions
remain open alongside the wider LEARN launch requirements.
