# Commusoft read-only API adapter

## Property-scoped contacts — TEST schema and runtime installed

Release **042** installed at **20:30 UTC, 10 October**, after a successful hosted
rollback rehearsal. Both Commusoft endpoints became **v4** at **20:32 UTC**, with
JWT protection retained. The installed SQL passes the reviewed synthetic service-
path probe under rollback. All 77 pre-existing datasets are preserved; the new
contact-target table remains empty. Runtime/HTTP checks preserve all 78 datasets.

Twelve actual HTTP checks pass. Downloaded published code matches the reviewed
executable structure and passes 79 behavior checks. Fifteen release/deployer tests
pass. The first rehearsal exposed a syntax error in the probe itself; rollback was
confirmed, the corrected probe passed locally and then hosted, and only that
verified package was installed.

The hosted probe uses synthetic preseeded permits to exercise publication and
settlement. It creates no login, operator grant or Vault credential and does not
prove signed-in approval or a real provider request from Edge. Those remain next. The protected TEST frontend is READY from Git commit
`767582d0c4aaea2585079f02f956a8fd753b7a78`; homepage, login and client routes
retain Vercel protection. Fresh browser visual acceptance is unconfirmed because
the browser connection timed out. Production remains unchanged.
[Release evidence](evidence/learn-commusoft-contact-traversal-test-2026-10-10.json).

## Earlier local validation — now deployed to TEST as release 042

The new migration and worker now build a fixed contact plan from the last completed
property traversal for the same company and connection. Each selected property's
source version, order and successor are retained. The SQL credential permit binds
its exact parent; publication checks every returned contact against that parent.
Empty properties advance normally. Completing one property resets its contact
cursor and advances to the next; only completing the final property ends the plan.

Property position and contact cursor are retained atomically with the source page.
Operator continuation keeps the same plan and cannot substitute another property.
A lost publication acknowledgement settles the retained page without fetching it
again. A forced late observation failure rolls back the page, source version and
cursor together. The operator UI reports properties checked as well as pages saved,
and gives specific guidance when the property import or contact plan is missing.

Initial approval still allows at most 10,000 pages. Continuations may advance the
cumulative limit while authorizing at most 10,000 further pages each, so larger
companies do not permanently stop at the old cumulative ceiling. The existing
24-hour approval expiry, shared quota and source history protections remain.

**Verified locally:** 78 tests, strict application/worker TypeScript, application
build, actual PostgreSQL migration rollback and both contact/legacy continuation
SQL suites. The actual worker, reader, permit/publication/settlement RPCs complete
a three-request synthetic traversal, including a lost acknowledgement. Actual SQL
operator output passes the application parser.
[Evidence](evidence/learn-commusoft-contact-traversal-local-2026-10-10.json).

**Subsequently deployed:** the TEST schema and runtime are verified as recorded above.
The frontend release is now READY; signed-in setup and a real hosted import remain pending. No
external requests or hosted mutations occurred during this candidate verification.
Empty target sets are refused explicitly; old unscoped contact approvals require
review rather than automatic reinterpretation. New properties need a later
property traversal/contact plan; no snapshot/deletion/future coverage is inferred.

## Earlier contact diagnosis — required parent corrected and deployed to TEST

