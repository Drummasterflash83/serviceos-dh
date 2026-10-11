# Ownership evidence at the requested time

The ownership resolver previously selected the first matching endpoint, accepted
proposed/conflicted assignments and could use a handoff later than a historical
lookup. Its store also read capped responses and swallowed query failures.
These behaviours could attribute a communication to an unsupported owner/handler.

Endpoint matching now keeps channel and provider scope at every match step. Opaque
provider references are case-sensitive. Ambiguous endpoints return an unresolved
answer. Only confirmed, effective assignments can supply roles; overlapping
confirmed rows for a role do not produce an arbitrary owner/version. The health
summary and queue also flag overlapping accountable ownership. The requested-name
hint still cannot override governed ownership.

A historical lookup respects recorded endpoint/assignment intervals. An inactive
endpoint is usable historically only when its ending is recorded; an inactive
endpoint with no recorded end does not prove earlier availability. Handoffs must
be observed/confirmed and timestamped no later than the requested time. Equally
recent conflicting targets, mixed subject types and unsupported parties remain
unresolved. A subject type can be supplied with the subject reference to disambiguate
identically named interactions/commitments. Handoffs affect only the likely handler,
never accountability or its assignment-version reference. Person/team targets are
checked against the same tenant; person membership must also be effective at the
requested time. Failed target reads fail the request rather than imply a valid link.

The store uses checked stable-ID pages for company/channel endpoints, the matched
endpoint's effective assignments and the requested subject's handoffs. Exact
counts before/after, tenant/ID checks, empty terminal pages and existing per-table
budgets apply. No large `IN` list or successful partial inventory is used. This is
read-only and does not create ownership, identity, handoff or score records.

## Verification

- Ten ownership tests cover channel/provider scope, ambiguous endpoints/roles,
  historical boundaries, future/undated handoffs, conflicting targets, subject
  collisions, foreign/inactive targets, failed reads and lower server caps.
- Eight health, eleven roster/authorization/route/store and eight identity tests
  pass alongside them (37 total). The route test verifies historical time and
  explicit subject type reach the resolver without writes.
- Twelve existing pure resolver verification cases pass. Direct TypeScript checks
  of the ownership and health modules pass. Eight deployment-guard tests pass.
- Actual isolated PostgREST v14.5 with the installed PostgrestClient reads 2,503
  endpoints and 2,503 relevant handoffs under a 137-row server cap. In 49 requests,
  including six exact-count HEADs and three empty terminal pages, it preserves the
  accountable person/version and verifies the final dynamic handler in the tenant.
  Future, foreign and other-subject evidence is excluded. Synthetic fingerprints
  remain unchanged. Synthetic table shapes do not prove hosted schema/auth acceptance.

Reproduce with `node --test scripts/learn-ownership-evidence.test.mjs`,
`node supabase/functions/_shared/controlplane/resolver.verify.ts` and
`python3 scripts/verify/learn-ownership-evidence-http.py`. The Docker verifier uses
cached images, no host mounts/published ports and no external network or customer data.

## Release and limits

Reviewed controller closure: 21 files,
`55530404e70a3eaf74a12587155d02ebf93f7fce05b3c3ee31283b38db8b3304`.
The TEST runner requires controller v4 and the existing catalog, records all 101
preservation fingerprints before one submission and checks them afterward.
Deployment evidence is recorded separately. Frontend contracts are compatible;
`subject_type` is an optional addition to the existing resolve request.

These reads are not a transactionally frozen history. Same-count concurrent edits
and metadata fields changed in place cannot reconstruct every historical state.
Endpoints without a recorded ending and handoffs without timestamps are not inferred.
Team membership history and free-text role targets are not new temporal guarantees.
Per-table budgets remain 20,000 rows, 8 MiB and 100 requests. Connection/discovery
history, phone-readiness checks and cross-client listing retain separate limitations.
Positive signed-in hosted acceptance and actual card-evidence attribution remain
required. No provider capture, access grant or production promotion is included.
