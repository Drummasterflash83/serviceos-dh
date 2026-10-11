# Canonical card search — local candidate

11 October 2026. Customer, job, person and team cards now have explicit search and
clear controls. This candidate is verified locally and backed up on the TEST branch.
**The migration and paired frontend are not deployed. Hosted TEST remains release
050; production and provider connections are unchanged.**

Search covers the company's accessible canonical records, including records beyond
the current browser page. Customer titles, job titles/numbers, member names/roles
and team names are matched as case-insensitive literal substrings. Punctuation,
percent signs, underscores, asterisks and quotes are data, not query syntax. The
selected group filters member/team results, and inactive membership records stay
excluded. Pending/unlinked provider records may not yet have canonical cards; the
empty state explains this and the separate retained-source review remains available.

The additive `learn_card_search` RPC runs as the caller with existing table
permissions and RLS. It grants authenticated execution only and changes no source
table privileges, policies, rows, identity matches or scores. It checks sign-in,
kind, nonempty query up to 120 characters, page bounds and valid group scope. The
query selects 25 matching records and returns at most 24 plus a continuation flag,
ordered by last update and ID. This is current-record paging, not a frozen search
snapshot; concurrent updates can move records between pages. Pages are bounded at
10,000, matching the existing browser's bound.

The client sends explicit RPC parameters and checks the version, company, kind,
query, page, group, row identities and continuation shape. Foreign, stale,
duplicate, oversized and malformed pages reject. Search is submitted deliberately;
editing the input does not relabel existing results. New searches reset the page,
card-type changes clear search/group/selection, and late replies cannot replace a
new scope. A failed search displays an unavailable state; Refresh retries the same
query. Clear restores ordinary browsing. The search is not retained in local storage.

## Verification

- Four focused search tests and ten existing card tests pass.
- `python3 scripts/verify/learn-card-search.py` clones only the existing local schema
  into disposable network-isolated PostgreSQL 17. Actual table columns, policies and
  grants are used; all identities and rows are synthetic.
- Rollback removes the RPC; installation retains table metadata. The function is
  stable and runs as the caller. Anonymous, service, missing identity, foreign-company
  and revoked underlying-table access checks pass; viewer reads keep existing RLS.
- All 10,000 matching jobs are reachable once across bounded pages. Sixty-one tied
  customer records page 24/24/13 without duplicates. Exact job-number lookup beyond
  the first page, active-member/group filters, empty matches, Unicode and literal
  punctuation/injection-shaped strings pass. All source-row fingerprints remain equal.
- Four actual SQL responses pass the application reader, including the final page.
- Application and preview TypeScript checks and builds pass (47 application prebuild
  checks). Browser checks pass beyond-page lookup, 24/24/13 paging, literal wildcard
  characters, job numbers, member roles, group filtering, team search, scope reset,
  stale-reply rejection, failed-search retry and clear-to-browse. No console errors.
- Screenshot: `.verification-results/learn-card-search-2026-10-11.jpg` (synthetic).

## Remaining release work

Prepare the exact hosted TEST release against 050, verify unchanged source/table
access metadata and retained data, rehearse rollback, then install and deploy the
matching protected frontend. Signed-in hosted acceptance remains separate. Search
does not complete provider imports, response/job-outcome scoring adapters, real
company configuration, voicemail or wider LEARN V1 production acceptance.
