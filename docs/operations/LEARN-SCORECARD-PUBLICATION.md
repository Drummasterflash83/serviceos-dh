# LEARN scorecard publication

Implemented and verified locally; not deployed or used to rate actual employees.

## Behaviour

Settings still save immutable drafts. Draft reads now use the highest saved
revision through `learn_scorecard_read_draft`, avoiding tied or out-of-order
transaction timestamps. An owner/admin can publish the latest saved
revision for that exact tenant and subject/group scope after reviewing its criteria,
weights, scale and evidence requirements. The UI requires a reason and attestation,
and blocks publication while the editor differs from the saved draft. The server
accepts only revision identity and reason, never caller-supplied scoring definitions
or effective dates. Active View-As sessions cannot publish.

`learn_scorecard_publish` validates the retained definition, takes the same scope
lock as draft saving, rejects stale revisions, and writes an immutable publication
receipt. Identical request retries return that receipt; changed request contents
are rejected. Effective time is assigned by the database at publication. Backdating
and scheduled publication are not exposed. A later draft does not replace published
rules; publishing that later revision ends the preceding publication's interval.

`learn_scorecard_policy_for_period` selects the exact scope's rules as of the start
of a half-open period. It returns no rules before the first publication and rejects
periods crossing a later publication. A period ending exactly at a replacement is
valid under the earlier revision. No company-wide/group fallback is inferred.

Cards let reviewers select draft simulation or published rules for their dates.
The scorer checks the returned publication interval in addition to exact subject,
tenant, policy revision and measurement period. Publication does not confirm source
evidence: missing, inferred, disputed, stale or insufficiently covered evidence still
withholds the result. Advisory results do not change payroll.

## Retention and deployment

Migration `20261030000000_learn_scorecard_publication.sql` adds the publication
ledger and guards existing scorecard configuration/entry revisions against update,
delete and truncate. Other configuration rows can still change normally. Original
configuration status remains `draft`; the dedicated publication ledger is the
authority for publication, and the dated reader returns a published snapshot.
Do not infer publication by checking `config_versions.status` alone.

Dependencies include the draft-save and membership-history migrations. The TEST
release bundle now includes both, the View-As context prerequisite and the
revision-ordered draft reader; it passed a rollback-only hosted rehearsal but is
not installed. See [TEST rules release](LEARN-TEST-RULES.md). Before any
deployment, verify target migration history and inspect existing scorecard entries
for duplicate tenant/policy/revision identities: the new unique index deliberately
fails on duplicates instead of discarding or silently selecting existing rows.
Verify other consumers tolerate retained draft rows and the additive publication
ledger. No hosted migration, source backfill or baseline capture has run here.

## Verification and limits

Run `python3 scripts/verify/learn-scorecard-publication.py` with local Docker access.
It clones schema only from the existing local Supabase container into a disposable
network-isolated database, creates synthetic fixtures and runs capture, collection,
review and publication checks. It does not copy real table rows, storage or login
credentials. Assertions cover publication retry/conflict, newer drafts, stale editors,
effective boundaries, tenant/role/View-As checks, immutable revisions and unchanged
measurement/receipt counts. It verifies integration with the local schema, not a
fresh replay of every historical migration or production deployment.

Pure tests cover request/receipt scope, published-policy reads and scoring interval
guards. Main/preview TypeScript and builds passed. Browser fixtures verified dirty
edits block publication, a saved revision publishes, newly published rules cannot
apply to earlier dates, and missing evidence remains unassessed under eligible rules.

The card date controls currently select full UTC days. They cannot select an
intraday publication boundary; a day crossing that boundary cannot be scored in one
assessment. Saved assessment runs, publication suspension/retirement, future
scheduling, numerical correction UI, approved calendars and complete source
adapters remain outstanding. Group policies also depend on proven historical
membership. Retained definitions alone do not establish fair criteria or complete
source coverage, and this work establishes no real person's score or reward.
