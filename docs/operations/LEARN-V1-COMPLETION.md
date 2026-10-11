# LEARN V1 delivery and acceptance checklist

This is the authoritative remaining-work checklist for Chris's 11 October 2026
goal: complete and launch Drummonds' LEARN V1 through OpenFolk. Detailed component
documents retain implementation history; their older status statements do not
override a later release observation. No requirement is silently deferred.

## Current evidence and priority

Fresh read-only production/TEST audit: **11 October 2026, 06:07 UTC**.
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
  Team ownership labels still expose UUIDs in customer findings and need resolution.

## Implemented but not fully verified — acceptance gates

- [ ] **Google email:** reconcile every enabled mailbox against current connection
  and domain authority, distinguish OAuth from DWD, classify recent failures,
  verify bounded real historical/incremental capture through the installed V1
  engine into interactions/cards, and verify pause, credential expiry, resume,
  duplicate suppression and schedule/expired-lease recovery. Exercise matching UI.
  Existing Workspace key availability in TEST is a current dependency; the live
  four-account `invalid_grant` issue requires a bounded diagnostic with a safe
  cause category, not a guessed Google-admin change.
- [ ] **Commusoft:** resume remaining jobs and property-scoped contacts; reconcile
  missing customer/property references and unzoned timestamps; publish valid
  customer/contact/site/job relationships with held records visible for review.
  Verify incremental updates and a real source-to-card journey without provider writes.
- [ ] **Phone:** verify existing account binding, calls, recording download,
  transcription, playable audio, retry/recovery and recurring capture with the
  real Birchill account. Preserve existing IDs and distinguish capture from shadow
  processing configuration. [Phone work](LEARN-PHONE-ACCOUNT-BINDING.md).
- [ ] **Slack:** verify authorised workspace/channel scope, history plus replies,
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

- [ ] **Commusoft continuation access:** original bounded real TEST grant is
  retired. The prepared continuation needs its own approval; earlier approvals
  must not be reused. Provider data-shape questions remain an explicit diagnostic
  task, not permission to assume timestamps or missing relationships.
- [ ] **Voicemail:** establish the actual supported message/audio contract and
  mailbox scope, then implement and verify ingestion, private access, replay,
  transcription and scheduling. Existing voicemail tables are not an ingester.
  [Discovery evidence](LEARN-VOICEMAIL-DISCOVERY.md).
- [ ] **Microsoft:** authorised tenant/mailbox setup and token lifecycle;
  hosted discovery-to-message dispatch; recurring capture/recovery; canonical projection;
  worker/controller registration; full-schema and real-mailbox acceptance.
- [ ] **Performance inputs:** finish source-backed response-time, job progression,
  repeat-visit and driving adapters where sources exist. Establish staff identity,
  team membership, calendars and reviewable calculation rules using Drummonds data.
  Unsupported inputs stay visibly unavailable until connected and verified.
- [ ] **Backups:** confirm measured volume, estimated total cost, account owner,
  retention and recovery targets; use the now-approved AWS London setup and
  recording-copy scope under OpenFolk ownership; implement encrypted independent files plus database recovery.
  Verify bytes and isolated restore/playback, record duration and recovery point.
  [Proposal](LEARN-DATA-RECOVERY.md). No separate recording backup exists yet.
  The costed proposal now includes 601 MB / 2,888 objects, verified London AWS
  rates, an illustrative US$1.89/month operating estimate and a US$5 budget alert
  (not a cap), plus scoped access, daily copies, 30-day governance protection and
  isolated restore acceptance. Chris approved setup/copy and changed account ownership to OpenFolk. The OpenFolk AWS account is now verified in Arc, with London selected. Owner
  MFA is now verified enabled in the in-app browser. Chris intends to move to the paid plan later; this
  is not an immediate setup blocker unless AWS reports a service restriction,
  but must happen before free access ends. The approved London foundation reached
  CREATE_COMPLETE at 07:55:12 UTC. S3 readback verifies private access, encryption,
  versioning, 30-day GOVERNANCE retention and protected writes. Both IAM policies
  are unattached. The $5 monthly alert exists but its owner email verification is
  pending, so delivery is not yet active. Scoped runtime access remains open.
  [AWS evidence](evidence/learn-recording-backup-foundation-aws-2026-10-11.json).
  Local CloudFormation foundation and streamed copy/restore/inventory core now
  pass schema lint and eleven synthetic tests. The official AWS SDK destination
  and encrypted journal add eight signed-wire synthetic tests (19 combined).
  The recursive Supabase source adapter now joins the synthetic copy/manifest/
  restore test path (28 tests combined), and one real object passed metadata-only
  verification. The complete real metadata inventory now verifies all 2,888 objects
  and every recording-row file link; six unlinked objects remain included. Private
  manifests are saved locally. The bounded copy runner has 32 passing tests overall.
  Restricted Writer/Restore IAM access is prepared as an unexecuted change set;
  action-time approval is needed for the new identities/keys. AWS transfers,
  scheduling, monitoring and database/audio restore acceptance remain open.
  [Inventory and runner evidence](evidence/learn-recording-inventory-and-batch-2026-10-11.json).
  AWS foundation resources now exist; no recording transfer occurred.

## Release and completion gates

- [ ] Keep meaningful checkpoints on GitHub `codex/learn-v1-test`; verify exact
  remote SHA. Source backup excludes secrets, private manifests and customer files.
- [ ] Rehearse the complete additive migration/runtime/frontend combination on
  the actual TEST schema; preserve before/after source identity evidence.
- [ ] Pass the repository's release commands (`npm install`, `npx tsc --noEmit`,
  `npm run build`) and verify required routes, matching API project, sign-in,
  permissions and browser console. Use [deployment requirements](../DEPLOYMENT.md).
- [ ] Document deployment sequence, rollback, credentials recovery, monitoring,
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
