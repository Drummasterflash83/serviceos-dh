# TEST card and work foundations

Status, 9 October 2026: the additive foundation is prepared and has passed an
isolated database exercise and a rollback-only rehearsal on the existing TEST
project. **It has not been installed persistently.** TEST still has 26 public
base tables and the previously installed restricted launch metadata views.
Production and customer communications were not changed.

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
four helpers. The release executes as a non-superuser `postgres` role. Auth is
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

## Next release work

Prepare persistent installation with the matching fresh rehearsal, atomic receipt
and source-preservation checks. Then exercise real TEST Auth/PostgREST sessions
with marked synthetic tenants and verified cleanup, before connecting UI and the
remaining scoped writers. The existing launch acceptance should still pass.

Configuration hardening, objectives, control-plane authority, action-loop
registries, work/member capture, scorecard RPCs and source adapters remain staged
dependencies. Raw interaction access remains restricted. Slack and voicemail
completion, provider reconciliation, audio recovery/playability and full frontend
acceptance are not established by these checks. The overall LEARN V1 goal remains
active and incomplete.
