# Build 01 — Drummonds public Slack Events change for review

**Prepared 16 October 2026. Slack app unchanged.** Chris selected near-live
channel and observed-reply capture for Build 01 and asked to review the signed
Events route before any app change. This is the proposed app change, not an
activation receipt or proof of near-live delivery.

## Exact Slack app change proposed

| Setting | Proposed value |
| --- | --- |
| App and workspace | The existing connected Drummonds Slack app and its saved workspace/team ID; no new app or workspace |
| Events API | Enable Events API with HTTPS Request URL `https://tgbnakbxwcqjeimygroz.supabase.co/functions/v1/learn-slack-events` |
| User event subscription | Add **only** `message.channels` |
| OAuth scope | Use the existing `channels:history` grant if its current installation confirms it; do not add write, private-channel or DM scopes |
| Signing secret | Install the existing app's Signing Secret as a server-side LIVE Edge secret, never in Git or browser code; do not rotate it |
| Explicit exclusions | No `message.groups`, `message.im`, `message.mpim`, bot/DM/private-channel subscription, channel invitation or source write |
| Saved capture scope | The exact approved 160 public-channel IDs, connection revision, team/app IDs and 13 October 2026 09:30 UTC lower bound |

The receiver's HMAC check uses Slack's raw request bytes and a five-minute
timestamp window. It checks the app/team, exact roster and public channel type,
then stores only an event ID and bounded source timestamp hint in a service-only
ledger. It acknowledges after a durable insert or matching duplicate; an
uncertain database write returns a retryable error. Signed events for an
unapproved channel, private channel or DM are ignored without retaining their
content. The event body is never treated as source evidence. Slack's URL
verification challenge is handled only after the signature check.

Each accepted new-message or reply hint must prompt a bounded **read-only**
source fetch under the existing approved connection, followed by the existing
tenant-scoped message/version/interaction writer. Edits must fetch the current
message and retain its prior version. Deletions must withhold the current
message from cards and browsing while retaining an audited source/version
history; neither may be inferred solely from the event. A changed channel
visibility, revoked connection or paused subscription holds the hint. A slower
reconciliation sweep is still needed for missed events and correction gaps.

## Current implementation and gate

The signed HTTP parser, exact-roster adapter, durable hint ledger, source
reconciliation and queue worker have local synthetic tests. The worker verifies
the saved credential's workspace identity and current public-channel visibility,
fetches exactly the hinted root or reply, then uses the existing source writer.
An edit requires current provider evidence; a deletion requires provider absence
before card interactions are withheld. An isolated restored-database rehearsal
verified hint-to-job claim, source publication, duplicate acknowledgement,
deletion withholding and prior-version retention without contacting Slack.

The two additive queue/worker migrations were rehearsed in a TEST rollback and
installed on TEST with zero hints. On 16 October at 06:59 UTC the worker moved
from TEST version 15 to 16 and the receiver from version 1 to 2; inventory
confirmed all other functions unchanged. The hosted receiver is **inactive**:
unsigned POST returns 503 and GET returns 405. LIVE has no receiving function
or signing secret. No Slack app setting has changed. Hosted signed delivery
against an approved TEST roster, measured delivery/queue latency under load,
controlled LIVE activation and real post-cutoff channel/reply proof are **not
yet complete**. Do not enable the Events API until these gates pass.

The existing paced Slack queue allows roughly one source job per minute after
settlement. An event wake-up avoids scanning all 160 channels for every new
message, but a sustained arrival rate above that queue's measured capacity
will still accumulate a lag. The release must publish queue age and dead-letter
health and retain a slower reconciliation sweep for missed provider events. It
must not claim a guaranteed 15-minute freshness target until a real channel
and reply trial measures that result.

Reviewing this proposal authorises the exact app change **only after** those
technical gates are ready. Any requested wider scope needs a separate review.
The Event subscription may require a Slack reinstall if the app does not
already hold the verified `channels:history` permission; inspect the installed
scope first and report that requirement before applying it.

Slack documentation: [public-channel event and required scope](https://docs.slack.dev/reference/events/message.channels),
[raw-body signature verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/),
[Events delivery and retries](https://docs.slack.dev/apis/events-api/),
[edit](https://docs.slack.dev/reference/events/message/message_changed/)
and [delete](https://docs.slack.dev/reference/events/message/message_deleted/)
semantics.
