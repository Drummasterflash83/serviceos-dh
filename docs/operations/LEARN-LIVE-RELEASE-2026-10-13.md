# LEARN live release — 13 October 2026

## Latest checkpoint — 12:29 BST

- Active public Slack history/replies now have reviewed priority 40 ahead of archived
  priority 60. A scheduled 100-message active page succeeded while archived jobs
  remained queued; saved messages reached 1,226. Source cursors, windows, budgets,
  access and the minute schedule are preserved.
- This is a schema/decision release only; frontend and runtimes are unchanged.
- Seven offline full-schema journeys and production preservation/readback passed.
  See [production evidence](evidence/learn-slack-campaign-priority-production-2026-10-13.json).

## Previous checkpoint — 12:09 BST

- Published matching Slack worker v3, voicemail importer v5 and platform-worker v61.
  The exact reviewed six-file runtime change covers connection-bound Slack page size
  and the observed personal-mailbox voicemail footer. Existing authentication,
  credentials, schedules, source records and access remain preserved.
- The scoped internal Slack profile allows 100 messages/page and a 30-second cooldown.
  A scheduled 58-record page at 11:08:08 UTC proves the larger batch is active. Totals
  reached 364 messages/versions and 259 interactions, without a provider rate block.
  History and customer/job context acceptance remain incomplete.
- Schema comparison initially differed only in PostgreSQL composite-type qualification;
  read-only canonical function inspection and original policy fingerprints reconciled it.
  Initial profile activation rolled back because its verification timestamp was later
  than the statement timestamp. The exact one-line timestamp correction passed an
  isolated reproduction and the production activation; both original journals remain.
- Voicemail history now retains 71 messages and 71 original-source receipts. All 60
  additional eligible imports and three duplicate checks passed. Original records,
  mailbox access and private buckets were preserved; all five routes are paused.
  Signed-in personal voicemail playback reached its 4.68-second end without error.
- Commusoft's production credential/access check succeeded. The initial property pass
  completed 25 pages with 2,423 sources. Jobs reached 7,500 across 75 pages and continue
  within the approved 300-page source scope. Contacts and canonical links remain open.
- The live frontend remains Git `22a48ba`; no design or branding change in this checkpoint.
  Full-schema rehearsal, exact runtime boot checks and 40 focused final tests passed.

Runtime and activation journals are retained privately under
`.verification-results/production-slack-throughput-voicemail-20261013/`.
Sanitised evidence: [Slack](evidence/learn-slack-internal-throughput-production-2026-10-13.json)
and [voicemail](evidence/learn-voicemail-history-2026-10-13.json).

## Earlier checkpoint — 11:35 BST

- Live frontend Git `22a48ba8259923ded15b0748f398544b96d018c7`, deployment
  `dpl_9EK4ZfKn4cH1oMm3tCJYa5EtZPoJ`, now serves all four existing aliases.
  Promotion journal verified plan `0c5f4c07583f5a66dfbe46bce20c6def00cec9d0f33ee6858acaa55399e8e90a`.
- Signed-in live overview now displays real Slack and voicemail counts through
  the caller's existing RLS. At 11:35 BST the screen showed 97 Slack messages and
  11 accessible voicemails; no browser errors were observed. Refresh and the
  lower voicemail summary agree. Counts do not imply complete history.
- The matched voicemail parser and Slack dispatcher runtime repair published
  importer v3 and platform-worker v59. Setting activation retained exact code,
  authentication and existing schedules. `LEARN_SLACK_DISPATCH_ENABLED=true`;
  the shared Commusoft dispatcher remains false. No new keys or grants.
- Automatic Slack page receipts at 10:30 and 10:32 UTC prove unattended progress
  after activation: 30 additional messages, no failed/retrying jobs or provider
  rate-limit block. Full 180-public-channel history is still in progress. Existing
  conservative pacing is under review against the dedicated app's distribution status.
- All nine available shared-office voicemail sources imported, with replay identity
  and manager access preserved; route paused. Two more Liz messages imported before
  another provider-template parse failure. All four additional routes are paused;
  63 planned messages remain. Source/access preservation checks passed.
- Production Commusoft check at 10:28 UTC: no connection, source pages, source
  collections or import jobs for Drummonds. TEST imports are not live coverage.
- Typecheck, production build and 20 focused parser/auth/brief tests passed. A test
  fixture was completed with the required card/timestamp fields; no card UX expansion.

## Earlier checkpoint — 10:03 BST

- Final live frontend: Git `6f5082ae72d31a60b27c20ba29551126b2f64076`, deployment
  `dpl_3HCyNS2f2KbPzaR7X4F1R58FtU1G`. All four existing aliases verified. The
  separate one-step promotion journal completed with plan hash
  `db4e864e260905e85ea65312a8d726104fbbaa7349f8a0307741e65875bc05e7`.
- Six input tiles, automatic visible-tab refresh and the evidence-based customer
  brief are live. The brief counts explicit Actions only, excluding observations,
  drafts and cancelled findings. Its live rendered state was checked. Mobile
  overview passed at 390px without horizontal page overflow.
- Runtime hotfix: `customer-card-sync` v41, `phone-process-pipeline` v59,
  `platform-worker` v57. Only the graph-read batching/pagination and canonical
  PostgreSQL UUID validation helpers changed; exact source ownership checks stay.
  Compiled identity, unauthenticated rejection and unchanged schedules were verified;
  exact previous artifacts are retained for rollback.
