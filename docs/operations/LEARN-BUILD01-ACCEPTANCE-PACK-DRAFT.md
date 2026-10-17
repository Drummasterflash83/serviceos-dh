# LEARN Build 01 — Drummonds acceptance pack (draft)

**Status at 17 October 2026, 13:40 UTC: not ready for business sign-off.**
This is a short index to the current evidence, not a claim that Build 01 is
complete. Chris waived waiting for a full working day; enough representative
real data and reliable unattended operation are still required. Build 02 stays
inactive until Chris reviews and signs off the business result.

## Working and verified

- The ordinary LIVE worker cleared the final stale card without a targeted
  manual job: **4,182/4,182** active cards now have projections, and the
  latest completed ten-card batch reported zero failures. The earlier full
  ordinary sweep also completed at 06:11. This closes the initial unattended
  card-sweep proof; continuing freshness remains an operating check.
  [Zero-stale receipt](evidence/learn-build01-card-ordinary-zero-stale-2026-10-17.json).

- A bounded read-only Slack provider query found a known retained reply in
  the separate approved active 20-channel roster. That positive control
  validates the method being used to check older threads in the exact 160
  archived public channels; it does not complete that larger audit.
  [Control receipt](evidence/learn-build01-slack-reply-provider-positive-control-2026-10-17.json).

- Current LIVE Edge source has one post-v107 change: `openfolk-control-plane`
  v37→v38. A small reviewed Git patch reconstructs all 24 current Control
  Plane files from the pinned v107 archive that underlies the independently
  downloaded off-site package;
  the three changed-file hashes match the serving runtime and the other 21
  retain their archived hashes. This avoids repeating a whole-source backup
  for a small release. It does not recover credentials or prove a provider
  restart. [Source overlay receipt](evidence/learn-build01-controlplane-v38-overlay-2026-10-17.json).
- That reconstructed v38 source also bundled and started in an isolated Edge
  runtime, answering synthetic OPTIONS with HTTP 200; no network or real
  credential was available at startup. This tests the current module's boot
  path, while authenticated recovery and real-provider resumption remain open.
  [Offline startup receipt](evidence/learn-build01-controlplane-v38-offline-startup-2026-10-17.json).

- The ordinary Commusoft worker completed **872/872** approved work-address
  contact targets, with the final job succeeded and checkpoint marked complete.
  At 11:54 UTC the recurring scheduler verified the four-stage cycle, advanced
  its watermark to 05:11 UTC and remained enabled for the next cycle. The
  separate current-jobs lane had a completed receipt at 11:48 UTC. This closes
  the stalled contact traversal without treating the retry alone as success.
  [Full-cycle receipt](evidence/learn-build01-commusoft-full-cycle-2026-10-17.json).

- A fresh TEST/LIVE readback verified the source-job reader and its later
  approved attention-filter patch. LIVE still has 295 recorded open jobs and
  1,004 reviewed canonical job links; **29 open jobs lack a retained property
  or customer source relationship**. They remain visible for source review,
  without inferred ownership or completion.
  [Coverage receipt](evidence/learn-build01-commusoft-current-source-coverage-2026-10-17.json).

- A counts-only handoff audit found eight active Drummonds team entries but
  **zero confirmed members**, zero signed-in confirmed recipients and zero
  signed-in members with confirmed `work.assign` authority. The existing
  OpenFolk roster can confirm a *formal title* separately; that does not
  establish member identity for a named work assignment. No job was routed to
  an inferred person. [Read-only check](../../scripts/verify/learn-build01-job-handoff-readiness.mjs).

- Chris chose the existing Owner / MD login for the first OpenFolk job-review
  handoff. The exact roster-to-login link is current but still unconfirmed.
  Audited identity confirmation and source-linked review-task controls passed
  isolated SQL tests, rollback rehearsals, and TEST/LIVE install readback.
  TEST Control Plane v28 and LIVE v38 carry the targeted route; the stricter
  LIVE View-As authorization guard was preserved byte-for-byte. Both routes
  denied unauthenticated writes. No member was confirmed, review task made or
  work assigned by these installation checks.
