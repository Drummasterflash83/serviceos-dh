# TEST scorecard rules and forward membership release

Status, 9 October 2026: release `004_rules_membership.sql` was installed in TEST
at **20:27:31 UTC**. Follow-up `005_scorecard_conflict_codes.sql` was installed at
**20:37:54 UTC**, and real signed-in acceptance passed at **20:38:14 UTC**.
TEST now has 62 public tables and six deployment receipts. Production, source
communications and recordings were untouched. This is a partial LEARN release;
measurement collection, full frontend acceptance and provider completeness remain open.

## Scope and retained sources

The generated manifest retains five source files and their full/selected checksums:

- The original View-As context table, index and policies; permission vocabulary and
  action lifecycle seeds remain deferred to the control-plane release.
- Immutable scorecard draft saving with the expected revision, reason, configured
  scale, metric weights, targets and evidence requirements.
- Forward membership capture and its bounded owner/admin reader. Existing members
  remain explicitly uncovered until an observed change or an explicit later baseline.
- Prospective scorecard publication, immutable revision/publication guards and the
  period-specific published-rule reader.
- A new revision-ordered draft reader, replacing the client's timestamp ordering.

The release creates three tables and ten functions. It adds retention triggers
and a unique scorecard revision index to existing configuration/entry tables,
and capture/deletion/truncation guards to staff memberships. No baseline, staff
seed, measurement, customer score, provider operation or reward decision runs.

`current_user_role()` receives authenticated EXECUTE because publication RLS needs
it. Its body stays unchanged. The new View-As table grants authenticated users
only their own same-company context, with a restrictive policy overriding the
legacy broad OpenFolk read clause. Context creation is not exposed as a new RPC.
The service role cannot call the human draft-save/publication/read functions.
Membership function search paths explicitly put `pg_temp` last, while preserving
the retained source files and recording the selected-source adjustment.

## Latest draft correctness

`loadScorecardDraft` previously ordered configuration entries by `created_at`.
That timestamp is a transaction clock: multiple revisions can tie, and a transaction
that waited on the scope lock can have an earlier start time than the prior saver.
It cannot establish revision order.

`learn_scorecard_read_draft` selects the highest saved configuration revision for
the exact company/subject/group scope and checks that the retained payload matches
that revision. The client now calls it, validates the returned scope and draft
status, and reports errors instead of falling back to timestamp ordering. Preview
fixtures use the same RPC interface. This is an additional deployment dependency;
there is no fallback to a potentially stale draft while the RPC is unavailable.

## Verification

Run `python3 scripts/verify/learn-foundation-release.py --rules` for the recorded
TEST schema projection. It uses only synthetic data in a disposable network-isolated
Postgres container, without reading the existing local database. The prerequisite
foundation and explicit helper grants are applied first. Release DDL runs as the
non-superuser deployment owner.

The checks passed for 50- and 100-point rules, stale revision refusal, foreign group
and invalid scale rejection, publication idempotency/conflict, unchanged older
rules after a new draft, prospective boundaries and split-period refusal. Draft
reading selects revision two even when both revisions have the same transaction
timestamp. Existing membership stays unknown; new insert/end events retain their
observed times despite earlier effective dates. Privileged rewrite/delete/truncate
attempts fail for retained rules/history, and owner preview/viewer writes are denied.
A synthetic original email and raw metadata remain unchanged.

Injected receipt failure restores the previous schema and triggers. The exact
hosted rehearsal SQL also passes locally and rolls back. Main and preview TypeScript
checks, the preview production build, reader tests and three rehearsal-tool tests
pass. The preview build retains its existing chunk-size/dynamic-import warnings.
No new browser visual check was needed for this server-read change.

Hosted TEST rehearsal at **20:21:38–20:21:39 UTC** acknowledged rollback with all
three tables, ten functions and the receipt absent afterward. Before/after
fingerprints matched, including existing source definitions, triggers, helpers,
metadata-view privileges and ledgers. The runner pins the reviewed checksum,
verifies the installed foundation and helper repair, rejects existing rules objects
and sends one bounded rollback-only request without retrying an uncertain outcome.

- [Hosted rehearsal evidence](evidence/learn-test-rules-rehearsal-2026-10-09.json)
- Release SHA-256: `37d1673acdc896d182b41e6e079475ef69da1d0cfc5c4fbc4017b9546be98562`
- Sources: `supabase/release/learn-test/004_rules_membership.manifest.json`
- Runner: `scripts/verify/learn-test-rules-rehearsal.mjs`

## Installed release and real signed-in acceptance

