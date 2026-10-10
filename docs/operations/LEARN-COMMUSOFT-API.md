# Commusoft read-only API adapter

## Current state — 10 October 2026

Local source reader, provider-neutral source-record adapter and durable scope
binding are implemented. Twenty-eight synthetic tests and strict standalone
TypeScript checks pass. This is not
an installed connector: no provider request, API credential read, sync job,
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
deferral acknowledgement. That database port is **not implemented yet**: there
is no fallback to general secret lookup, registered handler, enqueue action or
automatic provider activity. Tests inject synthetic permits and HTTP responses.

The SQL implementation must repeat these checks under locks. Current metadata
reads are not a transaction; they cannot alone authorize a source/checkpoint write.
Binding tests cover suspension, missing/disabled flags, stale or expired leases,
wrong tenants/accounts, revoked/unverified credentials, changed connection
revisions/approvals/cursors, terminal windows, waiting permits and failed deferrals.

## Still required before enabling Drummonds

1. Verify subscription/private-app access, reuse or securely bind an authorized
   credential, and verify account/region/authentication with a bounded real read.
2. Implement the atomic credential/permit port for the stored scope and worker
   binding; revalidate authority transactionally when committing source data.
3. Persist raw revisions, canonical mappings and checkpoints atomically; reserve
   quota across all workers using the same credential. The transport alone does
   not enforce the per-key shared quota.
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
node --test supabase/functions/_shared/commusoft/*.test.ts
npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --lib ES2022,DOM supabase/functions/_shared/commusoft/*.ts supabase/functions/_shared/business_inputs/source_record.ts
```

These tests cover transport/adapter contracts with synthetic HTTP responses. They
do not establish Drummonds account access, deployed storage or live functionality.