- The five-file handoff frontend is now READY on protected TEST from Git
  `6bdf59e7`, retaining its TEST-only changes and TEST backend. Its two existing
  aliases and protection were read back. The matching LIVE change was
  fast-forwarded to `main` as `702408a4`; Vercel's READY production deployment
  now serves all four existing LIVE aliases with the LIVE backend. Both builds,
  typechecks and 47 prebuild checks passed. Public LIVE login and client-entry
  routes returned HTTP 200. This releases the controls but does not claim a
  signed-in handoff. [Release receipt](evidence/learn-build01-handoff-frontend-release-2026-10-17.json).

- The approved one-time LIVE Edge credential inventory now contains 11 active
  Build 01 settings, each checked against its LIVE digest. A synthetic hosted
  TEST rehearsal passed first. The LIVE temporary route was removed after
  sealing, and other function versions were unchanged. The **5,094-byte** age
  ciphertext was uploaded to the existing private London bucket and the exact
  stored version downloaded with a separate Restore identity; bytes and hash
  matched. No plaintext file, provider call or production data write occurred.
  A downloaded-package decrypt and authenticated provider restart are still
  separate checks. One recovery-only 1Password read ended unconfirmed; it did
  not read the key and will not be repeated in a prompt loop.
  [Off-site receipt](evidence/learn-build01-edge-credential-offsite-2026-10-17.json).
- All **62** configured LIVE Edge names now have an explicit disjoint recovery
  classification. Fifty-six map to Vault, the new package, replacement-project
  rebinding or reviewed non-secret controls. Five other configured provider
  bindings remain outside the exact package, and the one global Workspace
  subject has no current-source read. This names-only inventory does not prove
  private-key restore or provider restart.
  [Coverage receipt](evidence/learn-build01-edge-recovery-coverage-2026-10-17.json).
- A fresh names-only LIVE/source readback confirms all five additional
  configured bindings are used by current marketing or receptionist paths;
  Drummonds' receptionist workspace points to both dynamic secret names.
  They are outside the approved eleven-setting package, so a full application
  restore remains incomplete. The five-name sealed route passed synthetic
  hosted TEST with wrong-nonce denial and cleanup; no LIVE value was read.
  [Exact-scope review](LEARN-BUILD01-ADDITIONAL-RUNTIME-CREDENTIAL-REVIEW.md) ·
  [TEST receipt](evidence/learn-build01-additional-edge-seal-test-2026-10-17.json) ·
  [readback](evidence/learn-build01-additional-edge-binding-use-2026-10-17.json).

- A single authority-read failure had stranded the approved Commusoft
  work-address contact run at 516/872 properties. The unchanged-scope retry
  passed rollback rehearsals and installed on TEST and LIVE; its one-time,
  exact-job recovery resumed normal worker capture at **517/872**, with the
  next page running. A later 11:32 read found **663/872** completed and the
  approval still in scope. The operator UI's unconfirmed request was cancelled.
  The ordinary worker subsequently completed all targets and the scheduler
  closed the cycle, as verified above. [Recovery receipt](evidence/learn-build01-commusoft-authority-retry-2026-10-17.json).

- Slack itself returned **no parent message at or after the handoff cutoff**
  from any of the exact 160 saved public channels. Every channel passed a
  current public/archived check and a bounded `conversations.history` check;
  no channel or provider call failed. This replaces the earlier ambiguous
  “no verified event” observation with provider-confirmed parent absence at
  11:03 UTC. It does not prove reply absence or finish the saved thread
  catch-up. [Provider receipt](evidence/learn-build01-slack-160-provider-postcutoff-2026-10-17.json).

- The existing Drummonds Slack app's signing secret matched the active LIVE
  Edge digest in memory. This identifies its exact recovery source without an
  app change, key rotation or credential output. The later sealed package now
  includes this exact digest-matched setting; replacement-route testing remains.
  [Source receipt](evidence/learn-build01-slack-signing-secret-source-2026-10-17.json).

- A fresh shape check of all 12,732 retained Commusoft job versions found only
  `self` and `property` link keys, plus group fields. Existing job payloads
  cannot support a named technician handoff; the held source-review treatment
  remains accurate. [Aggregate receipt](evidence/learn-build01-commusoft-job-links-shape-2026-10-17.json).

- A noninteractive, digest-only TEST/LIVE comparison found three matching
  bindings among 16 reviewed credential/webhook names. Two differ and eleven
  are LIVE-only, so the existing TEST environment is not a substitute for an
  independent protected credential copy. No values were read or provider
  calls made. [Sanitised comparison](evidence/learn-build01-test-live-edge-digest-overlap-2026-10-17.json).

