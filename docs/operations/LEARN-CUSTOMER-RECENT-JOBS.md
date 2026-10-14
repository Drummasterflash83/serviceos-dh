# Recent work on customer cards

The former customer business reader pages by internal UUID. On a customer with
585 published jobs this mixes old and new work on the first screen. The additive
`learn_customer_jobs_recent` reader orders published jobs by recorded creation
instant, newest first; UUID breaks ties and undated jobs appear last. It preserves
Commusoft job numbers/descriptions exactly, including historical descriptions and
leading zeros. It does not infer service-code mappings or completion times.

The cursor is still an ID, resolved only within the selected customer's authorised
jobs. Foreign/unrelated/missing cursors fail rather than change scope. A bounded
page contains 25 rows and a 26th-row continuation check. Same-time and undated
records traverse without duplicates. This is a current read, not a frozen export:
a corrected creation date or relationship between pages can change its ordering.
Refresh the first page when reviewing a changed customer.

Existing client authority, explicit logged operator selection, audit failure,
revocation, field limits and effective published-source references are retained.
The original reader remains unchanged for sites, contacts and older frontends.
No jobs, contacts, capture settings, credentials or provider records are edited.

Fourteen focused tests, TypeScript and the Vercel-targeted local build pass. The
native-schema rehearsal preserves 1,591,601 archived rows and verifies existing and
new journeys. Hosted TEST separately confirms the actual effective-source reader,
chronological pagination and access checks, rolling back all synthetic fixtures.
The new backend reader and isolated Git frontends are now installed in TEST and
LIVE. All four LIVE aliases and both protected TEST aliases are verified. Signed-in
LIVE acceptance traversed two chronological 25-job pages without duplicates,
refreshed to the newest page, opened its job and returned to the customer. Recorded
completion, original descriptions and timezone limitations remain visible. This
verifies the published linked subset, not complete provider inventory. TEST sign-in,
build identity/backend binding and hosted database journeys pass; its real customer
pagination was not separately clicked.

LIVE frontend: `d33cfe56b0804fc3c69c12030474661d4ca9f344` /
`dpl_o6r8arDgsx9D1nJjwiuouasa3LBR`. TEST frontend:
`97d78f697e5597ac9c243859e9dc7c0bad277afb` /
`dpl_264tnwefoJ9A5ULFzgj1z56ePiQC`. Existing deployment protection is unchanged.
Post-release reads confirm the original backend reader and access remain unchanged,
and every source identity from the installation baseline is retained.

Reproduce with `node --test src/lib/learn-customer-business-context.test.ts
src/lib/learn-card-job-brief.test.ts` and
`python3 scripts/backup/rehearse_customer_jobs_recent.py --output
.verification-results/customer-jobs-fresh` (each command on one line). The retained
native archive and pinned Docker image are required; no hosted state changes.

Rollback first restores the preceding frontend, then optionally removes only the
new reader using `supabase/release/learn-customer-jobs-recent/rollback.sql` with its
pinned project/source settings. Existing readers and all customer records remain.
The SQL reversal is prepared, not yet executed in production. Private staging and
verification artifacts are under `/private/tmp/serviceos-recent-jobs-20261014/`.

[Release evidence](evidence/learn-customer-recent-jobs-2026-10-14.json).
