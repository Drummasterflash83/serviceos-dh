# Reviewed context selection for learning

This release changes only the existing `intelligence_select_uningested` SQL
function. It does not enqueue work itself, change worker priority, grant access,
read new providers, change capture schedules or enable AI execution.

The production selector was oldest-first across 23,764 enriched interactions at
04:42 UTC on 14 October. Two newly reviewed public Slack messages were visible on
the customer/job timelines but absent from both single and batch ingestion jobs.
The scheduler and worker were progressing; restarting them would not fix ordering.

For a requested batch of N (clamped to 1–200), up to floor(N/5) slots now prefer
retained Slack context whose recorded review state matches both the interaction
revision and the current saved source revision. Deleted/removed interactions,
changed-source reviews and retained tombstones receive no preference. Remaining
slots keep the original oldest-first rule, with a UUID tie-breaker. Unused review
capacity returns to historical work; limits below five remain oldest-first.

Priority is only a scheduling hint. It is not a new review receipt, authorization,
claim that the message is true, or permission to expose it. Existing worker
eligibility, source checks, mapper ledger, observation evidence and execution
limits remain responsible for processing. No new messages, review links or source
attribution are created by the selector. The function remains SECURITY INVOKER
with the same postgres/service-role execution ACL, and uses a fixed search path.

## Validation and release

`python3 scripts/backup/rehearse_reviewed_ingestion_selection.py --output
.verification-results/<fresh-name>` restores the retained production archive into
an offline disposable database, installs the existing 21 release prerequisites,
and runs the exact guarded apply/rollback package as postgres. It verifies wrong
target/checksum rejection, rollback after an injected post-replacement failure,
quota/fairness, source changes, mapper ledger states, limits, tenant isolation,
unchanged execution authority, and preservation of all archived COPY data and
sequences. Fixtures roll back and the container is removed.

Hosted TEST currently lacks this activation selector. Do not install this isolated
patch there or describe its acceptance as a hosted TEST result. The migration
requires the original activation prerequisite; the production package also pins
its exact current definition and ACL.

Set `serviceos.release_target` to the reviewed project and
`serviceos.release_sha256` to the source checksum in `manifest.json` before applying
`apply.sql`. The reviewed executor pins every artifact and the passing rehearsal,
records an exclusive start journal, then checks deployed source/ACL, selected IDs,
retained source/review fingerprints and schedule fingerprints. An uncertain apply
must be inspected, not retried blindly.

Rollback uses the same target/checksum settings with `rollback.sql`. It restores
the exact original function only if the installed replacement and authority match.
It does not delete jobs already selected or observations already produced.
After promotion, inspect normally scheduled ingestion jobs for the reviewed IDs
and follow those exact handles to source-bound observation receipts. A successful
selector read alone is not end-to-end learning acceptance.