- The ordinary LIVE card chain completed a full stable sweep at 06:11 UTC on
  its first attempt, and the 06:12 readback found zero stale unprojected cards.
  The next rolling sweep is continuing without rescue; the completed sweep is
  already the unattended-cycle proof, while current-card freshness is a separate
  ongoing check. At 10:23, 4,181/4,182 active cards were projected and 1,685
  remained before the current sweep cutoff. [Completed sweep](evidence/learn-build01-card-ordinary-sweep-2026-10-17.json).

- The earlier exact-item read located only three of ten required settings.
  The sealed LIVE runtime export completed the eleven-setting inventory without
  recurring credential-console or Touch ID work. The earlier partial local
  ciphertext was not used for the off-site copy.
  [Earlier inventory](evidence/learn-build01-scoped-credential-inventory-2026-10-17.json).
- The independently downloaded scheduled database and v107 Edge source passed
  an additional isolated Auth re-entry drill. Old refresh and differently
  signed access tokens were rejected after invalidating disposable restored
  sessions; a fresh preserved-user login, tenant cards and audited operator
  boundaries passed. No LIVE account changed.
  [Auth receipt](evidence/learn-build01-auth-session-reentry-2026-10-17.json).

- Direct, bounded Slack provider metadata checks covered both exact approved
  public rosters: **160/160 channels in the older campaign are archived**;
  **20/20 channels in the separate current campaign are active**, with the
  saved user marked a member of 16. Bounded read-only history access passed
  for the other four public channels. No bodies, DMs or private channels were
  returned. The 160's empty near-live ledger is therefore not evidence that an
  active current channel failed. Its historical catch-up remains necessary
  until the post-cutoff intervals settle. [Roster receipt](evidence/learn-build01-slack-provider-roster-state-2026-10-17.json).

- An exact v107 source-use audit found the old global Workspace subject has no
  current literal environment read; the live Email path uses the backed-up
  tenant connection row. The Google OAuth client ID remains active, the
  Workspace client ID is optional for connection setup, and no non-Vault Edge
  value matched a Vault secret under a different name. This narrows the
  recovery inventory without silently removing active credentials.
  [Source-use receipt](evidence/learn-build01-runtime-credential-usage-2026-10-17.json).

- All **103 reviewed LIVE v107 Edge bundles** created workers and returned
  synthetic HTTP responses in a network-isolated disposable runtime. Three
  QuickBooks routes correctly returned 503 without provider configuration;
  the other 100 responded without it. The container was removed. This proves
  current source module startup, not recovered credentials or real capture.
  [Offline startup receipt](evidence/learn-build01-v107-all-edge-offline-startup-2026-10-17.json).

- Current read-only reliability checks show **zero Email delegation holds**,
  two ordinary safe claims, **4,676/4,676** Phone calls linked to interactions,
  and zero eligible Graph gaps. Commusoft's changed-job pages are still
  arriving, and its deeper contact traversal has now completed. The card sweep
  continues unaided; the exact 160 Slack roster has zero current dead letters
  and only empty provider-completed windows. Today's database backup has four
  successful **scheduled** runs; its separate missed-success monitor has not
  yet appeared today, which is not a pass or a failure.
  [Aggregate cutline](evidence/learn-build01-source-reliability-2026-10-17-1009.json).

- A 10:07 digest-only reconstruction matched 18 non-secret LIVE Edge controls
  to reviewed release values and three Workspace controls to a pre-snapshot
  tenant row. This narrows the credential recovery package without reading or
  copying provider keys. Seven Supabase project bindings must be reissued on
  replacement; three Google controls and the needed credential subset remain
  to verify. [Receipt](evidence/learn-build01-nonsecret-runtime-reconstruction-2026-10-17.json).

- A digest-only 09:57 readback found **62** configured LIVE Edge entries and
  **20** recoverable Vault entries. All **15** names shared by Edge and Vault
  matched active-value hashes; no Vault row changed after the scheduled backup
  snapshot. The remaining **47** configured Edge names are outside Vault,
  spanning public/platform settings and independent sensitive credentials.
  Supabase exposes their hashes, not restorable values. This narrows the
  recovery gap without claiming all-function startup.
  [Secret recovery map](evidence/learn-build01-runtime-secret-restore-map-2026-10-17.json).

