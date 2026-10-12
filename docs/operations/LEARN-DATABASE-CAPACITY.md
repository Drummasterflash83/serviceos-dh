# Production database capacity decision — prepared, not applied

## Recommendation and approval scope

Move only the ServiceOS production database `tgbnakbxwcqjeimygroz` to Supabase
**Small (`ci_small`), 2 GB memory**. The existing organization is already on Pro.
The provider currently quotes **US$0.0206/hour**, approximately US$15/month
(US$15.33 for 744 hours), for this compute selection before credits and tax.
This is the compute line item, not the total Supabase bill or a guaranteed
incremental amount. The current addon response lists no explicit compute variant;
the exact current compute charge is not established. No organization plan change
or other addon is part of this proposal.

This is a recommended capacity improvement, **not a proven fix for the export
stall**. It needs Chris's approval because it changes paid production
infrastructure and interrupts service. The existing approval covers AWS recording
storage and does not authorize this additional compute choice.

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

After approval, re-read the organization tier and offered Small variant/price.
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
