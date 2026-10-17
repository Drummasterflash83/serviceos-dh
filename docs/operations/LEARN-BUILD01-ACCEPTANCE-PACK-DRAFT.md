# LEARN Build 01 — Drummonds acceptance pack (draft)

**Status at 17 October 2026, 08:19 UTC: not ready for business sign-off.**
This is a short index to the current evidence, not a claim that Build 01 is
complete. Chris waived waiting for a full working day; enough representative
real data and reliable unattended operation are still required. Build 02 stays
inactive until Chris reviews and signs off the business result.

## Working and verified

- LIVE retained **4,676 Phone calls with 4,676 interactions**, and no eligible
  interaction lacked a Graph node in the 07:04 read. Email has 1,595 eligible
  unlinked source messages, all retained less than a day ago and none with an
  event date in the last week; the ordinary projector remains active.
  [Current coverage receipt](evidence/learn-build01-source-coverage-2026-10-17.json).
- The ordinary Email update chain committed **26,050 unchanged receipts for
  26,048 distinct sources** by 06:37. Two sources were updated between their
  first and second unchanged receipts without changing canonical revision;
  these are fresh metadata updates, not proof of a queue replay. The chain is
  still running. [Timestamp-only receipt](evidence/learn-build01-email-repeat-explanation-2026-10-17.json).
- A separate read-only audit classified all **19,128** legacy linked Email
  interactions. The guarded owner-only TEST/LIVE adoption then preserved all
  historical connector labels and canonical fields while assigning immutable
  source receipts to **19,048** exact equivalents. A separate guarded pass
  superseded 13 current, machine-generated legacy holds after TEST/LIVE
  rollback rehearsals. **19,061** are adopted; 67 remain untouched: 55
  historical draft-type differences and 12 missing sources. Current Email
  projection review holds are zero. Most legacy links lie inside the approved
  three-year horizon.
  [Classification](evidence/learn-build01-email-legacy-alias-classification-2026-10-17.json),
  [adoption readback](evidence/learn-build01-email-legacy-adoption-2026-10-17.json),
  [hold-resolution readback](evidence/learn-build01-email-legacy-hold-resolution-2026-10-17.json).
- The 160 approved public Slack channels have enabled channel/reply
  subscriptions and completed historical campaign handoff. All **180**
  approved public channels have valid account/connection bindings to one exact
  signed Events receiver. The separate 20-channel public roster supplied four
  settled real hints, saved source and an ordinary post-fix reply settled in
  **32 seconds**. DMs remain excluded. This proves the shared route but not
  an exact-160 real Event. [Shared-route receipt](evidence/learn-build01-slack-shared-events-boundary-2026-10-17.json).
- The signed-in LIVE Drummonds dashboard now displays **37,863 saved Slack
  messages**, with a clear saved-history caveat. Its evidence browser loaded
  25 public observations on the first page and returned to the dashboard.
  This resolves the earlier “Not checked” tile display, while the separate
  Slack notification status remains unconfirmed.
  [Signed-in receipt](evidence/learn-build01-signedin-slack-dashboard-2026-10-17.json).
- In the exact 160-channel roster, **1,335** provider-completed recurring
  windows have saved empty page receipts, spanning all 160 channels. An exact
  failed zero-page window was recovered on attempt two, and a bounded automatic
  retry guard for this failure class was installed after TEST/LIVE rollback
  rehearsals. [Window receipt](evidence/learn-build01-slack-160-empty-window-checks-2026-10-17.json),
  [recovery receipt](evidence/learn-build01-slack-unclassified-recovery-2026-10-17.json).
- The scheduled database backup produced an independent verified copy on its
  16 October **08:14 UTC scheduled** run; its scheduled missed-success monitor
  passed at **14:03 UTC**. A second genuinely **scheduled** run on 17 October
  completed at **08:09 UTC**: native restore, encrypted private London copy,
  separate Restore-identity byte readback and runner cleanup passed. Its
  1,638,226,616-byte ciphertext was not decrypted; today's missed-success
  monitor is not due until 09:23 UTC.
  [Scheduled run receipt](evidence/learn-build01-scheduled-database-backup-2026-10-17.json).
  The 17 October three-bucket communication inventory verified
  **3,166 phone objects** and **257 matched voicemail source/audio pairs**, with
  no missing referenced object. The local file runner still requires the Mac
  and Codex app awake. [File backup proof](evidence/learn-build01-communication-backup-2026-10-17.json).
- An isolated archive rehearsal restored database, Auth and PostgREST, created
  a disposable synthetic login, and exercised one archived Edge route with
  tenant and operator boundaries. The current v107 LIVE source was captured,
  encrypted, copied off site and downloaded through the separate Restore
  identity with matching bytes and hash. All **103 current Edge function trees**
  rebuilt in isolated containers. A current v107 route served an authenticated
  tenant read against the older independent archive and disposable Auth;
  tenant/card isolation and operator revocation passed.
  [Current route rehearsal](evidence/learn-build01-v107-isolated-recovery-2026-10-17.json).
  [Recovery inventory](LEARN-BUILD01-APPLICATION-RESTORE-INVENTORY.md).
- A later isolated rehearsal also reset one preserved Drummonds account **only
  in the disposable database**. A fresh recovered Auth login read tenant cards
  and called the current v107 Edge route; tenant isolation and operator
  revocation still passed. It sent no email and changed no production
  credential. [Preserved-user receipt](evidence/learn-build01-existing-user-recovery-2026-10-17.json).
