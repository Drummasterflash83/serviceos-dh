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

The approved **OpenFolk LEARN - Drummonds** app (`A0C8G0STUKV`) is now installed
in DH as Heidi. Fourteen read-only API requests verified identity and traversed
the accessible conversation metadata in 12 pages. This identified **180 public
and 135 private channels**, including archived channels. These are accessible
channels, not a claim of every private channel in the company. No message reads,
file downloads, membership changes, export request or hosted capture occurred.

Chris subsequently excluded **individual and group DMs**. Their metadata was
present in the initial authorised inventory, but no DM messages were fetched.
All four DM scopes have now been removed from the app configuration. Because
[Slack retains removed scopes on existing tokens](https://docs.slack.dev/app-management/distribution/),
the original token was revoked and replaced with the narrower channel grant.
At 19:28 UTC, two additional `auth.test` requests verified the old token is
rejected and the replacement matches the previously verified DH/Heidi identity.
The granted scopes exactly match the seven manifest scopes plus Slack's
`identify` scope. Individual/group DM scopes are absent.

Next: provision the reviewed hosted credential destination and verify real
channel/thread capture, then implement private-channel
visibility controls. Preserve archived-channel coverage and disclose missing edit
history. Do not enumerate or ingest DMs with the replacement credential.

## Current implementation and gaps

Hosted TEST worker v11 supports tenant-bound Vault bot or explicitly bound user
credentials, verifies workspace and identity, and imports internal public channels
in approved windows of at most
24 hours. It stores durable checkpoints/source versions, handles rate limits,
deduplicates messages and supports separately paginated observed threads.
Recurring capture revisits retained parents. Synthetic and production-archive
rehearsal evidence exists; real Drummonds Slack acceptance remains outstanding.

The deployed TEST transport rejects private/shared channels, DMs and mismatched
credential identities. It does not
enumerate the workspace, orchestrate a whole-history backfill or download files.
These are explicit coverage gaps, not channels with no activity. The current
15-message/60-second policy is conservative; do not promise a full import by
tomorrow before measuring the workspace and permitted throughput.

### OpenFolk operator setup — 12 October, 19:56 UTC

Hosted TEST package 081 adds `learn_slack_configure` for existing OpenFolk admins,
using the existing tenant Vault broker and immutable request/check/cancel receipts.
Workspace/user changes, stale revision, active jobs and enabled recurring capture
block replacement. Configuration remains explicitly unverified until the real
provider path succeeds. It changes no module flag, queue or account grant.

Channel/thread setup, recovery and status readers now use logged operator access
for cross-client support, preserving ordinary client isolation and preview-write
restrictions. Connection metadata uses a safe RPC rather than broadening table
RLS. The existing OpenFolk input panel exposes the existing Slack controls in local
source. The frontend and signed-in journey have not yet been deployed/accepted.
Hosted installation preserved all 194 original datasets; its new request table is
empty. [Evidence](evidence/learn-slack-operator-setup-2026-10-12.json).

### Hosted TEST acceptance — 12 October, 19:47 UTC

The matching package 080 and worker v11 are installed. The exact schema package
passed rollback rehearsal before installation. All 194 datasets match across
schema, runtime and HTTP checks. Downloaded source has fourteen matching executable
modules and one omitted type-only module with no runtime importer. Seven HTTP
access/empty-queue checks pass. No Slack credential was uploaded, no channel was
activated and no provider call was made. Real-provider acceptance is still required.
[Sanitised evidence](evidence/learn-slack-user-hosted-2026-10-12.json).

### Locally verified user credential path — 12 October

The local worker now supports an explicit `credential_kind: user` and
`authorized_user_id`, selecting only `user_token` in Vault. Legacy bot connections
retain `bot_token`; malformed user configuration never falls back to it. The real
`auth.test` response must match both stored workspace and consenting user. The
credential kind/user remain pinned across every authority recheck, even if a
configuration change fails to update its revision.

Public-channel user access can proceed without claiming the user is a member;
the attestation preserves the real membership flag. This follows
[Slack's documented user-token access](https://docs.slack.dev/reference/methods/conversations.history/).
Bot membership rules remain intact. Private/shared channels and individual/group
DMs remain rejected by this transport stage. Private-channel visibility is still
required work, not a silently deferred part of the goal.

Migration `20261101560000_learn_slack_user_credential.sql` updates ten existing
setup, credential, recovery and recurring functions while retaining their current
grants and consent/claim/tenant/revision gates. Its credential readers resolve the
selected field's tenant-qualified Vault namespace. It installs no secret, account,
job or schedule and changes no communications.

All 63 Slack unit tests pass. Isolated PostgreSQL rehearsals pass on both user and
legacy bot routes, including real history/thread credential readers, rollback,
unchanged function grants, recurring thread discovery, pause/revocation and
concurrent scheduling. The fixture uses synthetic records and a synthetic Vault
table; the full production schema/actual Vault and hosted worker/provider round
trip remain separate acceptance gates. No message reads, hosted changes or
production promotion resulted from these tests.

## Connection preparation

### Installed DH app — channels only

The reviewed configuration is
[`drummonds-readonly.manifest.json`](../../infrastructure/slack/drummonds-readonly.manifest.json),
named **OpenFolk LEARN - Drummonds**, for DH (`T0CC5V4D7`). It requests a **user**
credential authorised by Heidi, with read-only scopes for public channels,
accessible private channels, workspace people/email
identity and accessible files. Exact scopes are in the manifest. It has no bot,
message-writing, joining, invitation, deletion, administration or webhook scopes.
It cannot read conversations between other people merely because Heidi is admin.

Installation grants persistent access until revoked; token rotation is initially
disabled because automatic refresh is not implemented. The replacement credential
is verified in this Mac's Keychain and the already-authorised **Openfolk ServiceOS** 1Password
item. No token belongs in Git, browser storage, public frontend configuration or
the existing `bot_token` field. A hosted `user_token` destination and capture
activation must be explicit and supported by the corresponding tested backend.

Identity, exact scopes and metadata verification are complete, with private
journals in `.verification-results/slack-dh-inventory-20261012.json` and
`.verification-results/slack-dh-channel-credential-receipt.json`. Neither journal
belongs in Git. The replacement matches both stored copies, the private transfer
file was removed, and unrelated 1Password fields were preserved. The original
credential is invalid. Rotation review remains due by 10 January 2027.

These checks do not establish message, thread, attachment or job-link acceptance.
Unsupported paths remain inactive. No all-conversations export application has
been submitted. Hosted credential storage and activation are still separate from
the approved local installation/metadata work.

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
