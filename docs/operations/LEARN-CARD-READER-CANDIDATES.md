# Customer-card communication reader candidate

Status: installed and verified LIVE on 14 October, 00:08–00:09 BST.

The paired management-API probe improved from 5,625 ms to 639 ms with an identical
two-row response digest. Two signed-in LIVE refreshes showed both emails and the
two linked Commusoft jobs without the communication-read warning. Owner resolution
and the completed-work brief remain separate unfinished work. This is one measured
customer journey, not a latency guarantee or full provider-coverage claim.

The exact apply and inverse rollback passed the full-schema rehearsal, including
five failure/drift guards and all sixteen journeys. The LIVE client wait timed out
at 75 seconds; no mutation was repeated. Independent catalog reads confirmed the
committed definition, exact ownership/grants, original role membership and unchanged
dependent helpers. The atomic transaction checks all 22 named data tables and
access/schedules before commit. Its individual table-count/digest receipt was not
returned to the runner; this limitation is retained in the evidence.

[Live evidence](evidence/learn-card-reader-live-2026-10-14.json) ·
[Exact apply/rollback package](../../supabase/release/learn-card-reader-candidates/manifest.json).

The LIVE reader intermittently failed for an existing person card, then succeeded
on refresh. Both saved emails remained intact. Management read-only probes returned
two valid rows in approximately 4.7 and 6.7 seconds, near the authenticated role's
eight-second statement timeout. This suggests performance sensitivity, but does
not prove the failed browser response was a timeout.

The existing SQL joins the Slack context helper before applying the combined direct
or reviewed-job relationship scope. This can inspect draft/source eligibility for
unrelated interactions. The migration materialises the helper once, builds a union
of direct and reviewed context candidate IDs, then reads only those candidates.
The final tenant, relationship, draft, status, excerpt and 51-row limit checks remain.
There are no source changes, user grants, policy changes, runtime or frontend changes.

## Verification

`learn-card-communication-candidates.assert.sql` runs in a rolled-back transaction
against a complete restored production schema. The harness supplies the exact old
reader as `verify_communication_reader_baseline`, with the same restricted owner
and authenticated execute access. The fixture compares person, overlapping person
and company, and explicit-ID results under a forced generic plan. A source-reader
fault injection rejects inspection of unrelated records: the prior reader triggers
it; the candidate does not. The existing draft, tenant/role isolation and reviewed
Slack context suites run unchanged as separate journeys.

The 16-journey networkless rehearsal passed. All archive COPY data and seven
sequences match; the temporary container was removed. Evidence is recorded in
[evidence/learn-card-communication-candidates-2026-10-13.json](evidence/learn-card-communication-candidates-2026-10-13.json).

## Completed release procedure (retain for operations)

1. Capture the current function definition, owner/ACL, role memberships and relevant
   source-preservation baseline. Reject drift from the rehearsed prior reader.
2. Build and rehearse an exact target/source guarded apply and inverse definition
   rollback. The function belongs to `learn_card_communication_reader`; preserve
   that ownership and its ACL. The existing deployer has administrative membership
   but not inherited membership, so the previously reviewed transactional deployment
   pattern must restore the complete original membership state before commit.
3. Install only the reviewed SQL; retain source records and all access checks.
4. Verify definition/access and source preservation, then use the existing signed-in
   LIVE customer session to check both jobs and both email entries, including
   repeat refresh. Compare read latency without claiming guaranteed performance.
5. Update the authoritative checklist with LIVE evidence. Keep the unrelated
   refresh frontend promotion gate separate.

Rollback restores the exact prior function definition and access within a guarded
transaction. It never rewinds source ingestion or removes published customer/job
links. Do not apply a historical whole-release rollback over newer retained data.
