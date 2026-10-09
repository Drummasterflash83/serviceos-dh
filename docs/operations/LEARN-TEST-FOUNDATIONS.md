# TEST card and work foundations

Status, 9 October 2026: the additive foundation is installed in TEST. There are
59 public base tables, including the 33 new foundation tables, and four migration
receipts. The earlier launch metadata views are retained. Production and customer
communications were not changed.

## What this restores

The generated release restores 33 tables from nine retained migration sources:
customer/company/person cards and matching suggestions; relationship graph;
organisation and operating profiles; work objects and state definitions/history;
ownership, policies, decisions and corrections; staff, responsibilities and
authority; canonical sites/jobs and import provenance; and the domain entity
registry. The manifest records each complete original file checksum and the
checksum of the selected SQL. Original migrations remain intact.

These are dependencies of the recovered application, not the complete scorecard
release. The 0–100 or other customer-selected scales, weighted criteria,
evidence review, prospective publication, ownership-time and handoff collectors
already implemented locally still need their later schema/RPC releases and real
user acceptance. No employee score, historical work baseline or reward decision
is created by this foundation.

## Intentional adaptations

- The original tenant bootstrap is not replayed: TEST already has tenants,
  profiles, configuration versions, interactions and authentication helpers.
- Import storage bucket creation and the domain registry data update are deferred
  to governed import acceptance. The domain/event migration contributes only its
  entity registry table. No provider action, staff seed or import job runs.
- New tables explicitly grant authenticated reads and service-role writes.
  Restrictive tenant policies prevent legacy `is_openfolk()` clauses from exposing
  other companies' rows. Public registry vocabulary and shared defaults stay readable.
- A trigger validates the tenant of declared foreign-key parents even on service
  writes. A shared configuration version or import profile is valid; another
  company's private parent is not. Tenant and ID fields, and organisation membership
  keys, cannot be changed in place. Existing source tables/helpers are unmodified.
- The only seed is the existing 16-entry authority permission vocabulary. It grants
  no person any authority.

The reference guard covers declared single-column foreign keys whose parent has
`tenant_id`. Soft references, polymorphic party references, JSON and UUID arrays
still require the later scoped writers. The foundation alone does not enforce
append-only history or immutable published configuration; those later guards must
be installed before their endpoints are released. Native source deletion rules
are retained; no tenant or communication deletion is performed here.

## Verification and evidence

`python3 scripts/verify/learn-foundation-release.py` uses a cached Postgres 17.6
image in a disposable container with no network, host mounts or published ports.
It does not read the existing local database. The projection restores recorded
TEST columns, defaults, constraints, indexes, policies, timestamp triggers and
four helpers, with their observed denied authenticated/anonymous execution. The release executes as a non-superuser `postgres` role. Auth is
an ID-only stand-in; ingestion protocol triggers and launch views are outside
this projection. Hosted TEST is PostgreSQL 17.11.

The checks passed for same-company reads across owner, viewer and OpenFolk
profiles; hidden foreign companies; service-role reference rejection across
people/cards/jobs/graph/teams/ownership/configuration/imports; valid shared
configuration/import profiles; denied direct authenticated writes and raw email
reads; immutable identity; native `ON DELETE SET NULL`; and all 33 new tables'
explicit privileges and RLS. A retained synthetic email, including its private
raw metadata, stayed unchanged. Injecting receipt failure rolled back every new
table and guard. Unscoped and duplicate release attempts were rejected.

The exact bounded rehearsal SQL was also exercised locally. Hosted rehearsal
at **20:03:06–20:03:07 UTC** returned its rollback marker, with all 33 tables,
the reference guard and the receipt absent afterward. Before/after fingerprints
matched for existing definitions, helpers, launch metadata privileges and ledgers.
No source record contents were read by this hosted rehearsal.