- A new **07:09 UTC read-only LIVE snapshot** produced a private 1.63 GB native
  archive of 424 tables, including the newer Commusoft job and Slack hint
  tables. Its bytes/hash passed before an isolated restore. From this fresh
  local point, the preserved-user fresh login, five tenant cards, current v107
  LEARN Edge read, unassigned-user isolation and audited operator revocation
  passed again. All recovery containers were removed; there was no Touch ID,
  production write, host port or external service access.
  [Current-point receipt](evidence/learn-build01-current-point-service-recovery-2026-10-17.json).
- A second isolated native comparison matched **5,950,101 archived COPY rows**
  across 421 tables, seven sequences, the two separately captured network
  tables and their sequence, catalog and extension versions. The automatic
  phone-file backup observed after the database point covered all **3,160**
  restored recording references by object/version/path/size; one backed-up
  recording downloaded and decoded. Its six extra objects have no recording
  reference in this database point. The two voicemail buckets of that same
  communication run finished by 08:19 UTC with 257 matched pairs.
  [Database/file receipt](evidence/learn-build01-current-database-file-recovery-2026-10-17.json).
- The current v107 worker also booted from its reviewed bundle in an isolated
  network-disabled container, returned OPTIONS 200 and rejected an
  unauthorised POST with 403. This is startup and fail-closed evidence, not an
  authenticated capture restart.
  [Startup receipt](evidence/learn-build01-v107-worker-isolated-startup-2026-10-17.json).
- The ordinary stable-cutoff customer-card sweep finished with a successful
  zero-card terminal job at 06:11, and a 06:12 LIVE readback found **zero stale
  unprojected cards**. [Sweep receipt](evidence/learn-build01-card-ordinary-sweep-2026-10-17.json).
- Source-backed review filters for recorded holds and unresolved open jobs
  passed TEST/LIVE rehearsals and are installed. The narrow frontend release
  `77a73802` passed both Vercel production builds; all four LIVE aliases serve
  its job-view asset. The signed-in Drummonds LIVE page returned **69** recorded
  holds and **285** source-review matches, with example source timestamps and
  caveats shown in the rendered rows.
  [Release receipt](evidence/learn-build01-job-source-attention-2026-10-17.json).
- All **1,004** reviewed published Commusoft jobs use their latest effective
  retained source version. An aggregate field check of all 12,656 saved jobs
  found group identifiers, but no individual-assignee or appointment field.
  [Coverage receipt](evidence/learn-build01-commusoft-coverage-2026-10-17.json).

## Needs finishing

- **Slack freshness:** 67 of the exact 160 channels were more than a day
  behind at 06:45. The previously dead-lettered window is now completed and
  no current window was dead-lettered at 06:46. Yet no post-cutoff message,
  reply or signed hint has been saved in this exact roster. All 1,335 checked
  provider windows were empty; 61 channels lacked a completed window ending
  in the prior 12 hours. The latest retained source activity is from 30 August,
  with none in the 30 days before handoff. This supports checked absence in
  completed windows. The shared signed receiver and all 180 current bindings
  are verified, while actual Event delivery for the quiet 160 remains
  unobserved. The proven post-fix real Event was a reply in the separate
  public roster; a new ordinary parent-message event has not yet been observed.
  [Exact-roster proof](evidence/learn-build01-slack-160-postcutoff-2026-10-16.json).
- **Jobs and attention:** Commusoft retained 12,656 job identities and 295
  recorded open/pending/on-hold jobs. Only ten of those had reviewed job-card
  links; 285 did not. At 22:31, 272 of the 295 had no observation within a day.
  The released captured-source view now has explicit hold and source-review
  filters, and signed-in LIVE example rows passed. Named-person handoff and a
  representative progress/completion score are not established. The saved
  job collection alone cannot identify an individual recipient; the existing
  source-review queue is the truthful current route.
  [Policy draft](LEARN-BUILD01-JOB-ATTENTION-DRAFT.md).
- **Email review and history:** the 55 historical drafts and 12 source-missing
  links require separate provenance treatment. A draft must not be represented
  as verified sent mail. The 1,595 current eligible unlinked sources are all
  historical by event date; the changed-source update lane is still running
  and has not drained.
- **Recovery:** The serving v107 Edge source has a fresh encrypted off-site
  copy and separate readback, and all 103 functions rebuild from locally staged
  source. One current route has served recovered synthetic and preserved-user
  authenticated tenant requests, the latter after a disposable password reset.
  A separate fresh local database point now passes the same restored-service
  journey, but the full frontend, all-function startup, required runtime
  secrets, original-session recovery and controlled capture restart have not
  been proven from independently downloaded current recovery inputs. The
  database point matches a later verified phone-file inventory and all three
  file buckets completed. An atomic database/file point remains unproven.
- **File-backup host:** the recording and voicemail schedule has succeeded
  locally, but depends on the Mac and Codex app being awake. The latest
  three-bucket inventory is a verified file copy, not a matching database
  restore or proof of an always-on hosted backup service.

## Blocked externally

- No user action is needed for the ordinary card or Slack recovery checks.
  Chris's business acceptance will be
  requested **after** the technical pack is ready. No full-working-day elapsed-time
  wait is being imposed.

The proposed business check for Chris is whether a held job and a newly
progressed job surface with truthful source timestamps, go to the right
reviewer, move after a verified handoff, and show completion without inventing
timing or a score. Chris decides whether that result serves Drummonds; the
agent does not sign off on his behalf.