- Read-only shadow prepared 200 cards before deployment. The existing scheduled
  retry subsequently **succeeded at 09:01:18 UTC with 200 saved projections and
  zero failed**. Its retained old `last_error` is historical; terminal status and
  result establish this success. The next continuation was queued.
- Three post-fix phone pipelines succeeded. One later run failed with
  `phone_handoff_call_changed`; diagnosis remains open. The old two invalid-UUID
  failures are retained. A separate bounded card endpoint probe returned HTTP 401
  `internal_auth_mismatch`, made no writes and was not retried; no auth was weakened.
- Live saved totals at 10:00 BST: 20,048 emails, 4,416 calls, 2,950 recordings.
  These are growing saved totals, not complete historical or analysis coverage.
- Voicemail still awaits real syncing. Emma practice UI is available, but the main
  number is not activated and transfers/fallback are unverified. No routing changed.
- This supersedes the older frontend and processing-failure status below. Full
  production Slack/Commusoft coverage, actionable card/scoring acceptance, voicemail,
  unattended backup operation and the complete LEARN V1 goal remain unfinished.

## Earlier release evidence

### Working and verified

- The 24 pinned SQL packages and 37 compiled runtime functions were installed in production (`tgbnakbxwcqjeimygroz`). The immutable original journal reached paired backend acceptance, 69 steps verified.
- Original-column fingerprints matched across 28 source/access/storage sets before SQL, after SQL and after runtime installation: 79,802 rows. All 2,944 recording references still resolved. These fingerprints supplement the independent restore-tested backup; they are not a backup themselves.
- Positive caller checks passed against exact compiled artifacts offline: 28 scheduled cases and 63 changed-user cases. This is not proof of full provider coverage.
- A production-only acceptance failure exposed two expired, unended View-As contexts. The operator query now excludes expired contexts and limits the presence check to one current context. Any current or unbounded context still prohibits configuration. Four regression cases passed. No grants or history rows changed. The separately recorded `openfolk-control-plane` amendment published version 28, hash `4f8447f0de96c44e611cb68716b20d72cc2095b963aff7eb4c4dc0b72f428213`.
- Signed-in operator directory, Drummonds workspace, LEARN totals and an existing customer card/evidence timeline passed in the protected production preview. The stable live site subsequently displayed 19,116 emails, 4,399 calls and 2,944 recordings after a refresh.
- The final responsive frontend from Git `fc5fb67e38ab2d6781997b85b3cbb6ecaff44abc`, deployment `dpl_AFXGeu4hF9mYoMqNYtWUfupNuusg`, was verified on all four existing live aliases. Home text/status tiles wrap, the mobile phone header has appropriate spacing, and LEARN card tabs wrap onto two rows. Live Home, Modules, Phone and LEARN checks at phone width passed without horizontal page overflow; Home also passed tablet width. This is not exhaustive certification of every route and device.
- The nine original schedules were restored with their original commands/settings after signed-in live checks. The two-step continuation journal verified both promotion and restoration. Successful resumed capture included Workspace email, Simwood calls, recording metadata and audio downloads. At 08:49:56 BST the live screen showed 19,235 emails, 4,407 calls and 2,946 recordings: increases of 119, 8 and 2 respectively since the earlier live observation.

## Needs finishing

- Existing customer cards and evidence are readable, but a resumed customer-card sync retried with a required-data-read error. Existing cards were retained; fresh projection completion is not yet accepted.
- Two phone transcription and two analysis jobs succeeded, but two enclosing phone pipeline jobs failed. The remaining completion stage needs diagnosis before end-to-end phone processing is called healthy.
- Full production Slack/Commusoft history, canonical contact/card coverage and remaining AI/scorecard acceptance are unfinished. TEST import evidence must not be presented as production coverage.

## Blocked externally

- Three mailbox delegation failures remain recorded. Successful email capture for other mailboxes does not establish access for those accounts.

## Release amendments and limitations

- The original deployment journal and plan were not rewritten. A separate continuation binds the responsive frontend amendment and restores original schedules. Its plan hash is `4735b80d32e0be7687921888ab9911c0f5176b80d9f0139df4718fe61e6bb905`.
- The final LEARN tab-wrap promotion has its own verified one-step continuation, plan hash `5e0794156f84934badcc49fd46587506511cf1eaa793465ea6532fee9ea5a1a7`.
- SQL package 014 initially had an unconfirmed response. Its receipt and candidate objects were absent, its read-only guards passed, and no matching transaction remained after more than nine minutes. A reviewed, identical guarded transaction then committed once; the original journal reconciled its receipt. This is recorded privately, not treated as a successful initial request.
- Supabase omitted `import_map` on new compiled function metadata; the verifier now accepts absent or false, but still rejects an enabled/named import map and requires the exact compiled hash. A regression check passed.
- Vercel clears its transient alias job after completion. Promotion verification now accepts that state only when the project target, all four aliases, build identity and completed alias assignment match. Mixed or pending states remain unconfirmed. Eight frontend adapter tests passed.
- `LEARN_INPUT_DISPATCH_ENABLED` remains false. No new production Slack/Commusoft import approval, channel capture, login or grant was created by this release. Their production activation and complete coverage remain unfinished.
- The original all-gates release sequence and LEARN V1 goal are **not complete**. This is a verified live frontend/backend checkpoint with original capture schedules restored, not a claim of complete provider, AI, scorecard or recovery automation acceptance.
- Private evidence and credentials remain outside Git under `.verification-results` and the existing approved secret stores.
