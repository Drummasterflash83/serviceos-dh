# Continuing LEARN identity work around review holds

## Released 14 October 2026, 02:32 BST

An existing unresolved identity caused every subsequent identity batch to stop,
even if that batch saved valid customer cards. The selector already excludes held
revisions, so these review outcomes must not prevent unrelated work progressing.

The handler now distinguishes reviews recorded in the current batch from the
tenant's total unresolved reviews. A full batch of confirmed card deliveries and/or
durable review holds may continue. The current job remains `dead_letter` with
`identity_review_required` while any hold remains. Its warning, held source, pending
event and immutable receipts remain intact. No ambiguous match is approved.

The atomic settlement requires the exact live claim, distinct source publications,
the full bounded batch and matching counts. An unconfirmed delivery, incomplete
batch, reopened hold, expired/foreign claim or another failure cannot take this
path. Empty pending inventory stops. Parent settlement, one child and receipt are
atomic; an existing equivalent active child is reused. Lost replies inspect the
same request. This exception is confined to the fenced LEARN identity runner.

TEST worker v27 and LIVE v75 preserve their distinct prior source closures outside
`identity_resolve.ts` and `learn-processing-job.ts`. Downloaded compiled artifacts
match and missing-auth probes return HTTP 403. The SQL definition/owner/ACL checks
pass on both environments. No sources, grants, profiles, schedules or credentials
were changed by installation. Runtime preservation includes source IDs and retained
Slack-version hashes, all other functions, connections and secret metadata.

## Evidence and current acceptance

Twenty-one focused tests and TypeScript pass. The isolated full native schema
preserves 1,591,601 rows in 387 tables and seven sequences. Both the legacy queue
suite and new mixed/all-held/duplicate/lost-claim/atomic-failure cases pass, and all
synthetic transactions roll back without sequence drift. The exact guarded patch
and reversal also pass in the current hosted TEST schema. Two packaging defects
were caught and corrected before installation; their failed attempts left the old
TEST function intact and remain journalled privately.

At 01:32 UTC the scheduler's existing identity job is queued with zero attempts.
The runtime has been released, but a real continued batch is not yet accepted.
Observe that original handle; do not create a replacement because it waits.
The four reviewed Slack observation recovery jobs also remain queued.

[Release evidence](evidence/learn-identity-continuation-live-2026-10-14.json) records
the exact versions and hashes. Private runtime and recovery artifacts remain under
`/private/tmp/serviceos-identity-continuation-20261014/`; this local retention is not
an independent backup claim.

## Reproduce and reverse

```sh
node --test supabase/functions/_shared/worker_handlers/identity_resolve.test.ts supabase/functions/_shared/learn-processing-job.test.ts
python3 scripts/backup/rehearse_identity_continuation.py --output .verification-results/identity-continuation-fresh
```

The rehearsal needs the existing retained native archive and pinned Docker image.
It restores the exact first 21 production prerequisite packages in a disposable
container with no network, no host mounts and cron workers disabled. It does not
alter hosted data. The hosted TEST rehearsal separately covered the actual current
function definition and guarded reversal.

If rollback is needed, first restore and verify the exact prior compiled worker
(TEST v26 / LIVE v74 baseline) using the manifest's artifact and original entrypoint.
Only then apply the guarded SQL reversal with the correct project/source settings.
Reverting SQL while the new worker can still submit `reviews_recorded` would reject
its results. Preserve all committed records and queued descendants; no source or
receipt deletion is part of reversal. Neither rollback was executed in production.

This fixes queue progress only. It does not complete identity review, customer
publication, matching, scorecards, operator recovery UI or LEARN V1 acceptance.
