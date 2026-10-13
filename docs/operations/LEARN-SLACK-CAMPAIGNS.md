# Durable Slack historical campaigns

## Delivery state — 13 October 2026

**Local foundation verified; not deployed and not ready to activate for Drummonds.**
The complete delivery target remains all available authorised channel history and
observed replies, followed by ongoing capture. No real campaign or provider request
has been created by this work. The completed two-message TEST sample remains closed.

A campaign now records selected channel IDs, one tenant/connection revision, fixed
start/cutoff, expiry, total request allowance and the actual approving person. Initial
channel jobs use the existing logged approval path. After ten committed pages, the
scheduler renews only the same cursor and source dates. Every previous approval and
checkpoint remains retained. It uses the exact durable page receipt, rather than
assuming the most recently timestamped job proves completion.

Every provider dispatch reserves one unit before HTTP: this includes identity checks,
channel checks, history and retries. Reservations are keyed by job/attempt/ordinal and
cannot be reused. Concurrent workers share one atomic campaign counter. Lost replies
may consume allowance without a provider call; counts are explicitly conservative
reservations, not successful-request counts. A transport failure retries through a new
durable attempt, never by dispatching after an uncertain reservation acknowledgement.

Pause, current approver authority, credential revision/revocation, connector and
module controls, and expiry are checked at claim/credential/dispatch/publication
boundaries. Already committed pages may settle after pause without another request.
An explicit revisioned resume can renew an interrupted approval once; it cannot
increase the budget or expiry. Unsupported content and other permanent failures are
held for review rather than endlessly generating fresh approvals.

## Interfaces and limits

- `learn_slack_campaign_start`: authenticated company admin/OpenFolk operator;
  immutable request/check/cancel receipt. The definition contains `connectionId`,
  `connectionRevision`, `channelIds`, `start`, `end`, `expiresAt`, `requestBudget`
  and `reason`. One to 500 explicitly selected channel IDs, 9 to 1,000,000 total
  dispatch reservations, and expiry within 30 days. These are implementation limits,
  not approval to run any particular size of import.
- `learn_slack_campaign_control`: revisioned pause/resume with reason and the same
  request/check/cancel protocol. Cancelling a pending control request is **not**
  cancelling an already-started campaign.
- `learn_slack_campaign_read`: tenant-scoped or logged operator summary. It reports
  the fixed scope, budget/reservations, channels and unfinished thread coverage.
- `learn_slack_schedule_campaigns`: service-only bounded scheduling; called by the
  existing infrastructure-authenticated Slack scheduler. No new cron is installed.
- `learn_slack_campaign_reserve_request`: service-only, owned/unexpired job attempt;
  at most nine dispatch ordinals per attempt. Clients cannot edit the counter or tables.

The existing runtime still checks that each requested channel is internal and public.
DMs remain excluded. No files are downloaded. Starting a campaign refuses competing
ongoing capture or active reply jobs, and manual setup/recovery cannot replace an
owned campaign scope. Existing request receipts can still resolve after later changes.

## Verification

144 focused tests, TypeScript and the frontend build pass. The isolated archived
production-schema rehearsal exercises ten actual claim/publish/settle transactions,
automatic continuation, exact replay, cross-client operator attribution, tenant
isolation, shared budget exhaustion, two concurrent contenders for the last request,
pause before/after claim, publication fencing, explicit recovery, revoked authority,
revoked credentials, capture disable and real-clock expiry.

The migration rolls back cleanly, rejects duplicate application and seeds no rows.
All 388 pre-existing baseline datasets / 1,591,603 rows and seven sequences match;
four new tables are empty outside disposable synthetic journeys. Existing function
owners/security modes/grants and table/view definitions remain unchanged. The clone
had no network, host mounts, published ports or background workers and was removed.
The source is the retained 12 October archive, not a fresh production backup.

[Sanitised evidence](evidence/learn-slack-campaign-foundation-2026-10-13.json).

## Required next work

1. Add durable observed-thread discovery and traversal across the same fixed cutoff,
   with continuation/recovery, the same cumulative budget and exact attribution.
   Channel completion currently stops at `history_captured_threads_pending`;
   `complete` and `threadsComplete` deliberately remain false.
2. Complete campaign cancellation, explicit handoff to ongoing capture, and authorised
   recovery after exhausted budget/expired approval without losing checkpoints.
3. Add the OpenFolk campaign selection/review/status controls in the existing UX.
   Preserve pending requests through uncertain replies and show coverage limitations.
4. Package the historical-range, message-kind and campaign SQL with their exact worker,
   scheduler and frontend dependency closure. Older staged manifests exclude this work.
5. Verify signed-in hosted controls and prepare the concrete broader Drummonds import:
   selected inventory, fixed dates, total requests, deadline, destination and recovery.
   Do not reuse the completed sample's unused allowance or imply full history is accepted.
6. Finish private-channel visibility and real reply/ongoing-capture acceptance as part
   of the full LEARN goal. They are not silently deferred by this foundation.
