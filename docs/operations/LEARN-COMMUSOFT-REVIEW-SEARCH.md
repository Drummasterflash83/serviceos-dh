# Searching retained Commusoft records

## 13 October — generic-plan failure fixed in TEST

Repeated signed-in work searches exposed a plan-cache regression not covered by the
original one-call local benchmark. Three database cancellations occurred during the
retained-job review. A SELECT-only benchmark on the real TEST inventory reproduced
a 20-second timeout with a generic plan; that plan repeatedly scanned a materialized
latest-version result through a nested loop.

Migration `20261101640000_learn_commusoft_review_planning.sql` sets
`plan_cache_mode=force_custom_plan` on the work-search function only. Planning now
uses the actual company, collection, cursor and search term on each call. This adds
planning work per request, avoiding reuse of the demonstrated unsuitable generic
plan. It does not raise the statement timeout, relax access or change search semantics.

The full-schema TEST rollback rehearsal preserved all 238 tables and restored the
function catalog. Four actual search cases matched their old results; eight candidate
reads under a generic-plan caller took 539–1008 ms. Installation preserved the same
tables, the function body, owner and grants, and every unrelated function. Twelve
signed-in browser searches completed in 1138–3185 ms with no errors. Cold-cache,
larger-volume and sustained-concurrency performance are not established by this run.

The existing isolated regression driver now installs and rolls back the planning
change, checks unchanged body/permissions, and runs repeated selective/broad searches
after loading 10,000 synthetic jobs:

```sh
python3 scripts/verify/learn-commusoft-permits.py --review-search
```

The new repeated-call assertion also verifies pagination and that the function's
setting does not escape into its caller. Existing search, ambiguity, authority,
preservation and concurrency checks still pass. TEST capture is Off again; no
provider requests or production changes occurred. The production package and
release bindings still need this migration before promotion.

[Acceptance evidence](evidence/learn-review-planning-2026-10-13.json).

## Behaviour — installed in TEST release 045

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

## Retained-record search — TEST release 045 installed at 21:44 UTC

Server-side customer/site/job/contact search is installed in TEST and the matching
[protected frontend](https://serviceos-learn-test-pmmtsr47h-allkin.vercel.app) is READY
from Git commit `899afbaa5b126be027bdd0cdf7752add6996616f`. The hosted rollback
rehearsal matched the installed schema; all 78 monitored datasets are unchanged.
The original review functions, authority definitions, owners and grants are identical.
Six real HTTP checks confirm anonymous/service-role denial, and all three frontend
routes remain protected by Vercel. Positive owner behaviour and SQL-to-client search
parsing pass locally; fresh signed-in hosted owner and visual acceptance remain
unverified. A successful deployment does not establish those checks.

Prepared import continuation `d764008e` still awaits approval, with zero requests
and zero new grants. Its exact schema check now recognises the installed read-only
search release; its identity, tenant, duration, budgets, encrypted key and original
preservation baseline are unchanged. All 28 continuation/boundary checks pass.
No provider requests, capture activation or production changes occurred.
[Release evidence](evidence/learn-review-search-test-2026-10-10.json).

The earlier [local evidence](evidence/learn-commusoft-review-search-local-2026-10-10.json)
retains the implementation and benchmark record.
