# Reviewed QuickBooks customer search and combined LIVE cards

14 October 2026. Chris requested continued capture, reviewed links to ServiceOS
customer cards and ongoing automatic refresh. The bounded continuation is
approved separately; this reader performs no provider calls or source projection.

## Released

The new search reader is installed and read back in TEST and LIVE. It uses the
existing logged OpenFolk operator authority, tenant/environment boundaries and
retained finance access helper. Searches are literal, limited to 200 characters,
return at most 25 records and paginate by retained version ID. Anonymous and
service-role execution are denied. Existing function bodies/ACLs/owners were
verified unchanged. No links or source rows are created by searching.

The isolated LIVE UI release adds a searchable review control inside the existing
customer-card finance view, retaining the live design. SHA
`5cdea6d025090d0534aaa2682e93c5332d567ca0`, deployment
`dpl_Fa7pbJa1YzYTj1HFBfoZzCPTLESc`. All four LIVE aliases were promoted after the
build and required prebuild checks passed. Protection remains
`all_except_custom_domains`; rollback deployment is
`dpl_BtQPXQYCacqVyzmHL311J5F3Pw9E` / `e81575a0`.

## Live acceptance

Existing Chris operator session reached the new control on the stable LIVE domain.
A search by provider customer reference returned one retained identity. After
review of a unique name/postcode/email/phone match to an existing Commusoft card,
the ordinary revision-checked link control saved it and loaded four financial
records, including invoice, payments and estimate. The same card's business reader
showed two published Commusoft jobs. A second unique name/postcode/email match
was reviewed and linked through those controls. This proves the combined-card
workflow for reviewed examples; it does not establish complete customer matching.

No job-code mapping was inferred, customer identity was not overwritten, and
original source/customer/job references remain intact. Missing/contradictory
identity evidence still needs review. Subcustomers need their own reviewed links.
Finance continues to describe retained, unreconciled records and separates currency
totals. Expired browser views clear financial information and require refresh.

## Validation

- Real isolated PostgreSQL verifier passed search filters, literal wildcard
  handling, cursor pagination, tenant/environment/operator restrictions and
  preservation of link count/revisions, alongside the existing finance checks.
- Typecheck and isolated release build passed.
- TEST and LIVE release scripts read back the exact body, definer/search-path
  configuration and existing permissions.
- Signed-in live search, saved link and combined reader acceptance passed.

The approval for deploying the existing LIVE UX is recorded in AGENTS.md; no new
user or operator access was granted by this release. Roll back the frontend alias
if needed; the additive reader can remain installed, or be removed after reverting
all callers. Do not undo the unrelated retained-finance or source-history repairs.
