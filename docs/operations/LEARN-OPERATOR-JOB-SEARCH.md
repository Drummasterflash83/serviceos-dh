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

Hosted TEST and LIVE installation and signed-in acceptance passed at 05:23 UTC.
TEST demonstrates 25 + 21 result paging, exact job lookup, customer/postcode labels,
leading-zero descriptions, passing the selected job into the existing context reader,
clearing that proposal when the query changes and an explicit empty result. All four
searches have matching real-operator read audits. LIVE finds job 13356 directly and
shows its existing reviewed context; its exact search audit and original source/
review preservation pass. No context decision was saved during search acceptance.

LIVE frontend: `0659046d55abeb8bbddd5ae2b5c174b8fca2ba45` /
`dpl_F34AYUtewmQubgbQCu2LQwqahSNQ`, verified on all four existing aliases.
TEST frontend: `e7fdc2a6518dc17db6b70b823160a2ed50d81e2a` /
`dpl_6WBCBMbVVLyv2ayQfxVPyQB4itQD`, verified on both protected stable aliases.
Prior frontends remain rollback targets: LIVE `5375262` /
`dpl_AuCREnJ5GQNVN8YodUAYhNsnvqcB`; TEST `778f7ad` /
`dpl_DpvxmPfubUNPbTbUnpHgasNwD5BP`. Each candidate changes only three frontend files
on its own previously accepted baseline; TEST-only functionality remains separate.
Both rendered authentication targets and deployment protection settings pass.

Backend installation preserves 899 LIVE jobs and 18,079 business-source versions,
and 69 TEST jobs and 18,016 source versions. Effective-access helper and existing
profile/grant fingerprints remain unchanged. Exact new function body, owner, ACL,
security-definer setting and fixed search path pass hosted readback.

[Hosted acceptance evidence](evidence/learn-operator-job-search-live-2026-10-14.json).

[Exact source and rehearsal evidence](../../supabase/release/learn-operator-job-search/manifest.json).

## Rollback

Keep the prior frontend deployment. Restore it before removing the new RPC so active
review pages retain a working job picker. Only the new search function needs removal;
verify its body hash and owner/grants against the release manifest first. Do not drop
jobs, saved context reviews, source records, permissions or audit history. The prior
paginated information RPC remains intact throughout.
