# OpenFolk customer-attribution review

Status, 11 October 2026: database release 065 is installed in TEST only. The
OpenFolk component is implemented and browser-checked locally with synthetic
responses; matching frontend deployment and signed-in hosted acceptance remain
open. Production has not changed.

## Resolve an initial attribution hold

1. In the selected client's OpenFolk module controls, open **Customer attribution
   needing review**. The list contains retained `identity_review` interactions;
   provider failures and canonical projection holds have separate controls.
2. Choose a held communication. Search that client's existing contacts by name,
   email or phone; continue through pages when needed. Do not choose the first
   match just because it shares the identifier that caused the ambiguity.
3. Compare the source summary, addresses/numbers, direction and timestamp against
   the selected contact and their displayed company. The preview is limited to
   2,000 characters; investigate the full retained source if this is insufficient.
   Any rejection of this contact/company is shown explicitly.
4. Give a reason explaining the evidence and any departure from an earlier
   rejection. Confirm the checkbox and select **Confirm contact and update card**.
5. Require the recorded receipt before reporting success. Card enrichment,
   canonical attribution, event consumption and the immutable operator audit are
   one transaction. Contact verification and the contact's company are not changed.
   Locked card fields and earlier rejection records remain intact.

Existing effective `platform.controlplane.view`/`admin` grants govern reads;
mutation requires `admin`. Tenant ownership alone does not grant this access.
View-As, actor mismatch, expired/revoked grants and cross-tenant selections are
rejected. The private publication helper cannot be called by browser or service
roles directly. No account/grant is created by this feature.

## Interrupted or stale reviews

The browser saves a scoped request before sending it. If a response is lost, use
**Check saved result** or **Retry saved request**; both first inspect the same
request ID. Do not clear browser storage or create a replacement request to work
around an uncertain result. **Cancel unresolved request** records a tombstone,
which prevents a delayed apply for that request. A committed request returns its
original receipt even when cancellation is requested later.

If the communication, chosen contact, company or displayed rejection changes,
refresh the evidence and make a new decision only after resolving/cancelling the
saved request. Two competing reviews cannot both publish. Read failures are
reported as unavailable rather than as an empty hold list.

## Remaining recovery work

This flow handles initial ambiguous/conflicting attribution to an existing
contact and that contact's existing company. It does not merge duplicate people,
edit their company, classify internal traffic or repair malformed source facts.
Those cases remain held for investigation.

A communication with a previous committed delivery, or a move away from another
person who already has a card, is blocked here. A broader correction must
reconcile the old card, recommendations, graph and history as well as the new
attribution; that correction flow is not yet delivered. New source revisions
still go through the normal matching rules and can require a fresh review.
Neither this review nor its operational card priority is a staff/pay assessment.

## Release and recovery

Use pinned TEST package `065_identity_review.sql` and its manifest after the
catalog/preservation guards pass. Keep historical pinned runners unchanged; a
later schema requires a newly reviewed release rather than changing old hashes.
Full-schema and exact-package rehearsals use rolled-back synthetic fixtures.
No synthetic user or grant remains after installation.

If the feature malfunctions, restrict the operator action and investigate its
immutable request receipt before retrying. Preserve both
`learn_identity_operator_reviews` and `learn_identity_delivery_receipts` with all
source/card records. Do not drop audit tables or restore a database over newer
records to undo a decision. Frontend rollback alone does not disable the RPC;
any emergency permission change must account for in-flight requests and keep
operator incident evidence. The automatic delivery wrapper can be restored from
release 062's `learn_identity_deliver` definition in a separately rehearsed
forward repair, without removing stored decisions. Production promotion and its
complete rollback rehearsal remain subject to the release gate.
