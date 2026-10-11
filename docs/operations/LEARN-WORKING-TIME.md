# Working-time calculation for LEARN cards

Local private calculation candidate, 11 October 2026. **Not deployed, not connected
to resumable collection or scorecard settings, and not a live performance measure.**
TEST remains release 049. This advances the integration of captured ownership,
[published company calendars](LEARN-WORK-CALENDARS.md) and
[approved delays](LEARN-WORK-DELAYS.md). No real data, scores, permissions or
production configuration changed.

## Meaning and calculation

The new `work-working-time-item@1` contract measures one retained work item for an
exact company, member/team, completed period, observation time and explicit set of
work states. It keeps the existing elapsed-residence measures unchanged.

For each verified ownership segment, the calculator:

1. Keeps elapsed ownership separately from time in the selected states.
2. Intersects selected-state time with the frozen published calendar windows.
3. Unions approved delay windows for this exact item, then subtracts the portion
   inside those opening hours and ownership segments once.
4. Retains the calendar, excluded and assessed windows beside the ownership and
   source-event references, with reconciled subtotals.

For example, the synthetic ten-hour member fixture has nine hours in selected
states, six hours inside opening hours, two hours of approved exclusions and four
assessed hours. Overlapping approvals, lunch, closed work states and delays outside
opening hours cannot inflate the excluded subtotal. Waiting alone excludes nothing.

The unit is `working_item_minutes`: elapsed time that work remained with the
subject inside company opening hours after the stated exclusions. It is not
hours worked, utilisation, speed, productivity or a pay recommendation. Concurrent
items remain separate items; their totals may exceed elapsed clock time. Employee
shift calendars, leave and absence policies are not implemented here.

Member and team attribution reuses the existing frozen ownership engine. Team
moves split a segment at observed membership boundaries. Direct team assignment
counts once. Current directory names and member score percentages do not determine
historical team attribution; ambiguous/unconfirmed identities withhold assessment.
The selected work states must be explicit and unique (1–50), with no default list.
They still need to be included in the saved scoring-rule contract and editor.

## Missing history and exact time

An absent or partially published calendar withholds the final value for an
eligible item. Explicitly published closed hours yield a known zero. Missing or
partial ownership/identity history also withholds the final value while retaining
known arithmetic for review. An item proven newly inserted at/after the exclusive
period end is ineligible, rather than unknown work before its creation.

PostgreSQL multiranges perform union, intersection and subtraction at native
microsecond precision. Exact elapsed/selected/calendar/excluded/assessed totals
are decimal integer strings. The displayed minute value is rounded once per item
to 12 decimal places. The eventual aggregate must sum the integer microseconds
across items and round once for the measurement; summing rounded per-item minute
values would introduce drift. Existing JavaScript millisecond interval routines
are not used to verify these boundaries.

The TypeScript proof verifier independently recomputes window intersections,
exclusions, totals, snapshot scope and incomplete-value withholding with BigInt
microseconds. It detects changed references, invented totals, overlapping ownership
segments, foreign-item delays and inconsistent calendar coverage. It verifies
arithmetic against the supplied frozen snapshots; it does not independently
establish roster/work provenance or turn supplied JSON into trusted evidence.

## Private integration contract

The migration adds four private functions and no table mutation or public RPC.
Anonymous, authenticated and service roles cannot execute the calculation helpers.
Only a future governed collector should supply their inputs, using the already
verified frozen-history reader, member history, team directory and snapshots.
The caller must retain those exact inputs as the evidence receipt.

Scope validation binds tenant, object, member/team, precise period, observation,
selected states, calendar coverage and per-item delay references. The result
retains source IDs, publication IDs, approval IDs and delay revision. Calendar
coverage must reconcile with its version intervals and missing periods. Delay
windows must equal the union of their retained approvals. Input/segment bounds
fail explicitly; item proof over 2 MiB is refused, never silently truncated.

The future resumable integration must:

- Freeze the work population, work heads, membership/team inputs, calendar receipt
  and each item's committed delay revision in the same database snapshot at begin.
  Do not infer frozen delay visibility from `recorded_at <= snapshot_at` during a
  later batch: an earlier-started transaction could commit after begin. Use the
  retained revision/head or materialised rows, and exclude later reversals/approvals.
- Retain the expanded calendar once per run and per-item delay snapshots alongside
  each result. Recompiling a timezone definition later is not an original receipt.
- Add separate member/team working-time metric/source identifiers and explicit
  state selection to saved rules. Keep all current elapsed/handoff meanings intact.
- Process bounded batches with exact retry/status/abandon recovery, preserve partial
  known evidence, and publish an inferred measurement only at verified completion.
  Human performance review stays separate from collection.
- Page the complete proof (including calendar, delay and ownership inputs), handle
  the new 2 MiB item bound explicitly, verify concurrent source changes and large
  populations, and complete owner browser/hosted acceptance before release.

## Local verification

`python3 scripts/verify/learn-working-time.py` uses the existing disposable,
network-isolated PostgreSQL 17 schema-only harness. No source rows, credentials,
hosted connections or provider calls are copied into it.

- Migration rehearsal and installation pass. Existing calendar, delay and resumable
  assertions, request races, authority restrictions and preservation checks pass.
- Fixed-clock member/team examples test state filtering, opening hours, overlapping
  delays, lunch/closed-state boundaries, team moves, direct assignment, ambiguous
  identities, absent/partial history and explicit closed hours.
- A five-microsecond assessed interval remains exact. Sub-microsecond input and
  over-limit windows are refused. Swapped scope, observations, invalid states,
  unrelated/duplicated approvals and inconsistent coverage are rejected.
- Actual calendar expansion feeds repeated New York and skipped London clock-hour
  cases (120 minutes and zero respectively). Actual retained local work/member,
  calendar and delay readers also feed the new private calculation successfully.
- Twelve actual SQL results pass the independent TypeScript verifier, including
  corrupted-result denials. Nine focused verifier tests pass. Together with
  existing delay/calendar/history/scorer tests, 81 tests pass; application TypeScript
  passes. No frontend changed or was deployed in this checkpoint.

[Verification record](evidence/learn-working-time-local-2026-10-11.json).
