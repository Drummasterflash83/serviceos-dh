# Drummonds Slack production intake — approved and started

Updated 13 October 2026. Chris approved the exact production rollout in this chat;
the earlier approved two-message TEST sample is closed and its allowance is not reused.
Existing deployment permission is already recorded. No new login, access grant or
Slack app installation is needed.

## Latest execution

The existing credential was saved through Chris’s signed-in production OpenFolk
control. The UI confirmed encrypted storage. Two immutable campaigns were created:
20 active public channels (`a3980d74` prefix), then 160 archived (`b54d246b` prefix),
with the exact dates, request ceilings and expiry below. Initial dedicated worker
calls saved 37 real messages and 37 source versions; more pages remain. The initial
verification runner counted interactions using the wrong source-type filter; use
`source_table=slack_messages` for the matching readback, not `source_type=slack`.
No complete-history, job matching or AI interpretation acceptance is claimed.

A Slack-only switch is implemented and tested locally to reuse the existing
one-minute platform-worker schedule without enabling Commusoft. Production
activation/verification is the next step; the global input switch stays false.
Private-channel visibility remains unfinished and DMs remain excluded. Chris’s
subsequent “all voicemails and all Slack” instruction expands delivery intent but
does not remove these existing visibility requirements or the DM exclusion.

## Working and verified at preparation

- The existing Heidi-authorised, channel-only credential was verified again against
  DH on 13 October. The refresh used 13 metadata requests: **180 public channels
  (20 active, 160 archived)** and **135 accessible private channels (47 active,
  88 archived)**. There are no shared channels in this inventory. No messages,
  DMs or files were read; no hosted configuration changed.
- Production at 09:48 UTC has **zero Slack connections, credentials, messages,
  campaigns or active jobs**. Its tenant Slack capture gate is on, but the global
  input-dispatch switch is off. Slack worker and scheduler v1 are active. These
  facts establish preparation, not live capture or useful customer understanding.
- The current runtime accepts internal public channels through the consenting
  user credential without requiring her to join each one. Channel identity and
  access are rechecked during each job. A visible channel is not proof that its
  full history remains available.

## Exact proposed production scope

1. Copy the **existing** DH channel-only credential from its authorised Keychain
   entry into the Drummonds production encrypted Vault field `slack:user_token`
   in Supabase `tgbnakbxwcqjeimygroz`, using the signed-in OpenFolk operator form.
   Keep the existing Keychain and 1Password recovery copies. Bind it to workspace
   `T0CC5V4D7`, consenting user `UFF8Y6SSJ`, and production Drummonds tenant
   `00000000-0000-0000-0000-000000000001`. The production credential remains until
   explicitly revoked; it is not a new Slack permission grant.
2. Import retained **public-channel history and observed thread replies**, using
   two independent campaigns with the same fixed window:
   **13 October 2015 00:00 UTC through 13 October 2026 09:30 UTC**. The start is
   before the oldest public channel's recorded creation. Completion means the
   available history in that window, not deleted/unavailable Slack content.
3. Start the **20 active public channels first**, with **10,000 total provider
   dispatch reservations**. Start the **160 archived public channels** as the
   following historical campaign, with **20,000 reservations**. Reservations
   include identity/channel checks, history/replies and retries. The combined
   historical ceiling is **30,000**, expiring **20 October 2026 09:30 UTC**.
   Each page is at most 15 observations; actual unique message totals are unknown.
   Exhaustion or expiry pauses progress for an explicit continuation decision,
   preserving all prior checkpoints. It does not silently renew either budget.
4. After every selected active channel and observed thread has evidence-backed
   completion, use the reviewed **handoff** control to enable ongoing capture for
   those same 20 channels, starting exactly at the historical cutoff. This is
   ongoing access until paused/revoked, separate from the finite historical
   allowance. Keep the 160 archived channels history-only. New/unarchived channels
   require a subsequent recorded selection; this scope does not discover and
   silently add them.
