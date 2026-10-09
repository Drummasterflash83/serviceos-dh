# LEARN performance measurements

## Current implementation

Performance observations extend the existing `metric_definitions` and
`measurements` tables. The migration does not create observations, score people,
change pay, or alter historical email/phone records. It is local and not deployed.

`learn_performance_append(tenant, measurement, reason)` is a service-role-only,
transactional entry point for trusted source adapters. The measurement uses the
`PerformanceMeasurement` contract in `src/lib/learn-scorecards.ts`. Its ID is the
retry identity: an identical retry returns the same ID; changed content or reason
under that ID is rejected. Adapter submissions must have `review: "inferred"`.
There is no confirmation or policy-publication endpoint in this increment.

Each observation stores an exact tenant, subject, period, policy ID and revision,
metric, unit, value, samples, covered/eligible counts, source watermark, evidence,
exclusions and change reason. Missing values and unknown coverage remain missing.
The raw request is retained for replay comparison. The server resolves the policy
through its configuration version and checks the canonical subject and each
allowed evidence reference against the tenant. Evidence currently supports
interactions, email messages, phone calls/recordings, jobs and team members.
Existence and tenant ownership do not establish that a source proves the proposed
performance value; adapter calculations and human review remain necessary.

Team-specific observations require a matching team subject, or a confirmed member
record whose effective dates cover the whole period. The server records the group
identity rather than trusting caller-supplied group IDs. This checks the current
canonical membership record; it does not supply the missing immutable history of
past membership changes. Observations with an uncertain group period are rejected.

Corrections append a new row and name their predecessor. The predecessor must
have the same metric/policy revision, subject and period, and an earlier observation
time. It is locked during the correction; a unique index prevents two corrections
from replacing the same row. Independent observations can coexist and are treated
as conflicting candidates by the scorer, not resolved using “newest wins.”
Existing append-only measurement triggers preserve originals and corrections.

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

## Reading and scoring

`loadPerformanceMeasurements` uses the signed-in user's client and reads one exact
subject, period and policy revision. An exact database count must equal the full
returned history and be at most 500 rows. Unknown counts, row-cap truncation,
duplicates, foreign scope and malformed evidence reject the entire read. It maps
stored review state without upgrading it. The existing scorer handles incomplete
correction chains and withholds scores for unconfirmed, disputed, stale or
insufficient evidence. Draft policies can only produce draft simulations.

The reader is not yet attached to the card UI. No communications/job adapter calls
the append RPC yet. The remaining end-to-end work includes verified source event
and assignment histories, calculation adapters, review/corrections UI, versioned
policy publication, agreed calendars and exclusions, and saved assessment runs.
No real person's score or reward is established by these tests.

## Deployment and verification

1. Verify the target project and deployed migration history. Review dependencies
   on objectives/hardening, operating profiles, team members and scorecard drafts.
2. Apply only the reviewed additive migration
   `20261029150000_learn_performance_measurements.sql` on the verified test target.
   Existing rows receive tenant scope; no source records are rewritten. Assess
   table/index locking against the target's size before a production migration.
3. Deploy the objective worker and scheduled repair scanner after the migration.
   Their new queries require the scope columns. Do not deploy them first, and do
   not drop scope protections while any scoped measurements remain.
4. Verify actual owner/admin and viewer RLS with normal user sessions, then wire
   source adapters and reviews. No backfill or performance write has been enabled.

```sh
python3 scripts/verify/learn-performance-sql.py
node --test src/lib/learn-performance-measurements.test.ts src/lib/learn-scorecards.test.ts
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
