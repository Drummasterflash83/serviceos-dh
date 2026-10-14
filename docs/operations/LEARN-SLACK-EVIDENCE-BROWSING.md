# Public Slack company-evidence browsing

14 October 2026. Build 01, extending the existing LEARN V1 product.

## Scope and existing work

Existing LIVE receipts prove source-only public Slack observations, but the Slack
tile previously opened capture/import controls. The source detail reader already
checks the exact retained revision, public/non-shared channel proof, current
connection, tenant/role and logged operator access. This change reuses it.

The new `learn_slack_evidence_read` RPC lists committed mapper-2 observations
whose tenant, interaction, source and receipt bindings match. Each listed message
passes the existing `learn_slack_card_source_read` gate. There is no provider call,
source write, new attribution, processing request or worker/schedule change.

The ordinary-client Slack tile opens **Slack evidence**; import controls remain
under the existing communication-source panel. The operator's **Information**
collection selector includes **Public Slack evidence**, with its existing reason
field. Both use the same browser and retained-source component. Existing client
navigation, Drummonds branding and QuickBooks behaviour are preserved.

## Access, revision and coverage

- Existing tenant owner/admin import-read authority applies to the client reader;
  no role, membership or provider grant is added. Cross-client reads require the
  existing active operator admin authority and a nonblank reason.
- Only committed, unassigned company-source observations are enumerated. The UI
  distinguishes saved observations from completed work, AI summaries and scores.
  This is not a browser of every captured Slack message or a historical-coverage claim.
- Private/shared channels, DMs, absent proofs, changed/unbound source revisions,
  unsupported/tombstoned content and revoked connections never yield source content.
  Capture pause alone does not withdraw authorised retained history.
- Pages show at most 25 observations after scanning at most 50 candidates, using
  stable UUID keyset order. An empty bounded scan can have a continuation; it is
  never presented as exhausted history. No total/chronological order is inferred.
- Operator list and underlying source reads are audited. Audit failure prevents a
  result. Every request rechecks authority; views expire after one minute and clear
  on backgrounding/scope change. Delayed old-company responses are discarded.
- Detail reads compare the current source revision with the listed revision.
  Changed sources are withheld and require reloading the evidence list. Existing
  source corrections/history and identity holds are retained.

## Verification to date

- Nine focused source/client tests pass; application TypeScript and production
  build, including required prebuild checks, pass. Subsequent source/UI wording
  changes are bounded and rechecked before release.
- An offline full-schema rehearsal preserves 390 archived tables, 1,591,601 rows
  and seven sequences on installation. Real SQL assertions verify public/private/
  shared/DM proof boundaries, 40 valid observations across bounded pages, empty
  continuation, changed source, capture pause, revocation, cross-tenant owner,
  operator reason/audit failure and grant revocation. Synthetic changes roll back;
  only the expected transactional capture-sequence advance is recorded. Reader/index
  rollback and reapplication pass, and the disposable container is removed.
- TEST exact-source prerequisite/readback and rolled-back hosted synthetic journey
  pass. The additive function/index are installed; all existing public function
  definitions/owners/grants and eleven Drummonds-scoped source datasets are preserved.
  This does not establish a signed-in TEST browser or real provider coverage.
- The synthetic actual-component browser verifies client/operator modes, reason
  gating, source opening, plain-text untrusted markup, next-page failure/retry,
  changed-source denial and company switch during a delayed response. A second
  synthetic company displays its own channel; this is portability, not live acceptance.

Private rehearsal, catalog and preservation journals remain in
`.verification-results/learn-slack-evidence-*`; they are excluded from Git. The
rehearsal runner initially lacked the synthetic interaction's required timestamp;
the fixed complete rehearsal passes. Hosted rehearsal initially encountered a
fixture-string dollar-quoting issue and then a pre-existing synthetic namespace;
both transactions failed/rolled back. Callback replacement and a fresh verified
namespace fix the runner without changing permissions or existing records.

## Release and recovery

Backend source: `supabase/migrations/20261103010000_learn_slack_evidence_browse.sql`.
The release runner requires matching full-schema rehearsal, exact existing source
reader, catalog baseline, rolled-back hosted journey, durable mutation intent,
exact installed body/permissions and fixed-cutoff canonical-source preservation.
Uncertain outcomes use `verify`, never a blind apply retry.

Frontend candidates must be based on each **actually deployed** TEST/LIVE commit,
overlaying only the browsing files. Do not deploy the whole checkpoint branch:
it contains other staged work. Build remotely from Git; verify stable aliases,
backend binding, existing protection and signed-in client/operator paths.

Rollback the isolated frontend aliases to their retained exact prior deployments.
The additive reader can remain installed; remove only its function/index after
all new callers are reverted if backend removal is necessary. Do not roll back
shared worker v78 or unrelated QuickBooks work, drop retained sources, cancel
campaigns or change access as a browsing rollback.

TEST and LIVE release and signed-in acceptance are recorded below. Build 01 includes
the other outstanding V1 obligations in its receipt; this feature alone cannot
close the stage or the expanded Build 10 gate.

## Hosted release and acceptance — 14 October, 11:30 UTC

- Both isolated candidates pass TypeScript and production builds. TEST `7c3a9b9`
  / `dpl_4AQQbHsj92X7KCLkD9yF8iaa8WAY` serves both stable TEST aliases;
  LIVE `2eb6971` / `dpl_H94PaQFAWXR2w5NzJcAqjmD227aj` serves all four existing
  LIVE aliases. Existing redirects, domain configuration and protection are unchanged.
  Each actual candidate login renders its correct Supabase target. The LIVE build
  badge confirms `2eb6971`, production and the LIVE backend.
- Signed-in TEST operator read requires a reason, returns an empty page for its
  selected company and writes one list audit. That company has no eligible sources;
  no synthetic observations were left in the hosted database to manufacture a result.
- The signed-in LIVE client Slack tile returns 25 real observations on each of
  two pages. A real original message opens with its matching revision/provenance.
  The view expires and clears after one minute. Existing Drummonds branding remains.
  This uses the existing owner session, not a separate staff identity.
- Explicit LIVE operator selection, collection/reason, 25-row list and original
  message also pass. Database readback finds one matching list audit and 26 source
  audits (25 list checks plus the opened message). No console errors/warnings were
  observed. The final clean operator view contains no retained message contents.
- LIVE installed reader source/permissions and underlying source reader match.
  All eleven fixed-cutoff source inventories reconcile: ten are identical; one
  currently captured Slack message changed, with its exact prior fingerprint
  independently reproduced from immutable retained history. No source IDs vanished.
  The later catalog difference reconstructs exactly to the three separately
  released QuickBooks functions. No baseline was silently replaced. Hashing uses
  smaller resumable pages after large-page network timeouts.
- The stronger LIVE tombstone derivation guard initially rejected a synthetic
  fixture. The corrected hosted fixture respects that guard and explicitly checks
  its denial; the transaction rolled back. The migration file was renumbered only
  to avoid the concurrent QuickBooks migration number; its installed bytes/hash
  are unchanged.

[Sanitised acceptance evidence](evidence/learn-slack-evidence-browsing-2026-10-14.json).
The exact prior deployment for rollback is recorded per alias in that evidence.
No audio bytes, credentials, private message contents or runtime manifests enter Git.
