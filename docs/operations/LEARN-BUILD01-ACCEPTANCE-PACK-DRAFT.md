# LEARN Build 01 — Drummonds acceptance pack (draft)

**Status at 17 October 2026, 05:49 UTC: not ready for business sign-off.**
This is a short index to the current evidence, not a claim that Build 01 is
complete. Chris waived waiting for a full working day; enough representative
real data and reliable unattended operation are still required. Build 02 stays
inactive until Chris reviews and signs off the business result.

## Working and verified

- LIVE retained **4,676 Phone calls with 4,676 interactions**, and no eligible
  Email messages lacked interactions in the 22:34 read. No eligible interaction
  lacked a Graph node. [Current technical tracker](LEARN-V1-COMPLETION.md).
- The ordinary Email update chain committed **23,650 unchanged receipts for
  23,650 distinct sources** by 05:48, with no repeated source in that window.
  It is still running. [Current technical tracker](LEARN-V1-COMPLETION.md).
- The 160 approved public Slack channels have enabled channel/reply
  subscriptions and completed historical campaign handoff. A separate approved
  20-channel public roster supplied real signed Events, saved source and an
  ordinary post-fix reply settled in **32 seconds**. DMs remain excluded.
  [Events proof](evidence/learn-build01-slack-events-live-2026-10-16.json).
- The scheduled database backup produced an independent verified copy on its
  **08:14 UTC scheduled** run; the scheduled missed-success monitor passed at
  **14:03 UTC**. The refreshed three-bucket communication inventory verified
  **3,166 phone objects** and **257 matched voicemail source/audio pairs**, with
  no missing referenced object. [File backup proof](evidence/learn-build01-communication-backup-refresh-2026-10-16.json).
- An isolated archive rehearsal restored database, Auth and PostgREST, created
  a disposable synthetic login, and exercised one archived Edge route with
  tenant and operator boundaries. The v104 Edge source was independently copied
  off-site and read back. A later v106 source inventory was locally staged; the
  changed v107 worker passed TEST, isolated startup and its first LIVE batch.
  The current v107 LIVE source has been captured, encrypted and locally
  staged as 103 verified function trees, then copied off site and downloaded
  through the separate Restore identity with matching bytes and hash.
  [Recovery inventory](LEARN-BUILD01-APPLICATION-RESTORE-INVENTORY.md).

## Needs finishing

- **Cards:** All 4,181 active cards had a projection by the 05:48 readback.
  The ordinary scheduler had advanced 3,960 cards past its stable cutoff with
  221 still before it. The earlier failed job remains in the audit history.
  Observe the final sweep batch before closing this gate.
  [Release and continuation proof](evidence/learn-build01-card-phase-release-2026-10-16.json).
- **Slack freshness:** 63 of the exact 160 channels were more than a day
  behind at 05:48, and one recurring window was dead-lettered with a generic
  `slack_history_failed` code. No post-cutoff message, reply or signed hint had
  been saved in that exact roster at 05:49. Its latest retained source activity is from
  30 August, with none in the 30 days before handoff. That makes a quiet roster
  plausible but does not prove provider delivery. The proven post-fix real
  Event was a reply in the separate public roster; a new ordinary
  parent-message event has not yet been observed.
  [Exact-roster proof](evidence/learn-build01-slack-160-postcutoff-2026-10-16.json).
- **Jobs and attention:** Commusoft retained 12,656 job identities and 295
  recorded open/pending/on-hold jobs. Only ten of those had reviewed job-card
  links; 285 did not. At 22:31, 272 of the 295 had no observation within a day.
  The captured-source view shows them honestly, but named-person handoff and
  a representative progress/completion score are not established.
  [Policy draft](LEARN-BUILD01-JOB-ATTENTION-DRAFT.md).
- **Email review and history:** thirteen existing review holds accompany the
  update chain. Some 19,128 legacy linked Email interactions lack a projection
  revision and need a separate reviewed reconciliation; the current update
  lane must not silently rewrite them. The full changed-source backlog has not
  yet drained.
- **Recovery:** The serving v107 Edge source has a fresh encrypted off-site
  copy and separate readback. Full frontend, all 103
  Edge functions, required runtime secrets, real-user/Auth recovery and a
  controlled capture restart have not been proven from independent recovery
  inputs. Byte copies and the one-route isolated rehearsal do not close this.
- **File-backup host:** the recording and voicemail schedule has succeeded
  locally, but depends on the Mac and Codex app being awake. The latest
  three-bucket inventory is a verified file copy, not a matching database
  restore or proof of an always-on hosted backup service.

## Blocked externally

- No user action is needed for the unattended card continuation. The prepared
  v106 package was superseded without copying it; the current v107 exact copy
  and readback are complete. Chris's business acceptance will be
  requested **after** the technical pack is ready. No full-working-day elapsed-time
  wait is being imposed.

The proposed business check for Chris is whether a held job and a newly
progressed job surface with truthful source timestamps, go to the right
reviewer, move after a verified handoff, and show completion without inventing
timing or a score. Chris decides whether that result serves Drummonds; the
agent does not sign off on his behalf.
