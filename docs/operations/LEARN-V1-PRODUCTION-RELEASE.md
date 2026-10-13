# LEARN V1 production release plan

> 13 October 04:08 BST: newer local Slack historical-range and request-accounting
> changes are verified offline but are **not included** in the staged release
> below. They require a new paired SQL/runtime/frontend candidate and hosted
> acceptance. Do not treat the older 23-package manifest or runtime preflight as
> proof that the current worktree is packaged or ready to promote. No hosted
> deployment, capture setting or production domain changed in this work.
> [Local evidence](evidence/learn-slack-historical-ranges-2026-10-13.json).

> 13 October 03:50 BST: the current frontend is staged production deployment
> `dpl_5j57s4SuMBQMkzKEpM2BgX4BE9m6`, Git `d535085`, including the TEST-accepted
> operator LEARN entry and embedded layout. Its rendered login targets production,
> the read-only promotion preflight is ready, and all four live domains are unchanged.
> The 74-step release sequence is updated; 22 frontend/coordinator/journal tests pass.
> Positive signed-in acceptance and all remaining live execution gates stay open.
> [Current frontend evidence](evidence/learn-production-frontend-operator-learn-2026-10-13.json).

> 13 October 03:27 BST: the current candidate includes package 023 (Commusoft
> search planning), with 23 SQL packages, 37 unchanged runtime artifacts and a
> refreshed 74-step release sequence. Full-schema preservation, rollback/guards,
> 37 fresh runtime boot checks, 28 scheduler checks and 45 local release tests passed.
> The frontend remains staged deployment `dpl_FHkfcrYZQ6bVmupHvvjse5pKUrFu`
> (Git `cbb310c`); no production domain or backend was changed.
> [Current evidence](evidence/learn-production-review-planning-2026-10-13.json).
> Fresh recovery, live sign-in and execution/acceptance gates remain open.

Earlier observations below are retained as history; current artifact identities
come from the release manifests and the evidence above.

> 13 October 02:07 BST: promotion now pins staged production deployment
> `dpl_8YWHfdbY2SFVkKWsBcEz5LcnMVFn` (same Git `bebb19c`). Domain assignment was
> disabled; the previous live deployment and all four production domains are unchanged.
> Browser login binding and hosted read-only frontend preflight passed; 45 local
> release tests pass. Signed-in acceptance and the remaining execution gates are open.

## Current execution observation — 13 October, 02:14 BST

Use the bounded, read-only helper before and during the separately controlled drain:

```sh
LEARN_PRODUCTION_READ_ONLY_PROJECT=tgbnakbxwcqjeimygroz node \
  scripts/verify/learn-production-runtime-activity.mjs \
  2026-10-13T00:53:00.000Z 2026-10-13T01:08:00.000Z \
  .verification-results/production-runtime-activity-verified-20261013.json
```

Choose a fresh minute-aligned window no longer than 30 minutes and a new private
report path; the example is the already-completed observation. The script uses the
current Management API `/analytics/endpoints/logs`, with ClickHouse SQL, and selects
no raw messages, headers or request bodies. It rejects query errors, truncation and
malformed/duplicate aggregate rows. Unknown function IDs remain explicit.

The real fixed window grew from 48 to 57 HTTP events between reads: logs arrive
late. This helper deliberately cannot satisfy `verify-in-flight-drain` by itself.
Neither HTTP success, absence of logs, nor subtracting Boot/Shutdown totals proves
background completion. A shutdown may belong to a boot before the window, and a
successful HTTP response may precede detached work. Combine this evidence with
paused schedules, no current leases, stopped downstream work and coordinated callers.
No runtime, schedule or customer record was modified for this observation.

The accompanying database check found 55 successful workspace message checks,
three delegation failures on previously investigated accounts, six successful phone
capture cycles, and zero newly stored communications/recordings in the preceding
half-hour. Scheduler `records_processed` can count work dispatched; do not present
it as new email count. HTTP logs and persisted run outcomes are separate evidence.
[Current observation](evidence/learn-production-runtime-activity-2026-10-13.json).

## Concrete frontend promotion adapter

`learn-production-frontend-adapter.mjs` plugs into the coordinator's frontend port.
`loadFrontendOperation()` verifies the plan binding; construct the adapter with that
operation and its fixed-path transport. CLI transport reuses the current login for
reads only. Promotion uses `productionFrontendHttpTransport` with an existing
in-memory credential, explicit write enablement and current scoped release authority.
The CLI API client can retry requests internally, so it is never used for this mutation.

The adapter rejects preview targets, different source revisions, changed project/team,
unready artifacts, changed protection, incomplete/changed domain inventories and aliases
outside the previous or selected deployment. It reads project state before and after
alias inspection. Only the exact new target, all four remapped aliases and a succeeded
matching promotion job count as applied. Pending or mixed states remain unconfirmed.
The journal reconciles a lost response without repeating the POST, including after restart.

The provider API does not offer an expected-previous-target precondition. Exclude other
release writers before execution; repeated readback cannot provide atomic compare-and-swap.
The read-only hosted check returned ready; this does not prove positive promotion or
signed-in service acceptance. Full backend gates remain mandatory.

