# Durable Slack historical campaigns

## Delivery state — 13 October 2026

**Campaign schema and matching runtimes deployed and verified idle in TEST; real Drummonds campaigns remain unstarted.**

TEST package 092 installs all six campaign-related migrations and preserves all
213 original datasets. Matching worker v12, scheduler v4 and shared platform
worker v24 preserve the resulting 220 datasets. Seventeen hosted access/idle
checks pass. This is not real-provider campaign acceptance or production release.
The stable TEST frontend is `65ef71d`; the existing operator session verified the
empty campaign list, scope form and incomplete-review rejection. The read audit
matches; there are still zero campaign requests, active Slack jobs or subscriptions.
[Hosted evidence](evidence/learn-slack-campaign-hosted-2026-10-13.json).
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

Observed threads now follow channel completion through the same scheduler. Each
pass records at most twenty distinct roots from retained conversation evidence and
queues one unfinished thread per channel. Broadcasts can identify a root older than
the approved window; replies remain bounded to the original dates. The source
message/version that established each root is immutable, and renewals preserve it.
A thread exceeding ten pages continues with its saved cursor and original approver.

Coverage requires matching successful page receipts for both channel history and
all discovered threads. Queue state or a checkpoint flag alone is insufficient.
The reader reports discovery, observed/completed thread counts and the qualified
`fixed_window_observed_threads` coverage. This does not establish availability of
deleted messages or hidden/inaccessible threads. A completed retained window remains
verifiable after its capture approval has expired or been paused.

The operator can now close a campaign with either permanent stop or a completed
history handoff. Both use immutable request/check/cancel receipts and a revision
check. Stop preserves saved scope, checkpoints, messages and job evidence while
fencing subsequent dispatch/publication. A request already in transport cannot be
recalled. The terminal campaign cannot be resumed with the pause/resume control.

Handoff requires durable completion for every channel and observed thread, no
queued/running/retrying channel or reply work, enabled capture and the original
connection revision. It stores an immutable coverage snapshot, then enables the
existing ongoing-channel and observed-reply subscriptions in the same transaction.
The actual caller supplies this fresh ongoing approval. The first recurring window
starts exactly at the historical cutoff; it does not jump to today. Old jobs retain
their campaign fence even after the account moves to a non-campaign scope. Historical
coverage remains readable as ongoing capture advances its own checkpoint.

The existing Slack setup now includes a Historical campaigns tab. Operators can
enter exact public-channel IDs/workspace links, review fixed dates, expiry, request
allowance and reason, then submit. Campaign status distinguishes channel completion,
observed-reply discovery/capture and retained terminal coverage. Pause/resume, permanent
stop and completed-window handoff use a reviewed request. This is the existing UX and
styling; it does not replace the client workspace or Drummonds branding.

A saved request is bound to backend, actor and tenant and written before dispatch.
Browser coordination and server receipt checks prevent a lost response from creating
a fresh import. Context/access changes, conflicting requests, corrupt storage and
unverifiable responses retain the pending request. The server dispatch wrapper checks
the actual authenticated actor. No secret or message content is stored in this outbox.
Channel selection is currently explicit IDs/links, not a complete provider inventory.

## Interfaces and limits

- `learn_slack_campaign_list`: logged tenant/operator read, twenty campaigns per
  UUID-keyset page, current write permission, and no direct campaign table grants.
- `learn_slack_campaign_dispatch`: actor-bound authenticated wrapper for the existing
  start/control/close protocols, including request/check/cancel modes.
- `learn_slack_campaign_start`: authenticated company admin/OpenFolk operator;
  immutable request/check/cancel receipt. The definition contains `connectionId`,
  `connectionRevision`, `channelIds`, `start`, `end`, `expiresAt`, `requestBudget`
  and `reason`. One to 500 explicitly selected channel IDs, 9 to 1,000,000 total
  dispatch reservations, and expiry within 30 days. These are implementation limits,
  not approval to run any particular size of import.
- `learn_slack_campaign_control`: revisioned pause/resume with reason and the same
  request/check/cancel protocol. Cancelling a pending control request is **not**
  cancelling an already-started campaign.