The installation used a fresh hosted rollback rehearsal at 20:26:50–20:26:52 UTC.
The first install response acknowledged the receipt and preservation of existing
source definitions, but the exact-schema comparison failed: the isolated verifier
had deparsed a policy helper as `uid()` while hosted TEST returned `auth.uid()`.
The verifier now uses the same explicit `public,pg_catalog` search path. Regenerated
expected output matched the installed schema, and the 20:31:03 read-only recheck
issued no installation write. The original failed comparison remains in evidence.

Actual JWT requests then exposed a functional error missed by SQL-only tests:
manual business conflicts used SQLSTATE `40001`, which can trigger PostgREST
serialization retries. Two marked runs timed out specifically on the stale-editor
negative case. Read-only activity checks found no lingering scorecard request.
The immutable release 004 and its checksum remain unchanged. Follow-up 005 changes
only four explicit conflict errors in draft saving and publication to `PT409`.
Clients understand both codes during migration; TEST acceptance requires HTTP 409.
Supabase documents the retry problem and recommends a custom HTTP conflict code:
[RPC serialization retry guidance](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).
The behavior matched that guidance; no claim is made about TEST's PostgREST version
or CPU usage. Genuine database serialization failures are not rewritten.

The narrow repair checks exact prior function definitions, requires a fresh matching
rollback rehearsal, appends its own atomic receipt and verifies that all other
catalog objects/privileges remain unchanged. Unknown write outcomes are inspected,
never retried automatically. The 20:37:37–20:37:38 rehearsal rolled back unchanged.
Its isolated database check also verifies exact function bodies/privileges, duplicate
installation refusal and the full rules/membership assertions using `PT409`.

Four real synthetic Auth users across two TEST companies then verified:

- Owner/admin save/read, configurable 50-to-100 scales, prompt stale-edit HTTP 409,
  invalid group/scale rejection and denied viewer/foreign-company access.
- Publication idempotency, changed-request HTTP 409, unchanged published rules when
  a newer draft exists, dated boundaries and rejection of periods crossing revisions.
- Forward membership insert/end events; renaming adds no event; earlier effective
  dates do not invent historical observed coverage.
- Privileged rewrite/delete protection, restricted history reads, denied View-As
  writes and immediate role-revocation enforcement with an existing JWT.

All four final-run logins/profiles were removed and absence verified. The earlier
failed runs' eight logins/profiles were also removed. Retention guards were never
disabled. Six explicitly marked synthetic TEST companies remain across three runs:
the two early runs retained one draft per company; the passing run retained three
drafts, two publications, two memberships and three membership events. These are
synthetic test evidence, not Drummonds data or employee assessments. Each report
links a permanent fixture manifest with IDs and counts, without passwords or keys.

- [Initial installation comparison](evidence/learn-test-rules-install-first-check-2026-10-09.json)
- [Read-only installation recheck](evidence/learn-test-rules-install-recheck-2026-10-09.json)
- [Repair rehearsal](evidence/learn-test-scorecard-conflicts-rehearsal-2026-10-09.json)
- [Repair installation](evidence/learn-test-scorecard-conflicts-installed-2026-10-09.json)
- [Signed-in acceptance](evidence/learn-test-rules-acceptance-2026-10-09.json)
- [Current repaired catalog](evidence/learn-test-rules-repaired-schema-2026-10-09.json)

Run `python3 scripts/verify/learn-foundation-release.py --rules --conflicts` for the
isolated repaired-schema check. The retained synthetic acceptance runner is
`scripts/verify/learn-test-rules-acceptance.mjs --retained-synthetic-test --existing-cli-login`,
with `LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy`. It creates retained TEST
evidence intentionally. Do not run the old foundation fixture cleanup after release
004: that runner expects the old schema and deletes staff rows. Do not disable
retention triggers to reuse it. No real staff baseline has been populated.

Twenty focused client/release/acceptance-runner tests, both main and preview
TypeScript checks, and the preview production build passed for this repair.

## Remaining release gates

Other unreleased LEARN adapters still manually raise `40001` for business conflicts:
Slack import setup, performance append/review, handoff collection and residence
collection. Before their hosted release, add a follow-up migration and update their
client/Edge error handling and real HTTP negative tests. Preserve historical migration
checksums. Earlier operator/notification modules have the same pattern and need
separate review; this repair does not claim to fix every application RPC.

Objective/measurement/review schemas, work capture and collectors, source adapters,
full UI acceptance and provider completeness remain outstanding. The overall
LEARN V1 goal remains active and incomplete.
