# Workspace discovery reconciliation recovery

The existing Drummonds directory job repeatedly returned `db_error`. Its stored
run receipts identified `mailbox_reconciliation_unconfirmed`. At 05:52:02 UTC on
14 October, PostgreSQL recorded SQLSTATE 42883 while updating the mailbox table:
`marketing_sender_authority_state(uuid, unknown, text)` could not be found.
The same failure existed before the worker throughput release.

Mailbox updates invoke the existing sender-capability trigger. That calls sender
readiness with `search_path=pg_catalog`, but the Resend branch used an unqualified
call to the authority helper. The authority helper in turn used an unqualified
normalisation helper and authority table. The resulting exception rolled back the
absent-mailbox update, preventing a completed discovery receipt.

## Change and validation

Only two existing functions change. Readiness explicitly calls the public authority
helper. That helper explicitly names its public normalisation helper/table and uses
a fixed `pg_catalog` search path. Existing business conditions, invoker security,
Postgres ownership and service-only permissions remain intact. There is no new
sender authority, message sending, credential, job, runtime, schedule or frontend.

The final isolated rehearsal uses the retained production archive plus its matching
21 release prerequisites. It reproduces the exact old exception through the real
mailbox trigger as `service_role`, then proves successful absent-mailbox updates
with the repair. Unknown, malformed, cross-tenant, lookalike and revoked sender
identities remain blocked. Sandbox senders remain test-only; existing exact verified
authority keeps the same readiness. Mailbox enablement and unrelated mailbox rows
are preserved. Exact helper/catalog rollback and reapply pass. All 1,591,601 archived
rows across 387 tables and seven sequences match after rehearsal; no providers or
hosted databases are used. Earlier attempts caught SQL separators, a fixture column
name and inconsistent catalog signature rendering before production application.

Hosted TEST has none of these legacy sender helpers and was not changed. This is
full production-schema local verification, followed by LIVE installation/readback,
not a claim of hosted TEST provider acceptance.

## Live state

The two-function patch is applied and its exact readback and preservation checks
pass. The original discovery job succeeded on its fourth attempt at 06:14:02 UTC.
Its new durable success receipt records 29 directory users, no newly added
mailboxes and four absent addresses reconciled to `removed`. The connection
verification timestamp also advanced. No job was inserted or restarted. The
old failed attempts remain as historical evidence, not current discovery failure. Do not label absent addresses as permanently retired or
claim complete mailbox history from directory discovery.

[Exact manifest and rollback](../../supabase/release/learn-workspace-discovery-helpers/manifest.json).
The rollback restores the exact prior helper definitions and reintroduces the known
failure. It restores no customer data and changes no mailbox choices or access.
Use it only for a verified regression after checking current definitions and pending
jobs; never replay or duplicate the running discovery job merely to accelerate a test.

## Remaining scope

This proves recovery for the saved Drummonds Google connection/domain. It does not
prove complete email history, retirement of the four absent addresses, readiness of
other saved connections, suspended users or every pending mailbox. Those remain
visible coverage questions. Existing historical jobs and run receipts are retained.
