# Drummonds Slack TEST acceptance — bounded historical sample completed

Run `315c7d05-deb3-4869-9895-1622d5d70403` targets existing Drummonds TEST tenant
`f8c114fa-fee7-4983-8970-f6e7f5fd3129` in Supabase `saatxzwxvdvqevbnskxy`,
using Chris's existing ongoing OpenFolk operator login at `test.openfolk.ai`.
No new account, operator grant or Slack app permission is required.

The earlier Slack approval explicitly covered app installation, local Keychain /
1Password storage and metadata verification. It reserved hosted credential storage
and message imports for a separate decision. This proposal covers that next step;
ordinary TEST/live deployment permission is already recorded.

## Exact scope

- Copy the existing channel-only DH user credential from the authorised Keychain
  entry into this tenant's encrypted TEST Vault field `slack:user_token`, through
  the deployed operator connection form. The credential remains bound to DH
  (`T0CC5V4D7`) and the already verified consenting Heidi identity. Keep existing
  local/1Password copies. The hosted copy remains for subsequent approved work.
- Enable only this tenant's Slack capture switch. Keep Email, Phone, Commusoft and
  other clients' switches unchanged. Do not install schedules or enable recurring
  subscriptions. The LEARN master switch is already on.
- Capture a fixed past window: **12 October 2026, 00:00–19:00 UTC**, from the two
  already inventoried public channels **07-engineer-technical** (`C07V0V0UKHN`)
  and **05-engineer-wins** (`CEJ0026TW`). At most two pages of 15 messages per
  channel. Stop at the bound and report incomplete coverage if a cursor remains.
- Capture replies for at most two parents actually discovered in those messages,
  within the same window, at most two pages per parent. Do not guess parent IDs.
- If completed scopes exist, replay the technical channel once and one observed
  parent once, within the same two-page limits, to verify stable source identities
  and deduplication. Do not replay an incomplete or uncertain operation.
- Maximum **180 message observations including replays**, with duplicate roots /
  repeated pages distinguished from unique stored messages. Maximum **201 read-only
  Slack provider requests**, including identity/channel checks and retries. The
  runner permits at most 12 one-job worker calls (at most three provider requests
  per call); a further at most 21 read-only identity checks are allowed. The tighter worker
  bound also caps observations if a request must be retried before storage. Empty
  or failed invocations still consume this budget; stop rather than expanding it.
- Pause Slack capture after the run or a blocking failure. Retain its source
  messages, versions, interaction projections, checkpoints and audit evidence.
  Verify the source-to-LEARN path through the existing operator information view.

No individual/group DMs, private/shared channels, file downloads, paid AI calls,
Slack writes, new permissions or production changes are included. Provider file
metadata/links may occur inside a captured message; that does not mean the files
were downloaded or analysed. Message storage is not proof of AI interpretation,
customer/job matching or completion of all Slack history.

Private-channel visibility and complete authorised history remain required work
under the launch goal; this initial public-channel acceptance does not defer them.

## Prepared evidence and execution

At 20:07 UTC, read-only preflight confirmed zero target Slack connections,
messages or import approvals, zero active Slack jobs across TEST, no enabled
recurring Slack subscription and no TEST cron catalog. Slack is off; LEARN is on.
One unrelated email job remains queued and must not be claimed by this run.
The dedicated Slack worker claims Slack jobs only.

Hosted packages 080 and 081 are installed; Slack worker v11's downloaded source and
seven idle HTTP checks pass. The operator setup migration passed a rollback
rehearsal and preserved all 194 existing datasets. The frontend uses the existing
OpenFolk design and existing logged operator authority. No human session is
exported or impersonated.

`node scripts/verify/learn-slack-real-test.mjs prepare|baseline|inspect|step --existing-cli-login`
requires `LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy`. The private plan is
`.verification-results/slack-real-test-20261012.json`; never recreate it to reset
budgets. `step` additionally requires `LEARN_REAL_SLACK_APPROVED_RUN` to equal this
run ID after approval. It checks exact tenant, workspace, channel/window/page
scope, worker version, active-job ownership, approval counts and run budget.
A local exclusive lock prevents simultaneous runners from sharing the budget; a
crashed lock requires inspection. The consenting user is pinned to the verified
Heidi identity, and queued jobs must map to the reviewed import/account scopes.
An uncertain invocation stops further dispatch until its retained job/page state
has been inspected. All changes to credentials and import approvals use the
signed-in operator UI; the runner dispatches only the already approved work.

Before capture, record the retained-data baseline; after it, reconcile only the
reviewed source, queue, connection, switch and audit additions. Never replace an
older baseline or count a general table-count match as proof of row preservation.
No real message capture has occurred at the time this proposal was written.

### Preparation update — 20:16 UTC

