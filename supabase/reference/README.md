# Hosted integration references

`learn-email-storage-test-2026-10-10.json` records the TEST `email_messages` and
`email_threads` contracts read at 14:33:27 UTC, their update-timestamp helper and
the service table grants checked during this storage implementation. It contains
no message rows or credentials. The local page-store fixture reproduces their
columns, constraints, indexes and update triggers, with the observed service
permissions; client reader policies are omitted. This is a schema reference,
not a database backup or evidence of production parity.

`learn-email-job-test-2026-10-10.json` records the TEST `platform_jobs` table
contract at 14:14:33 UTC. It supplies the exact columns, constraints and indexes for
the local email job/attempt fixture; it contains no queue rows. The fixture omits
the unrelated update-timestamp trigger. This reference is not a deployment or
full database restore package.

`learn-email-ingestion-test-2026-10-10.json` records metadata read from the existing
TEST project `saatxzwxvdvqevbnskxy` at 13:56:40 UTC on 10 October 2026. It contains
13 function definitions and execution grants, four email table contracts, protocol
role/table/column grants, and the installed Edge function inventory. It includes
queue and Slack claimant definitions needed when adding capture controls. The
phone pipeline view is absent in this snapshot.

This is reference material, **not an executable migration or full restore
package**. It omits many transitive dependencies, role memberships and unrelated
grants. It contains no mailbox contents, tokens, provider credentials or customer
records. Definitions were read through the management API's read-only database
endpoint; no workers were invoked. The corresponding hash and limitations are in
[`learn-capture-runtime-audit-2026-10-10.json`](../../docs/operations/evidence/learn-capture-runtime-audit-2026-10-10.json).

The email worker integration must preserve these existing behaviors:

- A sync attempt starts as a tenant/account-bound running `email_sync_runs` row.
  Terminal writes and account progress go through the protocol owner functions.
- `email_ingestion_transition_v2` fences each change by generation, revision and
  owning attempt. Each transition has a fixed identity and frozen request. Lost
  responses are recovered through `email_ingestion_transition_result_v2` or the
  same transition; never invent a new transition to resolve an unknown outcome.
- Recent and historical capture have separate checkpoints. Recent capture retains
  its captured boundary and both INBOX/SENT continuations. Its history cursor moves
  only once the traversal completes. A yielded page can finish an attempt
  successfully without establishing full coverage.
- Explicit recovery and restart operations are distinct from ordinary claiming.
  Force/reconciliation policy and expired continuation rules must be retained.
- `platform_jobs_complete_email_v1` binds completion to the current queue lease
  and the ingestion evidence, retaining a completion receipt and any continuation
  job atomically. The generic local worker has not yet been reconciled with it.

The local mailbox handlers still use older direct progress writes. Do not deploy
them against these guards or remove the guards to make them work. First adapt the
workers and exercise this observed protocol in an isolated database; then prepare
a coordinated TEST release. This reference does not establish production parity.
