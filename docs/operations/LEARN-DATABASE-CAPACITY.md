# Production database capacity — Small upgrade applied and verified

## Approved execution and recovery — 12 October 2026

Chris approved Small compute and the brief interruption in this thread. At
05:41:54 UTC, one journaled PATCH requested `compute_instance / ci_small` for
production only. Supabase returned HTTP 200 at 05:41:59 UTC. The subsequent addon
read confirms Small is selected. The project was first observed `ACTIVE_HEALTHY`
at 05:46:46 UTC, 291.545 seconds after the request; PostgreSQL started at
05:46:29 UTC. This is the observed operation duration, not measured service
downtime. The actual
production organization is `nmhqcjrjrtwsvlcvqqnh`, confirmed Pro immediately before
the request; the separate TEST organization was not changed. Price and 2 GB memory
matched the approved proposal. No automatic retry or extra restart was sent.

The fresh pre-change SQL inventory timed out after 45 seconds, and the metrics
endpoint returned HTTP 500. Auth and Storage were already reported unhealthy
before the resize; database and REST health endpoints reported healthy despite the
SQL timeout. Initial health requests were rejected because the provider rejected
its optional `timeout_ms` query parameter; removing that parameter returned the
actual health result. Those HTTP 400 responses are request validation failures,
not evidence of service downtime.

The verified 00:25:21 UTC archive was restored in isolated local containers for
record-identity and configuration comparisons. Both containers were removed.
Post-upgrade and post-cycle checks match all 18,598 email, 4,328 call, 2,882
recording, 2,882 transcript, 3,170 card and 2,897 Storage metadata identities from
that archive. Connector enablement, feature flags, account state, mailbox capture
settings and full cron configuration hashes also match. This is a selected-source
identity check against the older archive, not full message-content/file-byte
verification or a fresh pre-resize snapshot.

SQL responded in 4.466 seconds immediately after recovery and 0.575 seconds after
the next capture cycle. Auth, database, REST and Storage health checks all passed.
The provider metrics report 1,924,177,920 bytes total OS-visible memory and
1,308,200,960 bytes available at 05:50:35 UTC; `max_connections` is 90. Small is
selected at the approved price, and Pro is unchanged. The public frontend returns
HTTP 200; that is not signed-in acceptance.

The ordinary 05:50 UTC five-minute scheduler cycle resumed. Phone sync and Google
Workspace discovery succeeded; discovery queued 29 mailbox jobs. By 05:51:28 UTC,
two mailbox jobs had succeeded and 27 remained queued. Phone and mailbox message
runs returned zero new source records; this is recovery evidence, not complete
provider coverage. All 35 observed post-restart HTTP responses were 200, with no
pending HTTP requests. Cron command success alone was not treated as capture
success.

One Gmail OAuth job failed with `refresh_token_revoked`; older Workspace
`invalid_grant` failures were also observed. These require connector investigation;
compute recovery does not resolve consent. No connector, cron, grant, schema or
frontend was changed during this upgrade. No new complete export has been started,
and the export stall is not yet proven fixed.

After SQL recovered, the previously failing managed Storage configuration check
also succeeded. Supabase loads `supautils` through `session_preload_libraries`, and
its registered policy-grants setting includes `postgres` on `storage.objects` and
`storage.buckets`. This verifies the configuration used by the local rehearsal;
no live policy mutation or production LEARN installation was performed.

[Sanitised execution and recovery evidence](evidence/learn-production-small-compute-2026-10-12.json).

## Original recommendation and approval scope

Move only the ServiceOS production database `tgbnakbxwcqjeimygroz` to Supabase
**Small (`ci_small`), 2 GB memory**. The existing organization is already on Pro.
The provider currently quotes **US$0.0206/hour**, approximately US$15/month
(US$15.33 for 744 hours), for this compute selection before credits and tax.
This is the compute line item, not the total Supabase bill or a guaranteed
incremental amount. The current addon response lists no explicit compute variant;
the exact current compute charge is not established. No organization plan change
or other addon is part of this proposal.

