# Slack recovered-page continuation

13 October 2026. The function correction is verified LIVE; the one retained
queued-child correction remains held after its exact guard refused changed state.

A successful recovered page previously copied its single-page recovery marker to
its normal successor. The authority guard correctly rejected that child because
the recovery receipt belongs to the parent. Successful settlement now omits only
that marker from the successor, retaining campaign/import scope, parent linkage,
priority, rate limits, budget and immutable settlement receipt. The exact recovery
authority guard remains unchanged.

The guarded function update preserves existing definitions/ACLs for related
functions. Offline full-schema journeys cover successor claiming, settlement replay,
foreign recovery denial, revoked authority, budget and 429 cursor preservation.
The separate synthetic queued-child repair also passed, but its LIVE transaction
refused `Retained receipt-linked continuation changed`. A readback confirms no
queued-child mutation: zero attempts and the original marker remain. Diagnose the
specific live mismatch before preparing any new repair; do not blindly rerun.

All 8,840 source identities and immutable source versions observed at application
were preserved. Access, schedules and campaign bounds remained intact. No runtime
or frontend release was needed. Other Slack history/reply jobs continue; hidden
tombstone handling remains a separate unresolved source-withholding requirement.

Release SQL and rollback: `supabase/release/learn-production-patches/slack-recovery-continuation-v1/`.
Rollback restores the function only, never rewinds processed pages or sources.
[Sanitised evidence](evidence/learn-slack-recovery-continuation-2026-10-13.json).

## V2 retained-child repair verified LIVE — 13 October, 16:46 BST

The first refusal was execution context, not source/receipt drift: the management
connection had no infrastructure claim role. The exact parent authority function
requires that role. V2 keeps the postgres deployment role and sets only
transaction-local infrastructure claims, with no user identity or access grant.
Every original row/receipt/cursor guard remains intact. Ten clean-context
full-schema journeys passed, including late rollback and replay refusal.

The exact queued child is now verified claimable at zero attempts; its saved
cursor and parent receipt remain intact. All 9,037 source/version rows present at
repair, access, schedules and campaign scope/budget were preserved. Scheduled
provider acceptance remains to be observed. Both original refusal and corrected
execution journals are retained; never rerun either mutation blindly.

### Scheduled acceptance — 13 October, 15:46:09 UTC

The existing scheduler claimed the repaired child and completed it in one attempt,
processing five records. Its account now records three pages and history complete;
the immutable finish receipt has no successor. No manual dispatch was used.
Observed-thread discovery/reply completion remains a separate campaign stage.
