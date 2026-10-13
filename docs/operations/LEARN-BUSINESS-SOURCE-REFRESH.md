# Business source refresh

## Current state — 13 October 2026

The job-refresh candidate and matching existing-workspace review control are
implemented and verified offline, not installed in TEST or LIVE. The live reader
timeout fix remains the last released change. The actual completed Commusoft job
has not yet been refreshed in production.

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

## Verification

The full retained native schema passes 15 existing journeys and the new open-to-
completed job refresh scenario. It verifies owner preview, audited operator apply,
unchanged profile/identity/source, restored customer Slack context, replay/conflict,
foreign tenant, local edit/reassignment holds and late-ledger atomic failure.
Unzoned completion remains null as an instant. All 1,591,580 archived rows and seven
sequences remain unchanged by installation; the new ledger is separately verified
empty. Transaction rollback, 42 withholding comparisons and the 600-job lookup
regression also pass. The isolated container was removed.

Run the source-refresh SQL fixture at the known-positive point immediately before
“Each negative is rolled back” in learn-customer-context-lookup.assert.sql, in an
isolated fully restored database with the prior baseline helper retained exactly as
that fixture requires. Roll the encompassing transaction back. It must never run
against a hosted project. Client checks: node --test src/lib/learn-job-refresh.test.ts
src/lib/learn-commusoft-work.test.ts src/lib/openfolk-business-review.test.ts (21 pass),
TypeScript and npm run build pass. No signed-in browser acceptance is claimed.

## Remaining release and delivery work

- Add durable cancellation for an obsolete pending review, preserving its receipt
  and fencing a delayed apply. The current control can check/retry but cannot safely
  discard that request; do not describe recovery UX as finished.
- Verify multiple source transitions (including repeat content), stale/ambiguous
  previews, disabled modules/connections and revoked actors, with UI recovery cases.
- Prepare the exact matching release and guards. Rollback must preserve refresh
  history and accepted canonical versions; an older source reader which ignores
  those revisions must not be restored after real refreshes exist.
- Verify hosted TEST and browser UX, then release the scoped backend/frontend and
  refresh the observed real job through the logged operator controls. Do not promote
  unrelated QuickBooks, legal drafts or roadmap changes with this feature.
- Extend to customer, site and contact projections and controlled unattended refresh
  of unchanged reviewed identities, holding ownership/identity/local-edit conflicts.
  This job candidate does not complete all ongoing business-system reconciliation.

[Sanitized evidence](evidence/learn-business-job-refresh-rehearsal-2026-10-13.json).
