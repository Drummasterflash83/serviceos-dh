# TEST measurements and human review release

Release `006_measurements_reviews.sql` was installed in TEST at **20:49:04 UTC
on 9 October 2026**. Real signed-in acceptance passed at **20:50:25 UTC**, including
the application's actual `loadPerformanceMeasurements` reader. Production,
communications, recordings, provider operations and real employee assessments
were untouched. This does not complete LEARN V1 or its live source adapters.

## Sources and release boundary

The reproducible bundle retains six sources: the recovered objectives schema and
hardening, performance observations, human reviews, conflict/retention fixes and
observed team-membership proof. The source manifest records full-file and selected
checksums. Objective graph node-type seeding is deferred with objective projection;
no existing registry row, tenant objective, performance fact or baseline is seeded.

The release adds sixteen tables and nine functions. Eight tables are non-secret
controlled registries; eight contain tenant-scoped objectives, metric definitions,
measurements, links, health snapshots and reviews. Explicit role grants replace
implicit defaults. Restrictive tenant policies override legacy cross-company
OpenFolk reads. The existing same-tenant reference guard is attached to the new
tenant tables, including config, metric, measurement and reviewer references.
The existing 62 public tables, helper definitions, source privileges and rules
functions are preserved. TEST now has 78 public tables and seven deployment receipts.

Source SHA-256: `8a1b32fd0a1896946a7a6f79dd3598eabfec237ca418a4fab6d3b7ee155a15e8`.

## Evidence and review behavior

Trusted adapters call `learn_performance_append`; browsers cannot. Each fact binds
an exact company, subject, policy revision, period, measure, unit and permitted source.
Evidence references must exist in that company. Appends start inferred, support
identical retries and preserve a correction chain. A correction cannot fork or
silently replace an unrelated period or policy. Human reviews are separate immutable
facts; they do not rewrite value, source time, coverage or the stored review label.
The card reader applies the latest complete human review to its displayed view.

The service role cannot bypass the adapter by directly inserting staff-performance
rows. A SECURITY INVOKER insert guard permits those rows only under the measurement
table owner's execution context; the validated SECURITY DEFINER adapter supplies
that context. Existing service inserts for company-wide objective measurements
still work. This does not prevent the trusted database owner from administrating
its database, and source ownership alone does not prove a calculation is correct.

The owner/admin review RPC uses expected revisions and locks the same observation
row as correction. Conflicting requests return HTTP 409 (`PT409`), not a request
for database serialization retries. One of two concurrent reviewers can append
the next revision; the other must reload. Preview sessions and revoked roles cannot
write. Measurements, reviews and objective-health ledgers also reject TRUNCATE,
which would otherwise bypass row-level append-only triggers.

For team-specific member measurements, `learn_member_group_covers` validates the
retained observed history against the current membership snapshot. It requires
complete confirmed membership over every segment of the requested period, rejects
unknown earlier coverage, mixed teams, gaps, a disabled capture trigger and histories
above its 1,000-event bound. Earlier valid team periods remain usable after a later
transfer. Effective dates in today's row cannot invent earlier observed history.
The helper is internal, with no direct application execute grant.

This deployment replaces the old current-row group check in the append function.
**Later TEST handoff releases must retain these follow-ups when replacing that
function**: the older retained handoff source would otherwise restore both the
40001 conflicts and the current-row membership check. The normal migration order
applies `20261030040000` and `20261030050000` after the earlier handoff definition.
A selectively generated TEST bundle must explicitly preserve the same final behavior.

## Verification

The isolated verifier restores recorded schema metadata into a disposable,
network-isolated PostgreSQL container. It does not read the existing local database
or copy customer rows. It applies the prerequisite releases under the non-superuser
deployment owner, injects a receipt failure and proves rollback, then applies the
measurement release and verifies preservation of every preceding table/helper.
Tests cover correction/review conflicts, raw facts versus reviewed views, historical
team membership, foreign references, owner/viewer/provider isolation, direct service
bypass denial, retained ledgers and concurrent reviews. A synthetic original email
is unchanged. Main/preview TypeScript, the preview production build and 31 focused
client/release-runner tests passed.

The hosted rollback rehearsal at **20:45:31–20:45:33 UTC** acknowledged rollback
and matching complete before/after catalog fingerprints. Installation acknowledged
the atomic checksum receipt and matched the expected new definitions while preserving
all earlier catalog objects. An uncertain operation is inspected, never automatically
replayed. Signed-in acceptance used four synthetic users across two marked companies,
with the existing TEST keys retained only in process memory.

The first acceptance run stopped at an incorrect harness assertion: it expected
`loadPerformanceMeasurements` to leave its derived review value inferred even after
a confirmed human review. That contradicted the existing reader contract. Its raw
facts and three review rows were retained, and synthetic access was revoked. The
corrected check explicitly distinguishes raw stored `review_state='inferred'` from
the derived confirmed card view. The subsequent run passed all checks, including
actual HTTP 409 responses, concurrent review, later transfer/earlier correction,
privileged rewrite/delete denial, View-As and same-JWT role revocation.

Two runs intentionally retain four marked synthetic TEST companies in total, four
measurements, six reviews, four memberships and eight reviewer/staff profiles.
The linked Auth identities remain because retained reviews reference their authors.
All eight test users were banned, their random passwords replaced, and profile roles
changed to viewer. Catalog checks verified the bans and roles; existing JWTs could
no longer read performance facts/reviews. No retention trigger was disabled and no
actual staff account was changed. Fixture manifests contain IDs/counts, not credentials.

- [Hosted rehearsal](evidence/learn-test-measurements-rehearsal-2026-10-09.json)
- [Installed release](evidence/learn-test-measurements-installed-2026-10-09.json)
- [Initial harness failure](evidence/learn-test-measurements-acceptance-initial-2026-10-09.json)
- [Passing signed-in acceptance](evidence/learn-test-measurements-acceptance-2026-10-09.json)
- [Installed catalog](evidence/learn-test-measurements-installed-schema-2026-10-09.json)

```sh
python3 scripts/verify/learn-foundation-release.py --rules --conflicts --measurements
node --test scripts/verify/learn-test-measurements-*.test.mjs
LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy \
  node scripts/verify/learn-test-measurements-acceptance.mjs \
  --retained-synthetic-test --existing-cli-login
```

The last command deliberately creates retained synthetic evidence and disabled
reviewer identities. Earlier foundation/rules fixture runners expect their older
schema and must not be reused unchanged after this release.

## Remaining work

Work-transition authority, observed work history and handoff/residence collection
are not installed in TEST. Complete work registries/transition rules and endpoint
identity checks must precede those writers. Source-adapter reconciliation, staff/team
collection permissions, approved calendars/exclusions, team aggregation, saved
assessments and reviewed reward decisions remain incomplete. This release does not
claim real communications completeness, a valid employee score, automatic payroll,
a deployed TEST frontend or full browser acceptance.