The old preview cannot be promoted through the CLI without rebuilding. The staged
production build uses the documented [no-domain deployment workflow](https://vercel.com/docs/cli/deploying-from-cli),
then the [no-rebuild promotion endpoint](https://vercel.com/docs/rest-api/projects/point-production-traffic-to-a-given-deployment).
[Staged build evidence](evidence/learn-production-frontend-staged-2026-10-13.json) and
[adapter evidence](evidence/learn-production-frontend-adapter-2026-10-13.json).

## Previous matching-candidate observation

> 13 October 01:56 BST: the current 73-step plan now includes the TEST-verified
> relevance repair and protected preview `dpl_HPUABE8gMShxGYnopkVbgTkPAQHP`
> (Git `bebb19c`). All 37 exact runtime artifacts passed fresh compile/boot checks;
> 28 scheduler checks and 38 release tests pass. The 22 unchanged SQL packages
> retain their previous full-schema rehearsal evidence. Production is unchanged;
> concrete live gates, fresh independent recovery and signed-in acceptance remain.
> [Current matched candidate](evidence/learn-production-relevance-2026-10-13.json).

## Current execution integration — 13 October, 01:40 BST

The pinned 73-step sequence now has a coordinator that connects the journal to
SQL/schedule, configuration, runtime, check and frontend adapters. Configuration
readbacks are validated, saved with private permissions and flushed to disk before
the journal accepts the change. Restart loads that same candidate/step-bound
receipt before runtime deployment, preserving the updated function-version baseline.
Only metadata and credential digests are stored; secret values are rejected.

All 38 local release checks pass. The integration test drives actual configuration
and runtime adapters through setup, restart, 37 uploads, publication and activation
against a simulated API. SQL, frontend and external checks in that test remain
simulated; this is not hosted release acceptance. Missing adapters stop before
intent. Lost acknowledgements, failed receipt storage and state changes between
observation and readback cannot silently advance or resubmit a mutation.

Production execution still requires concrete fresh recovery, drain, caller and
frontend adapters with retained evidence, plus signed-in acceptance. The coordinator
supplies no successful default gate or fabricated approval. A partial receipt file
requires inspection and deliberate recovery; it is never overwritten automatically.
No production configuration, runtime, schedule, alias or customer data was changed
by these checks. The exact candidate and upload files remain unchanged.

[Coordinator evidence](evidence/learn-production-release-coordinator-2026-10-13.json).

## Earlier release observations

> 13 October 01:14 BST: the 14 old unleased running jobs are now recorded as
> interrupted in production, with all original fields preserved in audited snapshots.
> No source data, schedules or runtime were changed. The subsequent read showed
> no running platform jobs, but a controlled release drain is still required.
> [Recovery evidence](evidence/learn-production-legacy-job-recovery-2026-10-13.json).

> 13 October 01:00 BST: packages 001–022 and 37 freshly compiled runtime artifacts
> passed isolated database, boot and scheduler checks. Production remains unchanged.
> The current 73-step operation plan now pins 22 packages, 37 runtimes and the
> protected production-configured frontend dpl_8pxWB8RWQcNseSQHPExMQ3Gos354.
> Its 31 adapter/journal tests and 19-site RPC binding check passed. Configuration
> preflight is ready without provisioning secrets. Older release plans below are
> historical. Live unleased-job reconciliation, drain, authenticated acceptance
> and recovery gates remain open.
> [Current evidence](evidence/learn-production-learning-2026-10-13.json).

> 13 October 00:10 BST: atomic observation delivery and reviewed Slack context
> are now verified in hosted TEST (worker v23, packages 086/087). Production still
> needs a matching new package and runtime proof. TEST 087 fills old foundation
> columns already present in production; do not replay it against production.
> UI acceptance and all remaining launch requirements are still open.

> 12 October 22:45 UTC: local intelligence-ingestion reliability changes postdate
> the pinned 21-package candidate below. They have not been deployed. Regenerate
> and verify matching runtime artifacts before promoting the new source. See
> `LEARN-V1-COMPLETION.md` for the newly confirmed TEST learning gaps.

Status: **deployment authorised by Chris on 12 October; technical release gates
still incomplete, no production promotion executed**. Keep the existing live UX
and Drummonds branding on both `openfolk.ai` and `test.openfolk.ai`. The showcase
preview is not a replacement design. This approval supersedes older pending
ordinary-promotion approval statements below; it does not prove the package,
runtime, signed-in acceptance or preservation gates passed. The
[completion checklist](LEARN-V1-COMPLETION.md) is the acceptance authority.
The current hosted TEST frontend is Git `f06cfb8`; package 085 adds audited
Slack company/job context review without enabling capture. Both retained real
public-channel messages were reviewed through the signed-in operator UI. Original
source records were preserved. Nineteen real email-to-card deliveries are also
verified in TEST. These bounded results do not establish complete history or AI.

The production candidate now includes packages **001–021**, 37 exact runtime
artifacts and a **72-step** release sequence. All 21 packages passed the isolated
retained archive install, with original rows/sequences preserved. Slack source-edit,
review/replay/cancellation, revocation, isolation and package rollback checks pass.
No runtime source changed; retained exact-artifact startup and 28 scheduler checks
are explicitly carried forward, not newly executed. All 31 release tests pass.

Fresh read-only production checks found all 88 expected server definitions, zero
new release receipts and original target schedule states among 18 schedules.
The schema comparison matches after the four previously documented Marketing
constraint-deparsing differences were checked against their original archive
hashes again. No production definition was replaced or normalised.

The current protected production preview is Git `d42987e`, deployment
`dpl_HAuQP1P52UzyXXSyGo5pWWEKVioa`, at
[the production-configured preview](https://serviceos-o1jy1xq2t-allkin.vercel.app/login).
Its rendered auth target is verified as production; signed-in acceptance is still
pending. 1Password is currently locked. The live deployment remains
`dpl_DXueDsax146gdtyFoniXRaW3dzMM`; no backend, configuration, schedule or live alias
was changed in this release-preparation step.

[Matched release evidence](evidence/learn-production-slack-context-2026-10-12.json),
[real Slack TEST acceptance](evidence/learn-slack-work-context-2026-10-12.json) and
[frontend evidence](evidence/learn-production-frontend-slack-context-2026-10-12.json)
supersede older candidate pins below. Positive hosted caller acceptance, current
recovery and drain evidence, signed-in live journeys, complete provider coverage
and initial live operation remain open.

## Server configuration execution — 12 October

The configuration adapter now implements both pinned configuration steps. Setup
reuses the existing production service credential for the two explicit internal
worker bindings, sets the production metadata reader and leaves input dispatch
false. A separate step changes only dispatch to true after the matched runtime
and the release's acceptance gates. Secrets are project-wide: caller and worker
read the same named binding. Values travel in memory, never in evidence or Git.

The adapter compares all existing secret digests and runtime definitions before
and after one exact POST. It rejects unrelated changes, partial writes and
unexpected version jumps. A configuration refresh may preserve a version or
increment it once while retaining code, identity and gateway settings. Its exact
receipt supplies the runtime uploader's new version baseline; it is not a blanket
permission to ignore drift. The outer durable release journal must retain that
applied-step evidence before the receipt is used. Unknown submissions are read
back, never automatically repeated. Live propagation still needs positive caller
checks, even when management metadata matches.

Twenty-eight local adapter/journal tests pass, including a composed setup → 37
uploads → publication → activation simulation. The runtime loader also now uses
the current scheduler-caller release wire directory. Fresh production reads found all 88
existing runtime definitions unchanged, zero release receipts and the original
nine target schedules intact among eighteen schedules. No configuration, schedule,
database, runtime or frontend write was performed. The configuration adapter's
`ready` state is a metadata precondition, not whole-release readiness.

The read-only preflight is
`scripts/verify/learn-production-configuration-preflight.mjs`; its private output
retains only credential digests and deployment metadata. Before execution, bind
its exact candidate and step pins into the release journal and revalidate the
current approval, database receipts, coordination/drain and recovery evidence.
Signed-in production acceptance remains pending. The existing 1Password lookup
requires owner Touch ID; the latest attempt timed out without reading the item.

[Sanitised evidence](evidence/learn-production-configuration-2026-10-12.json) ·
[Supabase secret inventory API](https://supabase.com/docs/reference/api/v1-list-all-secrets) ·
[Supabase secret configuration API](https://supabase.com/docs/reference/api/v1-bulk-create-secrets).


## Matching processing candidate — 12 October

**Earlier preparation — 68 steps, superseded by the 70-step sequence above.**
The exact package/runtime/preview pins are in the release sequence. Local dispatch
now routes existing approved Commusoft/Slack work; its switch stays off during
staging. Commusoft's manual update periods retain exact bounds through resume and
preserve full contact-parent coverage. Automatic refresh approval/watermarks,
real-provider filtered acceptance, production configuration and signed-in journeys
remain unfinished. The prepared preview now includes the locally browser-verified
refresh controls; it must not be mistaken for a matched live backend.
[Refresh package evidence](evidence/learn-production-update-windows-2026-10-12.json)
and [current preview](evidence/learn-production-frontend-refresh-2026-10-12.json).

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

**Roster dependencies are now included.** Reviewing all 19 dynamic RPC sites
found six missing OpenFolk roster actions. Package
[016_roster_support.sql](../../supabase/release/learn-production/016_roster_support.sql)
adds those six service-only audited writers, a private guard and the two required
staff fields. Its complete production-archive rehearsal passed with original
source preservation, tenant-boundary and execute-permission checks, rollback on
late failure and duplicate-install rejection. Existing role memberships and
functions remain unchanged; installation creates no staff, responsibilities or
human authority grants. Existing staff gain only the additive `proposed` title
status default. [Rehearsal](evidence/learn-production-roster-rehearsal-2026-10-12.json).

The actual post-016 catalog supplies all 51 distinct functions reached through
the 19 manually reviewed dynamic call sites, with the required execute privileges.
Names and privileges do not prove named-argument semantics or hosted execution;
the separate journey checks remain applicable.
[Binding review](evidence/learn-production-rpc-bindings-2026-10-12.json).

The runtime candidate's only change is the additional SQL-package pin. The 37
endpoint configurations and all 221 source files remain identical. Exact retained
compiled bytes and the original offline boot evidence are carried forward with
both manifest/report hashes recorded; no new boot test is claimed. Upload bytes
remain 10,970,518 and have not been sent.
[Runtime derivation](evidence/learn-production-runtime-roster-binding-2026-10-12.json).
Use the current 16-package manifest and derived transport evidence for the release;
the older 15-package observations below describe their original scope.

**Existing scheduler credential bindings verified, read-only.** All nine observed
production cron callers targeting candidate endpoints still match their command,
schedule and runtime baselines. Their Vault values hash to the deployed runtime
secret fingerprints; the candidate retains their `verify_jwt=false` setting and
application-level `x-schedule-secret` authentication. No credential values were
returned or retained. The restricted metadata role cannot decrypt Vault, so the
successful comparison used the existing management connection inside an explicit
READ ONLY transaction. No role or permission changed.
[Caller evidence](evidence/learn-production-scheduled-callers-2026-10-12.json) and
[pinned schedule baseline](../../supabase/release/learn-production/scheduled-callers.manifest.json).

The release must coordinate these nine schedules with in-flight HTTP calls and
worker leases. Pausing the shared platform worker also delays other queued work,
including Marketing; do not describe that pause as affecting LEARN only. Keep the
original commands and schedules, record prior active states, and resume only after
the compatible runtime/configuration and acceptance checks are confirmed. The
two additional collector schedules target functions outside the candidate; the
18 known schedules are accounted for. External/manual callers and in-flight
requests still need review. This
inventory is not a pause command or release approval. Positive candidate caller
checks, the thirteen changed gateway flags and new Slack/Commusoft caller bindings
remain separate gates.

The production-project **protected preview** is now built from verified GitHub
checkpoint `254db7860447dc54b900635437fbd8cc0e21e1ef`:
[release preview](https://serviceos-yhfbegxeo-allkin.vercel.app/login).
It inherits the existing production/preview public configuration and leaves the
production deployment and custom domains unchanged. Its login screen loads; all
four unauthenticated routes remain protected. Actual served backend binding and
signed-in acceptance remain pending. Do not promote this preview before the
matching database/runtime/configuration and the concrete release approval.
[Preview evidence](evidence/learn-production-frontend-refresh-2026-10-12.json).

**Rollback artifacts and upload bytes are now prepared.** Read-only download
retained all 28 existing production endpoints as both source (227 files) and
compiled artifacts, with unchanged deployment metadata before/after each set.
The new 37 tested artifacts were encoded in the official CLI's EZBR transport
format; decompression reproduces every tested artifact exactly. Total upload
bytes are 10,970,518. Nothing was uploaded or deployed. Re-encoded rollback
compression hashes need not equal the provider's original compressed hashes;
the retained ESZIP bytes and observed version metadata are recorded separately.
[Recovery and transport evidence](evidence/learn-production-runtime-recovery-2026-10-12.json).
Rollback compatibility after new checkpoint formats still requires a coordinated
capture pause and compatible runtime or forward repair; restoring code alone
must not reset or discard newly retained inputs.

The four Marketing check-constraint differences are resolved: current definitions
match the original archive text exactly. The earlier comparison used the restored
and reparsed catalog. No production definition needs replacement. This is a
specific four-constraint reconciliation, not permission to normalise future drift.
[Definition comparison](evidence/learn-production-constraint-review-2026-10-12.json).

**Executable packaging and offline startup now pass.** All 37 exact candidate
artifacts bundle with the pinned Supabase Edge Runtime v1.74.3 and start without
network access, source/cache mounts, real credentials or customer data. Every
endpoint rejects a request with no authorization after required input validation.
The disposable runtime was removed. Twenty launch-reader/candidate checks pass.
[Exact artifact and boundary evidence](evidence/learn-production-runtime-readiness-2026-10-12.json).

Review found that the restricted status-reader option previously accepted only
TEST. The candidate now accepts `production_metadata_views` only for the exact
production backend. Owner/admin and wrong-origin checks pass; unavailable views
cannot fall back to private source tables. Set `LEARN_STATUS_READ_MODE` to this
explicit value during the approved release. Neither this setting nor the new
runtime has been deployed.

A names-only production inventory at 15:24 UTC confirms the existing Google,
phone, AI and legacy schedule credential names. The new
`LEARN_COMMUSOFT_WORKER_KEY` and `LEARN_SLACK_WORKER_KEY` are absent; provision them
with the matching caller bindings as part of the concrete promotion scope.
Microsoft app credentials are absent. Other absent names include optional
feature settings and existing service-key fallbacks, not ten mandatory secrets.
No credential value was read into the report and no setting was changed.

Earlier boot probes are retained privately: source-cache loading lacked an SDK
type declaration; native request forwarding and endpoint-specific synthetic
input shapes then corrected the harness. These are not counted as passing runs.
Only the final exact-artifact offline result is acceptance evidence.

The final packaging uses managed runtime dependencies rather than copying the
voicemail test dependency tree. All 37 rebuilt artifacts independently passed
the offline checks; their largest is 19,237,703 bytes, below a conservative
20,000,000-byte local bundle limit. The complete set is 57,021,299 bytes.
Use the verified local-bundle deployment path: Supabase documents different
[local and server-side size limits](https://supabase.com/docs/guides/functions/limits).
The earlier bloated set is not the release artifact set.

Production's public signing metadata exposes ES256. Current Supabase
[gateway documentation](https://supabase.com/docs/guides/functions/auth-headers)
supports asymmetric JWTs; this is not a reason to disable gateway protection.
The proposed flags remain unchanged, with actual signed-in and scheduled caller
checks still required. Public signing metadata and missing-auth tests do not
prove those positive journeys.

The [offline runtime manifest](../../supabase/release/learn-production/runtime-candidate.manifest.json)
binds all fifteen SQL packages to 37 proposed endpoints and 221 local dependency
files. The source closure hash is
`c529298cfe2123ea544d00327c011d2693c16614b89713c6911d694d1ecf0e82`.
It retains observed production/TEST endpoint metadata and inventories environment
names, literal RPCs, external imports and unresolved dispatch for review. Metadata
hashes from deployed Edge bundles are not interchangeable with local source hashes.

Four existing callers absent from TEST are included: customer-card, interaction,
identity and phone-processing schedulers. Thirteen candidate gateway flags differ
from current production. Explicit caller/authorization acceptance is required;
do not deploy using stale `config.toml` defaults or assume TEST flags prove all
production callers compatible. Shared worker dependencies include non-LEARN
handlers whose behavior must be retained. The manifest is not deployment code,
approval, a resolved executable bundle or proof that secrets are configured.

Twenty-seven focused local candidate/queue/capture/Slack tests passed. One old
queue fixture lacked valid admission; the fixture was corrected and denial
checks added without changing runtime. The production login page loads and
redirects correctly for an absent session; signed-in acceptance is still pending.

## Latest production preparation — 12 October, 14:52 UTC

Package [015_operator_context.sql](../../supabase/release/learn-production/015_operator_context.sql)
adds six functions and updates four existing Commusoft review authority bodies.
The exact production prerequisite schema and all 109 source-file pins match.
Four rolled-back journeys cover audited client information, real-actor business
review, provider-neutral linked customer context and recording authorization.
Wrong target, table/helper drift, late failure and duplicate installation fail
safely. The rehearsal preserves the archive's 299 original tables / 1,591,576 rows
and five original sequences, followed by exact comparison of 381 post-prerequisite
tables and seven sequences around package 015 and its journeys. Existing tables,
views, role memberships and Storage remain unchanged; one release receipt is added.
No hosted system or provider was changed. The first verifier used the wrong catalog
hash field; the corrected verifier passed with unchanged candidate SQL.
[Rehearsal evidence](evidence/learn-production-operator-rehearsal-2026-10-12.json).

A fresh production read confirms live deployment `13b5543` on `main`, with
`openfolk.ai` redirecting to `www.openfolk.ai`; the served client bundle contains
only the production Supabase host. At 14:45 UTC Drummonds retained 18,986 emails,
13,119 threads, 4,392 calls and 2,939 recordings with storage pointers. Recent
capture successes do not establish every mailbox is healthy. A current Directory
read confirms four configured addresses are absent from its user/alias inventory,
matching the observed `invalid_grant` failures. Two other configured addresses
are aliases. Retain their histories and reconcile their current capture routing
before claiming complete mailbox coverage; no mailbox was changed by this check.

The 14:52 public-catalog comparison had four check-constraint differences from the archive,
on Marketing tables outside every candidate's referenced-table list. No function
or view difference was observed. The subsequent direct archive comparison above
resolved these four differences without replacing any production definition.
[Live metadata and directory evidence](evidence/learn-production-live-readiness-2026-10-12.json).

## Complete candidate schema rehearsal — 12 October, latest scope

All fourteen production-specific packages now passed one ordered offline install
and combined exercise against the archived production schema. The 54 journey
invocations include scoring, Slack replies, capture pause/admission concurrency,
imports, Commusoft, email, Phone, cards, Microsoft and private voicemail. Original
299-table / 1,591,576-row / five-sequence preservation, negative package guards,
role boundaries and Storage checks passed. The isolated container was removed.

[Combined evidence](evidence/learn-combined-release-rehearsal-2026-10-12.json)
is the current database acceptance milestone. The chronological sections below
retain earlier package-specific findings; statements that only the first packages
exist are historical. This does not prove the matching deployed runtime/frontend,
real-provider coverage or signed-in acceptance. The full release, existing draft
reconciliation, final live-baseline drift check and production approval remain open.

## Production archive reconciliation — 12 October, 02:52 UTC

A fresh isolated restore of the existing 00:25 UTC production archive now supplies
the release-planning baseline. The pinned archive and PostgreSQL image matched;
network access, published ports, background workers and scheduled execution were
disabled throughout. The disposable container was removed after metadata capture.
No production or hosted TEST data was changed. A separate read-only TEST query
captured the matching public-schema inventory and all 80 deployment receipts.

| Public objects | Production archive | Current TEST | TEST-only | Production-only to preserve | Shared but different |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tables | 251 | 183 | 82 | 150 | 93 |
| Functions/signatures | 366 | 330 | 295 | 331 | 30 |
| Views | 5 | 9 | 8 | 4 | 1 |

All 79 numbered TEST SQL packages match a hosted deployment receipt; all 67 with
companion manifests also match their declared hash. The remaining 12 have no
companion manifest, so their receipt/file hashes establish only their recorded
TEST provenance. None is a production migration package.

The first production-specific compatibility requirements are now concrete:

- Preserve the five production-only email origin columns and their campaign,
  delivery, intent and person constraints. TEST does not exercise those writers.
- Preserve the three marketing capability triggers on `email_oauth_tokens` and
  its account/tenant foreign key. Rehearse LEARN token refresh alongside them.
- Preserve production-only correlation, decision, objective-health, campaign,
  event and receptionist fields. Do not replace those tables with TEST versions.
- Reconcile existing tenant/profile/source policies and privileges individually.
  Ninety-three shared tables differ in at least one catalog facet; this does not
  mean all 93 require the TEST definition. Prove both existing-service access and
  the new restricted LEARN readers after each relevant change.
- Add the missing journal/receipt tables and supported columns in dependency
  order. Review shared triggers and indexes before adding or replacing names.
  Preserve existing uniqueness and same-tenant constraints.

The [machine-readable reconciliation](evidence/learn-production-release-reconciliation-2026-10-12.json)
lists additions, production-only objects, changed facets and pinned TEST packages.
Its classifier has four passing checks covering production-only preservation,
type/authority changes, overloaded signatures, duplicate metadata and package pin
drift. Raw source records and credentials are not in that report.

**This is a planning baseline, not migration acceptance.** It compares the retained
archive with TEST, not the current live database. It covers public-schema metadata,
not every cross-schema dependency or runtime. The archive's known pg_net omissions
remain; no full service/Vault recovery is claimed. The next release step is an
explicit additive production candidate and its offline rehearsal with retained
source fingerprints and real production constraints. No candidate has been applied.

## First production candidate rehearsed offline — 12 October

The draft [metadata migration](../../supabase/release/learn-production/001_launch_metadata_views.sql)
and its [manifest](../../supabase/release/learn-production/001_launch_metadata_views.manifest.json)
are production-specific. Their pinned SHA-256 is
`d9870a4b1e581ea75d1b9ef84b0fffb713c8965caa9c02d8aad63b009bac745d`.
They add eight restricted LEARN metadata views and a private release ledger, with
an exact guard on the nine source-table catalogs from the archived baseline.
The TEST target, an altered catalog and a duplicate submission are rejected.
An injected failure after receipt insertion rolls the whole transaction back.

Production has existing policies that apply to PUBLIC. The candidate therefore
adds restrictive policies for the new reader role alongside its permissive grants;
existing policies cannot widen the views beyond the current owner/admin's tenant.
Original source permissions and writers remain intact. The new role cannot log in,
bypass RLS or create schema objects; applications gain no role membership or access
to the release ledger. The deployer's temporary SET/INHERIT access is absent after
installation.

The final rehearsal used a fresh offline restore of the real archive. Owner/admin
SQL-role reads returned the retained tenant's 18,598 emails, 4,328 calls and 2,882
recordings. Viewer, unknown-actor, no-actor and anonymous checks passed, as did view
write denial and email-label/provider-error redaction. All original public tables,
functions, views and application column privileges were preserved, except the
explicitly added reader policies. All **1,591,576 rows across 299 archived tables
and five sequence states** matched before/after. The single new release receipt
was accounted for separately. The disposable container was removed.

The initial verification attempt exposed unqualified search-path assumptions in
the rehearsal queries; those were corrected and exact expected failure reasons
were checked before accepting the later runs. The candidate SQL itself did not
change between these runs. See [rehearsal evidence](evidence/learn-production-launch-rehearsal-2026-10-12.json).

**This is only the first metadata prerequisite.** Remaining foundation, scoring,
operator, ingestion, queue and recovery changes still need production-specific
packages and a complete combined rehearsal. Existing production source grants
have not been tightened by this step; later access review must distinguish legacy
service requirements from new LEARN access. SQL claims in an isolated database do
not prove signed-in HTTP/browser acceptance. Nothing has been deployed live.

## Required evidence before requesting promotion

The first two production-specific packages now pass an ordered offline rehearsal:

1. `001_launch_metadata_views.sql`: the restricted metadata surface described above.
2. [002_foundation_rules.sql](../../supabase/release/learn-production/002_foundation_rules.sql):
   existing-table reference guards, forward membership capture and immutable
   scorecard rule drafts/publications, including the reviewed conflict codes.

The second package hash is
`1ea226e5da475464b1b6ccccf3cc1e027b6a17417e99f582b81f10206459e1d4`.
It reuses all 33 existing foundation tables and retains their original policies,
grants, columns, constraints and indexes, including production-only fields. The
existing View-As table and its behavior are preserved. Exact catalog/helper and
prior-receipt guards precede a read-only audit of declared tenant references.
That audit passed on the restored archive; no historical relationships were
rewritten. The package adds two empty history tables, eleven functions, 39 triggers
and two indexes. New guards affect future writes; compatibility with every legacy
writer still needs combined acceptance.

The scoring-rule journey passed on that real restored schema: save/publish/replay,
50-to-100-point revision, period-specific history, changed/stale request denial,
foreign-tenant denial, membership capture with honest coverage, retention guards,
View-As write denial and same-session owner revocation. Synthetic rules and a
temporary member rolled back. All original 1,591,576 rows and five sequences
matched; only two deployment receipts remained in the disposable database, with
the two new history tables empty. The new history sequence is accounted for
separately. The database was then removed. Wrong target, catalog drift, late
failure rollback and duplicate rejection passed as well.

The first attempt stopped on a verification timestamp later than the history
reader's completed-period boundary. The corrected probe uses statement time;
the candidate SQL did not change. See
[combined rules evidence](evidence/learn-production-rules-rehearsal-2026-10-12.json).
This is rule configuration/publication acceptance, not proof of real performance
measurements or pay decisions. Measurement collectors, governed work, operator
and connector packages still need production reconciliation and combined rehearsal.

### Measurement and work prerequisites rehearsed offline

The third package, [003_measurements_work.sql](../../supabase/release/learn-production/003_measurements_work.sql),
now passes an ordered offline rehearsal after packages 001 and 002. Its SHA-256 is
`d3a2abaccbb2542f3ec8cf92d9b48b7fd3eed9d0505d050b04828304b4fc6b27`.
It preserves the existing objective schema/registry rows/guards, extends three
tables for performance evidence and forward work capture, and adds review and
collection receipts. Existing company-wide objective access remains unchanged;
new staff-performance reads are restricted to the same tenant's owners/admins.
Direct browser work-history writes and privileged truncation are removed so the
captured ledger can remain evidence. Existing service-role history DML remains.

Synthetic journeys on the real restored schema passed append/replay/conflict,
correction and human review, team-transfer coverage, alias-aware handoffs,
ownership-time calculation and insufficient-evidence handling. An unresolved
owner produces a null measure with incomplete coverage. Direct service-role
self-confirmation and viewer/foreign-owner/foreign-OpenFolk staff access were
denied. The original fixtures needed two production-aware corrections: reusing
profiles created by the Auth trigger and distinguishing existing authorised
company measurements from newly restricted staff facts. Production code and
triggers were not bypassed to make the fixtures pass.

All original columns/values in 1,591,576 rows and five original sequences matched.
The comparison explicitly projects original columns for the three extended tables:
three measurements, nine metric definitions and 14,452 work-history rows. Old
measurements retain tenant scope; old work rows receive no fabricated snapshots
or capture sequence. Synthetic data rolled back; only the three candidate receipts
remained in the offline database before it was removed. Wrong target, catalog drift,
late-failure rollback and duplicate rejection also passed.

See [measurement/work evidence](evidence/learn-production-measurements-rehearsal-2026-10-12.json).
Later collector, calendar, corrections, authority and receipt fixes must still
be included before any full release or current-behavior acceptance claim.

### Governed work rehearsed offline

The fourth package, [004_governed_work_actions.sql](../../supabase/release/learn-production/004_governed_work_actions.sql),
adds five functions and nineteen authority/registry serialization triggers. Its
SHA-256 is `f919f590057ccaa257c0b69b4cffb8084c9b01c4d6ba638600eac5e412373d3f`.
Production already contains the required Action vocabulary. The package preserves
all six classes, 29 object types, 32 states, 48 transitions and nineteen permission
entries; it does not replay TEST seeds, replace existing functions, change table
policies/grants or backfill history. A changed required Action edge fails closed
for review instead of overwriting the configuration.

The combined 001–004 archive rehearsal passed scoped assignment, cover and expired
access, View-As denial, claiming, verb/state/evidence validation, stale versions,
atomic attribution failure and canonical history counts. Existing measurement,
review and work collectors also passed their regression journeys. Controlled
second connections verified cover revocation and action orderings, actor-role
changes, guarded transitions, roster/preview mutations and rejection of stale
repeatable-read snapshots. Work in a different company proceeds concurrently.

All original archived rows/columns and five sequences match after rolled-back
journeys. The second database commits synthetic fixtures solely for concurrency
checks; it is removed with the network-isolated container. Wrong target, schema
and registry drift, late transaction failure and duplicate rejection passed.
The initial rehearsal exposed inconsistent schema search paths in catalog
rendering and the second test connection; both were fixed in the rehearsal setup.
No production configuration was weakened to pass a test.

Reproduce the baseline using `scripts/backup/inspect_production_actions.py`, build
with `node scripts/verify/learn-production-actions-candidate.mjs`, then rehearse
with `python3 scripts/backup/rehearse_production_actions.py`. These use exclusive
private output directories: inspect prior terminal results and choose a new run
suffix before deliberately rerunning. Do not delete or reuse completed journals.
See [governed-work evidence](evidence/learn-production-actions-rehearsal-2026-10-12.json).
Later work/authority fixes and remaining operator/connector packages still need
reconciliation before complete-release acceptance or promotion.

### Scoring, recovery and working-time group rehearsed offline

The fifth package, [005_scoring_working_time.sql](../../supabase/release/learn-production/005_scoring_working_time.sql),
groups twelve pinned source migrations for corrections, assessment retention and
recovery, team residence, resumable collection, calendars, approved delays,
working-time calculation, input bounds and deferred receipt validation. SHA-256:
`d69899c63c83bfb974282599ffa4a6183b29e8f53b652796459d2c1e235ae066`.
It adds fourteen tables and 49 functions, extends the existing append evidence
allowlist and scorecard draft validation, and adds deferred insert receipt guards
to measurements/reviews. Existing source columns, table policies/grants and other
functions remain unchanged. No real calendar, staff grant or score is created.

All five packages passed ordered installation on the full retained archive.
Wrong target, catalog drift, late rollback and duplicate rejection passed, as did
six application-role access probes. All 1,591,576 original archived rows and five
original sequences match after installation. New scoring tables are empty in
that database. A second network-isolated clone then passed twelve synthetic SQL
journeys using actual collectors, including a 14,500-item frozen population,
individual/team attribution, batch replay, missing evidence, working calendars,
DST and exceptions, approved-delay reversal, rule changes, corrections and exact
request recovery. It also passed rule publication through collection, review,
saved assessment and assessment recovery. Altered receipt scope/value/coverage/
contract and forged correction references were rejected; cancellation prevents
late writes. The disposable container and both databases were removed.

Production-aware fixture adaptations retain the archive's Action registry, use
the current PT409 conflict contract, include all existing tenant measurements in
preservation checks, and deterministically order pre-capture history by ID when
its sequence is null. The truncate test includes its newly referencing evidence
table so the immutability trigger is exercised. No source guard was removed or
weakened. PostgreSQL represents each deferred constraint trigger in both trigger
and constraint catalogs; the exact declared entries are accounted for.

Baseline: `scripts/backup/inspect_production_scoring.py`; generator:
`node scripts/verify/learn-production-scoring-candidate.mjs`; rehearsal:
`python3 scripts/backup/rehearse_production_scoring.py`. Each inspection/rehearsal
has an exclusive private journal; select a new run suffix only after inspecting
the previous terminal result. Do not overwrite completed journals.
[Combined scoring evidence](evidence/learn-production-scoring-rehearsal-2026-10-12.json)
records source/probe checksums and limitations. These are synthetic SQL results
on a production archive, not hosted provider, browser or pay acceptance. Remaining
card-input/operator/connector/queue packages and complete-release checks are open.

### Slack intake and recovery group rehearsed offline

The sixth package, [006_slack_intake.sql](../../supabase/release/learn-production/006_slack_intake.sql),
uses ten pinned sources for channel storage, durable workers, thread storage,
operator reads, workspace pacing, history/thread recovery and recurring capture.
SHA-256: `ede925a3158c48f4374c916b3cbcaf2e5345110885458833d5f9d988ca3b4a91`.
It adds nine tables and 32 functions. The generic job claimant excludes Slack jobs
so the dedicated paced claimant owns them; its existing authority is unchanged.

Production already has shared connector tables. The candidate retains their
columns, policies and grants instead of replaying TEST's replacements. It adds
same-tenant references and source/audit retention guards. Existing shared metadata
can no longer be deleted/truncated; provider event records cannot be overwritten.
All other original functions, views and table definitions remain unchanged.

All six packages install together on the pinned archive. Wrong-target, catalog
drift, late rollback and duplicate rejection passed. Every original archived row
and sequence matches; nine new Slack tables remain empty in the preservation DB.
A separate offline clone verifies owner-approved channel import, worker ownership,
exact page retry, source/version/interaction creation, isolation, ongoing approval
and paused recurring admission. A second journey verifies bounded thread capture,
incomplete coverage, retained-cursor continuation, original-approval preservation,
reply deduplication, stale-review rejection and completed-window denial. Fixture
pacing clocks advance only for the synthetic workspace; no provider calls occur.

Baseline: `scripts/backup/inspect_production_slack.py`; generator:
`node scripts/verify/learn-production-slack-candidate.mjs`; rehearsal:
`python3 scripts/backup/rehearse_production_slack.py`. Completed exclusive journals
v1 and v2 are retained privately; v2 adds thread recovery. No product migration
change was needed between these rehearsals. The disposable container was removed.
[Slack evidence](evidence/learn-production-slack-rehearsal-2026-10-12.json) includes
source/probe hashes and exact limits.

**Not complete Slack acceptance:** real workspace authorization, credentials,
provider paging/rate limits, card delivery, signed-in controls and unattended
operation remain unverified. The capture predicate gates recurring admission in
this package, but manual approvals and worker paths still need the later operator
capture-control reconciliation. Do not deploy or present this as a complete
module-disable implementation. No hosted schema or schedule changed.

### OpenFolk capture controls rehearsed offline

The seventh package, [007_capture_controls.sql](../../supabase/release/learn-production/007_capture_controls.sql),
adds one receipt table and eight control/authority helpers. SHA-256:
`178edb3a1e61397ba7cac593276269ea06dfd25d91d5206844e1948473610947`.
It preserves the existing effective-dated OpenFolk authority resolver and grants,
and reuses package 006's capture predicate. Shared operator access/immutability
helpers are brought forward from their pinned source; the remaining Commusoft
operator request/read functions must follow their connector prerequisites.

Only three existing function bodies change: the generic job claimant, paced Slack
claimant and phone pending selector gain capture filters. Existing function
ownership/authority, source tables, table policies/grants, columns and views are
unchanged. The candidate guards the actual phone view and each helper's baseline;
it creates no real operator grant, flag, job or activation.

All seven packages pass ordered install, wrong-target/catalog drift rejection,
late rollback and duplicate denial. Every original archived row and sequence
matches. The actual-schema synthetic journey verifies OpenFolk-only controls,
View-As denial, stale revisions, exact receipts, cancellation, malformed-flag
withholding and atomic receipt failure. Paused queues keep their attempt budget;
owned pre-admission work can defer without burning retries, while saved Slack
pages cannot be deferred away. Actual phone records feed the real pipeline view,
which selects retained audio ahead of paused downloads. Two sessions verify a
waiting admission blocks on the operator transaction and then observes its pause.

Baseline: `scripts/backup/inspect_production_capture.py`; generator:
`node scripts/verify/learn-production-capture-candidate.mjs`; rehearsal:
`python3 scripts/backup/rehearse_production_capture.py`. Private terminal journal
v1 found the fixture used reversed queue priority; v2 uses the correct lower-value
priority and adds concurrency. Candidate SQL did not change. Both disposable
containers were removed. [Evidence](evidence/learn-production-capture-rehearsal-2026-10-12.json)
records the source hashes, fixture adaptations and limits.

This proves database controls locally, not hosted provider or browser acceptance.
Existing worker admission code still needs matched deployment and end-to-end
verification. A previously admitted bounded batch may complete after a pause;
the next batch must check again. Commusoft controls and later voicemail/Microsoft
extensions remain required. No live system changed.

### Governed customer/site/job import framework rehearsed offline

The eighth package, [008_governed_imports.sql](../../supabase/release/learn-production/008_governed_imports.sql),
adds three import ledgers, 30 functions, two customer-card identity indexes and a
same-company contact-parent constraint. SHA-256:
`33b82c3e902bf4eb1172a6f1750a43ec0b02f69551662eb1392ce4a6bb1d308d`.
It also adds three pinned reusable import templates for customers, sites and jobs.
Production's contact store, marketing normalizer, anchor indexes, source columns,
policies and privileges are retained; no source record or card is backfilled.
Conflicting pre-existing prepared templates cause refusal before installation.

All eight packages install together. Archive inspection found no duplicate person/
company card identities or foreign-company contact parents. Wrong target, catalog
drift, late rollback and duplicate application are rejected. Every original row
and sequence matches, including original import profiles. The three additional
templates must match their exact pinned source definitions, active/version defaults
and global scope, and no extra profile may appear. New import ledgers remain empty
in the preservation database.

A second offline clone passes the historical governed import suite with two-phone
and exact-site regression coverage, import authority checks, customer-card creation/
reconciliation and bounded batch application. Customer matching uses source and
strong channel evidence; ambiguous identities become reviewable conflicts. Exact
site references never silently degrade to address guesses. Existing card content
and person records stay intact, alternate source aliases reuse a card, and new
cards do not invent activity or scores. Imported endpoints never create consent;
pre-existing marketing suppressions remain effective. A 100-row batch and replay,
sanitized per-row failure, atomic late failure and tenant/View-As restrictions pass.

Baseline: `scripts/backup/inspect_production_imports.py`; generator:
`node scripts/verify/learn-production-imports-candidate.mjs`; rehearsal:
`python3 scripts/backup/rehearse_production_imports.py`. Baseline v1 failed only its
aggregate-query search path; v2 corrected it. Rehearsal v1 caught the intentional
profile seeds in the strict preservation check. V2 adds exact template validation,
original-profile COPY comparison and a pre-existing-template guard. The three
legacy profile fixtures adapt to production's actual auth trigger. Terminal
journals remain private and all disposable containers were removed.
[Evidence](evidence/learn-production-imports-rehearsal-2026-10-12.json) records hashes
and limitations. Real Commusoft intake, contacts traversal, operator controls,
source coverage and signed-in acceptance remain required; no hosted work occurred.

### Outstanding release gates

- Resolve existing TEST access approvals and verify signed-in customer and
  OpenFolk journeys on the matching protected frontend: reset/sign-in, source
  inspection, card evidence/audio, operator review, module controls and scoring.
- Complete the bounded real Commusoft import and relationship reconciliation;
  establish historical/incremental coverage for required email, Phone, voicemail
  and Slack inputs. Reusable Microsoft support remains in scope; identify whether
  Drummonds needs an actual Microsoft mailbox. Do not substitute fixtures for
  source acceptance or silently defer unavailable inputs.
- Prove provider capture through stored inputs, identity/card delivery and
  reviewed metrics, including disable/resume, lease expiry and unattended worker
  dispatch. A manually invoked worker does not prove recurring operation.
- Establish Drummonds' staff/team mapping, working calendars, scoring criteria,
  weights, scales and source limitations. Missing inputs must remain missing;
  pay-related use requires authorised human review.
- Rehearse a real isolated production database restore and reconnect its recording
  references to verified independent audio backups. Complete credential recovery
  and storage ownership handover. See [recovery coverage](LEARN-DATA-RECOVERY.md)
  and [daily recording operations](LEARN-RECORDING-DAILY.md).
- Resolve every remaining item in the authoritative checklist or obtain an
  explicit scope decision from Chris. Present specific unresolved limitations;
  never interpret absence of objections as approval.


### Commusoft API, operator setup and capture-to-card recovery rehearsed offline

The ninth package, [009_commusoft_api.sql](../../supabase/release/learn-production/009_commusoft_api.sql),
adds 14 protected tables and 43 functions for connection setup/verification,
request permits, durable pages/versions, customer/site/job/contact review, fixed
contact traversal plans and operator continuation. SHA-256:
`02cd8ccd3d806eacc30976edd89bdfd30b05e90d45bbf36cab2828a8765cc253`.
Existing Vault storage and OpenFolk authority helpers are reused; no credential,
operator grant, feature activation or customer import is seeded. The generic
queue claimant excludes Commusoft work while retaining prior Slack/capture gates.

Actual-schema contact projection uncovered a production-only dependency: the
existing `marketing_tenant_guard` used unqualified table names and failed under
the restricted writer search path. The package checks its exact installed hash,
qualifies its seven table references and fixes its path to `pg_catalog`. Its
invoker status, owner, execution grants and every tenant check remain intact.
The guard rejects a cross-company person even when a caller supplies a misleading
temporary `people` table. Existing table catalogs, policies and privileges remain
unchanged; only this guard and the generic claimant change among prior functions.

All nine packages install together. Wrong target, catalog drift, late failure and
duplicate submission checks pass. All 1,591,576 original archived rows and five
original sequences match. The only seeded application additions remain package
008's three exact import templates; new Commusoft tables stay empty in the
preservation database.

Seven suites run in separate offline clones, with actual auth profile creation,
existing operator authority and encrypted Vault using a disposable local key.
They prove setup/reuse and verification receipts, scoped worker credential release,
property discovery, empty contact pages, immutable traversal plans, interrupted
continuation, exact replay and atomic publication failures. The captured sources
continue through the client's owner review into a single card with customer,
site, contact and completed-job links. Endpoint deduplication, existing-person
preservation, graph relationships, held ambiguous identities, cancellation,
permission boundaries and partial timestamp handling pass. Source versions stay
unchanged through projection. The synthetic setup does not recover production
Vault encryption or make real provider requests.

Generator: `node scripts/verify/learn-production-commusoft-candidate.mjs`;
rehearsal: `python3 scripts/backup/rehearse_production_commusoft.py`.
The terminal v4 journal records the successful run. V1 lacked disposable Vault
preloads; v2 put all worker steps in one transaction and collapsed job timestamps;
v3 exposed the actual marketing-trigger incompatibility corrected above. No guard
was weakened to pass. All containers and their cloned databases were removed.
[Sanitised evidence](evidence/learn-production-commusoft-rehearsal-2026-10-12.json).

This remains offline release preparation. Real provider coverage and reconciliation,
remaining release packages, worker deployment, signed-in acceptance and explicit
production promotion approval are still required. No live environment changed.

### Email protocol, durable capture and retained mailbox changes rehearsed offline

The tenth package, [010_email_capture.sql](../../supabase/release/learn-production/010_email_capture.sql),
adds six protected tables, 25 new function names, a private protocol owner, two
Workspace identity columns and related guards. SHA-256:
`c66f74df447fa77a2fdbd914900ae43b1ce88cd544b769ad6d6b864f071e98a6`.
The archived production schema had no ingestion checkpoint/transition tables or
protocol functions. Their pinned TEST reference supplies the exact protocol table,
helper, owner and privilege contracts; existing production email tables are not
replaced. Later pinned migrations supply lease-bound requests, page persistence,
safe failures, v4 mailbox changes and alias identity protection.

The new owner cannot log in, bypass RLS, create roles/databases or read credentials
or email content. Its table/column grants compare exactly with the restricted
reference. Temporary schema CREATE and deployer SET/INHERIT access are revoked;
only PostgreSQL's automatic ADMIN-only creator grant may remain. Existing table
owners, policies, grants, columns, constraints and source rows are retained. New
protocol policies apply only to the new role, with two progress guards on existing
account/run tables. Message updates append private prior versions. The generic
claimant retains Slack/Commusoft exclusions and can settle saved email work while
new capture is paused.

All ten packages install together; wrong target, guarded-table drift, late failure
and duplicate submission are rejected. The 299 archived COPY tables retain all
1,591,576 original rows and five sequences, with only the three earlier import
seed templates added. New email ledgers remain empty. Existing mailbox identity
columns initialise to null/false; no primary owner is guessed from an alias.

Four synthetic suites use the actual production schema and grants. Storage checks
cover unsent drafts, invalid draft-as-sent refusal, provider absence retaining the
body/source ID, a newer sent revision, older-boundary refusal and exact retry
without duplicate source history. The v4 coverage probe withholds the history cursor
until every page is exhausted and resumes across attempts. Durable recovery tests
real enqueue/deduplication, request preparation/application/replay, saved-work
settlement after pause, replacement leases, stale-worker refusal and allowlisted
failure receipts. The fixture models the worker's lease-release update before
calling the actual claimant; runtime HTTP/reaper acceptance remains separate.
Alias checks preserve first ownership, latch later conflicts and reject unauthorised
scope changes. All clones and their isolated container were removed.

Generator: `node scripts/verify/learn-production-email-candidate.mjs`;
rehearsal: `python3 scripts/backup/rehearse_production_email.py`.
The terminal v5 journal is successful. Earlier failures exposed a managed-role
installation mismatch and fixture extraction/reaper omissions; neither application
scope nor guards were weakened. [Sanitised evidence](evidence/learn-production-email-rehearsal-2026-10-12.json).

**Coordinated cutover is required.** The new protocol guards intentionally refuse
legacy direct account-cursor and protected run-completion writes. Pause affected
old capture, deploy matching protocol-aware email endpoints/worker and verify the
paired runtime before activating new capture. Never install this package alone
while incompatible old writers remain active. An old worker is not a safe rollback
after this installation; retain durable receipts/source versions and recover with
a compatible worker or reviewed forward fix. No cursor reset or source overwrite
is part of this package.

Communication projection/card draft eligibility and phone-aware operator health
remain explicit later dependencies; this package proves capture/storage only.
Microsoft integration, real mailbox coverage, browser acceptance and production
approval are still required. No live environment changed.

### Phone capture, processing and operator-health candidate

The eleventh package, [011_phone_capture.sql](../../supabase/release/learn-production/011_phone_capture.sql),
uses the inspected production archive after packages 001–010. Its pinned SHA-256 is
`f45c032695071204e9854a30b6b5a74f18e3ed2ddab2f690e86ae90157f429dc`.
Fourteen pinned migrations supply eight protected tables, 17 new function names,
five nullable provenance columns and bounded health readers. It updates only the
existing pending-readiness helper, the projection-version helper's search path and
the recording pipeline view. Table catalogs, referenced helpers, the pipeline view,
the prior package receipt and the production target are guarded before installation.

Production already contains the intelligence, directory, endpoint and platform
projection structures. Their old migrations are deliberately not replayed: doing
so would risk changing existing grants or backfilling endpoint mappings. Existing
source-table owners, RLS policies, grants and columns remain intact. This includes
legacy source permissions broader than TEST; the package does not claim to have
hardened all pre-existing application access. New receipt tables and entry points
have their own explicit access restrictions.

The candidate adds atomic page publication, import/schedule settlement, durable
processing attempts and retained prior results. Operator review can settle saved
output without blindly repeating uncertain processing. Playback authorization
checks the current actor, tenant and storage-pointer revision and writes an audit
receipt. Atomic handoff links verified audio/transcript/analysis provenance to a
canonical interaction and pending event; downstream customer-card completion is
still a separate acceptance requirement. Scheduler and capture-health readers
report missing/failed observations honestly and exclude raw provider errors,
message bodies and storage paths from their summaries.

No source row is rewritten at installation; historical provenance starts null.
No credential, capture flag or schedule is enabled. Matching phone endpoint and
worker deployment must precede activation. During rollback, pause new capture,
retain receipts, saved outputs and version history, and use compatible recovery
workers. Do not revert to direct legacy processing writes or remove populated
provenance columns as a rollback shortcut. A production execution also needs a
fresh catalog/source baseline, full combined runtime acceptance and explicit
promotion approval.

Generator: `node scripts/verify/learn-production-phone-candidate.mjs`.
Rehearsal: `python3 scripts/backup/rehearse_production_phone.py`.
The initial six-suite rehearsal passed, preserving all 1,591,576 original archived
rows and five sequences. An expanded rehearsal stopped on two TEST-only raw-table
privilege assertions; production already had those grants. The production fixture
now retains the grants and checks exact catalog preservation rather than silently
revoking legacy access. A subsequent fixture attempted to insert a completed email
run directly; the new protocol guard correctly rejected it. The health fixture now
uses the actual failure transition before reading operator status. The terminal
expanded v4 rehearsal passes all ten suites in 60.99 seconds. All 299 archived
COPY tables, 1,591,576 original rows and five sequences still match; all disposable
databases are removed. Existing provenance columns are unchanged and the five new
phone columns remain null. New receipt tables are empty in the preservation copy.
The package SQL was unchanged across these fixture adaptations. See
[sanitised evidence](evidence/learn-production-phone-rehearsal-2026-10-12.json).
No hosted environment has changed.

### Communication cards, attribution review and queued processing candidate

The twelfth package, [012_communication_cards.sql](../../supabase/release/learn-production/012_communication_cards.sql),
is built against the inspected archive after packages 001–011. SHA-256:
`57eb47d78df8352b6e24cd2d26081231381ca6e37a6ef86f51e2a9ce9584e166`.
Eleven pinned source files supply six protected receipt/review tables, 28 new
function names and one restricted communication reader. Existing source columns,
functions, views, constraints and application grants remain intact. The older
TEST guards and deployment ledger are excluded from the generated candidate.

The reader receives selected profile, interaction and source columns. Its five
permissive policies are paired with five reader-only restrictive policies because
production's existing PUBLIC policies must not broaden this new role. Only the
actual owner/admin caller's tenant supplies communication excerpts and source
metadata. There is no reader login, RLS bypass or application membership; temporary
installer SET/INHERIT and schema CREATE are revoked. This is not a claim that all
pre-existing production source access has been hardened.

Source projection, identity/card delivery, review and processing jobs commit with
immutable receipts. Exact retries do not repeat attribution or create duplicate
cards; stale source revisions, expired claims and ambiguous identities remain
explicit. Review preserves previous canonical data and requires current operator
authority. Manual card fields and newer activity are preserved when older sources
are processed. Customer/job/member/team search uses the caller's existing RLS.

The draft-eligibility selection excludes its old `learn_email_store_page` body:
package 010's v4 storage protocol must remain unchanged. Labelled drafts stay
retained but are excluded before communication excerpts and bounded card activity
windows are calculated. A later eligible source revision can be reassessed. This
installation performs no historical card refresh, draft-impact cleanup, identity
backfill or scoring rewrite. The previously recorded production draft-impact
review remains an explicit launch gate, alongside real-provider and signed-in
acceptance and any remaining source-eligibility decisions.

The offline fixtures use real production same-tenant references, including a
synthetic campaign for the pre-existing email origin foreign key. They retain the
newer refetch policy rather than downgrading storage to fit the older draft test.
No production constraint or permission is removed to make the fixtures pass.
The terminal v3 combined rehearsal passes eleven suites in 64.63 seconds. One
integrated journey passes actual v4 email storage and retained Phone handoff through
fenced identity jobs into two owner-visible cards and readable source evidence.
The 299 archived COPY tables retain all 1,591,576 original rows and five sequences;
new receipt tables are empty in the preservation database. All disposable clones
are removed. The candidate SQL remained unchanged through fixture adaptations.
See [sanitised evidence](evidence/learn-production-cards-rehearsal-2026-10-12.json).

Install this only with the matched interaction, identity, card-refresh and shared
worker runtime as part of the reviewed production release. Pause affected work
before an incompatible rollback; retain receipt/review history and recover with
compatible code. Legacy writers must not overwrite reviewed attribution, use
stale card inputs or reintroduce drafts into activity and score evidence.
No capture, processing schedule or hosted environment is activated by this package.

Generator: `node scripts/verify/learn-production-cards-candidate.mjs`.
Rehearsal: `python3 scripts/backup/rehearse_production_cards.py`.

### Microsoft capture and compatibility candidate

The fourteenth package, [014_microsoft_capture.sql](../../supabase/release/learn-production/014_microsoft_capture.sql),
follows the pinned voicemail receipt. Its draft hash is
`9fba3e916f0e57075f32c60ad02f14c94ef7c2d75372bbff53abdea11dc37cba`.
Ten pinned Microsoft migrations and one production compatibility patch add eight
protected tables and eighteen function names. The shared claim filter gains
Microsoft admission; three existing Marketing invoker functions gain qualified
schema references and `pg_catalog` search paths. Existing function grants,
security authority, source columns, indexes, triggers, policies and Storage remain
unchanged. No credentials, bindings, accounts, consent or schedules are seeded.

The scope-changing OAuth refresh fixture initially failed because
`marketing_source_capability_sync` resolved an unqualified table under the
credential writer's restricted search path. The patch preserves the exact installed
function bodies except for qualified dependencies and search paths; enclosing
preflight pins their original definitions and authority. Its full readiness chain
is verified with no Marketing sender, a ready Gmail sender, and removal of the
Gmail send scope. Do not skip the trigger or suppress its exception. This extra
compatibility fix has not been installed in hosted TEST.

The terminal v5 combined rehearsal passes three suites in 50.26 seconds: one
integrated synthetic Microsoft source/card/discovery/worker/status/actual-claim
suite, the private voicemail journey and the existing email/Phone-to-card journey.
Actual Graph readers consume mock responses; no provider transport is exercised.
Token rotation, stale worker/refresh refusal, rate-limit delay, paused credentials,
retained-page completion, operator denial/pagination, and hidden raw data are
covered. A real `platform_jobs_claim` call refuses paused work, claims it after
reenabling, and owned pause settlement restores the attempt budget.

All 299 original COPY tables, 1,591,576 rows and five sequences match. Earlier
import templates and the private EML bucket are accounted for separately; new
operational tables remain empty outside disposable clones. Table/function/view,
Storage, bucket and role checks pass; wrong target, catalog/policy/bucket drift,
late failure and duplicate installation fail safely. All containers were removed.
[Sanitised evidence](evidence/learn-production-microsoft-rehearsal-2026-10-12.json).

Install only with matching Microsoft handlers and reviewed tenant/mailbox/client
consent bindings. Verify real token lifecycle, initial and incremental capture,
source-to-card permissions, operator controls and signed-in use before acceptance.
Saved pages are not complete mailbox coverage; attachments are not captured.
No Drummonds Microsoft mailbox is currently identified. Reconcile the older general
Connections catalogue labels separately from actual account/capture state.

For rollback, pause new capture and preserve pages, bindings, receipts and projected
source history. Restore compatible workers, not older credential code with the
known trigger failure. Do not drop tables or erase source data to repeat imports.
Production configuration, fresh catalog checks and explicit promotion approval
remain prerequisites; no live migration executor is supplied here.

Generator: `node scripts/verify/learn-production-microsoft-candidate.mjs`.
Rehearsal: `python3 scripts/backup/rehearse_production_microsoft.py`.

### Private voicemail intake and inbox candidate

The thirteenth package, [013_voicemail_capture.sql](../../supabase/release/learn-production/013_voicemail_capture.sql),
preserves the existing voicemail foundation after packages 001–012. Its draft hash
is `d145d65687abb1b277323295b1ee57c22a7407c33294982d681b8a2418b47fd7`.
Five pinned migrations add nine protected intake/queue/discovery tables, thirteen
functions and one retained-email scan index. No existing function, source column,
mailbox owner snapshot, manager grant or private audio bucket is replaced.

The package adds a private `learn-voicemail-sources` bucket for original EMLs, with
a 1 MiB limit and `message/rfc822` type, and an anonymous/authenticated restrictive
Storage policy. It does not seed routes, accounts, human grants, credentials,
provider requests or scheduled jobs. The audio bucket remains private with its
existing 25 MiB limit. Source email discovery is only a bounded candidate scan;
it never establishes complete provider coverage or verified sender/ownership.

Storage metadata is now part of the preflight and rollback guard, alongside public
tables/functions and the preceding receipt. Capture the catalog under the same
`public,pg_catalog` search path used by the installer: policy-expression hashes
can differ when the inspector's search path is different. Preserve all existing
Storage owners, grants, policies and rows; account for the one new bucket separately.

The offline runner explicitly enables the pinned image's documented
[supautils storage-policy hook](https://github.com/supabase/supautils#table-ownership-bypass)
for `postgres` on `storage.objects`, from container startup. It adds no role
membership and does not transfer storage ownership. This reproduces a managed-host
capability, not evidence that the production host currently supplies it. A small
read-only production configuration request returned HTTP 544 on 12 October;
production configuration remains unverified. Do not widen production grants or
change storage ownership to make a release pass. Verify the managed installer
capability and fresh catalog before requesting promotion.

Update after the approved Small compute recovery: the production read-only API
now confirms `session_preload_libraries=supautils` and the registered
`supautils.policy_grants` configuration grants `postgres` policy management on
`storage.objects` and `storage.buckets`. The earlier HTTP 544 configuration-read
blocker is resolved. This is configuration evidence only; no production Storage
policy was changed, and fresh catalog/preflight and promotion approval still apply.
[Recovery evidence](evidence/learn-production-small-compute-2026-10-12.json).

The terminal v6 combined rehearsal passes four suites in 51.07 seconds. Actual
v4 email storage feeds candidate discovery, a genuinely claimed queue job, private
publication and the original owner's inbox. Reassignment, new-owner denial,
explicit manager access/revocation, foreign tenant and expired operator checks
pass; operator health grants do not reveal private content. Incomplete uploads,
paused publication and a failed receipt roll back without losing retained inputs.
A 1,100-email fixture proves 500/500/100 bounded dispatch, draft exclusion,
per-route failure isolation, minute replay, provider retry, pause without consuming
the failure budget, interrupted-worker recovery and stale-worker rejection.
Historical inbox pagination and the prior email/phone-to-card journey also pass.

All 299 archived COPY tables, 1,591,576 original rows and five sequences match.
Only the earlier three import templates and one declared private bucket are added;
all new operational tables are empty in the preservation copy. Public and Storage
catalogs, original bucket metadata, role attributes and memberships are preserved.
Wrong target, table/policy/bucket drift, injected late failure and duplicate
submission are rejected. Every disposable database was removed. See
[sanitised evidence](evidence/learn-production-voicemail-rehearsal-2026-10-12.json).
Storage metadata fixtures do not prove real EML/audio bytes or signed-in playback.
The candidate does not change production or hosted TEST.

Install with matching voicemail importer, shared queue worker, dispatcher and
private playback handler. Before activation, prove real Gmail delegation,
Birchills signature/recipient verification, historical recipient-to-owner routes,
original EML/audio byte readback, paused capture, signed-in playback and independent
backup/restore of both private buckets. The existing call-recording backup does
not automatically cover voicemail audio or EMLs. Do not widen general LEARN card
access to private mailbox contents through this release.

For rollback, pause affected voicemail routes and new capture, retain immutable
intake/source/job evidence and both private buckets, and recover with a compatible
worker. Never delete retained attachments or receipts to reset a failed import.
A completed retained-email pass must continue reporting provider coverage as
unproven. Operator status exposes aggregate health, without granting message access.

Generator: `node scripts/verify/learn-production-voicemail-candidate.mjs`.
Rehearsal: `python3 scripts/backup/rehearse_production_voicemail.py`.

## Build the production-specific release candidate

1. Read production's current migration ledger, schema/catalog, deployed function
   versions, settings and active schedules. Capture a fresh private preservation
   baseline of source IDs, relationships, counts and fingerprints. Record the
   currently serving frontend and production environment binding.
2. Derive an additive, ordered production migration manifest from that actual
   state. The numbered TEST packages include TEST-specific guards and assumptions;
   **do not execute TEST bundles on production, copy the TEST database, or run an
   unreviewed blanket database push**. Keep schema and source hash pins immutable.
3. Rehearse the exact candidate against an isolated restored full production
   schema, with network/provider calls and imported schedules disabled. Prove
   preservation, tenant isolation, authority, rollback on failure and compatibility
   of every paired reader/writer. Record each required runtime and deployment order.
4. Pin the frontend Git commit, database package hashes, function source bundles,
   required environment-variable names and dependencies in one reviewable manifest.
   Never include secret values. Re-run the documented release checks for that
   exact candidate and verify the GitHub backup SHA.
5. Prepare a production-configured Vercel candidate using the existing production
   project's environment. Never promote a frontend bound to Supabase TEST.
   Follow [deployment instructions](../DEPLOYMENT.md); Lovable is not a host.
6. Give Chris the exact production changes, expected user-visible behaviour,
   preservation/recovery evidence, capture activation plan and rollback limits.
   Production promotion requires his explicit approval.

## Approved execution order and verification

After approval of the specific manifest, take a fresh recovery/preservation
checkpoint. Install the reviewed additive database prerequisites, then their
compatible guarded functions, then the matching production frontend. Do not
activate capture or schedules as a side effect of schema/frontend installation;
follow only the separately reviewed activation steps in the approved manifest.

Verify the actual `openfolk.ai` routing and served version, production Supabase
binding, tenant/operator permissions, Drummonds branding and signed-in journeys.
Compare source IDs, existing relationships and recorded-file references with the
baseline. Verify new real inputs and updates through the whole pipeline, including
scoring limitations and operator-visible diagnostics. Record actual observation
windows and receipts; an ACTIVE function, HTTP 200 or rising count is insufficient.

## Rollback and operational handover

Choose compatibility boundaries during rehearsal. An old frontend or worker may
not understand new receipt contracts; Vercel rollback alone is not automatically
a safe application rollback. For an unsafe paired release, pause affected capture
through verified controls while retaining inputs and evidence, then use the
reviewed compatible runtime/frontend version or an additive forward correction.
Do not drop receipt/audit tables, overwrite existing data from TEST, or rewrite
published Git history. A production database restore is a separate reviewed
recovery operation, not a routine way to undo a schema addition.

The final handover must name the operator, monitoring location, actual dispatch
and backup schedules, alert recipient, escalation route, credential locations
and rotation dates, recovery steps, expected provider coverage and known limits.
No credentials belong in this document. Keep customer messages calm and factual;
record operator detail without claiming failed or stale processing is healthy.

## Workspace alias compatibility before promotion

The 11 October read-only directory audit found two active configured addresses
that Google reports as aliases; their Gmail profiles resolve to current primary
users without separate DWD account rows. The earlier directory handler would
mark these valid alias inputs removed. Use the reviewed v3 directory-identity
candidate with its additive binding schema and matching worker when packaging production; do not run the earlier primary-only refresh.
TEST code/readback checks pass, but production is unchanged and still needs the
explicit release approval. Do not enable parallel primary accounts or merge old
sources implicitly. Review alias ownership and retained account IDs during real
capture acceptance. Four other failing addresses are absent from the current
domain directory; their history stays retained while the operator resolves them.
See [current delivery evidence](LEARN-V1-COMPLETION.md#real-workspace-directory-and-aliases--11-october-18491854-utc).

The provider distinguishes primary email from editable/non-editable aliases:
[Google Directory User reference](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users).
The bounded scan covers the configured domain, not every domain, group or deleted
user in the Workspace customer:
[Google users.list reference](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/list).

### Alias capture identity sequence

TEST package `067_workspace_identity` was installed only after its exact rollback
rehearsal. The new discovery handler and capture ports require its two columns and
identity guard; schema precedes runtime. Production must use a production-specific
manifest and approval, never the TEST package. Existing bindings start unverified.
A complete authorised directory refresh must establish an alias's primary before
V1 capture can accept the primary address returned by Gmail. Source account IDs
and old email namespaces must remain intact.

If ownership changes, the guard retains the original primary and latches a hold.
A normal refresh or generic retry must not clear it. Operator disposition remains
an explicit reviewed recovery action, with preservation evidence. For rollback,
pause affected capture before reverting matching runtime; retain new binding and
conflict evidence instead of dropping columns after they have been populated.
Positive hosted real-data acceptance remains open.

## TEST 068 mailbox-wide email prerequisite — 11 October, 19:24 UTC

TEST 068 and worker v14 now read message additions without an Inbox/Sent filter.
The first v3 recent generation reconciles the mailbox, including Spam/Trash;
existing in-flight v2 pages remain unchanged. See the
[verified TEST evidence](evidence/learn-email-mailbox-coverage-test-2026-10-11.json).
This is not production promotion approval or real mailbox coverage acceptance.

The pinned TEST package uses the existing postgres administrator's ADMIN membership
only inside its migration transaction: a temporary grant enables protocol-owner
inheritance for replacement, is revoked before assertions, and original memberships,
function owners and ACLs must compare exactly. No lasting permission is added.
Production must first prove the corresponding original function hashes, authority
and full source preservation; do not execute the TEST-targeted package there.

Deploy the matching worker before allowing new v3 capture. For rollback after v3
checkpoints exist, pause new Email capture and keep a worker capable of both v2/v3
recovery. Do not downgrade the transition function or reinterpret ALL page tokens
as Inbox/Sent. Preserve v3 receipts and checkpoints and recover forward; any older
code rollback requires a separately reviewed compatible recovery plan. No data
or cursor reset is an acceptable rollback shortcut.

Real-provider initial reconciliation, subsequent capture, source-to-card acceptance,
score eligibility (including draft/spam treatment), and operator recovery still
need acceptance before this change can be part of an approved production release.


## Draft eligibility release gate — TEST 069

The draft guard retains Gmail source messages and existing canonical records,
while excluding labelled drafts from new customer communication publication,
identity attribution, card excerpts and activity counts. Source revision changes
make later corrections eligible for reassessment without rewriting receipts.
The worker parser requires the matching page-store update: new drafts have
unknown direction and no sent timestamp. Install the database before its worker.

A read-only production metadata check identified 55 retained Gmail drafts, each
with an existing canonical interaction. Before promotion, inspect their derived
card summaries, relationships, aggregates and scoring evidence and prepare a
bounded, reviewed reconciliation with before/after preservation evidence. Do not
delete source messages, canonical history or immutable receipts to hide the issue.
This observation does not establish 55 incorrect staff scores.

Do not use the TEST-pinned package in production. Prove the production function
and role prerequisites and build a separate release manifest. Pause affected
capture before a rollback; keep the draft-aware page-store and publication guard
compatible, and recover forward without restoring draft reply attribution.
Real-provider capture, signed-in card acceptance, Spam eligibility and provider
label/deletion handling remain open launch requirements.


### Card refresh must also use eligible sources

TEST 070 installed `20261101390000_learn_card_projection_eligibility.sql` after
full-schema and exact-package rollback rehearsals. Matching `platform-worker` v16
and `customer-card-sync` v2 passed download comparison, handler tests and HTTP denial
checks. A positive service-to-service synthetic refresh passed over hosted HTTP,
including isolation, source preservation and completed jobs; fixtures are archived.
This is not signed-in or real-provider acceptance. For the separately reviewed
production release, deploy the database function before matching callers. The
scheduled wrapper enqueues the shared worker and needs no independent eligibility logic. Preserve the function during a runtime
rollback. Do not run a legacy card refresh as a repair: it can reintroduce drafts.

The 19:57 UTC production audit found four draft-linked recommendations and 95
match suggestions. Its 178 person/company-associated cards are a review boundary,
not a list of proved corrupt cards. None had an exact draft summary/timestamp
match; all had legacy/unversioned priority inputs. Refresh eligible projections
with revision-checked writes, retain historical source/derived records, and review
unversioned priority and indirect recommendation influence separately. Do not
rewrite manual text, accepted identity decisions or saved performance evidence
based solely on a shared company link. See the
[impact evidence](evidence/learn-email-draft-impact-2026-10-11.json) and
[TEST verification](evidence/learn-card-draft-projection-2026-10-11.json).

## Historical job recovery — 13 October

The old production tracking helper set `running` without a lease and used
best-effort completion writes. Thirteen Phone schedule jobs (latest 9 October)
and one graph job (21 July) still have no claimant, lease, attempt or completion.
The documented [hosted worker wall-clock limit](https://supabase.com/docs/guides/functions/limits)
is at most 400 seconds; background tasks share that limit. Their ages alone do
not establish source completeness or drain other, current executions.

The scoped recovery in `scripts/verify/learn-production-legacy-job-settlement.sql`
records these historical executions as failed with
`legacy_execution_interrupted_capture_unverified`. It changes only status,
failure timestamp, error label and the normal updated timestamp. Each complete
original row is retained in a same-tenant `audit_logs` receipt. It never marks
success, advances cursors, changes source rows, grants access or explicitly retries
work. Existing schedules continue normally; clearing the old graph job's active
idempotency key may allow the already-enabled graph schedule to enqueue its next
normal run. That is not acceptance of graph completeness.

The private preparation binds all 14 IDs, tenant IDs and complete-row fingerprints.
The SQL requires a fresh observation, postgres role, the exact production target,
no claim/lease/attempt/terminal timestamp, and records older than 24 hours. It locks
only the reviewed rows and rejects any changed fingerprint or prior receipt. All
updates and audit receipts are one transaction. The runner writes a durable intent
before submission and never retries an uncertain write; `inspect` checks the same
IDs and receipts without mutation. The normal trigger remains enabled.

Before execution, rehearse on the retained networkless production archive with
changed-row, recent-row, claimed-row, wrong-target, expired-observation, duplicate
and late-failure cases. Verify original job snapshots, existing audit rows, other
datasets and sequence states. No unmatched historical Phone/email run is settled
by inference. The separate production drain and signed-in release gates remain.

**Execution result:** applied once at 00:14 UTC after the exact isolated rehearsal
passed. All 14 receipts and preserved non-status fields verified; no explicit retry
was created. The original archive, hosted TEST and Slack import scope are unchanged.
