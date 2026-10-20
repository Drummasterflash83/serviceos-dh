# New Dawn M2 staged Commusoft identity batch

This contract governs one operator-authorised, tenant-scoped projection of
retained Commusoft customers, properties and jobs into ServiceOS. Installing
the schema does not start a batch, contact Commusoft or expose a client login.

## Authority and scope

- A batch is registered by an authenticated OpenFolk operator with a reason,
  tenant, connection, SHA-256 of a canonical manifest and bounded item counts.
  Registration does not create canonical business rows. The worker uses the
  service role, but cannot choose a different approving actor or manifest.
- The worker may apply only registered exact customer, site and job IDs and
  source-version IDs. It checks the active tenant, configured connection,
  connector, LEARN flags and a separate `new_dawn.m2_staged_batch_apply` flag
  before and during each transaction. The older exact-apply flag stays off.
- The manifest and its private ID list remain in restricted storage. The
  public repository contains code and synthetic fixtures only.

## Exact identity rules

- The customer is selected by the current Commusoft customer property ID.
  A work-address property's parent customer ID identifies its customer;
  the work-address property ID identifies its site. A customer-type property
  can identify both its customer and own site, so its site uses a separate
  private mapping. The canonical source-link table allows only one link per
  property external ID and must not be made ambiguous.
- Classification as a person or company needs a reviewed tenant-specific
  category mapping plus current source fields. Names and postcodes are
  collision guards, never substitutes for source IDs. Missing, duplicate,
  conflicting, stale or ambiguous source/target identities remain in review.
- New person/customer groups are explicitly held as
  `account_holder_review_required`. The canonical person writer requires
  separately reviewed account-holder identity that this batch cannot infer
  from a category ID or contact name. The staged automatic apply therefore
  projects only clean company groups.
- Every customer, site and job projection records its exact current source
  version, rule version, batch ID and operator approval. The job's customer
  and site IDs are checked independently. No job/service code is used as an
  identity key.
- Each group is applied atomically in customer, site, then job order. The
  provider connection and canonical identity tables are locked briefly, then
  source, existing links and collisions are checked again under the lock.
  A changed group is held without guessing or partially applying it.

## Reversal and evidence

- Original source versions and canonical rows are retained. Immutable events
  hide reversed mappings from current readers. Reversal runs in dependency
  order: jobs, sites, then customer. A reversed group cannot be silently
  restored; new projection requires a separately reviewed recovery release.
  Reversal verifies the original staged link and its dependent current links;
  it does not require the source to remain the latest provider observation,
  because withdrawing a link must remain possible after source refresh.
- The client-facing source-backed job home and paged job identity read current
  links. The generic card search now hides reversed staged jobs and customer
  cards for the authorised tenant, while retaining unrelated search results.
  Older operator-only raw-canonical previews may still show retained rows;
  those are historical records, not active links.
- Every apply, hold and reverse has an audit record with approver,
  executor, manifest digest, rule and source versions. A retry with the same
  batch/item is idempotent; it never creates another customer, site or job.
- No rollout claim is made from a dry run. Before LIVE activation, publish
  aggregate dry-run classes privately, spot-check ten proposed links against
  current Commusoft detail, prove one complete reversal in isolation, and
  measure the linked-count delta after application. Provider taxonomy access
  or a separately reviewed category mapping is required before creating a
  person or company.
- The aggregate batch summary reports prepared, linked, held and reversed
  customer/site/job counts, plus held reasons and jobs affected. It exposes
  no customer, property or job IDs to the client.

## Private full-roster dry run

With the saved noninteractive Supabase CLI login, use the read-only Management
API exporter `scripts/verify/new-dawn-m2-identity-export.mjs` with `--project`,
`--tenant`, `--connection auto` (only when exactly one configured Commusoft
connection exists; otherwise use its exact UUID), and `--out` under the ignored
`.verification-results/` folder. The exporter pages every saved job and
property at a pinned committed-page cutoff. It includes every latest-version
tie, so ambiguity cannot be hidden by ordering. It then pages canonical
collision fields and all current and retained links. Source, canonical and
link fingerprints must agree before and after; a drifted or incomplete export
is discarded. The JSONL snapshot is mode 0600 and never belongs in Git.

Prepare a separately reviewed category-map JSON file in the same private
folder: `{ "kind_map": { "<Commusoft category ID>": "company" },
"kind_evidence_sha256": "<64-digit evidence SHA>",
"status": "reviewed_for_registration" }`. Only category IDs with reviewed
provider evidence may appear. A 13 October historical map must instead use
`"status": "provisional_not_apply_authorized"`; it yields aggregate counts
and private ten-link spot-check candidates, never registrable manifests. Then run
`scripts/verify/new-dawn-m2-identity-manifest.mjs` with `--snapshot`,
`--kind-map`, `--out` (a new private directory), `--tenant`, and `--connection`.
It emits mode-0600 exact-version manifests and an aggregate report only; it
does not register or apply anything. `source_job_count` reconciles disjointly
as `already_linked_jobs + clean.jobs + held.jobs`. Current links are counted
as already linked; reversed retained links are held for manual review. Clean
groups are compared against every saved source customer/site, including
unproposed groups, and canonical collisions. Person/account-holder, missing,
conflicting and ambiguous classes stay held. This dry run is provisional until
ten provider spot-checks and the LIVE apply-time guard pass. The bounded
`scripts/verify/new-dawn-m2-identity-ten-spotcheck.mjs` reads those ten jobs
and their properties/customer parents under the existing shared Commusoft
verification lease. Its mode-0600 receipt contains hashes and booleans, not
IDs or provider payloads.

The 20 October Drummonds private full-roster snapshot reconciled all saved
jobs into disjoint already-linked, clean company candidate and held classes.
The retained 13 October authenticated Commusoft customer-page numeric labels and creation
routes map categories 2–9 to company types. Ten current exact provider checks
covered categories 2/4/5/9, and four bounded addendum checks covered 3/6/7/8;
all 14 matched their saved job, property and customer identities and company
fields. This evidence supports a reviewed 2–9 company map for this exact
snapshot. Person and all other categories stay held. Private aggregate counts,
the exact manifest and its hashes are outside Git in ignored
mode-0600 storage. Registration and application require separate receipts.

After the schema is installed with the separate exact five-migration release
check, OpenFolk → Drummonds → Client information → source review → Reviewed
batch offers a registration-only action. It requires the signed-in operator's
five-minute review session, the reviewed local manifest and map, a matching
file SHA-256 and an explicit confirmation. It shows only aggregate counts and
the hash, and calls the existing authenticated operator RPC; it does not turn
on the apply flag. The server still enforces operator authority and validates
every exact source version. An ordinary client cannot open this operator route.
The separate `new_dawn.m2_staged_batch_apply` flag remains OFF outside the
bounded release runner. The release owner must record the exact LIVE
apply/readback and reversal evidence separately. For the first reviewed
batch, a narrow service-role authority repair is required because its genuine
OpenFolk operator approver is not a Drummonds owner/admin. That repair is
restricted to the exact registered batch and its expiry; it must never change
the approver's client role or impersonate staff.