This is a recommended capacity improvement, **not a proven fix for the export
stall**. This separately approved change affects paid production infrastructure and
interrupts service; it is distinct from the earlier AWS recording-storage approval.

Supabase says compute changes usually incur less than two minutes of downtime,
but can take longer. During that interval, sign-in, application reads and
background capture may be unavailable. Capture/checkpoint recovery must be checked
afterward; a brief interruption must not be described as continuous capture.

## Observed evidence

- The original archive remains intact and its 1,591,576 rows were verified against
  an offline restore. The separate later export was stopped and remains incomplete.
- SQL and Auth recovered after that attempt, with no restart, remaining CLI
  sessions or local export containers. Subsequent metrics requests again returned
  HTTP 500 even with no export running. This requires investigation independently
  of the native backup code.
- At 01:24 UTC, PostgreSQL reported 14 client sessions against a 60-connection
  limit, no blocked sessions and no active CLI sessions. These are post-recovery
  observations, not proof that connection exhaustion or blocking never occurred.
- One successful resource scrape reported 428,220,416 bytes total memory,
  146,022,400 bytes available, and load averages of 7.37 / 9.82 / 11.36 over
  1 / 5 / 15 minutes. The subsequent two scrapes failed, so CPU percentages,
  disk utilization and page-fault rates are **unavailable**, not zero.
- The retained 00:25 UTC archive contains 18 active cron jobs. Many share minute,
  two-minute or five-minute boundaries, including email, phone, worker and card
  processing. This establishes scheduled overlap, not proof of costly execution
  or the current scheduler state. No jobs have been disabled or rescheduled.
- The current billing API offers Small with 2 GB memory at the price above.
  The organization API confirms Pro. Empty selected-addon metadata must not be
  used as proof of a named current compute tier.

The evidence supports investigating limited resources and overlapping workload.
It does not establish a single root cause, CPU-credit exhaustion, a disk quota
failure or a need to delete retained history. Preserve all source records.

## Exact proposed action and verification

For the approved run above, the execution procedure was to re-read the organization
tier and offered Small variant/price.
Stop if the identity, price, plan requirement or scope differs. Recheck SQL/Auth
health and capture a bounded pre-change inventory of critical retained input
counts, connector enablement and pending work. Do not start another export.

The reviewed provider action is:

```text
PATCH /v1/projects/tgbnakbxwcqjeimygroz/billing/addons
{"addon_type":"compute_instance","addon_variant":"ci_small"}
```

Journal the request once and retain its response. On an uncertain response,
inspect project/addon state; do not issue an automatic duplicate resize. No
schema, frontend, provider permissions, cron schedules, authentication keys or
organization plan are changed by this proposal.

After the resize, verify the selected variant, actual memory, SQL/Auth/Storage
health, preserved critical inputs and connector settings. Observe scheduled
capture through at least one ordinary cycle, distinguishing new failures from
pre-existing issues. Only then prepare a separately journaled, bounded complete
export and isolated restore with source-health checks before and after it.

If the resize or post-change health fails, retain evidence and stop further
changes. Do not assume the previous implicit instance can be selected again;
Nano is not listed as an available paid-plan variant. A further resize or provider
support escalation needs a concrete recovery decision. Never restore an old
database over production as a response to a compute-health problem.

## Sources

Provider pricing and memory were read from the production project's billing
addons API on 12 October 2026; sanitized evidence is linked from the completion
checklist. Public references:

- [Compute sizes, pricing and downtime](https://supabase.com/docs/guides/platform/compute-and-disk)
- [List current and available addons](https://supabase.com/docs/reference/api/v1-list-project-addons)
- [Apply a compute addon](https://supabase.com/docs/reference/api/v1-apply-project-addon)
- [High disk I/O troubleshooting](https://supabase.com/docs/guides/troubleshooting/exhaust-disk-io)
