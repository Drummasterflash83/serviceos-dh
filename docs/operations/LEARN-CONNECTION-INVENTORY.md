# Connection inventory and operational truth

The legacy operator connection view could turn retained mailbox rows into a live
Google connection and match `configured` inside `not configured` credential text.
The backend supplied a Drummonds account/provider label even when no Phone
connection existed. It selected the first provider, swallowed query errors and
capped histories across all providers, allowing unrelated events to displace the
last evidence for the selected provider.

The connection reader now collects five checked, complete company inventories:
Google domain connections, provider connections, Google mailboxes, Phone inventory
and tenant-approved email-domain settings. Missing domain configuration defaults
to no eligible mailboxes; ambiguous or failed configuration reads fail explicitly.
No default provider, account or credential is invented. Each registered Phone
provider is returned separately; the frontend gives each its own card, inventory
count and lifecycle. Multiple Google domains retain individual domain/status rows;
provider-wide history is not attributed to an arbitrary domain connection.

Provider-scoped latest queries find recent events, successful/failed discovery,
latest sync and successful/failed sync without scanning a globally capped list.
Completed-run history is ordered by completion time. Connection tests and OAuth
runs are excluded from sync counts. A sync is not relabelled as discovery. Only
metadata is projected: Vault references and diagnostic payloads never leave the
reader. Query errors cannot become empty healthy records.

The frontend uses explicit connection states and verification evidence. Retained
inventory, `manual` status and credential wording do not establish connectivity.
Revocation and failed tests override older verification. A configured Phone
connection requires stored credentials and verification before being treated as
connected. Even a connected/tested input has unknown capture health unless a
separate operational check establishes it; this view never invents that check.
Latest sync/discovery failures are shown with recovery guidance. The Slack note
points operators to LEARN Inputs instead of claiming ingestion is absent.

## Verification

- Eight reader and twelve projection tests cover missing/default connections,
  revoked/disabled status, provider separation, secret-reference omission, lower
  server caps, domain scope, failed reads and chronological evidence selection.
- Together with ownership, roster, identity, readiness, health and deployment
  guards, 74 targeted tests pass. Application/module TypeScript checks and the
  full build pass, including 47 prebuild checks; existing bundler warnings remain.
- Actual isolated PostgREST v14.5 and the installed client read 2,503 mailboxes
  and 2,503 Phone inventory rows under a 137-row cap. The selected provider's old
  discovery evidence survives 2,503 newer unrelated events. In 69 read requests,
  including ten exact-count HEADs and five terminal empty pages, foreign rows
  are excluded, latest completion is correctly selected and source fingerprints
  are unchanged. This does not prove hosted schema or signed-in operator acceptance.

Reproduce with `node --test scripts/learn-connection-inventory.test.mjs
src/lib/openfolk-connections.test.ts` and
`python3 scripts/verify/learn-connection-inventory-http.py`.
The Docker check uses cached images, synthetic records, no external network,
no published ports and no host mounts.

## Release and limits

Reviewed runtime: 23 files,
`0d89476a209b70795edadaccdc8f43749e24f3dda29530fb902421b5b03d0d89`.
TEST controller v7 is ACTIVE from Git `5369311a98dfb071d53d4527f07d149f4b5ef556`
at 03:55 UTC on 11 October. The replacement required controller v6 and the installed
catalogs. All 101 monitored datasets, schema and other endpoints were preserved;
26 hosted access-boundary checks passed. No new grants, provider requests, source
writes or production changes occurred.

The paired protected [TEST frontend](https://serviceos-learn-test-2nm718p5o-allkin.vercel.app)
is READY from the same commit at 03:55 UTC. It was deployed before the backend.
Anonymous deployment protection, same-origin operator sign-in redirect and
synthetic connection-card details pass, with zero browser console errors. The
manual Phone fixture shows setup required, never verified and external read disabled;
retained evidence remains visible, with distinct sync/discovery fields.
See [local evidence](evidence/learn-connection-inventory-local-2026-10-11.json) and
[TEST evidence](evidence/learn-connection-inventory-test-2026-10-11.json).

Inventory bounds remain 20,000 rows, 8 MiB and 100 requests per table. Latest queries
are intentional single-row, provider-scoped reads with deterministic timestamp/ID
ordering, not truncated inventories. Reads are not transactionally frozen.
Multiple Google domain histories cannot be individually attributed because legacy
sync rows lack a domain connection ID. The legacy connection view does not verify
LEARN connector schedules/capture. [Discovery-history pagination and its panel](LEARN-DISCOVERY-HISTORY.md)
were subsequently deployed with controller v8 and frontend v22. Signed-in hosted
acceptance, live provider tests and recovery remain separate work.
