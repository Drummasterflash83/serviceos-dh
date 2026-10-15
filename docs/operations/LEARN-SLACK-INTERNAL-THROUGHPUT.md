# Slack internal-app throughput — production verified

## Evidence (13 October 2026)

Slack's [history reference](https://docs.slack.dev/reference/methods/conversations.history/)
and [replies reference](https://docs.slack.dev/reference/methods/conversations.replies/)
retain Tier 3 limits for internal customer-built apps. The
[rate-limit clarification](https://docs.slack.dev/changelog/2025/06/03/rate-limits-clarity/)
excludes internal apps from the new commercial non-Marketplace restrictions.
The [original announcement, subsequently clarified](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/)
states up to 1,000 messages per request for internal apps. The restricted commercial
class receives 15 messages per request and one history/replies request per minute.

The authenticated app inventory shows `OpenFolk LEARN - Drummonds`, workspace DH,
app `A0C8G0STUKV`, type Modern, distribution **Not distributed**. Screenshot:
`.verification-results/slack-app-distribution-20261013.png`. This supports the
internal-app classification for this dedicated installation. It does not establish
that a future externally distributed OpenFolk app inherits the same entitlement.

Our old limit was a conservative implementation default, not an observed Slack
429. At 10:33 UTC, scheduled jobs had committed two 15-message pages since activation
and the provider block timestamp remained negative infinity. The minute cron plus
60-second cooldown after completion produced approximately one page every two minutes.

## Active production behaviour

- Infrastructure-only profile binds tenant, connection, workspace, reviewed app ID,
  exact connection revision and Vault credential reference. Evidence and expiry
  are mandatory; expiry is at most 30 days from verification.
- Eligible connections request at most **100 messages per page** for both channel
  history and observed replies. Unknown, expired, revoked, changed or unreviewed
  connections retain **15**. Missing profile schema during rollout falls back to15; other RPC errors or malformed values fail closed.
- Completion and successor cooldown become **30 seconds** only for eligible
  connections. The existing minute cron normally processes one page per minute;
  there is no cron change, parallel workspace worker or unbounded loop.
- Transport, reader and SQL publication agree on page size. A profile becoming
  ineligible during a request rejects its publication rather than assuming success.
- Shared workspace locks, exact cursor/window validation, duplicate/version handling,
  source retention, thread discovery, capture gates and consent checks remain.
- Every provider request still consumes an existing campaign reservation, including
  failed requests and metadata checks. Limits remain 10,000 + 20,000 across the two
  approved campaigns; no new dates/channels/DMs/files/AI are introduced.
- HTTP429 still applies at least 60 seconds and the provider Retry-After value to
  the shared workspace. Never speed up by rotating tokens or app identities.

The [general rate-limit documentation](https://docs.slack.dev/apis/web-api/rate-limits/)
sets limits by method/workspace/app. Our current page transport makes up to nine
requests, including seven channel checks. `conversations.info` is Tier 2 (20+ per
minute); therefore 50 history pages/minute would be inappropriate for this transport.
The 30-second cooldown allows at most two jobs/minute, below that metadata
rate, and the unchanged scheduler normally dispatches one.

## Validation and release sequence

Migration: `supabase/migrations/20261101880000_learn_slack_internal_rate_profile.sql`.
It creates no profile row and enables no capture. Runtime changes are confined to
Slack history binding, request, transport and channel/thread readers.

Deploy the reviewed schema first with its profile table empty, then matching worker
runtime, then provision the exact non-secret Drummonds profile as a separately
journalled activation. A runtime rollback requires disabling/removing that profile
first; retained source records and cursor identities stay valid for smaller pages.
Preserve the old function definitions for schema rollback. Do not remove retained
Slack records to roll back throughput.

80 Slack runtime tests pass, including 100-message history/replies, conservative
fallback, invalid profile, profile revocation before publication and oversized pages.
The offline full-schema rehearsal passed in a networkless 196.9 MB production
restore: schema rollback, default channel/thread journeys, 100-message and100-reply
publication, exact replay, oversized-page rejection, foreign/expired/changed-profile
fallback and existing campaign budget/coverage assertions. The container was removed.
Evidence: `.verification-results/slack-internal-throughput-rehearsal-v2/report.json`.
Focused TypeScript checking also passes. Production scheduled acceptance is recorded below. Production acceptance should inspect scheduled page
receipts, messages/versions/interactions, channel/thread coverage, campaign request
budgets and shared rate-limit state without manually bypassing the queue.

At 100 observations per minute, approximately 6,000 observations/hour is only an
upper estimate. Sparse channels, replies, retention, timeouts and provider backoff
reduce it. Completion remains proven by every channel window and observed thread's
durable coverage, not by elapsed time or the existence of the connection.

## Production acceptance — 13 October 2026, 11:08 UTC

The schema and matching Slack worker 3, voicemail importer 5 and platform worker 61
are published. The connection-bound profile activated at 11:06:30 UTC. Its first
eligible scheduled page committed 58 historical messages at 11:08:08 UTC, exceeding
the old 15-message cap with the new 100-message request bound. Totals were 364 retained
Slack messages, 364 versions and 259 projected interactions. This was automatic cron
progress; the verification made no manual dispatch or provider requests.

The workspace had no rate-limit block or failed/retrying jobs. Its new cooldown
ended 30 seconds after successful completion. Reservations remained within the
original budgets: 189/10,000 active-channel requests and 27/20,000 archived-channel
requests. Public RLS policies, existing function access and cron schedules matched
the before-state; the profile table is unavailable to client and service-role table
writes. Historical channel and observed-thread completion remains in progress.

Sanitised receipt: [production throughput acceptance](evidence/learn-slack-internal-throughput-production-2026-10-13.json).

Two release checks required correction, with their original pending journals retained:
function-definition hashes needed a separate canonical search path because composite
argument names and policy expressions render differently by session; profile activation
needed statement_timestamp for its verification time so its immediate stable eligibility
read did not see a future timestamp. The original activation rolled back completely;
the corrected statement passed an isolated reproduction and production readback.

## Build 01 capacity continuation — 15 October 2026

The ordinary platform tick's single Slack call became a conservative maximum of
two serial calls after a successful first page. This changes only the private
platform worker input-dispatch module; SQL rate profile, provider safeguards,
schedule, source history and access remain unchanged. TEST v39 and LIVE v90
were verified against exact hosted artifacts and the previous versions are
retained for guarded rollback. Initial LIVE jobs succeeded with no new failure
or provider block, but observed pages were usually too slow for the second
call's time budget. The backlog was still growing at 21:02 UTC. This release
does **not** establish sustainable catch-up. See the
[Build 01 runtime and queue evidence](evidence/learn-build01-slack-double-tick-2026-10-15.json).

## Dedicated Build 01 catch-up cadence — 15 October 2026

The approved campaign's reply discovery kept creating work faster than the
minute timer could settle it. TEST platform-worker v40 and LIVE v91 add an exact
schedule-secret-gated `slack_only` mode. It makes **one** call to the existing
Slack worker, never schedules a window or claims a generic job, and leaves
Commusoft, QuickBooks, voicemail and the ordinary platform timer untouched.
The 30-second SQL workspace cooldown, shared lease, reviewed internal-app
profile and campaign request budgets remain the authority; a 15-second cron
merely offers a claim when the lock permits it. The cron command reads the
existing `WORKER_SECRET` from Vault at execution time and stores no secret value.

The exact previous TEST/LIVE worker binaries are retained in ignored private
verification directories. To stop the extra cadence, first unschedule only
`serviceos-slack-catchup`; preserve `serviceos-worker`. A runtime rollback is
then allowed only against the verified current candidate and retained binary.
Do not reset channel windows, parent-root checkpoints or message history.

The first LIVE minutes show successful cron enqueues and real Slack job
settlements without a new provider block, but the queue and channel-lag gap
remain material. The schedule is an operating experiment, not catch-up
acceptance. [Exact release and early observation](evidence/learn-build01-slack-cadence-2026-10-15.json).
