# LEARN V1 delivery and acceptance checklist

This is the authoritative remaining-work checklist for Chris's 11 October 2026
goal: complete and launch Drummonds' LEARN V1 through OpenFolk. Detailed component
documents retain implementation history; their older status statements do not
override a later release observation. No requirement is silently deferred.

## Current evidence and priority

**15 October, 16:28 UTC — Chris clarified first scorecard priority and email-history choice.**

### Working and verified

- Chris chose **job progress and completion** as the first LIVE scorecard priority.
  Job, customer and team cards have distinct purposes: customer health needs its
  own evidence, while an actionable card should surface for the responsible team
  member and move to the next owner only after a verified handoff. This is a
  business direction, not approval of an unreviewed scoring formula or publication.
- A read-only LIVE aggregate found 143,456 saved Drummonds emails: 95,039 from
  the last year, 23,569 from years one to three, and 24,848 older than three
  years. Of the older-than-three-year set, 18,780 were saved in the past 24
  hours. The oldest observed year is 2015. Current Gmail list requests have no
  date cutoff; ordinary Workspace message sync is actively traversing mail,
  while the separate historical-backfill accounts currently report idle.

### Needs finishing

- Add an **OpenFolk operator-selected, tenant-scoped email import horizon** to
  new-client onboarding, with three years suggested, one year and complete
  available as deliberate choices, and an explicit calendar cutoff for a custom
  choice. Freeze the choice when a mailbox traversal begins, apply it to provider
  listing and continuation, and display both selected and observed coverage.
  Do not silently change Drummonds' running traversal or delete saved history.
  Current/recent evidence must carry more weight than older mail in any eventual
  health or score calculation; older mail may still establish relationships and
  provenance. This setting needs TEST and LIVE acceptance before claiming it works.
- Translate the job-first card direction into evidence-backed criteria and
  responsible-owner routing, review the draft with Chris, then publish only
  after score inputs and recipient permissions are verified.

### Blocked externally

- Final business acceptance remains Chris's decision. The first eligible full
  working-day observation is 16 October.

**15 October, 16:22 UTC — first keyless daily attempt stopped at its export limit; bounded retry running.**

### Working and verified

- The first fresh dedicated-reader attempt (`4d4105ea`) opened a read-only LIVE
  snapshot and wrote 959 MB of a native archive. Its 30-minute timer stopped
  `pg_dump` before completion. The failed attempt is recorded as unverified;
  temporary containers were removed and its incomplete archive was deleted.
  The exporter now allows up to 90 minutes, with a 100-minute outer export
  bound and a 300-minute manual hosted-job bound. The new keyless attempt
  (`911be91a`) began at 16:17 UTC and is still exporting; no completed copy or
  restore can be claimed yet.
- The whole-project daily package/transfer ceiling was raised from 1 to 2 GiB
  to leave measured growth room without truncation. Forty-one focused Node
  transport/package tests, 19 Python package tests and daily-runner tests pass.
  The corrected manual-only `main` workflow is pinned to TEST source `eda9e747`
  at main commit `529c778c`; no hosted retry or schedule has run since the
  first public-tool path failure.
- An aggregate LIVE identity read found 197–199 valid durable receipts per
  200-row retry attempt, with zero receipt-shape errors; one to three deliveries
  per attempt remain unconfirmed. A bounded revision-refresh handler passed
  local tests and is checkpointed at `ac706bc5` on TEST. It has **not** been
  deployed to TEST or LIVE, and the actual cause of every failed row is still
  unproven. LIVE worker and TEST worker versions differ, so a full runtime
  preservation rehearsal is required before any promotion.

### Needs finishing

- Complete the new backup, isolated native restore, encrypted off-site copy,
  independent download and later recovery-key/Vault restore. Rehearse the hosted
  runner without overlapping the local source export; prove a missed-success
  alert before enabling a daily schedule.
- Diagnose the ordinary identity retry after 16:21 UTC and safely rehearse the
  code change across the actual TEST/LIVE worker baselines. Continue source,
  Slack, cards, scoring, full application/Auth and full-day observation gates.

### Blocked externally

- Chris's Drummonds scoring criteria and final business acceptance remain
  pending. The first eligible full working-day observation is 16 October.

**15 October, 16:09 UTC — hosted backup access approved and manual rehearsal corrected; daily activation remains open.**

### Working and verified

- Chris explicitly approved encrypted Actions secrets for the public repository's
  main-only `serviceos-database-backup` environment. The dedicated production
  reader, London S3 Writer and separate Restore credentials are present as three
  environment secret names; values were not read back or committed. The reader's
  direct TLS and privilege proof remains valid. This standing scope differs from
  the earlier single-copy authorization and is recorded as such.
- Chris separately approved the one manual-only workflow on `main`. Its first
  hosted run (GitHub run `38766107889`) completed checkout but failed in public
  tool preparation because the Linux runner could not create a macOS `/private`
  path. The credential-bearing export step was skipped, so it made no source
  database read or S3 copy. The Linux path fix and its pinned source are on TEST
  at `aad0070dc1ca152209757628a154c4a478998673`; the corrected manual-only
  `main` workflow is commit `b42f93e9019a6832cfa09d7b56cd2331a4526a02`.
  No daily schedule or missed-success workflow is on `main`.
- The separate local LIVE backup still exports a native archive with the
  dedicated keyless reader. Its result, isolated restore, encryption and
  independent off-site copy are pending; this is not a verified daily backup.

### Needs finishing

- Finish the local backup before dispatching another hosted rehearsal, then
  prove the hosted export, isolated native restore, encrypted London copy,
  independent download, recovery-key restore and missed-success notification.
  Activate daily scheduling only after those gates pass. Continue the Slack,
  source/card/scoring, full application/Auth recovery and full working-day gates.

### Blocked externally

- Chris's Drummonds scoring criteria and final business acceptance remain
  pending. The first eligible full working-day observation is 16 October.

**15 October, 15:58 UTC — dedicated database reader verified; fresh keyless backup and hosted-runner preparation underway.**

### Working and verified

- Chris approved the standing, whole-project production backup-reader access.
  The exact role passed TEST and LIVE rollback rehearsals, then installed in
  LIVE. Its password was stored and read back from the scoped local Keychain
  item without Touch ID or command-argument exposure. A direct verified-TLS
  login confirmed the role's read access to Auth and encrypted Vault, default
  read-only setting and lack of administrator privileges without reading rows.
  The source-access checkpoint is `bb95dd59`, with ARM runner compatibility at
  `9575af80` and manual-only workflow/monitor candidates at `ddb74fa0` on the
  TEST branch.
- A fresh LIVE export began at 15:44 UTC using that reader without a Management
  API login refresh. Its native archive is still being written; isolated restore,
  encryption and off-site verification are not yet proven for this attempt.
  The public GitHub repository has an empty `serviceos-database-backup`
  environment restricted to `main`. No credential was placed there and no
  hosted workflow or daily schedule was activated.
- The missed-success checker now evaluates the latest successful hosted backup
  completion against a 26-hour threshold. Its boundary cases pass local tests;
  no hosted alert has run yet.

### Needs finishing

- Complete the fresh source-to-off-site attempt and a separate recovery-key
  restore, then prove a reliable hosted runner and missed-success alert before
  daily activation. Continue Slack reply/catch-up, source/card/scoring, full
  app/Auth recovery and the eligible 16 October working-day observation.

### Blocked externally

- Automatic approval review rejected sending the whole-database and AWS
  credentials into the public repository's Actions environment; it requires an
  explicit decision on that exact destination. The environment remains empty.
  Chris's scoring criteria and final business acceptance also remain pending.

**15 October, 15:34 UTC — guarded Slack catch-up scheduler installed in TEST and LIVE; provider catch-up remains open.**

### Working and verified

- A LIVE aggregate capacity read found the 160-channel historical campaign had
  no channel-day above 98 messages, with one active reviewed higher-throughput
  profile. It also found 870 observed reply roots in 69 channels. Repeating those
  roots for every 15-minute catch-up interval would be costly while the saved
  13 October cutoff remains more than a day behind all 160 subscriptions.
- The exact scheduler-only migration passed rollback rehearsal in TEST and LIVE,
  then installed with one ledger receipt in each. Both installed function hashes
  match. LIVE retained all 160 subscriptions and the credential, source-completion
  and observed-reply gates. Existing first windows keep their original 15-minute
  scope; later windows use up to 72 hours only while over a day behind, then
  return to 15-minute windows near live. The ten-page limit and incomplete-window
  hold remain. A read-only check at 15:34 found 11 channels past the cutoff,
  zero cutoff regressions and 22 current channel jobs succeeded. The larger
  windows have not yet run to completion, so this is release proof, not ongoing
  provider acceptance.
  [Release receipt](evidence/learn-build01-slack-catchup-release-2026-10-15.json) ·
  [capacity readback](evidence/learn-build01-slack-catchup-2026-10-15.json) ·
  [handoff readback](evidence/learn-build01-slack-handoff-2026-10-15.json).
- At 15:34 both Workspace aliases were ready; eligible Email sources without
  interactions had fallen to 791. All 3,805 active cards retained projection
  and evidence. Email identity-ready grew to 32,327 while one identity job
  remained in its scheduled retry until 15:39:49; the source backlog cannot
  be called clearing until the ordinary job succeeds. Graph missing nodes
  remain 18,830. These are point observations, not full-day acceptance.

### Needs finishing

- Observe first long Slack window and its reply jobs. If the ten-page cap holds
  a busy window, recover that exact boundary without advancing or skipping it.
  Continue Email projection/identity and graph backlog checks after their
  ordinary retries, plus source/card/scoring, backup, full app/Auth restore
  and Friday 16 October working-day acceptance.

### Blocked externally

- The proposed standing backup-reader access remains pending Chris's separate
  answer. Drummonds scoring criteria and final business acceptance require
  Chris's review.

**15 October, 15:19 UTC — all 160 Slack recurring windows started; source identity remains evidence-gated.**

### Working and verified

- The existing saved macOS Keychain CLI login supports production read-only
  diagnostics without opening 1Password. The current snapshot found both
  monitored Workspace aliases ready; email source volume rose from 137,265 at
  14:33 to 137,667 at 14:42, and eligible missing graph nodes fell from
  17,067 to 16,434. A separate aggregate failure readback found six
  `source_ineligible` Workspace jobs in the last hour, all no later than 14:26,
  before the 14:35 mailbox recovery. There were no blocked `fetch_failed`
  checkpoints at 14:42. This is a point-in-time result, not a full-day pass.
- An independent 14:46 aggregate read found 4,360 eligible email sources
  without interactions, down from 4,891 at 14:42. All were created within
  the past day, and none had a review-required or committed projection
  receipt. This is an active backfill queue, not proof of final coverage;
  continue checking that its oldest age and total fall as new mail arrives.
- At 14:50 the same read fell to 4,009. One ordinary Graph job reported
  `graph_sync_error` on its first attempt, then succeeded at 14:52 without a
  manual rescue. The Graph missing-node count grew to 17,267 during this
  email burst; its catch-up rate needs observation rather than a success claim.
- At 14:55 eligible Email sources without an interaction fell again to 3,684,
  with none older than one day. The last two hours included 44 successful Graph
  jobs, seven after retry, with no terminal Graph failure; the latest job was
  queued. These point observations do not establish sustained clearance.
- An aggregate LIVE scoring read at 14:57 found zero saved Drummonds scorecard
  definitions, published policies, scorecard measurements or saved assessments.
  The scoring framework exists, but there is no accepted LIVE scoring baseline
  or evidence for a real score. [Count receipt](evidence/learn-build01-scoring-readiness-2026-10-15.json).
- Chris confirmed the exact saved public Slack campaign `b54d246b` handoff.
  The LIVE browser recorded it at 15:00:33 UTC, and an independent database
  read found 160 of 160 channel subscriptions enabled with observed replies,
  all starting at the saved 13 October 2026, 09:30 UTC cutoff. The historical
  campaign is closed as `ongoing`, with no remaining campaign binding or
  cutoff regression. By 15:16, the ordinary scheduler had created all 160
  first recurring windows: 16 channel jobs had succeeded and 144 were queued.
  This proves complete first-window dispatch, not complete recurring-provider
  or observed-reply acceptance. The immutable handoff request independently
  records 160 exact cutoff/reply approvals; at 15:19 nine channels had already
  advanced their next start beyond that cutoff with zero regression.
  Individual and group DMs remain excluded.
  [Handoff readback](evidence/learn-build01-slack-handoff-2026-10-15.json).
- The noninteractive hourly working-day observer now includes the exact
  recurring Slack scope and reply job type. A separate LIVE source/status
  readback found 84,923 enriched Email interactions, 30,127 still ready for
  identity work and 21,226 held for review. Of the Email review holds,
  19,830 are `company_ambiguous`; 508 lack a contact, 836 have unverified
  email and 52 have ambiguous people. Slack has 35,036 `direction_unverified`
  identity holds. These are explicit evidence restrictions, not silently linked
  customer conversations. The latest identity job was retrying, while recent
  identity batches had recorded review-required outcomes; trend and recovery
  still need observation. The single active identity retry has a saved next run
  at 15:39:49 UTC after attempt four of five. Its tenant job key prevents a
  second concurrent identity batch, so the ready queue cannot be called
  unattended-clearing until that ordinary retry settles. Four older identity
  inventory jobs remain terminal, separate from 1,141 identity jobs ending in
  a review-required outcome.
  [Coverage distribution](evidence/learn-build01-interaction-coverage-2026-10-15.json) ·
  [queue timing](evidence/learn-build01-identity-queue-2026-10-15.json).

### Needs finishing

- Observe normal recurring Slack channel/reply jobs through completion and
  later intervals. Continue source, interaction, identity, graph, card,
  scoring-policy, backup and application/Auth recovery checks and observe the first
  eligible full working day on 16 October.
- Resolve the ready Email identity queue through ordinary bounded work and
  review ambiguous cases using their source evidence. Do not infer company or
  person links merely to clear the counts.

### Blocked externally

- Standing backup-reader and recurring encrypted-copy decisions remain pending.
  Drummonds' scoring criteria and acceptance baseline need business review;
  Chris will review and sign off the final business result.

**15 October, 14:35 UTC — held Workspace mailbox recovered by ordinary scheduled work; Build 01 remains open.**

### Working and verified

- A successful, read-only Gmail profile proof can now permit the ordinary
  scheduled worker to claim only the exact `admin_delegation_missing` Workspace
  checkpoint generation and revision. Missing, mismatched and later failed
  proofs remain blocked. The claim records
  `confirmed_mailbox_profile_recovery` as a system action and preserves the
  saved continuation; it does not attribute a rescue to Chris.
- The exact rule passed rollback rehearsals, installed synthetic smoke checks
  and earlier bounded-fetch regression checks in both TEST and LIVE. Independent
  readback found matching function digest `da6714f06b6287a80950329c7f4c43d1`,
  unchanged protocol owner and grant, a helper callable only by that owner,
  and no retained synthetic tenant.
- The real 14:30 queued job then ran without manual intervention. At 14:35 it
  recorded one system-labelled automatic claim, completed successfully with
  no new messages, and advanced the saved checkpoint from revision 825 to 828
  with no remaining block. The zero-record pass verifies renewed access and
  continuation, not new message coverage.

### Needs finishing

- Continue observing normal intervals and the full real working day; this one
  successful pass does not establish sustained operation. Continue the broader
  Build 01 source/card/scoring, Slack, backup and Auth acceptance work.

### Blocked externally

- Standing daily backup-reader and recurring encrypted-copy approvals remain
  pending. Chris's business sign-off follows the technical acceptance pack.

[Guarded recovery release evidence](evidence/learn-build01-email-verified-delegation-recovery-2026-10-15.json).

**15 October, 14:22 UTC — exact held Workspace mailbox verified without a fingerprint; Build 01 remains open.**

### Working and verified

- A new internal, read-only Gmail profile diagnostic uses the saved macOS
  Keychain CLI login, then verifies the caller's existing service role with
  Supabase Auth. It never returns a key, mailbox address, history ID or message.
  TEST exposed a mismatch between its runtime service-key secret and the
  currently valid project key; the first version failed closed. The corrected
  version passed five hosted access checks in TEST before its exact source was
  released to LIVE. Every pre-existing Edge endpoint remained unchanged.
- LIVE passed the same five access checks. One exact held Drummonds mailbox
  returned `provider_verified` from Gmail. Two audit records bind the check to
  checkpoint revision 825. The checkpoint remained blocked and unchanged;
  no Gmail write, message read or manual resume occurred.

### Needs finishing

- Use this exact, recent proof for a guarded system-labelled recovery of the
  `admin_delegation_missing` hold, then verify an ordinary scheduled capture
  completes. The profile result alone is not a successful mailbox sync.
- Broader source/card/scoring coverage, Slack continuation, independent daily
  backup, full application/Auth recovery, the real unattended working day and
  Chris's business review remain open.

### Blocked externally

- Standing daily backup-reader and recurring encrypted-copy approvals remain
  pending. The mailbox's Google grant no longer appears to require an admin
  change, based on this point-in-time profile check.

[Exact mailbox proof evidence](evidence/learn-build01-email-held-mailbox-proof-2026-10-15.json).

**15 October, 13:46 UTC — two legacy Workspace fetch blocks recovered by ordinary scheduled work; Build 01 remains open.**

### Working and verified

- The guarded ordinary claim path was committed and verified at GitHub TEST
  checkpoint `ed911c48133942f6f6e6c1a5a1e9349d1a17d3f5`. It permits only a
  recent Workspace `fetch_failed` checkpoint with its matching immutable
  transition receipt, confirmed zero message/thread/ID/gone writes, a live
  account, a five-minute cooldown and fewer than two failures in two hours.
  The accepted claim marks `confirmed_zero_write_fetch_retry`; it does not
  attribute the action to a human or clear the saved continuation.
- The exact change passed rollback rehearsals, independent definition/grant
  readbacks and installed synthetic rollback probes in TEST and LIVE. Both
  probes included a negative blocked checkpoint lacking the matching receipt;
  it remained blocked. No synthetic fixture persisted, and LIVE installation
  did not alter the two old checkpoints directly.
- A follow-up guard, installed at 14:00 UTC after separate TEST and LIVE
  rollback rehearsals and smoke checks, also counts failures in the two hours
  **at the time of the original block**. Its synthetic aged third-failure case
  remains blocked even after the rolling window expires. The final installed
  function digest is `1b978429b0f1ee916b545f5c56953739` in both
  environments, with the same owner, grant and no retained fixture.
- The ordinary LIVE 13:45 scheduled work subsequently claimed and completed
  both old `fetch_failed` checkpoints. Their revisions advanced from 759 to
  761 and 777 to 779, with one system-labelled automatic claim and a
  successful Workspace sync for each. Both are ready again. This is real
  unattended recovery after the release, without a fingerprint or manual
  rescue. The first 14:05 scheduler interval after the tightened guard found
  both still ready with later successful runs, zero unconfirmed enqueues and
  26 acknowledged duplicate active jobs.

### Needs finishing

- The 13:46 observation still showed 20 queued Workspace jobs. Continue
  watching the queue and later capture; a single successful interval is not
  the required full working day. The next 13:50 scheduler tick confirmed six
  more jobs but left 26 queued; queue throughput needs observation. A separate
  `admin_delegation_missing` block remains under review. Its mailbox and
  connection are active, with 454 successful same-connection Workspace runs
  in the preceding two hours; this does not prove delegation for that exact
  mailbox. Broader source/card/scoring, Slack incremental
  capture, independent daily backup, full application/Auth recovery and
  Chris's business sign-off remain open.
- A 13:55 read-only review check counted 4,412 current interaction-projection
  holds, 55,731 identity review holds, and still returned bounded pending
  projection and identity work. These are not failed processing receipts to
  clear blindly; attribution and scoring must remain evidence-gated.
- The existing hourly working-day monitor now uses the noninteractive
  read-only checks and explicitly avoids 1Password/Touch ID. Friday 16 October,
  09:00–17:00 Europe/London is the first eligible full-day observation window
  after today's recovery releases; it has not yet elapsed.

### Blocked externally

- Standing daily backup-reader and recurring encrypted-copy approvals are
  pending. Mailbox-specific provider verification is needed before resuming
  the delegation hold; Workspace admin action may be necessary if it fails.

[Guarded automatic recovery evidence](evidence/learn-build01-email-safe-claim-2026-10-15.json).

**15 October, 13:27 UTC — bounded Workspace fetch retry released in TEST and LIVE; Build 01 remains open.**

### Working and verified

- A confirmed zero-write recent Workspace fetch failure now leaves its exact
  continuation ready for a later scheduled job. A third such failure within
  two hours blocks for review. Permanent delegation errors and unknown
  persistence still block immediately; every failed attempt retains its audit
  receipt and failed status.
- The exact function change passed rollback rehearsals and installed-function
  synthetic probes in both TEST and LIVE. Independent readback found the same
  candidate digest in both, unchanged protocol owner and service-role grant,
  and no retained synthetic rows. The release changed no existing checkpoint.

### Needs finishing

- Two checkpoints blocked before this release on `fetch_failed` still need an
  exact, auditable recovery; a third remains blocked on
  `admin_delegation_missing` and needs provider-authority diagnosis. At 13:27
  UTC, 22 source-ineligible jobs in the preceding two hours reflected these
  holds. A real scheduled retry under the new rule has not yet been observed.
- The full unattended working day, broader source/card/scoring acceptance,
  ongoing Slack handoff, independent backup and full app/Auth recovery, and
  Chris's business sign-off remain outstanding.

### Blocked externally

- Standing daily backup-reader and recurring encrypted-copy approvals are
  pending. A permanent Google delegation failure may require Workspace admin
  action if fresh server-side verification confirms the grant is absent.

[Bounded retry TEST/LIVE evidence](evidence/learn-build01-email-bounded-retry-2026-10-15.json).

**15 October, 13:10 UTC — keyless daily backup candidate tested; Build 01 remains open.**

### Working and verified

- A new package format and one-attempt runner can verify an isolated native
  restore, encrypt with the existing public age recipient, and independently
  verify a copied ciphertext without reading the recovery key. The real 10:04
  snapshot was repackaged locally into a 1,060,652,040-byte format-2 artifact;
  its native archive and archived/restored Vault ciphertext fingerprints match.
  This was a format test, not a fresh daily source export or new off-site copy.
- The one-attempt runner stops on an unconfirmed stage and never retries a
  failed Touch ID read. Twenty-nine focused Node tests and thirteen Python
  tests pass. The existing 1Password key remains reserved for a separate,
  supervised Vault/database recovery drill.
- A read-only LIVE preflight found 421 physical user tables, 398 with RLS,
  and no dedicated backup-reader role. A 13:10 UTC read-only health check also
  confirmed the current email checkpoint state without a fingerprint prompt.

### Needs finishing

- A dedicated, reviewed source login, unattended host, standing copy scope,
  schedule and missed-success alert are not active. The fresh export and
  source-to-off-site chain have not run. The new package has not been decrypted
  or restored, and full application/Auth recovery remains unverified.
- The unattended working-day observation failed again: two recent Workspace
  checkpoints are blocked after `fetch_failed`, one after
  `admin_delegation_missing`, and sixteen recent jobs were source-ineligible.
  The two fetch failures have confirmed zero persistence writes; a bounded,
  audited automatic recovery still needs implementation and LIVE proof.
  Source/card/scoring coverage, ongoing Slack handoff and Chris's business
  acceptance also remain open.

### Blocked externally

- Standing broad database-reader access and recurring encrypted off-site
  transfer need a specific access review before activation. A supervised
  recovery drill will need one private-key unlock; the routine backup should
  not ask for Touch ID.

[Keyless daily backup candidate and current blockers](evidence/learn-build01-keyless-daily-backup-candidate-2026-10-15.json) ·
[daily source-access design](../../infrastructure/database-backup/DAILY-SOURCE-ACCESS.md).

**15 October, 12:50 UTC — fingerprint-free package preparation verified on the real snapshot; Build 01 remains open.**

### Working and verified

- One active Workspace mailbox's blocked `persistence_failed` recent checkpoint
  passed an exact rollback rehearsal and a guarded, audited claim/release. It
  moved from revision 607 blocked to 609 ready without clearing its saved
  continuation. Its next ordinary scheduled capture succeeded at 12:03 UTC;
  the checkpoint advanced to revision 611 ready. No source provider write or
  captured history was discarded. This manual recovery restarts the unattended
  observation window.
- The signed-in LIVE OpenFolk operator can again load paged Email, Phone and
  Slack account evidence. The same bounded reader passed TEST before LIVE,
  with unchanged function owner and grants. Scheduling checks are also visible.
- The independent company-totals service and its isolated three-file frontend
  change passed TEST, then were released to LIVE through verified Vercel Git
  candidates. Existing domain redirects, access protection and backend bindings
  were preserved. The signed-in LIVE operator view showed 130,895 stored emails
  and 3,075 stored recordings, including six held for review. The totals carry
  their own observation time; missing totals do not hide account cards.
- The backup runner now has a public-key-only preparation/copy path for an
  already verified database snapshot. Synthetic package and separate-role copy
  tests pass without a recovery-key read. The supervised restore path now asks
  1Password once after download and does not retry a failed Touch ID prompt.
  The real 10:04 UTC checkpoint was repackaged locally into a new
  1,060,273,064-byte encrypted artifact with no private-key access or fingerprint
  prompt. The new package is still local and has not been independently restored;
  it is not a second off-site acceptance.

### Needs finishing

- The original mailbox persistence error still needs root-cause prevention and
  a full real working day without manual rescue. The retained-email summary
  reports 1,549 mailbox bindings whose availability is unverified; six Phone
  recordings are held for review. Scheduling status now loads but reports
  overdue Gmail OAuth and recommendations plus signal, identity and graph work
  needing attention. These are operational gaps, not a completed green state.
- The public-key path has not yet completed an actual fresh daily off-site run
  or alert check. The current off-site restore got past the 1Password read and
  started in an offline container, but was interrupted before verification.
  Its container and decrypted working copy were removed. This is not a passed
  isolated restore or full application/Auth recovery.
- Source-to-interaction, graph, card and scoring gaps, ongoing eligible Slack
  channel/reply capture, voicemail source/route holds, daily backup, full
  application/Auth recovery and signed-in business acceptance remain open.
  The already downloaded latest off-site database package has not passed its
  isolated restore: the key read succeeded, but the drill was interrupted
  before the database comparison completed.

### Blocked externally

- A supervised off-site restore still needs one private-key unlock at the start
  of that actual recovery drill. Chris's business sign-off follows the
  technical acceptance pack.

[Mailbox recovery and operator-health evidence](evidence/learn-build01-mailbox-and-health-recovery-2026-10-15.json) ·
[separate company-totals backend](evidence/learn-build01-separated-capture-totals-2026-10-15.json).

**15 October, 11:47 UTC — LIVE midday source review; Build 01 remains open.**

### Working and verified

- The completed public Slack history window remains 160/160 channels and 870/870
  observed reply threads. Ordinary Email, Commusoft, graph and card work continues.
  At 11:39 UTC, all 4,561 Phone calls had interactions, 3,735 of 3,744 active
  cards carried projection evidence, and 2/2 active Gmail aliases were ready.
  Review-required identity and projection jobs still delivered thousands of
  records rather than failing wholesale.
- The exact encrypted database object remains independently uploaded and
  downloaded. Recovery-only retries did not re-export or re-upload it.

### Needs finishing

- An active Workspace user mailbox has a `persistence_failed` recent checkpoint
  blocked since 04:54 UTC; 15 ordinary jobs in the last two hours ended
  `source_ineligible` against it. Recorded account, mailbox and connection
  authority still passes. Its failed attempt has unknown persistence evidence,
  so recovery must preserve the checkpoint, use an exact guard, and prove the
  next ordinary capture. No recovery has been applied yet.
- At 11:39 UTC, 4,762 eligible Emails still lacked interactions, 18,662 eligible
  interactions lacked graph nodes and nine active cards lacked projection
  evidence. The signed-in operator capture and scheduling health panels returned
  unavailable after refresh. Some voicemail routes need source review, and the
  selected ongoing Slack channel is not enabled. Source-to-card/scoring acceptance,
  dependable operation, full app/Auth recovery and the full unattended day remain open.
- The off-site isolated database restore still stops at the recovery-key read;
  no database restore was started on those recovery-only attempts.

### Blocked externally

- The encrypted backup's isolated restore needs a successful ordinary 1Password
  Touch ID read in the same running process. Chris's business review and sign-off
  follow the technical and operational evidence pack.

[Midday LIVE source review](evidence/learn-build01-midday-source-review-2026-10-15.json) ·
[off-site transfer](evidence/learn-build01-offsite-transfer-2026-10-15.json).

**15 October, 11:18 UTC — approved LIVE Slack history window complete.**

### Working and verified

- The existing 160-channel public Slack campaign reached
  `campaign_window_complete` on every approved channel through ordinary work.
  All 160 thread-discovery scans are complete, and all 870 observed reply
  threads are `captured` with complete import checkpoints. The request ledger
  reserved 11,695 of 20,000 approved requests, with zero channels in
  `needs_review`. Individual and group DMs remained outside scope.

### Needs finishing

- This is the approved fixed history window, not proof of unavailable older
  messages, ongoing incremental Slack operation, the full unattended day or
  source-to-card/scoring acceptance. Independent database restore from the
  fresh off-site package, dependable daily backup and full app/Auth recovery
  remain separate gates.

### Blocked externally

- Chris's business sign-off follows the completed technical and operational
  evidence pack. The fresh off-site restore currently awaits the ordinary
  1Password Touch ID authorization for its recovery-only continuation.

[Completed Slack campaign](evidence/learn-build01-slack-campaign-complete-2026-10-15.json) ·
[approved off-site transfer and pending restore](evidence/learn-build01-offsite-transfer-2026-10-15.json).

**15 October, 10:37 UTC — exact encrypted recovery package prepared; independent transfer awaits exact approval.**

### Working and verified

- The fresh checkpoint was age-encrypted into 1,060,273,064 bytes, 13,468,760
  bytes inside the existing 1 GiB limit. The package was decrypted and the
  exact database/Vault archive restored again in an isolated local container.
  The committed recovery fix and the concurrent QuickBooks commits were merged
  without rewriting history; GitHub TEST checkpoint `2ac4c31a` was verified.

### Needs finishing

- The prepared package has no transfer attempt, independent download or off-site
  restore receipt. The ordinary Slack campaign, source/card/scoring coverage,
  full app/Auth recovery and full unattended day remain open.

### Blocked externally

- Automatic approval review rejected the exact encrypted production database
  upload to the existing private London backup destination twice before
  execution. It requires explicit, destination-specific user authorization for
  this payload. No alternate transfer route was used. Chris's later business
  sign-off remains a separate gate.

[Prepared package and approval gate](evidence/learn-build01-offsite-package-prepared-2026-10-15.json).

**15 October, 10:29 UTC — fresh independent database checkpoint restored locally; off-site copy pending.**

### Working and verified

- A new LIVE read-only snapshot produced a 1,057,045,013-byte native archive.
  Its network-isolated restore matched 3,844,006 archived COPY rows, 2,652
  supplemental operational rows, every archived sequence, the catalog and
  extensions, and all 3,057 recording relationships without missing Storage
  metadata. The disposable container was removed.
- One Vault row changed after the snapshot, so a comparison to later LIVE state
  correctly failed. A snapshot-bound recovery path now proves that the archived
  and restored Vault COPY rows match and all 20 archived secrets decrypt, while
  explicitly withholding a later-LIVE equality claim. Ten focused package and
  tamper checks and ten runner checks pass; no key or plaintext was saved.
- Chris reports Vercel is paid. The saved account credential returned HTTP 200
  for both exact TEST and LIVE Vercel projects with the expected team. This
  verifies read access; the next release still needs its own write/readback gate.

### Needs finishing

- Encrypt this new checkpoint, measure the exact package against the existing
  1 GiB ceiling, copy it to the independent London destination and restore that
  exact copy. The archive alone leaves 16,696,811 bytes before evidence and
  encryption. Dependable daily database operation, full Auth/application
  recovery, source/scoring acceptance and the real unattended day remain open.

### Blocked externally

- Chris's business sign-off follows the completed technical and operational pack.

[Fresh recovery evidence](evidence/learn-build01-fresh-database-recovery-2026-10-15.json) ·
[Vercel access readback](evidence/learn-build01-vercel-access-2026-10-15.json).

**15 October, 09:58 UTC — stale completed-reply labels repaired in TEST/LIVE.**

### Working and verified

- The 68 `queued` reply members observed in the approved campaign, and 84
  receipt-complete `queued` members across LIVE campaigns at release time, had
  complete import checkpoints and matching successful worker jobs. The campaign
  step's early return skipped its existing label normalization. An exact guarded
  change passed TEST and LIVE rollback rehearsals, then was installed separately
  in both. LIVE now has zero receipt-complete `queued` members and all 837
  observed threads in its 159 completed channels say `captured`. The 1,362
  retained thread members, campaign authority, provider scope and restricted
  function access were preserved.

### Needs finishing

- The final approved channel still has active history continuation; its reply
  discovery and ordinary terminal transition remain to be observed. TEST had
  no campaign members for a synthetic status journey, so the actual retained-row
  repair is evidenced by LIVE rollback/install readback. Continue the real
  unattended-day and broader Build 01 gates.

### Blocked externally

- Chris's business sign-off follows the completed technical and operational pack.

[Completed-thread label evidence](evidence/learn-build01-slack-completed-thread-labels-2026-10-15.json).

**15 October, 09:51 UTC — approved Slack campaign near its final channel.**

### Working and verified

- The LIVE fixed-window campaign has 159 of 160 approved public channels in
  `campaign_window_complete`. Their 159 thread scans are complete, and all 837
  observed threads have complete checkpoints with matching successful worker
  jobs. At 09:51 UTC, 11,218 of 20,000 requests were reserved, with zero
  campaign channels in needs-review. No DM was included.

### Needs finishing

- The last channel remains queued for its next history page, with 6,200 retained
  messages observed so far; it has not completed its approved history window or
  reply discovery. Sixty-eight thread-member rows still say `queued` despite
  complete checkpoints and successful jobs, so review status presentation before
  claiming a clean operator handover. Keep the campaign under its fixed approval
  and budget. A real full unattended day remains required.

### Blocked externally

- Chris's business sign-off follows the complete technical and operational pack.

[Slack campaign coverage evidence](evidence/learn-build01-slack-campaign-coverage-2026-10-15.json).

**15 October, 09:43 UTC — source/card catch-up is active but incomplete.**

### Working and verified

- At 09:40 UTC, 3,708 of 3,718 active LIVE cards had projection evidence.
  Ordinary graph work reduced the eligible missing-node gap from 24,652 at
  09:06 UTC to 22,506. In the trailing hour, 21 graph jobs processed 7,587
  records and 37 card jobs processed 7,159; identity and interaction projection
  published 3,310 and 2,009 records respectively while retaining review holds.
  The exact read-only service projection and review RPCs returned 200 candidates
  and 4,412 holds in 1.17 and 0.80 seconds at 09:41 UTC.

### Needs finishing

- The eligible Email-to-interaction gap was 4,615 at 09:40 UTC versus 4,592 at
  09:06 UTC: capture and projection are close over this short interval, but the
  backlog has not drained. One Phone call and ten newly active cards lacked
  downstream projection at the snapshot. An in-flight card job retained a prior
  partial-failure code; observe its final outcome. Continue real-day monitoring
  and representative content/scoring acceptance.

### Blocked externally

- Chris's business review awaits a completed technical and operational pack.

[Live coverage window](evidence/learn-build01-live-coverage-window-2026-10-15.json).

**15 October, 09:36 UTC — active Slack claim scan narrowed in TEST/LIVE.**

### Working and verified

- A LIVE Slack history page waited about 14 minutes to be claimed while four
  dedicated-worker requests returned HTTP 503. The exact read-only claim plan
  took 7.12 seconds across a broad retained-job index. A partial index limited
  to active Slack history/reply work passed rollback rehearsals, then was
  installed separately in TEST and LIVE. The equivalent claim plans now take
  3.45 ms in TEST and 0.17 ms in LIVE, with unchanged claim functions, job
  counts, approval policy, source scope and access. The held page and its next
  ordinary continuation each delivered 100 records without a manual worker
  invocation before the index release. At 09:36 UTC the approved campaign still
  had zero needs-review channels, one active continuation and 11,083 of 20,000
  requests reserved. Three fresh post-index history pages then each claimed in
  the next ordinary minute and succeeded on attempt one with 100 records. The
  short post-index Edge window had two Slack-worker HTTP 200 responses after a
  pre-install 503.

### Needs finishing

- Continue observing post-index jobs and dedicated-worker health through the
  full required window; the exact cause of the earlier 503 responses remains
  unproven. Finish eligible channel history and replies within the approved
  campaign, preserving DM exclusion and review holds. Broader source/card/
  scoring coverage, full application/Auth restore and a real uninterrupted
  working day still require evidence. Chris's business sign-off is outstanding.

### Blocked externally

- Chris will review and sign off only after the technical and operational
  evidence pack is ready. Build 02 remains inactive.

[Active Slack claim index evidence](evidence/learn-build01-slack-claim-index-2026-10-15.json).

**15 October, 09:14 UTC — identity Phone selection narrowed; broader V1 work remains.**

### Working and verified

- The LIVE identity selector's nearly empty Phone lane scanned 151,329 unrelated
  interactions to find three calls (2.7 seconds). An equivalent read-only
  source-index plan found the same three in 12 ms. The exact selector change
  passed TEST synthetic isolation/order/revision and LIVE real 200-row rollback
  comparisons, then was installed separately in TEST and LIVE with unchanged
  access. The first post-install service read returned 200 rows; a newly
  claimed ordinary page then delivered 141 records and recorded 59 review holds
  on its first attempt. This is a narrow query repair, not proof that every
  intermittent retry is fixed.
- At 09:06 UTC, all 3,705 active LIVE cards had current projection evidence,
  Phone source/interaction counts both reached 4,537, and ordinary Commusoft,
  Email, graph and Slack work continued. Review-required identity pages retain
  explicit holds while delivering eligible rows.

### Needs finishing

- Observe sustained identity continuation and diagnose any remaining inventory
  retry. The eligible Email-to-interaction gap was 4,592
  and eligible graph gap 24,652 at 09:06 UTC; capture is still outpacing parts of
  the downstream catch-up. Card presence does not establish source/scoring
  completeness. Follow the approved Slack campaign through its continuation.
- A fresh full unattended working day, broad signed-in source/scoring acceptance,
  dependable independent database operation, full app/Auth restore and Chris's
  business review remain required. Build 02 is inactive.

### Blocked externally

- Chris will sign off only after the technical and operational evidence is ready.
  The Vercel payment warning remains an account risk, although release is serving.

[Identity selector release evidence](evidence/learn-build01-identity-phone-prefetch-2026-10-15.json).

**15 October, 08:56 UTC — exact Slack retry released in TEST/LIVE; second held page recovered.**

### Working and verified

- Normal Vercel sign-in was restored. The isolated one-line Slack recovery change
  now serves both protected TEST aliases and all four existing LIVE aliases.
  Exact Git sources, backend targets, redirects and protection settings passed
  readback. The signed-in TEST Drummonds workspace and LIVE Drummond's workspace
  loaded; LIVE public Slack evidence opened an original message and its next
  page. The TEST tenant had no public observations to exercise that held page.
- A reasoned, one-page LIVE recovery for the remaining `slack_history_failed`
  channel was submitted through the authorised operator control. Its ordinary
  worker job succeeded once with 100 records. Campaign readback shows zero
  `needs_review` channels and one active continuation, with the approved window
  and request allowance intact. This does not prove the full campaign is done.
- After an intermittent inventory retry, ordinary mixed projection delivered
  four consecutive 200-email pages. At 08:47 UTC the eligible Email gap was
  3,660, Phone calls/interactions matched at 4,534, the graph gap was 24,855,
  and 3,680 of 3,705 active cards had current projection evidence. Recent
  identity pages delivered 135–183 cards each with explicit review holds.

### Needs finishing

- Follow the Slack continuation and all source/card/graph queues to their
  required coverage. An identity batch was again retrying after an intermittent
  inventory error; its later outcome and sustained throughput need proof.
- The reasoned Slack recovery at 09:46 BST interrupts today's 09:00–17:00
  unattended observation. Start a fresh full working-day window with no manual
  rescue. Prove full application/Auth restore, source and scoring acceptance,
  then present the evidence and business result for Chris's sign-off. Build 02
  remains inactive.

### Blocked externally

- Chris's business acceptance is outstanding. The Vercel account still shows
  an overdue-payment warning, although today's TEST and LIVE releases worked;
  no payment was made.

[Exact release and recovery evidence](evidence/learn-build01-exact-slack-release-and-retry-2026-10-15.json).

**15 October, 08:20 UTC — scheduled files verified; TEST exact-retry candidate built but not promoted.**

### Working and verified

- The independent 09:00 BST local recording/voicemail run completed at 09:18
  BST. Its health readback verified 3,044 Phone files and 255 matched voicemail
  email/audio pairs, with zero missing references in those inventories. Monthly
  restore checks remain current. This is one successful scheduled day, not proof
  that the Mac stays awake or that the whole application can be restored.
- The separate TEST Vercel project is linked to the already approved GitHub
  repository. Automatic production-domain assignment was disabled and read back;
  the one-line exact Slack retry candidate built READY as a protected Preview.
  Stable TEST aliases were not promoted.
- LIVE Phone calls and interactions both reached 4,529. The eligible graph gap
  fell from 27,022 at 08:07 UTC to 25,984 at 08:19 UTC.

### Needs finishing

- The eligible Email gap rose from 3,804 to 4,037 over those readbacks. A mixed
  continuation entered retrying after an intermittent inventory error, due
  again at 08:31 UTC. Its prior 200-row page was committed; the new retry is
  not yet an unattended recovery success. Full-day operation remains open.
- Verify the TEST preview's rendered backend binding and signed-in held-page
  journey before assigning stable aliases. Complete the matching LIVE release,
  second held Slack page, broad V1 source/card/scoring acceptance, full app/Auth
  recovery, and Chris's business review.

### Blocked externally

- The Vercel account shows an overdue-payment warning. It has not stopped the
  protected TEST preview build, but could affect future releases; no payment
  was made. Normal Vercel CLI device authorisation is still unavailable.

[Scheduled-run, LIVE readback and TEST preview evidence](evidence/learn-build01-working-day-and-test-preview-2026-10-15.json).

**15 October, 07:46 UTC — ordered Email projection has resumed in ordinary LIVE work.**

### Working and verified

- The email candidate scan still intermittently timed out after the earlier
  read-path repairs. An exact query-plan comparison found that the previous
  LEFT JOIN form hashed and sorted a large retained tenant set before applying
  the 200-row limit. An equivalent indexed anti-join passed TEST synthetic and
  LIVE real rollback comparisons with zero ordered-row/revision differences and
  unchanged function permissions. It is installed in TEST and LIVE. The exact
  LIVE service call then returned 200 candidates in 1.4 seconds; two ordinary
  LIVE batches published 400 retained emails and queued serial continuations.
- The ordinary identity lane is publishing roughly 160–190 records per recent
  batch. Its terminal `identity_review_required` label also records durable
  evidence holds; it is not by itself a lost-delivery error. A read-only hold
  audit found 30,014 Slack `direction_unverified` and 13,872 Email
  `company_ambiguous` rows, plus smaller unverified/missing/ambiguous email
  groups. None warrants inferred attribution.
- A LIVE recovery inventory found one active Edge Function without source in
  this checkout: `phone-operations` v16. Its exact four-file source tree is now
  retained in the repository recovery archive after comparison with a private
  read-only download of the deployed source. This closes one source-code gap,
  not the full application/Auth restore.

### Needs finishing

- At 07:45:54 UTC, 6,314 eligible retained emails still lacked interactions;
  new capture increased the gap during the observation. Prove the ordinary
  continuation can outpace capture, drain the backlog and deliver evidence to
  cards, while retaining case-specific holds. The earlier 07:15 infrastructure
  failures invalidate that period as a full unattended working day.
- Finish the wider source, scoring, recovery, signed-in release and human
  acceptance gates in the Build 01 receipt. Chris has not signed off.
- Auth settings, signing-key material, runtime secrets, isolated Auth/frontend
  startup and controlled capture resumption still require independent recovery
  proof; the database archive alone cannot supply them.

### Blocked externally

- The Slack exact-retry frontend cannot yet be promoted through the existing
  TEST release path: the saved Vercel CLI credential is rejected and normal
  device authorisation is unavailable. Backend TEST parity is installed, but
  signed-in TEST retry and matching stable TEST/LIVE frontend release remain open.

[Ordered Email scan and ordinary-run evidence](evidence/learn-build01-projection-ordered-anti-join-2026-10-15.json).
[Runtime recovery inventory](evidence/learn-build01-runtime-recovery-inventory-2026-10-15.json).

**14 October, 22:41 UTC — frontend and bounded graph release verified; Gmail alias resumed.**

### Working and verified

- A stale frontend document requested an obsolete dynamically imported route
  after the serving build changed. The root error view's Try again action now
  reloads the document for that specific error, obtaining current route assets;
  other errors retain their existing reset path. Isolated candidates were built
  from each exact currently serving Git commit and changed only the root error
  component. TypeScript, lint, 47 prebuild checks and both production builds pass.
- The rendered candidates had their correct separate Supabase targets. The two
  protected TEST aliases now serve `c3ed81d7` / `dpl_5v1UQiMqVxfwwxVdVHZrtmr3XBQ9`;
  four LIVE aliases serve `e614eb52` / `dpl_EcUCHusjTKceNQ2DSPAokoDHDJ3N`.
  Each alias, redirect, domain and protection setting passed exact readback.
  Signed-in Drummonds TEST and LIVE workspaces and Modules pages loaded; the
  LIVE Drummond's branding stayed intact. This resolves the observed stale-route
  retry failure, not complete application/Auth disaster recovery.
- The LIVE graph job that stopped after its first claim was safely reclaimed and
  succeeded on attempt two at 22:19:34 UTC with one completion event. Its first
  lighter, interaction-only child succeeded at 22:21:09 UTC in about eight
  seconds, touching 150 interactions and creating 100 nodes/283 edges, and queued
  the next serial child. Three further 100-missing pages also succeeded. A
  400-interaction TEST fixture then proved a larger 200-missing page in two
  serial ordinary worker runs with 400 final nodes, two keyed events and complete
  cleanup. TEST graph endpoint v8/worker v37 and LIVE endpoint v49/worker v88
  match downloaded source. The first LIVE 200-missing page finished in about
  14 seconds at 22:29 UTC, created 200 nodes/578 edges, published one completion
  event and queued the next child. Its identity/card/recommendation phases did
  not repeat. The second LIVE 200-missing page also succeeded at 22:31:16 UTC,
  created 200 nodes/568 edges, published one event and queued a third page.
- A current read found one active Gmail alias blocked after a `fetch_failed`
  capture at 19:54 UTC. The latest scheduled job had dead-lettered as
  `source_ineligible` while that checkpoint remained blocked. Its directory
  binding and both read-only delegated Gmail profiles were valid. A single
  revision-fenced operator claim/release was rollback-rehearsed and applied;
  the checkpoint is ready at revision 55 with no owner or block. Exact readback
  finds one successful audited recovery attempt, one claim, one release, zero
  source-page receipts and zero records processed. Prior failed runs remain
  visible. Its next ordinary scheduled capture succeeded at 22:41 UTC with 25
  records and a ready checkpoint; the other active alias also succeeded with 25.
  Both have continuing pages and do not yet prove complete mailbox coverage.

### Needs finishing

- Observe repeated larger graph pages and reconcile the growing historical gap,
  recommendations and scoring. The email/card pipeline, legacy review holds,
  broad source coverage, full app/Auth recovery and real full working-day
  unattended acceptance remain open. Chris is the business reviewer; he has
  not yet signed off. Do not activate Build 02.
  At 22:29 UTC, 18,600 of 42,240 eligible interactions still lacked a graph node,
  and 41,877 retained emails lacked an interaction. These are current gaps, not
  complete coverage claims.
- The recovered Gmail alias must remain healthy through a real working-day
  window. This manual recovery before the
  window does not establish unattended reliability; recurrent transient fetch
  failure would require a separate durable recovery correction.

### Blocked externally

- No specific provider or access blocker was established by these releases.

[Frontend recovery evidence](evidence/learn-build01-frontend-recovery-2026-10-14.json),
[graph history evidence](evidence/learn-build01-graph-history-2026-10-14.json),
and [alias recovery evidence](evidence/learn-build01-alias-fetch-recovery-2026-10-14.json).

**14 October, 22:07 UTC — graph history has a confirmed LIVE page; recovery observation continues.**

### Working and verified

- The graph's latest-record window omitted 13,905 of 36,645 eligible retained
  interactions at LIVE baseline. A service-role-only, tenant-bound selector now
  pages the oldest missing exact source identities in groups of 100 while the
  ordinary refresh still updates recent rows. Existing same-tenant person,
  company and card endpoints are loaded by their direct saved IDs for older
  interaction edges; no source text is used to infer a link.
- TEST rollback and service-only permission checks passed. A 120-interaction
  synthetic TEST run reached 116 nodes on its first ordinary worker pass, then
  all 120 on its one serial continuation, with two succeeded jobs, two keyed
  completion events, no remaining missing nodes and complete fixture removal.
  The LIVE selector was separately rehearsed before installation. The first
  ordinary LIVE run succeeded at 22:01:35 UTC: 300 interactions touched, 109
  nodes and 653 edges newly created, one completion event, and a serial child.
  TEST graph endpoint v7 / worker v36 and LIVE endpoint v48 / worker v87 are
  ACTIVE, and every downloaded package matches its staged source. The production
  build and its prebuild checks pass.
- The queued graph job initially waited behind continuing priority-50 email/card
  work. Internal and existing five-minute scheduler graph enqueues now use that
  same priority; TEST confirms the exact queued priority, tenant rejection and
  de-duplication. The second LIVE run repeated the full identity window and was
  still running without recent writes at 22:07 UTC. A lighter interaction-only
  continuation then passed TEST's two-page drain and was released in both
  environments; an already-running old-code claim remains fenced until recovery.

### Needs finishing

- Confirm the second LIVE claim settles or is safely reclaimed, then measure
  repeated lighter continuation jobs, rate and terminal evidence. New email
  interactions were arriving faster than the first 100-row history page, so
  full graph catch-up is not yet established.
- At 21:58 UTC the retained-email-without-interaction count had fallen to
  46,799, while the ordinary projection queue was still active. All 75 newly
  published Phone calls still had exact committed card receipts. A later
  aggregate audit found 3,600 distinct legacy Phone calls and 13 emails with
  `legacy_projection_review` receipts, more than the earlier 700-Phone snapshot.
  These old canonical records require reconciliation; no broad overwrite or
  automatic approval is implied.
  Reconcile graph recommendations and edges separately. This change does not
  establish complete source-to-card, scoring or unattended working-day coverage.

### Blocked externally

- No new provider or access blocker is established by this graph release.

[Sanitised graph-history evidence](evidence/learn-build01-graph-history-2026-10-14.json).

**14 October, 21:46 UTC — Build 01 source-to-card and graph recovery are in progress.**

### Working and verified

- Both active Workspace aliases with obsolete `source_ineligible` checkpoints were
  recovered through fenced, logged claims after current authority checks. Both
  subsequently completed real LIVE scheduled captures. A later transient fetch
  failure remains visible.
- The interaction projector now continues through fully receipted batches while
  keeping two legacy email review holds visible. Its first LIVE 200-record batch
  published all 200 in about 14 seconds and queued the next batch. The retained
  email-without-interaction count fell from 56,826 at 20:36 to 55,156 at 20:50,
  while 604 new source emails arrived.
- TEST and LIVE identity delivery now have a 200-record automatic bound; manual
  requests stay at 50. SQL rollback rehearsals, owner/grant preservation,
  downloaded runtime comparisons and focused checks pass. The first LIVE
  200-record identity batch delivered 137 identities/cards, held 63 for review,
  and queued its next batch in about 20 seconds.
- Four stale DWD account switches linked to mailboxes absent from 41 successful
  directory scans were disabled in one rehearsed, audited LIVE transaction.
  Removed mailbox rows, sync preferences and all source history remain intact.
  The next unattended Workspace scheduler cycle succeeded with nine eligible
  mailboxes queued and zero ineligible or unconfirmed.
- The continuing 200-record identity batches delivered confirmed identities/cards;
  a normal card refresh completed at 20:55 UTC despite queue pressure. A graph
  refresh record from 03:09 UTC had remained `running` with no claim or lease,
  preventing scheduled graph refreshes. Internal triggers now enqueue the leased
  graph worker in TEST and LIVE; a synthetic TEST call queued once and rejected
  cross-tenant scope. The exact orphaned LIVE record was marked failed in a
  rehearsed, audited transaction. Its replacement succeeded at 21:09 UTC with
  1,479 processed graph items; a later ordinary run is active. Direct operator
  graph work now requires a confirmed leased claim before writes; a failed
  handler result records failure.
- The email selector began timing out when it repeatedly checked revisions of
  already-linked messages. A bounded unlinked-email path now returns 200 LIVE
  candidates in about a second, preserving exact revision/hold checks on the
  selected window and the original full selector for later changed-source review.
  TEST synthetic draft/hold/revision checks and LIVE rollback/installed query
  checks pass. Ordinary projection continuation has resumed; the email gap fell
  to 53,491 by 21:16 UTC while 550 more saved emails arrived.
- A separate Phone projection lane is deployed in TEST and LIVE. Its first
  unattended batch selected 100 legacy calls, all held for review and none
  published. A bounded unlinked-first selector then passed TEST fixture and
  LIVE rollback checks; the next ordinary Phone job published all 75 previously
  unlinked calls at 21:28 UTC. The unlinked Phone count is now zero. All 75 new
  interactions were still `ready`, with no confirmed card attribution at readback.
- A second ordinary graph run succeeded after a five-minute lease reclaim. The
  next attempt stopped making writes near five minutes, despite its extended
  lease. Graph node/edge work now runs in bounded groups while dependency phases
  remain ordered. A job-keyed completion event is confirmed or leaves the job
  retryable. A 200-interaction TEST runtime run produced 200 nodes and one event;
  TEST v34 and LIVE v85 packages match downloaded source. The stalled LIVE claim
  was reclaimed at 21:45 UTC; its bounded-write retry succeeded in 27 seconds,
  processing 1,440 items with exactly one keyed completion event and a cleared
  lease. A new normal graph job queued afterward.
- The existing identity selector now reserves at most a quarter of its normal
  batch for ready Phone calls, leaving the remaining slots for oldest-first work.
  TEST synthetic 2-Phone/6-Email selection and LIVE rollback checks pass. Of the
  75 newly published Phone interactions, all 75 reached `enriched` with exact
  committed customer-card receipts by 21:36 UTC. This proves the scheduled
  source-to-card path for those calls, not complete Phone history or scoring.

### Needs finishing

- Prove sustained source-to-interaction-to-identity/card/recommendation catch-up,
  including the currently ready email backlog and case-specific identity holds.
  Nearly 30,000 Slack source observations are intentionally held as
  `direction_unverified`; do not call them linked customer-card evidence.
- Continue the real full working-day Phone/Email observation, wider source/card/
  scoring acceptance, dependable unattended backups and full app/Auth recovery.
- Reconcile graph coverage beyond its bounded latest-record windows against
  required large histories, and observe repeated normal runs over the full
  working-day window.
- Complete the unlinked email drain, then prove changed already-linked revisions
  are selected; the original full selector can still be expensive once the fast
  path is empty. Verify card-read and recommendation evidence for the new Phone
  group, and reconcile 700 recorded legacy Phone projection review holds.
- Chris is the named Drummonds business reviewer and will sign off once the
  evidence is ready. His confirmation of that role is not a sign-off.

### Blocked externally

- No specific new provider or access blocker is established. Elapsed observation
  and source/identity reconciliation are unfinished Build 01 work.

[Alias recovery](evidence/learn-build01-alias-recovery-2026-10-14.json),
[projection drain](evidence/learn-build01-projection-drain-2026-10-14.json), and
[identity drain](evidence/learn-build01-identity-drain-2026-10-14.json), and
[removed-account reconciliation](evidence/learn-build01-removed-mailbox-reconciliation-2026-10-14.json),
and [graph recovery](evidence/learn-build01-graph-recovery-2026-10-14.json),
and [projection selector recovery](evidence/learn-build01-projection-selector-2026-10-14.json).
The [Phone unlinked-first receipt](evidence/learn-build01-phone-first-2026-10-14.json)
records the ordinary 75-call publication and its separate downstream limit.
[Phone identity evidence](evidence/learn-build01-phone-identity-2026-10-14.json)
records the bounded downstream priority and ordinary attributed progress.

**14 October — Build 01 follow-up: job breakdown corrected; fresh manual backup verified.**

### Working and verified

- The secondary customer job breakdown includes completed jobs. A real LIVE card
  shows 25 completed in both headline and breakdown, bounded to 25 of 208 linked
  published jobs. Record verification, payment and completion-time limits remain.
- Current isolated frontends are LIVE `a9743c1` and TEST `b5b8b73`, retaining the
  accepted Slack browser. Both stable alias sets, protections, actual backend
  binding and signed-in build badges pass. Seven existing job-summary checks,
  TypeScript and production build (including 47 prebuild checks) pass.
- The existing backup runner now reobserves an inventory at most twice after the
  exact concurrent-change guard fails. It preserves the same lease, ports, deadline,
  shared request budget, complete source comparisons and prior successful manifest.
  Thirty focused source/daily/supervisor checks pass. No new runner or schedule.
- The same three-bucket supervisor completed at 14:08:44 UTC: 3,024 phone files,
  255 original voicemail emails and 255 audio files, 668,942,672 bytes total.
  Full byte/source checks, 255 matched voicemail pairs and all 3,018 phone
  references pass. Zero missing references/null pointers; six unlinked phone
  files retained. Health readback is verified and the original lock is released.
  All 142 local backup checks pass; tested source hashes match the actual run.

### Needs finishing

- Four earlier manual backups stopped on AWS request/stream or source reads;
  their failures remain recorded. A subsequent full source diagnostic and fifth
  supervisor invocation passed. Today's success covers non-atomic observed
  inventories beginning 13:50:46 UTC. Dependable unattended operation, human
  listening and full application/Auth recovery remain unverified. The final live
  run used zero retries; live interruption recovery is not inferred from it.
- Collect a real full working day of Phone/Email input-to-card operation without
  manual rescue and reconcile every required source/identity/card population.
  Elapsed observation is acceptance work, not an external access blocker.
- The remaining V1 families in the Build 01 receipt stay incomplete. Authorised
  private Slack channels retain their separate source/visibility acceptance;
  the public browser does not remove that requirement. DMs remain deferred.

### Blocked externally

- No specific external provider or access blocker is established by this
  checkpoint. A Drummonds operations/source reviewer still needs to be named for
  business acceptance after the technical evidence is assembled; this does not
  stop the independent Build 01 work above.

[Follow-up evidence and rollback](evidence/learn-build01-followup-2026-10-14.json),
[fresh manual backup acceptance](evidence/learn-communication-daily-2026-10-14.json).


**14 October, 12:30 BST — public Slack evidence browsing released and accepted.**

### Working and verified

- The existing Drummonds client Slack tile now opens saved public-source
  observations and their exact retained messages. Real signed-in acceptance covers
  two 25-row pages, original-message provenance and one-minute view expiry.
- Selected operator access uses the same browser with a required reason. Actual
  LIVE readback verifies one list audit and 26 source audits. TEST operator access,
  its honest empty selected-company page and audit pass. No new identity or grant.
- Both isolated Git-built frontends are READY on their existing stable aliases:
  LIVE `2eb6971`, TEST `7c3a9b9`. Actual rendered backend bindings, LIVE build badge,
  existing protection/redirects, Drummonds branding and browser console checks pass.
- Nine focused tests, TypeScript, isolated candidate builds, full-schema and hosted
  rollback checks pass. Eleven source inventories reconcile with zero deleted IDs:
  ten unchanged, one Slack change with its exact earlier contents retained immutably.
  Separately released QuickBooks catalog changes are explicitly reconciled.

### Needs finishing

- This is committed public-source evidence browsing, not full Slack history,
  reviewed customer/job attribution or completed company learning. Private/shared
  channels and DMs do not appear; DMs remain deferred. A distinct ordinary staff
  identity was not exercised; the client check used the existing owner session.
- All broader V1 obligations remain, including source coverage/recovery, published
  identity/card coverage and read performance, reviewed scoring and dependable
  unattended capture/backups. Build 01 remains IN PROGRESS; no later stage starts.

### Blocked externally

- No new access is needed for this released browsing feature. Real elapsed
  working-day observation and human/business acceptance remain separate gates.

[Release, preservation and hosted acceptance](evidence/learn-slack-evidence-browsing-2026-10-14.json).


**14 October — Build 00 documentation audit:** the [LEARN V2 audit receipt](../roadmap/drummonds-serviceos-builds/receipts/00-2026-10-14.md)
maps the existing build and every outstanding V1 obligation into the expanded
stage plan. It adds no runtime acceptance, changes no V1 requirement and starts
no dependent stage. Proposed business outcome contracts await review.

**14 October, 10:43 BST — ten real public Slack observations committed in LIVE.**

### Working and verified

- All ten selected eligible messages now have mapper-2 observed ledgers, succeeded
  ordinary observe jobs and committed receipts. Tenant, interaction and retained
  source-revision bindings pass. Direction stays unknown, identity-review holds
  remain and no customer/person/job link is invented. Every receipt has zero actions.
- The other fifteen selected messages retain audited skips under the existing
  eligibility policy. No job was manually enqueued, restarted or reprioritised.
  Aggregate ordinary worker evidence also confirms processing after v77 publication.
- Signed-in operator selection and Drummonds client navigation work in a separate
  verification tab. The live input tiles show 48,519 saved emails, 4,473 calls,
  2,992 recording rows, 32,023 Slack messages and 255 visible voicemails. These are
  dated saved totals, not complete-history, playback or universal-learning claims.

### Needs finishing

- The Slack panel currently provides import/capture/recovery controls, not a browser
  for these unassigned company-source observations. The existing authorised, audited
  public-source reader can be reused; add a clear company-evidence journey without
  fabricating customer/job attribution or exposing private/shared/DM sources.
- Current eligibility relies on its established value/noise policy; comprehensive
  company learning, edited-source revision recovery, broader customer/job mapping,
  scorecards, operator recovery and dependable backups remain open.

### Blocked externally

- No new user decision or login is needed for the next source-evidence UX step.

[Real source-learning acceptance](evidence/learn-public-slack-live-2026-10-14.json).


**14 October — LIVE public Slack source-learning package deployed; real receipts pending.**

### Working and verified

- LIVE worker v77 and the guarded source qualifier/observer/selector are installed.
  Exact executable readback and missing-auth 403 pass. A real selection of 25
  records took 1,582 ms including the API round trip. The isolated 15,000-source
  selection takes 45 ms; full-schema rollback/authority checks preserve all
  1,591,601 archived rows across 390 tables and seven sequences.
- Every pre-existing scoped source ID and canonical digest passes readback across
  eleven datasets, including message bodies/headers, retained Slack payloads and
  versions, voicemail/phone transcripts and audio/storage pointers. Gmail's mutable
  history/labels are separate metadata. New arrivals are permitted; missing or
  changed earlier records fail acceptance. Audio bytes remain a separate backup claim.
- Twelve adversarial keyset guards and actual offline archive traversal passed.
  Synthetic email-body and voicemail-pointer/transcript tampering is detected;
  synthetic changes roll back. The release journal and original executable remain
  private and recoverable locally, rather than in reboot-cleared temporary files.

### Needs finishing

- Real source-only observation receipts and signed-in source opening remain pending.
  The first two exact-selection checks have no dispatched ledger yet. Follow normal
  scheduling; do not claim successful learning from selector/runtime checks alone.
- Customer/job/person attribution is still unresolved for these sources. Full
  customer coverage, scorecards, operator recovery and recurring backups stay open.

### Blocked externally

- No new user action is needed. An automatic approval-review rejection required
  rehearsal of the revised keysets; that gate passed and the subsequent LIVE
  promotion was accepted. Two earlier schema attempts restored the exact previous
  functions before worker change because the diagnostic login lacked EXECUTE; the
  corrected check uses the existing admin connection in a READ ONLY transaction.

[Deployment and preservation evidence](evidence/learn-public-slack-live-2026-10-14.json).


**14 October — compiled public Slack learning journey verified; hosted release pending.**

### Working and verified

- Recovered all 124 original worker modules by their pinned byte hashes after the
  Mac restart cleared temporary build files. Independently read back the exact
  LIVE v76 executable and retained it privately for rollback. Only the three
  reviewed Slack-learning files change; the candidate retains 125 modules.
- The rebuilt executable passes four network-isolated synthetic journeys: proven
  public source hand-off, duplicate reuse, missing proof denial and proof withdrawal
  denial. Tenant filters and unresolved customer/job attribution pass. The ordinary
  queue probe also passes authentication, ten-job capacity, lease and batch bounds.
  Both test containers were removed; no real credentials or provider calls were used.
- Forty binding/handler tests pass. All four LIVE function definition/permission
  baselines still match the exact prepared schema release. LIVE remains v76.

### Needs finishing

- Measure the selector at production scale, publish the matching guarded schema
  and worker, and verify real source opening, committed observations and scheduled
  throughput. These new results are **local only**, not hosted acceptance.
- Today's recording backup has two retained failed attempts: source read unconfirmed,
  then inventory changed during scanning. Yesterday's successful aggregate remains
  retained. Daily fresh coverage and dependable backup recurrence remain unverified.

### Blocked externally

- No new user access or decision is required for the current learning step.

[Compiled runtime evidence](evidence/learn-public-slack-runtime-local-2026-10-14.json).


**14 October, 08:26 BST — public Slack source learning verified locally; release pending.**

### Working and verified

- The existing LIVE operator session remains signed in. Chris confirmed that the
  1Password item **Openfolk Test is TEST-only**; do not use its password on LIVE,
  even though the saved website points to app.openfolk.ai. No password was copied.
- Prepared source-only observations admit an exact retained public Slack version
  with immutable capture proof and an unrevoked matching connection. They leave
  direction, identity-review holds and customer/person/job links unchanged. Private,
  shared, withheld, unproven and unsupported sources remain excluded.
- Forty source-binding/worker tests, six existing observation-handler tests and
  twenty-six pure-mapper checks passed. The exact guarded package passed an isolated
  full-schema rehearsal using the current LIVE observer and withholding guard.
  All 1,591,601 retained rows across 390 tables and seven sequences were preserved
  by installation. Synthetic journeys roll back; only the expected local capture
  sequence's called flag advances. Release rollback/reapply and unchanged existing
  function permissions passed. Wrong target, source digest and late verification
  failures each roll back at their intended guard.
- The thousand-source local selection gate passed after fixing broad proof scans.
  Reviewed messages retain reserved capacity, recent proven sources get a separate
  reserve, and older history keeps progressing. Existing selection regression
  checks passed. The three-file worker candidate compiles on the verified LIVE v76
  source baseline; no other worker files were changed.

### Needs finishing

- **Not deployed to hosted TEST or LIVE.** Validate the candidate runtime, measure
  production-scale selection, release matching schema/worker with preservation
  evidence, then verify a real source-only observation and scheduled throughput.
- These are retained-source observations, not confirmed customer/job attribution
  or complete business analysis. Customer coverage, scoring, operator recovery and
  full LEARN V1 acceptance remain open.

### Blocked externally

- No new user access is needed for this step. LIVE sign-in is working; TEST remains
  a separate credential and runtime baseline.

[Local source-learning evidence](evidence/learn-public-slack-observation-local-2026-10-14.json).


**14 October, 07:42 BST — twenty more LIVE customer journeys published.**

- Twenty individually reviewed customers, four sites and thirty-two jobs are now
  linked through the existing audited OpenFolk controls. Thirteen corroborated
  account-holder contacts reuse their exact identities, with twenty-eight retained
  non-primary, unverified contact channels.
- Saved source versions, actors, ownership and descriptions pass readback. Final
  scoped comparison preserves 4,511 previous identity projections, fifty-two customer
  links, 115 contact points, all sixty-three previous contact links and all 1,552
  retained customer source payloads. No provider writes or access changes occurred.
- Signed-in LIVE customer verification passes six-job display, job drill-down and
  return, contact display and saved-channel reading. Missing communications and
  unknown completion timezones remain visible. The secondary status breakdown omits
  completed jobs despite the correct headline; fix that presentation gap separately.
- Published totals are now **72 customers, 78 sites, 931 jobs and 76 contacts**.
  Seven contacts in this group still need identity/role review. A fresh planner has
  759 proposals, 819 held export accounts and one linked account needing review;
  fifteen previously ready proposals acquired candidate holds after publication.
- The 98 API-missing customers, broader attribution, scorecards, operator recovery
  and recurring-backup acceptance remain unresolved. Full LEARN V1 is not complete.

[Customer publication and preservation evidence](evidence/learn-customer-publication-2026-10-14-second.json).


**14 October, 07:14 BST — LIVE Workspace directory discovery recovered automatically.**

- The existing job succeeded on its normal fourth attempt, with a durable receipt
  for 29 directory users, zero new mailboxes and four addresses absent from that
  directory. Its connection verification timestamp advanced. No job was manually
  enqueued or restarted, and old failed attempts remain retained as history.
- The root cause was an unqualified sender-authority helper called from the
  existing mailbox-update trigger under a restricted search path. Only two helper
  definitions changed; their business rules, invoker security and service-only
  permissions remain intact. Missing/revoked senders and sandbox limits still hold.
- The full restored production schema reproduces the exact original exception,
  passes the repaired trigger journey, preserves all 1,591,601 archived rows and
  seven sequences, and proves exact helper rollback/reapply and unchanged grants.
  Hosted TEST lacks these legacy helpers and was not changed.
- LIVE checks preserve source identities, mailbox enablement/identity choices,
  sender authority, operator access, modes and schedules. The four absent addresses
  are not declared permanently retired, and saved communications remain intact.
- Complete historical email coverage, other connection/mailbox acceptance, broader
  source matching, scorecards and operational recovery still need completion.

[Discovery recovery and evidence](LEARN-WORKSPACE-DISCOVERY-RECOVERY.md).

**14 October, 06:50 BST — two reviewed public Slack sources accepted through observation.**

- Both existing reviewed messages now have current-mapper ingestion ledgers,
  succeeded observation jobs and committed observation receipts. Normal scheduling
  processed them; no manual queue insertion, restart or source rewrite was used.
- Each observation retains the reviewed customer/job context and points to the
  correct canonical Commusoft job graph node. Original text, source revision,
  speaker/direction and the two immutable audited reviews remain unchanged.
- Both receipts prohibit execution and have zero action IDs. This proves stored
  observations with source context, not autonomous follow-up, stock verification,
  financial conclusions or a complete company picture.
- Eight normal ten-job batches yielded 64 successes, 15 retained holds/ineligible
  outcomes and one mailbox-discovery retry (`db_error`) needing diagnosis.
- The prior queued status below is superseded for these two sources only. Broad
  coverage, historical learning, identity review, scorecards, operator recovery and
  recurring-backup acceptance still remain open; the full launch goal is active.

[Observation acceptance](evidence/learn-reviewed-slack-observations-live-2026-10-14.json).

**14 October, 06:47 BST — normal LIVE worker capacity increased and verified.**

- TEST v28 and LIVE v76 now claim up to ten ordinary jobs per minute rather than
  three. Exact compiled probes and hosted artifact/authentication checks pass;
  handlers, permissions, capture gates, schedules and retained sources are preserved.
- Five consecutive LIVE ticks used the new ten-job batch. The first four settled:
  35 succeeded, four identity review holds and one ineligible mailbox. The fifth
  remained active. Held/blocked records are not reported as successfully processed.
- By 05:47 UTC, 22 learning-ingestion jobs and 12 Workspace jobs succeeded since
  release. The oldest queued ingestion advanced from 05:10 to 05:35. The two
  reviewed Slack sources had already passed ingestion before this release; their
  final observation receipts remain pending. No manual enqueue or restart was used.
- Legacy graph-sync diagnosis, broad historical learning, identity review, customer
  coverage, evidence-backed scoring and operational acceptance remain open.

[Worker release, monitoring and rollback](LEARN-WORKER-THROUGHPUT.md).

**14 October, 06:24 BST — audited operator job search accepted in TEST and LIVE.**

- The Slack context reviewer can now find published jobs by job number, description,
  customer, address or postcode. Customer/location labels help disambiguate results;
  source codes retain leading zeros. Searches do not create links automatically.
- Signed-in TEST passes paged results, direct lookup, the existing context reader,
  clearing a proposed link when the search changes and explicit empty results.
  LIVE finds the reviewed Commusoft job directly, replacing nineteen pages of manual
  selection. Both environments have matching real-operator read audit evidence.
- Isolated full-schema tests preserve all 1,591,601 archived rows and seven sequences
  while verifying tenant isolation, revocation, View-As denial, mandatory auditing
  and function rollback/reapply. The frontend build and ten focused tests pass.
  Hosted release preserves existing job/source records, access and source reviews.
- Both stable TEST aliases and all four LIVE aliases serve their isolated candidates
  with existing protection. Broader customer publication, attribution, scorecards,
  reliable processing throughput and operational acceptance remain open. The two
  reviewed Slack sources are still queued, not yet accepted as new observations.

[Job search release and verification](LEARN-OPERATOR-JOB-SEARCH.md).

**14 October, 06:08 BST — LIVE scheduled learning now uses the current mapper.**

- The downloaded production scheduler v19 used `obs-ingest/1`, while the current
  learning worker uses `obs-ingest/2`. Version 20 aligns selection to mapper 2 and
  explicitly puts that version on newly queued jobs. The two newly reviewed
  messages had no ledger under either mapper; no legacy ledger was assumed.
- The exact compiled artifact passed isolated runtime checks for tenant-scoped
  selection, explicit payload version, duplicate reuse and missing-auth rejection.
  LIVE artifact readback matches, and an unauthenticated request returns 403.
  Other deployed functions, access, review receipts and schedules are unchanged.
- At 05:10 UTC the next normal scheduled cycle queued the second reviewed source
  with explicit mapper 2 and retained the first source's existing queued job.
  Both original texts, source revisions and immutable reviews remain intact.
  Neither has a current-mapper observation yet; dispatch is verified, downstream
  processing remains pending. No manual enqueue or restart was used, and no new
  source reads, permission changes or paid AI were enabled by this runtime release.

[Runtime release evidence](../../supabase/release/learn-reviewed-ingestion/runtime.manifest.json).

**14 October, 05:54 BST — bounded reviewed-context selection deployed in LIVE.**

- The existing learning selector now reserves up to one fifth of a batch for
  recorded Slack context reviews whose retained source revision still matches.
  Remaining capacity continues oldest-first processing; unused review slots return
  to historical work. Mapper-ledger exclusion and the 1–200 batch bounds remain.
- Exact LIVE readback selected the two recently reviewed messages plus twenty-three
  historical records. The 25-row read took **129 ms** on current production data.
  Selector ownership, service-only permissions and invocation security remain
  unchanged; the search path is now fixed. Source/review and schedule fingerprints
  passed before/after comparison. No jobs were manually enqueued or restarted.
- The final isolated full-schema rehearsal passes selection fairness, stale sources,
  retained tombstones, tenant isolation, mapper states, limits, target/checksum
  guards, injected failure after replacement and exact rollback/reapply. All
  1,591,601 archived rows across 387 tables and seven sequences remain intact.
  Two earlier rehearsal-only rollback packaging issues were fixed before promotion.
- Hosted TEST lacks the activation selector prerequisite and was not changed. This
  is isolated production-schema validation plus LIVE readback, not hosted TEST
  acceptance. **Normally scheduled ingestion and downstream observation acceptance
  remain pending**; selection alone does not establish learning completion.

[Release and preservation evidence](evidence/learn-reviewed-ingestion-selection-live-2026-10-14.json)
· [Exact release and rollback](../../supabase/release/learn-production-patches/reviewed-ingestion-selection-v1/README.md).

**14 October, 05:42 BST — two more public Slack messages connected to LIVE customer/job context.**

- Reviewed two complete retained messages that explicitly concern one published
  Commusoft job: a parts-location question and a follow-up reporting the stock
  movement. Existing logged OpenFolk controls saved two immutable review receipts.
  No provider calls, new permissions, schema change or runtime release were needed.
- LIVE customer and job timelines both show the two messages. Full retained source
  reading and customer-to-job-to-customer navigation pass. Original message text,
  source-version hashes, Slack author attribution and unknown direction remain
  intact; the customer is derived through the current reviewed job ownership.
- Review scope requires exact-version public-channel capture proof. DMs, private
  and shared channels are excluded. Reported stock movements/prices remain source
  statements, not independently verified inventory or performance measurements.
- Downstream learning is **not yet accepted for these two messages**. They have no
  ingestion ledger or matching single/batch ingestion job at this check. The
  existing five-minute selector is active and orders oldest first; **23,764 enriched
  interactions** await a current-mapper ledger. The earlier four Slack recovery
  observations still pass source/job binding, zero-action and preservation checks.
- Next processing work: provide bounded priority for explicit context reviews while
  continuing historical ingestion. The source-link result does not close this gate.
  Operator job selection also currently requires paging through UUID-ordered jobs;
  a usable job search remains needed for review at scale.

[Public Slack context and handoff evidence](evidence/learn-public-slack-job-links-2026-10-14.json).

**14 October, 05:30 BST — larger customer estate accepted in LIVE.**

- Published one corroborated company account, all twenty-six retained sites and all
  208 retained related jobs through existing logged OpenFolk controls. Each visible
  job owner/property and source ID was checked against the fresh relationship
  inventory. Unrelated numeric/description search matches were excluded. A normal
  five-minute review expiry was renewed without replaying saved groups.
- Seven named source contacts now link to the customer card with fourteen saved
  unverified, non-primary contact-point records. Two explicit separation reviews
  keep three people sharing an office number distinct; both exact candidate sets
  and operator result audits pass. Five generic occupier/location labels remain
  unlinked and still require suitable role handling.
- Signed-in LIVE acceptance covers the 208-job count, both site pages (25 + 1),
  seven contacts, saved shared-office details, job drill-down and return. The
  leading-zero code is preserved. No linked communication is yet present; the
  card discloses that gap and the completion-time limitations.
- Source versions/actors, customer/site/job ownership and retained descriptions
  pass readback. Three display titles trim trailing spaces through the existing
  normaliser; their original descriptions remain unchanged. Scoped final comparison
  preserves 4,503 earlier identity projections, 51 customer links, 101 contact
  points and 1,552 customer source payloads; all 56 prior contact links remain.
- Current published totals: **52 customers, 74 sites, 899 jobs and 63 contacts**.
  Fresh reconciliation still has 794 individual-review proposals, 804 held export
  accounts and one linked account needing review, including 98 API-missing accounts.
  Broader publication/matching, generic role handling, scorecards and operational
  acceptance remain requirements of the active goal.

[Estate publication and preservation evidence](evidence/learn-customer-estate-publication-2026-10-14.json).

**14 October, 05:15 BST — another complete retained customer/job/contact group accepted in LIVE.**

- One corroborated company account, all forty-seven of its currently retained jobs,
  and three explicitly related contacts were published through existing logged
  OpenFolk controls. Job number 690 was excluded because its property was a
  different account: number equality alone was not used as an identity match.
- Signed-in LIVE acceptance shows both job pages (25 + 22), three contacts and
  working customer-to-job navigation and return. Original source descriptions,
  including historical codes and leading zeros, are preserved. Missing linked
  communications and unconfirmed completion timezones remain visible; these times
  do not support duration or scoring claims.
- Exact source/actor/card ownership checks pass. All 4,499 earlier identity
  projections, fifty customer links, ninety-five contact points and 1,552 customer
  source payloads are preserved; all fifty-three prior contact links remain.
  Six new non-primary, unverified contact-point records were added.
- Current publication totals: **51 customers, 48 sites, 691 jobs, 56 contacts**.
  A fresh reconciliation leaves 795 proposals for individual review, 804 held
  export accounts and one linked account needing review. Ninety-eight export
  customers are still absent from retained API coverage. Wider publication,
  communication matching, scorecards and operator/operational acceptance remain open.
- Backup health is within its daily window and the monthly voicemail sample is
  current. The combined 09:00 local follow-up still awaits observed unattended
  execution. No duplicate backup or capture runner was started.

[Publication, browser and preservation evidence](evidence/learn-customer-history-publication-2026-10-14.json).

**14 October, 05:00 BST — distinct shared-office contacts accepted in LIVE.**

- Matched TEST/LIVE backend and isolated three-file frontends are released. Signed-in
  TEST proves the default collision hold, required evidence, renewed approval, saved
  result and customer-card details. The real LIVE contact then linked through logged
  OpenFolk controls to its existing customer/site, retaining the other person.
- Both named contacts now appear on the LIVE customer card. Two new unverified,
  non-primary contact points are retained. Source/actor/relationships and the exact
  operator audit pass. Fifty-two earlier contact links remain; fifty-three total.
- Installation preserves all checked pre-release business sources, links, people,
  points and account access. All four LIVE and both TEST aliases and their existing
  protections are verified. SQL reversal refuses to remove ambiguity protection
  after publication; the prior frontend remains the rollback option.
- Capture/identity processing continues without restart or unexpected errors in the
  observed sample. This resolves one shared-office hold, not overall matching or
  coverage. Group labels, broader customer/job publication, source coverage gaps,
  scorecards, operator recovery and scheduled independent recovery remain open.

[Release, preservation and acceptance](LEARN-CONTACT-SEPARATION.md).


**14 October, 04:40 BST — shared-contact separation and attribution guard rehearsed; release pending.**

- Added an evidenced review for distinct named contacts sharing an office endpoint.
  The source name/version and full candidate set are checked again at save; existing
  people, primary choices and source links remain intact. Group labels remain held.
- Automatic communication delivery now holds shared contact-point/primary matches
  for review. Existing authorised per-communication attribution still works.
- Native full-schema and hosted TEST rollback journeys pass, including receipt
  recovery, stale reviews, permission denials, audit failures and downstream cards.
  Existing identity regressions, twelve library tests, TypeScript and build pass.
- Guarded installation/reversal is prepared and rehearsed. SQL reversal refuses to
  remove the matching protection after distinct-contact publication. No hosted
  installation or LIVE change has occurred. Signed-in TEST/LIVE acceptance and
  real shared-office publication remain next, alongside the wider goal requirements.

[Shared-contact release and acceptance](LEARN-CONTACT-SEPARATION.md).


**14 October, 04:08 BST — another complete customer/site/job/contact publication group accepted in LIVE.**

- Twenty reviewed customer accounts, two sites and seventeen jobs were published
  through existing logged OpenFolk controls. Nineteen retained contacts then linked
  to their customer cards: fourteen reused the corroborated account-holder person,
  five created separate named contacts, and forty-one non-primary unverified contact
  channels were retained. Three ambiguous/group/shared-office contacts remain held.
- Readback verifies every source revision/payload, actor, customer/card/site owner
  and original job number/description. All 4,492 pre-contact identity projections,
  fifty customer links, fifty-two existing contact points and 1,552 retained
  customer-version payloads remain intact. Ongoing capture advanced observations;
  these scoped comparisons do not certify every production field.
- Signed-in LIVE person and company cards show the linked jobs, service address,
  contacts and saved email/telephone details. Job drill-down and return pass. Leading
  zeros and historical source descriptions are preserved. Missing communications,
  unverified records and completion-time limitations remain explicit.
- At 03:07 UTC the published source-link totals are fifty customers, forty-eight
  sites, 644 jobs and fifty-two contacts. The refreshed reconciliation has 796
  proposals awaiting individual review, 804 held export accounts and one linked
  account needing review. Ninety-eight export customers remain absent from API
  source coverage. These are not complete-provider or ready-to-score claims.
- Current identity-processing receipts show continued bounded progress with a queued
  child; ambiguous events are held rather than counted as matches. The second
  Commusoft cycle has completed properties/jobs and is traversing customer contacts.
  No restart was issued. Remaining broad publication/matching, shared-contact review,
  full input acceptance, scorecards, operator recovery and scheduled independent
  recovery remain part of the active goal.

[Publication and preservation evidence](evidence/learn-customer-publication-2026-10-14.json)
· [Reconciliation procedure](LEARN-CUSTOMER-RECONCILIATION.md).

**14 October, 03:25 BST — original Slack source drill-down accepted on LIVE and TEST.**

- Customer cards now open retained Slack text beyond the short interaction excerpt,
  with dated provenance and historical limitations. Two actual LIVE messages pass;
  the same source opens through explicit OpenFolk client selection with a verified
  actor/reason/revision audit. No production source, identity, capture or permission changes.
- Matched additive backend and five-file frontends are released and verified. Native
  archive preservation, hosted TEST rollback, synthetic signed-in TEST acceptance,
  missing-proof denial and post-release authority/source checks pass. A single
  clearly labelled credential-free synthetic TEST fixture is retained.
- Existing browser documents can remain stale after normal reload. A fresh stable
  URL loaded the exact candidate. General stale-document recovery remains open.
- Next priority is broader current-source matching and canonical customer/job
  publication, not another isolated visual polish milestone. Full connector
  coverage, scorecards, usable operator recovery and scheduled independent recovery
  remain requirements. The identity queue is continuing; review holds are not
  treated as successful matches. The full goal remains active.

[Release and limits](LEARN-SLACK-CARD-SOURCE.md).

**14 October, 03:13 BST — retained Slack source reader verified and installed; frontend acceptance pending.**

- Native and hosted TEST permission/visibility/audit journeys pass. The additive
  reader is installed with identical definitions in TEST and LIVE. Existing source
  identities and user access are preserved; no provider requests or capture changes.
- The customer timeline and explicit OpenFolk communication selection now have a
  prepared original-message reader, with dated text and provenance. Five frontend
  files pass focused tests, TypeScript and the Vercel-target build. Stable-site
  deployment and signed-in source acceptance remain pending.
- This closes an evidence drill-down gap only. Wider current-source matching,
  publication, capture coverage, scoring, operator recovery and scheduled independent
  backup acceptance still need completion. The full goal stays active.

[Retained Slack source journey](LEARN-SLACK-CARD-SOURCE.md).

**14 October, 03:00 BST — four real Slack observations accepted through the LIVE customer card.**

- All four original recovery children succeeded once, with committed observations,
  matching reviewed customer/job context, retained sources/parents and audit lineage.
  No actions or automation intents were created. No duplicate recovery was issued.
- Signed-in LIVE shows all four observations and evidence links. Following one link
  opens its dated source excerpt and provenance. These are historical 2022 messages;
  they do not establish present-day outstanding requests or assigned ownership.
- The recent-job frontend is verified on LIVE/TEST and checkpointed to GitHub. Two
  LIVE 25-job pages, refresh, job drill-down and return passed. The exact deployments
  and rollback sequence are recorded in `docs/DEPLOYMENT.md`.
- Next delivery work is broader current-source/customer/job matching and publication,
  complete capture/reconciliation, a usable original Slack source reader, evidence-led
  scoring and logged operator recovery. Daily independent backup/restore operation
  still needs its scheduled acceptance. No goal requirement is complete by proxy.

[Slack acceptance](LEARN-OBSERVATION-RECOVERY.md) ·
[Recent-job release](LEARN-CUSTOMER-RECENT-JOBS.md).


**14 October, 02:56 BST — recent-job journey verified on LIVE; first Slack recovery observation committed.**

- TEST and LIVE now serve the isolated recent-job frontends from verified Git.
  All existing aliases and deployment protection are verified. Two LIVE 25-job
  pages are chronological without duplicates; refresh, job drill-down and return
  pass in the existing signed-in operator session. Original codes/descriptions,
  recorded status and timezone limitations remain visible. Backend/source/access
  preservation checks pass again after release.
- One of the four original Slack recovery children succeeded at 01:55 UTC with a
  committed observation receipt, matching interaction/work/job references, assisted
  tenant mode and zero executable actions or automation intents. Three remain
  queued. This is actual evidence processing, not yet an accepted displayed finding.
- The signed-in source totals at 01:52 UTC were 37,524 emails, 4,462 calls, 2,984
  recordings, 16,616 Slack messages and 255 visible voicemails. These are retained
  counts, not complete historical or audio coverage. Email's latest failure at
  01:52 was followed by a completed update at 01:53; per-account coverage still needs
  reconciliation, and one success does not establish every mailbox is healthy.
- Full provider coverage, canonical publication/matching, source inspection,
  scorecards, operator recovery and unattended backup acceptance remain open.
  This release does not narrow or complete the LEARN V1 goal.

[Verified recent jobs](LEARN-CUSTOMER-RECENT-JOBS.md).


**14 October, 02:45 BST — identity continuation accepted in LIVE; Commusoft incremental cycle complete.**

- Eleven scheduled identity batches have committed 104 customer-card updates and
  446 durable review holds, with no unconfirmed delivery and a verified next child
  each time. Held records stay review-required. This proves continuation, not full
  backlog completion or resolution of the outstanding identity reviews.
- Commusoft completed all four stages: 2,423 properties (1,552 customers and 871
  sites), 27 changed jobs, and all customer/site contact targets. Terminal receipts
  match their successful jobs. The watermark advanced to 13 October 21:26 UTC;
  ongoing capture remains enabled and the next check is scheduled for 02:37 UTC.
  This traversal does not establish complete canonical publication or all contacts.
- Signed-in LIVE LEARN shows current source totals and the reviewed Slack timeline.
  Four downstream Slack observation recovery jobs remain queued at 01:45 UTC.
- Recent-job ordering is prepared to replace random internal-ID ordering on the
  customer card. The additive reader is installed in TEST/LIVE, with unchanged
  original reader and access. Fourteen focused tests, TypeScript, local build,
  native-schema and hosted TEST rollback journeys pass. Frontend publication and
  signed-in recent-job acceptance are still pending.
- Full input coverage, broader matching/publication, scoring, operator recovery
  and operational acceptance remain unfinished; the whole goal stays active.

[Recent jobs release](LEARN-CUSTOMER-RECENT-JOBS.md) ·
[Commusoft cycle evidence](evidence/learn-commusoft-incremental-cycle-complete-2026-10-14.json).


**14 October, 02:32 BST — identity continuation repair released to TEST and LIVE; scheduled acceptance pending.**

- An old identity-review hold no longer requires unrelated full batches to stop.
  Each held outcome stays explicitly review-required; the atomic settlement permits
  one continuation only after a full batch of distinct durable publications with
  exact counts and no unconfirmed delivery. No ambiguous customer is approved.
- TEST worker v27 and LIVE v75 contain the two isolated runtime changes; downloaded
  executable hashes and HTTP auth guards pass. The backward-compatible SQL patch is
  installed with unchanged authority. Source identities, retained Slack versions,
  modes, access, schedules, connections and unrelated functions are preserved.
- Twenty-one focused tests and TypeScript pass. A full native-schema rehearsal
  preserves 1,591,601 rows; legacy queue and new failure/continuation cases pass.
  The exact patch/reversal also passes in hosted TEST with synthetic rollback.
- The original scheduled identity job remains queued at 01:32 UTC. Its real
  continued-batch receipt is still required. Four Slack observation recovery
  children also remain queued; none has been restarted or called an AI finding.
- The projection chain continues: 18 completed batches plus one running batch at
  01:26 UTC, with 380 committed email projection receipts at that observation.
  Commusoft's existing incremental pass has checked 824/871 site-contact targets
  at 01:31 UTC; its cycle watermark has not yet advanced.
- Broader publication/matching, complete capture, scorecards, operator recovery and
  operational acceptance remain open. No goal requirement has been deferred.

[Identity continuation release and limits](LEARN-IDENTITY-CONTINUATION.md).


**14 October, 02:14 BST — production projection is progressing; LEARN-only observation repair released.**

- The ordered selector now has actual LIVE acceptance: six consecutive scheduled
  batches succeeded with 120 committed email projection receipts. Every receipt
  links to its expected interaction. Continuation is queued; no processing job was
  manually restarted. Full backlog and phone-selection coverage are not yet proven.
- Drummonds' assisted mode previously caused the LEARN observation handler to stop.
  The repaired handler applies an evidence-only ceiling while retaining the real
  tenant mode and human-review requirements in its audit. Global modes, profiles,
  policies and other modules' autonomy are unchanged. No action is executed.
- The exact isolated change is published as TEST worker v26 and LIVE v74. Their
  distinct prior source closures are preserved outside this handler. Downloaded
  executable hashes match, offline boots and hosted unauthorised HTTP guards pass.
  Source identities, Slack versions, permissions, connections, schedules and secret
  metadata were preserved. No new credential, provider request or paid AI was added.
- Six handler tests, sixteen ingestion tests and ingestion/mode verifiers pass.
  The isolated full native schema preserves 1,591,601 archived rows and verifies
  assisted-mode audit, no automation intents/execution, duplicate and lost-response
  handling, stale sources, wrong claims, cross-tenant rejection and atomic failure.
- Four stopped Slack observations were recovered through a bounded maintenance
  transaction after that rehearsal. Four identical-payload children are queued;
  original terminal parents and interaction hashes are unchanged, lineage points to
  each child, and four recovery events are retained. At 01:14 UTC no child observation
  is complete. Do not resubmit these handles or call this an AI finding yet.
- Generic operator job retry remains a placeholder: this maintenance repair does
  not complete that controller requirement. Broader matching/publication, scoring,
  complete capture/recovery and operational acceptance remain open.

[Observation delivery and recovery evidence](evidence/learn-observation-mode-live-2026-10-14.json).
[Recovery procedure and limits](LEARN-OBSERVATION-RECOVERY.md).



**14 October, 01:52 BST — ordered projection repair installed; Slack learning mode mismatch confirmed.**

- The earlier selector repair did not clear production acceptance: the original job
  exhausted its fifth attempt at 00:45 UTC, with another SQLSTATE 57014 cancellation
  in the pending selector. Its terminal receipt is retained, not restarted.
- The second repair takes the first eligible batch from each source in indexed
  occurrence order before merging. Twenty-five exact-selection cases pass on 36,500
  synthetic emails, including tied timestamps, fallback dates, drafts, review holds,
  current phone versions and tenant isolation. The early eligible batch visits 20
  email rows and measured 0.067 s versus 2.546 s for the original query locally.
- Hosted TEST full-schema rehearsal preserved existing selections and source hashes
  and restored the original function/index state. Exact guarded patch/rollback,
  wrong-target rejection and late-failure rollback passed offline. TEST and LIVE
  installations at 00:50 UTC verify the function and both indexes, with unchanged
  authority. No source records, schedules, credentials or permissions were changed.
- The scheduler's new projection job is queued with zero attempts at 00:51 UTC.
  Its eventual result is required before claiming production performance acceptance.
  A mostly current or held inventory may still require scanning for eligible work.
- All four reviewed Slack messages now have durable ingestion ledgers. The first
  observation was held by `learn_observation_mode_review`; three remain queued.
  The actual tenant override is `assisted`, while this LEARN handler requires an
  observe-only result. Links and source hashes remain intact. No mode configuration
  was altered and no new observation or AI finding is claimed. Resolve the LEARN-only
  observation constraint without silently changing other modules' autonomy.
- Capture continues: 15,599 Slack sources at 00:48 UTC; 18/20 active and 122/160
  archived channel windows complete. Commusoft has checked 398/871 site-contact
  targets after all 1,552 customer-contact targets; the full-cycle watermark remains
  unchanged. Broader publication, matching, scoring and operational acceptance stay open.

[Ordered projection evidence](evidence/learn-projection-ordered-selection-live-2026-10-14.json).


**14 October, 01:41 BST — projection selection repair installed in TEST and LIVE; runtime acceptance pending.**

- The existing production projection job is retrying with inventory unconfirmed;
  database logs identify cancellation (SQLSTATE 57014) in its pending selector at
  23:44 UTC. The exact cause of the entire production delay remains unproven.
- The selector now avoids unnecessary revision work for missing projection markers
  and computes final fingerprints after choosing its bounded batch. Exact review
  holds, drafts, current authoritative phone versions, tenant scope, ordering and
  optional campaign-column compatibility are preserved.
- On 36,500 synthetic emails, 19 equivalence cases passed; measured legacy selection
  fell from 2.535 s to 1.363 s. Hosted TEST full-schema rollback compared exact current
  selections and preserved its email/phone/interaction fingerprints. The exact pinned
  production patch, reversal, wrong target and late-failure rollback pass offline.
- TEST installed at 00:40 UTC and LIVE at 00:41 UTC. Readback confirms the expected
  function body with unchanged owner, ACL, settings and security-definer status. No
  source, schedule, credential, grant or job was changed/restarted by the release.
- The original projection retry remains scheduled; acceptance requires its current
  worker result, not merely the installed query. The first newly reviewed Slack
  conversation now has an ingestion ledger and queued observation job, but no new
  observation was verified at 00:35 UTC. Identity-review continuation remains open.

[Projection selection evidence](evidence/learn-projection-selection-live-2026-10-14.json).


**14 October, 01:24 BST — four reviewed Slack conversations verified on a LIVE customer timeline.**

- Four complete public-channel messages were reviewed against three current published
  jobs, their exact site names and customer ownership. Existing logged OpenFolk controls
  recorded four immutable decisions. Readback confirms all source hashes, unknown
  direction and customer-speaker attribution are preserved; no identity was invented.
- Signed-in LIVE verification shows all four entries on the customer timeline and the
  first on its job timeline, including the correct source excerpt and provenance.
  These are reviewed context links, not new AI findings or complete Slack matching.
- The scheduled intelligence selector has queued the first reviewed interaction.
  Its exact job is still queued with zero attempts at 00:23 UTC. Other ingest jobs
  are completing, so no duplicate or replacement was started. Observation acceptance
  remains open until its committed downstream receipt is verified.
- Commusoft's current cycle has completed all 1,552 customer-contact targets with a
  terminal receipt. The site-contact pass reached 107 of 871 at 00:19 UTC; the full
  cycle watermark remains unchanged until all stages complete.
- No code, deployment, credentials, permissions, provider records or capture settings
  changed. Wider publication, automated matching, scoring and operational acceptance
  remain open. Private source text/screenshots are excluded from Git.

[Reviewed Slack context evidence](evidence/learn-slack-reviewed-context-live-2026-10-14.json).



**14 October, 01:06 BST — own-job status correction verified on LIVE and protected TEST.**

- The real company → site job journey now shows “Job recorded complete” from the
  existing scoped canonical read, with the unchanged pending verification and
  unknown completion timezone alongside it. Open, pending, held, closed and unknown
  statuses do not become completion. Expired/malformed reads withhold that status.
- Thirty focused tests, TypeScript, local Vercel build and both remote Git builds
  passed. LIVE `397d3c6` is verified on all four existing aliases and its production
  target; TEST `a193dbd` is verified on both stable aliases, with the existing operator
  session and About build/backend checks. Both rendered backend targets are correct.
- The release contains four isolated frontend files. Source data, capture, schemas,
  credentials and permissions are unchanged. Prior QuickBooks/customer summaries are
  preserved and the held job-refresh frontend is still excluded from LIVE. Rollback
  is the immediately preceding deployment in the release evidence.
- Wider canonical publication, source-to-communication matching, ownership, findings,
  scorecards and complete operational acceptance remain open. Commusoft's ongoing
  customer-contact traversal reached 1,520 of 1,552 at 00:05 UTC; its watermark has
  not advanced and full cycle completion must still be verified.
- At 00:06 UTC Slack retained 14,982 sources: 18 of 20 active channel windows and
  120 of 160 archived windows are complete. Replies and the existing held-page
  recovery remain queued/running under their original campaign scope.

[Own-job status release evidence](evidence/learn-own-job-status-live-2026-10-14.json).


**14 October, 01:03 BST — company/site/job journey verified LIVE; job summary correction staged.**

- One further corroborated company customer, thirteen explicit sites and their
  retained site job were published through the existing logged OpenFolk controls.
  Database readback verifies all fifteen links, provider ownership and the original
  operator. Prior customer identities, links, contact points and customer source
  versions are preserved. LIVE signed-in review shows all thirteen site addresses,
  the job's unchanged `012` description, customer summary and job drilldown/return.
- There are now thirty Commusoft customer links. This is incomplete publication,
  not full contact/communication coverage. Missing ownership, source gaps and
  unconfirmed completion timezone remain visible; no mapping or contact was invented.
- The real journey exposed the known own-job brief contradiction: a recorded
  completed job still says completion is not established. The four-file correction
  preserves recorded status separately from verification, payment and timing. Thirty
  focused checks, TypeScript and local build pass. Isolated LIVE `397d3c6` and TEST
  `a193dbd` builds are staged, not yet accepted or promoted at this observation.
- Slack is processing replies each minute. The existing recovery remains queued;
  pacing and recent successful settlements confirm live work rather than a missing
  worker. No duplicate job was started. Commusoft's contact pass reached 1,420 of
  1,552 targets at 23:55 UTC; full cycle completion is not yet established.

[Company/site publication evidence](evidence/learn-company-sites-live-2026-10-14.json).


**14 October, 00:54 BST — two further customer identities and five explicit jobs verified LIVE.**

- The existing logged OpenFolk review published two corroborated account holders
  and their five explicitly owned jobs. The authenticated customer export and
  current candidate checks supported each identity. A read-only database check
  verified all seven source versions, customer/card relationships and original actor.
- Provider job numbers and descriptions are preserved exactly, including leading
  zeros in current codes and historical descriptions. A job whose number happens
  to equal the searched customer number was excluded when ownership differed.
  No QuickBooks mapping was guessed. Unknown completion timezones remain withheld
  from duration/performance calculations and verification flags remain unchanged.
- Before/after comparison preserved all prior identity projections, contact points
  and customer links. There are now 29 customer links; one still needs account
  review. The refreshed planner has 823 proposals and 798 held accounts, including
  98 exported accounts absent from retained API sources. Full coverage remains open.
- This is publication through the existing LIVE controls, with no code, schema,
  provider, credential, permission or capture-schedule change.

[Customer coverage evidence](evidence/learn-customer-coverage-live-2026-10-14.json).


**14 October, 00:44 BST — completed job status visible in LIVE customer summaries.**

- The customer brief now combines its linked communications/actions with a scoped,
  expiring read of published job statuses. A real LIVE customer shows two recorded
  completed jobs alongside its two retained email entries. Both jobs' pending
  verification remains explicit; no status, verification flag, payment or date was
  invented. Opening a job and returning to the customer still works.
- Twenty-seven focused tests, TypeScript and the local build pass. Both isolated
  Git candidates built successfully on Vercel. LIVE `b3a74c4` is verified on all
  four existing aliases; protected TEST `f783f43` is verified on both stable aliases
  and in the existing signed-in operator session. Each retains its own previous
  frontend features and correct backend binding. No database/runtime/access changes.
- The initial LIVE check revealed that the source-completed jobs have a separate
  pending verification flag. The corrected release preserves and shows both facts.
  Completion counts describe up to 25 published linked jobs; the summary labels
  further jobs outside that read and does not establish full provider coverage.
- The individual job-card brief still needs its own recorded status, and unresolved
  owner names, wider publication, findings and scorecards remain open. This does
  not close the independent changed-job frontend acceptance gate.
- Slack at 23:40 UTC retained 14,838 sources, with 18 active and 118 archived windows
  complete. Recovery `fb47041d-ee55-478c-a655-6463921fdc4f` was still queued at the
  23:39 UTC read; no duplicate submission was made.

[Customer summary LIVE evidence](evidence/learn-customer-job-brief-live-2026-10-14.json).


**14 October, 00:26 BST — Slack notification handling verified LIVE; recovery queued.**

- The exact observed `automatic_ai_huddle_notes_enabled` message is now retained
  for source review by both LIVE workers and matching SQL. Its original payload
  stays intact and is not interpreted as customer activity or performance evidence.
  Existing records, access, credentials, schedules and campaign limits were preserved.
- All 107 Slack runtime tests, 18 full-schema journeys, exact release/rollback
  checks and both offline worker boots passed. All 1,591,580 archived COPY rows
  and seven sequences matched. These checks do not establish full provider coverage.
- The existing signed-in operator queued one recovery for the held archived channel.
  Job `fb47041d-ee55-478c-a655-6463921fdc4f` is queued at attempt zero; retain this
  handle and observe its outcome rather than submit another request. Provider
  acceptance for this particular marker is still unproven.
- The latest overall Slack read at 23:23 UTC retained 14,344 sources, with 18 active
  and 115 archived channel windows complete. Commusoft at 23:26 UTC has verified
  property/job stage receipts; customer contacts are 1,126 / 1,552 targets. Its
  current cycle watermark remains held until all remaining phases complete.
- Customer summary/ownership, broader linked coverage, findings and configurable
  scoring remain unfinished. The separate changed-job frontend acceptance gate
  remains open; this release does not satisfy it.

[Slack LIVE release evidence](evidence/learn-slack-observed-huddle-production-2026-10-14.json)
· [Exact release and rollback](../../supabase/release/learn-production-patches/slack-observed-huddle-v1/README.md).


**14 October, 00:10 BST — scoped communication reader verified LIVE.**

- The exact rehearsed reader is installed. A paired real-customer read returned
  the same two-row digest in 639 ms versus 5,625 ms before. Two existing-session
  LIVE refreshes show both emails and both Commusoft jobs without the communication
  read warning. This is measured acceptance for this card, not a broad latency SLA.
- All sixteen full-schema journeys and five release failure guards passed, including
  inverse rollback and membership restoration. The atomic LIVE release checks equal
  before/after fingerprints for 22 tables plus access/policies/schedules before commit.
  The client timed out waiting for its response; no mutation was repeated. Read-only
  reconciliation confirmed the exact committed function, owner/ACL, dependencies and
  original membership. The per-table fingerprint receipt was not returned, which is
  explicitly recorded as an evidence limitation.
- The customer brief still does not combine completed-job status into its summary;
  owner-name resolution, broader linked customer/contact coverage, findings and scoring
  remain unfinished. The unrelated changed-job frontend acceptance gate is still open.
- At 23:05 UTC Slack held 14,007 sources, with 18 active and 112 archived channel
  windows complete. One recovery job succeeded at 23:01 UTC; the other remains held
  for `automatic_ai_huddle_notes_enabled`. No failed job was blindly retried. The
  ongoing Commusoft customer-contact pass reached 910 pages, without advancing its
  cycle watermark prematurely.

[Verified LIVE reader](evidence/learn-card-reader-live-2026-10-14.json) ·
[Release and rollback procedure](LEARN-CARD-READER-CANDIDATES.md).



**13 October, 23:59 BST — existing customer context verified; reader fix rehearsed.**

- LIVE refresh now shows two retained email timeline entries alongside two newly
  linked Commusoft jobs on an existing customer card. The original person, card
  and both communication rows are unchanged. This establishes one real combined
  journey, not comprehensive client coverage. Owner resolution and the brief's
  completed-work summary still need integration.
- A transient LIVE communication read failed before the successful refresh. The
  exact error remains unconfirmed. The proposed reader now materialises linked
  candidates before source inspection. Its 5,000-record regression reproduces
  unnecessary unrelated-source inspection in the old query and prevents it in
  the candidate, with equivalent person/company/explicit-ID results.
- All sixteen offline full-schema journeys pass, including drafts, foreign-tenant
  reads, source withholding and reviewed Slack context. All 1,591,580 archived
  rows across 403 tables and seven sequences match. Transaction rollback and
  role-membership restoration pass. The reader change is **not installed LIVE**;
  a guarded release and signed-in post-install verification remain necessary.
- Slack at 22:54 UTC retained 13,857 records, with 17 active and 112 archived
  channel windows complete. One recovered job reached a newly observed
  `automatic_ai_huddle_notes_enabled` subtype and stopped at its checkpoint.
  Its handling needs implementation/verification before logged recovery; another
  recovery job remains queued. No blind retries were made. Commusoft's current
  customer-contact pass reached 805 pages, with its watermark still held until
  cycle completion.
- The separate refresh frontend remains held behind its pending sign-in
  clarification. Automatic approval review also rejected reopening that preview;
  this does not prevent the independent reader and ingestion work above.

[Existing LIVE customer context](evidence/learn-existing-customer-context-2026-10-13.json)
· [Offline reader acceptance](evidence/learn-card-communication-candidates-2026-10-13.json)
· [Slack follow-up](evidence/learn-slack-intake-followup-2026-10-13.json).


**13 October, 23:40 BST — further customer/job journey verified LIVE.**

- One more corroborated customer and its three explicit Commusoft jobs are published
  through the existing signed-in, logged LIVE operator controls. The LIVE card shows
  all three jobs. Totals are 26 published customers and 619 jobs; broader publication,
  contact/communication context, findings and scoring remain unfinished.
- Readback verifies source versions, actor, card ownership and account-holder
  evidence. The before/after comparison preserves 4,466 earlier identity projections,
  25 customer links, 1,552 customer payloads and 52 contact points within its stated
  scope. Original historical descriptions are retained; unknown completion timezones
  remain excluded from duration/performance calculations.
- The preceding read-only freshness audit found 615/616 published jobs current and
  one changed completion status; all 25 customer, 33 site and 33 contact links were
  current. This narrows the immediate refresh need without establishing full coverage.
- Slack at 22:34 UTC retains 13,673 sources, with 17 active and 110 archived windows
  complete. Both existing recovery jobs remain queued, attempt 0. Commusoft's next
  contact pass has reached 610 pages; its existing cycle is continuing without restart.
- New refresh frontend remains held, and its preview still shows sign-in. The
  ambiguous saved LIVE/TEST credential clarification remains pending. The existing
  LIVE session used here does not verify the new preview or satisfy its changed-job gate.

[Additional LIVE journey](evidence/learn-customer-reconciliation-second-2026-10-13.json)
· [Published projection freshness](evidence/learn-projection-freshness-2026-10-13.json).


**13 October, 23:24 BST — job-refresh backend preserved in LIVE; frontend held.**

- The exact guarded backend is installed in production. All nine function bodies,
  ownership and ACLs match; all 133,019 rows across sixteen compared tables retain
  identical digests. Both refresh ledgers remain empty. No job was changed.
- Isolated frontend `41a22e6` is READY at protected candidate
  `dpl_8aNn41L5xKaZADdN1YhNtxHTnrjt`, with verified rendered production binding.
  It contains the six reviewed UI files plus HTML no-store rules; the matching
  local build passes. LIVE aliases still serve `a11f204` / `dpl_FEvZQUizXBraRu71hJtGciJTPZER`.
- Automatic approval review rejected promotion before real changed-source
  acceptance. The saved credential named “Openfolk Test” points to app.openfolk.ai;
  copying it was separately rejected as ambiguous. Chris was asked to identify it.
  No password was copied, no session extracted, and no credential/grant changed.
- TEST has no linked jobs with newer retained source versions. Its current-source
  check passes; it cannot supply genuine changed-source acceptance without more
  provider input. The protected production preview is available for that check,
  using existing LIVE authority, before any alias change.
- Slack at 22:22 UTC retains 13,643 sources: 17/20 active and 110/160 archived
  windows are complete. The two recorded recovery jobs remain queued at attempt 0.
  The next Commusoft cycle has terminal property/job receipts; contacts are at
  phase 3, 490 pages against 1,552 customer targets, still running.
- Additional isolated two-session races and a later return to prior source content
  now pass. All three races observed actual lock waits and one durable outcome;
  all 15 native journeys and 1,591,580 archived rows / seven sequences are preserved.
  The disposable container was removed. This remains offline acceptance.

[Production backend and held frontend evidence](evidence/learn-business-job-refresh-production-2026-10-13.json).
[Concurrent/recurrence checks](evidence/learn-business-job-refresh-concurrency-2026-10-13.json).

The queued Slack recoveries were evaluated in a rolled-back read-only transaction
under the actual service-worker role context. Both are eligible with priority 60;
11 and 15 eligible jobs respectively were ahead at that observation. Their existing
handles remain authoritative. The initial administrative-role probe returned false
because the function requires service-role claims; it was not a production defect.



**13 October, 23:11 BST — TEST job-refresh UI partially verified; LIVE unchanged.**

- The isolated frontend `119b13d` is READY on both protected stable TEST aliases.
  Its rendered build and TEST backend binding were verified in the existing
  signed-in operator session. Linked-job search and the “already latest” review
  result pass. An actual changed-source apply remains unverified in hosted TEST.
- The stable page initially served the older build after reload. An exact release
  query loaded the correct build; the underlying cache cause still needs resolving.
  Do not infer browser acceptance from Vercel alias metadata alone.
- Both bounded review windows restored the original module/account settings.
  Capture remained disabled during each review; no new provider calls, access grants
  or canonical writes occurred. Raw browser evidence stays private and outside Git.
- The isolated LIVE frontend candidate `535ba3e` passes 24 tests, TypeScript and
  build, but is not deployed. Continue changed-source acceptance, fresh production
  preservation and the real source-to-card journey before promotion.
- Commusoft job-code authority and leading-zero preservation remain recorded in
  AGENTS and the QuickBooks integration notes. Historical financial codes require
  evidenced mappings; examples are not an automatic crosswalk.

[TEST deployment and partial browser evidence](evidence/learn-business-job-refresh-test-2026-10-13.json).


**13 October, 22:52 BST — job-refresh backend installed and preserved in TEST.**

- The exact LIVE package passes target/digest/definition/existing-object/late-failure
  guards, empty rollback, all 15 native journeys and a retained-history pause check.
  The TEST alignment and job-refresh journey also pass, including both empty
  rollbacks and restoration of restricted-reader role membership.
- TEST installation matches all nine expected definitions and access settings.
  All 78,378 rows across sixteen scoped source/canonical/access tables are unchanged;
  new refresh, cancellation and capture-proof tables remain empty. No provider
  requests, real refreshes, production changes or frontend feature release occurred.
- The existing TEST operator session is signed in. The six-file frontend candidate
  from the current TEST base passes 24 tests, TypeScript and build. Its deployment
  and signed-in feature acceptance remain next, before the LIVE source/card journey.
- LIVE Slack at 21:47 UTC retains 13,316 sources; 16/20 active and 107/160 archived
  channel windows are complete. Two observed recovery jobs remain queued, attempt 0;
  their authoritative handles were read without restarting them.

[Exact release rehearsal](evidence/learn-business-job-refresh-release-rehearsal-2026-10-13.json)
· [TEST backend readback](evidence/learn-business-job-refresh-test-2026-10-13.json).

**13 October — durable job-refresh cancellation passes offline.**

- The full native-schema rehearsal now covers cancelling obsolete previews,
  delayed apply fencing, late cancellation of committed work, a second source
  transition, ambiguous observations and revoked actor/module/connection access.
  All 15 journeys and the archived-row/sequence preservation checks pass.
- The matching client has 24 passing checks; TypeScript and build pass. This remains
  local evidence: TEST and LIVE have not received the refresh feature.
- Exact release guards and history-preserving recovery still need rehearsal. TEST
  lacks two LIVE Slack context helpers, so its baseline must be aligned deliberately
  before claiming cross-source browser acceptance. Broader LEARN work remains active.

**13 October, 22:11 BST — source-to-job refresh and matching review UX pass offline.**

- Added an append-only effective projection history and a reviewed Commusoft job
  refresh. The full-schema scenario advances open to completed and restores the
  proven customer/Slack context, without changing original identity links or source
  history. Owner/site changes and local edits are held; uncertain dates do not
  become invented instants. The real LIVE job has not been refreshed yet.
- The existing review UI now has a saved/latest comparison, review reason and durable
  scoped request recovery. Twenty-one client tests, TypeScript and frontend build
  pass. No new frontend, hosted schema or runtime was deployed.
- Full native-schema acceptance passes all 15 journeys, 42 withholding comparisons,
  the 600-job regression and the new reviewed refresh path. Installation preserves
  all 1,591,580 archived rows and seven sequences; the additional ledger is empty.
  The first rehearsal caught a comparison that treated the new empty table as a data
  change; the second caught a synthetic feature-flag constraint mismatch. Both were
  corrected before the third complete passing run; no hosted data was involved.
- Still needed before release: durable cancellation of obsolete pending requests,
  additional transition/revocation cases, exact matching guards/rollback and hosted
  TEST/browser acceptance. Then verify the actual LIVE completed-job/Slack journey.
  Broader customer/site/contact refresh, unattended reconciliation and the remaining
  LEARN coverage/scoring/operations requirements remain active.

[Refresh design and release work](LEARN-BUSINESS-SOURCE-REFRESH.md) ·
[Offline evidence](evidence/learn-business-job-refresh-rehearsal-2026-10-13.json).

**13 October, 21:53 BST — customer communication timeout fixed and verified LIVE.**

- The scoped `learn_card_slack_job_context` optimization is installed with its exact
  rehearsed definition, owner and execute ACL. The signed-in customer card with
  585 jobs now loads findings and communications without the earlier timeout;
  nine contacts remain visible. It honestly returns no linked communications.
- Full native-schema acceptance passed 15 journeys, 42 withholding comparisons
  and the 600-unrelated-job regression. All 1,591,580 archived rows and seven
  sequences were preserved. Rollback and target/digest/definition/access guards
  passed. LIVE readback separately preserves all 33 contact source links, people,
  endpoint choices, source payloads, actors and relationships.
- A real reviewed Slack conversation is still correctly withheld from its customer
  timeline because the linked Commusoft job version is stale. Exact source comparison
  shows the job changed from `ongoing` to `completed`; only status/completed/closed
  fields changed, while provider identity and property reference stayed the same.
  The current canonical job remains open. This is a missing source-refresh workflow,
  not a reason to bypass freshness checks or rewrite immutable source links.
- Next: implement an audited, versioned refresh of published business records,
  retaining original links and source history, checking current ownership and local
  edits, and exposing held changes for review. Update source-aware card readers and
  verify the real completed-job/Slack journey. Broader publication, communication
  matching, capture coverage, scoring and operational readiness remain unfinished.
- Latest observed LIVE inputs at 20:51 UTC: 33,111 emails, 4,462 calls, 2,984 recording
  records, 12,470 Slack sources and 255 visible voicemails. Saved totals are not
  historical coverage or completed-learning claims.

[Production acceptance](evidence/learn-customer-context-lookup-production-2026-10-13.json)
and [full-schema rehearsal](evidence/learn-customer-context-lookup-rehearsal-2026-10-13.json).

**13 October, 21:44 BST — first complete scheduled Commusoft traversal verified LIVE.**

- All four stages in the first unfiltered scheduled cycle have durable terminal
  checkpoints backed by successful worker/page receipts. The cycle completed at
  20:28:01 UTC and advanced its watermark to 16:02:03 UTC. Capture remains enabled;
  the next scheduled check is 21:28:01 UTC. No job was manually restarted.
- Properties: 25 pages, 1,552 customer records and 871 work addresses. Jobs: 127
  pages, 12,637 records. Customer contacts: all 1,552 frozen customer targets,
  2,402 distinct contact records. Site contacts: all 871 frozen site targets,
  567 distinct contact records. Both contact terminal counts equal their plans.
- This proves traversal of the authorized API inventory, not complete agreement
  with Commusoft's UI. The previously observed 98 customer/111 site count differences
  remain unresolved. Initial capture is not an atomic snapshot; subsequent cycles
  must overlap the retained watermark. Canonical publication and communication
  matching remain separate: 25 customers, 33 sites, 616 jobs and 33 contact source
  links are currently published.
- Slack continues: 12,321 retained sources at 20:39 UTC; 15/20 active and 103/160
  archived channel windows complete. Thread capture has 298 active-campaign and 18
  archived-campaign captured threads; other observed/queued threads remain unfinished.
- The communication-reader candidate passed the 600-unrelated-job regression,
  preserving the reviewed conversation while refusing unnecessary source traversal.
  Full-schema acceptance is rerunning its final checks after the superseded rollback
  correctly refused to overwrite the newly changed helper. No context patch is LIVE
  yet; the previous visibility-helper release remains installed.

[First complete cycle evidence](evidence/learn-commusoft-first-live-cycle-2026-10-13.json).

**13 October, 21:36 BST — visibility lookup fix LIVE; separate communication lookup remains.**

- Replaced only the private `learn_slack_document_withheld` helper. Its exact
  definition, owner and execute ACL match the rehearsed package. Existing callers,
  visibility rules, source rows, runtime artifacts and frontend are unchanged.
- Full native-schema rehearsal passed all 15 existing journeys and 42 comparisons
  against the original withholding semantics. All 1,591,580 archived rows and seven
  sequences were preserved. Exact wrapper guards, transaction rollback and
  definition rollback passed; both isolated containers were removed. Production
  contact preservation readback confirms all 33 source links, people, endpoint
  choices, payloads, actors and relationships remain unchanged.
- Signed-in LIVE now reads the reviewed company's findings successfully. The
  independent communication read still times out (57014 at 20:33:52 UTC) inside
  `learn_business_input_latest`, called while `learn_card_slack_job_context` checks
  all 585 owned jobs. Its materialized input needs restricting to jobs with reviewed
  Slack interactions before current-source validation. A candidate is prepared
  privately, not tested or applied; retain every final source/visibility check.
- The card still shows nine contacts and 585 jobs. These useful published records
  do not establish a complete communication timeline. No missing communications
  or findings are converted into successful-learning claims.
- Both known Slack recovery jobs were still queued with zero attempts at 20:35:34
  UTC. Their handles remain unchanged. Do not duplicate or restart them just because
  the archive queue is taking time.
- Next priority: rehearse and release the scoped communication lookup fix, verify
  the full signed-in card read, then continue contact/communication reconciliation,
  remaining capture coverage, scoring and operating-readiness gates.

[Production evidence](evidence/learn-slack-visibility-lookup-production-2026-10-13.json)
and [full-schema rehearsal](evidence/learn-slack-visibility-lookup-rehearsal-2026-10-13.json).

**13 October, 21:26 BST — company contacts verified LIVE; card read timeout diagnosed.**

- Eleven reviewed source-contact links now represent nine distinct people on the
  previously linked company card; two site sources reuse existing people after
  explicit name, individual-email and company/site corroboration. The LIVE client
  view shows nine contacts. All source payloads, versions, actors and customer/site
  ownership were checked. Reuse preserves original card/endpoint evidence; the
  additional site relationship and immutable source link retain the newer evidence.
- All 22 previous contact links, 4,457 identity projections, 1,552 customer source
  heads, 25 customer links and 35 contact points remain unchanged. Nine people and
  17 non-primary, unverified contact points were added. No permissions, capture
  settings or provider records changed. This is scoped preservation evidence.
- A separate named contact sharing an office phone remains held. Do not merge
  different people because they share a reception number. Explicit shared-office
  endpoint review and department/non-person contacts still need completion.
- The LIVE card's findings read reproducibly times out (Postgres 57014 at 20:20:24
  and 20:22:17 UTC). Server error context identifies `learn_slack_document_withheld`
  through the source-visibility policy. One communication read also timed out;
  the subsequent read succeeded but returned no linked communications. Do not
  describe this as a complete or healthy customer timeline.
- A semantics-preserving candidate scopes withholding dependency checks to UUID
  references present in the requested document. It is under isolated full-schema
  rehearsal; **not deployed**. Keep source-withholding protection and existing ACLs.
- The two known Slack recovery handles remain queued, attempt zero, verified at
  20:19:08 UTC. No duplicate recovery was created. LIVE UI later showed 12,249
  retained Slack sources, 32,616 emails, 4,462 calls, 2,984 recordings and 255
  voicemails; counts do not prove historical coverage or completed learning.
- Next: finish/release the card-read fix with preservation and signed-in evidence,
  extend meaningful contact/communication reconciliation, finish connector coverage,
  scoring and unattended operational acceptance. The full goal remains active.

[Contact publication evidence](evidence/learn-company-contact-publication-2026-10-13.json).

**13 October, 21:11 BST — one substantial customer journey linked and verified LIVE.**

- One company account was corroborated against its retained Commusoft source,
  current customer export and full existing-identity snapshot, then saved through
  the existing logged operator review. No possible identity collisions were merged.
- All 22 sites and 585 jobs belonging to that account in the retained snapshot are
  now linked. Every job's explicit property reference and customer/site ownership
  was verified; the database readback checks every source link, original actor,
  customer card and site relationship. Source descriptions and historical codes
  remain unchanged. These are unverified canonical records with explicit source
  evidence, not independently verified job-completion facts.
- The signed-in LIVE card shows 585 linked jobs (25 on its first page) and 22 sites.
  Source completion times without confirmed timezones remain excluded from duration
  and performance calculations. Communications and contacts are not complete for
  this customer. Complete provider coverage is not claimed.
- All 4,456 previous identity projections, 1,552 retained customer heads, 24 prior
  customer links and 35 contact points were unchanged. No new grant, schema/runtime
  deployment, provider write or paid AI was involved. This is scoped preservation,
  not a hash comparison of every production row.
- Total published business links are now 25 customers, 33 sites, 616 jobs and 22
  contacts. LIVE Slack has 12,127 sources; 102 archived windows and 15 active windows
  are complete. Commusoft site-contact capture remains active with no full-cycle
  watermark yet. Both known Slack recoveries were still queued at 21:03 BST.
- Next: extend evidence-backed customer/contact/communication reconciliation,
  make long job histories easier to scan by current work and date, complete input
  coverage and ongoing capture, then scoring and operational acceptance. The full
  goal remains incomplete; this account is not a substitute for broad coverage.

[Live customer/site/job evidence](evidence/learn-customer-site-job-publication-2026-10-13.json).

**13 October, 20:55 BST — observed Slack canvas retention released; recovery queued.**

- LIVE `learn-slack-worker` v10 and `platform-worker` v71 now retain the exact
  observed `tabbed_canvas_updated` subtype as source needing review. Matching SQL
  classifies and counts it consistently; it cannot create conversation/performance
  evidence. Genuine observed replies remain eligible. Other unknown or hidden
  shapes stay held. No undocumented business semantics are inferred.
- Exact transaction/rollback/guard and source/thread journeys passed on the isolated
  full native schema; all 1,591,580 archived rows and seven sequences were preserved.
  All 106 Slack runtime tests passed, and both exact artifacts booted without
  network and rejected missing authentication. Production definitions, worker
  hashes, existing permissions, secrets metadata, schedules and retained Slack
  versions were verified; all 255 voicemail/source pairs were preserved.
- One recovery was committed through the signed-in LIVE operator controls:
  `197a31a7-1297-4319-b90c-be0689ea2e31`. It is queued. The earlier recovery
  `12df1bd3-d9cf-4379-8e7f-199faf0b6b19` also remains queued. Observe these handles;
  do not create duplicates or claim the affected provider page has succeeded yet.
- At 20:54 BST LIVE held 12,045 Slack sources; 15/20 active and 99/160 archived
  campaign windows were complete. Observed replies and ongoing capture handoff
  remain unfinished. Commusoft phase 4 site-contact capture is active with no
  completed first-cycle watermark. Its latest browser observation showed 526/871
  site-contact pages retained. Existing worker progress must not be restarted.
- Wider source publication remains 24 customers, 11 sites, 31 jobs and 22 contacts.
  Customer/job reconciliation, coverage exceptions, scoring and unattended
  operational acceptance remain substantial unfinished requirements. The LIVE
  frontend was not changed by this backend release; parallel QuickBooks TEST
  work was preserved in Git but excluded from the two LIVE runtime artifacts.

[Production evidence](evidence/learn-slack-observed-canvas-production-2026-10-13.json).

**13 October, 20:39 BST — ingestion advancing; two archived Slack holds diagnosed.**

- LIVE has 11,900 saved Slack messages. The active-channel campaign has 15 of 20
  approved channel windows complete; the archive campaign has 98 of 160 complete.
  Thread discovery is complete for 20 active and 138 archived channels. Remaining
  history/replies and the ongoing-capture handoff are not complete.
- In the preceding hour, 576 Commusoft jobs, 53 Slack reply jobs and six Slack
  history jobs succeeded. Commusoft has a currently leased running job in phase 4
  (site contacts); its first full-cycle watermark is still absent. Do not restart
  this active cycle merely because full coverage remains unfinished.
- Two archived channels were held for an unsupported subtype. One retained
  diagnostic identifies `tabbed_canvas_updated`; official documentation reviewed
  does not establish its semantics. Prepare exact source-only retention and
  explicit review accounting, retaining hidden/content-availability guards;
  do not infer conversation, customer or performance meaning from the name.
- The other failure had no structural diagnostic. One exact recovery was committed
  through the existing logged operator UI under the original campaign allowance.
  Job `12df1bd3-d9cf-4379-8e7f-199faf0b6b19` is queued as last verified at 20:39 BST.
  Observe that handle before further action; do not create another recovery or
  restart the campaign. No history page or unsupported record was skipped.
- Published source relationships remain 24 customers, 11 sites, 31 jobs and 22
  contacts, with one reviewed Slack work-context link. Broad source-to-card
  reconciliation is a major remaining delivery requirement, not a cosmetic task.

[Current input evidence](evidence/learn-input-progress-2026-10-13-2036.json).

**13 October, 20:35 BST — saved contact details verified in LIVE and stable TEST.**

- LIVE now shows additional saved email/phone details beneath each contact, with
  pagination, source and verification state. A signed-in operator opened two real
  unverified endpoints; primary selections stayed unchanged and the read was audited.
- The additive reader is installed in both environments. LIVE Git `a11f204`,
  deployment `dpl_FEvZQUizXBraRu71hJtGciJTPZER`, serves all four existing aliases.
  TEST Git `c7744a8`, deployment `dpl_6Vb2z8TyE43LuyMevbZnuhvtG8sq`, serves both
  stable TEST aliases with protection `all`. It preserves the parallel QuickBooks
  callback fix and finance panel; that QuickBooks work is not promoted to LIVE here.
- Stable TEST signed-in acceptance shows an existing contact's primary email and
  honestly reports zero additional details. Its matching operator audit is verified.
  LIVE preservation retains 18,053 prior business-source versions, 4,505 pages,
  88 links and all prior customer identity IDs. Access, schedules, connections,
  flags and unrelated functions are unchanged. This is scoped preservation,
  not a full-row hash of every production table.
- Ten contact/context tests, TypeScript and both frontend builds passed. Exact
  SQL envelopes and isolated access/pagination/rollback journeys preserve all
  1,591,580 archived rows and seven sequences. No new hosted login or grant.
- The saved-contact display gap and this TEST parity gap are fixed. Broader
  customer publication, communication attribution, full historical/recurring
  coverage, scoring and operational acceptance remain unfinished. Browser
  acceptance here uses the operator; Heidi's own acceptance remains separate.

[Release evidence](evidence/learn-contact-details-production-2026-10-13.json).

**13 October — saved contact details candidate verified; release in progress.**

- The contact card now distinguishes primary selections from additional saved
  contact points. An expandable, paginated reader shows channel, label, verification
  state and source without changing identity, primary, consent or verification.
- Ten client contract tests, TypeScript and the final production build pass.
  An isolated native restore plus 24 release packages proves paging, tenant/card/
  person isolation, inactive relationship denial, shared/invalid endpoints, audited
  operator reads, revoked authority and failure when audit recording fails.
- Exact TEST and production envelopes pass wrong-target/digest, dependency drift,
  late-failure and rollback checks. All 1,591,580 archived rows and seven sequences
  remain identical; the disposable containers were removed. Live dependencies
  match those tested. No fixture users or grants are retained or added to hosting.
- Installation, matching frontend deployment and signed-in real-data acceptance
  must be recorded before this display gap is considered fixed in LIVE. This
  candidate does not complete communication attribution or broader reconciliation.

[Candidate evidence](evidence/learn-contact-details-candidate-2026-10-13.json) ·
[Exact additive release](../../supabase/release/learn-production-patches/contact-details-v1/README.md).

**13 October, 20:04 BST — seventeen LIVE contact relationships verified.**

- Reviewed the 22 retained contact sources attached to the twenty newly reconciled
  accounts and their four sites. Published 17: twelve reuse the corroborated
  account-holder person; five create distinct named, unverified people. Readback
  verifies all source versions, original operator, card relationships and the one
  applicable site relationship. Twenty-nine source contact points remain unverified
  and non-primary; no consent or endpoint-verification decision was inferred.
- Five sources remain held: two possible duplicate/alias contacts, one departmental
  label, and two named contacts whose endpoints collide with existing unnamed
  identities. The collision guard prevented new duplicates. Those unnamed records
  must be reconciled using communication evidence before choosing a person; shared
  endpoints alone are insufficient. No automatic merge was attempted.
- A signed-in LIVE company card displays its newly linked contact alongside its
  already-published jobs. This is operator-view acceptance, not a new claim of
  ordinary-client permission acceptance or complete contact/provider coverage.
- All 4,451 prior identity projections, six prior contact-point projections,
  24 customer links, 1,552 retained customer heads and five prior contact links
  are unchanged. The earlier release preservation check also passes for its
  immutable sources, identity IDs, permissions, schedules and configuration.
  These checks are scoped comparisons, not a full-row production database hash.
- Recurring Commusoft capture has reached phase 4 (site contacts), enabled and
  window-active at 19:03 UTC. Full-cycle completion is not yet verified. Broader
  customer publication, source-to-card communication attribution, the additional
  contact-point display gap, scoring, TEST parity and operational gates remain.
- No frontend/schema release, new access grant, provider write or paid AI request.

[Contact acceptance evidence](evidence/learn-contact-reconciliation-2026-10-13.json).

**13 October, 19:47 BST — broader LIVE reconciliation: twenty more customer cards.**

- A reusable read-only planner reconciles the actual customer export with retained
  sources, tenant-specific category evidence and existing people/companies/contact
  points. It makes bounded proposals, never approvals, merges or provider writes.
  Eighteen tests cover scope/freshness, changed identities, shared endpoints,
  duplicate exports, ambiguous observations and missing provider records.
- The first twenty proposals passed fresh logged operator checks and were saved
  in LIVE. Their four sites and eighteen jobs are also published. Readback verifies
  all forty-two source links, ownership, original actor and person-account evidence.
  A signed-in live card shows two jobs, including a pending job created today and
  an open job. Contacts and communication links for this group still need work.
- All 4,431 pre-existing identity projections (ID/type/name/email/phone/postcode),
  four prior customer links, six contact points and 1,552 retained customer source
  heads match the pre-run snapshot. The earlier release preservation verifier also
  passes for immutable sources, access, schedules and prior identity IDs. This is
  not a full-row comparison of every canonical or communication table.
- The refreshed report has **24 linked customer accounts, 828 review proposals and
  798 held cases** across the 1,650 exported account IDs. Nine additional proposals
  now have possible matches after the new cards were created, confirming why each
  group must refresh its candidate checks. Held reasons overlap; the 98 API-missing
  customers remain held. Nothing automatically approves the remaining proposals.
- No new schema/frontend release, access grant, provider write or paid AI request.
  Broader customer context, the contact display gap, scoring, provider coverage,
  TEST frontend parity and full operational/recovery acceptance remain unfinished.

[Reconciliation procedure](LEARN-CUSTOMER-RECONCILIATION.md) ·
[Bounded LIVE evidence](evidence/learn-customer-reconciliation-2026-10-13.json).

**13 October, 19:25 BST — one LIVE customer now has connected sites, jobs and contacts.**

- Logged operator reviews published six sites, ten jobs (four direct and six
  through sites), and five contacts onto the previously verified account card.
  Existing account-holder identity was reused for its matching contact; additional
  people remain distinct and unverified. All 21 reviewed source links retain their
  versions and original actor. There is still exactly one card for that account.
- Read-only acceptance verifies site/job ownership, five active contact-to-card
  relationships and two unverified, non-primary contact points for the account
  holder. Signed-in LIVE shows ten jobs and six sites; three account contacts were
  visually checked before the two further named site contacts were published.
- Four contacts labelled only “Occupier” remain unpublished. The card reader also
  exposes only primary email/phone, so it currently omits the account holder's two
  additional saved contact points. This display gap needs fixing without changing
  primary/verification choices. Completion timestamps without a timezone remain
  excluded from duration and performance calculations.
- Preservation readback retains the earlier 18,052 versions, 3,697 pages, seven
  source links and all prior people/company/card IDs. Access, policies, schedules,
  connections, flags and unrelated functions are unchanged. No provider writes,
  new grants, schema changes, frontend release or paid AI work in this step.
- This proves a connected real customer journey, **not broad card completion**.
  The 18:17 UTC inventory contains 12,637 latest job versions and 2,969 contacts;
  1,553 jobs reference properties absent from retained property sources, and 18
  sites lack a retained customer parent. The scalable reconciliation path must
  expose those gaps and the already-confirmed API/UI discrepancy rather than
  invent relationships. Wider publication remains the next priority.

[Connected customer evidence](evidence/learn-reviewed-customer-context-2026-10-13.json).

**13 October, 19:06 BST — account-holder review released; one real LIVE card verified.**

- The exact guarded backend is installed in TEST and production. Production
  retained all 18,052 prior business-source versions, 3,697 pages, seven links,
  customer identities, access, schedules, connections and flags. The subsequent
  real reviewed save added one person/card/link without changing earlier history.
- Git 9091ce4, deployment dpl_BdmR3wuhjf1ghYYN58sQQgeYbMpG, now serves the existing
  live aliases. Its production auth binding and signed-in review form are verified.
  TEST's frontend has not been updated by this release.
- A real account was checked against the fresh provider export and searched by
  name/surname/postcode before creation. Its account-holder name is separate from
  the primary contact, whose email/phone were not copied. Source, actor and review
  evidence are retained, with an audited result receipt and exactly one card.
  The card opens through logged operator access and shows zero published linked
  jobs with an explicit coverage limitation. Broader card reconciliation remains.
- The guarded SQL passed target/digest/drift/late-failure and rollback rehearsals;
  the source and operator journeys preserve all 1,591,580 archived rows and seven
  sequences. TEST's absent pg_cron table was caught in a read-only preflight and
  handled before applying either release. No new access grant or provider write.

[Release evidence](evidence/learn-customer-account-holder-production-2026-10-13.json).


**13 October, 18:47 BST — account-holder review candidate verified locally.**

- New person-card review now requires a checked customer account name and an
  explicit same/different primary-contact decision. Different contacts' email
  and phone are not copied onto the account holder. Existing reviews and source
  history remain intact; no broader customers were published.
- Fourteen focused tests, TypeScript, 47 prebuild checks and the build pass.
  An isolated native restore plus 24 reviewed packages verifies the writer,
  operator audit/isolation, stale-source rejection, exact legacy retries and
  rollback, preserving 1,591,580 archived rows and seven sequences. Its disposable
  container was removed. Later unrelated Slack changes are outside that baseline.
- This is **local-only**. Current hosted-schema comparison, matched deployment
  and signed-in review acceptance remain before describing the feature as LIVE.
- A fresh read at 17:45 UTC shows LIVE recurring Commusoft capture at 840 customer-
  contact pages, with valid actor/connection authority. Site contacts and the
  full recurring-cycle watermark remain unfinished.

[Candidate and release requirements](LEARN-CUSTOMER-ACCOUNT-HOLDER.md) ·
[Verification evidence](evidence/learn-customer-account-holder-candidate-2026-10-13.json).


**13 October, 18:22 BST — Slack replies advancing; Commusoft coverage reconciled against its UI.**

- The recovered Slack channel entered normal reply discovery: 20 threads found and
  its first scheduled thread succeeded at 17:08:09 UTC. The old failed attempt is
  not blocking it. Discovery and remaining replies continue in bounded batches.
- Current Commusoft category IDs and labels are now corroborated by authenticated
  provider navigation. Ambiguous customer representations still need review.
- The API's independent counts match all 1,552 captured customers and 871 sites.
  Its UI shows 1,650 customers and 982 sites; a fresh export confirms 98 additional
  customer IDs. One active UI customer returns API 404. Full provider coverage is
  therefore not established, even though the available traversal is exhausted.
- All three published customer-card names agree with the fresh export. Wider
  review found that API primary contacts can differ from account holders. The
  next card implementation must retain their distinct identities and evidence
  before broad person publication. No automatic merge or complete-card claim
  was made.

Evidence: [provider coverage reconciliation](evidence/learn-commusoft-provider-coverage-2026-10-13.json),
[Slack scheduled discovery](evidence/learn-slack-recovery-discovery-2026-10-13.json).

**13 October, 18:06 BST — LIVE Slack repair completed its real history page.**

- The additive SQL and both matching workers are published and read back:
  Slack worker v9, platform worker v70. Retained Slack identities/versions,
  voicemail records, access, connections, runtime configuration and schedules
  passed preservation checks.
- A post-commit check initially disagreed with PostgreSQL's schema-qualified
  policy formatting. A separate read-only canonical comparison verified all
  12 exact policies and the existing rules; no SQL write was replayed.
- Git 5b276dd now serves all existing live aliases. Its production authentication
  target and signed-in operator controls were verified, retaining the live design.
- The exact held channel page succeeded at 17:05 UTC in one attempt, saving
  80 records and completing that channel's history window. Two unavailable
  markers were retained without publishing conversation interactions. Their
  ordinary reads are suppressed; prior source history and campaign limits remain.
  Signed-in LIVE shows the two unavailable records and the captured history
  window. Both markers were new inputs; suppression of older stored previews
  was exercised in the offline rehearsal, not by this live page. Reply discovery/
  capture and the wider campaign remain unfinished.

Evidence: [LIVE Slack release](evidence/learn-slack-withheld-production-2026-10-13.json).

**Earlier 13 October checkpoint — local verification before the LIVE release above.**

- The exact observed Slack unavailable-message marker is retained without
  becoming conversation content. Prior versions remain protected; stale replays
  cannot restore them through ordinary context or scores. Available replies are
  processed independently, with a separate unavailable-source count.
- All 126 focused tests, typechecking and the production application build passed.
  The full native-schema rehearsal ran as the production maintenance role,
  passed 13 journeys and preserved all 1,591,580 archived rows and seven sequences.
- At that earlier checkpoint, deployment was pending. The LIVE release above
  supersedes that status; wider history and reply acceptance remain unfinished.
  Previously published card summaries without per-field provenance require
  explicit reconciliation; the import stops atomically in that case.
- LIVE recurring Commusoft capture reached 290 customer-contact pages at
  16:50 UTC, after its property and job stages. Canonical customer reconciliation
  remains distinct from completed source imports.

Evidence: [Slack candidate verification](evidence/learn-slack-withheld-candidate-2026-10-13.json).

**13 October, 17:32 BST — recurring backup procedure accepted; contacts advancing.**

- The combined manual backup verified 2,990 phone files and all 255 voicemail
  email/audio pairs in AWS, including 40 new phone files. The independent monthly
  voicemail runner restored a pair, decoded 20.448 seconds and confirmed cleanup.
- The existing 09:00 follow-up now uses the verified three-bucket daily procedure
  and retains both phone and voicemail monthly checks. Its saved configuration
  was read back. Dependable scheduled execution and full application recovery
  remain separate unfinished requirements.
- The LIVE recurring Commusoft job stage completed and automatically advanced to
  customer contacts; 40 contact pages were settled at 16:25 UTC. Site contacts,
  a completed recurring-cycle watermark and pause/re-enable acceptance remain.
- Current Commusoft customer-category names and two descriptions were read in the
  existing authenticated provider UI without changing settings. Numeric type IDs
  were not exposed there; their classification and canonical identity review remain
  incomplete. The settings API denial is not resolved by this UI observation.

Evidence: [communication backup and monthly restore](evidence/learn-communication-daily-2026-10-13.json).


**13 October, 17:20 BST — customer review evidence and monthly restore runner advanced.**

- Correct title-inclusive full-name comparison corroborates1,237of1,552 latest
  customer sources against the sealed historical ID/name/postcode export, up
  from322. No merge or classification rule was inferred;39IDs still lack
  historical counterparts and current customer-type access remains unavailable.
- The reusable AWS-only monthly voicemail pair restore runner passed20offline
  tests, including real WAV decode and verified cleanup. Its real acceptance
  awaits the first combined backup aggregate, still running under its original
  process. Existing schedules are unchanged.
- Commusoft's recurring jobs stage reached92settled pages at16:17UTC. The
  property stage had completed automatically; both contact stages remain.


**13 October, 17:04 BST — ongoing Commusoft capture enabled.**

- The bounded dispatcher is LIVE and the existing logged operator approved only
  Drummonds:2,000pages per stage,100records per page. The normal scheduler opened
  its first recurring property window at16:02UTC, completed25pages by16:06UTC
  and automatically advanced to jobs by16:08UTC. All four stages, later
  incremental updates and pause/re-enable acceptance remain to be observed.
- Activation changed only the existing dispatcher boolean. Runtime artifacts,
  other configuration, access, schedules and retained voicemail evidence passed
  preservation checks. No new credential or grant was introduced.
- The three-bucket phone/voicemail backup supervisor passed52offline tests in the
  main checkout. Real repeat verification and schedule activation are next; this
  is not yet evidence of dependable unattended daily backups.


**13 October, 16:46 BST — Slack queued continuation repaired.**

- The exact retained child is now claimable under its original campaign, cursor
  and request allowance. The initial repair refusal was missing infrastructure
  execution context; a clean-session rehearsal verified the correction before
  application. No new user grant or access scope was introduced.
- All 9,037 source/version rows present during repair were preserved, alongside
  permissions, schedules and campaign bounds. At 15:46:09 UTC the normal scheduler
  completed the repaired page in one attempt (five records), exhausting that
  channel's history cursor. Reply/discovery completion remains separate; no manual
  dispatch was used.
- The fresh independent database/voicemail recovery below is complete for its
  snapshot and sampled pair. Ongoing backup acceptance, customer/job reconciliation
  and the remaining Slack withheld-source handling continue.


**13 October, 16:39 BST — fresh independent database and voicemail relationships recovered.**

- The approved encrypted AWS copy was independently downloaded, decrypted and
  restored in isolation. All 1,726,602 native archive rows, 2,652 operational rows,
  18 Vault secrets and 2,977 recording relationships verified. Disposable restore
  containers were removed; production was unchanged.
- A second isolated read matched the sampled voicemail's intake, original-email
  source, voicemail message and both private storage records to the separately
  restored email/audio pair. All five relationships passed; audio decoded to
  25.344 seconds. This closes the prior pre-import-snapshot relationship gap.
- Slack recovered-page continuation now omits the one-use marker from normal
  successors. The separately guarded repair of the existing child refused its
  receipt/state check and remains held at zero attempts, pending read-only diagnosis.
  Source history, access, schedules and campaign limits were preserved.
- The snapshot is from 14:27 UTC: it does not cover later arrivals or releases.
  Human listening, full application recovery and dependable daily database/voicemail
  operation remain unverified. Daily voicemail backup preparation is in progress.

Evidence: [independent recovery](evidence/learn-independent-recovery-2026-10-13.json).


**13 October, 16:25 BST — independent copy downloaded; final restore resuming.**

- The fresh encrypted database package was copied to the approved independent
  destination and downloaded using the separate Restore identity. The downloaded
  294,441,336 bytes match the prepared SHA-256. Final decryption/native restore
  stopped at renewed 1Password authorisation; Chris has now completed Touch ID.
  A successful final restore and voicemail relationship comparison remain required.
- Slack scheduling is advancing: 13 active channels have completed their scoped
  history and observed replies, five are processing replies, one is importing
  history and one remains held. Round-robin scheduling explains general latency.
- A separate defect affects the single recovered history continuation: it copied
  a one-use recovery marker and is therefore correctly rejected by the exact
  authority guard. Its checkpoint is preserved. A narrow SQL correction has passed
  local full-schema tests and is being prepared for guarded production application;
  it is not yet released. Hidden tombstone handling remains separate work.


**13 October, 16:16 BST — three formerly held Slack pages recovered; review notice LIVE.**

- Exact logged retries after Slack v7/platform v67 succeeded once each, processing
  99, 100 and 77 records. Six retained welcome-type sources now show an honest
  operator review notice; they are excluded from conversation interpretation and
  scoring. Original source versions and campaign bounds remain retained.
- Frontend `37731bd` is live at the existing aliases. Protected candidate backend,
  browser errors and signed-in live review notice were checked; the full build
  passed. GitHub TEST checkpoint matched the exact commit.
- Successful pages do not prove whole-channel completion: the campaign still
  reports review/discovery gaps and remaining thread work. The hidden tombstone
  is a withheld-content marker, not proof of permanent deletion. Its safe handling
  must also prevent old previews/scoring/stale replay from republishing content.
- The encrypted database copy retry is still running under its existing handle
  after a bounded transfer-deadline fix. No new independent restore is claimed.

Evidence: [source-review live release and page outcomes](evidence/learn-slack-source-review-live-2026-10-13.json).


**13 October, 16:02 BST — all four initial LIVE Commusoft source traversals complete.**

- Production retained 2,423 property sources (1,552 customers and 871 sites),
  12,633 jobs and 2,969 distinct contact sources across customer/site passes.
  Customer contacts checked 1,552/1,552 targets; site contacts checked 871/871.
  All four cursors exhausted, the final account has no active source job, and
  before/after input totals did not decrease. Recurring capture and comprehensive
  canonical customer/job/contact publication remain unfinished.
- Slack recovery controls are LIVE on frontend `96e9336`, with Slack worker v6
  and platform-worker v66. One bounded diagnostic retry per held channel found
  three `welcome_party` records and one hidden `tombstone`. These pages remain
  held with original checkpoints. A narrowly retained source-review treatment
  for `welcome_party` is now schema/runtime verified (Slack v7/platform v67),
  with provider retry and frontend notice still pending; withheld-marker
  handling is separate and must prevent stale-content resurrection.
- Seven ongoing voicemail routes completed the 30-minute monitor without a new
  message or capture error. All 255 voicemail pairs remain retained; first new
  arrival acceptance is still unproven. The 510-file independent backup and
  sampled paired audio restore are verified; daily voicemail backup is unfinished.
- A fresh 291,316,647-byte database archive restored in isolation, matched native
  archive contents/catalog and recovered all 18 Vault secrets against live values.
  Its encrypted package passed local decrypt verification. The independent copy
  stopped with an unconfirmed S3 request; a subsequent exact-object lookup found
  no completed object. No independent restore from this new package is claimed.
  The prior independent database snapshot remains available. Bounded transfer
  timeout diagnosis is in progress; no production source was changed.
- The current LIVE frontend contains the clearer card read-error wording and the
  previously verified representative customer → job → Slack excerpt journey.
  Full LEARN V1 acceptance remains open, including all-input coverage, canonical
  relationships, scoring evidence, ongoing operation and recovery automation.

Evidence: [initial Commusoft capture](evidence/learn-commusoft-initial-live-complete-2026-10-13.json).


**13 October, 15:19 BST — first LIVE customer → Commusoft job → genuine Slack excerpt verified.**

- The logged exact-source replay succeeded on its first scheduled attempt. Its
  unchanged source version now has a matching public-channel visibility proof.
  Signed-in customer and job cards show the same retained communication; the
  expandable excerpt contains the actual outstanding job questions. This verifies
  one reviewed relationship, not complete customer matching or AI understanding.
- One initial customer read failed; a fresh read returned the expected timeline.
  The generic owner/admin warning misclassifies an unclassified read failure and
  has a local wording correction (22 existing card/communication checks passed),
  awaiting frontend release. The dedicated original Slack source reader remains unavailable;
  the retained excerpt and provenance are available.
- Customer contacts completed all 1,552 customer targets (2,402 contact records at
  completion). The 871-site contact pass is still running; at least 425 supervised
  requests have verified. Complete contact coverage and recurring Commusoft capture
  remain open.
- Seven ongoing voicemail routes are enabled under a dependency-aware monitor;
  20 observations have seen no new arrival. All 255 published pairs are retained.
  First-arrival import and playback acceptance remain unproven.
- Independent backup finalized all 255 original emails and 255 audio files
  (37,423,346 bytes). At 15:23 BST, a separate Restore identity verified one matched
  pair and decoded 25.344 seconds of audio without source access. Isolated database
  relationships, listening and recurring voicemail backups remain unfinished.
- Slack held-page recovery is locally prepared and rehearsed, not deployed. Four
  channels still need observed structural diagnostics and recovery. The active
  voicemail monitor must finish before shared-runtime publication.
- The live frontend now also includes the separately verified Emma recap/cost
  release from `ac4810b`; see its release record. QuickBooks work has moved to the
  separate **Quick Books Integration** chat and is not counted as completed here.

Evidence: [current production checkpoint](evidence/learn-live-customer-slack-progress-2026-10-13.json).


**13 October, 14:22 BST — 255 LIVE voicemail/source pairs; transcript display and playback verified.**

- The final seven current-template sources imported successfully; two replays retained
  their identities. All 248 prior messages/sources, owners/managers, route/scan controls
  and private buckets are preserved. All 13 historical routes remain paused.
- Matching importer v7/platform-worker v64 are published. The narrow footer parser fix
  preserves the existing signed-source and current-key requirements and Slack proof code.
- Frontend Git `333c84f` is live on existing aliases. Signed-in verification confirms
  cleaner transcript display, expandable original provider text and 29.64-second
  playback to completion with no media error. Drummonds branding is preserved.
- An interrupted local customer-contact request was reconciled against its succeeded
  durable job/page and queued successor. Capture resumed from 1,355 completed targets
  under the same approval and original cap; no completed provider request was repeated.
- Ongoing voicemail capture, complete historical coverage, voicemail file backup,
  Slack source replay/customer acceptance and full contact coverage remain open.
- Chris has asked us to keep pushing toward the proposed joined customer/job UX.
  Prioritise evidence-linked customer situations and job timelines in the existing
  live design; do not present proposals or unverified AI suggestions as delivered.

Evidence: [voicemail production checkpoint](evidence/learn-voicemail-third-footer-production-2026-10-13.json).

**13 October, 13:56 BST — Slack context schema/runtime released; first site-backed job and genuine Slack review verified.**

- Production Slack worker v4 and platform-worker v63 retain exact-version public
  capture evidence atomically with source pages. Existing auth, schedules, credentials,
  voicemail records and access are preserved. Two scheduled pages have succeeded,
  saving 36 exact-version proofs; 4,112 Slack messages were retained at 13:57 BST.
- The protected-reader release first rolled back with 42501. Its corrected deployment
  passed the actual non-superuser role rehearsal and restored every role membership.
- A third real customer/job pair now includes a verified work address. One genuinely
  single-job Slack action request has an immutable operator review linking it to that
  job; source content, unknown direction and staff attribution are preserved.
- The older message still needs capture-proof replay before it appears through the
  derived customer timeline. Do not present a saved review as completed AI learning.
- Customer contacts continue. Seven more authenticated voicemail sources and current
  provider notification destinations are verified; imports and forward capture are
  prepared separately. Full V1 remains incomplete.

Evidence: [production Slack/customer-context checkpoint](evidence/learn-slack-customer-context-production-2026-10-13.json).


**13 October, 13:30 BST — 248 LIVE voicemail/source pairs; frontend and two customer/job pairs verified.**

- Another 109 authenticated voicemail originals/audio records imported successfully,
  with six identity-preserving replays. All 139 prior records, owners/managers and
  private buckets are preserved. A new-batch recording played to its 29.64-second
  end in the signed-in live browser, with no media error. All 13 historical routes
  are paused. Provider-wide
  history, ongoing capture and independent voicemail file backup remain incomplete.
- Matching voicemail importer v6/platform-worker v62 are published and verified.
  Compatibility derives MIME boundaries from the fully authenticated body; it does
  not accept unsigned payloads or revoked signing keys. Seven current-template
  originals and older signer history remain withheld for review.
- Frontend Git `9b0c581` is live on existing aliases. Signed-in exact-record lookup
  works; customer/job context validation remains compatible with the old SQL response.
- Both representative canonical jobs now have database-verified customer ownership,
  source versions and cards. The apparent Slack match for job 13356 was a multi-job
  stock summary and was rejected. No customer context is claimed from that source.
- Slack source visibility/context SQL and runtime passed full-schema rehearsal;
  production installation and a genuine reviewed source-to-customer journey remain.
  Customer-contact capture continues; site contacts and reconciliation remain open.

Evidence: [voicemail import and preservation](evidence/learn-voicemail-authenticated-body-production-2026-10-13.json),
[canonical customer/job verification](evidence/learn-commusoft-live-customer-job-context-2026-10-13.json).


**13 October, 13:12 BST — 139 LIVE voicemails; real customer/job publication verified.**

- The expanded voicemail run saved 68 authenticated originals/audio records and passed
  nine identity-preserving replays. All 71 earlier records, owners, managers and private
  buckets are preserved; all ten historical routes are paused. New-batch browser playback,
  complete provider discovery, older-source compatibility, ongoing capture and backup remain.
- One real organisation and one real individual have been published through the logged
  customer-review controls, with source versions and preservation verified. The first real
  canonical job has verified customer ownership; a second job batch reports one linked.
  This replaces the earlier zero-publication state, not the whole-account coverage gap.
- A retained Slack conversation explicitly references the second job. Source review and
  context publication are next; saved Slack messages alone are not accepted learning.
- Customer contacts continue under the existing supervised import. Site contacts and
  ongoing reconciliation remain open. Expanded customer-card UX remains discussion-only.

Evidence: [expanded voicemail production receipt](evidence/learn-voicemail-expanded-history-production-2026-10-13.json),
[representative customer/job publication](evidence/learn-commusoft-live-customer-job-context-2026-10-13.json).


**13 October, 12:38 BST — voicemail candidate discovery installed; shared job publication remains open.**

- Candidate-directed voicemail discovery is installed and preservation-verified.
  All five routes remain paused; 71 voicemail/source pairs are intact. Scheduled
  ongoing acceptance awaits route activation after source verification.
- LIVE Commusoft retains 1,552 customer and 871 work-address sources, plus 12,633
  jobs, but has zero canonical jobs/sites/source links. Imports alone do not establish
  the shared customer/job context. Contact traversal continues under its existing bound.
- The retained historical customer export offers classification clues, with some
  conflicts. The settings/customerTypes API previously returned ACCESS_DENIED.
  No bulk classification, merge or canonical publication has been inferred.
- Slack context diagnostics confirm internal messages need a separate work-context
  path; unknown direction must not be invented as inbound/outbound. A tested pure
  review-candidate builder is prepared, not wired or deployed.


**13 October, 12:29 BST — active Slack history priority is live and scheduled acceptance passed.**

- The existing minute scheduler saved a 100-message active-channel page after the
  reviewed priority activation; 141 archived jobs were still queued. Slack totals
  reached 1,226 messages. Existing policies, schedules, source counts and request
  budgets passed preservation checks. Newest-first remains per channel/window.
- Customer-contact traversal continues from its verified checkpoint under the same
  approval. Completed property/job traversals remain 2,423 and 12,633 respectively.
- Broader voicemail metadata discovery found 1,372 exact candidates, including
  1,298 beyond the retained set. These are not imported recordings; Office discovery
  is still capped and older templates/signers require validation.
- Customer/job context, ongoing capture, full coverage and recovery requirements
  remain open. Richer customer-card UX remains discussion-only.

Evidence: [scheduled Slack priority acceptance](evidence/learn-slack-campaign-priority-production-2026-10-13.json).

**13 October, 12:16 BST — Commusoft jobs traversal finished; contact traversal started.**

- Production retains 12,633 Commusoft jobs after 127 pages with exhausted cursor,
  alongside 2,423 properties. The live controller confirms traversal completion.
- Customer contacts are now being read across 1,552 retained customer targets under
  a separate bounded approval. Site contacts, reconciliation and ongoing capture remain.
- The signed-in live overview at 12:11 BST displayed 443 Slack messages and 71 private
  voicemails. Additional provider notification metadata exists beyond the original
  retained voicemail candidates; that broader discovery and its limitations are under
  review. Do not describe 71 as complete provider history.
- Verified input changes and sanitised evidence are backed up to GitHub TEST branch
  at `0bd7a8fc61a60de22aec27191682efaa5a8ea64e`, with remote-head readback.

**13 October, 12:09 BST — faster scheduled Slack intake, 71 private voicemails, and first LIVE Commusoft traversal verified.**

### Working and verified

- The connection-bound internal Slack profile is live: up to 100 messages per page,
  with the existing minute schedule and provider backoff. An automatic page at
  11:08:08 UTC saved 58 records; totals reached 364 messages and 259 interactions.
  RLS, existing access, schedules and campaign request budgets are unchanged.
- Production now contains 71 voicemail/source pairs: Office 601 nine, Liz 102 nine,
  mailbox 103 forty-five, and Tony 105 eight. The latest 60 imports and three duplicate
  checks passed, preserving earlier records, owners, managers and private buckets.
  A newly repaired personal notification played to completion in the signed-in live
  browser (4.68 seconds, readyState 4, no media error).
- Commusoft account 19136 is connected and verified in production. The first property
  traversal exhausted its cursor after 25 pages and retained 2,423 customer/site sources.
  The subsequent jobs import has retained 7,500 jobs across 75 pages and is continuing
  under its existing 300-page approval. No TEST records were copied into production.
- Matching runtimes are published: Slack worker 3, voicemail importer 5 and platform
  worker 61. Full-schema throughput rehearsal and 40 final focused runtime/parser/
  signature tests passed. Existing live frontend and branding remain unchanged.

### Needs finishing

- Complete Slack history/replies and ongoing capture; active-channel priority needs
  correction. Newest-first applies within each channel's fixed window, not globally.
  Customer/job attribution and processing are not complete merely because messages
  have been saved. Private-channel visibility controls remain open; DMs are deferred.
- Complete Commusoft jobs and both contact traversals, reconcile relationships, then
  verify ongoing capture and canonical customer context. Richer card UX expansion
  remains discussion-only at Chris's request.
- All five historical voicemail routes are paused after verification. Full provider
  discovery, ongoing capture and independent backup of the voicemail file buckets
  remain unfinished. Of 78 retained candidates, three omit signed Content-Type and
  four originals returned Gmail 404; all retained evidence is preserved.
- The wider card/scoring, phone-processing, Heidi acceptance, unattended recovery
  and Emma routing requirements below remain open. No full V1 completion is claimed.

Evidence: [Slack throughput](evidence/learn-slack-internal-throughput-production-2026-10-13.json),
[voicemail history](evidence/learn-voicemail-history-2026-10-13.json), and
[Commusoft rollout](LEARN-COMMUSOFT-PRODUCTION-ROLLOUT.md).

**13 October, 11:35 BST — live Slack/voicemail counts verified; scheduled Slack intake advances.**

- Production now retains nine available Office 601 voicemails and their original
  sources. Three legacy notifications without transcripts now parse after signature
  verification; repeat import preserved identities and manager access. Route paused.
  Two previously retained references are unavailable from Gmail. Signed-in playback
  was previously verified for the first message; the additional audio needs UI checks.
- Both approved public Slack campaigns exist in production; 52 messages were saved
  at 11:28 BST. The matching platform-worker and voicemail importer repair is live.
  The Slack-only dispatcher setting is enabled on the existing minute schedule;
  automatic durable page receipts at 10:30 and 10:32 UTC verify unattended progress.
  At 11:35 BST the signed-in live overview shows 97 messages. Commusoft dispatch stays off.
- A fresh production check at 11:28 BST found no Drummonds Commusoft connection,
  source pages, source collections or import jobs. TEST coverage must not be described
  as comprehensive live customer/job coverage. Broader customer-card expansion is
  discussion only at Chris's request.
- Signed-in RLS count reads for Slack and private voicemail are implemented locally;
  frontend Git `22a48ba` is deployed live and signed-in browser acceptance passed. Existing permission
  rules are used; no access grants are added.
- Four additional historical voicemail routes (65 available source messages) passed
  an isolated full-schema rehearsal. Two additional messages imported; the first
  remaining candidate failed notification parsing, so all four routes are paused.
  Live now retains 11 voicemails; 63 planned originals remain. Private
  Slack visibility controls and complete source/processing/recovery acceptance remain open.


**13 October, 10:57 BST — first private production voicemail verified; Slack production scope prepared.**

- One Office mailbox 601 voicemail is now saved live with original/source integrity,
  duplicate replay and signed-in browser audio verified. The bounded route is paused;
  existing Chris/Heidi access is preserved. This is not complete voicemail coverage.
- Nine of eleven retained references were found in Office Gmail. Eight older messages
  stopped at signature-time validation; two references returned 404. Historical
  verification is being repaired without bypassing signature/content checks.
- Slack metadata now verifies 180 public channels (20 active, 160 archived) and 135
  accessible private channels. Production still has no Slack connection/messages.
  [Exact public rollout](LEARN-SLACK-PRODUCTION-ROLLOUT.md) is prepared for its
  reserved production credential/import decision. Private visibility controls are
  unfinished; private channels remain in scope, and DMs remain deferred.
- [Voicemail execution evidence](LEARN-VOICEMAIL-OFFICE-ROLLOUT.md) supersedes earlier
  statements that no production voicemail exists. No full V1 completion is claimed.

**13 October, 10:03 BST — the matched release, processing fixes and input overview are live.**

### Working and verified

- Production has the 24 SQL packages and 37 matching runtimes. The live frontend
  is Git `6f5082a` on the existing openfolk.ai domains. The six-input overview
  shows Email, Phone, recordings, Slack, voicemail and Emma readiness; missing
  verification is explicit. Visible-tab input totals refresh automatically.
- Customer cards now start with latest communication, recorded completed work,
  the next recorded action and its owner. Ordinary observations are not tasks;
  missing evidence does not invent completion or assignment. The signed-in live
  customer brief and mobile input grid were checked.
- At 10:00 BST the live screen showed 20,048 emails, 4,416 calls and 2,950 recordings.
  Capture continues; these are saved totals, not complete historical coverage.
- The graph-read batching and legacy tenant UUID fixes are deployed in three
  matching runtimes. At 10:01 BST the previously retrying scheduled card job
  succeeded: 200 projections, zero failed; its continuation was queued.
- Three new phone pipelines succeeded after the fix. A later pipeline stopped at
  `phone_handoff_call_changed`, so universal phone processing acceptance remains
  open. The two older invalid-UUID failures remain historical evidence.
- Nineteen card/handoff regressions, 73 phone-handler checks and four customer-brief
  checks pass. The final frontend build passes. All three changed runtimes boot
  offline and deny missing authentication. No source history was removed.
- Original release preservation matched 79,802 rows across 28 source/access/storage
  sets, with all 2,944 pre-existing recording references resolving. Independent
  database recovery and recording restoration remain verified earlier milestones.
  All nine original schedules remain restored; the hotfix did not change them.

### Needs finishing

- Complete and verify real production voicemail discovery, private audio import
  and playback. The live inbox still shows mailboxes awaiting sync; it is not
  evidence that the provider has no messages.
- Activate and verify complete production Slack/Commusoft history and ongoing
  capture, including canonical contacts/jobs/cards. TEST imports do not establish
  production coverage; DMs remain excluded.
- Emma's practice page is available, but the main number is not activated. Live
  inbound routing, transfer/fallback, caller-experience issues and handover proof
  remain before a supported switchover. No PBX routing was changed this turn.
- Investigate the newly observed changed-call handoff failure without weakening
  source-identity checks. Complete input coverage, meaningful action extraction,
  card/scoring acceptance and Heidi's own signed-in journey.
- Verify unattended daily database backups; interactive recovery is proven but
  is not an unattended operating schedule.

### Blocked externally

- Three mailbox delegation failures remain; other mailboxes are capturing.
- TEST AI key selection and Heidi's own signed-in acceptance remain outstanding.
  They do not prevent independent finishing work.

[Live release evidence](LEARN-LIVE-RELEASE-2026-10-13.md).
[Independent recovery](evidence/learn-production-release-checkpoint-2026-10-13.json).

### Previous matched release preparation

**13 October — matched production campaign release is prepared; live installation remains pending.**

### Working and verified

- Production package 024 now includes all six Slack campaign migrations, with the
  matching 37 runtimes and staged frontend. The full-schema rehearsal passes ten
  journeys, rollback and six failure guards; 1,591,580 archived rows and seven
  sequences remain unchanged. Seven new private campaign tables are empty.
- All 37 runtime artifacts compile and reject missing authentication. Twenty-eight
  offline scheduler checks pass, and all 45 release adapter/coordinator tests pass.
- The release sequence now pins 24 SQL packages, 37 runtimes and the protected
  production frontend `26d1b22` across 75 steps. This is prepared, not executed.
- The staged frontend is READY and its rendered login targets production. All four
  live domains still serve the existing deployment; no production data, schedules,
  runtimes or capture settings changed during this preparation.
- Hosted TEST campaign verification and Heidi's applied production company-admin
  grant remain valid previous milestones. Neither proves signed-in live acceptance.

### Needs finishing

- Fresh independent recovery, production preflight, coordinated pause/drain,
  matched backend installation, frontend promotion and signed-in acceptance.
- Real Slack historical/reply/ongoing acceptance, complete source coverage,
  processing/cards/scoring and ongoing operational readiness remain open.
- Do not activate a real campaign under the closed two-message TEST sample approval.
  DMs remain excluded and no new campaign or recurring subscription was created.

### Blocked externally

- 1Password is currently locked after inactivity; Chris has been asked to unlock
  it for the already-approved recovery-key access. Do not request new access grants.
- Production customer sign-in remains unverified. TEST AI key selection was opened
  through the secure selector and still awaits the user's selection.
- These do not prevent independent release preparation; deployment approval exists.

[Matched production evidence](evidence/learn-production-slack-campaigns-2026-10-13.json).
[Staged production frontend](evidence/learn-production-frontend-campaign-2026-10-13.json).

### Previous hosted TEST milestone

**13 October — matched Slack campaign schema and runtimes are now verified in hosted TEST.**

### Working and verified

- TEST package 092 installs all six newer Slack migrations. All 213 existing
  datasets were preserved; the seven new campaign tables are empty.
- The matching Slack worker, scheduler and shared platform worker are deployed.
  All 220 datasets match before/after. Seventeen hosted HTTP checks pass, including
  denied unauthorised access and empty worker/scheduler responses.
- Existing compiled worker artifacts are retained for recovery. No new accounts,
  grants, credentials, schedules, provider calls or production changes occurred.
- Both stable TEST aliases now serve frontend `65ef71d`. The existing signed-in
  operator opened campaign state and scope controls; the read is audited and
  incomplete review is rejected. No campaign/request/capture job was created.
- Heidi's previously approved company-admin access remains applied in production.
  This does not establish her signed-in acceptance.

### Needs finishing

- Provider-backed channel selection, approval reissue after exhaustion/expiry,
  private/shared-channel visibility and real reply/ongoing capture acceptance.
  The earlier real two-message TEST sample remains closed; DMs remain excluded.
- Rebuild and rehearse the production candidate with these six migrations and
  matching runtimes. The older staged candidate still excludes this work.
- Production sign-in, fresh recovery/drain/rollout checks, full input coverage,
  processing/cards, scoring and ongoing operation remain open across LEARN V1.

### Blocked externally

- Previously identified recovery-key access, live sign-in and TEST AI selection
  were not refreshed in this rollout. Independent release work remains available.

[Hosted TEST evidence](evidence/learn-slack-campaign-hosted-2026-10-13.json).
[Campaign implementation and remaining work](LEARN-SLACK-CAMPAIGNS.md).
[Local controller evidence](evidence/learn-slack-campaign-controller-2026-10-13.json).

### Previous message-handling milestone

**13 October — Slack message handling verified locally; Heidi production access remains applied.**

### Working and verified

- Heidi's existing production login is Drummonds `admin`, with the exact grant audit
  and unchanged password/Auth record verified. Signed-in customer acceptance is
  still open. [Access evidence](evidence/learn-founder-access-production-2026-10-13.json).
- The local Slack candidate retains common channel activity and file-share messages.
  Channel activity stays in source/version history without becoming conversation or
  performance input. File metadata/text is retained; file bytes are not downloaded.
- Unknown, hidden, malformed or redacted messages stop the import without advancing
  its checkpoint. Safe support codes and recovery copy explain the incomplete window.
- All 141 focused tests, TypeScript and the frontend build pass. The full archived
  production-schema rehearsal covers source retention, duplicate replay, activity
  exclusion, transaction rollback, permissions and channel/thread/operator journeys.
  All 388 baseline datasets / 1,591,603 rows and seven sequences remain unchanged.
- Historical ranges spanning years remain locally verified. This work made no hosted
  changes or provider calls; the existing TEST and staged live frontend are unchanged.

### Needs finishing

- Build the durable whole-history campaign: channel selection, frozen cutoff,
  cumulative request budget, automatic continuation and observed thread traversal.
  Longer ranges still require reviewed continuation after each page allowance.
  Private-channel visibility and any additional real message formats remain open.
- Package both new Slack migrations, the runtime dependency closure and frontend
  together for TEST and production. The existing 23-package/37-runtime release
  excludes this work. Verify hosted controls and actual history/replies within a
  concrete broader approval; the completed real sample remains closed.
- Positive production sign-in, fresh recovery/drain/rollout checks, full input
  coverage, processing/cards, scoring and ongoing operation remain unfinished.

### Blocked externally

- Existing owner-action dependencies remain: recovery-key access (1Password was
  locked at its last check), live sign-in and TEST AI selection. None prevents
  continuing the remaining Slack implementation.

[Message handling evidence](evidence/learn-slack-message-kinds-2026-10-13.json).
[Historical range evidence](evidence/learn-slack-historical-ranges-2026-10-13.json).

### Previous historical-range and access milestone

**13 October — historical Slack ranges verified locally; Heidi access applied in production.**

### Working and verified

- Chris approved founder-access plan `0cebff5a`. Heidi's existing production
  profile is now Drummonds `admin`; exact audit, unchanged Auth/profile fields/portal
  membership and absence of platform authority are verified. No account/password,
  capture, schedule or provider change occurred. Signed-in acceptance is still open.
  [Production access evidence](evidence/learn-founder-access-production-2026-10-13.json).
- The local client, worker and SQL candidate support fixed historical periods
  spanning years, including replies made long after the original message.
  Saved cursors, exact bounds, ten-page approval limits and 24-hour approval
  expiry remain enforced. No automatic claim of complete history is introduced.
- All 134 client/worker tests, TypeScript and the frontend build pass. Offline
  production-schema tests cover old roots/later replies, channel and thread
  recovery, duplicate settlement, expiry, permissions and tenant isolation.
  All 388 baseline datasets / 1,591,603 rows and seven sequences are unchanged.
- Provider-request accounting now includes repeated access checks. The old real
  sample's conservative bound is corrected from 23 to 80, below its approved 201
  cap; this is a code-derived allowance, not a measured count. Local transport
  stops before a tenth provider dispatch per lease. The real sample remains closed.
- The previously accepted TEST operator frontend remains staged for production
  at `dpl_5j57s4SuMBQMkzKEpM2BgX4BE9m6`, source `d535085`; live domains unchanged
  at the last verified staging check. This turn made no hosted changes.

### Needs finishing

- Build the durable whole-history campaign: channel inventory selection, frozen
  cutoff, cumulative request budget, automatic cursor continuation and observed
  thread traversal. Current longer ranges still require reviewed continuation
  after each page allowance. Private-channel visibility and unsupported message
  subtype handling remain required; do not classify these as access blockers.
- Package the new SQL, worker dependency closure and frontend together for TEST
  and production. The existing 23-package/37-runtime release excludes this work.
  Then verify signed-in hosted controls and real historical/reply capture within
  a concrete broader approval; do not reuse the completed sample's unused budget.
- Positive production sign-in, current recovery/drain/rollout gates, complete input
  coverage, processing/cards, scoring and ongoing operation remain unfinished.

### Blocked externally

- Existing owner-action dependencies remain: recovery-key access (1Password was
  locked at its last check), live sign-in and TEST AI selection.
  None prevents continuing the Slack implementation above.

[Historical-range evidence](evidence/learn-slack-historical-ranges-2026-10-13.json).
[Previously staged frontend](evidence/learn-production-frontend-operator-learn-2026-10-13.json).

### Previous TEST operator journey milestone

**13 October, 03:44 BST — selected-client LEARN operator entry verified in TEST.**

### Working and verified

- OpenFolk operators can now open LEARN from the selected client's workspace and
  use the existing audited reader, instead of reaching the company-profile sign-in
  dead end. Existing client accounts retain their normal LEARN journey.
- Signed-in TEST acceptance loaded 19 customer cards and the reviewed customer's
  46 jobs over two pages, plus its site/contact. Seven audits match the real actor
  and selected client. Returning from capture controls cleared private record state.
- Fourteen focused tests, TypeScript and the full build pass. A visual layout defect
  found during acceptance was corrected and rechecked in the final hosted build.
- Protected `test.openfolk.ai` now serves Git `d535085`. No server permissions,
  accounts, provider capture settings or production deployment were changed.

### Needs finishing

- Carry the accepted frontend into the matching production release. Its current
  staged frontend still uses the earlier source revision; do not promote it as this fix.
- Investigate stale open documents: a fresh browser document loaded the new build,
  while the prior tab kept old assets after reload. Automatic recovery is unverified.
- Customer-signed-in acceptance, broader operator scoring reads, complete inputs,
  processing, ongoing capture and the existing live recovery/release gates remain.

### Blocked externally

- Existing founder access, live sign-in, TEST AI access and recovery-key unlock
  remain pending. Browser access recovered; no new user action is needed for this fix.

[TEST operator LEARN evidence](evidence/learn-operator-learn-entry-2026-10-13.json).

### Previous production packaging milestone

**13 October, 03:27 BST — search fix included in the matching production candidate.**

### Working and verified

- Production package 023 now includes the function-local search-planning fix already
  accepted in TEST. The candidate contains 23 SQL packages and 37 server endpoints;
  its deployment sequence, scheduler transactions and adapters use matching hashes.
- A network-isolated production-archive rehearsal applied all prerequisites and
  verified package 023 preserves 387 tables, 1,591,580 rows and seven sequence states.
  Function body, owner and permissions are unchanged. Wrong target, missing prior
  package, reader drift, late failure, rollback and duplicate application were checked.
- The prior RPC catalog matched when compared using the same PostgreSQL deparsing
  context. All 19 reviewed dispatch sites and 51 RPC targets remain available.
- Existing runtime bytes were verified unchanged, then booted again: 37 missing-auth
  denials and 28 scheduler caller checks passed. All 45 local release tests pass.
  No production or TEST state changed during this preparation.

### Needs finishing

- Execute the remaining live release gates: fresh independent recovery, current
  hosted-state and drain checks, signed-in production journeys and monitored rollout.
  This rehearsal uses the retained 12 October archive; it is not a fresh live backup.
- Finish full input coverage, ongoing capture, broader customer/contact publication,
  phone transcription/AI and evidence-backed cards/scoring. Two historical Slack
  messages are verified in TEST; full history and real replies remain unfinished.

### Blocked externally

- The existing founder-access decision, live sign-in, TEST AI access and 1Password
  recovery unlock remain pending. The bounded Slack historical approval has already
  been exercised and does not need repeating.

[Production planning evidence](evidence/learn-production-review-planning-2026-10-13.json).

### Previous TEST search milestone

**13 October, 03:14 BST — intermittent retained-job search failure diagnosed and fixed in TEST.**

### Working and verified

- TEST database logs show three cancelled work-review queries during the prior
  job-linking session. A forced generic plan reproduced a statement timeout after
  20 seconds on the retained inventory; its nested loop repeatedly scanned the
  latest-version set. This was a database failure, not merely a browser wait.
- Migration `20261101640000` gives only the work-search function a custom plan for
  each request. Its body, authority, grants, owner and returned data are unchanged.
  Full-schema rehearsal compared four search cases and repeated them twice under
  a generic-plan caller. Results matched, with candidate database timings 539–1008 ms.
- TEST installation preserved all 238 data tables and all other functions. The
  migration receipt was appended. No credentials, grants or provider access changed.
- Twelve actual signed-in browser searches then completed without failure, taking
  1138–3185 ms end to end. Exact references, property references and empty results
  were covered. The input switch was restored Off after acceptance.
- The isolated SQL suite passes, including 10,000 synthetic jobs, repeated selective
  and broad queries, pagination, caller-setting isolation, source preservation and
  existing permission/replay/concurrency checks. These timings are not an SLA.

### Needs finishing

- Add this migration to the matching production package and refresh/rehearse its
  release bindings. The existing 22-package production candidate does not include it.
- Continue broader customer/contact publication and the remaining real input,
  processing, scoring, signed-in customer and live-release journeys.

### Blocked externally

- Existing founder-access decision, live sign-in, TEST AI access and 1Password
  recovery unlock remain pending. No new user action is needed for this TEST fix.

[Search-planning evidence](evidence/learn-review-planning-2026-10-13.json).

### Previous retained-job milestone

**13 October, 03:02 BST — retained customer job history linked and inspected in TEST.**

### Working and verified

- The already-reviewed customer card now has 46 linked Commusoft jobs, up from one.
  The 45 additions reference its existing reviewed customer or site; no new customer
  identity was inferred. All were applied through the signed-in operator review UI.
- Both card pages were inspected: 25 plus 21 records, with 46 distinct job numbers.
  Source statuses and missing/unconfirmed timing evidence remain visible. Unzoned
  completion times remain excluded from duration and performance calculations.
- A five-minute review expiry interrupted one acknowledgement. Reopening the review
  and checking its saved receipt recovered the successful result without another write.
- The rollback rehearsal preserved all 238 checked tables. After the retained run,
  232 tables matched in full; the other six contained only expected new jobs, links,
  review receipts and audit records. All their prior rows also matched. Credentials,
  source versions, recordings, communications and access grants were unchanged.
- Commusoft was enabled temporarily for retained review and restored Off through
  audited controls. The prior import approval was expired, with no active Commusoft
  jobs, enabled recurring capture or TEST cron table. No provider requests, paid AI,
  production changes or promotion occurred.

### Needs finishing

- This proves one customer's retained job journey through the operator view, not
  complete publication of the 12,611 retained jobs or a customer-signed-in journey.
  Remaining customer/site/contact relationships still need review.
- Several review reads were slow or failed and needed reload; diagnose query/runtime
  performance before scaling this workflow. Saved writes and receipt recovery worked.
- The operator's client-view route still asks for a company login to read cards.
  Do not represent the verified operator card as accepted customer access.
- Full input coverage, ongoing capture, phone transcription/AI, useful summaries and
  scoring, matched production release, live acceptance and monitoring remain open.

### Blocked externally

- The founder access decision, live sign-in, TEST AI access and earlier 1Password
  unlock request remain pending. Fresh independent off-site recovery is unfinished.

[Retained job acceptance evidence](evidence/learn-retained-job-links-2026-10-13.json).

### Previous founder access and frontend milestone

**13 October, 02:38 BST — founder access rehearsed and matching frontend staged; not promoted.**

### Working and verified

- The designated customer account was checked against Auth and its existing portal
  membership. Its current permissions explain the LEARN access gap. A guarded company-admin assignment and audited reversal are prepared.
- The exact change passed seven checks in a network-isolated full-schema restore.
  The other 297 archived tables and five sequences matched; expected profile fields
  and two audit records were checked separately. The disposable container was removed.
- No hosted account, source record, capture setting or live deployment changed.
- The latest TEST-verified frontend (`cbb310c`) is now staged for production as
  `dpl_FHkfcrYZQ6bVmupHvvjse5pKUrFu`, with automatic domain assignment disabled.
  Its actual rendered login targets production, protection is intact, and the
  read-only promotion adapter reports ready. All four live aliases remain on
  `dpl_DXueDsax146gdtyFoniXRaW3dzMM`. The release plan now pins this newer candidate.

### Needs finishing

- Apply the founder access plan only after its specific permission decision, then
  verify the durable result and the customer’s signed-in journey with the matched release.
  Company-admin access includes customer actions; it is not a read-only demo role.
- Full input coverage, processing, cards/scoring, matched backend/frontend release,
  initial live monitoring and operational handover remain unfinished.

### Blocked externally

- Founder production access needs the decision on the [prepared proposal](LEARN-FOUNDER-ACCESS.md).
  The existing 1Password window still shows locked; fresh off-site recovery remains
  pending the earlier unlock request. Live sign-in and TEST AI access remain unresolved.

[Access preparation evidence](evidence/learn-founder-access-2026-10-13.json).
[Current staged frontend](evidence/learn-production-frontend-staged-workspace-2026-10-13.json).

### Previous workspace milestone

**13 October, 02:28 BST — missing TEST workspace prepared through signed-in operator controls.**

### Working and verified

- An authorised operator can create a missing client programme through the existing
  UI and RLS. Insert-only creation preserves concurrent setup; the existing revision,
  notification and View-As restrictions apply. The minimal record makes no delivery,
  price or health claims.
- Signed-in TEST creation produced version 1 and one revision attributed to Chris.
  All 130 profiles, 12 authority grants and portal memberships matched before/after
  fingerprints. The client home now opens instead of “workspace being prepared”.
- Local build and all 47 prebuild tests pass. Seven synthetic database checks pass;
  this is a minimal database rehearsal, not full production-schema acceptance.
- Protected TEST aliases now target `dpl_AQF1S2zKebB6yoncdGa5K1zb8xRv`, application
  `cbb310c`. Live stays on `dpl_DXueDsax146gdtyFoniXRaW3dzMM`. The first hosted build
  failed a formatting-sensitive test; the corrected build passed before alias changes.
- Production already has Drummonds’ programme and two portal members. Its programme
  was not changed. Read-only metadata confirms Chris has a matching operational
  tenant and owner role; Heidi has portal membership but viewer role and no tenant.

### Needs finishing

- Heidi’s existing live login cannot satisfy LEARN’s operational tenant and owner/admin
  checks. Prepare the exact customer-access scope and obtain the necessary decision
  before any access expansion; do not silently promote her role. Chris’s signed-in
  live verification is also outstanding.
- TEST home opens but its care-status refresh remains unavailable and no receptionist
  workspace is configured. This is not a fully accepted client home or LEARN journey.
- One TEST programme notification is queued. No dispatcher is deployed and no
  destination workspace is configured, so nothing was sent. Review this retained
  item before enabling notifications; do not accidentally deliver a setup test later.
- A fresh page query was needed to load the new TEST build after ordinary reloads
  still showed its predecessor. Stable-URL stale-build recovery remains unproven.
- The pinned staged production frontend predates this setup UI. Matching backend,
  controlled drain, source-to-card processing, complete inputs and live release remain open.

### Blocked externally

- The pending 1Password unlock still gates the fresh independent recovery proof.
  Production sign-in and TEST AI access remain unresolved; the four unavailable
  mailbox accounts have not been confirmed retired.

[Workspace and access evidence](evidence/learn-workspace-setup-2026-10-13.json).

### Previous runtime diagnostics milestone

**13 October, 02:14 BST — current capture and background-execution diagnostics verified.**

### Working and verified

- A new bounded read-only observer uses Supabase's current logs endpoint, returning
  only function names, response counts/timing and lifecycle totals. Four local tests
  pass, and the real production query resolves every observed function.
- The fixed 00:53–01:08 UTC window returned 48 HTTP events initially and 57 later.
  Late log arrival is observed, so an empty window must not automatically pass the
  release drain gate. Boot/Shutdown totals also cannot be subtracted into an active count.
- Production run records at 01:10 UTC show 55 successful mailbox checks and six
  successful cycles each for phone scheduling, calls and recordings in the preceding
  half-hour. No new email, call or recording rows were stored in that window. These
  are ongoing checks, not evidence of complete capture or new source-to-card delivery.
- Three failed email checks are delegation failures on three of the four previously
  investigated accounts. No credentials, mailbox settings or source history changed.

### Needs finishing

- Combine scheduler pause/readback, current leases, downstream execution and caller
  coordination before installing the matching backend. Delayed logs cannot supply
  this acceptance alone. The actual controlled drain has not been performed.
- Full input coverage, processing/cards/scoring, signed-in live release and operational
  handover remain open. The staged frontend from the previous milestone stays ready.

### Blocked externally

- The pending 1Password unlock still gates the fresh independent recovery proof.
  Production sign-in and TEST AI access remain unresolved. The four unavailable
  mailbox accounts have not been confirmed retired; their history remains intact.

[Current runtime and capture evidence](evidence/learn-production-runtime-activity-2026-10-13.json).

### Previous frontend release milestone

**13 October, 02:07 BST — exact frontend promotion path prepared and checked.**

### Working and verified

- A protected staged **production** build is READY: `dpl_8YWHfdbY2SFVkKWsBcEz5LcnMVFn`,
  Git `bebb19c`. Automatic domain assignment was disabled. The rendered login points
  to production; all four existing production domains still serve the previous release.
- The 73-step plan now pins this staged build. Vercel preview promotion would rebuild
  the app, so the previous preview is retained as historical evidence, not the promotion target.
- The concrete frontend adapter checks source revision, production target, protection,
  complete domain inventory and every alias. The existing journal reconciles an uncertain
  promotion without resending it. All 45 release tests pass (seven frontend cases).
- Hosted adapter verification was read-only and returned ready. No live promotion,
  backend changes, provider capture or customer-data mutations occurred in this milestone.

### Needs finishing

- Connect fresh recovery, controlled drain and positive caller/acceptance checks to
  the coordinator, then perform the matched release and signed-in live acceptance.
  The frontend adapter is implemented; its actual promotion path remains unexecuted.
- Full history/ongoing capture, source-revision relevance, customer-workspace setup,
  source-to-card quality, scoring, AI/voicemail and operational ownership remain open.

### Blocked externally

- The existing pending 1Password unlock is needed for the fresh independent encrypted
  database copy/restore. Production sign-in and TEST AI credential access remain unresolved.

Evidence: [staged production build](evidence/learn-production-frontend-staged-2026-10-13.json),
[promotion adapter](evidence/learn-production-frontend-adapter-2026-10-13.json).

### Previous matching-candidate milestone

**13 October, 01:56 BST — matching production candidate includes the verified relevance repair.**

### Working and verified

- The revised read-only reader also succeeded on production metadata: 23,509
  distinct recorded communication decisions, with 14,290 recorded relevant,
  9,203 potential noise and 16 uncertain. These are historical decisions, not
  full source coverage or fresh AI classification; no rows or queues changed.
- All 37 fresh runtime artifacts compiled and booted in isolated containers;
  missing-auth rejection and 28 scheduler caller checks passed. Containers were
  removed. The exact upload files and 73-step release plan are prepared.
- The 22 database package/manifest pins are unchanged; the existing full-schema
  rehearsal is carried forward explicitly. The 19 unchanged dynamic dispatch
  sites still resolve to 51 executable RPC targets. All 38 release tests pass.
- Fresh production metadata at 00:54 UTC matches the reviewed public schema and
  all 88 function definitions. Configuration preflight is ready without writes.
- Protected preview `dpl_HPUABE8gMShxGYnopkVbgTkPAQHP`, Git `bebb19c`, is ready;
  its rendered sign-in form points at production. It is not promoted or signed-in
  accepted. The permanent live address is open for the owner's eventual sign-in.

### Needs finishing

- Connect concrete current recovery, drain, caller and frontend acceptance checks
  to the release coordinator, perform controlled rollout and verify live journeys.
  This prepared release is not a live LEARN V1 launch.
- Full history/ongoing capture, source-revision relevance, customer-workspace setup,
  source-to-card quality, scoring, AI/voicemail and operational ownership remain open.

### Blocked externally

- 1Password is still visibly locked; the fresh encrypted database copy and independent
  restore await the existing recovery material. No repeated unlock request was sent.
- Production sign-in remains unverified at the permanent live address and preview;
  TEST AI credential access is unresolved. No password reset or new account was made.

Evidence: [matched production candidate](evidence/learn-production-relevance-2026-10-13.json),
[protected frontend](evidence/learn-production-frontend-relevance-2026-10-13.json).

### Previous TEST relevance milestone

**13 October, 01:50 BST — communication relevance repaired and signed-in verified in TEST.**

### Working and verified

- TEST control-plane v12 counts distinct communications across processing versions.
  Conflicting historical classifications remain uncertain. Ordered pagination rejects
  failed, truncated or inconsistent reads rather than reporting incomplete totals.
- All 213 retained datasets were preserved during deployment. The read-only sample
  has 21 distinct communications: 17 recorded relevant, four potential noise,
  including the two operator-reviewed Slack messages. No source data changed.
- Nine targeted tests, full TypeScript and the production build passed. The frontend
  clears previous-tenant results and provides an explicit unavailable/retry state.
- Stable TEST aliases serve Git `5a892a4`, deployment
  `dpl_CKpLsG9SLELwoSCevJeZbyn3QLcn`. Signed-in inspection verified the distinct
  counts, reviewed Slack category and scope caveat on the clean permanent URL.
  Both aliases retain protection; unauthenticated API access returns 401.
  Live deployment remains unchanged. No provider calls or capture activation.

### Needs finishing

- Historical eligibility is still not source-revision-aware reclassification;
  noisy observations need review. This report does not alter operational queues.
- This source change postdates the pinned production runtime candidate. Regenerate
  matching runtime/frontend artifacts before release; do not promote stale pins.
- All remaining input, client-workspace, scoring and live release gates remain open.

### Blocked externally

- 1Password remains locked; fresh independent database recovery is pending.
  Signed-in production acceptance and TEST AI credentials remain unresolved.

Evidence: [communication relevance](evidence/learn-communication-relevance-2026-10-13.json).

### Previous release integration milestone

**13 October, 01:40 BST — release sequencing and restart integration verified locally.**

### Working and verified

- Prepared production package 022 for atomic observation delivery, audited source
  reads and retained-input totals. The full 22-package install passed against the
  network-isolated production archive, with original rows/sequences preserved.
- Wrong target, missing prerequisite, duplicate installation, running work and late
  failure are rejected. Synthetic observation, audit, tenant isolation, stale-source,
  reader and totals journeys passed and rolled back. Their new work-capture sequence
  advances are recorded; no hosted rows, accounts, grants or providers were touched.
- All 37 matching runtime artifacts compiled and booted; missing-auth rejection and
  28 scheduler caller cases passed in isolated containers. The exact upload files
  are prepared, not uploaded. Fresh metadata shows production definitions unchanged.

- All 38 release-adapter, candidate, coordinator and journal tests pass. The new
  coordinator retains verified configuration readbacks before accepting a step;
  a restart then uses the correct runtime versions. Actual configuration/runtime
  adapters composed across 37 uploads, publication and activation against a
  simulated API. Lost responses, persistence failure and readback drift fail safely.
- The 19 unchanged dynamic dispatch sites resolve to 51 available, executable RPC
  targets in the rehearsed schema. Production configuration preflight is ready;
  no secrets were provisioned.

- Fresh read-only inspection at 00:22 UTC confirms the reviewed production public
  schema and all 88 hosted function definitions remain unchanged. The new 00:16 UTC
  private snapshot exported (201,420,792 bytes) and restored offline: 1,617,988 native
  rows, 2,652 operational rows and all 16 Vault secrets verified. All physical tables,
  catalog/RLS and 2,944 recording relationships passed; containers were removed.
- The fresh snapshot matches the existing verified audio inventory exactly: 2,950
  object IDs, versions, ETags, sizes, paths and 2,944 recording references. This
  reuses the 12 October 17:54 UTC audio verification; no new S3 byte check is claimed.

### Needs finishing

- Complete signed-in production acceptance. The matching protected frontend now
  loads with verified production authentication; the 73-step plan pins its artifact,
  22 SQL packages and 37 runtimes. It has not been executed. Concrete recovery,
  drain, caller-acceptance and frontend ports still need connecting to the
  coordinator; passing its local routing tests does not close those gates.
- The 14 historical unleased jobs have now been settled as interrupted in production,
  with 14 audited original-row snapshots and exact non-status field preservation.
  Fresh observation found no running platform jobs; all nine existing schedules
  remain active. This removes the stale-job blocker but does not prove live drain.
- Perform the controlled pause/drain and fresh recovery checkpoint. The separate
  22 email / 12 phone unfinished run records remain unchanged; window correlations
  do not justify inventing their completion. One recent request timeout remains
  under investigation; no full capture-health claim is made.
- Offline rehearsal temporarily simulated a drained queue and restored every
  archived job row. This does not close the live drain/recovery gate.
- All broader input, relevance, client-workspace, AI, scoring and launch requirements
  remain open; the full goal is unchanged.

### Blocked externally

- The fresh encrypted database copy and independent restore need the existing
  recovery keys in 1Password, observed locked after inactivity. Chris has been asked
  to unlock it; no keys were exposed or authentication protection bypassed.
- Signed-in production acceptance and TEST AI credential access remain unresolved.

Evidence: [release coordinator checks](evidence/learn-production-release-coordinator-2026-10-13.json), [fresh local recovery checkpoint](evidence/learn-production-release-checkpoint-2026-10-13.json), [production Learning candidate](evidence/learn-production-learning-2026-10-13.json), [audited production job recovery](evidence/learn-production-legacy-job-recovery-2026-10-13.json).

### Previous hosted TEST milestone

**13 October, 00:52 BST — TEST Learning workspace repaired, deployed and signed-in verified.**

### Working and verified

- The route failure was missing TEST schema, not Chris's operator grant. Packages
  089/090 restore nine missing read-model tables, two roster columns and a service-only
  aggregate reader. Existing raw-input restrictions and operator authentication remain.
- Both exact packages passed hosted rollback rehearsals and installed successfully.
  All original datasets/fields were preserved (204 before foundation; 213 afterwards),
  with no sequence consumption, new logins/grants, provider requests or production changes.
- TEST control-plane v11 now loads the signed-in Learning overview and Source Truth.
  Visible retained totals: 20 emails, 19 email interactions, one call/recording,
  two Slack messages, 17,997 Commusoft input versions and one published job;
  21 interactions and 17 observations overall. These are the bounded TEST sample.
- Failed or truncated core metric/queue reads now fail visibly instead of becoming zeros. Saved dates
  never establish an active schedule; no synthetic themes or fallback profile counts.
  Commusoft job totals include connection-scoped API records. Different processing
  stages retain separate units. 23 unit tests, targeted/full TypeScript and build passed.
- Stable `test.openfolk.ai` now serves Git `94f5e87`, deployment
  `dpl_Dnbb7GFjiFP9KosozXrz75fxdsVB`. The clean URL shows the corrected capture
  labels and per-source totals; the 17-record observation queue opens with evidence.
  Both TEST aliases retain protection. Live deployment remains unchanged.

### Needs finishing

- New foundation tables enable reads only; legacy configuration writes are not accepted.
  The separate legacy relevance panel still needs fail-closed pagination and
  revision-aware counting; core metric repair does not fix that reader.
  Client-programme setup, relevant analysis, wider history/ongoing capture, AI,
  full business publication, scoring and matching live release remain open.
- This overview does not prove capture health; authoritative connector controls remain
  in Modules. Source freshness and retained totals must not imply complete coverage.

### Blocked externally

- Live sign-in and TEST AI credential remain unresolved; no new user action was needed
  for this TEST schema/read repair.

Evidence: [Learning workspace repair](evidence/learn-learning-workspace-2026-10-13.json).

### Previous audited information milestone

**13 October, 00:28 BST — signed-in TEST observation → source journey verified.**

### Working and verified

- TEST package 088 adds a learning-observation collection to the existing audited
  client-information reader. Only committed, receipt-backed LEARN results appear;
  each response checks current operator authority and records the actual actor.
- Synthetic hosted rollback checks passed: client/view-only/revoked/anonymous
  access, tenant isolation, pagination, source drill-down, missing receipts, broken
  lineage, stale source versions, audit failure and metadata exclusion.
- All 204 datasets were preserved through installation; no provider requests,
  credentials, new retained accounts/grants, capture activation or production changes.
  The synthetic rehearsal consumed three work-capture sequence values; install
  consumed none. Fixture records and temporary authority were rolled back.
- Frontend at stable `test.openfolk.ai` (Git `9857dd1`, deployment
  `dpl_H32JNxBfaEPBbmm7xLzztaQpsW4h`) shows 17 real retained observations. Signed-in
  operator inspection opened both a Slack source and an email source, with matching
  source-version status. Three corresponding audit reads retain the actual operator;
  switching collections clears the content. Full TypeScript, build and five reader
  tests pass. Both TEST aliases retain protection; the live deployment is unchanged.
- The TEST client-view preparation screen is explained: there are zero
  `client_programmes` rows, including none for the selected Drummonds TEST tenant.
  This is a programme setup gap, not evidence that retained learning records are absent.

### Needs finishing

- The legacy Learning page still rejects the current operator; client-programme
  setup remains open. This milestone verifies Client information, not those routes.
- **Relevance quality needs improvement:** the saved sample visibly includes
  newsletters and unrelated email. The current keyword eligibility is not enough
  to present every observation as actionable company insight. Keep source records,
  add transparent filtering/review and do not confuse ingestion with useful analysis.
- Match the new schema and runtime into production preparation. Source revision
  reprocessing, wider history/capture, AI, cards/scoring and full launch gates remain
  as listed below; source freshness disclosure does not complete reconciliation.

### Blocked externally

- Live credential access and TEST AI key are still unresolved. Neither blocks this
  authorised TEST reader and frontend work.

Evidence: [audited learning reader](evidence/learn-learning-information-2026-10-13.json).

### Previous retained-observation checkpoint

**13 October, 00:10 BST — retained real inputs now reach durable TEST observations.**

### Working and verified

- Hosted worker v23 processed the existing 21-interaction sample: 15 emails and both
  reviewed Slack messages now have saved observations, decision packages and durable
  receipts. Four messages have audited skip reasons (two marketing, two automated).
- All 17 decisions are observe-only. Repeating ingestion reused all 17 existing
  observations; there are no remaining analysis jobs from this run. Both Slack
  messages retain unknown direction and their reviewed company context.
- Atomic delivery also created 17 interaction graph nodes and verified related
  person/company/job references. No graph edges cross tenant boundaries. This is
  targeted projection for the sample, not a full company-graph history sweep.
- TEST packages 086 and 087 and the matching worker are installed. The first real
  attempt exposed missing legacy decision/event columns in TEST; no partial
  observations persisted. After a hosted synthetic rollback rehearsal and the
  prerequisite install, the same 17 jobs completed on their second attempt.
- Full-schema rollback, stale-source, wrong-claim, cross-tenant and duplicate tests
  passed. 69 local unit/in-process checks and the targeted TypeScript check passed.
  Source fields and other tenants are preserved across the 204-dataset comparison;
  capture stayed paused, with zero provider requests, paid AI calls or new logins.

### Needs finishing

- **Browser acceptance remains open.** The signed-in operator's legacy Learning
  screen rejects access; Client view shows "workspace being prepared". The audited
  Client information screen works, but has no observation collection yet. Fix the
  authorised read/display journey without changing Chris's profile or impersonating
  client staff. Saved backend records do not establish a usable customer showcase.
- Add revision-aware reconciliation for changed sources and reviewed context; the
  current mapper gives one observation per interaction/version. Retained historical
  observations must not silently masquerade as analysis of later edits.
- The new path is deterministic, observe-only processing. Paid AI extraction,
  synthesis, full history/ongoing capture, phone/voicemail acceptance, business
  publication, scoring, operational recovery and the remaining launch gates stay open.
- Prepare the matching production package/runtime and verify the release. The prior
  21-package candidate below remains historical evidence, not acceptance of v23.

### Blocked externally

- Existing live credential access and the outstanding TEST AI key remain unresolved.
  The UI and release work above can proceed independently.

Evidence: [retained input → observation acceptance](evidence/learn-retained-observations-2026-10-13.json).

### Previous learning diagnostic

**12 October, 22:45 UTC — retained input to learning diagnostic and local hand-off fix.**

### Working and verified

- Fresh read-only TEST inspection confirms 19 enriched email interactions and two
  reviewed Slack interactions. Their source records remain retained. No provider
  requests, database writes, AI calls or production changes occurred in this check.
- Local ingestion fixes now reject failed database reads, missing queue/ledger
  acknowledgements and oversized batches. Existing skipped decisions survive retries;
  a lost job-link acknowledgement recovers the existing queued job on serial retry.
- 16 handler fault tests, 26 mapper checks, 11 in-process decision checks and 11
  eligibility checks pass. These are local checks, not hosted analysis acceptance.

### Needs finishing

- TEST is missing `intelligence_ingestions`. The 21 inspected interactions have zero
  interaction graph nodes and zero linked intelligence objects. Enriched/card-ready
  does not mean analysed. Install the missing dependency and prove durable delivery.
- Current keyword eligibility accepts 15 of the 19 emails. It rejects both reviewed
  Slack messages (one as outbound/no signal despite unknown direction, one as marketing).
  Carry explicit reviewed company/job context into learning without guessing identities
  or direction. An operator context review is not itself a completed analysis.
- Replace the unacknowledged graph background request with a durable hand-off, and
  verify history coverage. The observation consumer also needs atomic/retry-safe
  persistence before a real end-to-end run: it currently inserts a new observation
  on invocation and ignores some later persistence errors. Queue deduplication alone
  is not proof of exactly-once observation delivery.
- This change is **not deployed**. Prior 21-package/37-artifact release evidence below
  applies to its pinned revision. Runtime source has changed; regenerate and verify
  matching artifacts before promoting the new code. All wider launch gates remain open.

### Blocked externally

- Live sign-in still needs the existing credential or owner unlock. The learning
  defects above are implementation work, not waiting on Chris or a provider.

Evidence: [aggregate diagnostic and local checks](evidence/learn-learning-handoff-2026-10-12.json).

### Previous matched release checkpoint

**12 October — matched production candidate now includes Slack work context.**

### Working and verified

- All 21 database packages installed in order in the isolated retained production
  restore. The Slack journey, duplicate rejection and rollback checks pass.
  All 299 original archive tables, 1,591,576 rows and five sequences are preserved.
- The matched release plan has 72 steps and 37 exact runtime artifacts. Runtime
  bytes are unchanged; earlier startup and 28 scheduler checks are carried forward
  explicitly. All 31 release adapter/journal/candidate tests pass.
- Fresh production metadata reads match 88 server functions, zero new release
  receipts and the original target schedule states among 18 schedules. Public
  schema matches the archived baseline after rechecking the four specifically
  documented constraint-deparsing differences against original archive hashes.
- Protected production preview `dpl_HAuQP1P52UzyXXSyGo5pWWEKVioa` is ready at Git
  `d42987e`; its rendered auth target is verified as production. Live remains unchanged.
  Stable TEST retains the previously verified real email/card and Slack reviews.

### Needs finishing

- Positive hosted caller acceptance, current independent recovery checkpoint,
  coordinated pause/drain, matched installation, signed-in live journeys and
  initial capture observation. A matching manifest is not a launched service.
- Full history, ongoing capture, phone processing, customer/job attribution,
  graph/AI learning, scoring and remaining goal acceptance stay in scope.

### Blocked externally

- 1Password was checked directly and is locked after inactivity. Owner unlock is
  needed for the existing live-login credential lookup. No repeated CLI prompt
  was started; independent release work continues.

[Matched release evidence](evidence/learn-production-slack-context-2026-10-12.json) ·
[Production preview evidence](evidence/learn-production-frontend-slack-context-2026-10-12.json).

## Previous current checkpoint

**12 October — real Slack company context verified through hosted TEST operator controls.**

### Working and verified

- TEST package 085 installed with all 198 retained datasets unchanged. It adds
  audited operator review of retained Slack conversations as company context or
  a verified job link, without inventing customer identity or direction.
- The isolated full-schema journey covers source edits, stale review rejection,
  idempotent replay, cancellation, tenant isolation and revoked operator access.
  All 386 prerequisite tables and seven sequences were preserved. Exact production
  package 021 rollback also passed; production itself is unchanged.
- The existing signed-in TEST operator saved and freshly read back both retained
  public Slack messages as company context. Original directions are unchanged;
  no customer/person/job identity was guessed. All 196 other datasets match their
  prior fingerprints; only review history, audit and derived interactions changed.
- Git `f06cfb8` is deployed on protected `test.openfolk.ai` with production aliases
  unchanged. The published-job picker reads successfully. Six client tests, type
  checking and build pass. Nineteen real email-to-card deliveries remain verified.

### Needs finishing

- Connect reviewed Slack context into the graph/AI journey, verify real job and
  person attribution where supported, and complete history/ongoing capture.
  The previous failed identity run remains historical evidence, not a success.
  These reviews do not prove AI analysis or complete channel coverage.
- Integrate package 021 into the complete matched production candidate. Complete
  full history, ongoing capture, phone processing, graph/AI and scoring acceptance,
  then verify and promote the matched release.

### Blocked externally

- Production-login credential lookup still awaits owner Touch ID; independent
  delivery continues.

[Slack context evidence](evidence/learn-slack-work-context-2026-10-12.json).

## Previous current checkpoint

**12 October — real retained emails delivered to cards in hosted TEST.**

### Working and verified

- Nineteen eligible real emails passed through the installed queue worker into
  nineteen acknowledged card deliveries. Source/person/card links and receipts
  match. The twentieth email is an unsent draft: preserved and excluded from
  customer activity.
- The existing signed-in OpenFolk operator loaded nineteen customer cards on
  stable TEST and opened the detail fields without alerts.
- All original source, credential, account and queue records, other tenants and
  unscoped datasets were preserved. Email capture is paused again. No provider,
  AI, new access or production change was involved.

### Needs finishing

- Two Slack interactions remain explicitly held for unverified direction. Their
  identity job reports review required, not complete success. Internal channel
  conversations need appropriate company/job context; they must not be forced
  into customer-email attribution.
- Customer-facing card UX, full history, ongoing capture, phone AI processing,
  scoring, business-graph delivery and matched production release remain open.

### Blocked externally

- Production-login credential lookup still awaits owner Touch ID; independent
  work continues.

[Actual worker, preservation and browser evidence](evidence/learn-real-email-cards-2026-10-12.json).

## Previous current checkpoint

**12 October — recurring Commusoft backend installed in TEST; complete production package rehearsed.**

### Working and verified

- TEST package 084 is installed and read back, preserving all 195 existing
  datasets. It adds fixed update windows and recurring controls; no account,
  grant, provider request or capture activation was created.
- Production package 020 passed the full-schema isolated restore rehearsal:
  all original archived rows and sequences were preserved. The synthetic journey
  verifies complete inventory traversal, four-stage completion, pause/resume,
  revocation and source preservation.
- The candidate now has twenty SQL packages, 37 unchanged runtime artifacts and
  a 71-step release plan. Runtime boot/caller evidence is explicitly carried
  forward for identical bytes. All 31 release tests pass; fresh read-only
  configuration preflight matches the 88 existing production definitions.
- The operator controls passed local browser, application-to-SQL, type and build
  checks. The matching Git `d6068af` is now on stable `test.openfolk.ai`; the
  existing signed-in operator can read and refresh the new controls. Capture is
  correctly shown as not enabled; no approval or provider request was submitted.

### Needs finishing

- Verify provider date filters and the intended real recurring capture journey
  through the hosted controls and worker.
- The matching protected production preview is ready with its rendered production
  backend verified. Complete sign-in, integrated release gates, matched
  installation and initial live observation.
- Broader history, source-to-card acceptance, scoring and operational requirements
  below remain open. Paused bounded imports do not establish ongoing capture.

### Blocked externally

- Live-login credential lookup still awaits owner Touch ID. Other release and
  connector work can continue independently.

[Database and runtime evidence](evidence/learn-production-commusoft-recurring-2026-10-12.json) ·
[Hosted TEST evidence](evidence/learn-test-commusoft-recurring-hosted-2026-10-12.json).

## Earlier checkpoints

**12 October — four scheduler failure paths corrected; exact runtime checks passed.**

### Working and verified

- Compiled-runtime checks reproduced false success in customer-card, identity,
  interaction and phone-processing schedulers when queue writes were uncertain,
  duplicate lookup returned no job, or only some tenants queued successfully.
  Twelve of 28 cases failed before the fix; all 28 now pass against the rebuilt
  artifacts. Auth rejection, tenant binding and successful deduplication still pass.
- All 37 freshly compiled endpoints reject missing authorization. The reviewed
  19 dynamic call sites still resolve to 51 available database functions. The
  nineteen SQL packages are unchanged; the 70-step plan pins the revised runtime.
- Twenty-eight release adapter/journal tests and three candidate tests pass.
  Fresh read-only configuration preflight matches all 88 production definitions
  against this candidate. No production configuration or release was applied.

### Needs finishing

- These isolated checks cover four scheduler HTTP contracts with synthetic data,
  not the hosted JWT gateway, remaining callers or real provider processing.
- Complete integrated release gates, positive hosted callers, production sign-in,
  deployment and initial live observation. Full input coverage, cards/scoring and
  operational requirements below remain open.

### Blocked externally

- Saved live-login lookup still awaits owner Touch ID in 1Password. No credential
  was read by the timed-out attempt; independent release work continues.

[Exact compiled scheduler evidence](evidence/learn-production-scheduler-callers-2026-10-12.json).

**12 October — production configuration execution prepared; live remains unchanged.**

### Working and verified

- The missing server-configuration adapter is implemented and locally verified.
  It preserves existing credentials, stages input dispatch off and supports a
  separate activation step after the matching runtime. Configuration-induced
  function version changes are reconciled using an exact receipt.
- Twenty-eight local tests pass, including the combined configuration → 37 runtime
  uploads → publication → activation sequence and interruption handling.
- Fresh production reads match all 88 existing function definitions and original
  target schedules. Zero release-package receipts are present. These are read-only
  observations; no production release or provider operation has occurred.

### Needs finishing

- Complete and execute the integrated release gates: current recovery and source
  preservation, worker/caller coordination, in-flight completion, positive callers,
  backend installation, production sign-in and live activation/observation.
- The previously verified Slack sample remains retained and paused. Full input
  coverage, replies, source-to-card processing, scoring and operational requirements
  remain part of the full launch goal; none are deferred by this checkpoint.

### Blocked externally

- Production preview is still signed out. The authorised lookup for a saved live
  login reached 1Password's Touch ID prompt and timed out without item access.
  The request for owner authentication is pending; independent work continues.

[Configuration execution evidence](evidence/learn-production-configuration-2026-10-12.json).

**12 October, 21:14 UTC — approved historical Slack TEST sample and duplicate check passed.**

### Working and verified

- Two ordinary Slack messages are stored in Drummonds TEST, one from each approved
  public channel/day (engineer technical: 1 October; engineer wins: 7 October).
  Both have retained source versions and matching LEARN interaction records.
- Repeating the technical-channel window preserved the exact message, version and
  interaction row digests: two of each, no duplicates or overwritten evidence.
- Capture is paused; no active Slack jobs or recurring subscriptions remain.
  The same run used six worker invocations (five claimed jobs, one paced no-op),
  five discovery requests and five message observations including discovery/replay.
  A conservative total of 23 provider requests remains below the approved 201 cap.
- All 195 original TEST datasets were reconciled: 181 identical, thirteen others
  retain every original row plus expected additions. One pre-existing Auth row
  changed and is confirmed as the existing TEST operator; exact changed columns
  cannot be established from the baseline hashes. All earlier source data remains.

### Needs finishing

- Neither sample contained an observed thread parent. Real reply acceptance is
  still open. These two days do not prove full history, private-channel visibility,
  ongoing capture, customer attribution or source-to-card processing.
- Complete the production release gates and signed-in journeys, then promote the
  matching nineteen-package release using the existing live UX and branding.
  Deployment is already authorised; this TEST run made no production changes.
- Complete the other input, scoring, recovery and operational requirements below.
  This sample does not narrow or complete the overall launch goal.

### Blocked externally

- No further user action was needed for this approved sample. The earlier
  historical-date approval request is resolved. DMs remain excluded.

[Historical sample and preservation evidence](evidence/learn-slack-real-history-2026-10-12.json).

**12 October, 21:03 UTC — real Slack TEST access verified; approved windows empty; matching recurring fix installed.**

### Working and verified

- Chris approved the existing channel-only credential in Drummonds TEST and the
  bounded two-channel import. The operator form stored it in encrypted Vault;
  both exact 12 October 00:00–19:00 UTC windows completed in one page each.
  Slack returned **zero messages**. Two worker calls were acknowledged, then
  capture was paused; there are no active Slack jobs or recurring subscriptions.
- The complete offline operator journey now verifies ongoing channel windows,
  observed replies, encrypted credential binding, page replay, pause/resume and
  revoked authority. It exposed and fixed both cross-client approval attribution
  and paused reply jobs consuming attempts. TEST package 083 installed with all
  195 datasets unchanged before the separate approved real run.
- All nineteen production packages pass the isolated archive rehearsal, preserving
  all original archived rows/sequences. The exact unchanged 37 runtime artifacts
  retain their prior boot evidence; no new boot execution is claimed. The matching
  70-step release plan and 23 adapter/journal tests pass. Live remains unchanged.
- Post-run reconciliation checks all 195 baseline datasets: 184 are identical;
  ten others preserve every original row and contain expected new setup/audit/job
  records. One existing TEST operator Auth row changed during the browser session.
  It is the expected operator, but whole-row baseline hashes cannot prove its exact
  changed columns. Existing source communications, profiles, grants and other
  retained records match. Do not describe all Auth rows as unchanged.

### Needs finishing

- Positive real message storage, observed replies, deduplication and source-to-card
  acceptance are **not proved by empty successful windows**. Full history,
  private-channel visibility and ongoing provider capture remain open.
- Complete the production release gates and signed-in production journeys, then
  promote the matched release using the existing live UX/Drummonds branding.
  Deployment to live and TEST is already authorised; no repeat approval is needed.
- One browser date-entry mistake was retired before execution (zero attempts).
  The original approval/settings remain recorded. Native input changes produced
  and verified the correct dates before either provider call. This did not reset
  or increase the run's request/message budgets.

### Blocked externally

- A concrete date-window amendment is awaiting Chris's decision: discover at most
  one latest available message per same public channel, then capture its bounded
  UTC day within the original cumulative limits. The initial permission named
  12 October only. No older discovery/import has started. DMs remain excluded.

[Recurring release evidence](evidence/learn-production-slack-recurring-2026-10-12.json) ·
[Real empty-window evidence](evidence/learn-slack-real-empty-windows-2026-10-12.json) ·
[Exact amendment, subsequently approved](LEARN-SLACK-REAL-TEST.md#approved-historical-date-window-amendment--12-october-2105-utc).

**12 October, 20:33 UTC — matching eighteen-package production candidate rehearsed; TEST operator attribution repaired.**
A full production-schema journey caught a real gap: the generic reference trigger
rejected a Slack approval attributed to an OpenFolk operator from another client.
The correction is scoped to the two Slack approval tables. New cross-client
attribution requires the authenticated operator's existing admin authority;
account/job/message references remain tenant-bound. Impersonated approvers and
foreign source references are rejected. Operator profiles are not moved.

All eighteen production packages now pass the isolated retained-archive rehearsal,
including credential configuration/recovery using the real synthetic encrypted
Vault, logged operator channel/thread approvals and recovery, and legacy bot
source/reply journeys. The original 299 archive tables (1,591,576 rows) and their
sequences match; this is retained-archive evidence, not a fresh live preservation
claim. The same fix is installed as TEST package 082 after rollback rehearsal,
with all 195 TEST datasets unchanged and no account/grant/credential/capture change.

The matching 37 workers compile and boot without network, rejecting missing auth.
Nineteen reviewed dynamic-call sites resolve to 51 available authorised RPC targets.
The 69-step release sequence pins all eighteen SQL packages and exact worker bytes;
23 adapter/journal checks pass, including uncertain outcomes and duplicate writes.
A new protected production-configured preview, Git `04f7f8e`, renders the correct
production auth origin and existing login design. Signed-in production acceptance,
positive hosted processing, release execution and input completeness remain open.
Live is unchanged; real Slack credential/message approval is still pending.
[Package/runtime evidence](evidence/learn-production-slack-setup-2026-10-12.json) ·
[Production preview evidence](evidence/learn-production-frontend-slack-setup-2026-10-12.json).


**12 October, 20:16 UTC — Slack connection form deployed and visible in signed-in TEST.**
Git `e847a52` is READY on deployment `dpl_6GXNj12kz22mHG25MPm284sK6tuM`;
both permanent TEST aliases resolve to it and preview protection remains enabled.
Chris's existing operator session shows the empty connection form and channel
controls in the existing OpenFolk design. An older cached browser view was resolved
by fresh navigation. Ten focused client tests, TypeScript and build passed.
The live alias remains unchanged; this is not a production release.

The connection form retains only secret-free recovery metadata and clears the token
input before submission. Positive hosted credential save and real capture remain
unverified. The [bounded real acceptance](LEARN-SLACK-REAL-TEST.md) is prepared and
its separate hosted-credential/message-copy approval has been requested. No new
accounts, grants, hosted Slack credential or messages were created. The pre-copy
preservation baseline initially hit response-size and management rate limits.
After reducing request volume and waiting, the bounded reader completed: all 195
datasets have retained row digests validated against their full-table fingerprint,
without exporting raw records. Full authorised history,
private-channel visibility and matching production promotion remain unfinished.
[Frontend evidence](evidence/learn-slack-connection-frontend-2026-10-12.json).


**12 October, 19:56 UTC — OpenFolk Slack setup and import controls installed in TEST.**
Package 081 adds operator-governed user-credential configuration with durable
request/check/cancel receipts. It binds tenant, workspace and consenting user,
refuses credential rotation during active/recurring capture, and returns no secret.
Initial channel/thread imports, recovery and status readers now accept existing
OpenFolk authority through logged client selection; tenant users retain their
existing boundaries. Operator profiles are never moved or impersonated.

The exact hosted package passed rollback rehearsal and installation with all 194
original datasets unchanged and its new request table empty. Synthetic PostgreSQL
checks cover configuration/replay/cancellation, secret-free metadata, actor and
identity mismatch, channel/thread approvals and recovery, view-only/expired/preview
access and tenant isolation. Twelve client tests, TypeScript and build pass. The
existing OpenFolk input screen now includes the existing Slack capture controls in
local source; frontend deployment and signed-in acceptance are still pending.

No new account/grant, hosted credential, capture or production change occurred.
Next: complete the real credential-provisioning and bounded channel/thread import
journey using Chris's existing operator session, then verify evidence in LEARN.
[Evidence](evidence/learn-slack-operator-setup-2026-10-12.json).

**12 October, 19:47 UTC — Slack user-credential path installed and checked in hosted TEST.**
Package 080 passed a full rollback rehearsal and was installed once; the matching
Slack worker is ACTIVE at v11 with gateway authentication enabled. All 194 retained
datasets match before and after schema installation, worker replacement and HTTP
verification. Fourteen downloaded executable modules match the reviewed source;
one type-only module is omitted with no emitted import pointing to it.

Seven HTTP checks pass: missing/incorrect credentials, wrong method and caller
work selectors are rejected; an authorised empty-queue invocation returns zero
claimed jobs. This verifies deployment and access controls, not Slack ingestion.
No hosted Slack credential, channel activation, provider request, new login/grant
or production change occurred. Real channel/thread capture, private-channel
visibility and whole-history orchestration remain unfinished. The existing live
UX remains the product design, and ordinary live deployment is authorised.
[Hosted evidence](evidence/learn-slack-user-hosted-2026-10-12.json).

**12 October — explicit Slack user credential and public-channel transport verified locally.**
The worker now binds the approved consenting user and workspace, uses a separate
`user_token` field, and preserves actual public-channel membership rather than
requiring Heidi to join every channel. Invalid/mismatched identities and token
types fail closed. Private/shared channels and DMs remain blocked at this stage.
Private-channel visibility, whole-history orchestration and hosted acceptance
are still required; the goal has not been narrowed to public channels.

The matching migration updates ten setup/read/recovery/recurring functions without
changing their grants, stored communications or current capture state. Both user
and legacy bot SQL rehearsals passed in disposable network-isolated PostgreSQL,
including credential namespace isolation, rollback, pause and concurrent thread
scheduling. All 63 Slack unit tests pass. No hosted package, credential, provider
message read or production change was made. [Evidence](evidence/learn-slack-user-credential-local-2026-10-12.json).

**12 October, 19:28 UTC — Slack channel-only credential verified; live deployment authorised.**
Chris explicitly authorised deployment to `openfolk.ai` and `test.openfolk.ai`
using the existing live UX and Drummonds branding. The conversation showcase is
not the intended product redesign. This supersedes older statements that ordinary
production promotion awaits his permission; technical release, preservation and
signed-in acceptance gates still apply. No production promotion has occurred.

The DH app `A0C8G0STUKV` is installed as Heidi. After Chris deferred individual and
group DMs, all four DM scopes were removed, the broader token revoked, and a
replacement authorised with the seven channel/identity/file scopes. Two read-only
API checks proved the old token is rejected and the new token matches the original
DH/Heidi identity with no DM scopes. Keychain and the existing 1Password recovery
field both match the new credential; unrelated note content is preserved.

The earlier metadata-only inventory identified 180 public and 135 accessible
private channels, including archived channels. No messages or files were fetched.
Channel import, thread history, private-channel visibility and full-history
orchestration remained unfinished at this observation; the later hosted TEST
update above adds the explicit user credential path.
No Slack credential has been provisioned to hosted TEST or production, and no
Slack capture has been activated. [Current scope and evidence](LEARN-SLACK-HISTORICAL-COVERAGE.md).

**12 October — DH Slack authentication and access boundaries verified.**
Heidi's authenticated DH session now works. Read-only administration inspection
confirms Business+, indefinite message retention for public/private channels and
DMs, no saved edit history, and disabled retention overrides. The export page
currently permits public-channel export and requires an application for broader
private/DM export. No such application, app installation, membership change or
Slack import has been performed. Existing-app ownership and exact read-only
connection permissions remain to be established. See
[Slack coverage](LEARN-SLACK-HISTORICAL-COVERAGE.md).

**12 October — ongoing Commusoft cycle backend implemented; isolated SQL acceptance passes.**
The new migration introduces explicit operator-approved subscriptions, immutable
control/step receipts and a four-stage cycle: full properties, jobs, customer
contacts and site contacts. Bootstrap is unfiltered. Later cycles retain a full
parent inventory and freeze update bounds with a five-minute overlap. The watermark
moves only after all four phases are verified. A contact category with no parents
can now complete using that cycle's full inventory as evidence; no provider page
or job is fabricated. Unknown property kinds cannot prove an empty category.
Nonempty phases still require retained completion receipts and succeeded jobs.

The existing dedicated worker claim path wakes the scheduler. Pause/revocation
fences credential/page admission and skips queued recurring work without spending
retries or starving another client. Local PostgreSQL tests cover the real setup,
permit, page, finish and scheduler SQL with synthetic source data and no network;
installation rollback restores previous function definitions/grants. This is not
hosted acceptance or active capture. No client approval, schedule, credential or
provider request was installed. [Evidence](evidence/learn-commusoft-recurring-local-2026-10-12.json).

Remaining work for this feature: deeper interrupted/expired
cycle and concurrency acceptance, operator controls, full production-archive
rehearsal, release packaging and hosted verification/activation. The first cycle
repeats all four unfiltered traversals, so its provider budget must be explicit.
Source ingestion remains separate from canonical publication/enrichment acceptance.


**12 October, 18:43 UTC — operator login fix deployed and verified on permanent TEST.**
The protected TEST deployment now serves `3089ee4`. Both stable aliases point to
the same READY deployment; four unauthenticated route checks remain protected,
and the served auth origin is the isolated TEST backend. Chris's existing signed-in
session navigated from `/login` to `/openfolk` automatically, then opened Drummonds.
No account/grant or production changes. Twelve local recovery/routing checks pass.
[Deployment evidence](evidence/learn-operator-login-routing-2026-10-12.json).
The report panel and generic client workspace provisioning remain separate gaps.

The corrected normal production preview's actual login DOM now confirms
`tgbnakbxwcqjeimygroz`; its production sign-in remains unverified and it predates
the latest login fix. The rejected custom-staging preview must never be promoted.
Slack Google sign-in identifies Heidi and the existing **DH / 22-member** workspace,
but DH requires a separate phone authentication code. The correct prompt is open;
no Slack app, permission, credential or real capture has been changed.

The final Commusoft import remains paused with zero active jobs. The auth preservation
review cannot yet explain its entire difference by reversing the known sign-in
timestamp alone. Its original baseline remains intact and no further dispatch was
made. All 193 non-auth-user datasets match; full acceptance remains qualified.

**12 October, 18:36 UTC — TEST sign-in confirmed; operator landing fix prepared.**
Chris is signed in on `test.openfolk.ai`; the Drummonds TEST controller and
module controls are visible with the existing grant. Default login incorrectly
sent an operator to the generic client landing page. The prepared fix waits for
server-verified operator authority before choosing `/openfolk`, preserves explicit
client destinations and password recovery, and offers retry if authority cannot
be checked. Twelve recovery/routing tests and the app build pass. This change is
not yet deployed. The operator report panel's intermittent read failure remains
separate and unresolved.

The refreshed customer-contact traversal finished all **1,550 parents**, following
the earlier **871-site** traversal; retained source counts are 2,421 properties,
12,611 jobs and 2,965 contacts. Commusoft TEST input was then paused through the
signed-in controller and read back Off. Final preservation reported only
`auth.users` changed during the user's sign-in; the other 193 protected datasets
matched. The auth change still requires its explicit evidence review; do not
claim full preservation acceptance or resume this runner by resetting its baseline.

The former production frontend candidate is **rejected**: `target: staging`
selected an existing custom Vercel environment with a different isolated backend.
The release-sequence guard now rejects its evidence state. A normal preview
without that target is READY, but its actual browser binding and production
sign-in still need verification. Live still serves the correct production backend;
no environment override, production deployment or production Auth setting changed.
Earlier preview-ready statements below are superseded by this finding.


**12 October, 18:19 UTC — permanent TEST address established.**
`https://test.openfolk.ai` now serves the exact existing TEST deployment under
Vercel authentication on all TEST URLs. HTTPS and four protected entry routes
pass, and the application login is visible after Vercel authentication. TEST Auth
now returns reset links to this address, preserving older allowed return URLs.
The production site, Auth settings, grants and data were not changed by this setup.
Signed-in acceptance on the new origin and an end-to-end reset remain pending.
[Domain evidence](evidence/learn-stable-test-domain-2026-10-12.json).

The separate production-preview password reset remains under investigation:
a direct recovery request was accepted and a production session was established,
but the user encountered an expired link. Neither a valid user-held session nor
a changed password is proven. No more recovery requests are queued. A local
login-page diagnostic now exposes only the configured public auth origin, so the
next candidate can prove its served backend without exposing credentials. The app
build passes; that diagnostic is not yet deployed. Recurring Commusoft capture
remains unfinished; its design work did not install or activate a scheduler.

**12 October, 17:57 UTC — current frontend built as a protected preview.**
Vercel built Git `254db78` to READY in the existing production project as a
staging preview. All four unauthenticated entry routes remain protected and the
login screen loads. The current live deployment, domains and backend are unchanged.
The 68-step release preparation now pins this frontend together with SQL 001–017
and the 37 verified local server artifacts. The existing live-account sign-in is
requested in that tab; actual served backend binding and signed-in acceptance are
still unverified. This supersedes the earlier requirement to rebuild the outdated
frontend preview. [Current preview evidence](evidence/learn-production-frontend-refresh-2026-10-12.json).

**12 October, 17:54 UTC — recording refresh verified; browser recovery checked.**
The approved backup now verifies all **2,950 files / 616,063,866 bytes** from the
17:40 UTC inventory, with **2,944 recording references**, no missing referenced
objects and no recording rows without storage pointers. Six unreferenced files
remain retained. Recovery found all 2,950 immutable receipts and verified every
destination byte and source reference before publishing its successful manifest.
This is current file-backup evidence, not a new playback/database-restore test or
proof of an always-on backup host. [Backup evidence](evidence/learn-recording-backup-refresh-2026-10-12.json).

The actual Commusoft operator components passed an isolated browser flow:
populated reversed date bounds stay blocked; changing bounds clears confirmation;
exact UTC values survive a lost response and receipt recovery with **one** apply
call. The older backend hides unsupported refresh controls. The observed local-time
display is now labelled, and thrown transport errors produce a calm recovery
instruction without exposing raw transport details. Thirteen input/outbox tests
pass. These are synthetic browser checks, not a hosted date-filter acceptance.
[Browser evidence](evidence/learn-commusoft-refresh-browser-2026-10-12.json).

**12 October — bounded Commusoft refresh implemented and rehearsed locally.**
Operators can prepare a fixed UTC update period. Its lower-inclusive and
upper-exclusive bounds remain attached to the approval, credential permit,
pagination and resumed job. Invalid/partial periods cannot silently become full
imports. Updated source versions preserve earlier history, and a filtered property
pass cannot replace the complete customer/site list used for contact coverage.
The customer/operator status distinguishes a finished update period from a full
collection traversal. New controls stay hidden against the older hosted backend.

All **90** connector/operator checks and **23** release checks pass, and the app
build passes. The 17-package production candidate was applied to an isolated copy
of the retained archive: all 1,591,576 original rows and original sequences match;
all 381 post-prerequisite datasets also match. The real-schema synthetic operator
journey, permission-drift rejection, rollback and duplicate-apply checks pass.
All 37 matching server artifacts compiled and rejected missing authentication in
the network-disabled runtime. [Evidence](evidence/learn-production-update-windows-2026-10-12.json).

The prepared sequence now has **68 steps**. These checks are local, not hosted
or real-provider acceptance. The retained frontend preview predates the new
controls and must be rebuilt and verified before promotion. Date-filter provider
acceptance, recurring windows/watermarks, canonical update reconciliation,
production configuration, signed-in acceptance and release approval remain open.
No production or hosted TEST migration/runtime was changed by this work.

The ongoing TEST contact run reached **1,080 of 1,550** customer checks at 17:46 UTC.
Its original limits and expiry remain in force. The recording refresh copied 57
new recordings but an AWS request failed during whole-inventory verification.
Recovery is reusing the retained receipts and verifying all 2,950 files; do not
mark the refreshed backup successful yet. The morning manifest remains the last
verified backup. Drummonds Slack sign-in remains pending.

**12 October, 17:30 UTC — refreshed contact checkpoint verified and resumed.**
The current TEST customer-contact pass completed 900 of 1,550 parent checks with
all 194 protected datasets preserved, no pending invocation and one queued successor.
It retains 2,962 contact records, 2,421 properties and 12,611 jobs; all 871 site
checks remain complete. The next batch resumes that exact checkpoint, with the
same 19:58 UTC expiry and original cumulative 4,000-request ceiling (2,964 used
at the verified checkpoint). No production data changed.
[Checkpoint evidence](evidence/learn-commusoft-contact-checkpoint-900-2026-10-12.json).

The approved recording backup refresh is running against a fresh inventory of
2,950 files. This is **not yet a verified backup**; the morning's 2,893-file
manifest remains the last successful coverage. Do not restart the live runner
or accept its inventory alone as destination verification.

The recurring Commusoft gap is now traced to completed imports having no next
refresh window, not merely a missing infrastructure trigger. The
[implementation requirements](COMMUSOFT-CONTINUATION-2026-10-10.md) identify update
bounds, durable watermark advancement and preservation of full contact parent
coverage. Provider filter acceptance, recurring controls and canonical update
reconciliation remain unfinished. Drummonds Slack sign-in is requested; only the
OpenFolk workspace is currently signed in.

**12 October — recurring worker dispatch implemented and rebuilt locally.**
The existing authenticated platform-worker tick can now call the dedicated
Commusoft worker, Slack recurring-window scheduler and Slack worker. It sends
the existing gateway credential and separate trigger keys directly server-to-server,
with no request body. No new cron jobs or credentials in pg_net are introduced.
Filtered runs skip this dispatch; the new switch defaults off. A failed connector
does not stop the other one, and uncertain/retrying outcomes are not reported as
successful capture. Existing queue approvals, tenant admission and pacing remain
authoritative. No hosted runtime, switch, credential or production data changed.

Thirty-one local dispatch/guard and release-adapter checks pass. All 37 updated
artifacts compiled and booted in the network-disabled Edge runtime; all rejected
missing authentication. These are local checks, not positive hosted acceptance.
The 16 SQL packages are unchanged. Schedule transition SQL differs only in its
runtime-manifest pin; its prior archive rehearsal remains the behavioural evidence.
The release is now **67 steps**: configuration keeps dispatch off during staging,
then a separate reviewed activation follows signed-in acceptance and precedes
restoration of the existing schedules.
[Dispatch and artifact evidence](evidence/learn-production-input-dispatch-2026-10-12.json).

Still needed: positive hosted dispatch verification, secure production configuration,
recurring Commusoft incremental refresh (dispatch alone does not create refresh
approvals), durable operator visibility of dispatch failures, and Drummonds Slack
connection/history coverage. The new code does not expand an approved import or
make an unconnected Slack workspace live. Production promotion remains unapproved.

The signed-in TEST operator page was verified again as Chris and showed 784 of
1,550 refreshed customer-contact checks at 17:20 UTC. The bounded runner continues;
the last completed batch at 700 preserved all 194 protected datasets. All 871
site checks are complete. No further TEST sign-in is needed for this continuation.

**12 October — database and schedule execution adapters connected.**
The release journal can now use the exact 16 package statements and the two
rehearsed schedule transitions through a fixed production management endpoint.
Read-only is the default. Writes require the separate current scoped release
authorization and an exact-statement transport allowlist. Before submission,
package bytes and ordered receipt names/hashes are checked; no generic SQL, retries
or new permissions are introduced. A committed operation with a lost response is
reconciled from its receipt or schedule state before the journal advances.

Twenty local SQL/runtime/journal checks pass, including wrong/duplicate/out-of-order
receipts, changed schedules and SQL bytes, and interrupted database/schedule commits.
These use synthetic operation ports; the underlying unchanged SQL retains its
separate production-archive rehearsal evidence.
[Adapter checks](evidence/learn-production-sql-adapter-rehearsal-2026-10-12.json).
The hosted read-only preflight confirms zero new production receipts and all 18
schedules present, with the nine target schedules at their original active states.
[Hosted observation](evidence/learn-production-sql-adapter-preflight-2026-10-12.json).

Server configuration and automatic Commusoft/Slack dispatch still need finishing.
The dedicated workers require a gateway bearer plus `x-serviceos-worker-key` and
an empty POST body; the shared platform worker does not currently dispatch them.
Provisioning their key names alone would not establish ongoing capture. Prepare
and verify the matching trigger route as part of the concrete production release,
while preserving the reviewed activation scope. Current approval/drain gates,
frontend promotion and signed-in live acceptance remain open.

**12 October — runtime deployment adapter connected; hosted use remains read-only.**
The adapter now supports the exact 28 updates, nine new function uploads and
Supabase's final metadata publication operation. It verifies database receipts,
original or expected function versions, entrypoints, artifact hashes, JWT flags
and unaffected endpoints. Read-only is the default; mutation requires the separate
current scoped release-approval and in-flight-drain gate. It submits once and
leaves uncertain outcomes for the durable journal's read-only reconciliation.

The prepared release now has **66 steps**, superseding the prior 65-step sequence
by explicitly adding metadata publication. Fourteen local adapter/journal checks
pass using synthetic API responses, including a lost upload response, changed
versions/entrypoints/flags, wrong bytes, absent receipts and prohibited requests.
The official [publication API](https://supabase.com/docs/reference/api/v1-bulk-update-functions)
is reflected in the pinned operations.
[Adapter evidence](evidence/learn-production-runtime-adapter-rehearsal-2026-10-12.json).

The actual production read-only preflight found all 28 existing endpoints unchanged,
all nine proposed endpoints absent, unrelated endpoints unchanged and no production
release ledger. No database package or function was installed by this check.
The first probe rejected the management query's HTTP 201; the corrected transport
accepts 200/201 only for its two exact read-only queries.
[Hosted preflight](evidence/learn-production-runtime-adapter-preflight-2026-10-12.json).
Database/schedule execution integration, configuration, fresh approval/drain gates,
frontend promotion and positive live acceptance remain unfinished.

**12 October — release sequence and durable journal verified locally.**
The prepared sequence pins 16 database packages, 37 exact compiled runtime
artifacts, the rehearsed schedule transitions and the production-configured
frontend candidate. Its 65 steps keep preflight, in-flight drain, source
preservation, runtime/configuration, frontend promotion, signed-in acceptance,
schedule restoration and live observation in order. Transport bytes are checked
against the original pinned boot/bundle evidence, not only a report's status label.

Eight local checks pass using synthetic operation ports and a real private
filesystem journal. Intent is flushed before submission; after-state is required
to advance. A lost response remains uncertain until read-only reconciliation
confirms the result. Observing the old state does not automatically resend a
request that may still finish. Concurrent writers/operations, missing approval,
drift, changed journal files and failed persistence are rejected. Raw errors,
credentials and API bodies are excluded from the journal.
[Journal evidence](evidence/learn-production-release-journal-2026-10-12.json) and
[prepared sequence](../../supabase/release/learn-production/release-sequence.plan.json).
This completes the journal mechanics, not a hosted release. The actual production
execution/observation adapters, current approval and remaining acceptance gates
are still required. No production operation was submitted.

The refreshed customer-contact traversal reached 500 of 1,550 at 16:52 UTC,
with all 194 protected datasets preserved. It retains 2,962 contacts, 2,421
properties and 12,611 jobs; all 871 site checks remain complete. The next bounded
batch continues under the same approval and original 4,000-request cap.

**12 October — scheduler pause and restoration rehearsed against the archive.**
The exact nine-schedule transaction now passes with the existing production
`postgres` scheduler permissions. It pauses only the reviewed jobs, preserves
commands and unrelated schedules, and restores all 18 original schedule rows.
Eight negative checks cover wrong target/manifest, command drift, duplicate
attempts and late failures during pause and restoration. All 299 archived tables /
1,591,576 rows / five sequences match afterward; the isolated container was removed.
The first harness used the restore-administrator role; the second exposed a direct
cron-table permission assumption. The final version uses `cron.alter_job` without
new permissions. No production schedule changed.
[Rehearsal](evidence/learn-production-schedule-transition-2026-10-12.json) and
[pinned operations](../../supabase/release/learn-production/schedule-transition.manifest.json).

A read-only production observation at 16:44 UTC found an empty HTTP request queue
while one worker lease remained live. Fourteen other running job rows had no future
lease, and 22 email / 12 phone run rows remained unfinished from earlier activity.
These are retained diagnostic records, not proof that those workers are active.
Do not erase them or require their historical status to turn green as a substitute
for checking current execution. The nine schedules were still active and unchanged.
[Observation](evidence/learn-production-drain-observation-2026-10-12.json).
The release still needs durable execution journaling, coordination of manual and
external callers, verified in-flight completion and compatible runtime/configuration
before schedule restoration. Queue zero and a successful pause cannot close those
gates. The shared platform-worker pause also delays non-LEARN queued work.

**12 October, 16:37 UTC — existing production service JWT accepted by the gateway.**
Three GET probes on the retained, unchanged `simwood-test-connection` deployment
returned 401 for missing/invalid bearers and the exact 405 method guard for the
existing production service credential. The reviewed guard precedes application
authorization, database and provider work. Endpoint identity, version, artifact
hash and JWT setting matched before and after. No credentials were retained,
permissions changed or customer/provider work performed.
[Gateway evidence](evidence/learn-production-gateway-probe-2026-10-12.json).
This verifies current gateway compatibility only. Positive candidate POST calls,
the thirteen proposed gateway changes and signed-in tenant/operator journeys
remain open; a 405 response does not prove application authorization.

**12 October — missing production roster dependencies repaired and rehearsed.**
The dynamic-call review found six OpenFolk roster actions missing from the
fifteen-package candidate. Additive package 016 supplies those audited writers,
their private guard and two staff fields. The isolated production-archive
rehearsal passed create/update, lifecycle, responsibility, authority, tenant-boundary
and permission checks. All 299 original tables / 1,591,576 rows / five sequences
are preserved, as are all 381 prerequisite datasets around the new package.
Existing functions, views, roles and Storage stayed unchanged; the container was
removed. The first harness needed an original-row comparison correction for four
additions from earlier packages; the second run passed with unchanged package SQL.
[Roster evidence](evidence/learn-production-roster-rehearsal-2026-10-12.json).

All 19 reviewed dynamic RPC sites now resolve to 51 distinct available functions
with the required execute permission in the actual post-016 rehearsed catalog.
This covers the pinned source bindings, not arbitrary future dispatch or positive
hosted execution. The production runtime manifest now contains **16 SQL packages**.
All runtime source, endpoints and JWT settings are unchanged, so the original 37
compiled artifacts and their boot evidence are retained with an explicit derivation
to the updated database manifest. Three negative checks reject runtime drift,
unaccepted boot evidence and unconfirmed preservation. No new boot or production
deployment is claimed.
[RPC bindings](evidence/learn-production-rpc-bindings-2026-10-12.json) and
[unchanged runtime evidence](evidence/learn-production-runtime-roster-binding-2026-10-12.json).

The refreshed Commusoft customer-contact pass reached 300 of 1,550 customers
at 16:32 UTC, with all 194 protected datasets preserved. It found one additional
contact (2,962 retained contacts), and resumed the next bounded batch under the
same approval and global request cap. Site contacts remain complete. Full contact
coverage, publication/enrichment, signed-in live acceptance and Drummonds Slack
remain unfinished.

**12 October, 16:08 UTC — TEST sign-in restored and customer contacts running.**
Chris signed in with the existing TEST operator account. The logged OpenFolk
control queued the refreshed 1,550-customer contact traversal, approval
`1d42ce05-406d-406b-be7a-5837afa25480`, with 1,800 pages and expiry 19:58 UTC.
The supervisor retains its original total 4,000-request limit; it was not reset.
The pre-dispatch authentication difference was proven to be only the operator's
known `last_sign_in_at` change: substituting its previously observed value exactly
reproduced the retained checksum. All other 193 datasets matched. The original
and reconciled fingerprints remain in the private journal; no auth row changed
through this reconciliation. The first short worker batch is running.

All nine existing production cron callers targeting candidate functions have
matching Vault/runtime credential fingerprints, unchanged schedules and unchanged
header-compatible gateway settings. This removes the uncertainty about those
existing credential bindings. It does not prove candidate execution, the thirteen
other proposed gateway changes, or new Slack/Commusoft callers. No production
function was invoked and nothing was deployed or paused.
[Scheduled caller evidence](evidence/learn-production-scheduled-callers-2026-10-12.json).

**12 October, 15:53 UTC — site contacts complete; production-configured preview built.**
All 871 planned sites completed their contact traversal. Retained business inputs
now include 2,961 contacts, 2,421 properties and 12,611 jobs. No pending Commusoft
job remains; all 194 protected datasets match the reviewed original baseline.
The run used 2,064 of its 4,000 provider-request budget. The original 1,547-customer
pass completed earlier; the refreshed 1,550-customer set still needs reconciliation.
Whole-account publication/enrichment is not accepted. The required TEST sign-in
and next logged customer-contact approval were subsequently completed above.
[Contact evidence](evidence/learn-commusoft-operator-continuation-2026-10-12.json).

The protected production-project preview is READY from Git `e743166`; its login
screen loads and four unauthenticated routes remain Vercel-protected. It inherits
the same public environment entries as production. Actual served backend binding,
signed-in LEARN/operator journeys and live branding acceptance remain pending.
The production domain/deployment remains unchanged. The matching production SQL,
runtime and configuration have not been installed.
[Preview evidence](evidence/learn-production-frontend-preview-2026-10-12.json).
Drummonds Slack login is still missing; the observed Slack session is OpenFolk only.

**12 October — production rollback artifacts and transport prepared.** All 28
existing production endpoints have retained source and compiled backups, with
unchanged deployment metadata. All 37 new tested artifacts now have upload-format
bytes whose decompression exactly matches the verified executables. No production
change occurred. The four Marketing constraint differences were compared directly
against the original archive and match exactly; no replacement is needed.
[Runtime recovery](evidence/learn-production-runtime-recovery-2026-10-12.json) and
[constraint review](evidence/learn-production-constraint-review-2026-10-12.json).
Coordinated release execution, caller configuration, current preservation,
matching production frontend and positive signed-in acceptance remain open.

**12 October — matching processing artifacts compile and boot offline.**
All 37 compiled candidates start in the actual pinned Supabase runtime, with no
network, source/cache mounts, real credentials or customer records, and reject
unauthenticated requests. Twenty launch-reader/candidate checks pass. The
production status reader now has an explicit production-only metadata-view mode;
wrong origins and disallowed roles fail, with no raw-source fallback. The current
source closure is `c529298cfe2123ea544d00327c011d2693c16614b89713c6911d694d1ecf0e82`.
This supersedes the earlier inventory-only runtime milestone below; hosted
gateway/caller, positive authenticated and provider acceptance remain open.
[Runtime evidence](evidence/learn-production-runtime-readiness-2026-10-12.json).

The 15:24 production configuration inventory finds existing Google/phone/AI
credential names but no new Slack/Commusoft worker keys or explicit status-reader
mode. These must be included in the reviewed production promotion, alongside
caller bindings. Names are not proof of credential validity. No hosted change
occurred. The completed Commusoft batch reached 621/871 sites and 2,794 retained
contact records with all 194 original datasets preserved; the next batch resumed.

**12 October — production processing inventory and historical Slack scope prepared.**
The [runtime candidate](../../supabase/release/learn-production/runtime-candidate.manifest.json)
pins 37 endpoint source closures (221 files) against the fifteen production SQL
packages. It includes four legacy scheduled callers absent from TEST and records
thirteen proposed gateway changes for explicit caller/authorization review.
This is preparation, not deployment or approval: executable runtime validation,
dynamic dispatch, secret availability, current drift and the matching frontend
still need acceptance. Twenty-seven local queue/capture/Slack and candidate checks
pass. An obsolete queue test fixture lacked required capture admission; it was
corrected and pause/unavailable no-insert checks added. Runtime source is unchanged.

The live site redirected a signed-out browser to its production login screen.
An existing live session is still needed for signed-in Drummonds verification;
the login page alone is not acceptance. No login, grant or reset was created.

Chris requires **all available authorised Slack history**, including replies,
followed by ongoing capture. Bounded public-channel windows alone do not meet
that requirement. The [historical coverage contract](LEARN-SLACK-HISTORICAL-COVERAGE.md)
records inventory, private/shared-channel, backfill, file and evidence-to-job work.
No real Slack capture or new permission was enabled.

**12 October, 14:52 UTC — latest operator/customer-context production candidate rehearsed.**
The fifteen-package database candidate now includes the latest audited OpenFolk
client information/review, linked customer context and recording authorization.
Its four journeys passed in an isolated production-archive restore. Existing
sources, roles, tables/views and Storage were preserved; no hosted change or
provider request occurred. The complete production runtime/frontend combination,
current-baseline review, real acceptance and production approval remain open.
[Production candidate evidence](evidence/learn-production-operator-rehearsal-2026-10-12.json).

The current live frontend is still `13b5543`; the public client bundle verifies
its production backend binding. A 14:45 UTC inventory found 18,986 emails,
13,119 threads, 4,392 calls and 2,939 recordings with stored paths. Google Directory
verification at 14:51 confirms four configured mailbox addresses are absent from
the current user/alias inventory and match current delegation failures. Two other
configured addresses are aliases. Do not call all configured mailboxes healthy;
retain history while resolving present-day routing and capture configuration.
[Read-only live evidence](evidence/learn-production-live-readiness-2026-10-12.json).

The approved Heidi email additions were exactly reconciled into the stopped
Commusoft preservation journal, retaining the old hashes. Its next completed
batch reached 321 of 871 sites and 2,568 retained contacts with all 194 datasets
preserved. The same bounded import has resumed from that checkpoint.


**12 October, 14:35 UTC — approved real Heidi email capture passed in TEST.**
The existing Workspace credential captured 20 messages across 19 threads through
one successful durable worker attempt. The email flag, mailbox, account and
connection are paused; the retained successor was not dispatched. All 194 original
datasets are preserved. No attachments, AI, new human access or production changes.
An initial pre-dispatch check stopped because production's verification timestamp
had advanced. The runner now accepts a newer verification only when every other
identity/authority field is unchanged; three focused checks pass. The exact
previously rehearsed registration SQL and provider bounds were unchanged.
[Real email evidence](evidence/learn-email-real-test-2026-10-12.json).

Commusoft is stopped at 221 of 871 sites, with 2,521 retained contacts. Before
resuming, reconcile only the reviewed email additions into its preservation journal,
retaining the original hashes. The customer inventory contains 1,550 customers;
52 records share email addresses, so email alone must not merge customers.
Whole-account card publication and communication/summary enrichment remain open.

Chris has requested the showcase on the live site. Prioritise the production
release path, with a current baseline, matching schema/runtime/frontend and
signed-in acceptance. This request does not establish readiness: the complete
release combination and final production checks remain unfinished. No production
promotion has occurred and no full-goal requirement has been deferred.


**12 October, 14:14 UTC — real email capture prepared; full-schema rehearsal passed.**
Heidi's current production account is active through the existing Workspace
connection, and all three approved TEST credential digests match that identity.
The exact one-mailbox registration and 20-message queue request passed inside a
rolled-back TEST transaction; all 194 original datasets remained unchanged and
no provider was contacted. A fresh read confirms no TEST email account, messages,
threads, attempts or email jobs exist for this tenant; email remains paused.

The prepared runner pins the runtime/credentials and rehearsed SQL, invokes only
one bounded email worker, retains uncertain outcomes without automatic replay,
and pauses the mailbox afterwards. Chris's decision on mailbox activation and
message copying is pending; the earlier approval covered credentials only.
Commusoft site contacts reached a preserved checkpoint of 132 sites and resumed
in short batches under the same approval and global budget.
[Prepared email scope](LEARN-EMAIL-REAL-TEST.md) and
[preflight/rehearsal evidence](evidence/learn-email-real-test-preflight-2026-10-12.json).

**12 October, 13:58 UTC — original customer contacts and refreshed properties complete in TEST.**
The original frozen customer-contact plan completed all 1,547 parents and retained
2,395 contacts. A fresh operator-approved property pass completed all 25 pages,
retaining 2,421 properties; the three newly available customers were added without
replacing the 2,418 earlier source records. All 194 protected datasets match the
reviewed preservation baseline. Jobs remain at 12,611 retained records.

The next operator-approved work-address contact plan covers 871 sites, with at
most 1,000 pages of 100 records and a two-hour expiry. It uses the same tenant,
connection and operator access, under the existing 4,000-request supervisor ceiling;
no login or grant was created. The site pass is now running. Afterwards, the
refreshed 1,550-customer contact plan still needs traversal, followed by relationship
reconciliation and useful whole-account card publication. Completed traversal does
not establish provider deletion history, resolve missing job parents or finish V1.
[Retained traversal and preservation evidence](evidence/learn-commusoft-operator-continuation-2026-10-12.json).

**12 October — bounded real phone capture, replay and stored audio verified in TEST.**
The approved 15-minute sample retained one call and one recording. Repeating the
metadata retained the same two identities and count. The one 417,425-byte audio
copy passed the pinned runtime's storage readback/hash check. Four metadata runs
and one download succeeded; capture and registry are paused, with no transcripts,
AI processing or production changes. All original data remains preserved across
194 datasets; only exact reviewed additions were reconciled into the stopped
Commusoft supervisor's baseline, with original hashes retained.
The existing signed-in operator read the real recording and obtained audio access,
with three matching controller receipts and one audio-access receipt. Actual
playback awaits the separately requested permission after automatic review denied
pressing Play. The initial pre-provider authentication rejection was resolved by
supplying the existing verified internal-key header; no access was expanded.
Historical/voicemail coverage and AI/card enrichment remain unfinished.
[Evidence](evidence/learn-phone-real-test-2026-10-12.json).

The supervisor now validates both fresh-start and continuation receipt formats,
binding actor, tenant, account, resource/limits and expiry. Its next property
refresh must use a recorded operator approval, 100 records per page and at most
50 pages; the original overall 4,000-request ceiling is unchanged. Nine supervisor
checks pass, and read-only inspection accepted the current real continuation.
The subsequent bounded property refresh completed as recorded above.

**12 October, 13:24 UTC — property freshness gap measured; refresh rehearsed locally.**
Four bounded read-only provider requests found 2,421 currently available properties
against 2,418 retained. All nine dormant properties are already retained; the tail
contains three additional active customers. This does not explain the separate
169 missing property parents referenced by retained jobs or establish deletion history.
Both diagnostic checks preserved all 194 protected datasets.
[Totals](evidence/learn-commusoft-property-totals-2026-10-12.json) and
[new-customer tail](evidence/learn-commusoft-property-tail-2026-10-12.json).

A disposable PostgreSQL rehearsal now verifies a complete property refresh retains
old pages, plans and source versions, deduplicates unchanged properties, versions
changed properties, and discovers a new customer in the next contact plan. It also
rejects starting contacts from an unfinished refresh and does not treat omitted
properties as deletions. The actual worker/transport/SQL bridge and overview parser
pass alongside this rehearsal. This is local evidence, not a hosted refresh.
Finish the current customer-contact traversal without changing its frozen plan,
refresh properties through the operator workflow, then traverse site contacts and
the refreshed customer list. New-customer contact coverage remains outstanding.

**12 October, 13:07 UTC — customer-contact import advancing.**
The existing supervised run reached 1,268 of 1,547 customer properties and retained
2,036 contacts alongside 2,418 properties and 12,611 jobs. Its exact next worker
job was running. All 194 datasets match the reviewed preservation baseline.
Customer contacts and the subsequent site-contact traversal remain incomplete.
[Current evidence](evidence/learn-commusoft-operator-continuation-2026-10-12.json).

**12 October, 13:04 UTC — bounded real phone capture prepared.**
TEST recording importer v9 supports explicit metadata-only capture, preserving
its normal automatic processing default. All 73 local checks, strict TypeScript,
ten downloaded executable-file comparisons and three downloaded behaviour checks
pass; 194 datasets, SQL and other endpoints are preserved. No capture was enabled.
The prepared real run covers a fixed 15-minute Drummonds window, up to 20 calls/
20 recording records, one metadata replay and at most one retained audio file.
Its existing bucket remains private and capped at 1 MiB. Capture pauses after each
stage; no identity/grant, schedule, AI call or production change is included.
The goal requires approval for the real recording's TEST destination before copying.
[Exact prepared scope](LEARN-PHONE-REAL-TEST.md) and
[runtime evidence](evidence/learn-phone-metadata-only-test-2026-10-12.json).

**12 October, 12:53 UTC — operator retained-audio browser acceptance verified.**
Protected TEST frontend `e2d51fa` played the existing synthetic eight-second
recording through 0:08 under Chris's existing operator identity. Closing the
recording removed the player. Both operator information/review panels now use the
embedded layout and were visually verified after deployment. Six control-plane
receipts and two matching playback receipts across two checks match the exact
actor, synthetic tenant, recording and reason. Original audit rows are unchanged;
only these additions differ across 194 protected datasets. The stopped import
journal was precisely reconciled for those receipts, retaining its prior hashes.
No identities/grants/provider calls were added by this playback check. Real phone
capture, AI processing and card linkage remain open.
[Evidence](evidence/learn-operator-phone-playback-test-2026-10-12.json).

**12 October, 12:53 UTC — contacts at checkpoint 1,130.**
The last completed supervised batch retained 1,865 contacts, 2,418 properties and
12,611 jobs. Its next job reported `commusoft_request_window_expired`; no pending invocation or lease remained.
A continuation startup timed out before dispatch; inspection at 12:54 UTC confirmed
no invocation increase, no pending request and all 194 datasets matching. The
same bounded approval resumes after the above exact audit reconciliation;
customer and site-contact coverage remain incomplete.


**12 October, 12:36 UTC — audited operator audio path installed in TEST.**
OpenFolk's selected-client call/recording view now has a prepared playback control.
The additive SQL and new endpoint use the existing operator grant and real user JWT,
with a required reason and atomic playback/operator audit. No tenant impersonation,
new identities, grants or capture. Full-schema rollback checks, 15 local tests,
strict typechecks and build pass; all three downloaded endpoint files match and
four downloaded handler tests pass. All 194 datasets, schema and other endpoints
are preserved. Frontend deployment and signed-in acceptance are next; real phone
capture, processing and card linkage are still open.
[Evidence](evidence/learn-operator-phone-playback-test-2026-10-12.json).

**12 October, 12:24 UTC — deployed linked customer records accepted by the operator.**
The protected stable TEST alias serves `efc3d11`. Chris's existing operator session
opened the real reviewed customer card and viewed its linked job, site and contact.
Source provenance, incomplete-coverage wording and the unconfirmed completion-time
exclusion were visible. Refresh re-read the contact; closing the card removed its
details. All four result audits matched the selected tenant, real actor, card and
record IDs. No account or grant was added. Ordinary-owner browser acceptance and
communication/summary/scoring enrichment remain open.
[Evidence](evidence/learn-customer-business-context-test-2026-10-12.json).

**12 October, 12:23 UTC — customer-contact import continues.**
The same supervised run reached 896 of 1,547 customer properties, retaining 1,552
contacts alongside 2,418 properties and 12,611 jobs. All 194 protected datasets
match the reviewed baseline. Customer contacts and site-contact traversal are
not complete. [Observation](evidence/learn-commusoft-operator-continuation-2026-10-12.json).

**12 October, 12:20 UTC — approved phone credential provisioned in TEST.**
Both Simwood server-secret digests match the existing 1Password login; other secret
metadata and protected phone records/settings are unchanged. No phone route was
activated, provider request made or production changed. The next acceptance slice
must establish the real TEST account/capture scope, recording storage limits and
provider-to-card/audio journey; paid AI verification still needs the TEST key.
[Evidence](evidence/learn-phone-test-credential-2026-10-12.json).

**12 October, 12:12 UTC — customer business-context reader installed in TEST.**
The same provider-neutral reader now supplies linked jobs, sites and contacts to
customer cards and the audited OpenFolk card view. It shows canonical counts,
paginates 25 records, retains source-version references and discloses unconfirmed
job timing. Full-schema rollback checks cover company/person customers, another
business-system provider, tenant isolation, operator audit failure, revocation and
View-As denial. Installation and checks preserve all 194 datasets. Four client
contract tests, strict TypeScript and the frontend build pass. The frontend is
prepared; deployment and real signed-in acceptance remain next. This adds useful
business context, not AI summaries, communications coverage or completed scoring.
[Evidence](evidence/learn-customer-business-context-test-2026-10-12.json).

**12 October, 12:00 UTC — continued real import observed.**
Worker v7 has advanced beyond the prior stop to 641 of 1,547 customer properties,
with 1,208 contacts retained alongside 2,418 properties and 12,611 jobs. The
supervised process is active and the latest exact job is queued; this is progress,
not completed coverage. All 194 datasets match the reviewed preservation baseline,
including the verified new card chain. [Latest observation](evidence/learn-commusoft-operator-continuation-2026-10-12.json).

**12 October, 11:57 UTC — real Commusoft source-to-card chain verified in TEST.**
Chris's existing signed-in OpenFolk operator reviewed one retained customer, site,
completed job and contact. All four link to the same new customer card; the job
references the reviewed site, and the contact has the matching customer relation.
Every original row in the 12 affected tables was unchanged; the other protected
collections also matched across the 194-dataset inventory. New rows belong only
to Drummonds TEST. The operator then loaded and expanded the published card.
The UI correctly disclosed unzoned completion/closure timestamps and excluded
those times from duration/performance calculations. This proves one real business
source chain, not all records or a finished enriched card: summary, owner, next
action and communication enrichment remain unpopulated in this reviewed card.
[Real journey evidence](evidence/learn-commusoft-real-card-journey-2026-10-12.json).

**12 October, 11:57 UTC — TEST contact recovery improved after a safe stop.**
The supervised import reached 619 of 1,547 customer properties and 1,178 retained
contacts, then stopped with `commusoft_authority_unavailable`. The exact failed job
had zero permits and zero pages; no checkpoint was reset. The historical generic
code cannot prove which check failed. Worker v7 now distinguishes identifiable
authority transport failures (status 0/502/503/504) from permission denials or
invalid scope. Transport failure still stops the current request/publication;
the existing bounded queue policy may recheck all authority on another attempt.
The supervisor also retries only read-only metadata gateway failures, never an
uncertain worker POST. Seventy-eight local checks, strict TypeScript and 53 tests
against eight downloaded executable files pass. Deployment preserved all 194
datasets, schema and other endpoints. The same operator continuation has been
recorded from page 619; full contacts and site-contact traversal remain open.
[Release evidence](evidence/learn-commusoft-authority-transport-test-2026-10-12.json).

**12 October, 11:51 UTC — existing Birchills credential verified.**
The saved 1Password login made one successful read-only API identity request.
The returned account matches Drummonds' active registered production account.
No credential was displayed, reset or copied to TEST; no call/audio data was read
by this check. Copying the existing credential to TEST's two server secrets is
prepared and awaiting Chris's destination decision. Real V1 capture, playback,
processing and coverage acceptance still need completion.
[Account evidence](evidence/learn-phone-account-verification-2026-10-12.json).


**12 October, 11:26 UTC — existing production phone capture is active today.**
Read-only inventory found 4,360 retained calls (latest stored 11:20 UTC), 2,912
recordings with valid registered-account URLs and storage pointers, and 2,906
completed / six failed transcripts. The latest 200 sync records report successful
call/recording capture through 11:25 UTC and successful download/transcription/
analysis pipeline activity through 11:05 UTC. This is fresh evidence for the
existing live input, not acceptance of the replacement LEARN V1 pipeline. All
retained recording/registry metadata matched across two reads. TEST still lacks
both Simwood secrets; credential reuse and real V1 provider-to-card/playback
acceptance remain open. No provider request or production write was made by this
audit. [Evidence](evidence/learn-phone-retained-readiness-2026-10-12.json).


**12 October, 11:21 UTC — request-window fix deployed; contacts resumed.**
The TEST worker now distinguishes an expired five-second send window from an
actual authority denial. Only the expired window uses the existing bounded retry
policy; no request is sent after expiry and no access gate is relaxed. Worker v6
read-back matches all eight executable files and passes 50 behavior tests;
68 local Commusoft tests and six supervisor checks pass. Deployment preserved all
194 datasets, the schema and other endpoints. The earlier generic error cannot
prove which authority condition failed; the new code makes that distinction explicit.

The existing operator continuation resumed from page 522 without resetting the
cursor. One real read retained two contacts (1,046 total) at page 523. The supervisor
then stopped on an auth checksum change: only the existing operator was recently
updated, within one second of its existing browser-session refresh, with the same
profile/grant and all other 193 datasets matching. The original aggregate checksum
has no field-level baseline; this is a documented reconciliation, not proof that
every original auth field was unchanged. Its original checksum is retained, and
the reviewed new baseline excludes only that operator's `updated_at` timestamp.
No database row was edited for this reconciliation. The same bounded run has now
resumed; contacts are not yet complete. [Continuation evidence](evidence/learn-commusoft-operator-continuation-2026-10-12.json).

**12 October, 11:06 UTC — real operator business-review browsing verified.**
The protected stable TEST frontend now serves `e2ac2d3`. Chris's existing session
browsed retained real customers, sites, jobs and contacts, paginated customers and
opened job details. Eight result audits matched the selected client and actor;
closing the review cleared its rows. Synthetic publication/replay/isolation were
verified separately. No real canonical links were created; completing that journey,
phone/email acceptance and scoring remain open. [Evidence](evidence/openfolk-business-review-test-2026-10-12.json).


**12 October, 10:59 UTC — operator source-to-card review backend verified in TEST.**
The reviewed customer/site/job/contact path now has an audited OpenFolk facade
using the real operator identity and existing admin grant. A full-schema rollback
journey linked one synthetic customer card, site, completed job and contact;
replay, foreign scope, actor spoofing, revoked access, View-As, ordinary-owner
compatibility and rollback on audit failure passed. The exact package is installed
in TEST, preserving the protected rows across 194 datasets. No new retained grants,
accounts, canonical records or production changes. Frontend deployment and signed-in
real review remain next. [Evidence](evidence/openfolk-business-review-test-2026-10-12.json).

**12 October, 10:50 UTC — real contact continuation resumed through Chris's operator UI.**
The prior queued job settled without a provider request. Chris's existing ongoing
TEST operator account recorded master LEARN on, Email/Phone/Slack off, Commusoft on,
and an eight-hour continuation from customer-contact page 386. The existing 2,000
page allowance, 100-record page size, original traversal identity and credential
are retained. Supervised run `eb260c9d` permits at most 4,000 provider reads overall;
it creates no identity, grant or schedule. The first read advanced to page 387,
with 851 contacts retained and all preservation checks passing. The sequential
worker is still running; completion and site-contact traversal are not yet proven.


**12 October, 10:38 UTC — signed-in operator source browsing verified in TEST.**
The new Client information screen is deployed at the stable protected TEST alias
from `c323e91`. Chris's signed-in operator session loaded two pages of real
Drummonds retained Commusoft inputs (25 each), expanded source provenance/details,
and selected a second synthetic client with an empty result. Switching clients
cleared previous records. Three audit entries matched the real actor, selected
clients, reasons and page sizes. This is initial content-read acceptance, not
full cards/scoring/audio or provider-coverage acceptance. No production changes.
[Frontend, browser and audit evidence](evidence/openfolk-client-information-test-2026-10-12.json).

**12 October, 10:34 UTC — audited client-information reader installed in TEST.**
The initial fixed-collection operator RPC is installed after full-schema rollback
rehearsal, preserving 194 datasets. Selected-client pagination, ordinary-client
isolation, admin-only authority, revocation, View-As denial, explicit field
projection and failure to return data when auditing fails passed. No new accounts,
grants, provider requests or production changes occurred. Its new operator screen
still needs deployment and signed-in acceptance; recording playback, complete
source details, card relationships and performance evidence remain unfinished.
The care-report error is a missing TEST dependency package, not a failed login.
[Reader evidence](evidence/openfolk-client-information-test-2026-10-12.json).

**12 October, 10:25 UTC — TEST operator sign-in and reset-link fix verified.**
Chris received the recovery email, completed his password update and reached the
OpenFolk client directory. Arc confirmed the real operator identity and navigation
into Drummonds' TEST controller. Fixed a route-validation bug that treated numeric
`reset=1` as ordinary sign-in and skipped password selection. Eight recovery tests,
TypeScript and the remote build pass. The protected stable TEST alias now serves
`e8d1690`; its numeric reset URL was visibly verified to show the password form.
No second email or agent-submitted password change occurred.

Cross-client business-information readers remain unfinished. The Drummonds
controller also disclosed a failed open-report refresh; this still needs diagnosis.
Neither finding is hidden by the successful sign-in. Production is unchanged.
[Recovery and browser evidence](evidence/learn-password-reset-test-2026-10-12.json).

**12 October, 10:14 UTC — approved ongoing TEST operator account active.**
Chris's existing TEST login is unbanned with one non-expiring
`platform.controlplane.admin` grant and an exact audit record. Its original
profile, tenant-facing viewer role, previous grants and 192 checked datasets are
preserved. Supabase accepted one password-reset request to the stable TEST site;
email delivery and sign-in remain unverified. Seven local runner tests pass.
No production, provider or capture changes occurred.

Chris requires authorised OpenFolk operators to inspect all clients' business
information. Existing controller authority does not yet carry through every
LEARN reader. Complete a logged selected-client read workflow without moving
operator profiles between clients, then verify signed-in access and isolation.
[Access evidence](evidence/learn-test-operator-access-2026-10-12.json) and
[client-information requirements](LEARN-OPENFOLK-CLIENT-ACCESS.md).

**12 October, 09:56 UTC — real Commusoft TEST continuation retained and retired.**
Source storage now contains 2,418 unique properties (25 pages), 12,611 unique
jobs (127 pages) and 850 unique customer contacts (386 pages). Properties/jobs
reached their end cursors; customer contacts remain incomplete against the plan
of 1,547 parents, and work-address contacts have not started. The original
protected datasets remain unchanged. Capture is paused, no job is running,
the temporary grant ended and the login was banned at 09:55:57, before expiry.
The run used 413 import permits plus six diagnostic reads within its 4,000 cap.

Reconciliation found 1,553 jobs referencing 169 absent properties. Three sampled
authenticated detail requests returned JSON 404; their broader cause is not yet
established. An initial diagnostic used the wrong header/default user agent and
received 403; correcting our request removed that diagnostic access failure.
No canonical publication or production change occurred. Remaining contacts,
relationships, incremental updates and signed-in source-to-card acceptance are
next; a new continuation must use newly authorised access, not this retired login.
[Run evidence](evidence/learn-commusoft-continuation-retired-2026-10-12.json) and
[continuation record](COMMUSOFT-CONTINUATION-2026-10-10.md).

**12 October, 09:41 UTC — independent database copy and restore verified.**
The approved London stack, separate Writer/Restore identities and one key each
are active. Both credentials are verified in separate Keychain entries and
Openfolk ServiceOS in 1Password, with rotation due 10 January 2027. The retained
06:37 UTC production snapshot was age-encrypted into 198,018,440 bytes, uploaded
with AES256 and 30-day governance retention, and downloaded by Restore. Keys
retrieved again from 1Password recovered 1,594,994 native rows, 711 operational
rows, all 16 Vault secrets and 2,883 recording relationships offline. Catalog/RLS,
extensions and package hashes matched; the container and active lock were removed.
No production data changed. Daily database operation, alerts and full service
recovery remain open; this is not production LEARN acceptance.
[Independent recovery evidence](evidence/learn-independent-database-recovery-2026-10-12.json).

**12 October, 09:20 UTC — database recovery keys saved and read back from 1Password.**
The approved dedicated age identity and existing production Vault root key are
now in the concealed recovery field of the exact Openfolk ServiceOS note.
Read-back verified the age pair and matched the source root key; existing fields
and metadata were preserved. No key values were printed or written to a plaintext
host file. Six focused checks pass, including the real POSIX-pipe transport used
by the CLI. The initial ignored-template attempt was inspected before retry.
The newer 09:41 entry above verifies the subsequent AWS setup, copy and restore.
[Escrow evidence](evidence/learn-database-recovery-escrow-2026-10-12.json).

**12 October, 08:56 UTC — Commusoft continuation readiness restored.**
Full read-only TEST 079 preflight passes: original source preservation, current
Auth, exact runtime bundles, encrypted credential binding, paused capture and
retained 100-page jobs checkpoint. All 78 original dataset fingerprints match
through the reviewed reconciliation; the new baseline additionally protects
later synthetic fixtures. Thirty-two focused tests pass. Chris has now approved the exact continuation; activation is next. No further
provider data has been imported at this checkpoint. [Readiness evidence](evidence/learn-commusoft-continuation-079-2026-10-12.json).

**12 October, 08:45 UTC — approved Google credential provisioned in TEST.**
The three existing Workspace values are now in TEST server-side secret storage.
Read-back digests match the approved local credential; all other secrets, the
catalog and all 113 checked datasets are unchanged. No new Google key, provider
request, mailbox connection, capture schedule or production change occurred.
TEST still has zero active Workspace connections and zero active DWD accounts.
The credential-destination blocker is resolved; real input-to-card acceptance
and activation remain open. [Provisioning evidence](evidence/learn-workspace-test-credential-2026-10-12.json).

Chris also approved 1Password desktop CLI integration for the already-approved
database recovery setup. Chris enabled the setting and native UI read-back confirms “Integrate with
1Password CLI” is checked. Account metadata is readable; exact-note authenticated
access is now verified after the owner completed Touch ID. The recovery-key save is verified by the newer 09:20 entry above.

**12 October, 08:30–08:31 UTC — fresh recording backup and linked restore verified.**
The retried manual daily run verified **2,893 files / 602,476,551 bytes**, including
**five newly copied files / 1,472,290 bytes** and all **2,887 recording references**.
No references lacked a file or storage pointer; six unlinked files remain retained.
The immutable manifest covers the non-atomic 08:14 UTC inventory, not later arrivals.
It used 20,396 of 100,000 permitted source requests and removed its lock.

The separate Restore identity then read that AWS manifest without Supabase access,
matched every **2,883 reference in the 06:37 UTC restored database**, and disclosed
four additional references absent from that earlier snapshot. A recording absent
from the older rehearsal snapshot was restored: 47,705 bytes, one linked call and
one transcript, **29.32 seconds decoded**; temporary audio removal was confirmed.
Human listening was not performed. This is file/archived-reference recovery, not
an atomic full-service restore. The run was manual; dependable scheduled operation
remains unproven. [Fresh backup and recovery evidence](evidence/learn-recording-refresh-recovery-2026-10-12.json).

**Current delivery priority:** Chris requires the strongest verified LEARN V1
position today for a client discussion tomorrow. Prioritise real Commusoft,
Phone and Google input-to-card acceptance and signed-in operation. The proposed
Third Brain showcase is deferred until the input position is agreed; it is not
a substitute for completing LEARN. No requirement or release approval is waived.

**Database activation decision:** Chris approved the separate London database
bucket, scoped Writer/Restore identities and keys, 1Password recovery material,
one bounded encrypted snapshot copy and independent restore. These are now
verified, including key recovery copies and the separate CLI access route.
No recurring database schedule was created. Production promotion is not included.

**12 October — full archive references prepared for fresh file-backup reconciliation.**
A new offline restore preserved all 1,594,994 native rows and 711 operational rows,
exported 2,883 private recording links and removed the container after 66.73 seconds.
The source archive and its five companion files stayed unchanged. Later file
inventories can be checked for every archived reference while separately reporting
additional references absent from that database snapshot; exact-match callers
retain their stricter contract. All 85 backup tests pass. The current daily retry
observed 2,893 files and 2,887 references without missing pointers, but destination
verification and the subsequent AWS-only linked-audio restore remain in progress
or pending. [Evidence](evidence/learn-complete-archive-recording-links-2026-10-12.json).

**12 October, 08:11 UTC — recording refresh stopped on source change.**
The manual daily run detected changed listings/references during its metadata
inventory and failed closed after 2,934 requests. No new inventory or backup
completion was published; the 11 October verified manifest remains intact and
the lock was removed. Metadata scanning now uses batches of at most four reads,
retaining both full consistency passes and draining failures. All 83 backup tests
pass. A successful fresh live run is still needed before newer coverage is claimed.
[Failure and candidate evidence](evidence/learn-recording-inventory-concurrency-2026-10-12.json).

**12 October, 08:09 UTC — Connections correction deployed to protected TEST.**
Vercel remotely built Git `f7718dd0d35c161fdf6c77d9744de449bb24baca` to READY in
the separate TEST project. Its stable alias points to that exact deployment;
both hostnames retain Vercel protection. The backend binding remains TEST
`saatxzwxvdvqevbnskxy`. Twelve projection checks and application TypeScript passed.
The controller now exposes the corrected distinction between available adapters,
observed connections and unknown status, with navigation to LEARN input controls.
Signed-in navigation and real account/capture acceptance remain pending. This
frontend-only deployment changed no source data, capture, credentials or grants.
[Hosted TEST evidence](evidence/learn-connections-frontend-test-2026-10-12.json).

**12 October — supervised database backup operator prepared and verified locally.**
The new operator command reads an exact 1Password item, requires successful local
package/database/Vault verification before upload, separates Writer and Restore
Keychain identities, downloads the retained object version, re-reads escrow and
restores it offline. Synthetic tests cover lost upload acknowledgements, uncertain
restore cleanup, conflicting escrow values and wrong preparation bindings. The
real age/PostgreSQL rehearsal now includes the preparation command; all six
synthetic containers were removed. No real 1Password or AWS access was used.

The command is ready for supervised activation after the outstanding decisions;
it does not provision infrastructure or establish daily operation. Exact-item
IDs, live escrow/readback, separate AWS credential recovery copies, approved
bucket/access creation and the real independent copy/restore remain unverified.
[Operator evidence](evidence/learn-database-backup-operator-local-2026-10-12.json)
and [operating steps](../../infrastructure/database-backup/README.md#supervised-initial-copy-commands--first-real-run-verified).

**12 October — encrypted package now restores an actual synthetic database and Vault.**
The native archive, operational supplement and recovery evidence passed age
encryption, a synthetic AWS SDK transfer/download, stdin-only key delivery and a
fresh offline PostgreSQL restore. All source package files remained unchanged.
The correct root key decrypted the stored sentinel; a wrong root key failed and
its container was removed. All five synthetic containers were removed. This is
local end-to-end recovery, not an actual S3 or 1Password recovery observation.

The refactored runner also restored the retained real archive into another offline
container: 1,594,994 native rows and 711 supplemental rows matched, catalog/RLS and
extensions passed, and all 2,883 recording-metadata references resolved. The six
original source files were unchanged and the container was removed after 69.52
seconds. This regression made no production connection and did not repeat the real
Vault-key check, encrypt the archive or upload data.

The 1Password desktop app is currently available, but its CLI integration is
disabled. The official signed CLI has been prepared without account access.
Approval to enable this new account-wide terminal access route is pending; scripts
will target only Openfolk ServiceOS. No recovery key, AWS identity or bucket has
been created for database backup. Local operator/escrow integration is now covered
by the newer entry above; real independent copy/restore remains open. [Recovery evidence](evidence/learn-encrypted-database-restore-local-2026-10-12.json)
and [access scope](../../infrastructure/database-backup/README.md#1password-access-preparation--awaiting-access-decision).

**12 October — encrypted database package and transfer protocol verified synthetically.**
The pinned age implementation preserved every snapshot file through encryption,
the actual AWS SDK with a synthetic request handler, download and decryption.
Nine Python tests cover round trips, wrong keys, corruption/truncation, unsafe or
incomplete archives, mixed snapshots, private permissions and binary pinning.
All 69 JavaScript backup tests pass, including the existing recording transport.
Uncertain uploads cannot create a completion receipt; retry reads the exact
retained version. The six-file real snapshot (197,958,206 bytes) passes package
admission only: no real recovery key, encryption, AWS upload or access change.
Operator/secret-store integration, independent database restore and dependable
daily operation remain incomplete. These are local synthetic checks, not live
AWS/1Password or launch acceptance.
[Package evidence](evidence/learn-database-package-local-2026-10-12.json) and
[remaining activation steps](../../infrastructure/database-backup/README.md).

**12 October — independent database backup infrastructure prepared locally.**
A separate OpenFolk London project-scoped bucket and bounded Writer/Restore
identities are specified in a generated CloudFormation template. Local policy
checks and CloudFormation lint pass. The proposal specifies encryption before
upload, separate 1Password key escrow, 30-day governance retention with no
automatic deletion, measured size and freshly checked public pricing. No resource,
credential, upload or schedule has been created. Package and transport checks are
updated in the newer entry above; independent restore and the operator runner
remain required before the combined activation approval request. Dependable daily operation and full-service recovery
remain open. [Exact proposal](../../infrastructure/database-backup/README.md).

**12 October — fresh complete database capture, isolated restore and Vault decryption passed.**
The 06:37:26 UTC read-only snapshot produced a 197.3 MB archive plus both operational
pg_net tables. Offline comparison matched 1,594,994 archived rows across 299 data
tables, plus 711 supplemental operational rows; all inventoried physical tables
are covered. Catalog/RLS ownership, extensions and 2,883 recording-metadata links
passed. All 16 Vault secrets decrypted in a separate offline restore and matched
live keyed comparisons without exposing or persisting keys/decrypted values.
Both containers were removed. Production stayed healthy; export sessions were
closed, the short-lived credential expired and role membership was preserved.
Independent database/key backup storage, full application recovery, new audio-file
coverage and dependable recurrence remain open; this is not live V1 acceptance.
[Recovery record](LEARN-DATA-RECOVERY.md) and
[sanitised evidence](evidence/learn-complete-database-recovery-2026-10-12.json).

**12 October, 06:37–06:39 UTC — approved mailbox repair verified in scheduled capture.**
The existing Workspace route completed its first scheduled attempt: 49 messages
fetched/processed and 49 threads processed. Fresh readback confirms the original
18,610 email and 12,862 thread identities are unchanged. The run's storage window
contains 49 messages involving the mailbox, plus two concurrent records. Historical
backfill remains idle; credentials and revoked OAuth evidence were preserved.
The legacy writer has no per-account message metadata. This verifies the bounded
live recovery, not complete history, V1 source-to-card delivery or launch acceptance.
No other mailbox or production LEARN release was changed.
[Recovery record](LEARN-MAILBOX-RECOVERY.md) and
[execution evidence](evidence/learn-mailbox-route-applied-2026-10-12.json).

**12 October — all fourteen candidate packages passed a combined offline rehearsal.**
The final schema passed 54 journey invocations across Microsoft, voicemail,
input-to-card, scoring, Slack, capture controls, imports, Commusoft, email, Phone
and cards, including the real two-session pause/admission race. All 299 archived
tables (1,591,576 rows) and five sequences were preserved. Negative package guards,
roles and Storage checks passed; the network-isolated container was removed.
The first attempt exposed a Slack fixture still paused under the later capture
controls. The corrected fixture proves paused claims do not consume attempts,
then explicitly resumes its synthetic source. No product guard was weakened.
This is local synthetic acceptance against the complete candidate schema, not
hosted sign-in, real-provider coverage or permission to promote production.
[Sanitised combined evidence](evidence/learn-combined-release-rehearsal-2026-10-12.json).

**12 October — local review Modules loading repaired.**
The application development server had occupied port 47871, while an open synthetic
review tab still referenced its built assets. Restored the documented review server
and verified LEARN → Modules navigation. Modules displays its existing scope notice;
this review does not implement the full signed-in Modules journey. Reserve 47871
for this review and 47872 for the real TEST application. No live deployment changed.

**12 October, 06:04 UTC — production email failure narrowed to one OAuth account.**
A read-only follow-up joined bounded queue failures to account metadata. All seven
sampled `refresh_token_revoked` failures belong to one account, spanning 11 October
23:13 through 12 October 05:50 UTC: this failure predates the compute upgrade.
The account is still flagged active, demonstrating why that flag cannot establish
healthy capture. Account identity stays in the private investigation record.
Existing Workspace-authorised coverage for that mailbox must be checked before
requesting a new sign-in. Of the latest eight Gmail run records, seven succeeded
with zero new messages and one failed with `invalid_grant`; this does not establish
complete mailbox/history coverage. No access or credentials were changed.
[Sanitised follow-up evidence](evidence/learn-email-access-followup-2026-10-12.json).

**12 October — Connections catalogue correction verified locally.**
The legacy catalogue now distinguishes unavailable observations from known
connection failures. Microsoft, Slack and Commusoft adapter availability no longer
implies deployment, authorisation or active capture. Static Slack placeholder text
cannot override this distinction. Known Google/Phone failure and revocation states
and retained inventory remain visible. Capability notes disclose Microsoft mailbox
binding, attachment and directory limitations; inventory counts explicitly exclude
communication/customer/job coverage. Unsupported status cannot become an asserted
inactive processing source, disabled access or a zero customer-admin invitation count.
The actual tenant route now links Connections to its existing LEARN input controls.

Twelve projection tests, application TypeScript and `npm run build` passed. The
build retained its existing `inlineDynamicImports` warning. Local synthetic browser
checks verified the catalogue, Microsoft capability notes and unknown security
status with zero observed browser errors. This does **not** prove hosted signed-in
navigation, account consent, active capture, complete coverage or production
acceptance. No provider, production, account or credential mutation occurred.
GitHub TEST is a source checkpoint; automatic deployment for that branch is disabled.


**12 October, 05:51 UTC — approved production Small upgrade completed; service health recovered.**
Chris approved Small compute and the brief interruption. One journaled request at
05:41:54 UTC selected 2 GB Small at US$0.0206/hour; Pro is unchanged. Supabase was
first observed healthy at 05:46:46 UTC. SQL, Auth, database, REST and Storage now
respond successfully; metrics confirm the larger memory and 90 database connections.
The live frontend returns HTTP 200. No schema, worker, frontend, grants or schedules
were deployed by this action.

Fresh pre-change SQL timed out, with Auth/Storage already unhealthy and metrics
HTTP 500. Post-change and post-cycle record identities match the verified 00:25 UTC
archive: 18,598 emails, 4,328 calls, 2,882 recordings, 2,882 transcripts, 3,170 cards
and 2,897 Storage metadata rows. Connector, flag, mailbox/account and cron hashes
also match. This selected-source check does not replace full content/file recovery
or invent a successful fresh pre-change snapshot.

The normal five-minute cycle resumed Phone and Workspace discovery. Two mailbox
jobs succeeded; 27 were still queued at the final observation, and no new messages
or calls were stored by the sampled successful runs. One Gmail job failed with
`refresh_token_revoked`; older Workspace `invalid_grant` failures need attention.
All 35 observed post-boot HTTP calls succeeded, but this is not complete capture
coverage or LEARN launch acceptance. The export stall still needs a separately
bounded retest. The previous capacity approval blocker is resolved. The general
Connections catalogue correction is recorded in the newer local-only entry above.
The recovered read-only API also confirms the managed Storage helper is loaded
through `session_preload_libraries=supautils`, with the `postgres` policy grant on
`storage.objects`. The earlier configuration-read blocker is resolved; production
policy mutation, fresh release preflight and promotion still require their own gates.
[Capacity execution evidence](evidence/learn-production-small-compute-2026-10-12.json)
and [capacity/recovery record](LEARN-DATABASE-CAPACITY.md).

**12 October — Microsoft release passes combined offline acceptance.**
All fourteen production-specific packages install together. Synthetic Graph pages
travel through the actual reader, durable journal, email/interaction projection,
identity processing and company cards. Token renewal, stale refresh refusal,
recurring folder discovery, retry, retained-page completion and restricted operator
status pass. An actual shared-queue check proves paused work cannot be claimed,
resumes after enablement, and defers again without spending its failure budget.
Existing private voicemail and email/Phone-to-card journeys also pass.

A stronger scope-change fixture reproduced a production compatibility bug: the
restricted Microsoft credential writer triggered old Marketing functions that used
unqualified table names. Package 014 qualifies that existing dependency chain,
retaining invoker authority, grants and readiness rules. Tests cover tenants with
no sender and an enabled Gmail sender, including withdrawal of its send permission.
The fix is prepared locally; it is not installed in hosted TEST or production.

All 1,591,576 original archived rows and five sequences match. Existing Storage,
private buckets, role attributes/memberships and restricted email/card roles remain
intact. Five failure/rollback cases and duplicate rejection pass; all containers
were removed. No provider requests or live changes occurred. Real Microsoft consent
and mailbox capture, coverage, paired deployment and signed-in acceptance remain
required. No Drummonds Microsoft mailbox has yet been identified.
[Microsoft rehearsal evidence](evidence/learn-production-microsoft-rehearsal-2026-10-12.json).

**12 October — private voicemail release passes combined offline acceptance.**
All thirteen production-specific packages install together. Four synthetic suites
pass actual email storage → discovery → claimed queue job → private inbox,
1,100-row bounded dispatch, recovery, historical inbox pagination and the existing
email/Phone-to-card journey. Original owners retain historical messages after
reassignment; new owners, unrelated tenants and revoked managers are denied.
Operator aggregate health does not grant message access. Paused/failed processing
never becomes reported success or complete provider coverage.

All 1,591,576 original archived rows and five sequences match, including Storage
rows. The private audio bucket, existing policies, role attributes/memberships
and source history remain intact. One private EML bucket and the earlier three
import templates are separately accounted for. All containers were removed.
No production or hosted TEST changes were made. The local Supabase storage-policy
hook is explicit; a small read-only production configuration query returned
HTTP 544, so production installer capability still needs verification.

Real voicemail routing/ownership, provider/DKIM checks, audio/EML byte readback,
signed-in playback, independent backups of both voicemail buckets, Microsoft
release reconciliation, paired runtime and live approval remain required.
[Voicemail rehearsal evidence](evidence/learn-production-voicemail-rehearsal-2026-10-12.json).

**12 October — communication-to-card release passes production-archive acceptance.**
All twelve production-specific packages install together. Eleven synthetic suites
pass source projection, identity/card delivery, operator review, fenced job
publication/settlement, draft exclusion, bounded card inputs, restricted source
readers and customer/job/member/team search. One integrated journey uses the actual
v4 email store and Phone handoff, completes queued identity processing, and reads
two resulting cards and their source evidence as the owning company. Replays do
not duplicate cards; retained email, recording and transcript records are unchanged.

The private card reader has no login, RLS bypass or application membership. Five
restrictive policies prevent production's existing PUBLIC policies widening its
owner/admin tenant boundary. Foreign-company, demoted-user, stale-revision,
View-As and revoked-operator refusals pass where applicable. Older inputs preserve
manual card fields and newer activity. Drafts remain stored but cannot enter card
activity windows or attribution; a changed eligible revision can be reassessed.

All 1,591,576 original archived rows and five sequences still match, with only the
three earlier import templates added. Existing source columns, constraints,
functions, views and application grants remain intact. All disposable clones were
removed. No hosted environment changed or provider request was made. The earlier
production draft-impact reconciliation, real coverage, remaining connector release
packages, paired runtime and signed-in acceptance remain launch requirements.
[Communication-card rehearsal evidence](evidence/learn-production-cards-rehearsal-2026-10-12.json).

**12 October — Phone and operator health pass production-archive acceptance.**
All eleven production-specific packages install together. Ten synthetic journey
suites on actual archived production structures pass page publication, replay,
paused admission, schedule settlement, confirmed capture evidence, download retry,
processing/result preservation, operator reconciliation, saved-result reads,
scheduler diagnostics, Email retention/failure reporting, atomic interaction/event
handoff and playback authorization. Ordinary owner, foreign-tenant, View-As,
revoked-operator and stale-pointer refusals are covered where applicable.

All 1,591,576 original archived rows and five sequences still match; only the three
earlier import templates are added. Original table authority and source columns
remain intact, including legacy source grants broader than TEST. Five new phone
provenance columns remain null on existing rows. No historical evidence is invented.
The new ledgers are empty outside the synthetic clones, and all disposable databases
were removed. The earlier Email protocol role still has its exact restricted grants.

No hosted environment changed and no provider request was made. Phone workers,
real capture/coverage, signed-in audio, customer-card projection, remaining production
packages and final live approval are still required. The TEST-only fixture permission
assumptions and direct email-run insertion were corrected without weakening guards.
[Phone rehearsal evidence](evidence/learn-production-phone-rehearsal-2026-10-12.json).

**12 October — durable email capture passes production-archive acceptance.**
All ten production-specific packages install together. Production's archived schema
had retained mail but no v2 checkpoint/transition protocol. The new candidate adds
that restricted protocol, durable requests, worker attempt binding, v4 mailbox-wide
reconciliation, retained source versions and Workspace alias ownership guards.
Synthetic suites pass draft storage, provider-absence observations without deletion,
newer sent revisions, exact retry without duplicate history, continuation between
workers, paused settlement, stale-worker/foreign-tenant refusal and safe failure
receipts. Alias conflicts stay latched; existing bindings are not invented.

All 1,591,576 original archived rows and five sequences match. The private protocol
role has the exact reviewed table/column grants, cannot log in or bypass RLS, and
cannot read OAuth tokens or message bodies. Temporary installer SET/INHERIT and
schema CREATE are removed. Existing source permissions and production-only email
origin fields remain intact. Four suites pass and all disposable databases were
removed. No hosted environment changed. Matching worker cutover is mandatory:
legacy direct progress writers are incompatible with the new guards. Communication
projection/cards, phone-aware health, Microsoft, real capture and signed-in release
acceptance remain required.
[Email rehearsal evidence](evidence/learn-production-email-rehearsal-2026-10-12.json).

**12 October — Commusoft capture-to-card journey passes production-archive acceptance.**
All nine production-specific packages install together. Actual-schema synthetic
checks cover encrypted connection setup/reuse, scoped credential permits,
property discovery, customer/work-address contact traversal, empty pages, interrupted
continuation, exact replay and late-failure rollback. A captured customer, site,
contact and completed job reach one card after owner review. Stale parent evidence
is held for review; contact endpoints and graph relationships retain provenance.
Ambiguous local timestamps retain an explicit limitation rather than an invented instant.

The rehearsal found and fixed an existing production marketing trigger's unqualified
table references, which failed inside the restricted Commusoft writer. Its tenant
checks and invoker authority remain intact; a temporary-table impersonation test
still rejects a foreign-company person. All 1,591,576 original archived rows and
five sequences match, with only the three explicitly checked import templates added.
Seven synthetic journey suites pass and all disposable databases were removed.
No hosted environment changed. Real Commusoft coverage/reconciliation, runtime
integration, signed-in acceptance and production approval remain required.
[Commusoft rehearsal evidence](evidence/learn-production-commusoft-rehearsal-2026-10-12.json).

**12 October — governed customer/site/job imports pass production-archive acceptance.**
All eight production-specific packages install together. The new import framework
retains durable external identity, per-row outcomes and review conflicts, and
projects approved customers into cards without overwriting existing card content.
Actual-schema synthetic journeys pass customer/company matching, exact job/site
links, repeated imports, two-phone contact handling, honest finalisation,
100-row batches, card identity reuse, tenant/role boundaries and View-As refusal.
Marketing consent remains unchanged and existing suppressions retain precedence.

All 1,591,576 original archived rows and five sequences match. The only seeded
application rows are three reusable import templates, checked against their
pinned definitions. Existing contact/marketing tables, helper definitions and
permissions are retained. No duplicate person/company cards or cross-company
contact parents were found in the archived baseline. No hosted environment changed.
Commusoft API intake, contact traversal, operator recovery and real coverage are
still required; these fixtures do not prove Drummonds' imports are complete.
[Governed import evidence](evidence/learn-production-imports-rehearsal-2026-10-12.json).

**12 October — OpenFolk capture controls pass the production-archive rehearsal.**
The first seven production packages install together. Database-side Email/Phone/
Slack controls use the existing OpenFolk authority model, retain audit receipts,
reject ordinary-owner and View-As access, and preserve retries while capture is
paused. Saved Slack pages remain eligible for settlement; the actual phone view
continues selecting retained audio for processing ahead of paused downloads.
A two-session check proves a waiting admission sees an operator's committed pause.

All 1,591,576 archived rows and five original sequence states match. Existing
operator grants, table policies, source columns and views remain unchanged.
The shared/dedicated queue claimants and phone selector gain capture filters.
No hosted environment changed. Matching worker deployment, real provider-boundary
acceptance, signed-in controls and later Commusoft/voicemail/Microsoft extensions
remain required. A bounded batch already admitted may finish after a pause;
new admission must stop. The disposable container was removed.
[Capture-control evidence](evidence/learn-production-capture-rehearsal-2026-10-12.json).

**12 October — Slack intake and thread recovery pass the production-archive rehearsal.**
The first six production-specific packages install together. Slack adds protected
source/version/import records, durable claims, thread imports, recovery and
recurring state while preserving existing Phone/Email connector permissions.
Synthetic journeys pass owner approval through stored messages/interactions,
exact retries, foreign-company denial, retained audit/source protection and
recurring pause. An incomplete thread resumes from its retained cursor without
duplicate replies; stale recovery and completed-window continuation are rejected.

All 1,591,576 archived rows and five original sequence states match after install.
Shared table policies/grants remain unchanged; tenant-reference and retention
guards are additive. No hosted environment changed. Real Slack authorization,
provider/credential acceptance, source-to-card delivery and unattended capture
remain open. This package gates recurring admission only: manual/worker capture
controls still require reconciliation before release. Both offline databases and
their container were removed.
[Slack rehearsal evidence](evidence/learn-production-slack-rehearsal-2026-10-12.json).

**12 October — combined scoring and working-time release passes offline acceptance.**
The first five production-specific packages now install together. The fifth groups
corrections, saved assessments and recovery with individual/team collectors,
resumable collection, calendars, approved delays and receipt checks. Twelve real
SQL journeys on synthetic work passed on the production archive, including a
14,500-item population, working-hour/DST calculations, exact retries, cancellation,
rule changes, source-preserving corrections and assessment save/recovery. Forged
calculation receipts and altered assessment values were rejected.

All 1,591,576 archived rows and five original sequence states match after install;
new scoring ledgers remain empty in the preservation database. Journeys use a
second offline clone, removed with the container. Existing table policies/grants
remain unchanged; two existing helpers gain reviewed evidence/state handling and
two existing ledgers gain deferred receipt checks. No hosted environment changed.
Remaining card-input/operator/connector/queue reconciliation, real coverage,
signed-in acceptance, complete recovery and production approval remain open.
[Combined scoring evidence](evidence/learn-production-scoring-rehearsal-2026-10-12.json).

**12 October — governed work passes the combined offline production rehearsal.**
The first four production-specific packages install together on the retained full
archive. The new action checks validate ownership, assignment scope, temporary
cover, evidence, state changes and atomic attribution. Two-session checks prove
that revocations and registry edits cannot slip through an in-flight action;
an unrelated tenant can still act. View-As and stale transaction snapshots are
rejected. Measurement and work-history regressions also passed.

All 1,591,576 original archived rows and five original sequence states match.
Existing work classifications, transitions, permission vocabulary, policies and
table grants remain intact. Synthetic journeys roll back in the comparison DB;
concurrency fixtures exist only in a second offline clone. Both are removed with
the disposable container. No hosted environment changed. This is prerequisite
acceptance; remaining packages, current-provider coverage, signed-in journeys,
recovery and production approval remain required.
[Governed-work evidence](evidence/learn-production-actions-rehearsal-2026-10-12.json).

**12 October — measurement and work-history prerequisites pass combined production-archive rehearsal.**
The first three production-specific packages now install together offline. Tests
on the real restored schema passed validated measurement append/replay/correction,
human review, team-transfer coverage, handoff identity handling, ownership-time
calculation and incomplete evidence. Unresolved ownership stays unavailable rather
than becoming a low score. New staff facts deny viewer and foreign-owner/operator
access while retaining existing company-wide objective behavior.

All original values in 1,591,576 rows and five sequence states match, including
the 14,452 old work-history rows. Added columns retain old tenant-wide measurement
scope and leave historical work snapshots unknown. Synthetic fixtures rolled back
and the disposable database was removed. No hosted system changed. Remaining
calendar/correction/collector/authority/receipt updates and operator/connector
packages still need production reconciliation and complete release acceptance.
[Combined measurement/work evidence](evidence/learn-production-measurements-rehearsal-2026-10-12.json).

**12 October — production metadata and foundation/scoring rules pass combined offline rehearsal.**
The second production-specific candidate retains the existing foundation and
View-As tables and audits declared tenant relationships before adding guards and
history. All existing references passed on the retained archive. Real-schema SQL
checks cover configurable 50/100-point rules, publish/replay/conflicts, historical
periods, membership coverage, retention, foreign-tenant denial, View-As denial
and same-session owner revocation. All original catalog objects are preserved
apart from explicitly declared additions; all 1,591,576 archived rows and five
original sequences match. Synthetic rows rolled back and the disposable database
was removed. No hosted system was changed.

The next production-candidate work is measurement/collector and governed-work
compatibility, followed by the remaining operator/connector/queue packages and
the full combined release. Real performance scoring, provider coverage, signed-in
acceptance, complete recovery and promotion approval remain open.
[Combined rules rehearsal](evidence/learn-production-rules-rehearsal-2026-10-12.json).

**12 October — first production-specific metadata migration rehearsed offline.**
The candidate adds eight restricted metadata views and a private release ledger,
with production catalog guards and reader-only restrictive policies that coexist
with legacy policies. A fresh restore of the real archive passed owner/admin
counts, viewer/no-actor/unknown-actor/anonymous denial, redaction and write denial.
Original catalog and application column privileges were preserved; all 1,591,576
archived rows and five sequence values matched after the candidate and rolled-back
role checks. Wrong target, catalog drift, duplicate submission and late-failure
rollback were verified. The disposable database was removed.

This closes an offline rehearsal of the first release prerequisite only. The rest
of the production candidate, combined acceptance, live recovery, signed-in checks
and promotion approval remain open. No hosted system was changed.
[Candidate and rehearsal details](LEARN-V1-PRODUCTION-RELEASE.md#first-production-candidate-rehearsed-offline--12-october).

**12 October, 03:52 BST — production release baseline restored and compared with TEST.**
A new disposable offline restore of the pinned production archive succeeded with
network/schedules/background workers disabled and was removed after inspection.
Fresh read-only TEST metadata shows 82 TEST-only and 150 production-only public
tables, with 93 shared tables differing in catalog facets. All 79 numbered TEST
SQL packages match hosted deployment receipt hashes; 67 companion manifest pins
also match. Four reconciliation checks pass, including preserving production-only
objects/columns and detecting authority/type changes and package drift.

This identifies production-specific compatibility work: preserve email origin
constraints, marketing token triggers, correlation/event/receptionist fields and
existing service policies while adding LEARN. It does not establish migration
compatibility or change either hosted environment. The next release task is an
additive candidate rehearsed against the restored production schema/data; the
archive baseline must be refreshed before execution. Real-provider, signed-in,
recovery and approval gates remain open.
[Release reconciliation and next steps](LEARN-V1-PRODUCTION-RELEASE.md#production-archive-reconciliation--12-october-0252-utc).

**12 October, 03:48 BST — Microsoft operator diagnostics installed in TEST 079 and frontend deployed.**
The new read-only RPC uses existing OpenFolk view authority to expose account
configuration, saved/settled pages, retained publication/hold/exclusion counts,
discovery passes, queue state and fixed recovery guidance. It returns no tokens,
source bodies, provider URLs or arbitrary errors; coverage and attachment capture
remain explicitly unverified/not captured. The first synthetic latest-error
assertion needed a deterministic tie-break fixture; its rollback preserved all
148 datasets. The corrected full-schema and exact-package rehearsals passed,
including owner/revoked/unsigned denial, entitled reads, pagination and redaction.

TEST installation and anonymous/service HTTP denials preserved all 148 datasets.
No users, grants or fixtures remain from the transaction probes; worker v20 and
production are unchanged. The OpenFolk panel is wired into LEARN controls and
clears displayed data across actor/company changes. Three new status tests, seven
combined status tests, full TypeScript and the frontend build passed. The panel is now deployed from GitHub commit `9cbf56280f9b3eb561a67a15d26943b137222178`
on the isolated TEST frontend. Vercel reports READY, and both the immutable
hostname and stable alias require Vercel authentication. **Signed-in panel
acceptance remains unverified.** Consent, fresh Graph capture,
coverage reconciliation and actionable checkpoint recovery remain unfinished.
[Operator diagnostics evidence](evidence/learn-microsoft-status-2026-10-12.json) and
[frontend deployment evidence](evidence/learn-microsoft-status-frontend-2026-10-12.json).

**12 October, 03:27 BST — deployed TEST worker completes Microsoft recovery-to-card journey.**
Worker **v20** is ACTIVE on TEST 078. Deployment preserved all 148 datasets, the
database schema and every other endpoint. Downloaded-source comparison matched
110 runtime modules and checked 177 emitted local imports; three omitted modules
have no emitted importers. Strict TypeScript and all 20 control-flow tests passed
both locally and against the downloaded worker.

Five bounded hosted calls proved unsigned/anonymous denial, recovery of one saved
synthetic Microsoft page while capture was paused and the account/binding revoked,
followed by one card through the deployed identity worker. Fresh paused work stayed
queued with zero attempts, and a later Microsoft invocation claimed nothing.
All 148 datasets outside the fixture were preserved. The fixture is archived with
no credentials, human access or active jobs. No provider calls or production
changes occurred. This closes deployed saved-page recovery and downstream delivery;
fresh Graph transport, real consent/mailbox coverage, operator visibility and
signed-in acceptance remain open. Microsoft is not advertised as ready.
[Worker deployment and acceptance evidence](evidence/learn-microsoft-worker-test-2026-10-12.json).

**12 October, 03:20 BST — Microsoft TEST 078 installed; hosted RPC email-to-card journey verified.**
The exact package passed a fresh rollback rehearsal, then installed nine Microsoft
migrations with all 140 existing datasets unchanged and eight new tables empty.
A separate synthetic company then exercised the actual local handler, credential
port and reader against the installed hosted RPCs: refresh/rotation, durable page,
canonical email, interaction, identity publication and one customer card. Replaying
the completed capture and publication produced no extra fetch or card. Unsigned,
anonymous and wrong-application credential requests were rejected.

The 16-request API run preserved all 148 datasets outside its synthetic fixture.
The fixture is archived, capture paused, binding/account revoked, dummy credential
deleted and all remaining jobs cancelled. No Auth user or grant, real provider
request or production change occurred. The deployed worker remains **v19**; its
Microsoft source-code registration has not been deployed. Next are a pinned worker
release and hosted execution, then consent/identity provisioning, controller
coverage and authorized real-mailbox acceptance. Drummonds' Google/Commusoft/phone/
Slack and recovery dependencies remain open; this is not live Microsoft capture.
[TEST 078 and hosted API evidence](evidence/learn-microsoft-test-078-2026-10-12.json).

**12 October, 03:11 BST — Microsoft credentials and worker outcomes pass hosted full-schema rehearsal.**
All nine Microsoft migrations and five synthetic probes passed against current
TEST 077 in one rolled-back transaction. This joins the credential refresh and
retry/pause/recovery checks to the existing folder discovery, canonical email,
interaction and same-card update checks on the complete hosted schema. Wrong-app,
wrong-worker and ordinary-user credential access were denied. Pausing fresh work
did not consume a retry; a saved page still completed after pause and revocation.
All **140 existing dataset counts and hashes** and the original schema fingerprint
were unchanged afterwards. No Microsoft objects, tokens or fixtures remained;
no provider requests, new sessions, platform grants or production changes occurred.

This closes the full-schema rehearsal gate for these source versions. Persistent
TEST installation, hosted RPC/worker acceptance, consent/identity provisioning,
controller coverage and an authorized real-mailbox journey remain open. Microsoft
is still not presented as a working adapter; Drummonds' Google credential upload
approval remains a separate dependency.
[Hosted evidence](evidence/learn-microsoft-worker-hosted-2026-10-12.json).

**12 October — Microsoft worker retry/pause/recovery verified locally.**
Both Microsoft job types are now registered in source. The actual handler,
credential port, reader and isolated SQL prove retry-after delays followed by one
canonical email, pause without token/provider access or retry consumption, and
replacement completion of a retained page while capture is paused and the account
revoked. Stop receipts are private and immutable; late workers and stale claims
cannot overwrite a newer result. Unknown acknowledgements stay unconfirmed.
The generic worker consumes durable outcomes without a second queue mutation or
fresh health claims from historical evidence. Local verification comprises 76
focused email/Microsoft/control tests, 20 generic-worker tests, strict TypeScript
and the actual isolated PostgreSQL harness.

No hosted worker or schema was changed. The next integration gate is full-schema
TEST rehearsal of the new credential and worker-failure migrations, then hosted
RPC/worker acceptance. Consent/identity provisioning, controller coverage and
authorized real-mailbox testing remain; Microsoft is not shown as a working
adapter. Drummonds' applicable email source remains Google, with its existing
credential-destination approval unresolved.
[Worker evidence](evidence/learn-microsoft-worker-local-2026-10-12.json).

**12 October — Microsoft credential-to-email path verified locally.**
The new server credential RPCs enforce company, mailbox, client application,
current job/lease, enabled binding and capture permission. The refresh port saves
rotated tokens with an optimistic version check and revalidates authority before
using the committed credential. Actual isolated SQL/port/reader/settlement tests
proved paused/revoked denial, stale-update protection, lost-reply recovery and a
complete synthetic email reaching canonical email and interaction records.
All 66 Microsoft tests and strict worker/Microsoft TypeScript checks pass.

This is **local synthetic acceptance only**. No real credentials were created,
no hosted migration was installed and the prepared handler remains unregistered.
Next are lease-fenced failure/retry/pause settlement and worker integration, then
hosted acceptance, authenticated consent/identity provisioning and real-mailbox
verification. Drummonds' applicable mail source remains Google; no Microsoft
mailbox has been identified. The production capacity approval and inaccessible
1Password vault remain independent blockers.
[Credential evidence](evidence/learn-microsoft-credentials-local-2026-10-12.json) ·
[Implementation and remaining work](LEARN-MICROSOFT-MAIL.md).

**12 October, 02:29 BST — capacity evidence gathered; production resize awaiting approval.**
Post-recovery SQL showed 14 client sessions against a limit of 60, zero blocked
sessions and zero CLI sessions. One resource scrape showed 408 MiB total memory
and elevated 1/5/15-minute load averages. Two later scrapes failed with HTTP 500
with no export running; CPU/disk rates therefore remain unavailable. The retained
archive contains 18 active cron jobs with overlapping schedules, but expensive
execution and current scheduler configuration are not yet established.

The source organization is already Pro. A concrete proposal selects Small/2 GB
at the provider's US$0.0206/hour rate (about US$15/month for compute before credits
and tax), with a planned interruption and post-change preservation/capture checks.
It is awaiting Chris's approval; nothing has been resized, rescheduled or deleted.
Limited resources and overlapping workload are investigation leads, not a proven
root cause or promise that resizing will fix the stall. Further native exports
remain on hold pending a safe capacity/workload decision.
[Reviewable proposal](LEARN-DATABASE-CAPACITY.md) ·
[Read-only evidence](evidence/learn-database-capacity-2026-10-12.json).

**12 October, 02:21 BST — second native export stopped; source health recovered.**
A fresh read-only snapshot captured the two omitted pg_net tables (2,434 response
rows and an empty request queue), but its native dump emitted zero bytes while
Management SQL returned HTTP 544. The attempt was stopped and both local clients
removed. Auth was separately observed unhealthy. At 01:19 UTC SQL health passed,
the temporary credential was expired, grants were unchanged and no CLI sessions
remained; at 01:21 UTC Auth returned `ACTIVE_HEALTHY`. No production restart,
owner-password reset, application-data write or external upload occurred.

The original 196,872,981-byte archive is unchanged and its earlier verified
restore remains valid. **The later supplement is not a complete consistent
backup** and must not be presented as one combined snapshot with the older archive.
The revised complete-capture/restore path passes synthetic native/COPY and tamper
checks, but real acceptance remains open. Diagnose the source connection/service
health issue before another capture; do not automatically restart this run or
refresh credentials. Provider portal verification also remains unavailable: Arc
returned a blank page and 1Password has not exposed its vault list.
[Attempt, cleanup and recovery evidence](evidence/learn-complete-capture-attempt-2026-10-12.json).

**12 October, 02:05 BST — all archived database rows verified against a fresh offline restore.**
Native COPY comparison matched **1,591,576 rows in 299 tables and all five archived
sequence values**, including row contents and duplicates while allowing physical
row order to differ. The original archive SHA-256 was verified first. All 302
table definitions' owner/RLS flags and extension versions also matched; no-actor
reads returned zero emails/recordings and all 2,882 recording paths resolved.
The offline destination was removed. No production requests or external uploads
were made. Five parser tests and an actual synthetic archive/restore check passed;
deliberately altering a restored row was correctly rejected.

This closes archive-to-restored-row fidelity, **not source capture completeness or
full service recovery**. The original source hash scan remains incomplete and the
two omitted pg_net operational tables remain uncaptured. Vault decryption,
application/Auth restart, controlled capture resumption and durable independent
database backup operation remain open. The prior combined AWS audio sample stays
valid with its separate snapshot-time limits.
[Evidence](evidence/learn-native-archive-comparison-2026-10-12.json).

**12 October, 01:53 BST — restored database and independent recording backup reconciled.**
All 2,882 restored recording references match the AWS manifest by tenant, object ID,
path, size, version and recording ID; six unreferenced files remain retained.
One object downloaded through the existing read-only Restore identity matched its
SHA-256 and fully decoded to 66.96 seconds, with one restored call and transcript
relationship. Temporary audio and the offline database were removed. This used
the existing archive/AWS backup only: no production/provider requests, data writes
or new access. Five regression tests reject swapped files, changed versions,
foreign tenants, duplicate IDs and incomplete relationships.

This verifies a combined recovery sample, not atomic snapshots, fresh byte checks
of every file, human listening quality or signed-in application playback. All
recording durations in this database snapshot are null; they remain unknown rather
than being treated as zero. Full database comparison, the two omitted pg_net tables,
Vault decryption and operational service recovery remain open.
[Evidence](evidence/learn-combined-database-audio-restore-2026-10-12.json).

**12 October, 01:44 BST — real production database archive restored offline; full recovery acceptance remains open.**
A native 196,872,981-byte archive from a read-only production snapshot restored
successfully into the matching PostgreSQL 17.6.1.141 image. All 302 table definitions'
ownership/RLS flags and extension versions matched the captured inventory.
Restored data includes 18,598 emails, 4,328 calls, 2,882 recordings and 3,170 cards;
every recording path has matching restored Storage metadata. Without an
authenticated actor, email/recording readers returned zero rows. The target had
no network, mounts or published ports, zero worker slots and cron disabled; it
was removed after checks. Production health passed afterward, the temporary
credential expired and no CLI sessions remained.

**Limits:** the full source-fingerprint pass hit a statement timeout, so all-row
source/restore equality is unproven. This archive omitted two operational pg_net
tables. Future export code captures them through native COPY before slower checks,
but that improvement was not applied to this snapshot. Vault decryption, combined
database/audio recovery, application restart and durable independent database
backups remain open. No production promotion occurred.
[Evidence](evidence/learn-real-native-restore-2026-10-12.json).

**12 October, 01:19 BST — production recovery login verified without resetting the owner password.**
Read-only metadata showed an existing expired Supabase CLI role. A bounded refresh
of that same role enabled a fully verified TLS client connection and an explicit
read-only SQL transaction. Its grants stayed unchanged; no customer export,
application-data write, IP-ban removal or production release occurred. The check
also found that pooler startup settings were ignored and its upstream database
connection reported no TLS; these limits are retained in the recovery runbook.
The local client is removed, and the last temporary password expires at 01:24:19
BST. A real native export/isolated restore, Vault recovery and intact audio-record
relationships remain unproven. **Next recovery action: prepare the complete native
export and verify its transport/snapshot scope, rather than waiting solely for
the forgotten database password.**
[Evidence](evidence/learn-production-recovery-login-2026-10-12.json).

**12 October, 01:01 BST — private playback endpoint installed and boundaries verified in TEST.**
`receptionist-voicemail-recording` v1 is ACTIVE with JWT verification. It authenticates
the user, reads the exact message through caller RLS, records the access request,
then signs only that private audio object for 60 seconds. Oversized/malformed input,
foreign/missing messages, audit failure and unexpected signed destinations return no
link. All 140 datasets, the schema and unrelated endpoints were preserved. Both
installed modules match the pinned source; 25 local regressions, strict endpoint
types, full-project types and eight tests against downloaded code pass. Six hosted
HTTP checks deny missing/anonymous/forged/service sessions and verify method/CORS
handling. **Successful signed-in audio playback remains unproven**; no login,
mailbox grant, recording or provider request was created by this release. The
existing TEST frontend already calls this endpoint and was not redeployed.
[Evidence](evidence/learn-voicemail-playback-test-2026-10-12.json).

**12 October, 00:56 BST — historical inbox frontend deployed; playback endpoint gap confirmed.**
The matching frontend from `7fae7468581655192a9a2f13846fe52103cc53a6` is READY
in TEST; its immutable and stable hostnames remain Vercel protected. The installed
reader denies anonymous/service HTTP calls and preserves all 140 datasets.
Read-only TEST Edge inventory confirms `learn-voicemail-import` v2 but no
`receptionist-voicemail-recording` endpoint. Next: deploy and verify the private
playback handler, then complete positive signed-in acceptance under authorised
mailbox access. Actual playback is not yet available in this TEST build.
[Evidence](evidence/learn-voicemail-inbox-history-2026-10-12.json).

**12 October, 00:54 BST — historical private-message discovery installed in TEST (077).**
An actual SQL regression showed that previous owners could read their retained
messages under RLS but could not find them through the current-mailbox summary.
The new SECURITY INVOKER reader paginates already-visible mailbox/message groups.
Historical-only groups contain no current notification address, extension, name or
sync settings. The new owner still sees only their messages; an ordinary company
owner has no mailbox bypass. Manager grant/revocation and foreign-tenant denial
passed in the actual TEST schema. Both rehearsal and installation preserved all
140 datasets; all banned/passwordless probe fixtures rolled back, with no sessions
or persistent access created. Local UI checks cover 20+3 mailbox pagination and
historical message detail; 18 regressions, full TypeScript and build pass. Matching
frontend deployment and actual signed-in playback remain separate gates.
[Evidence](evidence/learn-voicemail-inbox-history-2026-10-12.json).

**12 October, 00:47 BST — private inbox entry deployed to protected TEST.**
Deployment `dpl_3axjgqPF1VNeXaRWzGANk7cvMzja` is READY from
`de4bcd98dba0c70d87069ff9b554130d79b7f7b3`; the stable TEST alias points to it.
Both hostnames' homepage, login and LEARN routes require Vercel authentication.
The backend and private mailbox permissions did not change. This supersedes only
the frontend deployment status below, not its outstanding provider/playback and
signed-in acceptance limits. [Deployment evidence](evidence/learn-voicemail-inbox-test-2026-10-12.json).

**12 October, 00:46 BST — LEARN private voicemail entry and reader verified locally.**
LEARN now opens the existing owner/manager inbox directly, without copying private
messages into shared customer cards or scoring. The reader rejects unavailable
summaries, unknown counts, truncated pages and company/mailbox mismatches. Account
or company changes discard selection/details/playback state; unused private query
data is removed from the query cache. The actual dialog was exercised locally with
synthetic responses: paging, details, recording failure, mailbox failure, missing
count and a delayed response after account switching all behaved as expected, with
no browser console errors. Fifteen tests, full-project TypeScript and build passed.
This is frontend/local evidence only; hosted signed-in playback, provider capture,
historical mailbox ownership and private customer-context linkage remain open.
[Evidence](evidence/learn-voicemail-inbox-local-2026-10-12.json).

**11 October, 23:39 UTC (12 October, 00:39 BST) — matching voicemail controller frontend deployed to protected TEST.**
Vercel deployment `dpl_HguNFttZTsfCoj6ZzHtpCqf9knNM` is READY from Git commit
`89c44585824c2effc06a485be608f7cc13db7fbd`. The stable TEST alias points to this
deployment. Homepage, login and LEARN paths on both hostnames redirect to Vercel
authentication. Full-project TypeScript exits successfully. This closes the
frontend-deployment gap in the earlier entry below; it does **not** prove signed-in
acceptance or real scheduled voicemail capture. No production change was made.
[Frontend deployment evidence](evidence/learn-voicemail-frontend-test-2026-10-12.json).

**11 October, 23:29 UTC (12 October, 00:29 BST) — bounded voicemail dispatch and operator status backend verified in TEST.**
Release 076 installed after full-schema rollback rehearsal, preserving all 139 prior
datasets. Worker v19 and importer v2 then deployed with all 140 datasets and other
endpoints preserved; both installed sources match the pinned bundle. Ten hosted
HTTP/RPC checks pass, including idle no-write discovery and denied unauthorised access.
The dispatcher advances at most two routes/five pages each per UTC minute and uses
saved receipts, route backoff and existing capture gates. **No TEST cron or real
routes were activated.** Draft rejection is now in both hosted import paths.

OpenFolk's voicemail status component is built and browser-checked **locally with
synthetic responses**, showing notifications, source review, drafts, import states,
worker scan timestamps and recovery guidance. Actual offline SQL verifies the existing
OpenFolk view grant, expired/View-As denials, pagination and zero private-message
access for an operator without ownership/manager rights. Fourteen regressions,
strict worker/UI types and the frontend build pass. **Matching frontend deployment,
positive hosted scheduled imports and signed-in acceptance are still outstanding.**
[Evidence](evidence/learn-voicemail-dispatch-2026-10-12.json).


**11 October, 23:08 UTC (12 October, 00:08 BST) — retained voicemail discovery installed in TEST.**
Release 075 passed a full-schema rollback rehearsal, then installed empty private
scan/candidate/receipt tables and internal RPCs with all 136 prior datasets preserved.
Local PostgreSQL checks cover bounded enumeration, lost replies, legacy-binding
review, draft exclusion, late inserts, corrected metadata, route ambiguity and
atomic enqueue/progress. A discovered synthetic email also completes the existing
queue → Workspace bridge → actual signature/MP3 decode → private publication journey,
including lost publication acknowledgement and provider-free replay. Twenty-seven
Node regressions and strict worker types pass. **No hosted discovery dispatch,
schedule or real capture was activated.** The new draft rejection is local runtime
code; hosted worker remains v18. Next: scheduling/controller integration, positive
hosted discovery, verified real routes, signed-in acceptance and recovery. Retained
scan completion never claims provider coverage. [Evidence](evidence/learn-voicemail-discovery-2026-10-12.json).


**22:52 UTC — synthetic voicemail queue import verified against hosted TEST.**
The production queue adapter/coordinator and real signature/MP3 decoder ran locally
against hosted TEST SQL and private Storage. One generated voicemail published with
one settlement receipt and two exact-hash files. Deliberately losing the publication
reply recovered success; replay after retirement loaded no source again. A foreign
tenant claim was rejected before loading, and anonymous/public/unentitled SQL-role
access was denied. All 136 prior datasets were preserved using exact test-row/object
exclusions. No login or owner/manager access was created; the fixture tenant is
archived, its route off and email-account metadata disabled. **This does not prove
real Gmail/Birchills capture, deployed-worker positive dispatch or signed-in playback.**
Enumeration/coverage, real route authority, credentials and backup acceptance remain.
[Evidence](evidence/learn-voicemail-queue-import-2026-10-11.json).

**22:45 UTC — voicemail queue installed in hosted TEST; boundaries verified.**
Release 074 passed rollback rehearsal and installed with all 134 prior datasets
preserved. Platform worker v18 deployed with 136 datasets and other endpoints
preserved; downloaded source matches 101 emitted modules/159 imports. Six HTTP/RPC
checks pass through the existing exact internal-header path: unauthorized callers
are denied, the empty voicemail worker claims zero jobs, empty recovery changes
nothing and a missing claim is rejected. A bearer-only request returned 403 and is
recorded separately; auth rules were not changed. No jobs, routes, users, credentials
or provider capture were added. **Positive hosted voicemail import remains unproven**;
next is a synthetic SQL/Storage queue journey before real-route activation. [Evidence](evidence/learn-voicemail-queue-hosted-2026-10-11.json).

**22:35 UTC — durable voicemail queue prepared and verified locally.** The existing
platform worker now has a one-message voicemail path with frozen source binding,
lease checks and atomic voicemail publication/job settlement. Thirteen actual
PostgreSQL/coordinator scenarios pass, including lost replies, simultaneous delivery,
partial uploads, changed payloads, pause/resume and dead workers. Five reclaim
regressions, 28 existing regressions, strict worker types and queued/direct offline
Edge checks pass. Queue recovery never presents an old receipt as fresh coverage.
This change is **not installed in TEST or production**; TEST remains at 073 and
platform worker v17. Full-schema/hosted release acceptance, enumeration/coverage,
verified routes and real-user acceptance remain. [Evidence](evidence/learn-voicemail-queue-local-2026-10-11.json).

**22:20 UTC — voicemail foundation/runtime/storage verified in hosted TEST.**
Release 073 installed empty private tables after rollback rehearsal, preserving 127
existing datasets. The internal endpoint v1 deployed with 134 datasets and all other
endpoints preserved. Hosted checks deny unauthenticated/anonymous intake, malformed
internal calls and unknown routes; source readback matches 19 emitted modules and
23 imports. Two synthetic files (generated MP3 plus signed email) round-trip through
private hosted Storage with exact hashes and anonymous/public denial. They are retained
as marked TEST evidence, with no tenant/mailbox/route/voicemail row. No provider request,
credential upload, user access grant, schedule or production change occurred. Integrated
publication, real mailbox ownership/provider acceptance, queue/discovery/coverage,
backup and signed-in journeys remain required. [Evidence](evidence/learn-voicemail-hosted-test-2026-10-11.json)
and [release/rollback scope](LEARN-VOICEMAIL-DISCOVERY.md).

**22:09 UTC — voicemail provider bridge and internal endpoint prepared, local only.**
The importer now reuses the existing Workspace credential checks, verifies Gmail
profile identity and loads one bounded original message after route/capture admission.
The internal HTTP handler rejects user/forged tokens before any credential or provider
work. Its safe result states distinguish missing delegation, denied access, unavailable
source and unconfirmed publication. Twenty-eight regressions, strict worker types and
an actual offline Edge worker check pass; the latter uses controlled Gmail/storage
transports and a synthetic signed recording. No hosted deployment, queue registration,
schedule, real route, credential or production change occurred. TEST foundation/intake
installation, actual hosted Storage, durable queue/discovery/coverage and real-owner
acceptance remain outstanding. [Evidence](evidence/learn-voicemail-workspace-bridge-2026-10-11.json)
and [integration scope](LEARN-VOICEMAIL-DISCOVERY.md).

**22:01 UTC — voicemail runtime integration, local evidence only.** Shared server
code now handles signed source verification, MIME extraction, MP3 decoding and
private import coordination in both Node and Supabase Edge Runtime. An actual
offline Edge user worker passed a generated 28-second recording through the full
coordinator with controlled storage transport, including real WebAssembly decode,
tamper rejection and hash readbacks under a 2-second hard CPU limit. Explicit
Buffer imports fix the deployment incompatibility the check found. Seven Node
regressions and actual PostgreSQL intake/failure tests still pass. No hosted or
production change was made. Authenticated worker/provider wiring, hosted Storage,
route ownership, coverage, backup and signed-in acceptance remain required.
[Evidence](evidence/learn-voicemail-edge-runtime-2026-10-11.json) and
[scope/next step](LEARN-VOICEMAIL-DISCOVERY.md).

Latest scoped production observation: **11 October 2026, 14:33 UTC**.
[Read-only capture inventory](evidence/learn-current-capture-2026-10-11.json)
shows **18,548 emails, 4,328 calls, 2,882 recording rows, 3,165 cards and zero
canonical jobs**. Compared with the morning counts, email inventory grew by 37
and card inventory by five. This is not an identity-preservation comparison.
Among the newest 200 email runs, Workspace capture includes 138 successful and
14 failed runs, with latest success at 14:33 UTC and latest failure at 14:31 UTC;
other run types account for the remaining observations. The newest 200 Phone runs
are successful call/recording/scheduler receipts through 14:30 UTC. These bounded
samples do not prove provider coverage or resolve the known mailbox failures.
The observation issued no provider requests and made no production writes.

Earlier combined production/TEST audit: **11 October 2026, 06:07 UTC**.
[Sanitized baseline](evidence/learn-launch-baseline-2026-10-11.json), reproduced with
`node scripts/verify/learn-launch-baseline.mjs --read-only-production-and-test`.
This reads aggregate source counts and configuration/catalog metadata, never
message bodies, audio, provider credentials or source paths. It changes nothing.

- Production retained inventory: 18,511 emails, 4,328 calls, 2,882 recording rows,
  3,160 customer cards, zero canonical jobs. Counts alone are not preservation or
  provider coverage; retain the separate source-ID comparison before releases.
- All 30 production email accounts are Gmail: 29 Workspace DWD accounts, one
  revoked OAuth account. Two Workspace connections are active; recent Workspace
  capture runs report both success and failure. Account auth_state `unknown` is
  not itself a DWD credential failure. Last success is not complete coverage.
- Workspace inventory contains 30 active users, 12 pending users and one pending
  suspended mailbox, all marked sync enabled. Reconcile eligibility per mailbox;
  do not silently count pending/suspended users as captured.
- The revoked OAuth account remains eligible for the old scheduler by status.
  Production has 4,485 dead-letter OAuth jobs and a queued OAuth job. Their
  aggregate presence does not establish every failure's cause. Local scheduler
  now skips auth states outside `ok`/`unknown` and records skipped counts in the
  scheduler heartbeat. Three actual-handler regression tests pass; not deployed.
- Recording storage metadata totals **601,004,261 bytes** across 2,888 objects;
  all objects have known metadata sizes. Objects created in the last 30 days
  total 312,897,776 bytes; backfills may be included, so this is not a growth forecast.
- At the 06:07 audit, TEST ledger ended with correction recovery release 053. Gmail
  endpoints v4, platform worker v5, Slack worker v8, Commusoft workers v4 and Phone
  sync workers v6 are ACTIVE. Deployment status is not positive capture acceptance.
  Microsoft journal tables are absent in TEST; that connector remains local only.

**Next delivery order:** verify Drummonds' Google capture/authority and scheduling;
finish the bounded Commusoft import and customer/job publication after required
access approval; prove a signed-in customer/card journey; then close Phone,
voicemail, Slack, scoring and operational acceptance. Microsoft stays in scope
as a reusable connector; no Microsoft mailbox has been identified for Drummonds.

### Voicemail route discovered — real read-only checks, 11 October, 21:06 UTC

**Coordinator update, 21:47 UTC:** local code now connects verified raw extraction
to decode, intake, immutable uploads, byte-hash readback and publication. Twelve
orchestration cases passed against actual offline PostgreSQL with controlled
storage faults; the portable decoder separately decoded the real signed sample
to 28.512 seconds without native tools or files. Hosted Storage/runtime acceptance,
verified routes, installation, scheduling/coverage, backup coverage and signed-in
acceptance remain. [Coordinator evidence](evidence/learn-voicemail-import-coordinator-2026-10-11.json).

**Private intake update, 21:40 UTC:** the new service-only preparation/publication
contract passed actual offline PostgreSQL privacy, retry, concurrency, pause,
conflict and atomic-failure tests. The hosted TEST rehearsal needed the existing
private-voicemail foundation, absent in TEST 072; both migrations then rehearsed
and rolled back with all 124 existing datasets and schema preserved. No users or
routes were seeded. The worker's upload/readback integration, route verification,
installation, scheduling, coverage and signed-in acceptance are still unfinished.
[Private-intake evidence](evidence/learn-voicemail-private-intake-2026-10-11.json).

**Signed extraction update, 21:29 UTC:** the locally verified original message
now supplies the parser's text and audio directly. Its signed recipient matches
the Gmail account, and the extracted audio hash matches the earlier complete
decode. Six local verification/extraction tests pass. Private-mailbox binding,
historical ownership, durable ingestion and deployed acceptance remain required;
no production records changed. [Signed extraction evidence](evidence/learn-voicemail-signed-extraction-2026-10-11.json).

**Signature update, 21:23 UTC:** one original Gmail notification's complete-body
signature verified locally against the observed provider signing domain. Changed
subject/body and duplicate From checks were rejected. Two reads of the same
message were used after fixing a local verifier integration error; raw content
was not persisted. This establishes a cryptographic route, not a deployed sender
verifier or an authorised mailbox/owner binding. Extracting and importing the
verified raw content still needs implementation.
[Signature evidence](evidence/learn-voicemail-dkim-2026-10-11.json).

**Local implementation update, 21:18 UTC:** the notification parser and bounded
MP3 metadata selector passed six local checks, strict types and all three real
Gmail metadata samples against retained source text. The stored mailbox bindings
have explicit managers but no current owner, and do not establish historical
ownership or the notification recipient. No importer was deployed or activated.
[Parser evidence](evidence/learn-voicemail-email-parser-2026-10-11.json).

A broader audit found 77 retained Birchills-domain “New message” notification
candidates with voicemail body and attachment hints. The previous voicemail-only
subject search missed that format. Three direct Gmail metadata reads verified
consistent mailbox/transcription/system-reference structure and MP3 attachment
references. One 57,285-byte attachment fully decoded locally to 28.512 seconds of
mono audio; temporary files were removed. No production data or access changed.

This provides an observed email route for implementation. Sender authentication,
mailbox/owner binding, idempotent private import, coverage, scheduling and signed-in
acceptance remain required. The production audit still found zero imported
voicemails; neither these samples nor their authentication-header hints prove a
live connector. [Evidence and next implementation step](LEARN-VOICEMAIL-DISCOVERY.md).

### Operator email availability — TEST 072, 11 October, 20:55 UTC

The operator health reader now returns company-wide retained-email counts:
available and unavailable at the last recorded observation, unverified
availability, unverified mailbox binding, and earlier source versions. Older or
malformed observations stay unverified. The account page limit does not truncate
these totals. Source contents and provider identifiers remain private; existing
platform authority and function permissions are unchanged.

The installed TEST function and aggregate were verified against retained synthetic
history; all 124 pre-existing datasets were preserved. Eleven client checks,
actual isolated SQL authority/tenant/pagination checks, TypeScript and the frontend
build passed. The protected frontend is deployed from Git `59077dafbe1419853d971baa92aa73ec0078e549`,
READY at 20:57 UTC. Anonymous and service-role HTTP requests correctly receive
401/403 access denials. Positive operator HTTP and signed-in acceptance remain pending. No actual provider requests or production changes occurred.
[Retention status evidence](evidence/learn-email-retention-health-2026-10-11.json).

### Gmail ongoing state changes — TEST 071, 11 October, 20:50 UTC

The TEST capture worker handles Gmail label additions/removals and provider
absence, as well as new messages. New continuation v4 generations reconcile the
current mailbox and then refetch touched messages; in-flight v2/v3 tokens retain
their original query. Prior source versions are archived privately before updates.
Confirmed 404/410 observations retain the captured content and source identity;
newer history wins, unknown storage acknowledgement leaves the old cursor, and
cross-mailbox source collisions stop for review.

**Verified:** 21 reader/store checks; 73 actual-engine/SQL checks; strict local
worker types; full hosted TEST-schema rollback rehearsal including a draft-to-sent
change through source publication to a customer card. All 121 preservation datasets,
schema and existing authority were restored. No actual provider calls occurred.
**Now installed in TEST:** release **071**, worker **v17**, card refresh v2 and
Workspace discovery v3. The compatible worker was installed before schema v4
activation. All 92 emitted runtime modules matched reviewed source and all 21
reader/store tests passed against the downloaded runtime. Installation preserved
all 123 pre-existing datasets; the new private source archive brings the inventory
to 124. No existing provider connection was activated.

A bounded hosted HTTP check passed all 12 storage/protocol calls: unsigned and
foreign-context denial, retained draft source history, repeated absence
idempotency, restoration by newer sent content, stale-absence rejection, durable
cursor and atomic job completion. All 124 pre-existing datasets and the schema
were preserved. Its synthetic tenant is archived, account disabled and jobs
retired; no Auth users, grants or provider calls were created.

**Still open:** real Gmail/Edge capture acceptance, signed-in customer review,
signed-in availability presentation and unavailable legacy-message reconciliation.
The archive is included in release preservation and database recovery procedures;
actual database restore remains blocked on recovery credentials.
[Deployment and acceptance evidence](evidence/learn-email-mailbox-changes-2026-10-11.json).

### Credential discovery and phone portal — 11 October

After Chris unlocked 1Password, the existing Birchills portal login and Supabase
dashboard login were located in the Allkin account. No database credential was
identified in the inspected Supabase item; a `postgres` search returned no matches.
This is a focused search, not proof that no database password exists anywhere.

The Birchills portal's existing signed-in Drummonds session exposes three shared
mailbox definitions and the call-recording report. No credentials were copied,
provider settings changed or audio downloaded. Portal access does not establish
API authentication, mailbox ownership for staff access, voicemail message/audio
API support or complete capture coverage. Those checks remain required.

### Current protected TEST frontend — 11 October, 20:57 UTC

The stable entry is [serviceos-learn-test-allkin.vercel.app](https://serviceos-learn-test-allkin.vercel.app).
It resolves to READY deployment `dpl_CrDen3D6UrzuykQgSnKZdg7ayxBg`, built from
Git SHA `59077dafbe1419853d971baa92aa73ec0078e549`. The immutable preview is
`serviceos-learn-test-lz3vdjsah-allkin.vercel.app`. Both are Vercel protected; their
home, login and LEARN routes redirect to Vercel authentication. The preview-only
backend remains TEST `saatxzwxvdvqevbnskxy`, paired with release 072/worker v17/card
refresh v2. The frontend includes the draft advice and bounded-evidence explanation.

TEST Auth uses the stable exact `/login?reset=1` recovery target, preserving the
previous exact recovery URLs and every other setting. This does not reactivate
Chris's disabled TEST account or send a reset email. The prepared ongoing owner
access request and browser acceptance remain pending. No production change occurred.
[Latest frontend evidence](evidence/learn-email-retention-health-2026-10-11.json);
[earlier Auth configuration evidence](evidence/learn-card-frontend-test-2026-10-11.json).

### Remaining launch work — 11 October, 20:17 UTC

| Requirement | Evidence now | What still closes the gate |
|---|---|---|
| Google and Commusoft input coverage | TEST runtime and retained-source pipelines verified; existing real capture/import history retained | Approve the prepared Google credential destination and bounded Commusoft continuation; finish real historical/incremental coverage and reconciliation |
| Phone, voicemail and Slack | Phone source pipeline/playback tested; real recording inventory backed up; Slack adapter exists | Recover authorised provider credentials, verify real Phone processing, implement the observed voicemail email route with verified sender/owner binding, connect authorised Slack workspace/channels |
| Customer cards and scoring | Hosted synthetic source-to-card refresh and isolation pass; configurable scoring and review are implemented | Signed-in Drummonds review, reliable staff/job evidence, calendar/criteria approval and legacy derived-data reconciliation |
| OpenFolk controller | Scoped controls, diagnostics and recovery tested locally/TEST | Approve ongoing TEST owner access; verify real signed-in operation and customer branding |
| Recovery and recurring operation | Recorded audio inventory and independent restore verified | Real database restore with record links, confirmed scheduled runs and durable operational ownership |
| Release | Git backups and staged TEST backend and matching protected frontend deployed | All above acceptance, development dependency review, concrete production approval, deployment and live monitoring |

The frontend release checks passed (`npm install`, `npx tsc --noEmit`, `npm run build`).
Compatible transitive dependency updates reduce the production-dependency audit
from five findings to zero. The full audit drops from 15 to nine findings, all in
development tooling. This is not a complete security assessment; the remaining
build-tool chain still needs review. The pinned Lovable configuration stays at
2.6.4 and its packages remain installed. TypeScript/build passed again after updates.
[Dependency evidence](evidence/learn-dependency-patch-audit-2026-10-11.json).

The existing stable TEST alias `serviceos-learn-test-allkin.vercel.app` was verified
to point to the READY TEST deployment and preserve Vercel protection on home/login/
LEARN routes. TEST recovery now points to its exact `/login?reset=1` path; previous
exact recovery URLs remain allowed. All other Auth settings are unchanged. No
account, grant, password or email was created or changed. Browser/sign-in acceptance
and the existing owner-access decision remain pending.

### Existing draft influence and card refresh — TEST 070, 11 October, 20:11 UTC

The read-only production impact audit at **19:57 UTC** found 55 enriched draft
interactions, 54 linked to people, four directly linked recommendations and 95
match suggestions. Person/company associations reach 178 cards; this is a broad
review scope, **not 178 proven incorrect cards**. None had an exact draft-summary
or latest-timestamp match, none had locked fields, and their priority inputs were
legacy/unversioned. The three production measurements had no exact draft UUID
references; that does not prove absence of historical influence. No saved assessment
table was present in this audit's production metadata. Source bodies, identities,
card text and score values were not returned. Initial aggregate scans timed out;
the completed bounded audit uses direct recommendation/suggestion links.
[Aggregate evidence](evidence/learn-email-draft-impact-2026-10-11.json).

The separate card-refresh handler still read all canonical interactions, so it
could reintroduce retained drafts into card activity, response timings and timelines
after TEST 069's publication fix. TEST 070 now uses one tenant/card-bound
SQL input read, filters drafts before the recent windows, excludes directly linked
draft recommendations without deleting them, and reports full eligible counts.
Recent response timing remains a bounded communication estimate, not a staff score.
An unlocked stale latest-activity value can become null; locked/manual fields and
context remain. Compare-and-set writes reject concurrent card edits or missing rows.

The actual SQL/handler/calculator/saved-card journey passes with 110 drafts, 105 valid
interactions and 51 valid recommendations. Twelve handler/snapshot tests, strict
worker types and the local frontend build pass. The full hosted TEST rollback
rehearsal preserved all 121 datasets and removed its synthetic fixtures. The exact
package was then installed, followed by `platform-worker` v16 and `customer-card-sync`
v2. Downloaded source matched reviewed runtime (92 and 6 modules respectively), and
nine actual-handler tests passed against each download. Unsigned calls returned
403/401. No other endpoint or source changed during deployment.

The positive hosted **service-to-service** check then passed: tenant mismatch 403,
cross-tenant card lookup empty, and one synthetic card refreshed over HTTP with
110 drafts excluded and 105 valid interactions retained. Job completion and saved
projection evidence were checked. All 123 pre-existing datasets (adding explicit
recommendation and match-suggestion tracking) were preserved. Two successful-run
synthetic tenants were archived, with no users, grants, provider calls or live jobs.
An earlier harness attempt omitted the existing internal header; its fixtures were
also archived. A second attempt rolled back on a synthetic-slug collision; the final
run used unique slugs and the digest-verified existing key, with no credential changes.
This is not signed-in acceptance. Frontend explanatory copy is deployed in the
20:19 TEST release below; browser acceptance remains pending. Legacy
priorities, indirect recommendations and reviewed identity suggestions still need
explicit reconciliation rather than blanket deletion.
[Verified evidence and release sequence](evidence/learn-card-draft-projection-2026-10-11.json).

### Drafts retained without being treated as replies — TEST 069, 11 October, 19:51 UTC

A read-only production metadata check found **55 Gmail draft messages, all with
canonical interactions**. This is not evidence of 55 incorrect staff scores; it
identifies source records that must not be treated as sent replies. Production
remains unchanged. Google's documented send flow replaces a draft with a new sent
message ID, so both source records may legitimately be retained.

TEST 069 preserves draft bodies/labels, gives new drafts no sent timestamp or
outbound direction, and excludes drafts from customer communication publication,
identity/card delivery, restricted card excerpts and new activity counts. Existing
source/canonical records and receipts are retained. Direct publication and operator
attribution cannot bypass the source classification; known retained drafts do not
count as actionable processing failures. Source revisions include the classification
so a later correction is reassessed instead of remaining behind a stale hold.

The actual parser/handler/durable-queue/card journey passes locally, including
reply-loss recovery, legacy draft rejection, restricted reader access, unchanged
source bodies and correction recovery. Fourteen Gmail-reader and fifteen review-client
regressions pass, alongside 65 actual email-engine/durable SQL checks. The page
store accepts unknown direction only for a labelled draft with no sent timestamp.
The full TEST schema rehearsal rolled back with all 121 datasets
and original permissions restored. The exact package was then installed with
all 121 datasets preserved. Worker v15 was deployed and downloaded: all 92 runtime
modules matched reviewed source, 145 emitted imports were checked, and the three
pruned dependencies have no emitted runtime importers. All 14 reader tests passed
against the download; unsigned POST returned 403. No capture, provider calls,
credentials, users or production changes occurred. Frontend explanatory copy is
deployed to protected TEST at 20:19, with signed-in acceptance pending. Production card
summary/aggregate reconciliation remains a required release gate; current label
changes, Spam eligibility and real-provider acceptance are still unfinished.
[Evidence](evidence/learn-email-draft-eligibility-2026-10-11.json).

### Mailbox-wide Gmail capture — installed in TEST, 11 October, 19:24 UTC

The recent Gmail reader previously filtered both reconciliation and incremental
history by Inbox/Sent. That could omit automatically archived/filed communications.
Continuation v3 now uses one unfiltered mailbox traversal, explicitly includes
Spam/Trash during listing, and retains their source labels. New protocol accounts
and completed v2 generations must first reconcile; an old label-limited cursor
cannot establish mailbox-wide coverage. In-flight v2 pages and their receipts are
not rewritten. Historical backfill retains its original pagination scope; the new
recent reconciliation fills its gaps. Incremental capture covers message additions;
this is not a deletion/label-state mirror or recovery of already purged provider data.

All 64 actual-engine/durable-SQL checks and 13 page-reader checks passed locally,
plus the strict installed-SDK TypeScript check. The exact 068 package passed a
full-schema TEST rollback rehearsal, preserving all 121 existing datasets. The
existing migration administrator needed transaction-only inheritance of the
protocol-owner role to replace its function; that temporary membership was removed
before assertions, with original role memberships, function owners and ACLs verified
identical. No application access was created. Package SHA-256:
`ccb31394a7e482321c5a3c72dc78604692c57f5d5371617301881c763b1f4c10`.

TEST release **068** is installed with **worker v14**, preserving all 121 datasets.
Downloaded runtime comparison matched all 92 runtime modules; three pruned modules
have no emitted runtime importers. The downloaded Gmail reader passes the same 13
checks, and an unsigned worker POST returns 403 without processing a job. Original
memberships, function owners and ACLs match after installation. Real-provider
Google acceptance remains blocked by the pending credential-destination approval.
No production change or claim of complete real mailbox coverage is made.
[Evidence](evidence/learn-email-mailbox-coverage-test-2026-10-11.json).

Source retention and score eligibility are separate acceptance requirements:
draft/spam messages must not silently become staff performance evidence. Current
label/deletion mirroring and representative score acceptance remain unfinished.

### Matching TEST frontend deployed — 11 October, 18:26 UTC

The protected TEST frontend is now READY from GitHub `1af32a4` at
[the updated preview](https://serviceos-learn-test-g7nlyfdcg-allkin.vercel.app).
It brings the recent recovery, freshness, operator review and manual queue UI
changes onto the same hosted candidate as backend release 066 / worker v12.
Previous sections describing these changes as local/Git only are historical.
Exact project, source commit, TEST backend binding and Vercel route protection
were verified; no production change was made.

The default TEST password-recovery URL points to this new frontend's reset form,
with the previous exact URL retained in the allowlist. All other Auth settings
matched after the update. No account was reactivated and no email was sent.
New-origin browser permission and the existing TEST owner-access approval remain
pending. Positive signed-in acceptance, real-provider coverage and unattended
operation are still required. [Evidence](evidence/learn-processing-frontend-test-2026-10-11.json).

### Production Phone metadata rechecked — 11 October, 18:32 UTC

All 2,882 retained recording URIs pass the actual exact-account URL guard against
Drummonds' sole active registered account; all have storage pointers. The two
registry/recording metadata fingerprints match. This expands the previous 25-row
compatibility sample to the full observed inventory, without downloading audio
or contacting the provider. Production has 4,328 calls and 2,876 completed / six
failed transcripts. The latest 200 Phone sync runs report success through 18:30 UTC;
coverage and the six failures still need real-provider/processing acceptance.

Both required Phone credential names are present in production and absent in TEST.
The password manager is locked; an unlock request is pending so existing values
can be located without extracting production runtime secrets. No credentials,
sources or settings changed. [Evidence](evidence/learn-phone-retained-readiness-2026-10-11.json).

### Microsoft source-to-card rehearsal — 11 October, 18:36 UTC

The six Microsoft capture/projection migrations passed a rolled-back rehearsal
against the current TEST release 066. Its real card publisher and durable queue
settlement created one card from a synthetic Microsoft message, then refreshed
the same card from a later version without changing its person identity. Original
source pages, exact replay and event consumption were verified. All 121 existing
datasets and the original schema matched after rollback; no Microsoft objects,
fixtures, users, grants, credentials or provider requests were retained. All 58
adapter checks pass.

This proves synthetic source-to-card compatibility, not a connected Microsoft
mailbox. Token/account setup, persistent release, worker registration, recurring
folder discovery, expired-delta recovery and real-provider acceptance remain open.
[Evidence](evidence/learn-microsoft-card-rehearsal-2026-10-11.json).

### Microsoft repeat discovery — 11 October, 18:46 UTC

Repeat folder discovery now records each finished scan and queues another after
15 minutes, preserving original source pages and dispatch identities. A later
scan finds an added folder without creating duplicate message jobs for known
folders. Disabled or revoked inputs stop before token access. Local actual-engine
checks prove exact replay and atomic rollback of a failed reset/settlement; all
59 adapter checks and strict TypeScript pass.

A full-schema TEST rehearsal ran two scans plus the existing source-to-card
journey, then rolled everything back. All 121 datasets and the original catalog
matched. No users, grants, credentials, schedules, provider requests or production
changes were made. This supersedes recurring discovery as a missing implementation
in the earlier 18:36 entry. Microsoft still needs credentials/account setup,
worker/operator integration, expired-delta/deleted-folder recovery, persistent
release and real-provider acceptance; no Drummonds Microsoft mailbox is identified.
[Evidence](evidence/learn-microsoft-discovery-2026-10-11.json).

### Existing Workspace key located — 11 October, 15:21 UTC

A scoped local-file check found `ServiceOS Workspace Connector.json` in the
owner's Downloads folder. Its service-account email and client ID exactly match
one active production Drummonds Workspace connection. The existing signer then
obtained one `gmail.readonly` delegated token for that connection's configured
impersonation subject; one Gmail profile request confirmed the same mailbox.
No messages, directory records or credential values were output. Production was
read-only and no new Google key or permission was created. This resolves the
credential-location blocker, not full mailbox or capture acceptance.

TEST preflight found zero active Workspace connections, zero DWD accounts and
none of the three `GOOGLE_WORKSPACE_*` secrets. A concrete proposal to copy the
existing key to those secrets is prepared, with an original 113-dataset baseline
and secret digests. **Not applied:** automatic approval review rejected that
upload because the general credential-reuse goal did not specifically authorize
sending this private key to TEST Supabase. Chris has been asked for that exact
destination approval. Do not retry through another transport or extract a
production runtime secret. The key has not been stored in 1Password by this run.
After approval, verify the existing secret values by digest, preserve all other
secrets and data, and keep mailbox/schedule activation separate from provisioning.
[Credential verification evidence](evidence/learn-workspace-existing-key-2026-10-11.json).

At 15:28 UTC, bounded follow-up checks confirmed that the four previously failing
mailbox subjects still return `delegation_grant_invalid`; the same key already
succeeded for the configured admin mailbox. Google Directory `users.get` returned
HTTP 404 for all four addresses using the existing Directory read-only grant.
Stored mailbox rows still say `user`, `active`, `sync_enabled=true`. This supports
stale/unresolved directory identity; it does not establish deletion, renaming or
the exact cause. No settings were changed and no message content was read.

### Workspace alias capture identity — 11 October, 19:05 UTC

The real alias profile findings exposed a second acceptance gap: Gmail returns
the primary address for a valid alias, while the V1 capture engine required that
profile to equal the configured alias string. TEST release **067**, worker **v13**
and directory discovery **v3** now support an explicit directory-verified primary
identity for an existing alias. The original account ID, email address, source
namespace and retained messages stay unchanged. Missing, foreign-domain, disputed
or changed bindings fail before token access; an unrelated Gmail profile remains
rejected. OAuth and primary-account exact matching remain in place.

Directory refresh binds an unverified row only to the actual returned primary.
A database guard preserves its first owner and latches a conflict if later or
concurrent refreshes disagree. Ordinary refreshes cannot clear that hold or move
the binding across tenants/connections/addresses. This is not an identity merge;
operator recovery for a changed owner still needs an explicit reviewed workflow.

Both the standalone migration and exact package passed full-schema rollback
rehearsals before installation. All **121 datasets** retained their original
fields; new columns remain null/false for existing rows, with no inferred binding.
The actual engine/SQL suite passed 58 checks, including alias-profile capture and
wrong-profile refusal. All 23 port/directory checks passed locally and against
downloaded deployed modules. Runtime comparison matched 92 worker modules and
four directory modules; three omitted files have no emitted runtime imports.
Strict endpoint/worker types and HTTP 403/401 boundary checks pass.

No credential, user, grant, capture schedule or production change was made. The
existing protected frontend is unchanged. Positive hosted directory refresh,
real alias-to-card capture and signed-in acceptance still await their existing
access/credential approvals. [Evidence](evidence/learn-workspace-profile-identity-test-2026-10-11.json).

### Real Workspace directory and aliases — 11 October, 18:49–18:54 UTC

The existing local credential completed a bounded, read-only scan of its matched
Drummonds domain using the actual directory reader. Google returned 29 current
primary users, none suspended. The 35 stored mailbox rows comprise 29 present
primaries, two returned aliases and four absent addresses. All four recently
failing `invalid_grant` accounts fall in that absent group. This establishes
current directory absence, not deletion or a reason to erase historical data.
The domain's DWD account rows comprise 23 present primaries, two aliases and four
absent addresses. Two follow-up Gmail profile reads verified the aliases resolve
to their directory owners; neither owner has a separate DWD account. No email
content, settings, keys or permissions changed. Configuration hashes matched.
[Directory evidence](evidence/learn-workspace-directory-audit-2026-10-11.json),
[alias profile evidence](evidence/learn-workspace-alias-profiles-2026-10-11.json).

This exposed an actual discovery bug: ignoring aliases would mark those two
working inputs removed on refresh. TEST `google-workspace-discover-mailboxes` v2
now validates returned alias ownership, retains already-registered aliases,
preserves operator enable/disable decisions, and propagates suspension. It does
not register every alias as a new mailbox, merge source identities or alter email
accounts. Conflicting alias ownership or malformed pages fail before reconciliation.

Ten local checks and eight checks against downloaded deployed code pass; all four
runtime modules match. Strict endpoint/worker types and unsigned HTTP 401 pass.
All 121 TEST datasets, the schema and other endpoints are preserved. No positive
hosted scan or real mailbox capture was run; TEST credential/access approvals and
production reconciliation/promotion remain pending. Before enabling primary rows,
review their alias history so one mailbox is not captured or scored twice.
[TEST release evidence](evidence/learn-workspace-directory-alias-test-2026-10-11.json).

### Directory reconciliation safeguards — 11 October, 15:38 UTC

Source inspection found that the directory reader returned partial results at its
page limit, while discovery ignored inventory-read and removal-update errors.
The correction is installed as TEST `google-workspace-discover-mailboxes` v1,
ACTIVE with JWT verification. An unfinished, malformed or repeated-page traversal
now fails before mailbox reconciliation. Existing-inventory, upsert, removal,
connection-verification and success-receipt failures cannot return clean success.
Tenant/connection scope and operator mailbox choices are retained. Existing
mailboxes are marked absent only after terminal traversal; no history is deleted.

- Six local directory test groups passed, including the actual endpoint against
  incomplete scans and database failures; the same six passed against downloaded
  deployed code. Two existing token checks and seven deployment checks also passed.
  Strict backend TypeScript passed; all four downloaded runtime modules matched
  the reviewed emitted syntax trees.
- TEST rejected the unsigned HTTP request with 401. All **113 retained datasets**
  and the full schema matched before/after deployment and the HTTP check. Other
  endpoints were unchanged. No provider request, key, grant, schedule or production
  write occurred. The accepted frontend preview remains unchanged.
- **Still unverified:** a positive authenticated hosted scan, real directory
  reconciliation and mailbox-to-card acceptance. The credential-copy and TEST
  owner-access approvals remain pending. No failing production account was disabled.
- Writes are sequential, not one database transaction: confirmed upserts may
  remain if a later reconciliation write fails, with failure reported. Discovery
  is scoped to the saved domain; it does not prove all-domain Google coverage.
  Previously removed/disabled choices are not automatically re-enabled.

Google's [directory list contract](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/list)
defines pagination and domain scope. [TEST evidence](evidence/learn-workspace-directory-test-2026-10-11.json)
distinguishes local fixtures, deployed readback and HTTP denial from real acceptance.
The four-account [diagnostic evidence](evidence/learn-workspace-current-failure-check-2026-10-11.json)
remains read-only; it is not authority to infer deletion or alter capture settings.


### Hosted TEST sign-in — 11 October, 15:02 UTC

The accepted preview opens and its login route renders without recorded browser
console errors. Positive signed-in acceptance remains pending. Chris reported
that the emailed reset link led to an unavailable localhost address. A read-only
TEST configuration check confirmed `site_url=http://localhost:3000` and an empty
redirect allowlist. Both now point exactly to the approved preview's existing
`/login?reset=1` page; read-back verified every other Auth setting unchanged.
No password, account, grant, provider, schedule or production change was made.
The earlier temporary operator login remains banned and has no effective grant.
Ongoing owner/operator access has been prepared and awaits Chris's choice.
Do not reuse or reactivate a retired acceptance account implicitly.
[Configuration evidence](evidence/learn-test-password-reset-redirect-2026-10-11.json).

This TEST default intentionally opens the password form for dashboard-generated
recovery links as well as app-generated links. It is pinned to the accepted
preview; moving the preview requires reviewing this destination and its exact
allowlist. A successful configuration read-back does not prove email delivery or
password-change completion. Chris completes password entry and stores it in
1Password. Supabase documents the fallback/allowlist behaviour in its
[redirect guidance](https://supabase.com/docs/guides/auth/redirect-urls).

### Recovery form correction — 11 October, local verification

The login form previously ignored `requestPasswordReset` errors and always
claimed a link was on its way. It now reports an unconfirmed request, permits
retry, keeps successful responses independent of whether an account exists, and
recovers from thrown transport failures without exposing provider details. Form
submission waits for initial authentication to finish. A confirmed password
update clears both password fields and continues to the requested workspace
using the recovery session, rather than racing a best-effort sign-out with the
automatic login redirect. No permissions or account grants are changed by this flow.

Six actual-component regression cases and four existing error-copy cases pass.
Application TypeScript and the production build pass, including 47 prebuild checks.
The actual component was exercised locally in the browser for reset rejection,
retry, update rejection and confirmed-update navigation, with synthetic auth and
navigation and no observed console errors. This does **not** prove real email
transport, token exchange, password change or hosted access. The accepted TEST
preview is unchanged pending the account setup; this fix is local/Git only.
No real password was entered, email sent or account enabled. Supabase's
[recovery contract](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
remains the provider reference. [Verification evidence](evidence/learn-login-recovery-local-2026-10-11.json).


### Email diagnosis — 11 October, 06:17 UTC

[Read-only failure diagnosis](evidence/learn-email-failure-diagnosis-2026-10-11.json)
samples the latest 100 failed/retrying Workspace jobs: 99 `delegation_failed`,
one `db_error`. The latest 200 failed Workspace capture runs all retained
`invalid_grant`, across four accounts. These are bounded samples, not all-time
failure counts or proof that the other accounts have full coverage.

The downloaded deployed worker and token helper confirm that the old code reduces
token failures to a generic code and does not retain Google's error description.
The exact cause therefore cannot be recovered from these logs alone. Google's
[service-account troubleshooting](https://developers.google.com/identity/protocols/oauth2/service-account#error-codes)
lists multiple `invalid_grant` causes, including subject, signature and assertion
timing. Local classification now uses `delegation_grant_invalid` instead of
asserting `subject_invalid`; it requires review and does not trigger endless queue
retry. Five focused handler/token tests pass, including provider-detail redaction.
The helper is now installed in hosted TEST worker v6 (see the release below),
but is not deployed to production. The V1 worker preserves six safe
Workspace diagnostic codes through protocol failure, checkpoint and queue settlement.
The operator reader/UI exposes only an allowlisted code, attempt ID and timestamp.
See the local and hosted acceptance below; signed-in operator acceptance
and real-mailbox diagnosis remain outstanding. Earlier production logs cannot establish the exact grant cause.

Production has the three Workspace credential secret names; TEST has none. No
credential values were returned. The checked older checkout env files and current
process environment contain no copy. Chris has been asked for the secure location
of the existing service-account key so real TEST capture can proceed. Do not
export credentials from a running production function or invent a new key.

An earlier extended authority aggregate observed one matching eligible mailbox
for each of 29 DWD accounts, and 25 accounts with successful capture in the previous
24 hours (47 reported processing observations). A repeat aggregate timed out and
produced no replacement evidence. These observations guide investigation, not
current credential validity or launch acceptance. The bounded diagnosis above
succeeded after that failure; no worker was invoked and no source record changed.

### Durable email diagnostics — local acceptance, 11 October

- The token adapter keeps only six known permanent Workspace diagnostic codes;
  unknown provider errors retain a generic category. Provider descriptions, keys
  and message content are never passed into these diagnostic fields.
- Additive migrations `20261101190000_learn_email_safe_failures.sql` and
  `20261101191000_learn_email_failure_health.sql` preserve those codes through
  the existing transition, blocked checkpoint, failed run and lease-bound job
  receipt, then expose current mailbox diagnostics to the existing operator role.
- **23 focused tests and 57 isolated protocol tests passed.** The latter exercised
  all six codes for both recent and historical capture, no provider reads after
  token refusal, unchanged retained-message fingerprints and idempotent settlement.
  The operator SQL suite passed rollback, unchanged function owner/ACL and source
  rows, tenant isolation, unknown-error redaction and later-success clearing.
  Every actual SQL health page passed the application parser.
- The actual operator component displayed the grant diagnostic and cautious recovery
  guidance in the isolated synthetic browser. Application/worker TypeScript and
  application/preview builds passed; existing bundling warnings remain.
- The health view continues to report recent mailbox capture; historical failures
  retain diagnostics in their run/checkpoint/job but do not appear as recent mailbox
  health. Missing platform configuration caught before token acquisition can still
  have the generic eligibility code. This does not prove any live failure is fixed.
- **Release dependency:** rehearse/install both migrations against the current TEST
  catalog, then release the diagnostic-aware worker and frontend together. Older
  clients reject the new checkpoint codes. After any new diagnostic is persisted,
  do not roll back to an older worker or narrow the SQL allowlist; pause capture
  and retain compatible readers while repairing forward. The local acceptance itself made no hosted changes. The subsequent TEST
  database/worker release is recorded below; no new role/credential grant was made.

[Structured evidence](evidence/learn-email-diagnostic-local-2026-10-11.json) and
[synthetic operator screenshot](evidence/learn-email-diagnostic-local-2026-10-11.jpg).

### Email diagnostics — hosted TEST release 054, 11 October

- Rollback rehearsal succeeded at 06:51 UTC; installation at 06:52 UTC changed
  only the three intended function definitions and retained existing authority.
  All 101 monitored datasets matched before and after. TEST ledger now has 55
  entries, ending with release 054.
- `platform-worker` v6 became ACTIVE at 06:54 UTC, using the pinned 96-file
  dependency bundle. Other endpoints, schema and all 101 datasets were preserved.
- HTTP acceptance at 06:55 UTC rejected missing/incorrect worker credentials
  (403) and accepted an authorised execution filtered to no capture jobs (200,
  zero claimed/failed). Sources remained unchanged. Ten release/deployment tests pass.
- Matching frontend `a621415c451c31336a8b19cde8a7a0e7284b3110` is READY in
  protected Vercel TEST at 07:00 UTC. TEST backend binding, three protected HTTP
  routes, same-origin client/operator sign-in redirects and zero observed browser
  console errors were verified. It also includes the retained source timeline viewer.
- Positive signed-in operator and customer acceptance remain open. These checks
  made no provider requests, created no access grants and do not establish
  successful mailbox capture or resolution of production failures.
- Production remains unchanged. Preserve compatible readers if new diagnostic
  codes are stored; pause and repair forward instead of reverting to older readers.

[Release evidence](evidence/learn-email-diagnostic-test-2026-10-11.json) and
[HTTP evidence](evidence/learn-email-diagnostic-http-2026-10-11.json).

### Scheduler outcomes — local correction, 11 October, 14:03 UTC

The OAuth and Workspace schedulers could report a successful no-op when queue
submission or capture admission was unconfirmed. The backfill heartbeat also
copied its global queued count into every configured company's receipt. The
legacy health reader selected only a timestamp, so even a fresh failed receipt
could appear healthy.

The local candidate now records per-company confirmed new jobs, confirmed
duplicates, paused attempts and unconfirmed outcomes separately. A failed or
unknown enqueue marks that company's heartbeat failed and returns HTTP 503;
heartbeat-write failure also returns an uncertain result while attempting other
companies' receipts. Connection/account/discovery reads no longer silently become
empty successful inventories, and raw database error prose is withheld. The
existing OAuth auth-state guard, five-mailbox backfill bound, explicit-running
backfill requirement and discovery throttle remain. No historical import is
started automatically.

The client evaluates outcome as well as freshness: **Needs attention**, **Includes
paused inputs**, **On schedule**, **Overdue**, **Not observed** and **Unverified**
are distinct. Scheduling evidence is not described as completed capture.
Twenty-four focused checks pass, including actual scheduler-handler receipts fed
to the client verdict, two-company isolation, failed reads/enqueues, pause,
duplicate uncertainty, discovery and heartbeat failure. Strict Edge and application
TypeScript checks and the production build (47 prebuild checks) pass.

**Not deployed.** The 14:01 read-only TEST inventory confirms all three email
scheduler endpoints and their trigger-secret names are absent. The 14:03 TEST
permission check also denies authenticated SELECT of the legacy reader's status/
metadata columns. A bounded, tenant-scoped reader is required for hosted acceptance;
do not solve this by broadly exposing scheduler/source tables. Secure trigger
provisioning, reviewed runtime installation, signed-in acceptance and explicit
schedule activation remain. The fresh combined production/TEST aggregate audit
failed and produced no replacement baseline; it does not prove a source loss or
service failure. No production, provider, credential, schedule or access change
occurred. [Evidence](evidence/learn-email-scheduler-outcomes-local-2026-10-11.json).

### Email schedulers — hosted TEST runtime, 11 October, 15:07 UTC

The corrected OAuth, Workspace recent-capture and Workspace backfill schedulers
are now installed as version 1 in TEST. The six-file dependency bundle is pinned
and the deployment preserved the existing endpoints, schema and all 113 tracked
datasets. Twenty-one actual-handler checks passed before deployment. Six hosted
HTTP checks verified method rejection and missing-configuration refusal, again
preserving the full baseline. A fresh preflight confirmed all three trigger
secret names absent; no secret, schedule, account or grant was created.

This closes the runtime-installation gap from the 14:03 local correction. It does
not establish authenticated scheduling, recurring execution, real Google capture
or source-to-card acceptance. Trigger credentials, explicit schedule activation,
existing Workspace service-account access and signed-in acceptance remain required.
The live production schedulers are unchanged.
[Deployment and boundary evidence](evidence/learn-email-schedulers-test-2026-10-11.json).

### Card refresh preservation — hosted TEST, 11 October, 15:14 UTC

The shared card-refresh handler previously ignored identity, graph, interaction
and recommendation read errors. Failed reads could become empty facts and
replace a retained card with misleading health/activity values. It now preserves
cards on required read failure, reports a retryable safe failure, and allows
unaffected cards to refresh. A missing linked identity also preserves its card.
Synthetic sweep cursor failures are reported; successful skips are counted.
Locked fields and manual context remain intact. The manual HTTP wrapper previously
completed partial-failure jobs whenever counts were present; it now records those
jobs as failed, retains their counts and returns an error response.

Six actual-handler/wrapper tests and strict TypeScript passed. The fix is installed
in TEST `platform-worker` v8 and `customer-card-sync` v1 with existing worker auth
and JWT-protected customer entrypoint. The pinned 98-file bundle preserves all
other endpoints, schema and 113 tracked datasets. The downloaded handler/wrapper
passed the same six regression checks; anonymous HTTP requests returned 403/401
and preserved the full baseline. No positive hosted refresh was invoked. Real
provider-to-card and signed-in currentness acceptance remain open. Existing
bounded-window activity calculations and legacy job persistence helpers are not
made complete by this correction. Production remains unchanged.
[Card preservation evidence](evidence/learn-card-refresh-test-2026-10-11.json).

### Customer snapshot labels — local frontend acceptance, 11 October

The legacy Customers list/detail now show the saved summary's exact preparation
date beside its finding. Missing, malformed and future dates say freshness is
unverified. A later recorded activity timestamp explicitly warns that the saved
summary does not yet include it. A recent snapshot still does not imply provider
coverage. The old confidence-derived “Verified critical” label is now “Recorded
urgent signal”; “Normal / No open issues” is scoped to issues recorded in the saved
snapshot. Existing urgent findings remain visible.

Three date-boundary checks, application TypeScript and the complete application
build pass. The actual Customers component rendered synthetic older and undated
snapshots in a local browser; list/detail notices and zero console errors/warnings
were verified. This is not deployed to hosted TEST yet: keep the approved TEST
login destination stable during owner access setup, then coordinate the next
frontend release and its reset URL. The newer LEARN detail already distinguishes
read time from provider coverage. No production or source data changed.
[Local UI evidence](evidence/learn-customer-snapshot-ui-2026-10-11.json).

## Working and verified in production

- [x] Retained source inventory and recording object-size metadata observed at the
  time above. This does not claim the new V1 workflows are production verified.
- [x] Earlier source-ID/pointer comparison and database-backup listings retained
  in [source preservation](LEARN-SOURCE-PRESERVATION.md) and
  [recovery coverage](LEARN-DATA-RECOVERY.md). Refresh these for the actual release.
- [ ] Entire V1 live service accepted: **not established**. Production deployment,
  signed-in journeys, provider coverage and recovery gates remain below.

## Verified in TEST or locally only

- [x] Real Commusoft TEST capture retained 2,418 properties and 10,000 jobs in the
  approved, retired run. Property traversal exhausted; job traversal did not.
  Contacts did not start. These are source records, not canonical publication.
  [Evidence and limitations](LEARN-COMMUSOFT-API.md).
- [x] TEST controller/module controls, card readers, scorecard configuration,
  measurement review/correction and work history have dated release evidence in
  [TEST readiness](LEARN-TEST-READINESS.md). Positive acceptance is component-specific;
  anonymous denials do not prove the signed-in owner/operator journey.
- [x] Local Microsoft readers, durable pages, retry recovery, atomic queue completion
  and discovery-to-message dispatch pass unit and isolated database checks. A
  discovered folder drives retained message capture with synthetic Graph responses;
  hidden/search/nested folders, deduplication, pause and rollback are verified. No real Microsoft
  provider calls or hosted installation. [Remaining work](LEARN-MICROSOFT-MAIL.md).
- [x] Local OAuth scheduling guard now prevents known revoked/expired/missing-auth
  accounts receiving new jobs; heartbeat write failure returns an uncertain result.
  Run `node --test scripts/email-scheduled-sync.test.mjs`. Hosted installation and
  acceptance remain required; existing queue/source rows are unchanged.

- [x] Local customer/job timeline now reuses the restricted source reader already
  used by scorecards. Browser checks verified email/call failure-to-retry recovery
  and explicit unsupported-source messaging using synthetic data. Eighteen reader
  tests, both TypeScript checks and builds passed. The matching frontend is now
  deployed to TEST with release 054 above; signed-in source acceptance is pending.
  [Evidence and limits](LEARN-CARD-SOURCES.md#customer-timeline-integration--11-october-2026-local-only).
- [x] Local customer/job findings now resolve typed team owner and waiting-on names.
  Unavailable or ambiguous identities show a clear unresolved assignment and a gap;
  they never display an internal UUID as the owner label. All 150 references on a
  full findings page are supported within a bounded lookup. Nineteen card/communication
  checks, both TypeScript checks and both builds passed. Synthetic browser verification
  shows “Office” for the customer finding. The matching Git commit `6be7c9b` is now
  READY in protected Vercel TEST (08:31 UTC); backend binding, protected HTTP routes
  and client/operator sign-in redirects pass, with no observed browser console errors.
  Positive signed-in hosted and production acceptance remain pending.
  [Local evidence](evidence/learn-owner-labels-local-2026-10-11.json) and
  [TEST deployment evidence](evidence/learn-owner-labels-test-2026-10-11.json).

### Phone source-to-event handoff installed in TEST — 11 October, 16:21 UTC

TEST release **061** and `phone-process-pipeline` **v2** now use one scoped atomic
publisher for the canonical interaction, downstream event and immutable receipt.
The previously missing event/projection dependencies are installed. Direct raw
interaction INSERT remains denied; no broad service DML grant was added. Unknown
legacy provenance is held without deleting recordings, transcripts or insights.

The full-schema and exact-package rollback rehearsals passed. Installation
preserved all 113 pre-existing datasets; the two additive interaction columns
remain NULL on retained rows. The monitoring baseline now includes 115 datasets,
adding event and handoff receipts. Existing schema catalogs that are pinned to
060 are historical and must not be silently updated/reused to authorize a write.

A hosted, internal-service TEST request reused exact synthetic cached source data
and returned HTTP 200 only after four terminal runs, one ready interaction, one
pending event and one matching run/handoff receipt were verified in storage.
No provider dispatches, new users, grants, secrets, schedules or production writes.
The fixture is archived; all 115 non-fixture datasets and the schema matched.
71 actual-handler, six finaliser and three terminal-settlement cases pass, as do
eight downloaded pipeline-related checks and strict backend TypeScript. All seven
deployed modules match the tested closure in the syntax-tree comparison.

This milestone proves source-to-event publication. The next section adds hosted
synthetic card delivery; real-provider and signed-in acceptance remain open.
[Release and verification evidence](evidence/learn-phone-atomic-handoff-test-2026-10-11.json).

### Manual processing joins the durable queue — 11 October, 18:22 UTC

- TEST `platform-worker` **v12**, `interactions-sync` **v1** and `identity-resolve`
  **v1** are installed against unchanged release 066. The manual endpoints require
  the existing authenticated owner/admin/ops or internal tenant authority. They
  confirm a tenant-bound queued job and return HTTP 202; they never run an
  unclaimed handler or mark its work complete. Duplicate active requests reuse
  the confirmed job. Unsupported options and malformed batch limits are rejected.
- Hosted synthetic acceptance entered through both real manual HTTP endpoints:
  four original requests and four duplicate retries, followed by ten worker runs.
  Two customer cards were delivered and one updated after a retained source change;
  identity/card links, all 121 non-fixture datasets and schema were preserved.
  Unsigned calls received 401 and foreign-tenant requests 403. No user, grant,
  credential, capture schedule, provider request or production write was added.
- The timeline now explains request acceptance, retry, cancellation and failure
  without calling the full backlog complete when only one batch has finished.
  The actual component passed local browser checks, including clearing an earlier
  queued notice after a failed request, with zero observed console errors. This
  frontend change is **local/Git only**; the hosted preview has not changed.
- The nine earlier worker type errors are corrected. The full worker and both
  manual endpoints pass `node scripts/verify/learn-worker-typecheck.mjs` using the
  installed SDK declarations and a minimal Deno shim. This is not a native Deno
  type check. Application TypeScript/build, 39 existing Marketing tests, 29 policy
  assertions and eight new admission/client checks pass. All 41 queue/admission
  checks also pass against downloaded TEST modules. Source comparison found 92
  matching worker runtime modules and all five modules of each manual endpoint.
- Remaining acceptance: matching frontend deployment, signed-in manual requests,
  automatic worker dispatch/identity scheduling, real-provider coverage and
  production approval. The hosted probe deliberately invokes the worker and each
  manual endpoint; it does **not** prove unattended processing. Other generic
  queue types remain outside this durable settlement change.

[Manual processing evidence](evidence/learn-processing-request-test-2026-10-11.json).

### Durable retained-input queue verified — 11 October, 18:11 UTC

- TEST release **066** and **platform-worker v11** now fence queued
  `interactions.sync` and `identity.resolve` publication to the exact tenant,
  worker, attempt and unexpired claim. Publication and its immutable receipt
  commit together; a stale worker cannot publish new results.
- Finishing a batch and scheduling its continuation now commit together. A lost
  acknowledgement is inspected using the original request, without repeating the
  mutation. Unconfirmed settlement cannot become a generic success or fresh
  healthy heartbeat. Persisted identity-review holds remain visible even when
  the next inventory batch is empty.
- Hosted synthetic Phone/Email acceptance completed **10 worker calls**, producing
  two cards, refreshing one after a source update, and leaving zero pending
  interaction events. Six fenced publications and ten durable job settlements
  were verified. Identity/card links and all **121 non-fixture datasets** were
  preserved; the synthetic tenant was archived with its evidence retained.
- Full-schema and exact-package rollback rehearsals passed, including claim,
  tenant, expired-lease, audit-failure, continuation-failure and retry checks.
  The offline real-handler journey recovered deliberately lost acknowledgements.
  All **33 focused tests** passed locally and against downloaded TEST modules;
  92 deployed runtime modules matched the tested source after syntax normalization.
- Strict checking of changed helper/identity modules passed. The wider worker
  dependency check still reports **nine pre-existing errors** in unchanged
  Marketing/Intelligence code, reproduced against the previous Git checkpoint.
  This historical failure is resolved by the subsequent manual-processing release above.
- No users, grants, credentials, capture schedules, real provider requests or
  production changes. This is queued synthetic TEST acceptance, not real-provider
  coverage or signed-in customer acceptance. Manual `interactions-sync` and
  `identity-resolve` endpoints remain undeployed pending lifecycle hardening;
  other generic queue types still need their own recovery review. The subsequent
  manual-processing release above replaces these manual endpoints with queue admission.

[Release evidence](evidence/learn-processing-queue-test-2026-10-11.json).

### Operator initial identity review installed — 11 October, 17:50 UTC

- TEST release **065** adds a paged held-interaction list, tenant-scoped contact
  search, exact source/contact/company comparison and audited operator decision.
  The existing OpenFolk admin grant is required; no accounts, grants or schedules
  were added. The unchanged automatic delivery API delegates to a private engine;
  only the governed review action can supply an explicit contact choice.
- Initial ambiguous/conflicting matches can be attributed to the chosen existing
  contact and their displayed company. Card enrichment, event consumption and
  immutable audit commit together. Previous canonical/contact/company snapshots
  and the operator's reason are retained privately. Global contact verification,
  raw sources, manual card locks and rejected suggestions are preserved.
- Source/contact/company changes invalidate the review. Revoked access, tenant-only
  membership, View-As and cross-client selections are denied. Offline PostgreSQL
  checks prove late-audit failure rolls back all publication, identical concurrent
  decisions share one receipt and competing contact choices cannot both publish.
  The existing automatic identity/card assertion suite also passes.
- Full TEST-schema and exact-package rehearsals passed and removed all fixtures.
  Installation preserved **118 existing datasets** and added an empty private audit
  table. Eight hosted anonymous/service endpoint denials preserved all **119
  datasets** and the schema. No new session, provider request or production change.
- The component is **local/Git only**: eight client tests, application TypeScript
  and build pass. The actual local browser exercised unavailable reads, tenant
  switching during a delayed comparison, the prior-rejection warning and a lost
  reply recovered through the original receipt with exactly one apply. No console
  errors were observed. This is synthetic UI acceptance, not signed-in hosted UAT.
- **Still open:** frontend deployment and positive signed-in hosted review; broader
  correction of previously delivered interactions/old cards and graph/history;
  duplicate-contact merging, company edits, invalid/internal-source investigation;
  real provider coverage and production acceptance. A new source revision can
  require a new identity review; this is not a global verified-person override.

[Operator procedure](LEARN-IDENTITY-REVIEW.md) ·
[Sanitized TEST evidence](evidence/learn-identity-review-test-2026-10-11.json).

### Operator projection review backend installed — 11 October, 17:30 UTC

- TEST release **064** adds an authenticated OpenFolk review list, exact source
  comparison and audited action for legacy/unowned or manually changed canonical
  communication records. Existing effective platform grants govern access; no
  user, grant, credential or schedule was added. Raw review history remains private.
- An administrator can explicitly apply the displayed retained source values.
  The previous full canonical record, actor, reason and exact receipt are retained
  in immutable audit history. Source messages/calls, identity links and unrelated
  metadata remain intact. Publication, event and audit commit together; card
  processing is reported **pending**, not complete.
- Changed comparisons, paused inputs, revoked grants, viewers, tenant-only users,
  actor impersonation and View-As are refused. Check/retry uses the same durable
  request; cancellation prevents delayed application. Failed audit insertion
  rolls back the publication. Unexpected canonical types, campaign relationships,
  invalid addresses and oversized comparisons require separate investigation.
- The matching OpenFolk module screen is **local/Git only**. Seven client tests,
  actual local browser checks, application TypeScript and production build passed.
  Browser checks covered failure/recovery, delayed cross-company comparison and
  a lost reply recovered with exactly one apply; zero console errors were observed.
  It labels projection holds separately from identity matching/provider reviews.
- Full TEST-schema and exact-package rollback rehearsals passed. Installation
  preserved all **117 existing datasets**; all **118 datasets** matched after six
  hosted anonymous/service access denials (401/403). No persistent synthetic
  account/grant/session, provider call or production change occurred. The current
  protected frontend URL was not replaced.
- **Outstanding:** matching frontend deployment and positive signed-in hosted
  review; broader identity correction (initial holds addressed by 065 above); operator workflows for the explicitly held
  exceptional cases; real-provider capture/coverage and unattended recovery.

[Sanitized TEST evidence](evidence/learn-projection-review-test-2026-10-11.json).

### Retained Phone/Email to cards installed in TEST — 11 October, 17:10 UTC

- TEST release **063** and **platform-worker v10** are installed. The repair and
  backfill path now publishes the canonical interaction, pending event and exact
  receipt together through scoped functions. No raw interaction write permission
  was added. Confirmed phone analysis remains owned by its provenance-checked
  publisher; basic calls preserve their actual provider rather than assuming Simwood.
- New and changed emails reach cards. In the hosted synthetic acceptance, Phone
  and Email created two cards; a later email update refreshed the existing card
  while preserving both identity/card links. All four queued jobs completed,
  three events were consumed, and no pending event or eligible source remained.
  This proves retained-source processing, **not real-provider capture or coverage**.
- Lost replies are inspected by the same immutable request instead of republished.
  Concurrent requests, stale source selection and event-failure rollback passed
  against offline PostgreSQL. Nine actual-handler cases, nine downloaded-handler
  cases and three local HTTP-wrapper cases passed; strict backend/application
  TypeScript and the production build passed.
- Full-schema and exact-package rollback rehearsals passed. All **116 existing
  datasets** matched at installation; all **117 non-fixture datasets**, including
  the new receipt table, matched around deployment and hosted verification. No
  user, grant, credential, provider call, schedule or production change occurred.
  Synthetic acceptance tenants are archived and their evidence is retained.
- The manual `interactions-sync` wrapper now handles partial failure honestly,
  rejects mismatched tenant/invalid input and avoids work after duplicate/failed
  job admission. That wrapper is **local/Git only**, not deployed. Its legacy
  best-effort start/settlement remains a separate hardening gate.
- Unowned legacy canonical rows and manually changed projected fields are held
  visibly for review; they are not overwritten. Release 064 above adds audited projection reconciliation; signed-in acceptance
  and identity review remain open. Outstanding holds make the batch report review required;
  successful clean full batches request bounded continuation (20 default, 50 max).
  Generic queue continuation remains best effort and needs final operational
  acceptance before unattended historical import is called complete. Email
  mailbox binding and source coverage remain explicitly unverified.

[Sanitized TEST evidence](evidence/learn-interaction-projection-test-2026-10-11.json).

### Atomic identity/card delivery installed in TEST — 11 October, 16:40 UTC

TEST release **062** and `platform-worker` **v9** replace the early enriched marker
and unchecked card writes with one exact-revision database transaction. Contact
resolution, provisional identities, card updates, recommendations, the enriched
marker, matched-event consumption and an immutable receipt commit together. Card
or event errors roll all of them back; a lost reply is inspected without repeating
the publication. A worker holding an older source revision cannot finish newer
content. Existing source rows, manual locks and human match decisions are retained.

The actual hosted chain passed using one synthetic cached call: pipeline v2
confirmed its transcript/analysis and ready event; worker v9 created one useful
card with the source summary and provisional customer, linked the interaction,
consumed exactly that event, saved its delivery receipt and finished its queue job.
The fixture is archived. No users/grants/credentials, real provider calls, storage
objects or production changes. All 116 non-fixture datasets and the schema matched.

Eight actual-handler checks, eight downloaded-handler checks, one manual-wrapper
partial-failure check, strict backend TypeScript, real PostgreSQL concurrency and
lost-response tests passed. Full-schema and exact-package rollback rehearsals
preserved 115 pre-existing datasets before adding the receipt table. The downloaded
worker has 92 matching runtime modules; three type dependencies were pruned by the
bundler. No differing runtime module remains after accounting for equivalent
logical grouping and the optional block around a for-of statement.

**Still open:** real-provider/data-coverage and signed-in acceptance; an authorised
signed-in review of initial `identity_review` cases (065 above) and broader attribution corrections; legacy
projection review acceptance (063/064 above); and recovery for other generic queue types (queued identity/projection addressed by 066 above). The manually
invoked `identity-resolve` wrapper now reports partial failures correctly locally,
and has since been replaced by the queued TEST manual endpoint described above.
The calculated customer-card priority is an operational queue aid with recorded
inputs and an explicit UTC daily window, not staff performance/pay scoring.
[Release and hosted journey evidence](evidence/learn-identity-card-test-2026-10-11.json).

## Implemented but not fully verified — acceptance gates

- [ ] **Google email:** reconcile every enabled mailbox against current connection
  and domain authority, distinguish OAuth from DWD, classify recent failures,
  verify bounded real historical/incremental capture through the installed V1
  engine into interactions/cards, and verify pause, credential expiry, resume,
  duplicate suppression and schedule/expired-lease recovery. Exercise matching UI.
  The existing Workspace credential is now provisioned in TEST. Heidi’s live
  mailbox recovery is verified separately; TEST mailbox activation, remaining
  mailbox reconciliation remain open. The 12 October retained TEST sample now
  proves nineteen real email-to-card deliveries; it does not prove full history
  or recurring capture.
- [ ] **Commusoft:** the first full LIVE scheduled cycle is verified complete:
  1,552 customers, 871 sites, 12,637 jobs, 2,402 customer-contact records and 567
  site-contact records. All four terminal checkpoints match successful page receipts.
  At 21:37 UTC on 13 October the next overlapping incremental cycle had completed
  properties and a 27-record jobs pass; its contact traversal was still running.
  Reconcile the remaining UI/API inventory differences, missing relationships and
  unzoned timestamps. Finish canonical publication, reviewed/unattended refresh,
  source-to-card matching and signed-in acceptance; retained coverage alone does not
  make the customer cards comprehensive. No provider writes are authorized here.
  [Current incremental evidence](evidence/learn-commusoft-next-cycle-2026-10-13.json).
- [ ] **Phone:** verify existing account binding, calls, recording download,
  transcription, playable audio, retry/recovery and recurring capture with the
  real Birchill account. Preserve existing IDs and distinguish capture from shadow
  processing configuration. [Phone work](LEARN-PHONE-ACCOUNT-BINDING.md).
  Retained call playback is implemented and its backend is now **installed in TEST**:
  owner/admin evidence cards list exact tenant/provider/call recordings and request
  audited 60-second links to private retained audio. Candidate checks included
  nine protocol/client/actual handler tests, isolated PostgreSQL assertions and
  actual-component browser playback of generated audio. Closing evidence stopped
  playback; switching company discarded a delayed old link; listing retry worked.
  Release 057 installed at 11:08 UTC after the exact package rollback rehearsal,
  preserving 112 data sets. Endpoint v1 is ACTIVE with JWT protection; runtime
  deployment and nine anonymous/service HTTP denials preserved 113 data sets.
  All three downloaded source files matched transpiled syntax and downloaded
  handler tests passed. No new users or grants were created. The protected TEST
  frontend is READY from Git commit `0a8d7eab2eeede40d368a9e5b66508ddd954abeb`
  at https://serviceos-learn-test-qu7dogqm4-allkin.vercel.app; the actual browser
  reached its same-origin login with no observed warnings/errors. Isolated
  signed-in acceptance run `73e083fe` subsequently received explicit user approval
  and **passed in hosted TEST**, using one generated eight-second recording.
  Card → call → recording → private audio worked in the actual browser; playback
  advanced and closing evidence removed the player. Exact bytes, foreign-tenant
  denial, same-session role revocation and all 113 original dataset comparisons
  passed. The temporary login is banned and company access removed.
  TEST needed a private synthetic WAV bucket; it currently has a 1 MiB limit and
  requires configuration review before real-audio acceptance. No new policies.
  [Completed run and retirement](LEARN-PHONE-PLAYBACK-ACCEPTANCE.md).
  [Signed-in acceptance evidence](evidence/learn-phone-playback-acceptance-2026-10-11.json).
  Real Drummonds retained audio and provider-to-card acceptance remain open.
  [Candidate checks](evidence/learn-phone-playback-candidate-2026-10-11.json).
  [Hosted backend evidence](evidence/learn-phone-playback-test-2026-10-11.json).
  TEST release 058 installed at 12:30 UTC adds the bounded saved transcript/analysis
  reader under existing owner/admin access. All 113 data sets are preserved.
  Current-source provenance, stale and unverified historical results remain distinct.
  Long transcripts paginate with a text hash so pages cannot mix edited versions.
  Actual local component checks cover pagination, warning labels, failure recovery
  and discarding delayed replies on company change; offline SQL and full hosted
  rollback assertions pass. The matching protected frontend is READY at 12:32 UTC from GitHub `508dc13`,
  at https://serviceos-learn-test-ea944wgld-allkin.vercel.app. TEST binding, route
  protection, actual browser sign-in redirect and zero browser errors pass. Three
  real RPC denials pass; positive signed-in hosted reader acceptance remains open. Legacy `/app` call detail/feed
  freshness remains separate work. [Saved-result evidence](evidence/learn-phone-saved-results-test-2026-10-11.json).
  Hosted TEST now has pipeline, transcription and analysis v1, download v4,
  pending processor v2 and platform worker v7, coordinated with schema release 055.
  The local candidate now confirms pipeline completion and gives downloads,
  transcription and analysis exclusive per-recording ownership. Forced processing
  retains prior audio, transcript, summary and attribution versions. New results
  carry exact source hashes; stale results no longer count as a completed pipeline.
  Prepared outputs can be reconciled without repeating provider requests. Unknown
  paid-request outcomes stay held for review, while confirmed rejections can retry.
  All 101 focused checks, isolated PostgreSQL assertions and strict TypeScript pass.
  The complete schema passed positive processing assertions in hosted TEST and was
  installed at 10:05 UTC, preserving 101 data sets. Runtime deployment preserved
  108 data sets including the new journals/configuration. At 10:10 UTC, the deployed
  HTTP chain completed all three stages using retained synthetic results in an
  archived company. Both cached receipts reconciled without provider dispatch;
  forced work remained paused. Authentication, tenant mismatch and method checks
  passed. No users or access grants were created. This proves retained-result reuse,
  not new audio capture, model processing or customer-card delivery.
  Operator history and saved-result recovery are now implemented locally. At
  10:31 UTC, their positive assertions passed against the full hosted TEST schema
  inside a rolled-back transaction; 111 datasets, including Auth identities and
  sessions, remained unchanged. No login, grant or candidate schema persisted.
  The actual local UI verified lost-response receipt recovery and disabled writes
  for a read-only operator. Six client tests and the offline SQL/concurrency suite
  pass. TEST release 056 is now installed (10:37 UTC), preserving all 111
  datasets and retaining no synthetic users/grants. Seven HTTP denials passed
  (10:38 UTC), preserving 112 datasets including the new empty audit journal.
  The matching protected frontend is READY from GitHub commit `48999ca`;
  protection, client/operator login redirects and zero observed browser errors pass.
  Signed-in hosted acceptance, download verification UI and unknown-outcome
  disposition remain open, along with customer-facing stale
  indicators, live-provider and recurring-capture acceptance.
  [Operator recovery evidence](evidence/learn-phone-operator-rehearsal-2026-10-11.json)
  and [TEST release](evidence/learn-phone-operator-test-2026-10-11.json).
  Chris authorised a dedicated TEST OpenAI key; the secure Platform picker is open
  and awaiting its selection. No TEST OpenAI secret has been provisioned yet.
  [Latest evidence](evidence/learn-phone-processing-test-release-2026-10-11.json).
- [ ] **Slack:** verify authorised workspace/channel scope, history plus replies,
  all available history across the agreed channel inventory (including archived
  channels), durable backfill and explicit inaccessible/retention gaps,
  files/unsupported-content limits, incremental schedule, revocation/recovery and
  source-to-card visibility. Local synthetic history and deployed worker status
  alone are insufficient. [Slack work](LEARN-SLACK-INGESTION.md).
- [ ] **Cards and scoring:** signed-in Drummonds review of customers/jobs,
  communications, ownership, outstanding actions and next steps; configurable
  scale/criteria/weights/targets for individuals/teams; traceable evidence,
  calculation, period, coverage, corrections and human review. Missing evidence
  must not become a low score. Pay decisions remain human-reviewed.
- [ ] **Operator controller:** signed-in client creation/configuration, module and
  submodule switches, accurate health/coverage/last success, diagnostics and recovery.
  Prove pause stops new reads but retains sources. Verify customer-facing stale or
  missing-input messages and compare Drummonds branding with production.
- [ ] **Isolation:** positive authorised and negative foreign-tenant/user-role
  cases against the actual hosted schema and HTTP boundary, covering sources,
  recordings, cards, scoring, controls and administrative recovery.

## Missing or externally blocked — no silent exclusions

- [x] **Commusoft continuation access resolved:** Chris’s approved ongoing TEST
  operator login now supplies the continuation authority. The temporary run was
  retired, and the current bounded run retains its original cursor and request
  ceiling without a new login or grant. Customer/site contact completion,
  reconciliation, incremental updates and real card publication remain open;
  see the latest entries above. Earlier temporary-grant readiness entries are
  historical evidence, not a current approval request.
- [ ] **Voicemail:** the signed Birchills-email/audio route has real read-only
  evidence, and the importer/queue now has local plus hosted synthetic acceptance.
  Still required: verified historical mailbox access, authorised real source capture,
  enumeration and coverage, recurring scheduling, provider-transcript quality,
  signed-in private playback, authorised LEARN context/card integration and independent
  recovery of audio/original-message files. Do not publish private voicemail into
  tenant-wide cards without preserving its owner/manager access rules.
  [Discovery and acceptance evidence](LEARN-VOICEMAIL-DISCOVERY.md).
- [ ] **Microsoft:** authorised tenant/mailbox setup and token lifecycle;
  persistent hosted worker release; real canonical/card acceptance; controller integration,
  recurring folder discovery activation, expiry recovery and real-mailbox acceptance.
  At 13:31 UTC, all five source-journal/dispatch/recurring-queue migrations passed
  a full-schema hosted TEST rollback rehearsal, preserving all 113 datasets and
  the original catalog. Local actual-engine/queue tests prove later delta rounds,
  due-time gating and pause/revocation before token access; 58 focused tests and
  strict TypeScript pass. Nothing is installed or enabled for Microsoft. No real
  Microsoft mailbox has been identified for Drummonds.
  On 12 October the credential port/refresh RPCs passed local actual-SQL synthetic
  acceptance through canonical email and interactions; 66 focused tests and strict
  type checks passed. The subsequent worker checkpoint registered both job types,
  verified owned failure/retry/pause settlement and brought the Microsoft suite to
  68 tests plus 20 generic-worker tests. Consent identity provisioning and hosted
  credential/worker rehearsal remain open.
  [Worker evidence](evidence/learn-microsoft-worker-local-2026-10-12.json).
  [Credential evidence](evidence/learn-microsoft-credentials-local-2026-10-12.json).
  [Evidence](evidence/learn-microsoft-incremental-2026-10-11.json).
  At 14:59 UTC, the canonical message projection also passed a full-schema TEST
  rollback rehearsal, including the missing shared event-bus foundation. Complete
  synthetic messages reached email/thread/interaction records and durable events;
  all 113 datasets and the original schema were restored. Seven isolated projection
  checks cover retries, version ordering, mailbox isolation and failure rollback.
  Sparse/conflicting observations stay held, attachments remain uncaptured, and a
  pending event does not prove customer-card delivery. No Microsoft installation
  or live activation occurred.
  [Projection evidence](evidence/learn-microsoft-projection-2026-10-11.json).
  **Current release status, 12 October:** TEST 079 and worker v20 contain the
  Microsoft schema/handler; the earlier “nothing installed” observations above
  describe their historical checkpoints. No real Microsoft mailbox is authorised
  or capturing. Production package 014 adds combined-archive compatibility,
  including the legacy Marketing OAuth-trigger dependency fix; hosted deployment
  of this additional compatibility fix still requires its own reviewed rehearsal.
- [ ] **Connections catalogue acceptance:** the older adapter labels and unsupported
  inactive/disconnected claims are corrected locally (12 October). Twelve projection
  tests, TypeScript, build and the synthetic browser pass. Hosted deployment is
  verified at 08:09 UTC on 12 October; signed-in controller navigation/status
  verification remains open; available adapter
  code is not proof of authorised accounts, active capture or complete coverage.
- [ ] **Performance inputs:** finish source-backed response-time, job progression,
  repeat-visit and driving adapters where sources exist. Establish staff identity,
  team membership, calendars and reviewable calculation rules using Drummonds data.
  Unsupported inputs stay visibly unavailable until connected and verified.
- [ ] **Backups:** confirm measured volume, estimated total cost, account owner,
  retention and recovery targets; use the now-approved AWS London setup and
  recording-copy scope under OpenFolk ownership; implement encrypted independent files plus database recovery.
  Verify bytes and isolated restore/playback, record duration and recovery point.
  [Recovery plan](LEARN-DATA-RECOVERY.md). Latest 12 October evidence verifies
  2,893 files / 602,476,551 bytes and 2,887 references in the recording inventory.
  The independently stored database snapshot restores all 1,594,994 native rows,
  five sequences, 711 operational rows and their separate sequence, 16 Vault
  secrets and 2,883 recording relationships. The audio reconciliation reports
  four newer references separately; one linked AWS file decodes successfully.
  Remaining: dependable recurring database/file operation, missed-run alerts,
  full application/Auth recovery, controlled capture resumption and voicemail
  file coverage. No daily database schedule was created by the initial approval.
  [Independent database recovery](evidence/learn-independent-database-recovery-2026-10-12.json).
  The observations below are earlier preparation/history, superseded by the
  dated evidence above where later verification is available.
  Earlier synthetic preparation:
  At 13:51 UTC, a reusable offline logical-restore destination passed a separate
  synthetic PostgreSQL dump/restore: retained row/pointer fingerprints, tenant RLS,
  cross-tenant foreign keys, an imported active cron job prevented from running,
  failure redaction and complete disposable-target cleanup. This is preparation,
  not a real ServiceOS database recovery. Database credentials and real export,
  restored relationships/audio matching and platform/Vault recovery remain open.
  [Local restore evidence](evidence/learn-database-restore-isolation-2026-10-11.json).
  The costed proposal now includes 601 MB / 2,888 objects, verified London AWS
  rates, an illustrative US$1.89/month operating estimate and a US$5 budget alert
  (not a cap), plus scoped access, daily copies, 30-day governance protection and
  isolated restore acceptance. Chris approved setup/copy and changed account ownership to OpenFolk. The OpenFolk AWS account is now verified in Arc, with London selected. Owner
  MFA is now verified enabled in the in-app browser. Chris intends to move to the paid plan later; this
  is not an immediate setup blocker unless AWS reports a service restriction,
  but must happen before free access ends. The approved London foundation reached
  CREATE_COMPLETE at 07:55:12 UTC. S3 readback verifies private access, encryption,
  versioning, 30-day GOVERNANCE retention and protected writes. Both IAM policies
  are attached to separate approved Writer/Restore identities with matching
  permissions boundaries and console access disabled. Each has one active key
  stored separately in Mac Keychain, due for rotation by 9 January 2027. Both
  pass live STS and bucket protection checks. The $5 monthly alert still awaits
  owner email verification, so delivery is not yet active.
  [AWS evidence](evidence/learn-recording-backup-foundation-aws-2026-10-11.json).
  Local CloudFormation foundation and streamed copy/restore/inventory core now
  pass schema lint and eleven synthetic tests. The official AWS SDK destination
  and encrypted journal add eight signed-wire synthetic tests (19 combined).
  The recursive Supabase source adapter now joins the synthetic copy/manifest/
  restore test path (28 tests combined), and one real object passed metadata-only
  verification. The complete real metadata inventory now verifies all 2,888 objects
  and every recording-row file link; six unlinked objects remain included. Private
  manifests are saved locally. The bounded local copy command now uses private atomic
  disk checkpoints, separate attempt status, exclusive locking and exact Writer
  credential/principal selection. Thirty-nine local tests passed before activation;
  the first live recording copy verified 108,870 bytes. Bounded full-inventory
  copy pass has now verified all 2,888 files. Sequential whole-inventory finalization
  stopped at its 30-minute deadline at 10:29:51 UTC; no complete manifest was confirmed.
  The runner now verifies at most four objects concurrently, preserving both source
  checks, exact S3-version byte hashes, ordering and failure draining. All 44 backup
  tests pass. The revised run completed at 10:39:30 UTC: all 2,888 pinned object versions
  and 601,004,261 bytes verified, with both source comparisons and an immutable
  manifest. No audio was recopied. Coverage is the explicit observed inventory,
  not a simultaneous database/storage snapshot or subsequent new files.
  [Runner evidence](evidence/learn-recording-runner-local-2026-10-11.json).
  The separate Restore-only command now validates the immutable manifest and restores
  an exact object version without Supabase access, preserving record links and checking
  local audio decoding. Forty-three tests pass, including actual macOS decoding of
  synthetic WAV audio. [Restore evidence](evidence/learn-recording-restore-local-2026-10-11.json).
  The earlier receipt-only rehearsal is now supplemented by a successful real
  full-manifest Restore-key rehearsal: 108,870 bytes hashed, 66.96 seconds decoded,
  one recording reference retained, no source-provider calls, and temporary audio
  removed. Human listening and isolated database relationship recovery remain open.
  [Verified inventory and restore](evidence/learn-recording-inventory-restore-2026-10-11.json).
  [First real restore](evidence/learn-recording-initial-restore-live-2026-10-11.json).
  Restricted Writer/Restore IAM access was explicitly approved and its stack
  completed at 08:35:18 UTC. Whole-inventory verification and one manifest-selected decoded audio restore
  now pass; scheduled execution, operator monitoring and isolated database recovery remain open.
  A repeat-run command, local health report and monthly cleanup mode now pass 56
  backup checks. A real check at 11:42 UTC restored and decoded an 81-second
  recording through the separate Restore key, retained its record link and
  automatically removed temporary audio; separate inspection confirmed removal.
  The active daily follow-up includes the next monthly check due by 11 November;
  no scheduled execution has yet occurred.
  [Monthly check evidence](evidence/learn-recording-monthly-check-2026-10-11.json). Existing
  audio is reused; every retained version is byte-verified again before a new
  immutable inventory manifest. The first real repeat run started at 11:22 UTC
  and reached its 20,000-request ceiling during the final source comparison. All
  destination bytes passed, but no fresh manifest was claimed. The daily allowance
  now accounts for the inventory and both complete reference/metadata passes, with
  a fixed 100,000-request ceiling and the same object, byte and time limits. A new
  live repeat started at 11:38:53 UTC and succeeded at 11:53:07 UTC: all 2,888 files,
  601,004,261 bytes and 2,882 references passed, with zero missing file references
  and no audio recopied. A fresh immutable manifest was verified after 20,288 source
  requests. Local health reports observed inventory verified; the lock was removed.
  The daily 09:00 local follow-up and monthly due check are now ACTIVE and read back.
  No scheduled execution has occurred. This local runner still requires this Mac
  and Codex to be running; it is not an always-on production backup service.
  [Fresh daily verification](evidence/learn-recording-daily-verified-2026-10-11.json).
  [Daily operation runbook](LEARN-RECORDING-DAILY.md).
  [Live access evidence](evidence/learn-recording-access-live-2026-10-11.json).
  [Inventory and runner evidence](evidence/learn-recording-inventory-and-batch-2026-10-11.json).
  AWS foundation and scoped access are active. The full explicitly observed
  recording inventory and one manifest-selected restore are verified; later
  arrivals, scheduled coverage and database recovery still require acceptance.

## Commusoft jobs with unresolved times — 11 October, 13:21 UTC

The captured-data audit found 9,940 of the first 10,000 jobs had completion strings
without a timezone. Previously a valid unzoned timestamp held the entire job at
review. The new projection separates usable job identity/status from timing
eligibility: after customer/site ownership is reviewed, it can link that job while
leaving the uncertain canonical timestamp null. Original source text and the
`timezone_required` classification remain in provenance metadata. Invalid dates,
unknown statuses, stale/conflicting sources and unresolved ownership remain held.
Nothing assigns a timezone, marks the job verified, attributes staff or awards pay.

- Additive migration `20261101250000_learn_commusoft_partial_job_times.sql` changes
  only the existing review function; execution grants/owner are retained. Existing
  canonical rows and immutable source versions are not backfilled or overwritten.
  Exact replays keep the same job and timing limitations. Closure does not imply
  a completion timestamp. A later timezone resolution still needs explicit review.
- The job card shows timing limitations. The performance evidence reader requests
  only the timing part of metadata, checks it against stored dates, and shows
  unknown or conflicting provenance instead of a guessed instant. Missing time
  is not a poor-performance score. Saved review batch receipts retain the same
  warning; linking a job does not attest timing quality.
- **40 focused client tests pass**, along with TypeScript and production build.
  Isolated PostgreSQL checks cover actual source-page publication, customer/site/
  job/card linkage, DST ambiguity, explicit offsets, absent dates, malformed dates,
  orphan holds, retry and preserved old source/canonical rows. Actual SQL job
  output passes the application's card and performance-evidence presentation.
- Full hosted TEST schema rehearsal passed at 13:14 UTC, including positive owner
  projection, normal signed-in job SELECT access, foreign-tenant RLS, replay and
  same-session demotion. All temporary synthetic records and banned passwordless
  fixture identities rolled back; no login/session or platform grant was issued.
  All **113 existing datasets** and original function definitions/grants were
  restored. The first attempt exposed a missing permission on the probe's temporary
  helper; correction did not alter application permissions. No real records were
  published and no provider requests or production changes occurred.
- Actual LEARN card browser verification with a simulated backend shows the
  completion-time warning, with zero console errors. TEST release 059 installed at
  13:16 UTC with all 113 datasets unchanged. The matching Git-built frontend was
  observed READY at 13:20 UTC; all three checked HTTP routes remain protected.
  Browser inspection of its new origin awaits explicit permission after automatic
  approval review rejected opening it. Real Drummonds publication and signed-in
  hosted browser acceptance remain open.
- The unchanged prepared Commusoft continuation passed read-only preflight against
  release 059 at 13:17 UTC. All 78 protected datasets still match the original
  refreshed baseline. No further baseline refresh, account, grant or provider
  request occurred. Its separate access approval is still pending.

[Evidence](evidence/learn-commusoft-partial-times-test-2026-10-11.json).

## Retained call detail — 11 October, 12:55 UTC

The older `/app#communications` call detail could pair the newest recording
transcript with an insight and corrections from a different transcript. The
reader now selects the insight's exact transcript ID within the same tenant and
recording. Missing source IDs remain missing; an interaction summary is never
silently substituted. Saved corrections are selected deterministically for that
same source. This linkage does not establish that the text still matches the
current audio: the legacy screen explicitly labels analysis, participants and
corrections as unverified and potentially out of date. The LEARN recording viewer
remains the separate reader with retained provenance checks.

- Hosted TEST `phone-call-detail` v1 is ACTIVE with JWT verification, response
  contract `phone-call-detail/2` and `Cache-Control: no-store`. It requires a real
  signed-in owner/admin/ops profile and confirms the call belongs to that tenant
  before detail reads or review writes. No new account or grant was created.
- Database read errors fail visibly, including review lookup. Failed review
  clearing no longer reports success. Invalid actions and request bodies above
  4,096 bytes fail before call access. Review remains a call-level receipt, not
  approval of a transcript version, source freshness or later analysis.
- The client validates the versioned response and requested call. The screen
  starts with saved raw text, disables corrected text when absent, shows review
  failures and discards responses arriving after another call opens. No saved
  summary is described as proof that processing is running.
- **12 focused tests passed** (eight actual handler, four response-contract).
  The eight handler cases also pass against downloaded deployed code; its three
  emitted syntax trees match the reviewed TypeScript. TypeScript and production
  build passed, including 47 repository prebuild checks.
- Actual local browser/component/client checks passed for delayed call switching,
  missing analysis, disabled absent correction, saved correction selection,
  failed detail clearing and failed review feedback; zero console errors. The
  backend was simulated for these browser checks.
- Actual TEST HTTP checks returned 401/401/403 for absent session, anonymous key
  and service impersonation, without call content. All **113 retained datasets**
  matched both deployment and HTTP before/after comparisons. No production changes,
  provider calls, new users or grants occurred.
- Signed-in positive hosted acceptance of this older call screen and review flow
  **remains outstanding**. The completed playback run is separate evidence and
  must not be reused after retirement. The matching protected TEST frontend
  `serviceos-learn-test-fpzgfbxtu-allkin.vercel.app` is READY at 12:56 UTC from
  `a5f2329369b50194be4bcad59f29d31157d2717a`. Exact TEST backend binding and
  three Vercel-protected routes passed. The actual `/app#communications` entry
  redirects to same-origin sign-in, with zero observed browser errors.

[Sanitized evidence](evidence/learn-call-detail-test-2026-10-11.json).

## Scoped scheduler health — 11 October, 14:29 UTC

- TEST package **060** is installed. The authenticated reader returns ten bounded,
  tenant-scoped scheduling summaries without granting browser access to raw logs,
  job payloads or source metadata. Own-company reads follow existing membership;
  cross-company reads require an effective OpenFolk grant. View-As is rejected.
- Full TEST-schema rehearsal and packaged rollback passed before installation.
  Membership removal, foreign-tenant access, revoked grants, View-As and role
  impersonation checks passed. All **113 retained datasets** matched before and
  after installation and HTTP checks; no synthetic users, grants or sessions remain.
- Actual anonymous/service-role HTTP requests were denied (401/403). A positive
  signed-in hosted check is **still outstanding**; SQL-role checks are not a
  substitute for that acceptance.
- The actual OpenFolk capture controller now includes scheduling checks. Failed,
  paused, late and unobserved activity remain distinct; recorded queue activity
  does not claim completed capture. Legacy LEARN/Ops also use the scoped reader.
  Failed reads show unverified status, and delayed replies cannot cross companies.
- Actual local component/browser checks passed with a synthetic RPC: failure,
  recovery and delayed company switching, with zero console errors. Six focused
  reader/outcome tests, application TypeScript and the production build passed.
  The matching TEST frontend from `aff42842d82ae228de3513a63cad73c2a91ff9a7`
  is now READY, observed at 14:35 UTC, at
  `serviceos-learn-test-b5u66qgft-allkin.vercel.app`. Exact TEST project, Git SHA,
  backend binding and Vercel protection configuration were checked through the
  management API. Browser access to this updated origin has been requested;
  positive signed-in hosted acceptance remains unverified.
- Commusoft's prepared continuation preflight passed against the new TEST catalog
  at 14:21 UTC. Its original source baseline, request budget and approval requirement
  remain intact; no continuation account or provider request was created.
- Email scheduler installation/secure triggers, real input capture, hosted
  acceptance and production promotion remain separate unfinished gates. No key or
  password was created, reset or saved during this checkpoint.

[Sanitized evidence](evidence/learn-scheduler-health-test-2026-10-11.json).

## Release and completion gates

- [ ] Keep meaningful checkpoints on GitHub `codex/learn-v1-test`; verify exact
  remote SHA. Source backup excludes secrets, private manifests and customer files.
- [ ] Rehearse the complete additive migration/runtime/frontend combination on
  the actual TEST schema; preserve before/after source identity evidence.
- [ ] Pass the repository's release commands (`npm install`, `npx tsc --noEmit`,
  `npm run build`) and verify required routes, matching API project, sign-in,
  permissions and browser console. Use [deployment requirements](../DEPLOYMENT.md).
- [ ] Complete the [production release plan](LEARN-V1-PRODUCTION-RELEASE.md), including deployment sequence, rollback, credentials recovery, monitoring,
  incident handling, unresolved provider limits and operating ownership.
- [ ] Present concrete acceptance evidence and obtain Chris's production approval.
- [ ] Deploy through Vercel/Git and the separate reviewed Supabase release; verify
  the actual production domain/redirect chain, deployed versions, real signed-in
  journeys and initial capture/monitoring. Do not promote a TEST-configured frontend.
- [ ] Refresh preservation evidence and prove recovery after the final release.
- [ ] Audit every requirement in the goal against evidence. All outstanding
  requirements remain incomplete unless Chris explicitly agrees a scope change.

The goal remains active. A successful local test, catalog read, deployment or
provider page does not by itself establish readiness for launch.
