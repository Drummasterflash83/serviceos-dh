# Team workload from observed ownership

Local implementation verified on 10 October 2026. The team workload collector is
**not installed in hosted TEST or production**. The current protected TEST frontend
remains the separate team-card/scoring-scope release recorded in
[DEPLOYMENT](../DEPLOYMENT.md). This collector and its frontend must ship together.

## Meaning and collection

Team rules can include `work.team_owned_item_minutes`, unit `item_minutes`, source
`serviceos.work.team-residence@1`. The new template has zero weight until the owner
chooses criteria. An owner/admin can collect for the exact saved policy revision,
team and completed period, with a reason. The browser submits scope and request
identity only. The server calculates the value and appends an inferred observation;
human confirmation/dispute remains separate. No pay action occurs.

The measure sums elapsed time per retained work item from direct team assignments
and the observed team affiliation of the responsible member. An item contributes
once per segment. Two simultaneous items each held for an hour contribute 120
item-minutes. All states, including waiting and closed, are included. This is an
ownership-load measure, not hours worked, response speed, productivity, first-time
fix rate or an average of individual scores. Calendars, approved delays, complexity
and job-outcome calculations remain separate work.

The population is all retained intelligence objects in the company, rather than
only currently assigned or open work. Coverage/sample counts are examined work
items. Missing history or unresolved identity withholds the whole value; known
partial durations remain in the retained calculation proof. Explicitly ungrouped
members do not contribute team time. A complete known empty team's value may be
zero; an unknown population cannot become zero. Empty populations have no positive
samples and cannot pass the scorer's sample minimum.

## Historical attribution and evidence

The collector uses the existing work-history and whole-roster readers. Work
intervals split at captured work changes, observed membership changes, effective
membership dates and confirmation times. Member/user aliases resolve through the
existing historical identity resolver. The selected member's team comes from the
retained event at that segment, not their current directory row. A later transfer
cannot move earlier workload to a different team. Inactive, ambiguous or
unconfirmed identity withholds coverage. Team identifiers must still belong to the
company and must have a directory creation time no later than the segment start.
This does not reconstruct missing organisation history or detect every privileged
rewrite of source timestamps/identifiers.

`learn_team_work_measurement_runs` retains the team, actor, exact request, algorithm,
coverage, examined work/history IDs, credited intervals and the observed roster.
Member-attributed intervals identify the membership event; direct team intervals
have no member event. Existing member receipts remain unchanged. The new ledger
is owner/admin readable within the tenant, with no direct client/service writes,
updates, deletes or truncation. The collector shares the actor profile lock and
View-As denial pattern used by the existing collectors. Team-specific policies
must match the exact team. Request and cell locks preserve retries and reject a
second independent observation of the same cell.

The proof and observation append atomically. An append failure leaves neither.
The migration extends only the current performance append function's exact source
allowlist, retaining its other deployed guards. It refuses an unexpected evidence
contract rather than replacing the append implementation. New evidence is read by
the card's measurement parser and retained-proof reader; a member receipt contract
cannot be passed off as a team receipt. Proof is never silently shortened.

Limits match the existing manual residence collector: 366 days, 2,000 retained
objects, 5,000 work events, 10,000 attribution segments and 1 MiB proof, plus the
existing roster reader limits. Exceeding a limit aborts the whole operation. Larger
populations need resumable source snapshots. This calculation consumes retained
history; it does not enable any communication capture or make provider requests.

## Verification and next release

- Forty focused card/collector/measurement/review/scorer tests pass.
- Disposable offline PostgreSQL 17 with a schema-only local clone passed existing
  member collection regressions, team migration rollback, direct and member team
  ownership, alias changes, transfers, later-transfer stability, membership expiry,
  known ungrouped/empty teams, missing capture, late directory identity, exact retry,
  duplicate cells, team-specific policies, foreign tenant/team rejection, viewer
  revocation, View-As, immutable proof and append rollback.
- Two real database sessions collecting the same team cell yield one observation;
  the earlier member race also remains passing. The initial team race harness had
  an invalid synthetic login UUID; correcting that fixture allowed the race to run.
- Actual SQL measurement/review/proof output passes the production card parser,
  scorer and evidence reader. An unreviewed observation remains unassessed; the
  separately confirmed synthetic observation can support a draft simulation.
- App and preview TypeScript checks/builds pass, including 47 app prebuild checks.
- Actual synthetic browser collection requires a reason, displays 120 item-minutes
  as inferred/unassessed, opens the retained proof, and withholds value/score for
  incomplete coverage. No console errors were observed. This does not establish
  signed-in hosted acceptance or real employee performance.

```sh
python3 scripts/verify/learn-team-work-residence.py
node --test src/lib/learn-work-collection.test.ts src/lib/learn-performance-measurements.test.ts src/lib/learn-performance-reviews.test.ts src/lib/learn-scorecards.test.ts src/lib/learn-cards.test.ts
```

The source migration is `20261101080000_learn_team_work_residence.sql`. Next: pin
an additive release against the current TEST 047 catalog, verify preservation of
all current source/scoring/assessment datasets and append guards, rehearse rollback,
install the paired backend/frontend, and complete fresh signed-in owner acceptance.
Do not deploy the new frontend before the collector exists. The pending Commusoft
continuation scope/access and all existing credentials remain unchanged.
