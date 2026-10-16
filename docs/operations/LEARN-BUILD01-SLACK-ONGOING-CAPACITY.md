# Build 01 — ongoing Slack coverage decision

**Status, 15 October 2026, 22:58 UTC:** technical design review; no new Slack
permission, event subscription, provider write or capture-scope change has been
made. The approved scope is 160 public channel histories and their observed
replies. Individual and group DMs remain excluded.

At 23:09 UTC the local preparatory
[`slack_events_boundary.ts`](../../supabase/functions/_shared/slack/slack_events_boundary.ts)
passed four synthetic signature, timestamp, app/workspace, exact-roster, public-
channel, saved-cutoff, DM exclusion and reply-hint tests plus TypeScript. It only returns a
bounded source hint, never message content or a capture receipt. No receiving
endpoint, durable event deduplication, source-window enqueue, Slack app
subscription or LIVE activation exists yet. The current polling system is
unchanged. This preparation does not settle the pending choice or capacity gate.
At 23:18 UTC its correction branch was tightened against Slack's documented
edit/delete shapes: those events use the change time in `event.ts`, the original
message time in `message.ts` or `deleted_ts`, and may omit `channel_type`.
Correction hints now carry both times, reject unrelated subtypes and explicitly
require a fresh public-visibility check before reconciliation. Four synthetic
tests and TypeScript pass. No correction processor or deletion policy is active.

At 00:41 UTC on 16 October, a local inactive HTTP boundary was added in
[`slack_event_http.ts`](../../supabase/functions/_shared/slack/slack_event_http.ts).
It caps the raw request body, verifies signatures and the exact roster supplied
by its binding loader, acknowledges only a reported durable hint receipt or
known duplicate, and
returns a retryable failure when persistence is uncertain. An out-of-scope signed
DM/private/unapproved event is ignored without writing a hint. Synthetic root,
correction, challenge, duplicate, outage and exclusion tests pass; TypeScript
passes. This is a handler with injected binding/storage dependencies, **not a
deployed receiving function or durable event ledger**. No Slack app subscription,
signing secret, provider write or capture-scope change has been made. A future
adapter must prove that its roster is current and that its receipt means an
atomic durable insert before this handler can be enabled.

At 00:50 UTC, the inactive receiver gained an exact-roster digest/expected-
count adapter, a service-only SQL hint ledger and a default-off Edge entrypoint.
The ledger rechecks the tenant, approved subscription, account, capture switch,
credential kind, connection revision and source scope in the insert transaction.
The existing approved connection uses a user token; the first bot-only candidate
was excluded in an isolated rehearsal and corrected to the existing credential
field rule. A pinned, network-isolated production-archive restore with 160
enabled subscriptions then recorded one synthetic hint, recognized a duplicate,
rejected a changed event ID and excluded a paused subscription. It was removed
afterward. Fourteen local boundary/adapter/HTTP tests pass, and the inactive
receiver compiled in the pinned Edge runtime. [Sanitised evidence](evidence/learn-build01-slack-event-preparation-2026-10-16.json).
At that rehearsal checkpoint the schema and receiver were **local only**; no
TEST/LIVE deployment, signing-secret installation, Slack event subscription or
provider write had occurred.
A hint processor, edit/delete visibility policy, TEST delivery rehearsal and real
post-cutoff capture are still required.

At 00:53 UTC, the ledger and default-off receiver were installed in TEST only.
Exact catalog readback showed service-role-only recorder execution, row security
and no table SELECT grants to clients or service role. The receiver is TEST v1
with public gateway JWT verification disabled for future Slack HMAC delivery,
but its application activation flag is absent: a synthetic unsigned POST returns
503 and GET returns 405. The TEST hint table is empty and all 42 prior TEST Edge
functions were preserved. A combined readback query failed after the schema
submission; separate catalog queries confirmed installation, so it was not
resubmitted. LIVE and Slack remain unchanged. The hosted signed-delivery and
source reconciliation gates above still apply.

