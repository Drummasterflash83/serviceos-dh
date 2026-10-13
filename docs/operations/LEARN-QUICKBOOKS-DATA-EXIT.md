# QuickBooks data return and deletion readiness

13 October 2026. Chris approved the draft text and proposed targets, not actual
record deletion. This record supports the publication check; it does not adopt
an unverified service commitment or change the approved legal text.

## Verified preparation

`scripts/operations/quickbooks-export-query.mjs` prepares a read-only SQL query
for exactly one tenant and either sandbox or production. It creates no database
connection and adds no RPC, grants or hosted access. Execute the prepared query
only through an authorised operations session with sufficient existing database
read rights. Ordinary application roles do not gain table access from this file.

The NDJSON output includes connection metadata, import coverage, all retained
source versions, latest pointers, original page envelopes, observations and
reviewed customer links. It excludes Vault secrets, app credentials, OAuth state,
refresh leases and internal audit records. Source payloads and raw envelopes are
JSON strings so a decimal-aware recipient can retain exact financial numbers;
do not round-trip them through JavaScript Number. Other connectors and records
never imported from QuickBooks are outside this export's scope.

A disposable PostgreSQL rehearsal passed with the actual migrations and synthetic
records. It checked tenant and environment separation, retained history/pages,
customer links, exact 9007199254740993.01 monetary text, and absence of synthetic
access/refresh credentials. Invalid scopes and SQL injection inputs are rejected
before query generation. No real customer export has been made or delivered.

## Operating procedure to rehearse before a real return

1. Record Drummonds' instruction, requested data scope, recipient identity and
   secure delivery route. Identify any restriction or legal hold. Keep this
   instruction separate from a simple connector-disconnection request.
2. Stop new capture through the existing logged operator controls. Record the
   capture checkpoint and unfinished imports. Revoke provider access if requested;
   do not equate disconnection with deletion of retained records.
3. Generate the tenant/environment query and review its scope. Run it with psql
   quiet/unaligned/tuples-only and ON_ERROR_STOP, redirecting output into a new
   private staging file (directory mode 0700, file 0600). Keep stderr separate;
   do not print results into terminal logs or commit them. The query uses one
   repeatable-read, read-only transaction with statement and lock timeouts.
4. Treat any nonzero exit, incomplete transaction or failed reconciliation as
   an incomplete export. Do not deliver a partial file. Reconcile each section
   with the scoped source snapshot, validate JSON lines, record byte length and
   SHA-256, and produce an encrypted delivery package plus coverage notes.
5. Verify the intended recipient and approved secure delivery destination before
   transfer. Record receipt and the return/deletion decision date. Securely handle
   temporary copies under the same exit inventory.

The approved target is a 30-day export opportunity after termination. This is a
support-led procedure, not a new self-service download button or a claim that
an export of the whole ServiceOS workspace has been rehearsed.

## Deletion and recovery-copy gaps

Active source versions, observations, pages and audit events intentionally have
immutable-row triggers. A normal delete is blocked. Removing a customer link,
disconnecting OAuth or banning an account does not erase the retained payloads.
No production trigger has been disabled and no deletion exception is installed.
A controlled, scoped procedure must be prepared and rehearsed against the full
schema before committing to active deletion within 30 days of agreed return or
deletion. It must cover raw and derived data, linked cards, storage objects,
TEST copies and local staging as applicable; preserve other tenants; record any
justified legal exception; and leave a minimal non-content completion receipt.

The database and recordings backup configurations have 30-day GOVERNANCE minimum
locks and no automatic expiry. Writer and Restore identities deliberately cannot
delete or bypass retention. The whole-project database snapshot is not a
per-tenant export; individual tenant records cannot be removed in-place from an
existing encrypted archive. Do not destroy shared recovery coverage to satisfy
one tenant's exit. Before promising recovery-copy removal within 90 days after
active deletion, prepare a version-by-version inventory, replacement/recovery
plan where needed, and an approved pruning mechanism after locks expire. Include
Supabase-managed backups, AWS versions, local archives and delivery staging.

A restore must reapply recorded deletion instructions before the restored data
becomes available to users or capture resumes. A runbook alone is not evidence
that pruning or restore-time suppression runs successfully. Actual irreversible
purging and any access/retention changes remain separate reviewed operations.

## Publication status

QuickBooks-only export preparation is verified locally. Whole-ServiceOS return,
active deletion and all-copy removal are not yet accepted. The approved legal
sources remain unchanged and unpublished; the private agreement remains unsigned.