- A 09:52 LIVE attribution cutline preserves the distinct denominators:
  **4,676/4,676** Phone calls have interactions and eligible interaction-to-
  Graph gaps are zero. Email has **150,255 enriched interactions** and
  **42,741** visible identity-review interactions; Slack has **seven enriched**
  and **35,051** held with direction unverified. Commusoft has **12,656**
  retained job identities and **1,004** reviewed canonical links. A source
  message or reviewed link is not the same as a verified assignment or score.
  [Attribution cutline](evidence/learn-build01-source-attribution-cutline-2026-10-17.json).

- The independently downloaded scheduled off-site database and current v107
  Edge package now support a **connected signed-in frontend rehearsal**. The
  last verified LIVE Git frontend rebuilt for Vercel with only an ephemeral
  localhost backend and public key. A synthetic tenant user signed in through
  recovered Auth in a disposable browser profile, reached the client LEARN
  route, read five tenant cards and received current Phone/Email Edge status.
  A preserved Drummonds account then completed the same browser journey after
  a reset only in the disposable copy, using the login page's existing safe
  client redirect. The browser profiles, loopback proxies and all recovery
  containers were removed. This is a bounded connected journey, not full
  application failover.
  [Browser recovery receipt](evidence/learn-build01-connected-frontend-offsite-recovery-2026-10-17.json).

- The current alternative operating check uses the existing signed Slack
  Events receiver for new activity, provider-completed windows for checked
  historical absence, and the ordinary card worker for unattended projection.
  At 09:27, all 160 approved public channels had a completed provider window:
  **1,410/1,410 completed windows were empty**, with zero current dead letters.
  The installed LIVE fallback already uses bounded **72-hour catch-up windows**
  when a channel is over a day behind. Replacing it with the older checked-in
  15-minute definition would make catch-up worse. This is a truthful quiet-source
  result, not proof that a real message from this exact roster has reached LEARN.
  [Aggregate cutline](evidence/learn-build01-alternative-operating-cutline-2026-10-17.json).

- A fresh 09:06 UTC LIVE read shows **4,181 of 4,182 active cards projected**.
  The ordinary card worker recorded **60 successful jobs and no failures in the
  preceding hour**; one older unprojected card still has 2,342 cards ahead of it
  in the stable sweep. Email has **33,500 unchanged source receipts** and both
  current mailbox aliases are ready. Phone remains 4,676/4,676 and eligible
  interaction-to-Graph gaps remain zero.
  [Fresh aggregate receipt](evidence/learn-build01-fresh-operating-cutline-2026-10-17.json).

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
  signed Events receiver. The separate 20-channel active public roster now has
  **two real parent and two real reply Events** whose signed hints, exact
  retained source versions and canonical interactions all match. The four
  interactions remain in identity review, so no customer/job attribution is
  claimed. One post-fix reply settled in **32 seconds**. DMs remain excluded.
  This proves parent and reply capture on the shared route, but not a real
  post-cutoff Event in the archived 160.
  [Source-to-interaction receipt](evidence/learn-build01-slack-active-events-source-interactions-2026-10-17.json),
  [shared-route receipt](evidence/learn-build01-slack-shared-events-boundary-2026-10-17.json).
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
  hosted run did not decrypt its 1,638,226,616-byte ciphertext. The 17 October
  **scheduled** missed-success monitor then passed at 13:03 UTC, including its
  check for a successful independent copy; a separate scheduled backup also
  passed at 11:45 UTC. This establishes today's unattended backup/monitor pair,
  not full application/Auth recovery or alert delivery to a human.
  A local use of the separate Restore-only identity then downloaded that
  exact immutable version in bounded ranges and matched the complete SHA-256.
  No recovery key was read.
  [Scheduled run receipt](evidence/learn-build01-scheduled-database-backup-2026-10-17.json),
  [scheduled monitor readback](evidence/learn-build01-scheduled-backup-monitor-2026-10-17.json),
  [independent download](evidence/learn-build01-scheduled-offsite-download-2026-10-17.json).
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
- A single recovery escrow read then decrypted **today's independently
  downloaded scheduled database package** and the current v107 off-site Edge
  package. All **5,960,241** archived COPY rows, seven sequences, two network
  tables and their sequence matched. All **20 Vault secrets** decrypted and
  verified in isolation. A preserved Drummonds user logged into recovered
  Auth after a disposable-only reset, read five tenant cards and the current
  v107 LEARN route; tenant isolation and audited operator revocation passed.
  Every labelled recovery container was independently absent afterward.
  [Off-site service recovery](evidence/learn-build01-offsite-v107-service-recovery-2026-10-17.json).
