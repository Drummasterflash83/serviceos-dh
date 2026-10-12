# Existing Workspace route for the revoked Gmail account

Status: prepared and verified read-only; **not applied to production**.

One existing Drummonds Gmail account has a revoked individual OAuth refresh token.
Its corresponding Workspace mailbox is already active and enabled under the
existing active Drummonds connection. The existing local service-account credential
matches that stored connection. On 12 October at 06:06 UTC, one token request with
`gmail.readonly` and one Gmail profile request succeeded with an exact mailbox
identity match. Google reported 78,124 messages. No message content was requested.

## Proposed live recovery

Change only this existing account's routing status from `active` to `active_dwd`,
using its current tenant/account identity and a guarded transaction. Retain the
account ID, address, revoked OAuth evidence, tokens, source history and relationships.
Do not mark the old OAuth grant valid, replace a credential, add permissions, create
an account, enable a sender or alter another mailbox. The precise account identity
is retained in the private investigation and supplied in the approval question.

Before any write, recheck the exact existing account, matched enabled Workspace
mailbox and connection, `auth_state=revoked`, and `backfill_status=idle`; abort on
changed scope or configuration. The read-only dependency check found one tenant Marketing sender and two account
triggers. A second offline rehearsal proves the trigger changes only a connector
timestamp, not sending permissions. Recheck that dependency state before execution
and abort if any permission would change.
Record retained source identities and account/credential hashes before and after.
Submit one guarded status update with an execution journal; an uncertain response
must be reconciled by reading state before any retry.

The downloaded production scheduler selects `active_dwd` accounts; the worker
routes its job to `gmail-workspace-sync-messages`. Its normal request uses 25
results per INBOX/SENT label and skips retained IDs. This older runtime has capture
limitations addressed by the separate V1 release; a successful sample is not full
history acceptance. The historical scheduler selects only accounts whose backfill
is already running. This account's backfill is idle and must remain idle for this
repair. No historical import, schema/function/frontend deployment or full LEARN
production promotion is authorised by approving this single-account repair.

## Verification and rollback

An offline restore of the pinned 00:25 production archive passed the status change
and reverse change through its actual constraints/triggers. All other account
fields, including credentials and the revoked auth state, remained unchanged.
The disposable container had no network, mounts, exposed ports or active scheduler
and was removed. A second rehearsal compared all 299 archived tables (1,591,576 rows) and five
sequences before and after the routing update. Only the account row and a derived
connector timestamp changed. Connector/capability permissions, all other account
fields and all other archived table fingerprints remained unchanged. The second
disposable container was also removed. Fresh live preflight must still detect drift.

After an approved repair, observe the next actual scheduled Workspace job for this
account, confirm its terminal outcome and stored source provenance, and verify
retained source identities and unchanged capture scope. Do not clear existing
failure evidence or claim full coverage. If routing must be reversed, change only
`active_dwd` back to `active` for the same account after a fresh state check; retain
any newly captured messages and all job evidence. The old OAuth route remains
revoked, so that rollback restores the earlier configuration, not healthy capture.

[Sanitised verification evidence](evidence/learn-mailbox-workspace-recovery-2026-10-12.json).
