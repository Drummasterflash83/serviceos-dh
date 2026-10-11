# LEARN V1 delivery and acceptance checklist

This is the authoritative remaining-work checklist for Chris's 11 October 2026
goal: complete and launch Drummonds' LEARN V1 through OpenFolk. Detailed component
documents retain implementation history; their older status statements do not
override a later release observation. No requirement is silently deferred.

## Current evidence and priority

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
review/requeue UI for `identity_review` cases (their events remain pending); legacy
repair-projector compatibility; and generic queue-loss recovery. The manually
invoked `identity-resolve` wrapper now reports partial failures correctly locally,
but is absent from TEST and needs job-admission/settlement hardening before deployment.
The calculated customer-card priority is an operational queue aid with recorded
inputs and an explicit UTC daily window, not staff performance/pay scoring.
[Release and hosted journey evidence](evidence/learn-identity-card-test-2026-10-11.json).

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
  At 12:07 UTC on 11 October, the same prepared run passed fresh read-only schema,
  Auth, runtime, credential-binding, paused-capture and retained-checkpoint checks.
  All 78 original source fingerprints matched after isolating the two documented
  synthetic Phone fixtures; a preserved one-time baseline refresh now protects
  those additions too. Exact release-055 transcript additions are accepted by the
  Auth checker without removing the old guards. Twenty focused tests pass.
  No user, grant or provider request was created; the original approval remains
  pending. [Readiness evidence](evidence/learn-commusoft-continuation-refresh-2026-10-11.json).
  A second exact reconciliation at 12:38 UTC proved the original 78 hashes after
  the approved playback fixtures and release 058; previous journals and both
  original baselines remain retained. Twenty-one checks pass. Full read-only
  preflight now passes on 058 with no active grant or provider request, preserving
  the original account, 100-page checkpoint, duration and budget.
  [Latest readiness](evidence/learn-commusoft-continuation-playback-refresh-2026-10-11.json).
- [ ] **Voicemail:** establish the actual supported message/audio contract and
  mailbox scope, then implement and verify ingestion, private access, replay,
  transcription and scheduling. Existing voicemail tables are not an ingester.
  [Discovery evidence](LEARN-VOICEMAIL-DISCOVERY.md).
- [ ] **Microsoft:** authorised tenant/mailbox setup and token lifecycle;
  persistent hosted release; real canonical/card acceptance; worker/controller registration,
  recurring folder discovery, expiry recovery and real-mailbox acceptance.
  At 13:31 UTC, all five source-journal/dispatch/recurring-queue migrations passed
  a full-schema hosted TEST rollback rehearsal, preserving all 113 datasets and
  the original catalog. Local actual-engine/queue tests prove later delta rounds,
  due-time gating and pause/revocation before token access; 58 focused tests and
  strict TypeScript pass. Nothing is installed or enabled for Microsoft. No real
  Microsoft mailbox has been identified for Drummonds.
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
- [ ] **Performance inputs:** finish source-backed response-time, job progression,
  repeat-visit and driving adapters where sources exist. Establish staff identity,
  team membership, calendars and reviewable calculation rules using Drummonds data.
  Unsupported inputs stay visibly unavailable until connected and verified.
- [ ] **Backups:** confirm measured volume, estimated total cost, account owner,
  retention and recovery targets; use the now-approved AWS London setup and
  recording-copy scope under OpenFolk ownership; implement encrypted independent files plus database recovery.
  Verify bytes and isolated restore/playback, record duration and recovery point.
  [Recovery plan](LEARN-DATA-RECOVERY.md). The complete observed file inventory and one manifest-selected
  audio restore are verified; database restore and recurring operation remain open.
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
