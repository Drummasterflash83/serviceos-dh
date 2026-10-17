# Build 01 job attention and scorecard draft

**For Chris's business review; not published as a scoring policy.** Chris chose
job progress and completion as the first LIVE priority, with customer and team
cards serving different questions. A card should surface for the person who can
act, then move to the next person only after a verified handoff. The current
LIVE source relationship audit at 15:31 UTC on 16 October found 295 recorded
open/pending/on-hold Commusoft jobs, ten with reviewed published job links and
285 without them. Twenty-nine of the 295 also lack a retained customer/site
source record. These counts are timestamped observations, so a company-wide
job score would be misleading.

On 17 October Chris chose a **representative, source-backed Build 01 review**
instead of requiring all 255 retained-source identity cases to be reviewed
before sign-off. The remaining cases must stay visible, unlinked and unscored;
this is a review boundary, not permission to infer a customer, assignee or
healthy job state. The representative check covers these distinct real paths:

| Path | LIVE evidence needed | Current result |
| --- | --- | --- |
| Reviewed job link | A saved current-source job card shows its recorded status and observation time. | Ten recorded open jobs have reviewed links; aggregate latest-source check passed. A signed-in example of this path remains to be recorded. |
| Retained direct-customer and site-to-customer source, identity unreviewed | The source-job review view keeps both kinds visible without attaching an unreviewed customer or publishing a score. | Counts-only read found 169 direct and 86 site-to-customer cases; a signed-in unresolved-source example and the 285-case review filter passed. The distinct site path needs a signed-in example. |
| Missing parent source | The job stays in source review, with its recorded observation time and an explicit missing-source reason. | Twenty-nine cases remain unlinked; direct provider GET returned 404 for all 19 distinct missing parents. The signed-in review view needs a specific missing-parent example. |
| Recorded completion | A completed source can be inspected without an inferred completion instant or elapsed-time score. | Bounded direct-provider sample confirmed one recorded complete status but no explicit time zone; signed-in card evidence remains to be checked. |
| Named human handoff | A confirmed Owner / MD identity receives and accepts one source-linked OpenFolk review task, with an audit trail. | TEST/LIVE controls and UI are released; signed-in confirmation, task creation and acceptance remain open. |

The above is an acceptance sample, not a random estimate of the unreviewed
population. Chris's choice does not change the **255 identity-review, 29
missing-parent, and one job-link-review** obligations; the operator view and
ongoing review process must continue to expose them after Build 01 sign-off.
[Counts-only breakdown](evidence/learn-build01-open-job-review-reasons-2026-10-17.json).

A second aggregate read at 22:31 UTC still found **295** retained open,
pending or on-hold jobs, **10** with reviewed job links and **285** without.
Of the 295, **272** had no observation within the previous day. The recurring
changed-job lane is enabled and completed ordinary jobs windows at 22:06 and
22:21, but those windows do not re-observe every unchanged job. The source-only
cards should continue to show each record's actual observation time and avoid
describing an old status as current provider progress.

A further 17 October 10:29 UTC read-only shape check covered all **12,732
retained job versions**. Every saved `links` object contained only `self` and
`property` keys; the only assignment-like top-level keys were `userGroup` and
`userGroupID`. No appointment or technician link was present in the retained
job payload. This rules out an assignment shortcut through existing job
links; it does not prove the provider lacks a separate appointment API.
[Aggregate receipt](evidence/learn-build01-commusoft-job-links-shape-2026-10-17.json).

At 06:50 UTC on 17 October, counts-only LIVE readback found **69 recorded
on-hold jobs** and **285 recorded open jobs needing source or identity review**.
The existing audited source-job reader now supports exact filters for those
two groups. The narrow frontend view is now served by all four LIVE aliases
from production Git `77a73802`. A signed-in Drummonds check returned 69
recorded-hold matches and 285 source-review matches with actual row observation
times and clear status caveats. Named-person handoff remains outstanding.
The 272 jobs without an observation in the previous day must retain their
source timestamp and must not be presented as current provider status.
[Readback](evidence/learn-build01-job-source-attention-2026-10-17.json).

At 07:26 UTC, a second aggregate-only LIVE readback confirmed all **1,004**
published jobs point to their latest effective retained source version. Among
all **12,656** retained job payloads, the only assignment-like keys were
`userGroup` and `userGroupID`, present on every job. No individual assignee or
appointment field was found in this saved job collection. That confirms the
current source can support a shared review queue, but cannot independently
support the proposed named-person handoff. The separate appointment/task
source and reviewed member mapping remain necessary; a group ID must not be
treated as an individual. [Aggregate receipt](evidence/learn-build01-commusoft-coverage-2026-10-17.json).

## Source-backed attention states

