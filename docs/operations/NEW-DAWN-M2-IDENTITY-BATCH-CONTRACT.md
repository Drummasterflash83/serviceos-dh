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
