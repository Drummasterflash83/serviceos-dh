# Drummonds Slack history and ongoing capture

Chris confirmed on 12 October that Heidi has authorised access and historical
Slack communications are essential to understanding jobs. The delivery target is
all available, authorised history plus ongoing capture, including thread replies.
A sample page, today's messages or one completed channel window does not satisfy it.

## Verified workspace access — 12 October

Read-only browser inspection after Heidi completed authentication confirmed the
DH workspace, `drummonds.slack.com` (`T0CC5V4D7`), on **Business+**. Its current
workspace settings say **Never delete messages — don't save edits** for public
channels, private channels and DMs, with retention overrides disabled. These
settings support a historical import but do not prove that every past message
still exists or that previous edit versions can be recovered.

The workspace's Export Data page currently offers a **Standard Export** of public
channel messages/file links and app activity. It explicitly excludes private
channels, DMs, and editing/deletion logs. It offers an application for broader
export access; that application has **not** been submitted. Do not claim that
Business+ or Heidi's admin role alone grants company-wide DM API access.

The developer-app page still lists the existing Openfolk apps, not a confirmed DH
ingestion app. The DH installed-app page was inspected, but its filter did not
produce a reliable filtered result, so absence of an existing app is not proven.
No app was created/installed, channel membership changed, credential provisioned,
export requested or Slack source data imported during this inspection.

Next: establish an app owned/authorised in DH and prepare its exact read-only
scopes and destinations for review. A user-token route can avoid joining every
public channel; private conversations remain bounded by that user's access.
Broader private/DM coverage needs a separately supported and authorised route.
The current bot-only transport must be extended and tested before using a user
credential. Preserve archived-channel coverage and disclose missing edit history.

## Current implementation and gaps

The worker uses a tenant-bound Vault bot credential, verifies workspace and channel
membership, and imports internal public channels in approved windows of at most
24 hours. It stores durable checkpoints/source versions, handles rate limits,
deduplicates messages and supports separately paginated observed threads.
Recurring capture revisits retained parents. Synthetic and production-archive
rehearsal evidence exists; real Drummonds Slack acceptance remains outstanding.

The transport rejects private/shared channels and non-bot credentials. It does not
enumerate the workspace, orchestrate a whole-history backfill or download files.
These are explicit coverage gaps, not channels with no activity. The current
15-message/60-second policy is conservative; do not promise a full import by
tomorrow before measuring the workspace and permitted throughput.

## Connection preparation

1. Verify the authorised workspace, installed app, credential identity, scopes,
   membership and retention. Keep progress notifications separate from ingestion.
2. Enumerate accessible channels, including archived ones, recording creation date,
   public/private/shared classification and access. Founder access does not prove
   access to every private conversation. Mark inaccessible channels explicitly.
3. Review read-only scopes for metadata/history, replies, authors and files. Use
   normal Slack consent for new access and server-side credential storage. Never
   put a user token in the current `bot_token` slot or bypass channel-type checks.
4. Probe a real channel and known populated thread before bulk capture. Current
   official method tables list bot and user scopes; older snippets differ. Choose
   the supported identity using current docs and real responses. Successful
   history retrieval does not prove reply access.

## Historical import acceptance

- Freeze a historical cutoff. Traverse all in-scope channels from available
  beginning through that cutoff in durable windows. Retain bounds, cursors,
  attempts, page receipts and gaps.
- Discover parents during history traversal and independently paginate every
  thread through the cutoff. A root's date must not discard later replies.
  Track inaccessible/deleted parents and unfinished thread pages separately.
- Resume interruptions from retained checkpoints. An expired cursor restarts only
  its fixed window with deduplication; never silently skip history. Honour
  Retry-After and workspace/app quotas. Exhausted budgets mean incomplete capture.
- Show requested and traversed intervals, oldest/newest captured timestamps,
  message/thread counts, pending work and gaps per channel. Empty successful
  windows prove traversal, not empty lifetime history. Provider totals may be
  unavailable; never fabricate a completion percentage.
- Keep ongoing capture progressing from the cutoff while history fills in.
  Reconcile overlap and old-thread replies without duplicate source records.
  Pause/revocation stops new reads while preserving retained communications.
- Explicitly account for files, edits and deletions. A captured filename/link does
  not prove its contents were analysed. Retention-deleted history cannot be
  recovered merely by granting the connector broader scopes.

## Job understanding and showcase

Preserve workspace, channel, author, timestamp, parent and source links. Link
reliable job/customer/site identifiers to the shared business model; ambiguous
matches need review. Missing-information and outstanding-action findings must
cite conversations, show dates/coverage and distinguish unanswered requests from
unavailable history. Check later replies and job changes before treating an
action as outstanding.

The showcase should follow a real conversation through its replies to a linked
job and an evidence-backed outstanding item. Label any demonstration of insights
clearly. Imported messages alone do not establish company-wide analysis.

## Official references checked 12 October

- [History, accessible conversations and rate categories](https://docs.slack.dev/reference/methods/conversations.history/)
- [Separately paginated replies and rate categories](https://docs.slack.dev/reference/methods/conversations.replies/)

Slack distinguishes internal/Marketplace apps from some commercially distributed
apps with tighter limits. Establish ServiceOS's applicable classification;
future multi-client distribution is not automatically an internal Drummonds app.
