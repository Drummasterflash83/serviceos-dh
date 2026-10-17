# LEARN Build 01 — Drummonds acceptance pack (draft)

**Status at 17 October 2026, 06:42 UTC: not ready for business sign-off.**
This is a short index to the current evidence, not a claim that Build 01 is
complete. Chris waived waiting for a full working day; enough representative
real data and reliable unattended operation are still required. Build 02 stays
inactive until Chris reviews and signs off the business result.

## Working and verified

- LIVE retained **4,676 Phone calls with 4,676 interactions**, and no eligible
  Email messages lacked interactions in the 22:34 read. No eligible interaction
  lacked a Graph node. [Current technical tracker](LEARN-V1-COMPLETION.md).
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
  subscriptions and completed historical campaign handoff. A separate approved
  20-channel public roster supplied real signed Events, saved source and an
  ordinary post-fix reply settled in **32 seconds**. DMs remain excluded.
  [Events proof](evidence/learn-build01-slack-events-live-2026-10-16.json).
- In the exact 160-channel roster, **1,318** provider-completed recurring
  windows have saved empty page receipts, spanning all 160 channels. An exact
  failed zero-page window was recovered on attempt two, and a bounded automatic
  retry guard for this failure class was installed after TEST/LIVE rollback
  rehearsals. [Window receipt](evidence/learn-build01-slack-160-empty-window-checks-2026-10-17.json),
  [recovery receipt](evidence/learn-build01-slack-unclassified-recovery-2026-10-17.json).
- The scheduled database backup produced an independent verified copy on its
  **08:14 UTC scheduled** run; the scheduled missed-success monitor passed at
  **14:03 UTC**. The refreshed three-bucket communication inventory verified
  **3,166 phone objects** and **257 matched voicemail source/audio pairs**, with
  no missing referenced object. [File backup proof](evidence/learn-build01-communication-backup-refresh-2026-10-16.json).
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
- The ordinary stable-cutoff customer-card sweep finished with a successful
  zero-card terminal job at 06:11, and a 06:12 LIVE readback found **zero stale
  unprojected cards**. [Sweep receipt](evidence/learn-build01-card-ordinary-sweep-2026-10-17.json).

## Needs finishing

- **Slack freshness:** 67 of the exact 160 channels were more than a day
  behind at 06:12. The previously dead-lettered window is now completed and
  no current window was dead-lettered at 06:14. Yet no post-cutoff message,
  reply or signed hint has been saved in this exact roster. All 1,318 checked
  provider windows were empty; 50 channels lacked a completed window ending
  in the prior 12 hours. The latest retained source activity is from 30 August,
  with none in the 30 days before handoff. This supports checked absence in
  completed windows, but near-live capture and real Event delivery for this
  roster remain unproven. The proven post-fix real Event was a reply in the
  separate public roster; a new ordinary parent-message event has not yet been observed.
  [Exact-roster proof](evidence/learn-build01-slack-160-postcutoff-2026-10-16.json).
- **Jobs and attention:** Commusoft retained 12,656 job identities and 295
  recorded open/pending/on-hold jobs. Only ten of those had reviewed job-card
  links; 285 did not. At 22:31, 272 of the 295 had no observation within a day.
  The captured-source view shows them honestly, but named-person handoff and
  a representative progress/completion score are not established.
  [Policy draft](LEARN-BUILD01-JOB-ATTENTION-DRAFT.md).
- **Email review and history:** the 55 historical drafts and 12 source-missing
  links require separate provenance treatment. A draft must not be represented
  as verified sent mail. The changed-source update lane is still running and
  has not drained.
- **Recovery:** The serving v107 Edge source has a fresh encrypted off-site
  copy and separate readback, and all 103 functions rebuild from locally staged
  source. Only one current route has served a recovered authenticated tenant
  request. Full frontend, all-function startup, required runtime secrets,
  real-user/Auth recovery and controlled capture restart have not been proven
  from independent recovery inputs. The isolated database archive also predates
  current source; its point is not reconciled with current file backups.
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