- The current v107 worker also booted from its reviewed bundle in an isolated
  network-disabled container, returned OPTIONS 200 and rejected an
  unauthorised POST with 403. This is startup and fail-closed evidence, not an
  authenticated capture restart.
  [Startup receipt](evidence/learn-build01-v107-worker-isolated-startup-2026-10-17.json).
- A later offline restore used the already decrypted **scheduled off-site**
  database with the current v107 worker. It held all 1,280 inherited active
  jobs in the disposable copy, then claimed and completed one synthetic card
  projection. No real recovered job or provider request ran; all six service
  containers were independently absent afterward. This verifies a controlled
  hold and safe worker restart, not real source capture resumption.
  [Worker restart receipt](evidence/learn-build01-controlled-worker-restart-2026-10-17.json).
- The last verified LIVE frontend Git commit `77a73802` rebuilt from an
  isolated archive with synthetic backend settings. Its generated Vercel server
  handler returned HTTP 200 for home and the unauthenticated LEARN workspace;
  all 15 and 20 referenced assets existed. That earlier 09:10 checkpoint
  proved an independent rebuild and boot; the later connected browser
  rehearsal above adds the signed-in recovered-system journey.
  [Frontend receipt](evidence/learn-build01-frontend-git-rebuild-2026-10-17.json).
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

- **Continue using the existing operation:** the ordinary card sweep cleared
  the last stale card without intervention, and an earlier full sweep had
  already completed. A proposed priority-scheduler change
  passed local handler checks and the LIVE read-only selector, but TEST has no
  active copy of that endpoint and the installed LIVE source differs from the
  tracked baseline. It was **not released**. Keep watching the rolling worker's
  failure rate and future source changes. Do not reimpose a fresh terminal
  sweep as a perpetual gate when the completed 06:11 sweep and zero-stale
  readback prove this cycle.
- **Interpret quiet sources honestly:** the exact 160-channel campaign is now
  confirmed entirely archived at Slack. At 10:41 LIVE still had zero retained
  post-cutoff messages, replies or signed hints in that roster. The current
  20-channel public campaign is separate and active; four real signed hints
  settled there. No staff test post is needed. Completed empty provider windows
  prove only those checked intervals, not all post-cutoff history or future
  delivery if a channel is unarchived.
- **Keep historical catch-up separate from current intake:** at 09:06, 2,517
  retained eligible Email messages still lacked interactions, while both recent
  alias checkpoints were under eleven minutes old and ordinary receipts were
  advancing. Resolve current-intake failure if it occurs; continue the retained
  three-year historical queue without treating its growing total as a new-mail
  outage. The stage's required source coverage and freshness decision still
  needs explicit acceptance criteria rather than a silently smaller denominator.

- **Slack historical catch-up:** 67 of the exact 160 channels were more than a day
  behind at 06:45. The previously dead-lettered window is now completed and
  no current window was dead-lettered at 06:46. Yet no post-cutoff message,
  reply or signed hint has been saved in this exact roster. All 1,335 checked
  provider windows were empty; 61 channels lacked a completed window ending
  in the prior 12 hours. The latest retained source activity is from 30 August,
  with none in the 30 days before handoff. All 160 are now confirmed archived,
  so this is a historical completeness task, not the active near-live roster.
  The shared signed receiver and all 180 bindings are verified. The separate
  active 20-channel roster has two source-matched parent Events and two
  source-matched replies; none has yet cleared identity review for card
  attribution. This positive evidence does not substitute for provider
  completeness of older threads in the archived 160.
  [Exact-roster proof](evidence/learn-build01-slack-160-postcutoff-2026-10-16.json).
  A completed direct provider query now covers **all 870 known saved
  pre-cutoff thread roots** and found **zero post-cutoff replies**. Its separate
  active-public positive control found a real retained reply using the same
  method. The direct parent query had already found zero post-cutoff parents
  in all 160 archived channels. [Bounded reply audit](evidence/learn-build01-slack-160-provider-reply-audit-2026-10-17.json).
  A later 09:27 observation found **69** channels over a day behind in the
  polling fallback and only **39** with a completed window ending in the prior
  12 hours. Retain the long-window catch-up through the remaining post-cutoff
  intervals, then treat archived subscriptions as dormant in the operator view.
  The 20 active channels carry the near-live requirement; all 20 now have
  provider read access, while reply coverage remains separately observed. Do not ask
  staff to post further team test messages or treat quiet windows as delivered
  Events.
