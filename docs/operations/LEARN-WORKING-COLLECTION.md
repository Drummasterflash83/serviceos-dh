# Working-time collection — local candidate

11 October 2026. Connected locally to scorecard settings, resumable collection and
retained-evidence review. **Not deployed. Hosted TEST remains release 049; production
and real provider data are unchanged.** This is an additive continuation of the
[working-time calculator](LEARN-WORKING-TIME.md), company calendar and delay reviews.

## Rules and meaning

The new member measure is `work.working_item_minutes`, source
`serviceos.work.working-time@1`. The team measure is
`work.team_working_item_minutes`, source `serviceos.work.team-working-time@1`.
Both use `working_item_minutes`. Existing handoff and elapsed-residence measures
keep their original identifiers and meanings.

A saved rule must name 1–50 distinct, trimmed work states. The editor supplies no
default state list and saves these with the rule revision. The server validates
subject kind, unit, source and states again. The browser sends collection scope,
request identity and reason; it does not send calculated values or override states.

Selected ownership intervals intersect published company hours, then subtract the
union of approved delays for each item. Concurrent items add separately. This
measures time items remained owned, not hours worked, productivity or pay entitlement.
Collection creates inferred evidence; confirmation and scoring remain separate.

## Frozen evidence and recovery

The existing begin/step/status/abandon RPCs admit `workingTime` and `teamWorkingTime`.
One database statement freezes the population, work heads, membership, teams,
expanded calendar and committed per-item delay revision. Later source changes,
approvals and reversals cannot enter a resumed batch. In particular, filtering only
by a decision timestamp is insufficient: an earlier timestamp can commit later.

Each step processes at most 100 items. New retained context tables hold the expanded
calendar and states once per run, and the exact history and delay snapshots per
item. Immutable triggers and scoped foreign keys protect these records. Exact
integer microseconds accumulate across batches; the final minute value rounds
once, to 12 decimal places. Missing ownership or calendar coverage withholds the
value. Missing calendar coverage also withholds it for an empty eligible population.

The original request is retained by the existing browser outbox. A lost response
stops further dispatch; status resolves the committed checkpoint, then the owner
can resume or end that request. Rules and dates changed on screen do not replace it.
Completed receipts can restore their original rules and dates for review.

## Owner evidence screen

The completed overview exposes chosen states and calendar coverage. Item pages
retain all result data and support continuation. A selected item can load its
frozen calendar, ownership history and delay decisions; independent TypeScript
arithmetic checks verify its windows, exact totals, scope and references.

The screen separates elapsed ownership, selected-state time, company-hour time,
approved exclusions and assessed item-time. Complete source JSON stays available
in a disclosure. Arithmetic verification does not independently establish source
provenance or confirm a measurement. Membership and source evidence remain reviewable.
Failed reads preserve the displayed evidence and allow retry.

Result pages contain at most 100 items and target 2 MiB; one maximum-sized item
plus its envelope can exceed that target slightly. Each retained result is bounded
at 2 MiB. Calendar context is bounded at 2 MiB. `workingItem` reads one item with
history and delay inputs, each bounded at 2 MiB (up to 4 MiB plus envelope together).
Excess input fails explicitly; no source proof is silently shortened. Hosted
transport acceptance at these bounds remains to verify.

## Verified locally

`python3 scripts/verify/learn-working-collection.py` builds a disposable,
network-isolated PostgreSQL 17 schema-only clone with synthetic records.

- Rollback rehearsal, installation, rule validation and immutable evidence checks.
- Member/team 205-item runs in 100/100/5 batches, exact retries and cancellation.
- Later reversal, changed ownership/membership and new objects excluded from the
  original receipt; exact aggregate reconciliation and preserved prior records.
- An actual uncommitted approval has an earlier timestamp than collection begin,
  commits afterward, and remains excluded from all resumed arithmetic.
- Two concurrent requests for the same checkpoint advance only once.
- Missing/partial calendars withhold values; original three collector kinds still
  run after the new migration and retain incomplete-history withholding.
- Viewer, foreign-owner and View-As RPC denials, tenant-scoped table reads,
  revoked direct writes and private helper execution permissions.
- 410 actual SQL result rows parse through the client. Six complete item input
  receipts pass independent arithmetic checks; altered results/aggregates reject.
- Browser: empty/duplicate state rejection, saved rule revision, 250-item member
  run, complete paging, failed input read/retry, reload and original-scope recovery.
  Team lost-reply recovery checks the committed checkpoint before resuming.

[Verification record](evidence/learn-working-collection-local-2026-10-11.json).

## Still required

Working-time volume/transport tests at the full company population, additional
begin/abandon and rule-change races, governed measurement-source/correction review,
paired hosted TEST deployment and signed-in owner acceptance. Real Drummonds
company hours and scoring states require deliberate configuration. This checkpoint
does not finish provider imports, voicemail, Slack activation, operational rollout
or production readiness for LEARN V1.
