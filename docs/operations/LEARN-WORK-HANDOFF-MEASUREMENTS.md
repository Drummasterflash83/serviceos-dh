# Recorded handoffs: the first connected work observation

## User flow and meaning

Company-wide member scorecard rules can include `work.recorded_handoffs`, unit
`handoffs`, source `serviceos.work.handoffs@1`. Scoring settings suggest it with
zero weight, like other templates; there is no automatic choice to reward more
transfers. This descriptive count is not response speed, quality, productivity,
completed jobs or hours worked.

When these saved rules are selected, the owner/admin card offers **Collect work
evidence** for the loaded completed period, with a required reason. The browser
submits only the exact member, policy revision, period, request UUID and reason.
The database calculates the observation from actual captured source history.
The result appears in the existing measurement/review panel as **inferred**.
Human confirmation/dispute remains separate and never changes the source row.
Draft rules still produce only draft simulations, and no payroll action exists.

An uncertain retry retains its request ID and reason. Repeating it returns the
original observation. A second request for the same cell is rejected instead of
creating competing counts. Refreshing source observations needs the still-pending
reviewed correction workflow; collection does not overwrite an earlier result.

## Calculation and retained evidence

`learn_work_handoffs_collect` is an authenticated owner/admin RPC. It locks the
actor's actual profile, rejects foreign tenant and View-As, and validates the saved
policy/source/unit. It reads the whole retained `intelligence_objects` population
for the tenant, without filtering by current owner, current status, or current
object type; those filters could hide earlier assignments. Thus the measure covers
recorded ownership transfers across retained intelligence objects, not solely
completed jobs or Action-class objects.

For each item it uses the existing validated work-history reader. A recorded
change of non-null responsible owner is a candidate; it must fall inside the
half-open period. Assigning previously unowned work or clearing an owner is not
counted. Historical member/user references resolve using observed membership at
the transfer instant; names/emails are not guessed. Member/user aliases for the
same person are not counted twice. Recipient team/org-unit references require an
existing same-tenant unit. An outgoing transfer is credited only when the resolved
previous owner is the selected member and the resolved recipient differs.

Baseline/first-update coverage cannot reach backwards. Proven database insertion
inside the period starts an item's existence; insertion after the period excludes
it. Missing item history or potentially relevant unresolved identities withhold
the aggregate value (`null`, never zero). Existing captures and the membership
reader retain their documented privileged-bypass limitations. Earlier deleted
records and pre-capture history are not reconstructed.

Coverage counts and sample counts refer to retained work items examined, not
messages, employees, handoff events or hours. `knownHandoffs` in the proof can show
partial observed transfers while the measurement value stays withheld. An empty
population has zero samples and cannot pass the scorer's positive sample minimum.

An immutable `learn_work_measurement_runs` receipt retains algorithm identity,
request/actor, coverage, item/event IDs, credited transfers and the membership
snapshot used for attribution. It and the existing `learn_performance_append`
write occur in the same transaction. Failed append leaves neither a partial
receipt nor an observation. The append contract gains one tenant-checked evidence
source; other existing source/subject/policy and objective-isolation rules remain.
Owner/admin RLS protects the receipt. Source drill-down displays its explanation
and complete retained JSON proof without silently shortening the proof.

Collection is bounded to 366 days, 2,000 current objects, 5,000 period work events
and a 1 MiB retained calculation proof, in addition to existing per-item and roster
reader limits. Exceeding a bound fails the entire collection. Larger companies or
histories need resumable population snapshots before this manual path can serve
them; do not split the population and call a partial result complete.

## Validation and deployment limits

- Twelve focused collection/measurement/review/evidence tests pass.
- A schema-only clone of the existing local Supabase stack runs offline with
  synthetic tenants, members and objects. Real trigger-captured changes flow into
  a saved inferred measurement and then a separate human review. Tests cover
  same-person reference aliases, exact retries, duplicate cells, foreign/viewer
  rejection, private/immutable proof, incomplete history and downstream rollback.
  Two real database sessions collecting the same cell produce one observation.
- Application and preview TypeScript checks and preview/production builds pass.
  The production build includes the existing 47 prebuild checks.
- Browser review uses only synthetic data: required reason, collection/reload,
  inferred state, retained proof drill-down, and incomplete coverage withholding
  the value/score. No console errors were observed. Browser testing does not prove
  live RLS, deployed migration compatibility or real employee-data acceptance.

The additive migration is `20261029230000_learn_work_handoff_measurements.sql`.
It requires the existing performance/review, work-capture and member-history
migrations. TEST release 007 installed the collector and forward capture at
21:01 UTC, with successful real signed-in acceptance through the card reader. No
production deployment or historical baseline ran; emails, calls, recordings and
connections are untouched. See [TEST capture release](LEARN-TEST-WORK-CAPTURE.md).

Prospective policy publication and the separate [elapsed ownership observation](LEARN-WORK-RESIDENCE-MEASUREMENTS.md) are also installed in TEST.
Remaining work includes numerical correction,
historical team-policy observations, team aggregation, desk/business-time and
response adapters, calendars/exclusions, work complexity and quality measures,
large-population collection, source reconciliation and verified deployment.
