# Governed work actions: installed and signed-in TEST acceptance

Release 008 was installed in TEST on 9 October 2026 at **21:23:19 UTC**, after a
fresh rollback rehearsal at **21:22:37–21:22:40 UTC**. `work-transition` version 1
was deployed at **21:24:28 UTC**, with gateway JWT verification enabled, and real
signed-in acceptance passed at **21:29:10 UTC**. The final catalog at
**21:29:46 UTC** matches the expected schema: 80 public tables and nine receipts.
No production, provider, real communications, recordings or staff permissions were
changed. The initial 21:14 rehearsal remains historical evidence of the earlier
prepared bundle; its checksum is not the installed release.

## Scope and provenance

The generated `008_governed_work_actions.sql` bundle has SHA-256
`4f27681d0f6786b04374cb409fdea61babff40452f263ce8e3c9d43966f215f8`.
Its manifest records original and selected source hashes. It recovers only:

- The six-entry object-class registry and nullable `object_class` fields on the
  existing work/type tables, their foreign keys and index.
- ServiceOS and ProductOS Action types, 16 lifecycle states, 30 unguarded edges,
  and the `tenant.superadmin` permission vocabulary entry. No person receives it.
- Three work functions for cover days, scoped authority and atomic transitions,
  plus two internal authority/registry mutation guards. Browser/anonymous execution stays denied. Temporary schema search
  paths come last, and the internal cover helper and trigger guards are not service-callable.

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

Twenty-six focused Node tests passed, including execution of the actual Edge handler
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
Existing build warnings remain. HTTP/Edge runtime acceptance is described below;
full browser acceptance is still outstanding.

```sh
node --test scripts/learn-work-transition.test.mjs scripts/verify/learn-test-actions-rehearsal.test.mjs
python3 scripts/verify/learn-foundation-release.py --rules --conflicts --measurements --work --actions
LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy \
  node scripts/verify/learn-test-actions-rehearsal.mjs --rehearse --existing-cli-login
```

The last command is the historical pre-installation rehearsal: it writes temporary
transactional schema and rolls it back, but now refuses the already-installed
release. The expected catalog remains a projection; the separately retained
installed catalog and signed-in evidence establish the hosted result.

- [Observed registry baseline](evidence/learn-test-action-registries-before-2026-10-09.json)
- [Hosted rollback rehearsal](evidence/learn-test-actions-rehearsal-2026-10-09.json)

## Authority changes and simultaneous actions

Seven authority input tables now have row guards taking the work action's tenant
lock: tenants, profiles, team members, organisation units, responsibilities, grants
and preview contexts. Both old and new company IDs participate in moves. Preview
contexts also lock the real actor's company, including legacy cross-company context
rows. An active preview requires an existing actor profile.

The trigger uses a nonblocking lock attempt and returns `PT409` when an action is
already using that authority. This avoids allowing a revocation halfway through a
save and avoids waiting while holding an inverted row/advisory lock order. Existing
row locks can instead make an update wait until the action commits. No existing
profile/company grants were widened: privileged control-plane changes remain
privileged. Callers must refresh/retry a conflict; there is no hidden write replay.

Five classification/lifecycle/permission registries use an exclusive statement
lock. Actions hold its shared counterpart, so independent companies can act at the
same time. Truncation joins that global lock too; existing retention guards and
privileges continue to apply. Ordinary authorized mutations are covered, not an
administrator deliberately disabling triggers. The work functions require READ
COMMITTED so their post-lock queries cannot reuse an older transaction snapshot.

Controlled PostgreSQL sessions verified actual lock wait relationships, rather than
relying on timing sleeps. Cover revocation first causes the waiting action to reread
and refuse authority; action first makes the revocation conflict, and a subsequent
retry revokes future actions. Role changes serialize behind the profile lock. Registry
changes in both orderings respect configured conditions. Membership updates, duplicate
active identity insertion, team and timezone changes, grant insertion, profile moves
and cross-company previews cannot slip past an in-flight action. A different company's
action succeeds while the first transaction remains open.

## Deployed endpoint and real JWT acceptance

Only the endpoint and four shared files were submitted through the saved Supabase
CLI login, with explicit TEST project and `verify_jwt=true` staging configuration.
No prune, secret change or other function deployment occurred. The deployed source
bundle SHA-256 is `7acddf3c2a97eab83b50ef89b176012c8afcce4668b275bf6b4f737d9abf3fb3`.
`learn-launch-status` remains version 1 with its prior configuration. The old handler
header's deployment example is not the TEST deployment configuration; this release
keeps gateway JWT verification as well as the handler's authenticated-user check.

The successful hosted run used six real synthetic Auth sessions. It verified:

- Anonymous/internal-service calls cannot act as a person. Other companies cannot
  act on the item. An owner role without item authority is insufficient, while a
  confirmed viewer-role staff member can act on their own work. Browser callers
  cannot invoke the service-only persistence RPC directly.
- Start, wait, resume and evidence-backed completion persist. Missing notes/evidence
  and stale versions are refused. Two simultaneous submissions produce one update
  and one conflict.
- Team-scoped assignment cannot target another team or company. A real handoff
  removes the old owner's authority and gives it to the new assignee. Cover can
  move work with final cover attribution but cannot claim permanent ownership.
  Ending cover, assignment authority, or the acting viewer's membership prevents
  the next request using the same JWT. Preview sessions remain read-only.
- The actual timeline reader returns five canonical events for four actions plus
  creation. The actual card reader sees **one handoff**, with coverage of all five
  synthetic items and a retained calculation receipt. Actor annotations do not
  double-count the handoff or timeline.

Two earlier runs stopped on overly narrow harness expectations: internal service
requests returned the existing explicit `401 internal_auth_mismatch` denial, and
preview writes returned `409 read_only_view_active`. Both responses denied the
operation correctly. The harness now checks those contracts; no authorization
rule was relaxed. All three runs retained their evidence and revoked access.
Together they retain six marked companies, 18 Auth/profile identities, 15 membership
rows, 15 work items, 33 canonical captures, 18 actor annotations and one measurement/
receipt pair. Passwords were replaced, logins banned, profile roles downgraded,
and synthetic membership/grants/cover ended. Old JWTs could no longer act or read
performance data. No retention guard was disabled.

- [Installation](evidence/learn-test-actions-installed-2026-10-09.json)
- [Endpoint deployment](evidence/learn-test-actions-deployed-2026-10-09.json)
- [Signed-in acceptance](evidence/learn-test-actions-acceptance-2026-10-09.json)
- [Installed catalog](evidence/learn-test-actions-installed-schema-2026-10-09.json)
- [Initial harness run](evidence/learn-test-actions-initial-acceptance-2026-10-09.json)
- [Second harness run](evidence/learn-test-actions-second-acceptance-2026-10-09.json)

## Remaining acceptance

Verify scoped collection and the Command Centre UI together in a hosted TEST frontend.
Raw same-company operational history visibility, staff/team collection permissions,
source reconciliation and communications/job/telematics adapters, calendars and
approved exclusions, saved assessments and reviewed rewards remain incomplete.
These TEST actions do not make real employee performance or pay decisions live.
Earlier phase acceptance tools expect older exact schemas and must not be rerun
unchanged against this nine-receipt installation.
