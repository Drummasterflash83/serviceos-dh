# Governed work actions: prepared and rehearsed, not installed

On 9 October 2026, release 008 passed isolated PostgreSQL tests and a hosted TEST
rollback rehearsal at **21:14:53–21:14:55 UTC**. It has **not** been installed, and
`work-transition` has not been deployed to TEST. Release 007 remains the latest
installed work capability. No production, provider, communications, recordings,
staff grants or real work records were changed.

## Scope and provenance

The generated `008_governed_work_actions.sql` bundle has SHA-256
`0ec08e5aa0f17132c03a95bcbbcb3225cc7b03dd181362a8dd7b1c2688aed68e`.
Its manifest records original and selected source hashes. It recovers only:

- The six-entry object-class registry and nullable `object_class` fields on the
  existing work/type tables, their foreign keys and index.
- ServiceOS and ProductOS Action types, 16 lifecycle states, 30 unguarded edges,
  and the `tenant.superadmin` permission vocabulary entry. No person receives it.
- Three service-side functions for cover days, scoped authority and atomic work
  transitions. Browser/anonymous execution stays denied. Temporary schema search
  paths come last, and the internal cover helper is not service-callable.

The original Action migrations also contain automation, policy, SLA and tenant
activation seeds. Those sections are deliberately excluded. Existing work rows
are not reclassified or baselined. Selecting the reference Action type for a
future transition uses its registered class; old rows retain their original data.

The recorded TEST read found empty type/state/transition registries and the 16
previous permission entries. Both SQL and tool preflight require that exact
baseline; changed configuration causes refusal, not replacement. The release
locks the vocabulary tables, records one atomic receipt, and requires the fixed
TEST target and reviewed checksum. The rehearsal ends with rollback and verifies
unchanged schema, function, privilege, receipt and vocabulary fingerprints.

## Integrity changes

The endpoint now reads configured transition guards. The pure decision function
and database writer both refuse guarded state moves until their conditions have
an implemented evaluator. Accepting a proposed item requires a supported move to
ready; it cannot silently bypass a guarded move by keeping the old status.

Waiting/blocking require a supporting note. Completion with a done-when definition
requires nonblank evidence. Dismissal and ownership/objective corrections require
nonblank reasons. The database repeats these checks, ties the target status and
permitted patch fields to the verb, preserves unrelated attributes, and restricts
objective links to the explicit correction action. Approval exceptions still
require freshly resolved approval authority.

A valid transaction updates the work item, captures the canonical before/after
state, and adds a separate actor/authority annotation. Collection reads only the
canonical capture stream, avoiding double counting. Failed attribution rolls back
the work update and its already-fired capture as well.

## Verification

Seventeen focused Node tests passed, including execution of the actual Edge handler
with mocked I/O. The disposable, network-isolated PostgreSQL 17 verifier rebuilt
only the recorded TEST schema and synthetic rows; it did not inspect an existing
local database. It verified:

- Non-superuser installation, receipt-failure rollback, exact rehearsal rollback,
  reviewed expected definitions and all unaffected prior tables/helpers.
- Retention of pre-existing synthetic email, work and history, with no baseline.
- Tenant/role boundaries, team assignment targets, revoke-before-save, temporary
  cover without ownership transfer, View-As refusal and stale revisions.
- Guarded state edges, mismatched verbs/patches, absent or blank evidence, preserved
  attributes, and paired capture/attribution on successful actions.
- Injected attribution failure leaves object and history unchanged. Two simultaneous
  actions against one revision produce one successful update, one new canonical
  capture and one annotation; the competitor receives a revision conflict.
- The real history reader returns five canonical events for four actions plus
  creation, despite the four additional attributed history rows.

Main and preview TypeScript checks, the 24 existing work-projection assertions,
and the application production build with its 47 prerequisite tests passed.
Existing build warnings remain. This is not Deno/HTTP or browser action acceptance.

```sh
node --test scripts/learn-work-transition.test.mjs scripts/verify/learn-test-actions-rehearsal.test.mjs
python3 scripts/verify/learn-foundation-release.py --rules --conflicts --measurements --work --actions
LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy \
  node scripts/verify/learn-test-actions-rehearsal.mjs --rehearse --existing-cli-login
```

The last command writes temporary transactional schema to TEST and rolls it back;
it does not install the release. The committed expected catalog is a projection,
not proof of an installed hosted schema.

- [Observed registry baseline](evidence/learn-test-action-registries-before-2026-10-09.json)
- [Hosted rollback rehearsal](evidence/learn-test-actions-rehearsal-2026-10-09.json)

## Remaining acceptance

Before an end-user action endpoint is released, finish adoption/serialization of
roster and authority mutations. The authority reader and writer share a tenant
advisory lock, but direct service updates to memberships, cover and other authority
inputs do not automatically acquire it. Existing profile/grant row locks and the
revoke-before-save tests do not prove every concurrent revocation path. Do not
claim that race is covered by the separate work-revision race test.

Build the exact installation/postflight gate, rehearse again if the bundle changes,
and run real signed-in TEST action acceptance with retained synthetic evidence and
revoked synthetic access. Then verify the endpoint, scoped collection and Command
Centre UI together. Raw same-company operational history visibility, full staff/team
collection permissions and frontend TEST hosting remain separate gaps. This phase
does not make real employee performance or pay decisions live.
