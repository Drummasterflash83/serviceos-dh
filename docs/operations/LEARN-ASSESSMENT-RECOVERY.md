# Interrupted assessment saves

TEST backend release 046 installed at 22:06 UTC, 10 October 2026, following a
matching hosted rollback rehearsal. The [paired protected TEST frontend](https://serviceos-learn-test-o318vsaa2-allkin.vercel.app)
is READY from Git `77cff26969aca10daddab2e27f1857d942b9bfc3` at 22:09 UTC. Production is unchanged. See [hosted evidence](evidence/learn-assessment-recovery-test-2026-10-10.json).

The rehearsal and installation preserved all 87 monitored datasets, including the
original 78 plus saved assessments and their scoring, review, correction,
publication and team-history dependencies. Existing assessment table metadata and
function permissions are unchanged. Six HTTP checks confirm anonymous and
service-role denial for both RPCs and the private cancellation table. These checks
do not establish signed-in owner recovery; that acceptance remains outstanding.

A company owner or admin can retain an assessment under published scoring rules.
Previously, an uncertain save kept its request only in a React ref. Closing the
card or refreshing discarded the request identity, even if the server had already
saved the assessment.

The card now persists the exact request before sending it. Storage is scoped to
backend, account, company and card. It contains the selected publication and period,
expected evidence/review IDs and reason, never client-provided scores, source
payloads, recordings or credentials. On reopening, the reason and original period
stay fixed. The user can check the outcome, retry the same request or cancel an
unfinished save. New requests wait until the previous request is resolved.

`learn_assessment_resolve` uses the same owner/admin, company and View-As boundary
and advisory transaction lock as `learn_assessment_save`. It checks both request
identity and recorded actor. A completed save returns its original receipt even
when evidence has since changed. Cancelling an unfinished request inserts an
immutable private cancellation record; delayed saves using that ID cannot create
an assessment. If the save wins the race, cancellation instead returns the retained
assessment. Neither path edits or deletes an existing assessment or source record.

Browser tabs coordinate through Web Locks. Storage read/write failures, malformed
records, mismatched receipts, changed identity, uncertain network outcomes and
in-flight access changes keep recovery details and prevent an automatic new save.
Only a confirmed recorded or cancelled outcome clears the matching local request.
Recovery details remain browser-specific; clearing browser data or moving devices
is not a supported recovery path. Recorded assessments remain in server history.

## Verification

- Nineteen client tests cover retained-score semantics and browser recovery,
  including lost responses, reload, cross-tab retries, scope isolation, failed
  storage, changed evidence, receipt mismatch and replacement requests.
- The isolated PostgreSQL verifier runs the original save regression checks plus
  migration rollback/apply, unchanged function owner/ACL, missing-session and
  owner/admin/company/preview boundaries, immutable cancellation and delayed save
  rejection. Both save-first and cancel-first races were observed waiting on the
  same live advisory lock, and each left exactly one terminal record.
- App and synthetic-preview TypeScript checks and builds pass. The app's 47
  prerequisite checks pass.
- The actual card UI was exercised locally with synthetic fixtures: a save with a
  lost reply survived full reload, restored the original period/reason and resolved
  to one retained assessment. A separate uncompleted request returned pending,
  then cancelled without changing the earlier assessment in history. The empty
  evidence window correctly remained unassessed.
- Read-only hosted metadata at 22:00:39 UTC confirmed that TEST's installed save
  body matches the local verifier's baseline. Recovery was absent and the ledger
  contained 46 entries. This is compatibility evidence, not hosted acceptance.

Commands:

```sh
node --test src/lib/learn-assessments.test.ts src/lib/learn-assessment-outbox.test.ts
python3 scripts/verify/learn-saved-assessments.py --recovery
npx tsc --noEmit
npm run build
node node_modules/typescript/bin/tsc --project preview/learn-review/tsconfig.json --noEmit
node node_modules/vite/bin/vite.js build --config preview/learn-review/vite.config.mjs
```

The synthetic preview supports `&performance=1&publication=historical&assessments=uncertain`
for a committed save with a lost response, or `assessments=pending` for an
uncompleted save. Its server-side fixtures persist in tab session storage; actual
recovery requests use the production component's local outbox. No provider or
hosted database is contacted. These fixtures do not establish real authenticated
access or hosted persistence.

The hosted login and unauthenticated client redirect also passed in the actual
browser. Next: verify signed-in owner recovery within an authorized acceptance
session. No temporary user or grant was created for this release.
History pagination beyond the latest 20 assessments remains separate unfinished
work. This does not activate scoring, payroll, capture or a provider import.