- Release: `supabase/release/learn-test/002_card_work_foundations.sql`
- Source manifest: `002_card_work_foundations.manifest.json` in the same directory
- SHA-256: `be6f2e94a8691469b82b45dce0c3c2011a68731fc8ae339e4a1ff11dfc3d5233`
- Schema observation: [recorded metadata](evidence/learn-test-foundation-schema-2026-10-09.json)
- Hosted result: [rollback evidence](evidence/learn-test-foundation-rehearsal-2026-10-09.json)
- Rehearsal runner: `scripts/verify/learn-test-foundation-rehearsal.mjs`

The runner pins the reviewed checksum, verifies TEST identity/organisation/health
and both prerequisite receipts, refuses an existing foundation, limits lock and
statement duration, sends exactly one rollback-only request and checks post-state.
The migration ledger is locked before checking receipts or existing objects so
concurrent attempts cannot both pass the preflight. It neither retries an uncertain write nor prints credential or database-error
bodies. Four focused tests exercise target/dependency refusal, rollback framing,
source/view drift, unknown outcomes and unavailable post-state.

## Installation and signed-in acceptance

Release `002` installed at **20:06:26 UTC**, following a fresh rollback rehearsal.
The installed tables and reference guard matched the schema produced in the
isolated verifier. Existing table definitions, helper bodies, launch privileges
and prior receipts were preserved. The installer refuses stale/mismatched
rehearsals and never retries an uncertain write.

The first real JWT test exposed a missing prerequisite: TEST had deliberately
revoked execution of its existing tenant helpers from authenticated users. The
original isolated projection recreated their bodies but incorrectly retained
Postgres's default PUBLIC execute permission. The projection now recreates the
observed denial, and applies the explicit follow-up permission release before
claiming successful authenticated reads. This is why SQL projection success alone
was not sufficient for release acceptance.

Release `003_foundation_helper_access.sql` installed at **20:10:57 UTC** after its
own rollback rehearsal. It grants authenticated execution of only
`current_tenant_id()` and `is_openfolk()`. Their reviewed bodies return the current
user's company ID and OpenFolk-role flag respectively. The release checks exact
function bodies and ownership; their definitions, all source-table privileges,
anonymous denial and unrelated function permissions remain unchanged. Restrictive
foundation policies still prohibit cross-company OpenFolk reads.

The acceptance runner reuses existing TEST keys in memory and five synthetic
Auth logins across two marked companies. It creates linked fixtures through
service-role PostgREST in 12 foundation tables, exercises reads with owner,
admin, viewer, ops and OpenFolk roles, tries foreign-company references and an
identity move through the service API, and checks ordinary-client write denial.
It also reruns the existing launch redaction, source-denial and role-revocation
checks. Each run deletes only its generated identities and marked fixtures,
then verifies absence. No customer message or stored audio is fetched.

The final run passed at **20:12:34 UTC**, including all nine grouped checks and
verified cleanup. Thirty-seven focused verification tests and the updated isolated
SQL checks pass. This proves the synthetic API slice, not real data completeness
or frontend behavior.

The first two runs verified cleanup after failure: first the missing helper
privileges, then a test-runner bug parsing an empty HTTP 204 response. The runner
now accepts successful responses with no body and has a regression test.

- [Installation rehearsal](evidence/learn-test-foundation-install-rehearsal-2026-10-09.json)
- [Foundation installation](evidence/learn-test-foundation-release-2026-10-09.json)
- [Helper rehearsal](evidence/learn-test-foundation-helper-rehearsal-2026-10-09.json)
- [Helper installation](evidence/learn-test-foundation-helper-release-2026-10-09.json)
- [Signed-in acceptance](evidence/learn-test-foundation-acceptance-2026-10-09.json)
- [Installed schema observation](evidence/learn-test-foundation-installed-schema-2026-10-09.json)

## Remaining work

Configuration hardening, objectives, control-plane authority, action-loop
registries, work/member capture, scorecard RPCs and source adapters remain staged
dependencies. Raw interaction access remains restricted. Slack and voicemail
completion, provider reconciliation, audio recovery/playability and full frontend
acceptance are not established by these checks. The overall LEARN V1 goal remains
active and incomplete.
