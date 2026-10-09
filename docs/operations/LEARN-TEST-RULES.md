# TEST scorecard rules and forward membership release

Status, 9 October 2026: release `004_rules_membership.sql` is prepared and passed
an isolated database exercise plus a hosted rollback-only rehearsal. **It is not
installed persistently.** TEST remains at the verified foundation/helper releases
with 59 public tables. Production, source communications and recordings were untouched.

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

## Permanent installation and acceptance still required

Install with a fresh matching rehearsal and verify the intended trigger/permission
changes separately from preserved source objects. The new retained records change
the acceptance lifecycle: the previous foundation fixture runner intentionally
requires the old exact schema and deletes temporary staff rows. It must not be
reused unchanged after membership retention is enabled.

Use a marked retained synthetic TEST company for real JWT publication and membership
acceptance, or transactionally roll back synthetic SQL. Do not disable retention
triggers to erase test evidence. Retained synthetic records must be explicitly
identified in the run manifest/report, and test logins can be revoked separately.
No real staff baselines should be inferred or populated as part of deployment.

Objective/measurement/review schemas, work capture and collectors, source adapters,
full UI acceptance and provider completeness remain outstanding. The overall
LEARN V1 goal remains active and incomplete.
