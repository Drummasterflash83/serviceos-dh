# Interrupted numerical correction recovery

TEST database release 053 installed on 11 October 2026 at 05:03 UTC.
Paired protected frontend v24 is READY at 05:05 UTC. Production is unchanged.

The card previously kept an uncertain numerical correction only in component
memory. Reloading lost its request identity. The card now saves the exact value
(or explicit withholding), predecessor, expected review revision, reason and UUID
before contacting the server. One pending request is retained per signed-in actor,
company, card and backend. Recovery remains visible when dates change, a measurement
is superseded or the original query returns no rows.

The owner/admin can check status, retry the exact correction or cancel a pending
request. Checking never submits a correction. Only a verified recorded/cancelled
server response clears the browser request. A lost reply, unavailable storage,
changed identity, malformed response or access change keeps it unresolved. Browser
locks coordinate tabs; a different pending correction cannot overwrite the request.
Corrupt stored details are retained and block another correction until resolved.
Recovery is browser-local, not cross-device, and requires browser storage and Web
Locks. The retained reason and requested value are local browser data; no source
communications or credentials are copied into the recovery slot.

Migration `20261101170000_learn_correction_recovery.sql` adds a private immutable
cancellation ledger and the owner/admin `learn_performance_correction_resolve` RPC.
It checks the actual profile/company, rejects View-As and binds retained requests
to the original actor and exact payload. Anonymous and service callers cannot
execute it; no application role receives direct cancellation-table access.

Cancellation and correction acquire the same request lock. If cancellation wins,
a delayed correction cannot commit. If correction wins, cancellation returns the
original recorded receipt and preserves it. A stale review or superseded predecessor
can still have its uncommitted intent cancelled. Cancellation does not erase a
measurement, change a review, confirm a value or change pay. The existing correction
RPC retains its identity and authority; one guarded insertion checks the cancellation
ledger after original-receipt replay and before creating a new observation.

## Verification

- 46 targeted client tests pass, including eight recovery cases: numeric and withheld
  lost replies across reload, check/cancel behavior, terminal receipt validation,
  changed local intent, denied storage, closed/revoked scope, corrupt data, separate
  actor/company/card/backend slots, serialized tabs and failed clearing.
- Isolated PostgreSQL 15 runs the real correction/review bodies with synthetic
  dependencies. Cancellation, exact retry, stale-intent retirement, role/company/
  actor/View-As boundaries, private immutable ledger and original data preservation
  pass. Two real sessions hold the actual lock in each order: cancellation-first
  blocks correction; correction-first returns the retained result. Explicit rollback
  restores the original function definition/ACL and removes the new table.
- A network-isolated PostgreSQL 17 schema-only clone passes the actual member/team
  working-time collectors, numerical corrections and receipt guards with recovery
  installed. Recorded working-time correction resolution and cancellation of a stale
  request pass. No production/source rows, credentials or storage were cloned.
- Application/preview typechecks and builds pass. The rebuilt browser uses synthetic
  fixtures: an 80→90 correction with a lost reply survives full reload, can be checked
  without selecting the old dates, and retains exactly the original 80 plus the new
  inferred 90 with original source time. A separate failed-before-commit withholding
  request checks as pending and cancels, leaving the original 80 unchanged. Both
  paths report zero console errors; no real staff review or payment occurred.

Run:

```sh
node --test src/lib/learn-correction-outbox.test.ts src/lib/learn-performance-corrections.test.ts
python3 scripts/verify/learn-performance-corrections.py --recovery
python3 scripts/verify/learn-work-calendars.py --include-delays --include-working-time --include-working-collection --include-receipt-guards --include-working-corrections --include-correction-recovery
```

[Local evidence](evidence/learn-correction-recovery-local-2026-10-11.json).

## TEST release and remaining acceptance

The exact package passed rollback rehearsal at 05:02 UTC and installed at 05:03 UTC.
Its observed catalog matched the rehearsed fingerprint. All 101 monitored datasets
were preserved; the existing correction writer changed only by its guarded
cancellation check, retaining prior authority. No users, operator grants, provider
calls or production changes were made. The new cancellation ledger is empty at
installation. Eight hosted HTTP checks at 05:04 UTC verify denied anonymous/service
access to correction submission, status/cancellation and direct ledger reads.
These denials do not constitute positive signed-in acceptance.

[Rollback evidence](evidence/learn-correction-recovery-test-rehearsal-2026-10-11.json) and
[installation evidence](evidence/learn-correction-recovery-test-install-2026-10-11.json).

The frontend requires this database release because submission first calls its resolver.
Positive signed-in hosted acceptance, cross-device recovery, complete source
coverage and production promotion remain separate work. Source emails, calls,
recordings and existing assessment snapshots are unchanged by this candidate.

The paired frontend was built from backed-up Git commit
`1e4fc645d4b71e7ae7be8d4e29a0cfbc4092f53a` and reported READY at 05:05 UTC.
TEST backend binding, anonymous protection on homepage/login/client routes and
actual same-origin client/operator sign-in redirects pass, with zero console errors.
[Paired deployment evidence](evidence/learn-correction-recovery-test-2026-10-11.json).
