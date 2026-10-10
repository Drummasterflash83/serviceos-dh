# Slack thread recovery

Local implementation, 10 October 2026. This adds reviewed recovery of an existing
incomplete thread window, with a locally verified recovery screen and durable
browser requests. It has not been installed in TEST or production. TEST remains
release 020 and Slack worker runtime v4.

## Retained approval chain

The new `learn_slack_resume_thread` RPC creates a new immutable thread approval and
one queued job atomically. It retains the original company, account, workspace,
channel, observed parent and time bounds. Continue carries forward the saved
provider cursor; restart starts the same approved window again. Both grant a fresh
1–10-page budget and renew the approval for 24 hours. Page counts describe the new
approval, not lifetime coverage. Neither mode deletes messages or earlier approvals.

The previous scope and checkpoint are saved in the new definition alongside its
predecessor ID. Older approval rows remain unchanged. Each predecessor can have
only one direct recovery, enforced by a unique index. A later initial approval or
recovery for the same window supersedes an older review. Completed, active,
superseded, malformed or unavailable windows cannot be recovered.

The existing thread worker consumes the new approval through its current stored
scope, claim, credential, pacing, publication and completion contracts. No worker
source, credential resolver or schedule is changed. Replaying retained messages
uses the existing source/version deduplication. Finishing a thread window still
means `observed_thread_window`, not complete Slack or company coverage.

## Authority, concurrency and safe progress

`learn_slack_thread_recovery_read` provides company-scoped progress with a review
fingerprint, parent timestamp, approved bounds, current-approval page count, queue
status, predecessor and superseding approval IDs. It excludes provider cursors,
private scope keys, job payloads and credential references. Company viewers can
read this state; eligibility flags do not grant them approval authority.

Approval requires the actual company owner/admin outside client preview, under the
existing roster/authority locks and read-committed isolation. The RPC rechecks the
review fingerprint after locking the relevant connection, account, connector and
approval. It shares the original thread window's advisory lock, so competing
initial/recovery approvals cannot silently replace each other. Workers already
publishing or finishing a page retain their import lock; active work refuses
recovery. Connection or progress changes require a fresh review.

A request ID belongs to one actor and exact reviewed request. An identical retry
returns its retained receipt even after later progress or approvals, with authority
rechecked first. Changing the request identity conflicts. Inserting the job and
approval is one transaction; queue failure leaves neither a partial approval nor a
changed predecessor. The migration adds three functions and two indexes, with no
new table grants or changes to existing worker definitions.

## Application adapter

`src/lib/learn-slack-thread-recovery.ts` reads and validates the company/account/
import-bound contract and prepares exact recovery RPC requests. It rejects
contradictory eligibility, malformed windows and mismatched receipts, and strips
unexpected private fields. Definite invalid/conflict/unavailable responses are
separate from uncertain network/unknown responses that require the same request ID.

`LearnSlackThreadRecovery` exposes this review from each recorded thread import.
It shows the original parent/window, approval-specific page budget, expiry and queue
state. Owners/admins can continue or restart eligible windows with a reason; viewers
can inspect progress. Completed and active windows have no approval form.

The dedicated thread-recovery outbox saves and reads back the exact request before
sending, scoped to backend, actor and company. Web Locks serialize submissions in
the same browser. Uncertain responses, failed reads and full reloads retain the
request for exact retry; a matching receipt clears it. Only a definitively rejected
review offers explicit local clearing. Selecting another thread cannot overwrite
an unresolved request. Authority and mounted/active state are checked again after
waiting for the lock. Stored fields exclude provider cursors, message excerpts,
credentials and raw payloads. Browser data must be retained until resolution; this
does not provide cross-device recovery.

The synthetic browser preview verified lost-response persistence through reload
with unavailable progress reads, exact retained retry, restart with a fresh page
budget, rejected-review clearing, selection protection, viewer inspection and
completed-window restrictions. No console errors were captured. All 46 focused
Slack tests, application/preview typechecks and both builds passed. Seven new outbox
tests cover storage failure, account isolation, competing locks, authority changes
and uncertain outcomes. Actual two-tab browser contention was not exercised; its
coordination has unit evidence. The preview keeps its original thread-list fixture
after recovery; the recovery panel reads the new synthetic approval. Hosted list
refresh and actual signed-in acceptance remain to be tested.

See [UI verification evidence](evidence/learn-slack-thread-recovery-ui-local-2026-10-10.json).

## Verification

Thirty-nine focused Slack client/outbox tests passed, including six new thread
recovery tests. The new client's strict typecheck and the application typecheck
passed. Actual responses from the isolated SQL functions were passed through the
application reader and receipt validator, including original/superseded progress,
new queued progress and an exact retained retry.

The network-isolated PostgreSQL 17 runner rebuilt the recorded foundation and
Slack release chain through channel recovery. It verified migration rollback,
unchanged existing functions/table metadata except the two intended indexes,
company/viewer/preview boundaries, renewed expired consent, cursor/bounds retention,
message/version deduplication, exact retries, active/stale/completed/superseded
refusal, restart, queue-failure rollback and retained communications. Controlled
transactions covered owner revocation, connection revision changes and competing
reviews that queue only one recovery. Synthetic expiry was advanced with the
approval-immutability trigger restored immediately afterward; this is protocol
verification, not an elapsed-day provider run. The disposable container was removed.

Initial local runs stopped on test-harness issues: comparing observation timestamps,
including newly added functions in an unchanged-function comparison, and inheriting
a disabled/paginated fixture without its verification-table grant. The corrected
checks compare stable metadata, require exactly three new functions/two indexes,
and explicitly prepare the synthetic fixture. These were local-only failures.

Reproduce:

```sh
node --test src/lib/learn-slack-*.test.ts
python3 scripts/verify/learn-foundation-release.py --rules --conflicts --measurements --work --actions --slack --slack-worker --slack-threads --slack-operator --slack-pacing --slack-history-resume --slack-thread-resume
node scripts/verify/learn-slack-thread-client.mjs .verification-results/learn-thread-recovery-sql-client.json
```

See [structured local evidence](evidence/learn-slack-thread-recovery-local-2026-10-10.json).
The local database uses a recorded schema projection and synthetic Auth identities;
it is not exact current TEST release acceptance or real Slack access. The recovery
UI is verified separately with synthetic fixtures; pinned release packaging,
hosted rollback/install and actual signed-in acceptance remain required. No live
source read/write, provider fetch, credential
change, hosted deployment, schedule or production mutation occurred in this step.
