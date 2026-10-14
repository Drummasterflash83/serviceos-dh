# Operator job search

The Slack context reviewer currently pages through all published jobs. This release
adds a bounded server search by job number, title/description, customer, address or
postcode. Results show the customer and location alongside the job to support an
explicit review. A service code shared by several jobs is not a unique job identity.
Commusoft codes remain strings, including leading zeros. No QuickBooks mappings
are inferred, and no search result creates a job link automatically.

The new `learn_operator_job_search` RPC uses the same effective OpenFolk admin
access check as existing content reads, before and after its query. Explicit tenant
selection scopes all job/customer/site joins. Each successful page records the real
actor, selected tenant, returned IDs, cursor, reason and query hash; audit failure
prevents the result. Queries are literal substrings, never SQL/filter expressions.
Pages contain at most 25 results with a deterministic UUID cursor. Search text is
limited to 120 characters and job number formatting is unchanged.

The frontend clears the selected job and inspected context when search text changes.
It rejects stale, unaudited, wrong-actor, wrong-tenant, wrong-query and invalid cursor
responses. Retained imports needing publication remain explicitly distinguished
from searchable published jobs. Existing saved review recovery is unchanged.

## Verification and release status

Local client contract and Slack review tests pass (10 tests); the frontend builds.
An isolated complete production-schema restore passes real SQL search, leading-zero
codes, pagination, literal wildcard text, tenant isolation, view-only denial,
revocation, View-As denial, mandatory auditing and function rollback/reapply.
All 1,591,601 archived rows in 387 tables and seven sequences are preserved, including
fixture rollback. The first rehearsal fixture attempted a cross-tenant relationship
and was correctly rejected by the existing foundation guard; the fixture was fixed.
No hosted data, user grant or provider was changed by these rehearsals.

Hosted TEST/LIVE installation and signed-in acceptance are pending. Do not describe
this search as available live until that acceptance is recorded.

[Exact source and rehearsal evidence](../../supabase/release/learn-operator-job-search/manifest.json).

## Rollback

Keep the prior frontend deployment. Restore it before removing the new RPC so active
review pages retain a working job picker. Only the new search function needs removal;
verify its body hash and owner/grants against the release manifest first. Do not drop
jobs, saved context reviews, source records, permissions or audit history. The prior
paginated information RPC remains intact throughout.
