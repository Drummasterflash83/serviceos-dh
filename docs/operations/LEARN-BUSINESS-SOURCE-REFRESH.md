# Business source refresh

## Current state — 13 October 2026

The job-refresh backend is installed and preserved in both TEST and LIVE. The
matching TEST frontend verifies an already-current source review. The protected
LIVE frontend candidate is READY but has not been promoted: the genuine
changed-source journey still requires the existing LIVE login. No production job
has yet been refreshed. Current release evidence is linked below.

The initial business identity link remains immutable. An append-only refresh ledger
records actor, request, previous/current source versions and complete canonical
before/after records. A private effective-link view makes the accepted version
available to the source-aware job/customer readers without altering the original
review actor or receipt. Source capture history is untouched.

The first adapter handles Commusoft jobs. Preview compares the current published
fields with their original imported values and the latest unambiguous provider
version. Owner, site, connection and job identity must still match. Changed local
fields, owner changes, invalid source fields and ambiguous versions are held.
Status, title and source dates can advance; uncertain timezone values stay raw and
remain excluded from elapsed-time calculations. Codes are retained as text.

Apply uses the exact preview revision and source version, with connection/roster/job
locks, existing tenant/owner/operator authority and a durable request receipt.
A repeated request returns its original outcome; conflicting reuse is rejected.
OpenFolk uses its existing logged, explicitly selected tenant facade, never profile
switching. The new storage/view remain private. Installation performs no refresh.

The UI appears only when the authorized work reader supplies linked_id. It displays
saved/latest values, timing limitations, an explicit reviewed checkbox and a reason.
Its actor/backend/tenant/link-scoped outbox persists before dispatch. A lost response
is recovered by checking the same request before any retry. Wrong-scope receipts and
session changes do not clear the outbox. The UI remains unavailable on older backends.

Cancellation now has its own append-only receipt. It retires an obsolete preview,
fences a delayed apply and never reverses a committed update. The scoped outbox is
cleared only after a matching committed or cancelled receipt. Lost cancellation
responses recover through the same saved request.

## Verification

The full retained native schema passes 15 existing journeys and the new open-to-
completed job refresh scenario. It verifies owner preview, audited operator apply,
unchanged profile/identity/source, restored customer Slack context, replay/conflict,
foreign tenant, local edit/reassignment holds and late-ledger atomic failure.
Unzoned completion remains null as an instant. All 1,591,580 archived rows and seven
sequences remain unchanged by installation; the new ledger is separately verified
empty, including the additional cancellation ledger. Transaction rollback, 42 withholding comparisons and the 600-job lookup
regression also pass. The isolated container was removed.

Run the source-refresh SQL fixture at the known-positive point immediately before
“Each negative is rolled back” in learn-customer-context-lookup.assert.sql, in an
isolated fully restored database with the prior baseline helper retained exactly as
that fixture requires. Roll the encompassing transaction back. It must never run
against a hosted project. Client checks: node --test src/lib/learn-job-refresh.test.ts
src/lib/learn-commusoft-work.test.ts src/lib/openfolk-business-review.test.ts (24 pass),
TypeScript and npm run build pass. Signed-in TEST now verifies linked-job search
and an already-current source review on frontend `119b13d`. Hosted changed-source
apply remains unverified; see the TEST evidence below.

## Remaining release and delivery work

- Cancellation, a second source transition, stale/equal-time ambiguous previews and
  revoked owner/module/connection checks now pass offline. Three controlled
  two-session races and a later unambiguous return to prior source content now
  pass too; the competing session was observed waiting on the database lock.
- Exact LIVE guards, empty rollback and history-preserving pause now pass native
  rehearsal. TEST alignment and both empty rollbacks also pass; all sixteen scoped
  TEST tables (78,378 rows) are unchanged by installation. An older reader which
  ignores accepted revisions must never be restored after real refreshes exist.
- Verify the genuine changed-source journey through the protected production
  preview and logged operator controls before promoting its frontend. Do not promote
  unrelated QuickBooks, legal drafts or roadmap changes with this feature.
- Extend to customer, site and contact projections and controlled unattended refresh
  of unchanged reviewed identities, holding ownership/identity/local-edit conflicts.
  This job candidate does not complete all ongoing business-system reconciliation.

[Sanitized evidence](evidence/learn-business-job-refresh-rehearsal-2026-10-13.json).

## Hosted TEST frontend observation — 13 October, 22:11 UTC

Deployment `dpl_8oV6zsNRRRbSiUdwsxgDBLHfoqV5` serves both protected TEST aliases.
The current-source review passes in the existing operator session. The old page
initially remained cached after reload; an exact release query showed `119b13d`.
Cache origin remains under investigation. Both bounded review windows are closed
and original module/account state is restored. No canonical refresh occurred.
[Partial browser evidence](evidence/learn-business-job-refresh-test-2026-10-13.json).

## Production backend / held frontend — 13 October, 22:24 UTC

The exact backend is installed and all 133,019 compared rows across sixteen source,
canonical and access tables are unchanged. Both ledgers are empty. Candidate
`41a22e6` is built with the same six UI files plus no-store HTML headers and has a
verified production auth target. It is protected and not promoted. Automatic review
requires the real changed-source journey before moving aliases; a saved-login
label/address conflict is awaiting Chris's clarification. Do not bypass either
block with a synthetic session, new grant or extraction of a browser token.
[Current evidence](evidence/learn-business-job-refresh-production-2026-10-13.json).

## Concurrent requests and source recurrence — verified offline

Three independent pairs of database sessions prove save/save idempotency, a committed
cancel fencing a delayed save, and a committed save surviving a late cancel. Each
second session was observed waiting on a real lock; both callers received the same
receipt and exactly one durable outcome remained. Initial identities, provider
versions and operator profiles were unchanged. A later page can re-observe an older
content version and produce a third accepted revision without rewriting history.
All 15 native journeys and archive preservation still pass; the container is removed.
The helper `scripts/backup/rehearse_business_refresh_races.py` must only be called
with a live `RestoreSandbox` after the exact schema prerequisites are installed.
It validates containment before creating its three disposable clone databases.
This is offline acceptance, not a substitute for the pending real preview journey.
[Evidence](evidence/learn-business-job-refresh-concurrency-2026-10-13.json).
