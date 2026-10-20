# One-page Commusoft source-user trial — release review

This is a **prepared, unexecuted** Drummonds LIVE procedure. Installing
`20261108130000_new_dawn_commusoft_users_trial_restore.sql` creates one
default-OFF, authenticated recovery RPC. It does not enable source-user capture,
pause ordinary capture, call Commusoft, create staff or change a login.

The existing OpenFolk operator input form can approve `GET /users` as one page of
at most 10 records. It stores those records as retained `users` source evidence.
Its `source_user_identity_review_required` projection state prevents them from
becoming OpenFolk staff or verified job assignees. No recurring users stage exists.

## Why a guarded trial is needed

The normal approval uses the same `connector_accounts` row as ordinary recurring
properties, jobs and contacts. If Commusoft says `hasMore: true`, the first job
finishes with `page_budget_exhausted`, but that account's cursor is incomplete.
The next recurring stage cannot start from an incomplete users cursor. A separate
account bound to the same configured connection is impossible without weakening
the account-key identity contract: the account key is unique under the one
Commusoft connector, and the worker requires it to match the connection.

## Exact bounded sequence

1. Verify the LIVE worker is the downloaded and independently checked v12
   executable closure, and verify the two installed source-user migrations and
   default-OFF flag. Run the new migration in a TEST transaction that rolls
   back, then release it with an exact ledger/readback review. Recheck that the
   function is executable only by authenticated operators.
2. Read only the Drummonds account, recurring row, existing flag and active
   source-sync metadata. Require an **idle completed cycle** (`phase=0`,
   `current_request=null`), active configured connection and no active job.
   The same conditions are locked and rechecked by `armSql` in
   `scripts/verify/new-dawn-m2-users-trial-gates.mjs`. The arm transaction
   records the exact prior approval/cursor in immutable audit, pauses the
   ordinary recurring scheduler and turns on only Drummonds' users flag.
   Read back the arm once. Never replay an unknown arm outcome.
3. In the signed-in OpenFolk operator form, select Drummonds' verified
   Commusoft connection and **Source users (held for review)**. Review one page,
   records per page 10, a short expiry and a specific reason. Apply once; use
   the saved request receipt if the browser loses its reply. No second page or
   continuation belongs to this trial.
4. Check only the exact job, source page, observation count, cursor and held
   source category. Do not expose raw user records in release logs or infer a
   person, engineer, appointment or login. Wait for the one page to settle.
5. Invoke `learn_commusoft_users_trial_restore` with the original arm ID,
   input request ID, signed-in actor and a reason. It requires the same account,
   connection and prior state, exactly one succeeded users page with at most 10
   observations, the matching immutable page receipt, no other account job, and
   the still-paused idle scheduler. In one transaction it restores the former
   account approval/cursor, turns the users flag Off, resumes ordinary capture
   after one minute and appends an immutable audit receipt. Repeating the exact
   request returns that receipt without a second write. Both `hasMore` outcomes
   are accepted: `collection_exhausted` and `page_budget_exhausted`.
6. Independently read back the flag Off, scheduler resumed, prior account
   approval/cursor, one retained users page, ≤10 observations and audit receipt.
   The retained page is **not deleted** by restoration.

If the source job is `dead_letter` with no committed page, the same RPC's
`abandon` action can restore after verifying that exact terminal state. If the
job is queued, running or retrying, or an outcome is uncertain, apply
`failClosedSql` once: it turns the users flag Off but deliberately leaves
recurrence paused and source/account history intact. Read back before any
further action. A live lease or changed cursor/approval is never overwritten;
inspect and settle that state before an `abandon` or `finish`. If restoration
itself fails, the flag remains Off and recurrence remains paused. There is no
automatic replay, inferred success or silent return to normal capture.

The disposable PostgreSQL check
`python3 scripts/verify/new-dawn-m2-users-trial.py --isolated` covers the
has-more and exhausted receipts, preserved evidence, paused scheduler, exact
idempotency, active job refusal, approval and cursor drift refusal, and
fail-closed behavior. The migration also compiled inside a rolled-back TEST
transaction. Neither check calls Commusoft.