## Observed baseline and arithmetic

- The handoff has 160 enabled channel/reply subscriptions. Of those, 127 saved
  channel boundaries have advanced past the 13 October 09:30 UTC cutoff and 100
  remain over a day behind. No post-cutoff message or reply was retained in the
  bounded read at 22:58. This does **not** prove the provider was empty.
- The previous hour contained 41 succeeded history and 39 succeeded reply jobs.
  The stored internal-app rate profile is current, bound to the configured
  connection and expires 12 November. Its current database cooldown is 30
  seconds per completed workspace job. Jobs took roughly 8–9 seconds on
  average in this observation, and the worker holds one workspace lease.
- The installed near-live scheduler returns to 15-minute windows once caught
  up: 160 × 4 = **640 channel windows/hour** before pagination. Its observed-
  thread discovery revisits every saved parent at each channel window. The
  earlier source inventory found 870 roots in 69 channels. If all remain
  eligible, that adds up to **3,480 reply windows/hour**. Those figures are
  workload projections, not observed API requests or a claim that every
  window contains a message.
- The current pacing ceiling is 120 completed workspace jobs/hour, and the
  observed job throughput is about 80/hour. More worker ticks alone cannot
  close the gap. Slack documents Tier 3 as at least 50 requests/minute per
  method for internal apps, but the existing app's actual effective capacity
  must still be measured and respect `429`/`Retry-After` responses. The current
  model also spends work on old thread roots even during empty new windows.

## Feasible paths

**Recommended: signed, allowlisted Slack Events delivery plus reconciliation.**
Slack's `message.channels` subscription delivers public-channel messages,
including thread replies, to a signed HTTP endpoint. A receiving function would
verify the Slack HMAC and short timestamp window, bind the saved team/app and
connection, reject any channel outside the exact approved roster, deduplicate
the event ID and source timestamp, then enqueue bounded ingestion through the
existing tenant-scoped writer. It must reject DMs, private-channel events and
unexpected subtypes; edits/deletions need their own documented reconciliation
policy. The HTTP acknowledgement must be fast and separate from processing.
A slower full-window sweep would catch event loss, revocation and corrections.
This is the only path here that could preserve a near-live expectation without
polling every old root every 15 minutes. It requires a one-time Slack app event
subscription and signing-secret setup, followed by TEST simulation, exact LIVE
activation and post-cutoff source-to-card proof. It is **not yet implemented or
authorised for activation**.

**Polling-only fallback: agree slower evidence freshness.** At the observed
80 jobs/hour, even a four-hour channel check plus daily checks of 870 old roots
projects about 40 + 36 = 76 calls/hour before new roots, pagination, retries
and recovery. It has too little headroom. A six-hour channel and 48-hour old-
thread cadence projects about 27 + 18 = 45/hour before those extras, but it
would give materially slower Slack evidence. A polling fallback must retain
explicit saved-boundary warnings and must be accepted as a changed freshness
outcome, not described as near-live.

Simply increasing the existing 30-second cooldown would still require more
worker capacity, and the 15-minute old-thread projection alone is roughly
58 reply requests/minute. It is not a safe standalone fix.

## Decision and completion gate

Prepare the recommended endpoint and synthetic tests without enabling delivery.
Chris should review the exact event subscription and reconciliation behavior
before activation, or explicitly choose a slower polling freshness target.
Build 01 remains open until the chosen path records a real post-cutoff channel
and reply journey, preserves source visibility and DMs' exclusion, and shows
stable unattended catch-up under representative load.

Source evidence: [saved 22:26 capacity readback](evidence/learn-build01-slack-steady-state-capacity-2026-10-15.json),
[Slack API rate limits](https://docs.slack.dev/apis/web-api/rate-limits/),
[Slack message event scope](https://docs.slack.dev/reference/events/message/),
[Slack Events delivery and retries](https://docs.slack.dev/apis/events-api/),
[Slack signed-request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/).
