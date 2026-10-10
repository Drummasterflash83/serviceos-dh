# Existing TEST environment: verified release gaps

## Hosted operator acceptance session — prepared, approval pending

The read-only preflight for run `0be31171-a302-4840-80fd-f433726a7300` passed
against release 034. It rechecked the exact health catalog, existing Auth contract,
absence of `chris@openfolk.ai` in TEST Auth/profiles, and 64 aggregate preservation
fingerprints. No account or grant has been created for this run.

`scripts/verify/learn-hosted-operator-session.mjs` prepares, activates, inspects and
retires the bounded session. Activation requires explicit approval of this new run;
the previous contacts fixture approval does not apply. The plan creates the TEST
login required by the existing frontend gate and one archived synthetic company,
with a 30-minute `platform.controlplane.admin` grant. That grant can access all TEST
clients; acceptance changes are restricted to the marked company. No provider
credential, import, schedule or email is included.

The private plan is `.verification-results/hosted-operator-session.json`. Activation
rechecks identity absence and unchanged retained sources, journals before creating
Auth, and refuses replay after an attempted activation. Retirement ends database
authority before banning the login, so an Auth outage cannot leave the grant active.
The account and synthetic evidence remain retained. The tool reports only explicit
safe fields; passwords and source fingerprints remain local and ignored. Six session
tests and nine existing connection-outbox tests pass. Actual hosted signed-in
acceptance remains pending; the preflight does not count as a successful login.

## Operator backend and shared health foundation — installed in TEST, 10 October 2026

The recovered **openfolk-control-plane** endpoint is deployed in TEST at version 1.
Its complete 17-file source closure is pinned at
`671270974732e854100782168105abdd4d8687a27849b2bdafdc4f9d1b00e53d`.
The endpoint verifies user sessions and active platform grants itself; gateway JWT
verification is false, as required by its existing authorization design. All other
endpoints, the prior schema and 52 retained dataset fingerprints were preserved.
Eight hosted protocol/denial checks passed: missing or invalid user authorization,
anonymous/service credentials presented as users, and invalid/service credentials
presented as the dedicated machine key all fail closed. No machine key was added.

Sixteen local endpoint/deployment regressions passed, including directory pagination
beyond 1,000 clients, tenant-owner denial, failed authority reads and denial of
machine access to the directory. The old local Supabase demo requires a separate
stack/credential configuration and was not counted as passing. These tests do not
replace positive signed-in hosted acceptance. See
[control-plane evidence](evidence/learn-controlplane-hosted-2026-10-10.json).

Release **034** installed the existing shared portal/receptionist health foundation
at **16:44:40 UTC**, after a successful hosted rollback rehearsal. It creates eight
empty tables: portal membership, programmes, revisions, notes, receptionist
workspaces, receptionist access, feedback and the notification outbox. All have
RLS. The package includes the original triggers and service-only queue claim,
preserving programme revisions and durable notification intent without sending
anything or starting a dispatcher.

Review found the earlier direct browser-write policies did not enforce read-only
View-As for programme, note and feedback writes. An additive restrictive policy
migration now blocks all five write paths during an active View-As context while
retaining the existing membership/operator requirements. A disposable networkless
PostgreSQL test passed six scenarios covering tenant isolation, version/revision/
outbox atomicity, customer permissions, View-As denial, expiry and service-only
queue claiming. Five release-tool tests cover journal-before-submit, exact target
and rehearsal requirements, rollback verification and uncertain-response handling.

All **56 retained dataset fingerprints** were preserved during rehearsal and apply.
Independent read-back matched health schema fingerprint
`fdc6a58cd52c032da172ddde7bd50265`; the ledger now has 35 entries. The email-runtime
catalog fingerprint is now `d270f687aa83be3d18f80c6a168892ea` because its catalog
includes that ledger. Earlier release tools intentionally retain their earlier
prerequisite pins; do not overwrite pins or replay old releases without reviewing
the new state. Release SHA:
`24ba1a152ff214e261acf717efc63e7d9686ea8e54ec60c4affe882a6b910816`.
See [health release evidence](evidence/learn-operator-health-hosted-2026-10-10.json).

**Remaining:** create/authorize the planned TEST operator access, verify the actual
signed-in directory, module controls and client surfaces, and complete the later
care/notification/invoice dependencies where those screens require them. The
foundation is not a claim that every receptionist workflow is installed. No user
account, per-user grant, provider secret, source import or schedule was added;
production remains unchanged.

## Protected TEST frontend — deployed and navigation verified, 10 October 2026

