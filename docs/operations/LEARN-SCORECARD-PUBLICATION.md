# LEARN scorecard publication

The publication contract below has TEST verification; no real-person numeric
score is published on LIVE. Recheck the target ledger before claiming a wider
deployment.

## Current product direction (Chris, 21 October 2026)

Collect and show the underlying work evidence before assigning numeric job,
customer or team scores. Each client must be able to review how its own process
stages, target times and measure weights affect a score. An external supplier
wait, for example, may change which clock runs and who can move the job next;
neither a Commusoft status nor a long-lived job alone proves that rule. The
present tenant-scoped draft/publication framework supports weighted measures,
revisioned policies, evidence and minimum samples, but does **not** yet model
per-stage clocks, external-wait start/end evidence, responsibility or client
approval of those timing rules. Do not publish a numeric Moving score from a
guessed stage median or treat 3 November as a promised score launch. Keep
dated status observations and show only the minimum interval they prove,
alongside gaps and missing process evidence. Design the timing and pause policy
with client review after the workflow sources are complete; any future policy
change must be revisioned and prospective, with old evidence preserved.

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
revision-ordered draft reader. Release 004 is installed in TEST, followed by the
005 business-conflict repair; signed-in synthetic acceptance passed at 20:38 UTC. See [TEST rules release](LEARN-TEST-RULES.md). Before any
deployment, verify target migration history and inspect existing scorecard entries
for duplicate tenant/policy/revision identities: the new unique index deliberately
fails on duplicates instead of discarding or silently selecting existing rows.
Verify other consumers tolerate retained draft rows and the additive publication
ledger. These hosted TEST releases did not backfill sources, establish staff baselines or
change production. Release 005 returns HTTP 409 for business conflicts; migration
`20261030030000_learn_scorecard_conflict_codes.sql` carries that change forward.

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