- **Jobs and attention:** Commusoft retained 12,656 job identities and 295
  recorded open/pending/on-hold jobs. Only ten of those had reviewed job-card
  links; 285 did not. At 22:31, 272 of the 295 had no observation within a day.
  The released captured-source view now has explicit hold and source-review
  filters, and signed-in LIVE example rows passed. Named-person handoff and a
  representative progress/completion score are not established. The saved
  job collection alone cannot identify an individual recipient; the existing
  source-review queue is the truthful current route. A fresh 11:53 read also
  found no confirmed Drummonds team member or confirmed signed-in assigner,
  so neither provider-derived nor manual person routing can be claimed yet.
  The reviewed Owner / MD identity and task controls are now released in TEST
  and LIVE, but no member confirmation, task creation or acceptance has been
  recorded. Browser auto-review rejected origin-wide signed-in LIVE access;
  do not bypass that rejection with a privileged database write. The final
  positive handoff still needs a legitimate signed-in action and readback.
  [Policy draft](LEARN-BUILD01-JOB-ATTENTION-DRAFT.md).
- **Attribution limits:** the current 1,004 published canonical Commusoft jobs
  have customer links, but only 793 have site links, five have any linked
  communication, and none has an individual engineer link, completion instant
  or `jobs.verified` flag. The 42,741 Email and 35,051 Slack interactions in
  identity review must remain visible but cannot silently acquire a customer
  or job attribution. These counts do not prove a representative progress or
  completion score.
- **Email review and history:** the 55 historical drafts and 12 source-missing
  links require separate provenance treatment. A draft must not be represented
  as verified sent mail. The 1,595 current eligible unlinked sources are all
  historical by event date; the changed-source update lane is still running
  and has not drained.
- **Recovery:** The serving v107 Edge source has a fresh encrypted off-site
  copy and in-memory manifest verification; all 103 function trees rebuilt
  from locally staged source. Today's independent scheduled database copy
  now passes decrypted native/Vault restoration and preserved-user Auth/REST/
  current Edge tenant reads. The last verified LIVE frontend commit now also
  rebuilds, boots and connects in isolated synthetic- and preserved-user
  browser journeys.
  All-function startup with recovered runtime secrets and **real provider
  capture resumption** remain unverified. The offline old-session rejection
  and fresh-login policy is rehearsed but has not been executed on LIVE. A
  controlled no-provider worker restart passed. The local database point
  matches a later verified phone-file inventory. All three file buckets
  completed, but the points are not atomic.
  The [runtime-secret recovery review](LEARN-BUILD01-EDGE-SECRET-RECOVERY-REVIEW.md)
  records the approved one-time scope and earlier partial local ciphertext;
  the later sealed export closed those six source-location gaps and completed
  an independently downloaded off-site secret copy.
- **File-backup host:** the recording and voicemail schedule has succeeded
  locally, but depends on the Mac and Codex app being awake. The latest
  three-bucket inventory is a verified file copy, not a matching database
  restore or proof of an always-on hosted backup service.

## Blocked externally

- No new user action is needed for the ordinary card or Slack recovery checks.
  The first handoff recipient is selected as Owner / MD. Browser security review
  blocked agent access to the signed-in LIVE OpenFolk origin because that would
  expose broader private client data; a focused signed-in user action or a
  narrower approved access path is needed for the positive handoff. Credential-copy
  scope and off-site transfer are complete; isolated decrypt and provider
  restart remain technical gates.
  Chris's business acceptance will be
  requested **after** the technical pack is ready. No full-working-day elapsed-time
  wait is being imposed.

The proposed business check for Chris is whether a held job and a newly
progressed job surface with truthful source timestamps, go to the right
reviewer, move after a verified handoff, and show completion without inventing
timing or a score. Chris decides whether that result serves Drummonds; the
agent does not sign off on his behalf.