The separate Allkin Vercel project **serviceos-learn-test**
(`prj_KOScR3ShQmvxjrwLAJ68yTh93Pcs`) now serves a protected staging build from GitHub
commit `86b5402206aa72a858aae4b2a5882c7cf30b32ca`:
[TEST candidate](https://serviceos-learn-test-boyeohqpc-allkin.vercel.app).
Vercel reported READY at **16:32:21 UTC**. The existing production Vercel project,
custom domains and production backend were not changed.

The two preview-only environment values were independently read back in memory:
the URL points to `saatxzwxvdvqevbnskxy`, and the existing client key has that TEST
reference and the `anon` role. No server/provider secret is configured in this
frontend project. Anonymous HTTP requests to `/` and `/openfolk` redirect to
Vercel authentication. In the existing Vercel-authenticated Chrome session, the
homepage renders and `/openfolk` redirects to application sign-in.

Browser acceptance found the shared homepage linking preview users to the live
login. The static page and React route now use the same environment-aware link:
preview navigation remains on its current origin, while production retains its
canonical login. TypeScript, a Vercel-targeted preview build and six homepage
checks pass; the corrected hosted link was clicked and confirmed on TEST.
See [deployment evidence](evidence/learn-hosted-test-frontend-2026-10-10.json)
and [sign-in screenshot](evidence/learn-hosted-test-login-2026-10-10.png).

**At this frontend checkpoint, before the backend installation above:** TEST had no
`chris@openfolk.ai` account, no `openfolk-control-plane` endpoint, and none of the
four shared health tables queried by `useOperatorHealth`: `receptionist_workspaces`,
`client_programmes`, `receptionist_feedback`, `client_notification_outbox`.
The endpoint and eight-table shared foundation are now installed as recorded above.
Complete remaining control-plane dependencies with preservation and
authorization checks before claiming that the full hosted operator workspace works.
No new login or grant was created. Release-033 capture RPCs and the earlier
synthetic worker acceptance remain separate established evidence.

Deployment notes: the first deployment in a new Vercel project was classified as
production when `target` was omitted, so it was not accepted. Explicit
`target: "staging"` selects the preview configuration. The first staging candidate
was superseded to correct the live login link. Use the candidate above; do not
present the default project hostname or either intermediate deployment as ready.
The project has no Git webhook linkage, and backup-branch automatic deployments
remain disabled; deployment is a deliberate pinned-commit API operation.

## Real Commusoft access — existing application found, read denied, 10 October 2026

The existing private application **OpenFolk — Drummonds read-only** has visible
property-read and job-read scopes. Its existing key was reused privately without
regeneration or permission changes. The first bounded property GET returned 403;
a diagnostic of the same request confirmed an HTML denial, with no API-log entry
visible after the first attempt. The responsible access layer is not established.
Jobs and contacts were not requested, and no data was imported or changed.
The earlier successful synthetic TEST acceptance remains valid but does not
resolve this real-provider access gap. See the
[API access checkpoint](LEARN-COMMUSOFT-API.md#existing-private-application-found-live-read-denied--10-october-2026)
and [sanitized evidence](evidence/learn-commusoft-live-read-2026-10-10.json).

## OpenFolk capture controls — frontend implemented and locally verified, 10 October 2026

The operator Modules screen now exposes the shared LEARN master switch plus
separate Email, Phone and Slack settings through the release-033 capture-control
RPCs. The existing Commusoft panel retains its own input switch and import controls;
it preserves the recorded master setting instead of editing it independently.
An unset master must be reviewed in the new panel before changing Commusoft input.
Recorded policy distinguishes permission to capture from actual healthy activity.
Missing/inherited settings require an explicit choice before the four-setting
policy is saved, so an unrelated switch cannot silently enable another input.

The client validates tenant, request, revision, complete policy and recorded
receipt before reporting success. Requests are saved before network access, scoped
by backend/operator/company and protected by the same browser lock as Commusoft
changes. Lost responses retain the exact request; checking a recorded receipt
does not apply it again. Stale revisions require cancellation and a fresh review.
Pending capture changes block new Commusoft module/import/connection writes;
receipt checks and cancellation remain available. Every action rechecks current
administrator access, with server authorization remaining authoritative.

**22 request/outbox tests, frontend TypeScript and the production build pass.**
The actual component was also exercised in a localhost preview whose CSP blocks
network requests: lost response and reload recovery, stale-change cancellation,
read-only operator controls and administrator revocation retaining a saved request.
Browser testing found and fixed recovery buttons being unnecessarily disabled
after a failed save despite freshly verified access. See
[verification evidence](evidence/learn-operator-capture-controls-local-2026-10-10.json)
and [synthetic screenshot](evidence/operator-capture-controls-2026-10-10.jpg).

**Not yet hosted frontend acceptance:** this checkpoint does not change deployed
flags, grant operator access, start capture or promote production. Verify a signed-in
operator on the coordinated TEST frontend/backend before release, including all
deployed input workers honouring the shared policy and current schedules.

## Hosted synthetic email recovery — passed, 10 October 2026

At **16:03:26 UTC**, the deployed TEST worker recovered all three mailbox paths:
Gmail OAuth, Workspace recent sync and Workspace historical import. Manual endpoint
requests first returned validated 202 queue receipts; matching requests reused
their jobs and conflicting page-size requests returned 409. The actual local
capture engine then stored one synthetic message/thread per mailbox in hosted
TEST and was deliberately interrupted after saving the checkpoint request but
before applying it. Provider responses were supplied entirely in memory.

An initial read-only audit query attempted to call a worker-only function and was
denied. The fixture retired safely, and independent read-only checks confirmed
three stored pages and three pending requests. After correcting that query, the
test continued from those same pages without importing again. The synthetic
tenant stayed archived and all capture flags stayed false; only the synthetic
mailbox statuses needed to settle the saved protocol requests were temporarily
restored. The deployed worker reclaimed the expired leases and completed all
three jobs, with **zero pending requests, three messages, three threads, no extra
jobs, and zero newly processed records attributed to recovery**. Each original
run retained its one-record evidence and saved continuation; recent-mail cursors
did not advance prematurely.

All **56 pre-existing dataset fingerprints** were unchanged, including the four
new runtime tables added to this preservation check. The runtime schema also
matched its pinned fingerprint. All synthetic mailboxes were disabled again and
the tenant remains archived; no login, profile, operator grant, OAuth/Vault
credential, schedule or production change was introduced. Three verification-tool
tests cover fixture scoping, provider isolation and rejection of false recovery
success. See [hosted recovery evidence](evidence/learn-email-hosted-recovery-2026-10-10.json).

**Still required:** real Google authority/capture, continuous scheduling and
signed-in tenant-user/frontend acceptance. This verifies deployed recovery of
saved synthetic pages, not a real provider connection or complete traversal.

## Email runtime endpoints — TEST boundary checks passed, 10 October 2026

The generic `platform-worker` and the three manual Gmail/Workspace endpoints are
active in TEST at **version 4**. Their complete 100-file dependency bundle has SHA
`e736ecc82eaac1bd394b98ec6560490679c36834a668767af0fbf317fc91065b`.
The manual endpoints retain gateway JWT verification; the cross-tenant worker
checks its schedule secret or exact server credential itself. No unverified JWT
role claim confers authority. Internal mailbox requests still require an explicit
tenant, and request-body tenant mismatches are rejected.

Hosted comparisons against the runtime's built-in service credential initially
failed. TEST now has an explicit `SERVICEOS_INTERNAL_KEY` binding that reuses its
existing service credential. Its value was passed through CLI stdin and verified
by digest, without writing it to reports, files or arguments. Other secret values
and endpoint code were preserved; the secret refresh advanced endpoint versions
before the four target endpoints were deployed again. Earlier bundle manifests
v1/v2 record these intermediate attempts; **v3 is the accepted boundary bundle**.
Shared internal callers require the runtime service credential before attaching
the configured binding, preventing a user token from being upgraded into server
authority by that helper.

At **15:52:38 UTC**, all 15 hosted HTTP checks passed: unauthorized worker requests
were denied; the authorized worker completed an empty queue selection; and each
mailbox endpoint rejected missing authorization, missing internal tenant and
foreign-tenant requests, while returning the expected capture-paused response.
The schema fingerprint remained `ec04995ee4e15970619130bb53713dc1`, and all
**52 existing dataset fingerprints** were preserved. Local verification passed
25 phone/capture regressions, 22 worker/email request/UI tests, nine deployment
and credential-binding tests, and one internal-invocation test. Shared-module
TypeScript passed using local Deno/Supabase ambient declarations.
See [deployment evidence](evidence/learn-email-runtime-endpoints-2026-10-10.json)
and [HTTP evidence](evidence/learn-email-runtime-http-2026-10-10.json).

**Update:** synthetic hosted queue/page/recovery acceptance passed above. Still
required: signed-in tenant-user and frontend acceptance, verified Google mailbox authority, and
scheduler configuration. No Google provider credentials or schedules were added,
no real provider request was made, and production was not changed. Boundary
checks and an empty worker response do not establish live mailbox capture.

## Email runtime database — installed in TEST, 10 October 2026

Release **033** (`learn_email_runtime_v1`, SHA
`7f6f701b3a7e38915bd43be895cddbc15b56eed468361b41b16ca4a26e13c100`)
was rehearsed against hosted TEST and rolled back, then its installation was confirmed at
**15:33:58 UTC**. Both operations independently verified the resulting catalog
and **52 existing dataset fingerprints**. TEST now has 34 release-ledger entries.
No retained source rows, feature flags, access grants, credentials or schedules
were changed. This is a schema installation, not completed email capture acceptance.

The package installs the previously documented capture controls, durable email
outbox, queue/attempt binding, atomic page persistence, terminal failure settlement,
paused recovery and manual enqueue RPC. It also supplies the missing phone
pipeline-state view and retry-selection dependencies needed by the shared controls.
That view uses invoker security and is readable only by the service role; it does
not install a phone pipeline endpoint or activate processing. The new email tables
have RLS and no client access. Email mutation/recovery functions are service-only;
the two operator-control functions use the existing OpenFolk authorization checks.

The release transaction checks an exact fingerprint of relevant function
definitions, table contracts, policies, grants and the ledger before making changes.
It compares source fingerprints within the transaction and aborts on a mismatch.
The release tool retains its journal before submission, sends once, and provides
read-only confirmation for uncertain results. **Seven release-tool tests pass**;
the earlier 56-result database suite and seven request/UI tests establish local
behavior, while this hosted rehearsal establishes compatibility with actual TEST.
See [hosted evidence](evidence/learn-email-runtime-hosted-2026-10-10.json) and the
checked SQL/manifest/prerequisite/expected files in `supabase/release/learn-test/033_email_runtime.*`.

**Update:** matching worker/shared modules and manual endpoints are deployed as
recorded above. Still required: provide the TEST frontend with the queued-response UI,
verify real authenticated request and recovery paths, and verify mailbox authority
and scheduling before starting capture. The fresh audit found no email endpoints
or generic worker, no active queue jobs, and no `cron.job` catalog in TEST. Continuous
capture is therefore not configured. Existing released Slack/Commusoft/Simwood
endpoints remain separate. No production deployment or real provider request occurred.

## Manual email queue submissions — local implementation, 10 October 2026

The Gmail, Workspace sync and Workspace backfill endpoints now use the shared
authenticated `email_enqueue.ts` handler. It binds the tenant from the existing
owner/admin/ops authorization path, validates account/options, and calls the
service-only `learn_email_enqueue` RPC. These requests never resolve Google
credentials, open sync runs, write messages or update mailbox progress. A valid
acknowledgement returns HTTP 202 with the queue job ID and duplicate indicator.

`20261101001500_learn_email_enqueue.sql` checks current capture policy under the
existing shared operator-control lock and checks account/provider/sync-method
eligibility. The worker still verifies current OAuth or Workspace authority
before obtaining credentials. The active-job unique key arbitrates concurrent
submissions. Matching work is reused; differing payloads or connector identity
are rejected without overwriting that job. Recent requests default to 25 messages
per page, matching the schedulers; historical requests preserve the existing
omitted-page-size shape. False force/restart flags are omitted from saved payloads.
Restart=true is refused and requires explicit operator recovery instead of
resetting retained cursors. No implicit request retry occurs after uncertainty.

The frontend accepts only the new validated 202 queue contract. Email controls
show Queued/Queueing and job references, not imported-message counts; unknown
responses direct the operator to inspect jobs and use Needs attention. The
historical-import button starts or continues using saved progress. The old reset
shortcut is removed. Connector quick actions and the legacy internal email helper
also report queue acceptance rather than invented processing totals. Other
operations retain the StatusPanel's existing Success/Failed defaults.

**55 database scenarios / 56 Node results** and **seven request/UI tests** pass,
including concurrent matching and conflicting requests, unchanged source progress,
all mailbox types binding to the durable worker protocol, tenant/role isolation,
internal service authorization, malformed/lost replies and actual rendered status
labels. Frontend TypeScript and the production build pass. The shared Edge handler
passes TypeScript with local Deno/Supabase ambient declarations; no Deno runtime
deployment check is claimed. See
[local evidence](evidence/learn-email-enqueue-local-2026-10-10.json).

**Database installed by release 033; endpoints deployed above; positive capture/UI acceptance outstanding.**
The coordinated email runtime release includes:
capture-control prerequisites, outbox/job binding/page storage/failure/recovery/
enqueue migrations, the generic worker and its shared modules, all three manual
endpoints, and matching frontend must be treated as one release. Old clients
expect synchronous totals and old workers call these endpoints to perform capture;
mixing versions would misreport acceptance or fail to run capture. Schedulers,
expired-lease recovery and real mailbox authorization still need hosted verification.
No production changes, real provider requests, credentials, access grants or
schedules were made in this checkpoint.

## Paused email recovery — local implementation, 10 October 2026

`20261101000500_learn_email_paused_recovery.sql` closes the queue admission gap
for saved email work. The generic claimant now passes the candidate job ID to a
four-argument overload of `learn_capture_job_allowed`. While capture is paused,
only the three mailbox capture job types can use this exception, and only with
an immutable attempt binding whose tenant and complete job definition still
match. The bound run must have either an unsettled durable transition or a
terminal success/failure. Metadata flags and merely having a running attempt do
not bypass the pause. Discovery retains its ordinary admission check.

The SQL change preserves the claimant's other filters, priority, lease handling,
locking and dedicated-worker exclusions. Recovery settles saved state before the
engine checks admission for new provider work. A recovered pending claim then
defers without obtaining credentials and refunds that claim's attempt charge.
Recovered terminal success creates no immediate successor; later scheduling is
still responsible for resuming unfinished traversal after admission is restored.
Terminal failure can settle after its mailbox has been disabled.

**49 database scenarios / 50 Node results**, **nine actual-worker VM tests** and
the existing complete capture-controls fixture pass. The new scenarios exercise
the recorded TEST claimant, actual email protocol/engine and exact capture helper
definitions, including rollback/grants, definition and tenant mismatches, all
three mailbox types, provider-free recovery and attempt-neutral deferral.
The email fixture reconstructs minimal tenant/flag tables and only the relevant
capture-control functions; the separate full controls fixture covers operator,
Slack and phone dependencies. See
[local evidence](evidence/learn-email-paused-recovery-local-2026-10-10.json).

**Not deployed.** The later local queue-submission change above adapts the direct
sync endpoints and their UI. Hosted migration/deployment acceptance and
real mailbox authorization remain outstanding. No hosted data, credentials,
permissions, provider traffic or schedules changed in this checkpoint.

## Credential reuse and queue routing — local implementation, 10 October 2026

The three mailbox queue handlers now call the durable engine in-process with
`email_capture_ports.ts`. OAuth reads the tenant/account-scoped existing token,
reuses it when its read scope and remaining lifetime (over two minutes) permit,
and refreshes otherwise. A cache
update compares the observed token timestamp and refresh secret, preventing an
in-flight refresh from overwriting a newer connection. If another refresh wins,
only its independently validated cached token can be used. Unknown write replies
remain uncertain and do not trigger another refresh.

Workspace token acquisition requires an active verified tenant connection, exactly
one enabled pending/active mailbox membership, matching domain and configured
service-account identity, and a non-suspended mailbox. Authority is reread before
minting. Secondary domains need their own matching saved connection; this does
not infer authorization for arbitrary aliases. Existing platform secrets are
reused server-side. OAuth refresh and delegation requests now reject redirects and
use a 15-second timeout. Tokens remain outside source metadata and diagnostics.

`platform-worker` recognizes explicit durable email outcomes. It does not repeat
completion/failure or enqueue another successor after the engine settles a job.
Recovered historical receipts do not emit fresh healthy-capture telemetry;
unknown outcomes leave the lease for recovery and are counted as unconfirmed.
The handler runs before the worker's ordinary capture gate so it can settle saved
evidence; the engine still checks admission before provider work. Discovery keeps
its ordinary capture gate and existing endpoint.

`20261031235900_learn_email_job_failure.sql` settles only a bound, terminal failed
attempt under the current worker lease, retaining a replayable failure receipt.
It rechecks expiry after the queue update and rejects stale/foreign claims. Failed
capture is dead-lettered for protocol/operator recovery, rather than repeatedly
creating attempts against a blocked generation. No successful run or running
attempt is classified as failed by this API.

**42 database scenarios / 43 Node results**, **29 focused unit tests**, and **nine
actual-worker VM tests** pass. Checks include retained credentials, concurrent
reconnection, token transport options, caller identity, receipt handling, lost
failure acknowledgement and observed lease expiry during failure settlement.
The new shared modules pass TypeScript checking with local Deno/Supabase ambient
declarations; this is not a Deno deployment build. See
[local evidence](evidence/learn-email-routing-local-2026-10-10.json).

**Not deployed.** TEST credential/Workspace table definitions were read without
credential values or mailbox data. Credential tests use synthetic database and
provider ports; real Drummonds authorization has not been exercised here. Queue
claim filtering's paused-recovery gap is addressed by the later local migration
above. The later manual-submission change also adapts the direct sync endpoints;
coordinated runtime installation remains outstanding. No hosted credentials, data,
permissions or schedules changed, and no provider request was made.

## Mailbox page engine — local implementation, 10 October 2026

`email_capture_engine.ts` composes job/attempt recovery, the durable transition
outbox, explicit Gmail pages, atomic source persistence and the existing
`platform_jobs_complete_email_v1` queue completion contract. Each new attempt
processes one page. A successful partial page yields its checkpoint and creates
the next queue job atomically with completion. Recent capture visits both INBOX
and SENT before advancing the original captured history boundary. Historical
capture uses its saved page token and total and completes only on exhaustion.

Saved provider continuation is validated before credentials are resolved. Each
mailbox-processing invocation checks the profile's mailbox identity before listing mail.
Force/refetch policy belongs to the traversal and is preserved across successors;
successor payloads do not repeat an instruction to start another forced traversal.
Expired provider history blocks for explicit recovery. A legacy `restart` flag
does not authorize resetting progress. Source/parse/storage failures are recorded
through the guarded protocol, including unknown persistence when a write reply
cannot be confirmed. Protocol uncertainty never becomes an invented failure or
new transition that bypasses an unresolved request.

Recovery settles a saved transition before checking capture admission or resolving
provider credentials. A terminal recovered attempt completes its queue job using
the existing historical-receipt contract: zero invocation count, no new provider
work and no immediate successor. That contract leaves further traversal to a
later scheduled job; this engine does not claim immediate continuation after an
interrupted completion. A lost queue-completion response raises a distinct
uncertain outcome because completion and its successor may already have committed;
the caller must not fall back to generic job failure.

The local engine uses the actual recorded v2 protocol, new storage functions and
the recorded atomic queue-completion function in disposable PostgreSQL. Provider
responses and credential-resolution ports are synthetic. Mailbox/Workspace
authorization and credential resolution remain required server-side ports.

The combined suite passes **39 scenarios / 40 Node results**, including ten new
engine scenarios. Changing profile boundaries across successors verifies that
only the originally captured boundary advances. Fourteen page/adapter tests and
shared-module TypeScript checking also pass. See
[local evidence](evidence/learn-email-engine-local-2026-10-10.json).

**Not routed into the existing handlers or deployed.** The generic queue worker
and queue admission still need coordinating so paused recovery reaches this
engine, completed jobs are not completed twice, and uncertain completion is not
overwritten. Existing direct mailbox endpoints also need adapting to this queue
path. Coordinated TEST runtime installation, scheduler verification and production
promotion remain separate work. No real Gmail requests or hosted changes occurred.

## Atomic email page storage — local implementation, 10 October 2026

`20261031235500_learn_email_page_store.sql` and `gmail_page_store.ts` connect the
page processor to the existing email tables through server-only RPCs. Message and
thread writes share one transaction. Older messages retain newer thread subjects
and timestamps, and participants are merged. Missing-only capture does not replace
an existing message; explicit refetch keeps its ID, preserves bodies when a new
body is absent, and refuses an older known Gmail history version. Extra columns
outside capture, including any production-only origin fields, are not assigned.

Every lookup/write validates tenant, mailbox address, running attempt, checkpoint
generation/revision/owner, fetch policy and current queue lease when job-bound.
The existing account lock serializes these checks with protocol transitions;
checkpoint access remains SELECT-only. A final lease check rolls back writes if
expiry occurs inside the transaction. This does not grant new progress-writing
permissions or replace capture admission and Workspace authorization checks.

The typed adapter freezes its scope and lease and validates returned context,
IDs and actual write counts. An unknown reply provides no persistence evidence.
An explicit retry can find an already committed message without fetching it again;
that lookup proves its presence, not the lost call's affected-row count. There is
no independent durable page-write receipt. Cursor and run completion remain the
responsibility of the existing durable transition protocol.

The combined isolated database suite passes **29 scenarios / 30 Node results**,
including the seven new storage scenarios. A deliberately rejected message
proves both thread and message writes roll back. An injected delay demonstrably
runs, expires the lease during insertion, and rolls back the whole page. Lost
replies, preserved identities, old history, stale scopes and role denials are
also exercised. **14 page/adapter unit tests** and shared-module TypeScript
checking pass. See [local evidence](evidence/learn-email-page-store-local-2026-10-10.json).

The fixture uses newly read TEST email-table definitions, update triggers and
service table grants, plus the existing recorded protocol and queue contracts.
Service checkpoint permissions are checked as SELECT-only. It omits client
reader policies and unrelated account/queue timestamp triggers; it does not prove
production schema parity. No customer rows were read for this metadata reference.

**Not deployed or wired into mailbox handlers.** The next step is the mailbox
engine: recover its attempt/request, validate saved provider continuation, process
an owned page, settle a durable transition, and complete the queue atomically.
Coordinated hosted TEST acceptance remains required. No hosted data, permissions,
credentials, schedules or production deployment changed.

## Gmail page processing — local implementation, 10 October 2026

`gmail_capture_page.ts` reads one explicit recent or historical page and validates
its continuation token. Recent INBOX and SENT traversals remain separate;
historical listing has no label filter. Profile identity and decimal uint64
history IDs are checked without Number conversion. Expired history is surfaced
for recovery, never silently replaced with a new traversal. The implementation
follows the documented [message listing](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)
and [history listing](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)
contracts.

The persistence helper fetches at most four messages concurrently and validates
the complete page before writing. Missing-only capture keeps existing messages;
explicit refetch uses the same stored identities. A provider-reported missing
message is counted without deleting retained data. Storage acknowledgements must
all succeed before returning page evidence; uncertain writes return no checkpoint
evidence. Existing shared parsing is reused, including its current body/header
behavior; attachment bytes are not downloaded.

Requests use a fixed Gmail origin, no redirects and a maximum 15-second fetch
timeout. Message fetching shares a default 60-second deadline. Responses are
bounded to 8 MiB individually and 32 MiB across a message page; oversize data is
refused without advancing progress. These are conservative worker limits, not a
claim that all Gmail messages fit them. Database calls are outside that fetch
deadline and still require lease checks in the eventual integration.

**Eleven synthetic local tests and TypeScript checking pass.** Tests cover
pagination, exact history IDs, expired history, malformed/oversize responses,
concurrency, preserved existing messages, disappeared source messages, partial
fetch failure and uncertain storage. See
[local evidence](evidence/learn-gmail-page-local-2026-10-10.json).

**Not integrated or deployed.** The storage port is tested using injected stores;
the real adapter must preserve newer thread summaries and union participants
when old history arrives. Provider continuation validation in the engine,
lease-aware transitions, atomic queue completion and hosted acceptance remain.
No real provider requests, database changes, credentials or schedules changed.

## Email job/attempt recovery — local implementation, 10 October 2026

`20261031234500_learn_email_job_attempts.sql` binds each email queue job to one
immutable sync attempt. Run creation and binding are atomic. A lost response or
replacement worker recovers the same run, including a terminal result; it does not
open a fresh run to conceal interrupted work. The binding freezes the job's
identity and payload and verifies company, mailbox, job type and current lease.
`email_job_attempt.ts` validates that response and distinguishes recovered terminal
evidence from permission to fetch new pages.

The migration adds lease arguments to the outbox's two mutation APIs and removes
their old signatures. Job-bound attempts require the current worker/claim before
preparation or application. Locks follow job, attempt, account/run order. The
application rechecks expiry after the protocol and settlement writes so an expired
lease rolls the transaction back. Standalone service attempts retain their prior
behavior. Existing low-level v2 protocol APIs are unchanged; job workers must use
the lease-aware outbox adapter rather than bypass it. The generic worker now passes
the authoritative job type and claim into its handler context.

The combined isolated SQL/client suite passes **22 scenarios / 23 Node results**,
including rollback of the API upgrade, lost binding acknowledgements, replacement
workers, missing/stale leases, changed job definitions, foreign companies, and an
injected delay that expires the lease after protocol execution. That test proves
the settlement trigger ran, then confirms that progress rolled back and the next
lease recovers the original request. Four generic-worker VM tests also pass and
verify claim propagation. The shared modules pass TypeScript checking. See
[local evidence](evidence/learn-email-job-local-2026-10-10.json).

A fresh read-only TEST inventory at **14:14:33 UTC** captured the queue table
contract used by the fixture in `supabase/reference/learn-email-job-test-2026-10-10.json`.
No queue records were read. **Not deployed or wired into mailbox handlers.**
Validated provider pagination, persistence and lease-bound queue completion still
need integrating before a coordinated TEST release. No provider requests, hosted
records, permissions, credentials or schedules changed.

## Durable email transitions — local implementation, 10 October 2026

`20261031233000_learn_email_transition_outbox.sql` adds append-only request and
settlement tables, restricted to the existing server role. Its preparation API
binds each document to its company, Gmail account, stream and running sync attempt.
An attempt lock serializes preparation and application: a second request cannot
replace an unresolved one. Identical requests can be recovered after the attempt
finishes; altered documents under the same ID are refused. Client roles receive
no table access or execution permission.

Application invokes the existing v2 protocol and saves the settlement in the same
transaction. A settlement failure rolls back the protocol's writes while retaining
the previously prepared request. Refused requests retain their decision even if
the account later becomes eligible. Successful replay asks the protocol for the
current checkpoint alongside its old receipt, rather than treating a cached
response as present ownership. Existing protocol functions and their grants are
unchanged. No flags, credentials, provider work or schedules are seeded.

`email_ingestion_outbox.ts` implements database-backed retention and pending-request
recovery for the typed client. Unknown prepare/apply responses remain unresolved;
the adapter neither regenerates IDs nor fetches provider pages. The combined
isolated suite now passes **16 scenarios / 17 Node results**, including concurrent
preparation in separate database sessions, lost acknowledgements, receipt failure
rollback, immutable history, role restrictions and company isolation. Both shared
modules pass TypeScript checking. See the
[local evidence](evidence/learn-email-outbox-local-2026-10-10.json).

**Not deployed or wired into mailbox handlers.** Durable association between a
queue job and its sync attempt is now implemented locally above. An Edge restart
must recover that same attempt before reading its pending request. Provider continuation
validation, page persistence, queue completion and actual-schema TEST release
acceptance remain required. The isolated fixture retains the scope limitations
described below.

## Email protocol client — local contract verification, 10 October 2026

`supabase/functions/_shared/email_ingestion_protocol.ts` now provides the typed
client for the existing v2 transition and receipt functions. It retains an exact,
frozen request before dispatch, preserves bigint revisions as decimal strings,
validates company/account/attempt identity on responses, and distinguishes a
historical receipt from the current checkpoint. An unknown response never causes
an automatic new transition or provider retry. An absent receipt keeps the
original request unresolved. Retention compares canonical JSON so JSONB key
ordering does not falsely change a saved document.

Nine integration scenarios (10 passing Node test results including the parent)
exercise this client against the ten actual email protocol function definitions
from the recorded TEST reference, four table structures, indexes, constraints,
protocol grants, RLS policies and ingestion guards in an isolated Postgres 15
container. The protocol owner has no superuser or RLS bypass. Tests use synthetic
mailbox attempts and local file retention; no provider or hosted database is
contacted. They cover lost-response recovery, immutable request identities, stale
ownership, exact revisions above JavaScript's safe integer range, malformed and
cross-company responses, incomplete-page refusal, historical yield, and cursor
advancement only after all INBOX/SENT pages. Direct terminal/progress writes remain
rejected by the existing guards. The new client also passes TypeScript checking.

**Not wired into the mailbox handlers or deployed.** The durable request store is
now locally implemented above. The Edge worker still needs job/attempt binding, validated provider continuations,
page fetching/persistence, and lease-bound queue completion. An in-memory retain
callback would not satisfy the client's contract. The isolated fixture omits the
unrelated launch-reader policy and account timestamp trigger; it is protocol
verification, not a full hosted-schema or worker acceptance test. Run it with
`node --test scripts/verify/learn-email-protocol-client.test.mjs` using the existing
local Docker engine. Its container has no network or host mounts and is removed
after the run.

## Capture runtime reconciliation and phone pause races — 10 October 2026

A read-only TEST inventory at **13:56:40 UTC** confirms that email ingestion v2
exists in the database, but its Gmail/Workspace workers, three email schedulers,
generic platform worker, phone scheduler and phone pipeline are not deployed in
TEST. The phone pipeline-state view and all three retry/selection functions are
also absent. The capture-control migration's exact phone-selector patch therefore
cannot yet be installed there. Existing Slack and Commusoft claimant exclusions
remain present in the generic database claimant.

The three local mailbox handlers still directly update terminal sync runs and
mailbox progress. TEST's existing guards require the v2 transition functions for
those writes. A capture-admission check alone does not make these handlers
compatible. Reconcile them with the recorded transition, receipt recovery and
queue-completion protocol; do not disable the guards or overwrite saved progress.
This is a TEST finding, not evidence of a new production capture failure.

The audit reader is `scripts/verify/learn-capture-runtime-audit.mjs`. Its
[report](evidence/learn-capture-runtime-audit-2026-10-10.json) identifies the exact
missing dependencies and hashes the inspected functions. The hosted protocol's
13 function definitions, four table contracts and scoped grants are retained in
[`supabase/reference`](../../supabase/reference/README.md) as an integration
reference. No source records or credential values are included. This is neither
a deployable migration nor a full database backup.

Actual handler tests now exercise phone pauses after initial admission. Partial
call counts remain recorded when the recordings child pauses; neither cursor nor
account health is advanced. A genuine provider failure alongside a pause remains
a failure. A waiting pipeline run stays separate from real retry history.
Testing exposed an unconfirmed-write bug: the scheduler and pipeline previously
returned waiting even if its database update failed. They now require the exact
company-bound running row to be returned. Database errors, zero-row updates and
transport exceptions return `learn_capture_wait_unconfirmed`, with no private
diagnostic details or false settled-waiting result. All **29** actual Edge/queue
handler VM tests pass. These changes remain local; no hosted runtime was changed.

## Capture module controls — local implementation, 10 October 2026

`20261031230000_learn_capture_controls.sql` adds audited operator control requests
for the LEARN master switch and email/phone/Slack capture. It reuses existing
OpenFolk effective-dated authority, denies tenant ownership and View As as sources
of operator permission, and shares the existing Commusoft setup lock. Changes use
a revision check, immutable receipts, replay recovery and cancellation tombstones.
Malformed flag values block capture without exposing their raw contents. Missing
source flags inherit current connector behavior; installation seeds no switches.

New server admission checks run before provider access in OAuth Gmail, Workspace
incremental/backfill/discovery, phone calls/recordings/downloads and the Slack
worker. Enqueue and SQL claim paths also check capture policy. A pause after claim
returns the same queue lease without consuming a retry or recording false capture
success/failure. Saved Slack pages can still settle without fetching again. The
generic worker reports an unconfirmed deferral as unresolved. A batch already
admitted may finish; the next capture boundary checks policy again.

Phone downloads check policy before creating a sync run. Cached audio remains
available, while forced downloads require admission. Scheduled phone capture
retains its cursor when either child waits; waiting is distinct from a provider
failure. A pipeline interrupted before downloading retains a `pipeline_waiting`
operational row so it does not replace the retry history of actual pipeline
attempts. Phone selection filters paused downloads before its bounded result,
allowing transcription/analysis of retained audio to continue.

Local validation: 23 actual Edge/worker-handler VM checks and 11 admission/Slack
tests pass; application TypeScript passes. The isolated SQL fixture exercises the
actual operator, queue and phone-fairness functions, plus rollback, scope/authority,
audit/replay/cancellation, stale revisions, malformed flags, source/checkpoint
preservation, saved-page recovery, retry-neutral deferral and a concurrent pause
waiting on the admission lock. See
[local control evidence](evidence/learn-capture-controls-local-2026-10-10.json).

**Not installed in TEST or production.** Remaining release work includes an
actual-schema rehearsal and installation of the missing phone dependencies,
email-worker reconciliation (the existing TEST ingestion protocol differs from
this checkout), new pinned worker bundles, hosted phone pause-race
acceptance,
acceptance, and the operator UI with retained-request recovery and intentional-pause
health states. Existing historical phone/Slack deployment bundles must not be
repointed at the changed source. Deploy the coordinated schema/runtime before
exposing these switches; a missing admission RPC deliberately prevents capture.
No existing hosted records, flags, jobs, schedules or credentials changed in this
implementation turn.

## Commusoft contact acceptance — hosted TEST, 10 October 2026

The explicitly approved single-account test passed at **13:21:15 UTC**, with a
separate read-only retirement confirmation at **13:21:47 UTC**. Seven synthetic
pages, versions, permits and successful jobs remain as evidence. Signed-in review
produced one customer card, one site, one job, two people and four contact points.
The test exercises customer and site contacts, unresolved-property holds, shared
email identity review, deliberate lost-response recovery, receipt replay,
cancellation and immediate access loss after demotion. Existing person fields and
contact verification state remain unchanged. All 39 checked pre-existing datasets
and the installed schema/runtime contract match their pre-run snapshots.

The synthetic login is banned, its profile demoted, temporary operator grant ended,
connection revoked, account/connector/switches disabled and dummy Vault binding
renamed. No active synthetic job or authority remains. See
[hosted acceptance and retirement evidence](evidence/learn-commusoft-contacts-hosted-2026-10-10.json).

The initial preservation preflight failed before creating any fixture records:
two verification child tables require a parent-request join for company scoping.
After correcting that query, the runner verified authoritative absence and resumed
with the exact approved identities, retaining the failed attempt's recovery record.
It refuses this continuation if any account, company, grant, connection or binding
exists, or if any fixture work was previously attempted.

Provider responses were intercepted synthetic fixtures. Successful capture used
the production worker modules locally with hosted TEST Vault/RPCs; deployed Edge
execution was exercised for saved-page recovery while capture was disabled. This
does not verify Drummonds' real Commusoft API credentials, response coverage or
production readiness. No production changes or real Commusoft requests occurred.

## Email capture evidence correction — TEST backend, 10 October 2026

Read-only production checks at approximately 13:10–13:15 UTC found that all 30
inspected email accounts lacked `last_incremental_success_at`. Recent Workspace
sync-run records nevertheless reported successful captures, including one changed
record at 13:08 UTC. This is a reporting mismatch, not evidence that all capture
stopped. The deployed `gmail-workspace-sync-messages` version 45 was downloaded
and inspected without invocation: it updates run completion but does not populate
the newer account-success field. Its version and deployment hash were reconfirmed
at 13:14:47 UTC. Deployed shared helpers differ from this checkout; reconcile those
versions before changing capture guards or deploying replacements.

The follow-up migration `20261031220000_learn_email_capture_evidence.sql`
adds mailbox-specific terminal sync-run evidence to the operator health reader.
It matches company, mailbox and OAuth/Workspace capture path, excludes scheduler
heartbeats and historical backfill, rejects incomplete success records, and keeps
raw errors and private metadata out of the response. Existing release 031 is
unchanged. Local Postgres checks pass for rollback, company/mailbox separation,
failure and recovery, provider-path separation, redaction and the application
response parser. Release 032 was installed in TEST and confirmed at **13:30:45 UTC**,
following a hosted rollback rehearsal at **13:29:32 UTC**. Both operations retained
all 44 checked datasets, including email sync history and encrypted Vault records.
The release adds one lookup index and changes one health reader; it creates no
tables, users, credentials, capture jobs or schedules. The TEST ledger now has 33
receipts. The prior schema is preserved apart from those exact changes. See
[release evidence](evidence/learn-email-health-test-release-2026-10-10.json).
Authenticated hosted UI acceptance is still required; neither this correction nor
the operator capture panel has been released to production.

Release package 032 now has an isolated PG17 rehearsal of the 36 actual dependent
TEST tables, their indexes, policies, triggers and privileges, and 57 function
definitions. This includes both email-ingestion guards. Synthetic terminal run
updates use the existing protocol-owner privileges; the guard still refuses a
terminal update by an ordinary database owner. The new reader runs as the actual
non-superuser owner and retains its authenticated operator-only access. Exact
schema comparisons show one changed reader and one added index; all test source
rows are preserved. Rollback, receipt failure, duplicate release refusal, mailbox
and provider-path isolation, private-error exclusion, View As denial and the actual
application parser pass. No Auth account or hosted source fixture was created.

Recent run results do not prove full mailbox coverage or preservation of every
email. No production account, worker, schedule or source record was changed.

## OpenFolk capture diagnostics — TEST backend, 10 October 2026

The operator Modules view now includes a tenant-scoped email, phone and Slack
capture panel. It reads a new metadata-only RPC, using existing platform authority;
tenant ownership or View As does not grant access. Results exclude credentials,
raw provider errors, account settings, cursor tokens and message/audio content.
Reads are paginated at 50 accounts. Personal Gmail and Workspace DWD are identified
separately. Recent activity is evidence of a run, not complete source coverage.
Slack completion requires the latest successful history job to match the retained
scope/page checkpoint and records only the approved channel window; thread and
continuous capture remain separate checks. Failed refreshes clear old results.

Release 031 is installed in TEST and confirmed at **13:04:28 UTC**. It adds one
read-only function, no tables or existing-function changes, and takes the release
ledger to 32 receipts. Hosted rollback and installation retained all 43 checked
datasets, including email account metadata and encrypted Vault rows. No new account,
credential, provider request or capture job was created. The first install preflight
was rate-limited before a write journal existed; only the subsequent attempt
submitted a migration. See [TEST release evidence](evidence/learn-capture-health-test-release-2026-10-10.json).

The isolated PG15 fixture is supplemented by a PG17 rehearsal reproducing the
35 actual dependent TEST tables, policies, triggers, grants and 55 helper functions,
including the existing email-ingestion protocol guard. The new function passes
with the actual non-superuser owner. Rollback, deployment-receipt failure and
duplicate-install refusal pass. Authenticated hosted read verification remains
required; this feature has not been released in the frontend or production. No source records, workers, schedules, flags or credentials
were changed. Email/phone/Slack pause controls still need every capture entry point
to honour the operator's module decisions before those controls can be released.

Validation: SQL rollback, cross-tenant exclusion, platform-viewer access,
tenant-owner denial, revoked-access denial, source redaction, DWD classification,
Slack checkpoint mismatch and 50+8 pagination pass; the actual SQL response passes
the TypeScript parser. Three model/parser tests, TypeScript and application build
pass. A network-disabled synthetic browser preview verifies 50+2 pagination,
distinct freshness/authentication states and clearing results after a read failure.
See [local evidence](evidence/learn-capture-health-local-2026-10-10.json).


Read-only checks on 9 October 2026 reused the saved Supabase CLI and Vercel logins.
Those initial audits changed no hosted state. The later **TEST-only metadata release
and subsequent card/work foundation, rules, conflict-repair, measurement and work-capture installations** are recorded below; production remains untouched.
The Vercel CLI refreshed its existing local
session after a direct request using the old saved access token returned HTTP 403.

## Current evidence

Supabase project listing reports both known projects `ACTIVE_HEALTHY`:

| Environment | Project | Organisation | Region |
|---|---|---|---|
| Openfolk TEST | `saatxzwxvdvqevbnskxy` | `efqvhoxukklewruplpdp` | eu-west-1 |
| ServiceOS production | `tgbnakbxwcqjeimygroz` | `nmhqcjrjrtwsvlcvqqnh` | eu-west-2 |

Only TEST schema catalogs and its deployment ledger were queried. Production
database contents and schema were not queried during this audit.

The latest retained TEST catalog is **2026-10-09 21:29:46 UTC**.
The [governed action catalog](evidence/learn-test-actions-installed-schema-2026-10-09.json)
includes the catalog-only readiness report. The foundation and earlier launch
catalogs remain historical snapshots, not the current installed schema.

- 80 public base tables, all with RLS, plus eight restricted launch views.
  The 33 new foundation tables have authenticated SELECT and service-role DML.
  Existing raw communications grants and ingestion policies remain unchanged.
- `customer_cards`, `jobs`, `team_members`, `org_units`, `intelligence_objects`
  and `graph_nodes` now exist. Synthetic signed-in access and company isolation
  passed at 20:12:34 UTC. `interactions` still lacks ordinary-user read authority.
- Nine of ten inspected RPCs now exist: scorecard draft save/read, publication,
  period-rule reading, membership-history reading, performance review, work-history
  reading, handoff collection and residence collection. Signed-in acceptance passed
  for rules at 20:38, measurements at 20:50 and capture/collection at 21:01 UTC,
  including the real card and timeline readers. Slack setup remains absent/unavailable.
- `learn-launch-status` version 1 remains ACTIVE with gateway JWT verification
  and TEST-only metadata mode. Its synthetic redaction, source-denial and authority
  checks passed again after the foundation installation.
- `current_tenant_id()` and `is_openfolk()` now explicitly allow authenticated
  execution; anonymous execution remains denied. Their bodies and source-table
  privileges were preserved. This follow-up repaired the access failure found by
  actual JWT testing; the local verifier now reproduces the original denied grants.
- TEST still uses `of_test_deploy.migrations`, with nine retained receipts:
  `openfolk_test_learn_bootstrap_v5`, `learn_launch_metadata_views_v1`,
  `learn_card_work_foundations_v1`, `learn_foundation_helper_access_v1`,
  `learn_rules_membership_v1`, `learn_scorecard_conflict_codes_v1` and
  `learn_measurements_reviews_v1`, `learn_work_capture_collectors_v1` and
  `learn_governed_work_actions_v1`.
  No standard migration ledger appeared. The original bootstrap source was not
  found in earlier targeted recovery; absence from a checkout or standard ledger
  does not imply an empty environment.

See [foundation source provenance](LEARN-TEST-FOUNDATIONS.md) and
[rules release and conflict repair](LEARN-TEST-RULES.md), and
[measurement/review release](LEARN-TEST-MEASUREMENTS.md), and
[work capture/collection signed-in acceptance](LEARN-TEST-WORK-CAPTURE.md).
The [governed action bundle](LEARN-TEST-ACTIONS.md) was installed at 21:23 UTC.
Its `work-transition` endpoint version 1 is ACTIVE with gateway JWT verification.
Real signed-in acceptance passed at 21:29 UTC, including staff actions, scoped
assignment/cover, revocation and actual handoff collection into a card. No full
browser or real-customer rollout is implied.

The catalog script deliberately continues to say `not_release_verified`: it cannot
prove source completeness, actual customer behavior, source connectors or the full UI.

Vercel's current Allkin project list has one entry:
`serviceos-dh` / `prj_XEuCp5gnEireW5WynUgkRp9QNiXa`; pagination reports no next page.
There is no separate TEST project in that scope. This inventory does not prove
domain ownership, deployment protection, capacity or configured frontend targets.
The existing production project must not be repurposed as TEST.

## Reproduce the read-only audit

```sh
LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy \
  node scripts/verify/learn-test-readiness.mjs --existing-cli-login
node --test scripts/verify/learn-test-readiness.test.mjs
```

Alternatively provide the already-authorised `SUPABASE_ACCESS_TOKEN` through the
secure process environment and omit `--existing-cli-login`. Do not paste it into
commands, source, reports or chat. The macOS option reads only the CLI's documented
profile/legacy keychain entries into memory. It does not create a login or API key.

The script refuses production/unknown target allowlists, checks TEST's project ID,
organisation and current health before reading, and uses only fixed metadata
requests. Catalog and migration-ledger queries use Supabase's
[read-only query endpoint](https://supabase.com/docs/reference/api/v1-read-only-query).
Token lookup follows the installed CLI's
[credential-store implementation](https://github.com/supabase/cli/blob/v2.40.7/internal/utils/credentials/store.go).
Vercel metadata was checked through the saved CLI using the documented
[project inventory API](https://vercel.com/docs/rest-api/projects/retrieve-a-list-of-projects).

Four tests cover the real catalog snapshot, column-grant recognition, fixed TEST
request scope, no API-key requests, identity changes and incomplete/error results.
Seven additional catalog tests cover the restricted view/role contract and unsafe
privilege changes. The isolated PostgreSQL verifier exercises the actual catalog
query before/after installing the views, granting an extra transcript column and
granting application-role membership; both unsafe changes are detected.
Exit zero means the inspection completed; the report remains
`not_release_verified`. Even full catalog presence cannot prove policy semantics,
ordinary-user access, tenant isolation or connector acceptance.

## Concrete release work now required

The [restricted metadata release](LEARN-TEST-LAUNCH-ACCESS.md) was installed at
19:32 after a matching hosted rollback rehearsal, with an atomic checksum receipt.
The function deployed at 19:33, and signed-in synthetic acceptance passed at 19:38.
It verified owner/admin access, viewer/ops denial, tenant isolation, payload/error
redaction, private-source denial and role revocation through real Auth/PostgREST/Edge.
All fixture users and records were removed and absence verified. The broader
product foundations, frontend and providers remain incomplete.

1. Reconcile the deployed bootstrap and custom ledger. Recover its exact source if
   available; otherwise document the deployed definitions from read-only catalog
   evidence and compare a reviewed reconstruction. Never replay a blanket bootstrap
   merely because the standard migration ledger is absent.
2. Prepare an explicit additive dependency manifest against this partial schema:
   canonical customer/job/roster/graph/work foundations, then the local LEARN
   performance/capture/publication adapters. The successful local schema-clone
   tests used a different, fuller schema and do not establish TEST compatibility.
3. Extend appropriate read authority for the remaining card/work/roster surfaces.
   Preserve the now-verified launch metadata boundary and original ingestion
   protocol policies; no service-role fallback or blanket source grants.
4. Rehearse each remaining candidate against TEST's actual schema and repeat
   ordinary-user, foreign-tenant and no-JWT acceptance for its own contract. The
   launch-status result does not prove unrelated RPC or full application access.
5. Prepare a separate Vercel TEST project/candidate with TEST-only configuration,
   verified included capacity and deployment protection. Rehearse the full product
   build rather than deploying the synthetic browser harness.
6. Finish provider-specific setup and reconciliation: existing Gmail credentials
   with the intended TEST callback/consent, Slack's approved connection/channel,
   Birchills voicemail discovery, Commusoft and vehicle-source mappings. Neither
   project health nor database row counts proves working ingestion.

The audit remains read-only. The separately recorded metadata deployment and
synthetic acceptance cover one release slice, not complete LEARN acceptance.
The overall LEARN V1 goal remains active.
