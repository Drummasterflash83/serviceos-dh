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

### Local campaign foundation — 13 October, not deployed

Selected-channel campaigns now retain a fixed cutoff, original approval and one
cumulative request budget across pages/retries. Ten-page continuation, pause, expiry,
revocation and concurrent budget enforcement pass the offline production-schema
rehearsal. Campaign-wide replies, cancellation/handoff and operator UI remain open;
the campaign does not report complete history. No real campaign has been started.
[Implementation and remaining work](LEARN-SLACK-CAMPAIGNS.md).

### Local message handling — 13 October, not deployed

The candidate readers now accept common text-bearing channel events, `/me` messages
and file shares in both channel history and replies. The matching SQL migration
classifies the raw provider payload independently: all accepted records retain their
source/version evidence, but channel activity does not create conversation inputs.
File-share text remains usable while metadata explicitly says file content was not
downloaded. A semantic change between activity and conversation is refused, preserving
prior evidence for review.

Unknown subtypes, hidden event envelopes and EKM-redacted content stop with a safe,
explicit support code. The checkpoint does not advance and no record is silently
skipped. This follows the [Slack message reference](https://docs.slack.dev/reference/events/message/);
it is not a claim that every historical format has been implemented. The recovery
screens explain the incomplete window without exposing provider payloads.

141 focused tests, TypeScript, the frontend build and the full-schema offline
rehearsal pass. Existing archived data/sequence fingerprints and function permissions
are unchanged. No real Slack requests, file downloads, hosted deployment or new
approval were exercised. Campaign automation, private-channel visibility and actual
provider history/reply acceptance remain open.
[Evidence](evidence/learn-slack-message-kinds-2026-10-13.json).

### Hosted state

Hosted TEST worker v11 supports tenant-bound Vault bot or explicitly bound user
credentials, verifies workspace and identity, and imports internal public channels
in approved windows of at most
24 hours. It stores durable checkpoints/source versions, handles rate limits,
deduplicates messages and supports separately paginated observed threads.
Recurring capture revisits retained parents. Two real public-channel messages
were captured in the approved TEST sample, with exact replay verification; real
thread replies, full history and ongoing acceptance remain outstanding.

The deployed TEST transport rejects private/shared channels, DMs and mismatched
credential identities. It does not
enumerate the workspace, orchestrate a whole-history backfill or download files.
These are explicit coverage gaps, not channels with no activity. The current
15-message/60-second policy is conservative; do not promise a full import by
tomorrow before measuring the workspace and permitted throughput.

### Full-schema correction — 12 October, 20:28 UTC

A restored-production rehearsal found that the generic tenant-reference trigger
rejected cross-client operator approval attribution. The same trigger exists in
TEST. Package 082 now replaces only the two Slack approval reference triggers with
a scoped guard: an authenticated, authorised operator may record their own identity;
foreign account/job/message references and impersonated approvers remain blocked.
Workers retain existing approval attribution on checkpoint updates. The generic
foundation guard and unrelated tables are unchanged. All 195 TEST datasets match
before and after installation. The eighteen-package production rehearsal verifies
the actual permission functions and encrypted synthetic Vault, plus legacy bot
storage/thread behaviour. Production and real message capture remain unchanged.
[Evidence](evidence/learn-production-slack-setup-2026-10-12.json).

### OpenFolk operator setup — 12 October, 19:56 UTC

Hosted TEST package 081 adds `learn_slack_configure` for existing OpenFolk admins,
using the existing tenant Vault broker and immutable request/check/cancel receipts.
Workspace/user changes, stale revision, active jobs and enabled recurring capture
block replacement. Configuration remains explicitly unverified until the real
provider path succeeds. It changes no module flag, queue or account grant.

Channel/thread setup, recovery and status readers now use logged operator access
for cross-client support, preserving ordinary client isolation and preview-write
restrictions. Connection metadata uses a safe RPC rather than broadening table
RLS. At 20:16 UTC, the existing OpenFolk input panel and new connection form are
deployed at `test.openfolk.ai` from `e847a52`; the signed-in empty form is verified.
Positive credential submission and real channel/thread capture remain unverified.
[Frontend evidence](evidence/learn-slack-connection-frontend-2026-10-12.json).
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

## Fixed historical ranges — locally verified 13 October, 04:08 BST

The local candidate removes the artificial one-day span restriction across setup,
worker binding, database publication, progress readers and saved recovery forms.
An operator can choose a fixed past start/cutoff covering earlier years, then
continue the retained cursor without manually importing thousands of empty days.
Observed thread approvals can cover replies years after their original root.
Slack supports timestamp bounds with cursor pagination; the existing transport
continues using inclusive boundaries and stable source identities.

Each approval still allows at most ten pages of fifteen observations and expires
after 24 hours. Exhausting pages leaves coverage incomplete; continuation is the
existing explicit reviewed recovery action. This is **not yet unattended full
history orchestration**. A separate durable campaign needs inventory selection,
a total request allowance, automatic checkpoint continuation under that approval,
observed-parent traversal, pause/revocation and coverage/gap accounting. Private
channel visibility and unsupported history events also remain implementation work.

All 134 client/worker tests, TypeScript and the frontend build pass. The full
23-package production-schema restore verifies ten-year channel imports, an old
root with much later replies, exact replay, channel/thread recovery, lost-response
retries, expired approvals, page exhaustion, authority and tenant isolation.
All 388 baseline datasets (1,591,603 rows) and seven sequences match before/after;
only five existing function bodies change, preserving their authority. Rollback
and repeat-apply rejection pass, and the disposable database is removed.

Nothing was installed or activated in either hosted environment. The 23-package
production plan and its existing runtime/frontend artifacts do not yet include
this candidate and must be rebuilt/verified together. The completed real sample
is still closed. [Evidence](evidence/learn-slack-historical-ranges-2026-10-13.json).

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
