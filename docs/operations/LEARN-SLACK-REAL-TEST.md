# Drummonds Slack TEST acceptance — prepared, awaiting approval

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
