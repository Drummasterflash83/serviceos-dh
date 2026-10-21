# Emma emergency mailbox 603: durable delivery boundary

Source-only design, 21 October 2026. This does not install a schema, enable a
sender, post to Slack, send mail, alter Birchills/Vapi or change the main DID.
It describes the missing boundary between the candidate's verified 603 intent
and an actual notification. Keep this within draft PR #88 until provider
capability, sender ownership and a supervised handset drill are accepted.

## Current boundary

`receptionist-emergency-603-receiver.ts` validates an immutable, published
Birchills 603 voicemail source, one correlated failed attempt to the selected
engineer, an actual 603 deposit, and the reviewed internal Slack route. It
derives stable IDs for Rob email, Tony email and one `#ai-emma-urgent` post.
`readEmergency603Delivery` can assess provider receipts. **Neither function
persists an intent or sends anything.** The existing
`client_notification_outbox` is a feedback/programme Slack queue; its general
dispatcher is at-least-once and must not be relabelled as 603 delivery proof.
The existing private voicemail intake is email-source based; the LIVE 603
mailbox has no verified intake route or saved deposit. A Birchills setting
showing Tony's address is not an email-delivery receipt for Rob and Tony.

## One notification owner for both emails

Before enabling a sender, make one explicit, recorded choice for 603:

1. **Birchills-managed distribution:** Birchills sends the single 603
   notification to a verified distribution address with Rob and Tony as
   members. OpenFolk never sends a second email. Its outbox tracks the two
   delivered-recipient receipts from that distribution system and handles
   only the scoped Slack post.
2. **OpenFolk sender:** Birchills sends to a verified private intake mailbox,
   not directly to Tony. After the source is published, OpenFolk sends Rob
   and Tony separately through one approved domain and scoped provider,
   with delivery webhooks. This avoids an extra Tony copy.

Do not split ownership by sending Rob from OpenFolk while Birchills still
sends Tony unless a specific duplicate-prevention and receipt contract is
reviewed. The observed Birchills 603 endpoint has one notification-address
field; [Birchills' portal guide](https://www.birchills.net/wp-content/uploads/2019/02/portalNEW.pdf)
also describes a singular shared-mailbox notification email. That older
guide does not prove a current two-address format or external dialable 603
target, so neither is assumed.

## Durable once-only record

Add a service-role-only `receptionist_emergency_603_outbox` table, separate
from customer/client notification queues. One row per
`(tenant_id, published_source_id, target)` with `target` limited to
`rob_email`, `tony_email`, `urgent_slack`, and `delivery_id` fixed to the
receiver's deterministic UUID. Enforce unique keys on both that tuple and
`delivery_id`; foreign-key the source to the private voicemail source and
pin the source/audio hash, 603 provider message reference, call-binding
receipt, notification-owner mode, recipient/channel hash and route version.
Store no caller name, number, address, transcript, audio or public link in
the row or notice. RLS denies `anon` and `authenticated`; service-only RPCs
read and mutate it. Default the sender to **Off**.

An atomic `prepare_603_notifications` RPC must recheck the published source,
exact 603 mailbox, failed selected engineer attempt, deposit and reviewed
route under one transaction, then insert all three frozen rows with
`ON CONFLICT DO NOTHING`. A repeat call returns the original IDs and
fingerprints; a conflicting source or route version goes to review rather
than silently replacing the intent. No network call occurs in this RPC.

Claim rows with `FOR UPDATE SKIP LOCKED`, a short lease, a fixed attempt
budget and an explicit sender-enable gate. The claim must never select
`uncertain`, `submitted`, `delivered`, `posted` or `cancelled` rows. If the
process dies after crossing an external send boundary, mark the row
`uncertain` when its lease expires and reconcile against the provider before
any retry. Never convert an expired `sending` row back to `queued` blindly.

For OpenFolk-owned email, reuse the existing Resend transport's
`Idempotency-Key: deliveryId` and response classification. A 2xx is only
`submitted`; a verified delivery webhook, bound to provider message ID,
recipient, tenant, source and delivery ID, is needed for `delivered`.
Resend 5xx, timeout or lost response is `uncertain`, not an automatic resend.
The existing Gmail send path has no equivalent provider idempotency guarantee
and is unsuitable for automatic retry of this emergency notification.

For Slack, use the existing OpenFolk bot and
`sendSlackMessage(..., deliveryId)` only after a fresh internal-channel and
membership check. Freeze the channel/version on the outbox row. Save the
returned channel and `ts` as `posted`. A lost response freezes `uncertain`;
`client_msg_id` alone is not proof of exactly-once posting. Reconcile the
specific message before a supervised retry. A queued outbox row, accepted
email, accepted Slack request, transfer attempt or ringing leg cannot be
described as delivered.

## Acceptance evidence and failure tests

- Replayed webhook and concurrent workers create exactly three logical rows,
  with no duplicate send. A changed source hash, message reference, call ID,
  selected engineer outcome or route version holds all three before dispatch.
- A crash before send is retryable; a crash or timeout after a possible send
  freezes `uncertain`. A definite provider rejection records a fixed code and
  can retry only where the provider contract permits. No raw response text
  enters an audit or notification.
- One supervised missed-call case proves a single real 603 deposit after
  exactly one failed Tony or Rob attempt, then Rob **delivered**, Tony
  **delivered**, and a Slack **posted** `ts`, all tied to that same message ID.
  Repeat the proof for the other branch and genuinely uncertain→Tony.
- Keep the test number and graph on one frozen hash for 12 provider
  conversations and the handset drill. Main DID remains unchanged until
  Chris separately approves its exact switch and rollback.

Existing components to reuse: private voicemail source/intake in
`20261101420000_learn_voicemail_private_intake.sql`, the candidate 603
receiver and fallback proof, `notification-slack.ts`, the Resend transport,
and the uncertain-send fence in `customer_notification_outbox`. This design
requires a dedicated migration, worker, delivery-receipt verifier and tests
before any LIVE sender activation.