5. Retain original source records, versions, interaction projections, receipts,
   checkpoints and existing data. Verify useful live LEARN visibility and matching
   separately from capture. An imported message does not itself prove that AI has
   interpreted it or connected it to the right job/customer.

The exact IDs and fixed definitions are in the ignored, private execution plan
`.verification-results/slack-production-rollout-20261013.json`, SHA-256
`b438cb69251a25c381e7747f2036f2134d722a86a087cc328d416cbbbe94aaeb`.
That plan pins the refreshed metadata inventory by hash. Do not substitute a new
inventory, date window or budget when executing it.

**Excluded from this production run:** individual/group DMs, private/shared
channels, file downloads, new Slack permissions, Slack writes, new accounts or
grants, and paid AI processing. Message bodies can contain file metadata/links;
that is not permission to download or analyse the linked files.

## Execution and recovery path

- Use `https://www.openfolk.ai/openfolk`, explicitly select Drummonds, open its
  **LEARN input controls → Slack channel capture**. This contains the existing
  `OperatorSlackConnection` form. The client LEARN **View Slack imports** button
  exposes import controls but does not provision the credential.
- Confirm company, workspace, consenting user and reason in the form, then save
  the credential. Resolve its saved request/receipt before retrying any uncertain
  result. Read back the connection ID/revision for the campaign definition.
- Open **Historical campaigns**, paste the plan's active channel IDs, enter the
  exact dates/expiry/request allowance and review the fixed scope before starting.
  The form uses local browser dates: in current London time the cutoff is
  **13 October 10:30 BST** and expiry **20 October 10:30 BST**; the 2015 start is
  **13 October 01:00 BST**. Verify submitted UTC values, not just visible fields.
- Record a fresh retained-data baseline and exact deployed runtime hashes before
  first dispatch. Use only the dedicated `learn-slack-schedule` and
  `learn-slack-worker` endpoints, with their existing infrastructure trigger key,
  no request body, and durable campaign budget enforcement. Check active Slack
  jobs are owned by the approved Drummonds campaigns before each bounded batch.
- The worker processes at most one job per call. Rate limits, inaccessible
  channels, unsupported content and uncertain responses retain their checkpoints;
  inspect them before retrying. Do not bypass the stored authority or tenant checks.
- **Do not simply enable `LEARN_INPUT_DISPATCH_ENABLED`: it also dispatches
  Commusoft.** Initial manual Slack-only dispatch is scoped; dependable ongoing
  scheduling still needs either a verified coordinated activation of both existing
  inputs or an implemented and tested Slack-specific gate. The user's Slack
  approval must not be treated as an unrelated Commusoft activation.
- Verify real message/version/interaction counts, no duplicate source identities,
  observed-reply receipts, customer-visible source evidence and data preservation.
  Record unavailable history honestly. Handoff is allowed only after complete
  fixed-window evidence and no unfinished channel/reply jobs.
- To stop: pause each campaign through its logged operator control and turn off
  the tenant Slack capture switch if needed. Already committed pages can settle;
  in-flight provider requests cannot be recalled. Preserve messages, credentials,
  receipts and recovery evidence. No bulk deletion is a rollback step.

## Needs finishing

- Continue the approved production campaigns and verify full retained coverage.
- A production-only guarded runner and retained baseline, followed by first real
  production messages, replies, deduplication, source-to-card and ongoing checks.
- Dependable Slack scheduling without accidentally enabling unrelated inputs.
- **135 accessible private channels remain in the agreed LEARN scope.** The current
  worker deliberately rejects them because suitable visibility controls are not
  finished. They must not be imported into public-channel visibility or described
  as captured. Complete and verify private-channel access controls separately;
  DMs remain deferred and private.

## Blocked externally

- No new Slack sign-in is currently needed. The existing credential and Heidi's
  identity worked during the fresh metadata check.
- The production credential/import decision has been received and the campaigns
  are recorded; no new Slack sign-in or repeated approval is needed for this scope.
- Slack retention, inaccessible/deleted history and provider rate limits can
  constrain availability or duration. Full-history completion has no verified ETA.
