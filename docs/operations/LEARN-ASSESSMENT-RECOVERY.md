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
History now supports older pages in the local candidate described below. This does
not activate scoring, payroll, capture or a provider import.


## Saved assessment history beyond the first 20

The history reader now loads older assessments in pages of 20, ordered by the
original save timestamp and ID. Its position retains PostgreSQL microseconds and
is bound to the company and card. Newer saves cannot shift the older-page boundary;
refresh explicitly returns to the latest records. Each page reports the remaining
count as observed at that read, rather than promising a live total.

A failed older-page read retains the displayed assessments and offers retry.
Refreshing retains the selected immutable assessment while returning the list to
its latest page. Scope changes invalidate pending reads. Each retained assessment
continues to use its original published rules, evidence and saved time.

Verification for this increment:

- Five additional history tests (24 combined client tests) cover timestamp ties,
  microsecond boundaries, foreign/malformed cursors, partial and failed responses,
  and the actual Supabase client's bounded request with a concurrent newer save.
- The disposable PostgreSQL verifier reads all 48 synthetic assessments through
  three pages while inserting a newer record after page one: no duplicates or
  omissions, and refresh exposes the newer record. Foreign-owner and same-company
  viewer reads remain denied by the actual assessment RLS.
- Those real SQL results pass the production history reader and frozen-snapshot
  parser through the Supabase client with a local replacement fetch. This bridge is
  part of the reproducible verifier; it makes no hosted request.
- The actual local browser loaded 20, then 40, then 43 synthetic rows, recovered
  from the deliberately failed second page, opened the oldest retained assessment,
  and refreshed the list without closing its original detail.
- App and preview TypeScript/build checks pass, including 47 prebuild checks.

```sh
node --test src/lib/learn-assessments.test.ts src/lib/learn-assessment-outbox.test.ts src/lib/learn-assessment-history.test.ts
python3 scripts/verify/learn-saved-assessments.py --recovery --history
```

The synthetic browser scenario is `&performance=1&publication=historical&assessmentHistory=retry`
(or `assessmentHistory=many` without the deliberate failure). No backend migration,
permission change, provider request or source-data rewrite is needed. Hosted owner
acceptance remains pending. Deployment status is recorded in
[history evidence](evidence/learn-assessment-history-test-2026-10-10.json).
