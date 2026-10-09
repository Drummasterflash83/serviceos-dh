# Elapsed owned item-minutes

Installed in TEST release 007 at 21:01 UTC on 9 October 2026, with successful
signed-in acceptance through the actual collection/card readers. Production,
communications and recordings were untouched; no baseline or historical backfill
ran. See [TEST capture release and evidence](LEARN-TEST-WORK-CAPTURE.md).

## Meaning and card flow

The company-wide member policy can now include `work.owned_item_minutes`, unit
`item_minutes`, source `serviceos.work.residence@1`. Settings offer this template
with zero weight. The customer must deliberately choose any weight and targets.
The existing working-desk-minutes template remains a separate, unconnected measure.

This measure sums elapsed ownership duration per retained intelligence object.
Two objects held concurrently for one hour contribute 120 item-minutes. All
captured states, including waiting and closed, are included. No calendar, holiday,
working shift, approved delay, work-complexity or outcome adjustment is applied.
It is a descriptive ownership-load measure, not employee working hours,
productivity, speed, completed jobs or a ready-to-use compensation criterion.
Those distinctions are shown beside the card's collection control and retained
in the calculation explanation.

Owners/admins collect evidence for the exact saved policy revision, member and
completed period with a reason. The browser sends only scope and request identity,
never durations or a confirmation decision. The database computes and appends an
inferred observation. Existing confirm/dispute controls remain a separate reviewed
step; publication does not confirm evidence. Missing coverage withholds the value
and score. A supported zero is possible only after examining the complete known
population and attributing no ownership to the selected member.

## Source calculation

`learn_work_residence_collect` reads the entire retained tenant intelligence-object
population, without filtering by today's owner, status or type. Objects inserted
after the period are excluded when insertion was captured. A captured insertion
within the period starts that object's existence; a baseline or first update does
not reconstruct its earlier existence or ownership.

The validated work reader supplies the opening state and ordered captured changes.
Intervals are clipped to the exact half-open period, then split at observed roster
changes, effective membership dates and confirmation times. Member/user references
resolve against observed membership at each segment's start. Unassigned intervals
add no person-time. Resolved team assignments add no individual time. Unsupported,
ambiguous, unconfirmed or inactive references withhold coverage rather than being
attributed using today's directory. The shared historical owner resolver also now
explicitly rejects a missing reference kind.

The immutable work-calculation receipt retains the algorithm, scope, actor, full
roster snapshot, examined objects/history IDs and credited segments with exact
timestamps, state, original owner reference, waiting-on reference and calculated
minutes. Known partial minutes remain inspectable while an incomplete aggregate
is NULL. Coverage and samples count examined work items, not hours or assignments.
PostgreSQL timestamp/numeric arithmetic preserves sub-second interval precision.

The receipt and measurement append are atomic. Exact retries reuse the receipt;
changed request identity and second independent observations for the same cell are
rejected. The algorithm identifier separates residence requests from earlier
handoff requests. The actual signed-in owner/admin profile is locked, foreign
tenants and active View-As are rejected, and retained receipt RLS remains in force.

## Verification and limits

Migration: `20261030010000_learn_work_residence_measurements.sql`, following the
existing performance, work-capture, membership-history and handoff-receipt layers.
Do not apply pending migrations blindly; target schema reconciliation and real
user/session acceptance are still release requirements.

`python3 scripts/verify/learn-work-residence.py` creates a disposable offline clone
of the existing local schema, with no copied data rows, credentials or storage.
Real capture triggers produce synthetic ownership histories. Assertions check
concurrent-item sums, same-person reference changes, all-state inclusion, clipping,
known zero, membership endings without a work event, missing history, retry and
cross-adapter identity, tenant/viewer/View-As denial and append rollback. Two actual
database sessions collecting the same cell retain exactly one observation.

Twenty-four focused collection/history tests pass, including complete proof
display, exact residence source/unit routing and malformed scope rejection. Main
and preview TypeScript/build checks pass. Browser testing confirmed required reason,
120 synthetic item-minutes remaining inferred/unassessed and readable retained
proof. These checks do not establish live source coverage or fair employee ratings.

Bounds: 366 days, 2,000 retained objects, 5,000 returned work events, 10,000 attribution
segments and a 1 MiB proof, plus the existing roster/per-item reader bounds. Exceeding
limits aborts the whole collection. Pre-capture/deleted history and privileged
capture bypass retain the limitations documented in the work and membership readers.
Larger populations need resumable source snapshots. Historical team-policy scoring,
calendars, exclusions, workload normalization, numerical correction and saved
assessments remain outstanding; no payroll automation is implemented.