At **20:11 UTC**, actual properties and jobs both passed first/next-page reads.
The existing unscoped contact request returned JSON **404**. The full published
[contacts OpenAPI schema](https://developer.commusoft.com/list-property-contacts-28546275e0.md)
marks `propertyID` as **required**. This is an implementation gap on our side;
contacts cannot be imported as one global collection filtered only by `type`.
The earlier synthetic contact-import fixtures did not enforce this provider contract.

After correcting the request, **20:13 UTC** live reads returned HTTP 200 for both
customer and work-address contacts using the existing key and scopes. Two pages
of customer contacts passed, and one work-address contact page reached that
property's terminal cursor. Each returned contact matched its requested parent.
Property discovery sampled 200 records in memory; jobs and contact samples were
one record per page. Seven requests succeeded after the five-request diagnostic
that exposed the missing parameter. No source records/IDs/keys were retained and
no database/provider mutations occurred.

The local reader now requires a positive safe-integer parent ID, sends it as
`propertyID`, and rejects contacts belonging to a different or missing parent.
The stored worker scope also refuses an unbound contact request before acquiring
a credential. Seventy-two tests and strict TypeScript pass. These source changes were local at this checkpoint and are now included in TEST v4
as recorded above. The historical authentication-only release remains pinned
and refuses the changed bundle; TEST v3 used the earlier contact contract. No contact jobs/connections were enabled by the preceding release.
[Redacted checks](evidence/learn-commusoft-contact-scope-2026-10-10.json).

**Workflow requirement (implemented in the local candidate above):** derive a frozen, tenant/connection-
scoped list of customer or work-address properties from a completed property
traversal. Retain the property source version and plan membership. Traverse each
property's contacts with its own cursor, including empty properties; checkpoint
both the property position and contact cursor atomically with each source page.
A completed property must advance to the next property, not finish the company
import. Retrying or resuming must keep the same plan, parent and cursor; new or
changed properties belong to a later reconciliation. Bind the parent in both the
SQL credential permit and SQL publication validation, then expose property progress
through the operator's existing receipt/recovery workflow. Customer-wide coverage
remains unverified until this path passes real SQL, worker and hosted acceptance.

## Request configuration corrected — properties and jobs verified, 10 October 20:00 UTC

**This supersedes the unresolved access blocker below.** Support asked for the full
request and response. Controlled comparisons showed that our request configuration
needed correction. The saved credential was verified against the existing private
app by fingerprint without revealing or regenerating it.

| Controlled request | Result |
| --- | --- |
| Original Node defaults + `x-api-key` | HTML 403, 150-byte OpenResty denial |
| Minimal curl + same `x-api-key` | JSON 401 `AUTHENTICATION_ERROR` |
| Node + truthful OpenFolk User-Agent + same `x-api-key` | JSON 401 |
| Same named Node client + `Authorization: Bearer …` | JSON 200 |
| Actual corrected adapter, one property and one job | Both JSON 200; parser and in-memory candidate mapping passed |

The explicit private-app authentication article described `x-api-key`, while the
[List properties](https://developer.commusoft.com/list-properties-24494182e0)
endpoint documents Bearer. Live evidence now resolves which works for this app.
`read_page.ts` sends Bearer authentication and
`User-Agent: OpenFolk-ServiceOS/1.0 (+https://openfolk.ai)` consistently, with the
existing `X-API-VERSION: 2.1` header for jobs. There is no authentication fallback
loop. The existing URL, read-only scopes, secret, bounded reads, redirect refusal,
quota handling and tenant permission checks remain intact.

Three successful GET entries were visible under private app 49 in Commusoft's API
log. Six bounded GETs were made in this investigation (eight including the two
historical failures); no provider/database records, credentials or scopes changed.
No source values were retained in the report. Seventy connector/diagnostic tests
and strict TypeScript pass. See [redacted evidence](evidence/learn-commusoft-request-correction-2026-10-10.json).

**The correction is deployed to TEST; production is unchanged.** At 20:05 UTC,
`learn-commusoft-worker` and `learn-commusoft-verify` became v3 with JWT checks
retained. Twelve hosted HTTP checks pass, including an authorized empty worker
invocation. Downloaded deployed code matches the source executable structure and
passes 75 behavioral checks with synthetic ports. All 77 monitored datasets,
schema and other endpoints are preserved. No real hosted provider request,
credential binding or signed-in operator acceptance was performed.
[TEST runtime evidence](evidence/learn-commusoft-auth-test-release-2026-10-10.json).

Full
traversal, contacts permissions, canonical publication and scheduled ingestion
remain to be accepted. Successful one-record reads do not prove full coverage.
The [support reply](COMMUSOFT-SUPPORT-REPLY-2026-10-10.txt) is prepared for Chris to
send; Codex has not sent it. The original full redacted 403 and controlled comparisons
are retained in the evidence. No further access-enablement escalation is needed on
the basis of that original request.


## Existing private application found; live read denied — 10 October 2026

The signed-in Chrome session exposes the existing **OpenFolk — Drummonds read-only**
private application, created 5 October. Its description identifies Drummond Heating,
client 19136. The authentication page lists `crm.properties.read` and `jobs.jobs.read`.
The existing key was read privately for the authorized integration diagnostic;
no key was created, regenerated or revoked and no scopes were changed. It remains
in ignored local storage with owner-only file permissions, never in Git or reports.

At **16:22:09 UTC**, the actual server transport requested UK `properties?limit=1`
using the documented `x-api-key` header. It returned **HTTP 403**; the diagnostic
stopped without requesting jobs or contacts. One subsequent diagnostic of the
same endpoint/authentication mode confirmed a short **HTML** denial rather than
the expected JSON API envelope. No explicit invalid-key, expiry or scope error
was identified. The application's API-log screen showed no entries after the
first attempt. These observations do not establish which access layer denied the
request, whether the key is usable, or whether the described account is its actual
data account. Do not work around this by guessing hosts or authentication modes.

A subsequent read-only review confirmed both visible read scopes and the still-empty
API log. The current [authentication documentation](https://developer.commusoft.com/authentication-1985209m0)
matches the requested UK base and `x-api-key` header. The
[response documentation](https://developer.commusoft.com/requests-and-responses-1985359m0)
describes JSON error objects; the observed HTML response does not identify a
specific permission or credential fault. No further provider requests were made
during this review. The operator access-denied message now reflects that uncertainty
and points to API logs, read permissions and account/network restrictions before
another deliberate check. Do not regenerate the existing key based only on this 403.

The bounded diagnostic journals attempts before sending, makes no automatic
retry, reads at most one record per collection and reports no source values.
Three tests verify request bounds, denied/throttled stopping, source-value
exclusion and refusal to send when journaling fails. See
[sanitized live diagnostic](evidence/learn-commusoft-live-read-2026-10-10.json).
There were two provider GETs total, no database/provider mutations, no hosted
credential binding and no import or schedule. Real contacts scope and complete
customer/site/job coverage remain unverified.

## Account-access escalation prepared — 10 October 2026

A fresh read-only browser review confirmed the same private application, empty API
log and two scopes (`crm.properties.read`, `jobs.jobs.read`). No settings or keys
were changed and no new API request was made. The official private-app guide still
specifies the same UK base and `x-api-key`. The generic resource-page Bearer example
remains inconsistent with that specific guide and is not evidence to change modes.

A concrete in-app support message has been presented to Chris for permission to
send. **It has not been sent.** The question is account/API availability, not a
request to debug our architecture; Commusoft's [support policy](https://developer.commusoft.com/support-and-technical-support-1985398m0)
says technical support is available to partners rather than private-app developers.
Prepared message:

> Client 19136, private app “OpenFolk — Drummonds read-only”: GET
> `https://app.commusoft.co.uk/api/v2/properties?limit=1` with the existing `x-api-key`
> returned HTML HTTP 403 on 10 October at 16:22 UTC. The app has
> `crm.properties.read` and `jobs.jobs.read`, but its API log is empty. Please confirm
> API v2 access is enabled and whether an account or network restriction is rejecting
> requests before logging.

No API key, customer record, raw provider body or request header value is included.
Do not send without Chris's direct authorization. This is a live-access dependency;
it does not block unrelated LEARN implementation.

The bounded diagnostic now classifies the first response's content type as JSON,
HTML, other or unknown and suggests the next operator check. This avoids a second
provider call merely to classify an HTML denial. It does not diagnose the key as
invalid from a non-JSON 401/403. Four tests pass, including stopping after one denied
read, journal-before-request, format-specific guidance and excluding body/header
values from the report. The changed diagnostic has not been run against Commusoft;
the retained historical evidence still records exactly two provider GETs.

## Current state — 10 October 2026

The input schema, dedicated worker and OpenFolk switch/import-approval RPCs are
installed in TEST. Signed-in operator and customer/site/job review acceptance
passes. A successful synthetic ingestion run exercised real Vault/RPCs, page
continuation, lost-reply handling, deployed committed-page recovery and reviewed
cards. Real Commusoft API access and coverage are not established. Production and
the frontend release are unchanged.

The OpenFolk setup/access-check screen is implemented and has synthetic browser
acceptance. Atomic configuration and verification SQL are now installed in TEST
(release 028), with the required name/store broker helpers. The existing TEST
Vault permissions are unchanged. Exact-schema PG17 encryption/reuse checks, hosted
rollback and fresh read-only installation confirmation pass; 28 existing data sets
retain identical fingerprints. No keys, connection changes or requests were seeded.
The initial post-install inspection hit management API rate limits; the acknowledged
installation was confirmed read-only and was not submitted again.

The JWT-protected verification endpoint is now deployed in TEST. Signed-in
acceptance passes setup with a synthetic credential, stored-key reuse, lost-reply
recovery, private-history access controls, cancellation and completed-result replay.
The production executor exercised actual hosted Vault and verification RPCs using
an intercepted synthetic provider response. This proves the hosted database path;
a fresh provider read originating inside deployed Edge remains unverified. No real
Commusoft request was sent. The four temporary logins were banned, authority ended,
connection revoked and dummy Vault binding retired. An independent read-only check
confirms retirement. All 34 checked pre-existing TEST data sets are unchanged.

The frontend remains unreleased. See
[connection release evidence](evidence/learn-commusoft-connection-test-release-2026-10-10.json)
and [hosted acceptance](evidence/learn-commusoft-connection-hosted-2026-10-10.json).

The metadata-only discovery earlier today found no configured Drummonds Commusoft
connection or Commusoft-named project secret. Checked local environment variable
names also yielded no Commusoft entry. This does not establish whether Drummonds'
Commusoft subscription has private-application API access enabled.

## Hosted contact release — 10 October, 12:17 UTC

Contact projection and review functions are now installed in TEST as release 029.
The package adds three functions and updates the existing work page/batch functions;
there are still 110 tables, with 30 release receipts. No source work, connection,
credential, module flag, endpoint, schedule or frontend deployment was created.

The local PG17 rehearsal reproduced the actual TEST table definitions, constraints,
indexes, RLS policies, grants and helpers. Contact creation, multiple endpoints,
customer/site relationships, existing-person preservation, tenant/role checks,
held relationships, mixed results, cancellation, rollback, replay and simultaneous
confirmations pass against that schema. Five release regressions pass, including
unknown acknowledgements, failed journaling and changed source fingerprints.

Hosted rollback rehearsal preserved the schema and all 42 checked existing data
sets. Installation was acknowledged at 12:15:43 UTC. Its follow-up inspection hit
HTTP 429; the migration was not resubmitted. Read-only confirmation at 12:17:33 UTC
verified the compiled function/permission contracts, both receipt inventories,
unchanged prior schema/endpoints and all 42 data fingerprints, including encrypted
Vault rows. Signed-in hosted contact acceptance is the next required check. The
frontend and production remain unchanged. See
[contact release evidence](evidence/learn-commusoft-contacts-test-release-2026-10-10.json).

### Prepared hosted contact acceptance — awaiting approval

`learn-test-commusoft-contacts-acceptance.mjs` extends the successful ingestion
runner with four synthetic contacts, both contact collection types, cursor
continuation and actual signed-in review adapters. Prepared assertions cover
multiple phones, an unresolved parent held for review, shared-email identity
selection, unchanged existing person fields, lost-reply recovery with capture
disabled, cancellation, replay and tenant/role denial. These new hosted assertions
have **not run** and must not be described as passing.

Automatic approval review rejected execution before process creation because the
run creates a temporary account, operator grant, dummy Vault entry and synthetic
connection. Explicit approval is pending for one fixed recipient and company in
TEST only. A private local plan fixes their IDs and the scope; validation refuses
missing or expanded scope before any network request. The operator grant expires
after 30 minutes and allows TEST-wide control during that interval. Cleanup also
bans the login, ends its access and retires the dummy credential binding, retaining
synthetic evidence. Provider transport is intercepted; no real Commusoft request
or production change is allowed. The plan and private results stay out of Git.
The initial recovery manifest uses exclusive creation to prevent accidental reuse
of a plan from overwriting a previous run's evidence.

Local fixture-plan validation passes. Continue unaffected work while approval is
pending; do not execute this hosted run through an alternative path.

## Hosted continuation release — 10 October, 12:45 UTC

Release package 030 adds only `learn_operator_resume_commusoft`. A fresh read of
TEST confirmed 110 tables, 30 release receipts and the exact installed contact
runtime. The local PG17 rehearsal reproduces all 34 relevant table definitions,
constraints, indexes, RLS policies, triggers, permissions and 53 functions, plus
real encrypted Vault storage with the actual non-superuser function owner.
No hosted business data or real credential is copied into the fixture.

The packaged migration passes rollback, injected final-release-receipt failure,
duplicate-install refusal, signed-in continuation assertions, worker acquisition /
publication / settlement and competing-request concurrency. Existing tables,
functions and grants remain unchanged; the one new function is callable through
the authenticated RPC surface and requires current OpenFolk administrator authority.
Fixture-only tables and the injected failure trigger are excluded/removed from the
final schema comparison. Five release regression checks also pass: altered
permissions/contracts, lost acknowledgements, changed source fingerprints, unavailable
post-write inspection, stale rehearsals and failed journal persistence.

Hosted rollback rehearsal was acknowledged at 12:42:59 UTC with all 42 pre-existing
data fingerprints unchanged. Initial installation attempts stopped in read-only
metadata prechecks (including HTTP 429), before an apply journal or migration
submission. After cooldown, a single migration submission was acknowledged and
confirmed at 12:45:57 UTC. The compiled function/permission contracts, both release
receipt inventories and all prior schema/endpoints match. All 42 data fingerprints,
including encrypted Vault rows, remain identical. TEST has 110 tables and 31 release
receipts. No new account, user grant, credential, import, schedule or frontend
deployment was created. Signed-in hosted continuation acceptance remains required.
The separate hosted synthetic contact acceptance still needs the requested approval;
its fixed recipient and access scope are unchanged, and its runtime check now accepts
this exactly verified continuation release as well as the preceding contact release.

See [continuation release evidence](evidence/learn-commusoft-resume-test-release-2026-10-10.json).

## Import continuation — local, 10 October

`20261031200000_learn_commusoft_resume.sql` adds an explicit OpenFolk administrator
continuation operation. It uses the existing immutable operator request ledger
and apply/check/cancel protocol. No additional table, default grant, credential,
schedule or queued job is created by installation. At this local checkpoint the
migration was not yet installed. The subsequent TEST installation is recorded above;
its frontend and production remain unreleased.

An administrator reviews a settled, incomplete import, provides a reason, total
page allowance and expiry, and approves continuation. The server compares the
observed account, approval, connection revision, latest job and checkpoint. It
requires current platform authority, no View As, active tenant/account/connector,
enabled modules and a verified tenant-bound credential. It verifies the saved
checkpoint against the last retained source page. Active jobs, including expired
leases, cannot be replaced. A committed but unsettled failed job is refused so
source-free worker recovery can settle it first. Completed traversals cannot be
continued. An empty checkpoint is allowed only for a failed first-page attempt.

The operation preserves the original approval identity, collection, contact type,
page size, cursor, pages, source versions and terminal jobs. Only total page budget
and expiry can increase (within 10,000 pages and 24 hours). One new job references
the terminal predecessor; the original configuration/checkpoint and operator reason
remain in the immutable receipt history. Shared credential pacing remains enforced
by the existing worker acquisition path. Late receipt failure rolls back the limit
change and new job. Cancellation fences delayed apply; replay returns the same job.

The operator progress card now includes continuation controls and blocks a new
import over unfinished work. Changed limits clear confirmation. It reuses the
backend/actor/tenant-scoped durable outbox and cross-tab lock; lost acknowledgements
are checked before resubmission. Receipts must bind the account, approval, preserved
checkpoint and a new job before local recovery state clears.

Local verification used real permit, page publication, worker settlement, operator
authority and continuation SQL against a disposable PostgreSQL database with
synthetic supporting tables and data. A real first page stopped at its budget;
continuation preserved it and the worker committed the next page from its cursor.
Checks cover stale progress, scope changes, limits, disabled modules, revoked/viewer/
client-owner/View As authority, cancellation, exact replay, late-failure rollback,
completed traversal refusal, competing requests and apply/cancel concurrency. This
is not an exact hosted-schema or provider acceptance test; both remain necessary.

All 15 operator/continuation adapter and outbox tests, TypeScript, application build
and isolated preview build passed. Network-disabled browser acceptance exercised
lost reply → reload → saved-result recovery, retained progress, replacement-import
blocking, review reset after editing limits and viewer denial. Evidence:
[evidence/learn-commusoft-resume-local-2026-10-10.json](evidence/learn-commusoft-resume-local-2026-10-10.json).

## Contact review checkpoint — local acceptance, 10 October

Property contacts now project into the existing `people`, `contact_points` and
business graph models, linked to reviewed customer cards and sites. No additional
customer card is created for a contact. Multiple phone numbers are preserved;
shared email/phone identities require an explicit existing-person choice. Existing
person fields, endpoint verification and primary choices remain intact. Source
communication preferences remain evidence and do not grant marketing permission.

The owner/admin review screen includes Contacts, source details, bounded candidate
search and durable batch recovery. Editing a search clears the previous identity
choice. SQL acceptance passed in isolated PostgreSQL, including tenant/role checks,
canonical identity preservation, held dependencies, cancellation, late-failure
rollback and concurrent replay. All 15 customer/work client tests, TypeScript and
the application build passed. The network-disabled browser fixture verified
multiple phones, identity-choice reset, mixed outcomes, recovery after a lost reply
and reload, and viewer denial. At that local checkpoint, the contact changes were not installed in hosted TEST
or production. The later TEST installation is recorded above; signed-in hosted
acceptance and production release remain outstanding.

Chris provided a logged-in Arc session. Read-only navigation confirmed API keys
and Private Application settings are present; the key list includes system/device
tokens, which are not assumed to be private-application credentials. No key was
created, revoked, copied into ServiceOS or used in an API request. Private-app
permissions and usable integration credentials remain unverified. Native Arc
controls became intermittently unavailable; Chris was asked to open the Private
Application page. Browser login does not establish API access or import coverage.

## Official contract inspected

Read on 10 October 2026, including the endpoint Markdown OpenAPI exports:

- [Authentication](https://developer.commusoft.com/authentication-1985209m0):
  private applications use `x-api-key`; fixed UK and US HTTPS API bases.
- [Properties](https://developer.commusoft.com/list-properties-24494182e0):
  `customer` and `workaddress` are different property types. A work address's
  `parentPropertyID` identifies its customer property.
- [Customer types](https://developer.commusoft.com/list-customer-types-27670540e0.md):
  `/settings/customerTypes` returns configurable categories. Its export uses
  string IDs and a string `companyNameRequired` field without defined values;
  unlike properties it does not specify a cursor envelope. The current three-
  collection reader does not fetch this endpoint or guess its flag semantics.
- [Contacts](https://developer.commusoft.com/list-property-contacts-28546275e0):
  people associated with properties; suppliers also exist. The full export requires
  `propertyID` as well as our explicit customer/workaddress contact filter. The exported `type` schema is an
  unconstrained string (only `customer` is exemplified); verify the workaddress
  filter with account access before claiming contact coverage.
- [Jobs](https://developer.commusoft.com/list-jobs-24695917e0): `propertyID` is a
  property reference. The export requires `X-API-VERSION`, exemplified as `2.1`;
  the reader sends that version for jobs.
- [Pagination](https://developer.commusoft.com/core-concepts-and-patterns-1985393m0):
  numeric record-ID cursors; use returned cursors rather than calculated offsets.
- [Rate limits](https://developer.commusoft.com/rate-limits-1985219m0): shared
  per-key rolling quota and `X-RateLimit-Reset`. The reader exposes quota metadata
  on success and a safe retry time on throttling. It never retries automatically.

The authentication guide conflicts with the endpoint-generated Bearer examples.
The earlier implementation followed the explicit private-app guide. The verified
request correction above now uses Bearer; do not automatically retry alternate
authentication modes or hosts.
Provider page-size maximums and default ordering are not fully specified. The
local maximum is 100; forward reads require increasing safe integer IDs and a
returned cursor matching the final ID. Unexpected behavior stops the read rather
than reporting a partial traversal as complete.

## Implemented boundary

`supabase/functions/_shared/commusoft/read_page.ts` only issues GET requests to
three allowlisted collections. It disables redirects and cookies, bounds streamed
body/record sizes and request duration, rejects malformed/repeating pages, and
rechecks supplied authority before the request and before returning data. Safe
errors exclude response prose, source payloads, credentials and network exceptions.
The low-level authority callback is now supplied by the local stored-scope binding
described below; production credential acquisition/publication are still missing.

`source_records.ts` produces `BusinessSourceRecord` candidates under exact tenant,
connection, collection and external-ID identities. Equal numbers in different
collections or connections cannot be conflated by this contract. Unknown property
types, missing property references and self-parent sites are held. Every record
keeps a copy of its original payload, including unknown fields. No timestamp,
historical ownership, customer identity, deletion or score is invented.

The shared contract is an ingestion boundary, not a new canonical database model.
Candidates must resolve against existing ServiceOS customers, contacts, sites and
jobs. A job property can be either a customer property or a work address; it must
not be copied directly into a canonical customer/site foreign key. Company versus
individual identity also requires the provider's customer-type metadata, not a
guess based on whether a contact/name happens to exist.

## Durable scope and worker boundary

`stored_scope.ts` reads only authoritative rows, with explicit tenant filters:
active tenant; running claimed `commusoft.source_sync` job and unexpired lease;
active connector/account; stored import approval and matching checkpoint; and a
configured, verified, unrevoked private-app connection with matching account,
region, revision and Vault reference. Caller/queued payload does not select the
provider account, region, credential, resource or cursor.

The existing `feature_flags` table carries two new opt-in keys: `learn.enabled`
and `learn.inputs.commusoft.enabled`. Both must have a tenant-specific JSON boolean
`true` value. Missing, global-only, unreadable or non-boolean values deny execution.
No flags have been seeded or changed. These keys currently gate this new adapter
only; they do not yet control other LEARN workers or implement operator settings UI.

Account settings contract: `commusoft_import` holds `approved`, `approvalId`,
`connectionId`, `consentReference`, `expiresAt`, `maxPages`, `pageSize`, `resource`
and contact-only `contactType`. Empty `sync_cursor` starts that approval; subsequent
checkpoints carry `approvalId`, `after`, `pages`, `complete`. An exhausted page
budget, terminal cursor or changed approval prevents another request. Connection
configuration uses auth mode `private_api_key`, non-secret `region` and
`account_key`, and the existing broker field `api_key`. Setup/verification must
write these through authorized server controls; no such setup action is wired yet.

`bound_page.ts` snapshots worker context and rechecks the stored scope before
acquisition and around the provider read. Its mandatory credential/permit port
must atomically recheck that scope, reserve shared quota and resolve the exact
Vault reference. Throttled/exhausted-quota responses require a durable shared
deferral acknowledgement. `permit_server.ts` now implements that port through
two service-only RPCs. There is no fallback to general secret lookup or automatic
provider activity. A dedicated worker endpoint is wired locally; the generic
handler registry is unchanged. Setup/enqueue controls are not yet wired. The
migrations remain local and unapplied to TEST or production.

The SQL acquisition/publication functions repeat these checks under locks. Metadata
reads are not a transaction; they cannot alone authorize a source/checkpoint write.
Binding tests cover suspension, missing/disabled flags, stale or expired leases,
wrong tenants/accounts, revoked/unverified credentials, changed connection
revisions/approvals/cursors, terminal windows, waiting permits and failed deferrals.

## Atomic credential acquisition and shared pacing — local

Migration `20261031090000_learn_commusoft_page_permits.sql` rechecks current
tenant/flags/job/claim/account/connector/approval/checkpoint/connection under locks.
Only the exact Vault reference with the existing tenant-qualified broker name can
release a key. Each job attempt can acquire only one permit; an uncertain response
cannot be retried inline. Committed-page recovery and queue settlement are now
implemented locally. The permit retains the validated approval, checkpoint,
request and connection binding (without the key) for the atomic page writer.

The private pacing table keys quota by a SHA-256 fingerprint of the credential,
so the same key stored in different tenant Vault entries shares one gate. Neither
the key nor its fingerprint appears in the customer UI or shared source records.
RLS is enabled and direct table privileges are revoked, including from service_role.
Only service-only functions can acquire permits or extend delays.

Reservations are spaced by 1.25 seconds and must be used within five seconds.
The reader checks the deadline immediately before fetch, after authority reads;
a slow response is still accepted if authority remains current. The short send
window prevents delayed workers accumulating permits for a burst. Other users of
the same provider key are outside this reservation system, so provider 429/reset
headers remain authoritative. Their minimum delay is applied to the shared gate
through the exact acquired permit, even after the originating job is cancelled or
its connection is revoked. Deferral can only extend the gate.

The isolated PostgreSQL runner passed authority/substitution denials, actual
service-role execution, denied browser/table grants, exact Vault name binding,
duplicate-acquisition refusal, shared quota across two tenants using one key,
non-decreasing late deferral, two competing workers (one ready, one waiting), and
rollback without retained objects. It uses synthetic minimal schema contracts and
a fixture Vault table; it does not verify hosted schema/Vault compatibility.

## Atomic retained source publication — local

Migration `20261031100000_learn_business_input_pages.sql` adds provider-neutral
pages, content-addressed versions and per-page observations. All retain the exact
tenant, connection, collection and source ID context; pages keep their complete
provider JSON envelope. Identical record content reuses a version while each page
retains its observation. Changed content creates another retained version. These
are source records, not canonical customers/jobs or a claim of latest provider state.

The service-only publication function locks the job/account and rechecks current
tenant, both flags, connector, approval, checkpoint, connection and lease against
the acquired permit. It validates row order, size and pagination independently of
the TypeScript reader. Raw page, versions, observations, account checkpoint and job
receipt commit in one transaction. No canonical record or legacy source is rewritten.
Direct privileges are revoked; triggers reject update, delete and truncate of the
retained source tables, including privileged attempts. Source UI access will need
separate tenant/role-scoped readers.

Exact replay returns the existing receipt; changed replay is a conflict. The
acquisition function now refuses a job that already has a page receipt. A separate
source-free recovery function verifies the current worker claim and matches the
job receipt to the retained page, allowing a new queue attempt to recover without
fetching the provider again. Receipt recovery also works after a module is disabled;
it acknowledges committed work without authorizing new processing.

`page_store.ts` uses these RPCs, validates acknowledgements against the submitted
scope/page and never retries an uncertain write automatically. The dedicated
worker calls recovery first, then reads/publishes only when no commit exists.

Isolated checks passed: authority and changed-checkpoint denial; duplicate rows and
invalid cursor refusal; injected failure at checkpoint update and later job-receipt
update with full rollback; exact/changed replay; recovery in a new attempt with
modules disabled; stale-claim and tampered-receipt refusal; continuing from the
saved cursor; version deduplication plus changed-content retention; privileged
history mutation refusal; competing identical publications producing one page;
and migration rollback restoring the acquisition function. This remains synthetic
minimal-schema evidence, not hosted acceptance or a real interrupted provider sync.

## Dedicated worker and atomic continuation — local

`worker.ts` connects recovery, authoritative scope, credential permits, provider
reads and atomic publication. It never chooses a tenant/account from the HTTP
request. Before declaring failure it asks the settlement RPC whether a page was
actually committed, covering a lost publication response. Errors expose safe codes
only. Malformed claims, unreadable recovery and uncertain settlement remain errors.

Migration `20261031110000_learn_commusoft_worker.sql` excludes this job type from
the generic queue claim and adds dedicated one-job claiming and fenced settlement.
Jobs use `commusoft.source:<account UUID>:<approval UUID>`; the binding, credential
acquisition and publication require the same approval identity. Completion and
successor enqueue are one transaction. Successor failure rolls back completion;
exact settlement replay reuses its receipt and cannot create another successor.

Continuation is derived from the saved page and current switches/approval,
checkpoint and connection. It respects the existing shared provider cooldown.
Disabling processing after a commit acknowledges that page and stops continuation.
Collection exhaustion and page-budget exhaustion have distinct results; neither
claims complete ongoing provider coverage. Uncommitted failures have bounded
retry/backoff and dead-letter handling. A committed page can recover an expired
lease beyond the retry budget to settle without another provider call.

`learn-commusoft-worker/index.ts` is a local Edge entrypoint with gateway JWT
verification plus `LEARN_COMMUSOFT_WORKER_KEY` in the existing infrastructure-key
header. It reuses the tested empty-POST guard; caller-supplied selectors/bodies are
rejected. No trigger key has been created or copied and no schedule enabled.
The endpoint has syntax validation, while its exact deployed Deno/SDK bundle still
requires release verification. All imported Commusoft TypeScript modules pass
strict checking; Deno is not available on this shell's PATH.

Isolated SQL checks passed: generic claim exclusion, exclusive dedicated claims,
changed approval identity denial, atomic successor rollback, exact/conflicting
settlement replay, shared cooldown scheduling, expired-lease recovery, disabled
continuation, ownership fences, bounded retries and competing workers. Rollback
restored the original generic claim, credential and publication functions. Tests
use the repository's original generic claim implementation plus a minimal fixture
schema; the installed TEST catalogue and live API are still unverified.

## Reviewed customer identities and existing cards — local

Migration `20261031120000_learn_business_input_customers.sql` adds a private,
immutable, provider-neutral source-to-canonical identity ledger. Its identity key
includes tenant, connection, provider, collection and external ID. It records the
exact source version, reviewing actor, decision/reason, canonical target and card.
It does not reuse legacy CSV external IDs across unverified account boundaries.

`learn_commusoft_review_customer` is a private service RPC. An authenticated server
must supply the verified actor; the database repeats the existing current tenant
owner/admin and View-As checks. It also locks/checks tenant/module/connector and
configured connection authority. The connection lock fences page publication while
the review checks the latest retained observation; stale or ambiguous evidence
cannot create a customer. Original source versions and pages stay immutable.

The caller explicitly classifies a reviewed customer as person or company and
chooses an existing canonical target or creation. This is not automatic identity
matching: creating a new customer must be an explicit decision after inspecting
existing candidates. The review screen is now wired locally as described below;
automatic bulk type mapping remains outstanding.
Existing targets and cards are reused without changing any fields. New customers
receive typed source names/address/contact fields and unverified provenance; new
cards retain neutral defaults, with no invented activity, score or marketing consent.
The company's own card remains distinct from a named person's card at that company.

Customer, card and source link commit together. Lost-response replay returns the
same IDs, concurrent identical reviews create one customer/card, and changed
decisions cannot overwrite a link. Existing links are not a mechanism for source
field updates or identity correction; those governed workflows remain required.
This RPC is not called automatically by the ingestion worker, so a projection
failure cannot discard an already retained source page.

`--customers` verification uses the original canonical customer table definitions,
the existing authority function and actual permit/page publisher in disposable
offline Postgres. It proves person/company creation, unchanged existing records,
separate connection IDs, authority denials, stale-version refusal, exact/concurrent
replay, and rollback after an injected late failure. Minimal fixture prerequisites
are not a substitute for the installed TEST catalogue or authenticated endpoint/UI
acceptance. No migration has been installed in hosted TEST or production.

## Signed-in customer review — local

Migration `20261031130000_learn_business_input_review.sql` adds authenticated
connection/source-page/candidate readers and `learn_commusoft_confirm_customer`.
The facade derives the actor from `auth.uid()` and delegates to the private writer.
The writer remains uncallable directly by browser roles and additionally verifies
the JWT actor for this route. Current tenant owner/admin, View-As, module and
connection checks apply; readers expose bounded summaries, not raw source payloads
or provider secrets. Source and candidate lists use bounded cursor pages.

`LearnCommusoftCustomers` is reachable from LEARN's customer-system section. The
user explicitly selects a connection and retained customer, chooses person/company,
checks possible existing matches, then chooses an existing target or new customer
and supplies a reason/confirmation. Changing source, classification or search
clears the selection/approval. Successful saves refresh the card workspace. A lost
acknowledgement disables further decisions until the source list is reread; the
UI does not retry a write automatically or claim it failed to commit.

Candidate discovery currently uses primary canonical names, emails, phones and
postcodes. Shared contact details/name are clues, not identity proof. Phone matching
only removes formatting; it does not equate national/international number forms.
Secondary contact-point discovery, governed bulk classification, durable pending
review recovery across reloads and correction of existing links remain future work.

Six client contract tests, application typechecking, preview/production builds and
47 existing prebuild checks pass. Isolated database acceptance uses actual
`authenticated` role calls and synthetic JWT settings, including source pagination,
latest-observation reads, candidate discovery, caller-bound saves/replay and access
denials. The facade rollback restores the original private writer. Browser acceptance
used a CSP-isolated synthetic preview and verified a confirmed existing-card link,
lost-acknowledgement reload recovery and viewer restrictions. This is not actual
hosted Auth/PostgREST or real provider acceptance. The temporary browser/server were
closed. See [review evidence](evidence/learn-commusoft-review-local-2026-10-10.json).

## Site/job ownership projection — local

Migration `20261031140000_learn_business_input_work.sql` adds a signed-in,
owner/admin `learn_commusoft_confirm_work_record` action and retained projection
attempts. It accepts a retained site/job version and an explicit existing target
or creation decision, then resolves the property's reviewed identity in the exact
tenant/provider/connection. A customer property supplies its person/company. A
work address supplies its reviewed site plus its reviewed parent customer. Missing
or ambiguous observations, unreviewed identities, changed source ownership and
changed canonical ownership produce durable held reasons without a canonical write.

Successful projection writes the existing `sites`/`jobs` model and the shared
source-identity ledger atomically with its attempt result. Job cards already read
the canonical jobs table; this does not add a competing job-card store. Existing
targets are only linked if their customer/site ownership matches, and their fields
are unchanged. Existing unbound Commusoft CSV external identities are held for
explicit reconciliation. Newly created source namespaces include the connection ID;
identical job numbers across accounts remain distinct. No global job-number alias
is inferred from a connection-scoped ID.

The inspected jobs schema explicitly identifies `id` as the job number. `Open` maps
to `open`, `Complete` to `completed`, and `Closed` to `closed`: a closed outcome can
include an abort, so closure does not invent completion. Only well-formed explicit
source timestamps with a timezone are copied. Missing historical dates remain null;
malformed dates/statuses are held. No staff attribution, currency amount, invoice
state, performance measurement, reward or historical ownership is guessed.

The original source pages survive held outcomes and projection failure. Exact
identity replay reuses the canonical row; changed source versions need a future
update-review workflow. Concurrent identical job projection creates one job. A
late failure writing the attempt rolls back both the new canonical row and link.
The private latest-source helper and attempt ledger are provider-neutral; other
input adapters can use the same canonical model and source identities.

`--work` runs the complete preceding customer/review chain and original site/job
table definitions in isolated Postgres. It verifies direct customer/site ownership,
person/company separation, changed source/canonical site ownership, existing-row
preservation, cross-connection job-number separation, malformed fields/dates,
retained held results, replay/concurrency and late atomic rollback. The migration
rollback leaves no new work objects. No hosted migration or source change occurred.
Work review/batch UI, contact projection and real provider acceptance remain open.

## Still required before enabling Drummonds

1. Verify subscription/private-app access, reuse or securely bind an authorized
   credential, and verify account/region/authentication with a bounded real read.
2. Package and verify all six migrations and the worker against the installed
   TEST schema, including its existing feature flags and queue functions.
3. Add authorized connection/approval setup and operator progress/recovery controls;
   verify customer review in hosted TEST, add work review/batch controls and project contacts.
4. Resolve customer types and property/contact/job relationships, preserve legacy
   links, and handle conflicts, updates and deletions without deleting history.
5. Verify resumable collection traversal, recurring sync and reconciliation,
   operator health/recovery and truthful customer freshness in TEST, then live.

Collection exhaustion is only one traversal boundary, not proof of a consistent
snapshot, deletions, total provider coverage or ongoing freshness. Date-filter
semantics differ across endpoint exports; incremental watermarks are deliberately
not implemented until the complete synchronization contract is verified.

Validation:

```sh
node --test supabase/functions/_shared/commusoft/*.test.ts supabase/functions/_shared/slack/slack_worker_http.test.ts
node --test src/lib/learn-commusoft-review.test.ts
npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --lib ES2022,DOM supabase/functions/_shared/commusoft/*.ts supabase/functions/_shared/business_inputs/source_record.ts
python3 scripts/verify/learn-commusoft-permits.py
python3 scripts/verify/learn-commusoft-permits.py --pages
python3 scripts/verify/learn-commusoft-permits.py --worker
python3 scripts/verify/learn-commusoft-permits.py --customers
python3 scripts/verify/learn-commusoft-permits.py --work
```

These tests cover transport/adapter contracts with synthetic HTTP responses. They
do not establish Drummonds account access, deployed storage or live functionality.

## Work batch review and recovery — local, 10 October

`20261031150000_learn_business_input_work_batches.sql` adds bounded authenticated
site/job source summaries and reviewed batch confirmation (1–50 items). A private
immutable batch receipt shares the transaction with canonical rows, links and
attempts. Exact request replay returns the saved result; changed requests conflict.
An explicit cancellation records the same request identity and fences delayed
application. Competing apply/cancel transactions return the same winning outcome.
The writer verifies the expected signed-in actor and current company authority.
Saved-result reads and cancellation remain possible after module disablement.

The portal's **Review Commusoft sites and jobs** dialog displays 20 source identities
per page, their customer relationship and held reasons. Review customers first,
then sites, then jobs. Its recovery draft is persisted before the first RPC and
uses a Web Lock scoped to backend/company/actor. Receipt reads do not initiate
application. Failed reads, invalid receipts or lost responses retain the draft;
reopening the dialog restores it. Same-request retry and server cancellation are
explicit actions. A verified result refreshes cards and requires reloading the
review before another batch.

The initial UI submits `target_id: null`: legacy imported identity collisions stay
held until a subsequent explicit target-reconciliation workflow. It neither
updates existing rows nor guesses ownership. Contacts and governed source updates
are still outstanding. The migration/UI are local only and require hosted catalogue,
Auth/PostgREST and real-source acceptance before use with Drummonds.

## Hosted TEST schema package 026 — 10 October

The package `supabase/release/learn-test/026_commusoft_inputs.sql` combines the seven
reviewed Commusoft migrations into one transaction and installs the missing TEST
`feature_flags` table using its existing repository model. Flags start empty;
service workers can read them, but this package gives clients no write access.
No connection, credential, approval, queue job, worker endpoint or schedule is
created by this release.

`learn-commusoft-test-projection.py` restores the 13 relevant observed TEST tables,
including their actual constraints, indexes, policies, triggers, helper definitions
and grants, into an isolated PG17 database. It verifies exact reconstruction before
rehearsing the package as the non-superuser deployment owner. Rollback, injected
receipt failure, retained canonical records, unchanged prior grants and duplicate
installation refusal are covered. Auth users/functions are explicit fixture
stand-ins; this rehearsal is separate from actual signed-in acceptance.

`learn-test-commusoft-release.mjs` pins SQL, source migrations, expected catalog and
prior helper/grant contracts. It requires exact release 025 plus importer endpoint
v3, and a matching successful rollback rehearsal less than an hour old. Unknown
write results require inspection, with no automatic retry. The modified generic
queue function is checked in both catalog sections that report it before the prior
release is reconstructed and verified. All earlier schema and endpoint checks stay
in force.

Hosted installation and confirmation evidence is recorded in
`evidence/learn-commusoft-test-release-2026-10-10.json`. Actual Auth/PostgREST
acceptance and the dedicated worker deployment remain required; schema presence
alone does not make Commusoft live.

## Signed-in TEST acceptance — 10 October

`learn-test-commusoft-acceptance.mjs` requires the verified installed release and
existing TEST Auth contract, then creates marked synthetic companies and three
short-lived logins. It uses the actual review/work/card client adapters over real
PostgREST. Source pages are explicit synthetic management-SQL fixtures; no provider
credential, account, sync job or worker is created. This separates review-path
acceptance from the still-required ingestion runtime tests.

The passing run covered existing person/card preservation, reviewed company
creation, site-before-job dependencies, mixed held/linked batches, saved receipt
recovery after a simulated lost reply, exact replay, viewer/foreign-company/raw
source denial, expected actor checks, module-disabled recovery/cancellation and
immediate role revocation. Existing TEST source fingerprints matched. Temporary
logins were banned/passwords rotated; roles demoted and fixture switches/connections
disabled. Synthetic evidence and actor records stay retained.

See `evidence/learn-commusoft-test-acceptance-2026-10-10.json` for the outcome and
independent retirement read-back. This does not establish a live Commusoft account,
continuous ingestion, complete contact coverage or production readiness.

## Worker deployed and exercised in TEST — 10 October

The dedicated `learn-commusoft-worker` endpoint is now active at version 1 in
TEST with gateway JWT verification enabled. Its eight-file bundle is pinned by
`learn-test-commusoft-deploy.mjs`. The `LEARN_COMMUSOFT_WORKER_KEY` binding reuses
the existing TEST service credential in memory/CLI stdin. This is a separate
required request header, not an independently generated credential. No Commusoft
API key was created or obtained. Supabase refreshed the eight existing endpoint
runtime versions by exactly one when the environment binding changed; their
source hashes, entrypoints, JWT policies and other metadata remained identical.

`learn-test-commusoft-runtime.mjs` accepts only that exact refresh plus the
recorded new endpoint, then reconstructs and verifies every prior schema/runtime
contract. The review acceptance runner supports both its original pre-worker
catalog and this exact deployed catalog. The release and deployment commands
remain one-way checks and must not be rerun to recover an uncertain response.

Actual HTTP acceptance passed missing-JWT checks (including a request with only
the trigger header), anonymous/service JWT without the trigger, an incorrect
trigger, GET refusal, caller-body refusal, and an authorised empty invocation.
The queue and source fingerprints across 16 TEST tables stayed unchanged.

Actual queued acceptance used a new synthetic tenant and a verified nonexistent
Vault reference. The real service client resolved the complete stored scope;
credential acquisition returned no permit. After the fixture's claimed lease was
deliberately expired, the deployed worker reclaimed it at attempt two, retained
`commusoft_authority_unavailable`, cleared the lease and created no successor.
A second fixture job was also refused after its Commusoft module switch was
disabled. No permit, retained page or credential was created. Existing records
across 18 source/queue/input tables preserved their fingerprints. Both terminal
jobs remain as evidence; all fixture switches/connectors/accounts are disabled,
the connection is revoked, and no fixture work is active.

Evidence: `evidence/learn-commusoft-test-worker-2026-10-10.json`. These results
prove runtime authority/failure handling and interrupted-claim recovery, not a
successful provider page or complete ingestion. Real Drummonds API access,
successful page/replay acceptance, operator connection setup, contacts,
existing-target reconciliation, source updates and production release remain.

## OpenFolk operator input controls — local implementation

Migration `20261031160000_learn_operator_inputs.sql` adds a private immutable
request ledger, a bounded control-metadata reader and an apply/check/cancel RPC.
It depends on the existing `platform_authority_grants` ledger and corrected
`current_user_is_openfolk_operator` resolver, rather than treating client owners
as platform administrators. Release 027 now contains these operator prerequisites
in TEST (see the hosted release below). No authority is granted by installation.

Platform viewers can read control metadata; platform administrators can explicitly
set `learn.enabled` and `learn.inputs.commusoft.enabled`, or approve one bounded
Commusoft collection traversal. Current actor, effective grant and absence of
View As are enforced server-side. Module changes compare the observed prior
values and record their reason and previous state. These two switches do not yet
control email, phone or Slack workers.

Import approval requires enabled switches, a current verified connection revision,
an existing tenant-qualified Vault reference, bounded pages/page size, an expiry
within 24 hours and explicit customer/workaddress scope for contacts. Setup reads
credential existence only. It atomically binds the existing worker account,
approval, empty initial cursor, queued job and immutable receipt. Active or
incomplete imports cannot be overwritten. A completed prior traversal must have
the matching approval checkpoint; its approval and checkpoint remain in history
when a later collection is approved. No scheduler is added.

Exact retries return the same receipt. A cancelled unresolved request leaves a
tombstone so a delayed apply cannot enqueue work. Cancellation is not a command
to undo an already-recorded approval or stop a queued job; disabling the module
remains the current way to prevent further source acquisition. Reading a receipt
or cancellation remains possible with the module disabled, but still requires
current platform administrator authority.

The metadata reader excludes source payloads, credentials and provider error text.
The application adapter validates tenant/request identity, collection limits and
receipts, and distinguishes queued, interrupted, expired, failed and saved-page
states. Even an exhausted collection is labelled as requiring coverage review.

Isolated PostgreSQL checks use the repository's actual platform grant table and
resolver with synthetic supporting tables/Auth claims. They cover role/grant
boundaries, immediate revocation, View As refusal, module changes, source authority,
idempotence, apply/cancel concurrency, checkpoint preservation, late-failure rollback
and migration rollback. Actual SQL output also passes the application parser; five
client tests and application typechecking pass. These are local checks, not hosted
operator or provider acceptance. Operator UI, connection credential setup/verification,
incomplete-import recovery controls and successful provider page tests remain open.

## OpenFolk screen and saved requests — local, 10 October

`OperatorLearnInputs` is mounted in the operator client's Modules view. It shows
the two implemented module switches, connection verification/binding metadata,
bounded collection/page/expiry choices and per-account progress. An explicit
reason and review checkbox precede changes. It distinguishes queued work, retained
pages, interrupted work and traversal completion. It does not label recorded
credential metadata as successful provider capture. Email/phone/Slack switches
and the credential setup flow remain unwired.

`learn-operator-input-outbox.ts` saves each request before any network call under
the backend, actor and tenant. Web Locks coordinate tabs. Check, same-request retry
and cancellation all read the server receipt first; unavailable, pending or
unverifiable results retain the local request. New changes stay blocked while a
request is unresolved. Storage failures do not send a request; changed context or
competing storage contents cannot be silently cleared. An acknowledged result
remains acknowledged even if refreshing the overview fails afterwards.

The isolated preview disables network connections and uses synthetic receipts
stored independently from the real outbox. Browser acceptance passed a lost save
reply, actual page reload, retained pending controls, and receipt recovery with the
saved disabled module state visible. Unavailable-service state hides mutation
controls. Eleven adapter/outbox tests, application typechecking, application build
and isolated preview build pass. These checks do not replace hosted operator
authorization or real provider acceptance. Screenshot:
`evidence/learn-operator-inputs-browser-2026-10-10.png`.

## Operator schema released to TEST — 10 October

`027_operator_inputs.sql` combines inspected excerpts of the existing platform
authority migrations with the operator input migration. Its manifest pins those
sources; prerequisites and expected metadata pin the complete relevant contracts.
The disposable PG17 projection reproduces observed tables/helpers/privileges and
tests rollback, injected receipt failure, installation and duplicate refusal.

Hosted rollback and one acknowledged installation preserved all 20 monitored
source/canonical/connector/queue tables. Fresh read-only confirmation verifies
106 tables, 28 receipts, exact new definitions/grants, the prior catalog, zero
operator grants and zero operator requests. An initial checker omission involving
the second permission-registry metadata copy was corrected without rerunning SQL.
Both copies now have independent drift coverage.

The hosted runner's `--confirm --existing-cli-login` mode only reads the database
and compares it with the saved baseline and acknowledged installation. It requires
`LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy`. Do not use `--apply` to recover
an uncertain response. Evidence:
`evidence/learn-operator-inputs-test-release-2026-10-10.json`.

Signed-in operator acceptance is still required. No actual operator has been
granted access, and no connection, credential, import, scheduler, frontend or
production deployment was added by this release.

## Signed-in operator acceptance — 10 October

`learn-test-operator-inputs-acceptance.mjs` now exercises real TEST Auth/PostgREST
with four synthetic identities. It validates the installed catalog and Auth
contract before fixture creation, reuses the existing TEST credentials only in
memory, and records its fixture plan privately before mutation.

Verified paths include platform admin/view versus client-owner authority, tenant
data isolation, private request history denial, actual switch changes, outbox
recovery after a lost acknowledgement, exact replay and conflicting request
rejection. A deliberately nonexistent Vault reference refuses an approval before
creating work. Cancellation fences delayed apply; module disablement preserves
receipt access; View As, revoked and future-effective grants deny access with
existing JWTs. No real provider credential or request was used.

All pre-existing records across 25 monitored tables and schema/runtime contracts
were preserved. Four immutable synthetic requests remain. Fixture logins were
banned/passwords rotated, grants ended, profiles demoted, switches disabled and
the connection revoked. An independent read-only check confirms retirement and
zero fixture jobs. Evidence:
`evidence/learn-operator-inputs-test-acceptance-2026-10-10.json`.

The local UI now presents platform viewers with read-only controls and readable
status. Unknown permission checks pause changes; each action rechecks the existing
administrator resolver. Saved requests remain retained when access changes and
become recoverable after access is restored. Browser acceptance covered revocation
before save and lost-reply recovery across reload into viewer access. Read-only
switches show recorded values, including explicit unconfigured status. Evidence:
`evidence/learn-operator-inputs-viewer-2026-10-10.json`.

Successful import approval/page acceptance with synthetic source responses is
recorded below. Connection setup, incomplete-import recovery and Drummonds API
access remain open.

## Successful ingestion and deployed recovery acceptance — 10 October

`learn-test-commusoft-ingestion-acceptance.mjs` exercises the complete synthetic
operator approval → scoped credential acquisition → retained page → checkpoint →
continuation → reviewed customer/site/job → card path against hosted TEST.
The runner's network allowlist permits only the named TEST project and its
management endpoints. Provider transport is replaced by deterministic responses;
the temporary Vault value is explicitly fake and never valid for a provider.
No production state or schedule changes.

The first properties page commits and creates one successor. Page two is saved
before its worker is deliberately interrupted. The fixture's Commusoft switch is
then disabled and its claim expired. Only after checking the retained page,
disabled module and singleton queue does the runner invoke the deployed worker.
That invocation recovers and settles the saved page at attempt two without
acquiring a new permit or creating a successor. Disabled capture prevents a source
request even if source-free recovery fails.

A subsequent jobs traversal reuses the same account while preserving the prior
approval/checkpoint. A simulated lost commit reply still settles successfully
from retained state. Actual signed-in review adapters then create one customer
card, one site and one job from the captured source versions. Three pages, versions,
permits and successful worker jobs remain, with no active work.

Preservation comparisons across 29 tables/metadata sets match, and schema/runtime
contracts are unchanged. The temporary login is banned/password rotated, grant
ended, profile demoted, switches/connector/account disabled and connection revoked.
The fake Vault entry is retained under a retired fixture name, breaking its active
tenant binding. A separate read-only confirmation verifies retirement. Evidence:
`evidence/learn-commusoft-ingestion-test-2026-10-10.json`.

This validates hosted integration with synthetic responses. Real Commusoft API
access, response shapes, contact/work-address support, coverage and operational
readiness still require account-specific acceptance. The next build slice is
operator connection setup; incomplete-import recovery, contacts projection,
reconciliation and source updates remain unfinished.

## Atomic connection configuration — local, 10 October

`20261031170000_learn_commusoft_connection_setup.sql` adds an operator-only
`learn_commusoft_configure` protocol and a private immutable request ledger.
It depends on the existing operator access helper and tenant Vault broker.
The definition contains account identity, region, observed connection revision,
reuse/replace choice, reason and explicit same-account confirmation. A credential
is a separate transient argument, never part of a persisted recovery definition.
Configuration, Vault storage, metadata, audit and receipt commit atomically.

The protocol supports apply/check/cancel. Exact replay checks the retained request;
a supplied replacement key is compared through a private fingerprint. A receipt
check or cancellation must omit credentials. No automatic retry is performed.
Cancellation prevents a delayed apply. A later receipt failure rolls back even
an already-executed Vault update. Existing account/region cannot be changed by
this maintenance action, and active Commusoft jobs block reconfiguration.

Every configuration clears `verified_at` and records `not_verified`; a setup
receipt explicitly says verification is required. It does not enable flags,
reset checkpoints or enqueue work. The application adapter rejects unexpected
secret-bearing definition fields and sanitizes all transport/database errors.

Local tests execute the existing broker SQL against a synthetic Vault stand-in,
including rotation invalidation, rollback and apply/cancel concurrency. They do
not prove hosted encryption or release compatibility. The setup UI, verification
operation and hosted release remain outstanding. Evidence:
`evidence/learn-commusoft-connection-local-2026-10-10.json`.

Commusoft's official authentication guide was rechecked on 10 October: private-app
keys are created by an account administrator under Settings / Private applications
and sent as `x-api-key`. The endpoint-generated Bearer example still conflicts
with that guide; real account verification must resolve it without silently trying
alternate authentication modes. No real key was requested or read in this slice.

## Support handoff — 10 October 2026

Chris confirmed he sent the prepared API-v2 403/access-enablement enquiry to
Commusoft support from his Drummonds email. Codex did not send an in-app support
message. Support's response is pending; do not send a duplicate or retry the same
failed provider request without new evidence. The draft identifies client 19136,
application 49, its two read scopes, the exact bounded properties request and
16:22 UTC failure. No API key or customer record was included in the draft.
