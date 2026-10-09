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
numerical correction workflow, saved assessment runs under published rules, agreed calendars and
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