The exact frontend `e847a52` is deployed on both permanent TEST aliases; the
signed-in empty Slack connection form is visible and usable. Approval has been
requested but not received. Baseline attempts were read-only: a combined digest
response exceeded the 4 MiB transport limit, and a per-table attempt hit management
HTTP 429. No baseline was saved and no provider dispatch occurred. The revised
reader batches at most eight pages of 10,000 row digests per request and verifies
each table against its original full-table digest. It remains to be executed once
the management rate limit clears. Do not bypass the baseline gate or recreate the
private run plan to reset its budget.

**Baseline completed at 2026-10-12T20:18:13.565Z.** The batched reader succeeded for all 195
datasets. Every retained row digest reconciles with its initial full-table
fingerprint. The private baseline contains no raw source records or credentials.
Earlier failed attempts did not save or replace a baseline. No Slack credential
or message import has yet occurred; approval remains pending.

**Operator attribution fix installed at 20:28 UTC.** Full production-schema
rehearsal uncovered and corrected a generic tenant-reference check that rejected
cross-client operator approvals. TEST package 082 installs the same scoped fix,
with all 195 datasets unchanged. No credential or message was copied. The existing
run ID, retained baseline, requested scope and tighter twelve-invocation limit
remain unchanged; do not recreate or reset the run.

## Approved execution — 12 October, 20:58 UTC

Chris approved the exact credential and bounded TEST import in this chat. The
existing channel-only credential was saved through the signed-in operator form.
TEST package 083 was installed first, with all 195 datasets unchanged; the full
production-schema ongoing channel/reply and pause/resume rehearsal passed offline.
No production change or new account/grant was made.

Both authorised 00:00–19:00 UTC channel windows completed in one page each, but
returned zero messages. Two worker invocations were acknowledged; no observed
parents existed, so no reply or duplicate-message acceptance can be claimed.
Capture was paused after the run. Provider access and empty-window settlement are
proven; actual message storage, replies and deduplication still need real evidence.

One browser date-entry attempt initially retained the form's default 24-hour
window. It was caught before dispatch: its job had zero attempts, no lease and no
source records. With capture paused, that exact job was cancelled and its original
settings retained in its audit metadata; its immutable approval was preserved.
The corrected request then used the approved UTC window. The acceptance runner
recognises only that exact unexecuted cancelled record as excluded from execution;
its existing provider/message budgets were not reset or increased.

### Approved historical date-window amendment — 12 October, 21:05 UTC

To find actual conversations without expanding destinations or message budgets:

- Reuse this same TEST tenant, encrypted credential and existing operator login.
- Make at most one read-only latest-message discovery request per already-approved
  public channel (two total), limit one message each, ending at 12 October 19:00
  UTC. Keep only the returned timestamp/channel/retention metadata for choosing a
  window; do not log the message body or copy it to a new location.
- For each channel with an available message, import one past UTC calendar day
  containing that observed timestamp, bounded to at most 24 hours and ending no
  later than 12 October 19:00 UTC, at most two pages. Record exact selected windows
  before queuing. Do not guess a parent or silently expand an empty result.
- Include at most two parents observed in those captured messages, and one channel
  / one parent replay only if the original cumulative budgets permit it.
- Preserve the original cumulative caps: 180 message observations, 201 read-only
  Slack requests, and 12 total worker invocations including the two already used.
  The two one-message discovery responses count against message observations.
  Retain the two completed empty windows and the cancelled unexecuted approval.
- Pause capture afterwards. No DMs, private/shared channels, files, paid AI,
  recurring schedules, new grants or production changes.

This changes the approved date selection, not access permissions or destination.
Chris approved this amendment in chat. Discovery completed in five read-only
requests (identity, two channel checks and two one-message reads). Both channels
were public, joined and not shared; the responses did not report retention limits.
Selected windows, recorded before queuing:

- Engineer technical: 1 October 00:00 UTC to 2 October 00:00 UTC.
- Engineer wins: 7 October 00:00 UTC to 8 October 00:00 UTC.

Discovery retained timestamps and scope metadata only. Its two observations and
five requests count against the original cumulative caps; earlier receipts and
the original run ID remain intact. These samples do not establish full history.

**Completed at 21:14 UTC.** Both selected windows completed in one page, each
storing one ordinary message with a source version and LEARN interaction. The
single technical-window replay retained all six exact rows unchanged. Neither
message contained an observed thread parent; no replies were requested or verified.
Capture is paused, with no active Slack jobs or recurring subscriptions. Six total
worker invocations include the two original empty windows and one paced no-op.
Five total message observations include discovery and replay. The conservative
provider-request upper bound is 23, within the original 201 cap. The runner rejects
further dispatch after this completed historical sample; unused capacity is not a
new import approval. [Sanitised acceptance evidence](evidence/learn-slack-real-history-2026-10-12.json).