- `learn_slack_campaign_close`: authenticated admin/operator; `stop` or `handoff`,
  campaign revision and reason. `cancel` mode cancels a pending decision, while
  action `stop` permanently closes the campaign. Handoff enables channel and
  observed-thread capture for the same selected accounts, beginning at the cutoff.
- `learn_slack_campaign_read`: tenant-scoped or logged operator summary. It reports
  the fixed scope, budget/reservations, channels and evidence-backed thread coverage.
- `learn_slack_schedule_campaigns`: service-only bounded scheduling; called by the
  existing infrastructure-authenticated Slack scheduler. No new cron is installed.
- `learn_slack_campaign_reserve_request`: service-only, owned/unexpired job attempt;
  at most nine dispatch ordinals per attempt. Clients cannot edit the counter or tables.

The existing runtime still checks that each requested channel is internal and public.
DMs remain excluded. No files are downloaded. Starting a campaign refuses competing
ongoing capture or active reply jobs, and manual setup/recovery cannot replace an
owned campaign scope. Existing request receipts can still resolve after later changes.

## Verification

154 focused tests, TypeScript and the frontend build pass. The isolated archived
production-schema rehearsal exercises ten actual claim/publish/settle transactions,
automatic continuation, exact replay, cross-client operator attribution, tenant
isolation, shared budget exhaustion, two concurrent contenders for the last request,
pause before/after claim, publication fencing, explicit recovery, revoked authority,
revoked credentials, capture disable and real-clock expiry.

The migrations roll back cleanly, reject duplicate application and seed no rows.
All 388 pre-existing baseline datasets / 1,591,603 rows and seven sequences match;
seven new tables are empty outside disposable synthetic journeys (four campaign,
two thread and one terminal-snapshot table). Existing function
owners/security modes/grants and table/view definitions remain unchanged. The clone
had no network, host mounts, published ports or background workers and was removed.
The source is the retained 12 October archive, not a fresh production backup.

The extended rehearsal passes ten journeys. Its dedicated thread journey discovers
21 distinct roots across two bounded scans, processes 31 reply pages including one
11-page thread, and verifies 53 unique synthetic messages/versions/interactions.
All 297 channel/reply dispatch reservations share the original budget. Duplicate
publication, foreign-tenant denial, pause/publication fencing and final-page coverage
are exercised. A checkpoint manually marked complete without a receipt stays incomplete.
No hosted changes or provider calls occur.

The lifecycle journey proves request replay/cancellation, viewer and foreign-target
denial, stale revisions, incomplete-handoff rejection, a real synthetic ongoing
page transaction after handoff, durable coverage after account advancement, and
permanent-stop dispatch/publication fencing. Archived rows/sequences remain intact.

The controller journey proves pagination across 23 synthetic campaigns, actor binding,
viewer/tenant isolation and existing start/pause/stop receipt semantics. Browser checks
use the actual component and existing styles with a synthetic client: incomplete handoff
stays disabled, scope review is explicit, and a lost response recovers its saved receipt.
This is not hosted acceptance. TypeScript and the complete frontend build pass.

[Controller evidence](evidence/learn-slack-campaign-controller-2026-10-13.json).
[Lifecycle evidence](evidence/learn-slack-campaign-lifecycle-2026-10-13.json).
[Foundation evidence](evidence/learn-slack-campaign-foundation-2026-10-13.json).
[Observed-thread evidence](evidence/learn-slack-campaign-threads-2026-10-13.json).

## Required next work

1. Complete authorised reapproval after exhausted budget/expired approval without
   losing checkpoints or silently extending a prior request allowance. Permanent stop
   currently retains its binding; replacement needs an explicit reviewed workflow.
2. Complete a provider-backed channel inventory/selection experience and verify the
   controller in signed-in hosted TEST. Explicit ID/link selection is available locally.
3. Package the historical-range, message-kind, campaign, thread, lifecycle and controller SQL with their exact worker,
   scheduler and frontend dependency closure. Older staged manifests exclude this work.
4. Verify signed-in hosted controls and prepare the concrete broader Drummonds import:
   selected inventory, fixed dates, total requests, deadline, destination and recovery.
   Do not reuse the completed sample's unused allowance or imply full history is accepted.
5. Finish private-channel visibility and real reply/ongoing-capture acceptance as part
   of the full LEARN goal. They are not silently deferred by this foundation.
