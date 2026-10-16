# Build 01 job attention and scorecard draft

**For Chris's business review; not published as a scoring policy.** Chris chose
job progress and completion as the first LIVE priority, with customer and team
cards serving different questions. A card should surface for the person who can
act, then move to the next person only after a verified handoff. The current
LIVE source relationship audit shows 279 saved active-status Commusoft jobs
without reviewed job-card links, so a company-wide job score would be misleading.

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
