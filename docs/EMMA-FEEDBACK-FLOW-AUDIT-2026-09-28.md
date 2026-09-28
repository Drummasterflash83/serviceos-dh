# Emma feedback and practice flow — local implementation and proof

Date: 28 September 2026. This record distinguishes source inspection and local proof from a live provider/browser test. No customer/provider message or production write was made by this audit.

## What was actually present

- `receptionist-calls` is a tenant-authorised, read-only Vapi view. It does **not** ingest Vapi calls into `phone_calls`. No Vapi end-of-call webhook exists in the inspected tree. Simwood ingestion is a separate telephone pipeline.
- `receptionist-practice` creates a bounded, recorded Vapi browser call and saves its session/call binding before returning it to the browser. These sessions survive the browser leaving, even without feedback. Result/recording retrieval checks tenant, author/operator visibility and exact Vapi practice metadata.
- Before this change, typed practice feedback existed only in React memory until explicit Save. Navigation/reload could lose that typed feedback, although the call itself remained saved.
- Feedback INSERT and its legacy notification outbox INSERT are one database transaction. The old dispatcher can attach the completed practice transcript after scope checks. It does not attach signed recording URLs.
- The legacy dispatcher accepts a Slack webhook configured on the workspace; the URL host check is **not proof of the Slack workspace/channel**. It retries up to ten claims, then leaves the failed record for inspection. The separate care delivery implementation must own verified operator routing; it must not silently reuse this older unverified destination.

## Changes made

Migration `20261022140000_practice_feedback_drafts.sql` adds:

- Tenant/author/session-bound draft storage with no direct authenticated writes.
- Versioned `save_receptionist_practice_draft`: retries of the same acknowledged text return the same version; stale or foreign edits refuse.
- `complete_receptionist_practice_draft`: atomically creates one final feedback row, uses the exact server-held call/session/author binding, queues normal downstream work via existing triggers and removes the draft. A lost acknowledgement replays the same receipt.
- `submit_receptionist_observation`: general observations now have stable request IDs and idempotent receipts. Reusing a receipt with different details refuses rather than silently replacing or duplicating the observation.

Migration `20261022145000_receptionist_notification_cutover.sql` adds an explicit notification handoff:

- The new care-alert lane is disabled by default, so it cannot duplicate the old dispatcher during rollout.
- A secret-authenticated, deployed care worker must create a fresh readiness receipt. An administrator cannot forge that receipt through the public RPC interface.
- An administrator outside client preview may switch a tenant only when all three OpenFolk Slack routes are verified and no legacy receptionist send remains in flight.
- Pending legacy receptionist notifications are mapped to their durable care issues/alerts and marked `superseded`, **not sent**. New feedback then enters this same managed lane atomically.
- The legacy dispatcher checks the authoritative routing guard before reading any transcript or contacting Slack. Programme/general-feedback notifications remain on their existing route.
- There is no automatic fallback to an unverified old webhook after cutover. Disabled/changed care routes retain pending work visibly.

This cutover was **not activated against production**. Deployment must install schema before the updated edge functions, verify the fresh worker readiness probe and three routes, then invoke `care_enable_notifications` through the authorised operator endpoint. A readiness receipt proves deployed code/configuration presence, not a funded model request, successful call analysis or Slack delivery; those remain separate acceptance checks.

The practice UI now saves draft text after a short typing pause, restores acknowledged drafts, finalises on ordinary in-app navigation and explicit Save, and provides feedback on older test rows. A serial controller ensures finalisation waits for pending edits. The UI distinguishes “not yet saved”, “draft saved” and “feedback saved to OpenFolk”. Draft text is **not stored in browser localStorage**.

An abrupt browser/device/network loss cannot guarantee delivery of the final unsent keystrokes or an in-flight finalisation. Previously acknowledged server drafts remain available; this is not described as a confirmed final report. An empty/cleared draft creates no invented feedback.

## Local proof

Run serially from the repository:

```sh
node scripts/practice-feedback-proof.mjs
node scripts/receptionist-cutover-proof.mjs
node --test scripts/receptionist-notification-flow.test.mjs src/lib/practice-feedback-draft.test.ts src/lib/receptionist-practice-layout.test.ts src/lib/receptionist-phone-practice.test.ts src/lib/receptionist-practice.test.ts src/lib/receptionist-recording.test.ts src/lib/receptionist-practice-runtime.test.ts src/lib/receptionist-web-call.test.ts
```

- Database proof: **27 assertions passed**, all fixtures/schema changes rolled back. Covers cross-tenant refusal, direct-write refusal, stale edits, retry receipts, exact call binding, atomic notification and empty-draft handling.
- Notification cutover proof: **19 assertions passed**, all fixtures/schema changes rolled back. Covers missing/stale/forged readiness, unverified routes, in-flight legacy delivery, atomic mapping, no false delivery receipt, post-cutover suppression and unchanged programme notes.
- Focused regression set: **67 tests passed**. Includes nine draft concurrency/state tests and twelve tests executing the actual legacy notification handler with in-memory SQL/network boundaries. The remaining checks cover voice readiness, practice isolation, recording retrieval and readable layout contracts.
- TypeScript passed. Targeted ESLint has no errors; two existing `PracticeImprove` warnings remain (Fast Refresh export and cleanup ref).

These proofs do not demonstrate a real microphone connection, audible output quality, actual Vapi call completion, real Slack channel delivery, production scheduling or a browser walkthrough. They must not be reported as full live end-to-end acceptance.

## General client feedback boundary

`client_programme_notes` is the existing shared client review/feedback store. Its INSERT trigger uses the same legacy `client_notification_outbox`; the dispatcher sends a private workspace pointer, not receptionist transcripts. Renaming/removing the client-facing Programme menu does not require deleting this store or its historical notes. Module-general feedback should not be automatically sent into Emma’s call-analysis pipeline.

## Independent review observations for the care worker

- Initial review identified that known Slack rejections must enter normal retry/backoff, while ambiguous timeouts or lost receipts stay uncertain. The worker owner added this distinction and receipt reconciliation during the build.
- Initial review identified that bounded complete-only scans need a resumable strategy for larger tenants. The worker/database owners added durable continuation windows during the build.
- No stutter root cause is established by transcript repetition alone. Provider audio/log evidence and the listener’s media path are separate evidence sources.