| Saved evidence | Card treatment now | Requirement before assigning an individual or calculating a score |
| --- | --- | --- |
| Latest retained job status is `on_hold` | Put in the owner/admin **relationship review** queue with its source status and observation time. Do not imply a named technician is responsible. | Confirm the job/property/customer link, current provider status, hold reason and actual appointment/assignee. |
| Latest retained status is `ongoing`, `Open` or `pending`, but the job is unlinked or its linked source version is older | Surface as **needs source review**, without a customer-health deduction or invented due date. | Review the exact current job source, property and customer identity, then refresh its published card under the existing guarded workflow. |
| Retained source says `completed` but completion time lacks an explicit zone or closure meaning | Show **recorded complete** and the unresolved timing qualification. | Confirm the provider/account time zone and lifecycle meaning before computing elapsed time, late completion or a completion-quality score. |
| An existing published card has a current, reviewed source link | Show its saved status and observation time; allow a human to inspect original evidence. | Current provider coverage and accepted policy are still needed before a LIVE score is published. |
| Source is absent, contradictory or capture is stale | Show an **evidence gap** and route it to operator diagnostics. | Reconcile the source, do not substitute a healthy or complete state. |

These are review priorities, not a ranking of employee performance. A source
`businessUnit` or `userGroup` is not a named assignee. Commusoft's appointment
relationship and a verified source-user-to-OpenFolk member mapping are needed
before a job can appear at the top of a particular member's queue or move to
the next member. Individual/group Slack DMs remain excluded as evidence.
The [documented read-only `GET /scheduledActivities`](https://developer.commusoft.com/list-scheduled-activities-31575938e0)
response also has explicit
office-task assignee IDs and optional job links. Those could support a separate
task-attention queue after source capture, current-state checks and an ID-based
member mapping. They do not establish who owns the job or its technician
appointment; the provider contract and Drummonds data still need verification.
The [current published Commusoft API guide](https://developer.commusoft.com/key-concepts-and-relationships-1985291m0)
defines appointments as job-linked technician time slots, but its public
endpoint menu does not show a list-appointments route. This is a documentation
finding, not proof that Drummonds cannot provide appointment data. The
[scheduled-activities list](https://developer.commusoft.com/list-scheduled-activities-31575938e0)
is explicitly for office/manager tasks; using its assignee as a job engineer
would misstate the source. An audited OpenFolk review-task handoff can route
human attention independently of Commusoft's current appointment assignment,
provided it is labelled as such and never presented as provider-derived job
ownership. Chris approved this product distinction and chose the existing
Owner / MD login for the first confirmed-person handoff. No LIVE review task
or member confirmation has been created yet.

The official [direct job GET](https://developer.commusoft.com/jobs-24695919e0)
documents `usersCurrentlyAssignedToJob` and completion/closure timestamps.
A 17 October bounded LIVE read of one completed, one on-hold and one ongoing
job found the assignment array present but empty in all three responses.
All three current statuses matched their retained status; neither completion
nor closure timestamp carried an explicit zone in this sample. This makes the
direct endpoint worth separate source investigation, but does **not** support
an engineer assignment or elapsed-time score for these jobs.
[Content-free sample](evidence/learn-build01-commusoft-direct-job-shape-2026-10-17.json).

The 17 October 11:53 UTC counts-only handoff audit found eight active
Drummonds roster entries but no confirmed member, signed-in confirmed
recipient or signed-in member with confirmed `work.assign` authority. The
existing Directory → Roster flow can confirm a formal title, which is a
different fact from confirming the person and granting work-assignment
authority. A named OpenFolk review-task handoff therefore requires a real
member confirmation and authorized assigner first; selecting one of the
proposed entries would bypass the existing work-transition guard.
[Read-only audit script](../../scripts/verify/learn-build01-job-handoff-readiness.mjs).

The 17 October 12:06 UTC exact readback linked Owner / MD to the Drummonds
owner login `chris@openfolk.ai`, roster version 1, with `confirmed_at` still
null. A separate member-to-login confirmation control and an exact-source
OpenFolk review-task creator passed an isolated synthetic database rehearsal.
The SQL controls were installed on TEST and LIVE with privilege/ledger
readback; the Control Plane route was installed at TEST v28 and LIVE v38. A
read-only source comparison confirmed LIVE's newer View-As guard was unchanged.
Unauthenticated hosted write probes returned `missing_auth` on both projects.
The frontend is now READY on TEST `6bdf59e7` and LIVE `702408a4`, with exact
backend and existing alias/protection readbacks. A signed-in positive handoff
still needs to be performed. Browser auto-review denied origin-wide LIVE
access; no member confirmation, task creation or work assignment was inferred
from the UI release. [Release receipt](evidence/learn-build01-handoff-frontend-release-2026-10-17.json).

## Proposed first scorecard boundary

The first publishable job scorecard should measure only reviewed job progress
and completion with a defined period, eligible population, source freshness,
sample count, exclusions and original evidence links. A numeric score needs
Chris-approved weights and anchors, current provider status, reliable completion
time/zone, and a representative linked population. It must stay **unassessed**
while any required input is absent. Team/member scores additionally need
reviewed appointment and handoff identities; customer health is a separate
policy, not an average of job or communication counts.

Before publication, demonstrate on LIVE that a held job surfaces to the right
review queue, a reviewed handoff changes the responsible recipient, completion
appears with its timing qualification, and pausing/revoking a source removes
unsupported status claims. Chris can then approve or change the concrete
criteria and final business outcome. This draft does not activate a score,
change tenant access, send a notification or write to a source provider.
