# Slack active-channel history priority

Deployed and activated on 13 October 2026 at 12:28 BST. **Scheduled production acceptance passed.**

The approved public-channel rollout covers 20 active channels followed by 160 archived channels. The existing queue gives every page priority 100; continuation jobs therefore fall behind older archived initial jobs. This change makes ready active-channel history and its replies take precedence while preserving each channel's existing newest-first history cursor and fixed campaign window. It does not create a globally chronological stream.

## Exact change

- Add an append-only infrastructure decision table, inaccessible to customer and service-role table reads/writes, with RLS and no client policies. Each decision binds a tenant, campaign, frozen definition hash, expiry, reason and evidence reference; the database records its actual operator role.
- Change only the ordering expression in `learn_slack_claim_jobs`. Initial pages, continuation pages and replies derive their effective priority from the durable job's actual campaign/account/thread relationship. No job payload can choose a priority or borrow another campaign's authority.
- Reviewed active campaign priority: 40. Reviewed archived campaign priority: 60. Existing stored job priority remains 100. Unknown, foreign, expired, revoked, paused or definition-mismatched bindings retain their original priority.
- Preserve FIFO by creation time and ID within equal priority. Only ready work is eligible: archives may proceed while active work is waiting for its next availability. Existing workspace locks, leases, request budgets, retry limits and Slack `Retry-After` remain authoritative.
- No runtime, browser UI, credential, permission grant, cron or provider request is needed for deployment. No cursor, import window, channel membership, source record or running job is rewritten.

## Reviewed production decision

| Campaign | Channels | Request cap | Priority |
| --- | ---: | ---: | ---: |
| Active public channels | 20 | 10,000 | 40 |
| Archived public channels | 160 | 20,000 | 60 |

Both retain the authorised window 13 October 2015 00:00 UTC to 13 October 2026 09:30 UTC, with expiry 20 October 2026 09:30 UTC. Private channels and DMs are not added by this change.

The prepared activation pins Drummonds' tenant, DH workspace, existing connection ID and revision, both campaign IDs and definition hashes, channel counts, existing revision, bounds, budgets and current campaign authority. It inserts exactly two reviewed audit decisions. It does not change either campaign. A short transactional job-table lock and running-lease check prevent activation during an existing Slack lease; an active lease aborts without a partial change.

## Validation

The networkless production-schema rehearsal passed default and accelerated history/reply journeys plus campaign budget checks. The priority journey proves:

- An active continuation beats an older archived initial job.
- Replies inherit their actual active campaign; spoofing another campaign in the payload cannot borrow its priority.
- Foreign tenant, revoked connection, paused campaign, expired decision and changed definition fall back safely.
- A second worker cannot claim around the active workspace lease.
- Archived work becomes eligible after active work completes; equal priorities retain FIFO.
- Duplicate request reservation is rejected; a 429 with `Retry-After: 120` blocks subsequent claims.
- The decision audit cannot be edited in place; client roles cannot read/write it.

Private receipts: `.verification-results/slack-campaign-priority-rehearsal-v1/report.json` and `.verification-results/slack-campaign-priority-release-rehearsal-v1/report.json` (prepared release wrapper plus activation template with synthetic bindings). Sanitised evidence: `docs/operations/evidence/learn-slack-campaign-priority-preparation-2026-10-13.json`. Production preparation contains metadata and SQL only; it is not a provider-content export.

## Execution and recovery

Parent review and execution use `.verification-results/production-slack-priority-20261013/deploy.mjs`. `prepare` is read-only. `apply`, then `activate`, require the exact prepared plan hash in `SERVICEOS_APPROVED_SLACK_PRIORITY`. Schema application creates no decisions, so queue order remains unchanged until activation. Each mutation writes a pending journal before its request; an uncertain outcome must be inspected, never replayed blindly.

Before/after checks compare canonical function definitions, existing function access, public policies, schedules and non-decreasing source counts. Policy fingerprints retain their original search path, while function definitions use `pg_catalog` to avoid false differences from type-name rendering.

Rollback after activation appends two priority-100 decisions, preserving the audit and original queue ordering. Removing the schema is prepared only for an empty decision table and no running Slack lease; retained decisions must not be deleted to enable schema rollback.

## Production acceptance — 12:29 BST

Schema and the two reviewed priority decisions were applied with exact source/plan checks and verified readback. The unchanged minute scheduler completed an active-channel 100-message page at 11:29:08 UTC while 141 archive jobs remained queued. Active priority 40 and archived priority 60 were effective; both request budgets remained within bounds. Total saved Slack messages reached 1,226. No manual dispatch was used. Existing policies, schedules and function access were checked; retained source counts did not decrease.

The offline preparation receipt remains historical. Current sanitised evidence is [production acceptance](evidence/learn-slack-campaign-priority-production-2026-10-13.json). History completeness, customer/job attribution and ongoing capture remain separate requirements.
