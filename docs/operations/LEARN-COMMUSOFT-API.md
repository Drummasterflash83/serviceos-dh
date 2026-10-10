# Commusoft read-only API adapter

## Current state — 10 October 2026

Local source reader, provider-neutral source-record adapter, durable scope binding
and atomic credential/pacing/source-publication functions, dedicated worker and
transactional settlement and reviewed customer/card projection are implemented locally. Fifty Commusoft tests and three shared
HTTP-guard tests, strict standalone TypeScript checks and isolated PostgreSQL assertions pass.
This is not an installed connector: no provider request, real API credential read, live sync job,
production migration or frontend release was performed for this increment.

The metadata-only discovery earlier today found no configured Drummonds Commusoft
connection or Commusoft-named project secret. Checked local environment variable
names also yielded no Commusoft entry. This does not establish whether Drummonds'
Commusoft subscription has private-application API access enabled.

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
  people associated with properties; suppliers also exist. The reader requires an
  explicit customer/workaddress contact filter. The exported `type` schema is an
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
The implementation follows the explicit private-app guide. Live validation must
resolve this; do not automatically retry alternate authentication modes or hosts.
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
existing candidates. There is no review screen or automatic bulk type mapping yet.
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

## Still required before enabling Drummonds

1. Verify subscription/private-app access, reuse or securely bind an authorized
   credential, and verify account/region/authentication with a bounded real read.
2. Package and verify all four migrations and the worker against the installed
   TEST schema, including its existing feature flags and queue functions.
3. Add authorized connection/approval setup and operator progress/recovery controls;
   wire customer review/duplicate discovery, and project contacts, sites and jobs.
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
npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --lib ES2022,DOM supabase/functions/_shared/commusoft/*.ts supabase/functions/_shared/business_inputs/source_record.ts
python3 scripts/verify/learn-commusoft-permits.py
python3 scripts/verify/learn-commusoft-permits.py --pages
python3 scripts/verify/learn-commusoft-permits.py --worker
python3 scripts/verify/learn-commusoft-permits.py --customers
```

These tests cover transport/adapter contracts with synthetic HTTP responses. They
do not establish Drummonds account access, deployed storage or live functionality.
