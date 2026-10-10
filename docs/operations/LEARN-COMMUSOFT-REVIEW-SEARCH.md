# Searching retained Commusoft records

## Current state — local candidate, not deployed

The customer and work-review lists now have an explicit search over all retained
records in the selected company, connection and collection. It runs before paging,
so a match beyond the first page remains discoverable. Customers can be found by
source number, name, email, phone or address; sites by number, parent property or
address; jobs by number, property or description; and contacts by number, property,
name, email, phone or position. Searches are case-insensitive literal text, not SQL
wildcards. Phone spacing is literal; this is not an identity-matching normalizer.

Searches are limited to 150 characters and result pages to 20 records in the UI
(50 maximum in SQL). Search terms are submitted explicitly; pagination uses the
applied query, which stays visible while the user types another term. A new search,
connection or record type restarts pagination and clears review selections. Clearing
search returns the retained collection. Empty results never imply complete provider
coverage. The existing source and work readers remain available for earlier clients.

Only latest source observations match. An old customer name or job description
cannot return a superseded version. Work records with equal-time conflicting
versions or no valid observation remain held and unselectable, even when found by
their source number. Matching records still require the existing customer identity
and relationship review before canonical publication. Search makes no identity,
job completion, performance or scoring decision.

## Implementation and authority

Migration `20261101050000_learn_commusoft_review_search.sql` adds two authenticated
read RPCs and one private pure matcher. It reuses the exact current company-owner/
admin, module, connector and verified-connection access checks. Anonymous and
service-role execution of the readers is denied; all three external roles are denied
execution of the matcher. Existing source readers, writers and their grants are
unchanged. Raw payloads, credentials and private metadata are not returned.

Work searches resolve latest observations together in one relational query and
perform relationship lookups only for the bounded matching page. Conflicting
versions at the latest timestamp are counted distinctly rather than arbitrarily
choosing one. In an isolated PostgreSQL 15 run with 10,000 additional synthetic jobs,
a unique match at the end took **172 ms**, compared with **8,452 ms** for the initial
per-record lookup candidate. These are local measurements, not a hosted latency
promise. Existing source indexes suffice for this candidate.

Twenty-one client tests, 47 build prerequisite tests, application TypeScript and the
application build pass. Actual SQL search responses also pass the application
parsers, which require the echoed company, connection, collection, applied query
and valid cursor. Failed or mismatched replies never become a successful empty
search or a silent fallback to unfiltered browsing. SQL checks cover latest versions,
literal special characters, paging, ambiguous/missing observations, role/tenant
boundaries, private helpers, rollback and unchanged source/canonical fingerprints.
The existing review/projection/replay/concurrency regression checks also pass.

## Release boundary

Install both read RPCs in TEST before deploying the matching frontend. This candidate
has not changed the hosted schema or current protected frontend. In particular,
prepared Drummonds continuation `d764008e` still targets its unchanged release-044
preflight and awaits approval. Fresh signed-in visual acceptance is unconfirmed
because the browser connection is unavailable. Production remains unchanged.

[Local evidence](evidence/learn-commusoft-review-search-local-2026-10-10.json).
