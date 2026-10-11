# Operator roster pagination

The operator roster previously required each entire people/responsibility/grant
inventory to fit one response and rejected counts above 2,000. The reader now
uses stable-ID keyset pages of at most 500 rows. Exact counts before and after
must match the retained row count. Each row must belong to the requested company
and have a valid, strictly increasing UUID. Only an empty page proves exhaustion,
so a server's smaller row cap does not silently truncate the directory.

Open/scheduled responsibilities and grants share one fixed observation-time
filter across the run. Names/labels are sorted after collection. Workspace people
counts now come from the verified member inventory rather than a separately
capped member query. Existing callers still receive the full bounded inventory,
preserving cover-person selection, previews and person-hub lookups.

The roster screen searches names, titles and target roles, filters active/former/all
members and renders 24 people per page. Filters reset paging; a smaller refreshed
result clamps the visible page. The existing reason-required mutation actions,
operator authority and audit writers are unchanged. Former-member details remain
readable with an explicit ended label.

## Verification

- Ten endpoint/roster checks and 23 navigation checks pass, including 2,503 people,
  responsibilities and grants with a lower simulated server limit, foreign rows,
  truncated/duplicate/out-of-order data, changed counts and request/byte budgets.
- Actual isolated PostgREST v14.5 with a 137-row cap returns all three 2,503-row
  inventories through the installed PostgrestClient and real roster reader:
  66 HTTP requests, six exact-count HEADs and three empty terminal pages. Synthetic
  source fingerprints remain unchanged. This uses synthetic table shapes and an
  isolated read role, not hosted schema or signed-in operator acceptance.
- Browser fixture: 2,500 active and three former people. Verified 24 rendered cards,
  next-page navigation, search for member 2,499, a reason-required synthetic title
  edit, former-member filtering, literal role search, clear and no-match states.
  Zero console errors. Existing UI/API authority tests remain passing.
- Application/preview TypeScript and builds pass, including 47 prebuild checks.
  Two initial-deploy and three replacement-deploy guard tests pass.

## Release and limits

The current reviewed 17-file runtime closure is
`de14f293d049b87020494d10c0ee48bab9bbb4a2938fe297806d6b402b1d9a58`.
The new TEST replacement runner requires operator endpoint v1, runtime catalog
`b17378ba1c6cc511f6a35b63bb22e9be` and release-051 catalog
`3edc2be235c00489aa86aa396fd88878`. It journals all 101 preservation fingerprints
before submitting once and rechecks catalog/data/other endpoints afterward.
The replacement completed on 11 October at 02:49 UTC: operator endpoint v2 is
ACTIVE, with all 101 monitored datasets, schema and other endpoints preserved.
Eight hosted HTTP boundary checks passed at 02:50 UTC. The paired protected
[TEST frontend](https://serviceos-learn-test-j27tmt2pc-allkin.vercel.app) is READY
from Git `27113d072fa88a7b15e8054f2acf7e36cdc1bfbd` at 02:51 UTC. Anonymous
Vercel protection and browser same-origin operator sign-in redirect pass, with
zero console errors. Positive signed-in hosted roster read/write acceptance
remains outstanding. No new grants, provider requests or production changes
occurred. See [local evidence](evidence/learn-roster-pagination-local-2026-10-11.json)
and [TEST deployment evidence](evidence/learn-roster-pagination-test-2026-10-11.json).

The inventory remains bounded: 20,000 rows, 8 MiB serialized row data and 100
requests per table. Exceeding a limit or any incomplete read fails explicitly;
it never returns a partial directory as complete. Concurrent same-count changes
can still occur across these reads: this is not a transactional snapshot or a
historical membership proof. The subsequent [operator health increment](LEARN-OPERATOR-HEALTH.md) extends checked
paging to identity/endpoint/ownership inventories and corrects their quality
metrics. The [identity inventory increment](LEARN-IDENTITY-INVENTORY.md) checks
suggestion reads. Connection evidence, ownership resolution and history still
have separate limits; these increments do not claim whole-workspace scalability.

Reproduce with `node --test scripts/learn-roster-recovery.test.mjs`,
`python3 scripts/verify/learn-roster-pagination-http.py`, and the local
`/roster-review?volume=1` browser fixture. The Docker verifier uses cached images,
no host mounts or published ports, and no external network/customer records.
