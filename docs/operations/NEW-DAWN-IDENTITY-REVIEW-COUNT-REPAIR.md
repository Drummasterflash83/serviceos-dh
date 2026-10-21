# Identity review count: bounded LIVE repair candidate

The 21 October platform-worker v114 diagnostic stopped at `identity_read_failed`,
stage `review_count`, SQLSTATE `57014`, with the identity job exhausted at 5/5.
The installed `public.learn_identity_review_count(uuid)` hash is
`fcf76cac657c2245b432cd1199dd48e6` (MD5 of `pg_get_functiondef`). Its
`LEFT JOIN` fetches retained Email rows for the full review queue merely to
exclude Gmail drafts. The LIVE queue has 105,367 `identity_review` interactions.

The candidate counts all review interactions, then subtracts only those whose
source is a retained Gmail draft. The source relationship is unique by
`(tenant_id, source_table, source_id)`, and Email `id` is a primary key, so each
excluded draft contributes exactly once. Missing source rows, non-Gmail mail,
Slack, Phone, other statuses, and other tenants retain their old treatment.
The final subtraction is cast to `integer` only after both `bigint` counts,
matching the old function's overflow behavior.

Release comprises **two exact files**, in order:

1. `20261112193000_new_dawn_identity_review_gmail_draft_index.sql` — SHA-256
   `98823b2aca835b6c828f298389ca3d5865caf95059ddc3f0ed9cad42a7c2caaa`.
   Its single `CREATE INDEX CONCURRENTLY` statement **must run outside an
   explicit transaction**. It indexes only tenant/id for Gmail draft rows,
   keeps Email intake writable, and does not modify retained messages.
2. `20261112193100_new_dawn_identity_review_count_indexed.sql` — SHA-256
   `a48b888c2fb1eaaac59f29c2aabdb489f005dce534bcac9aceb378a59a82dcf7`.
   The transaction checks the exact old function hash and valid exact index
   before replacing the function. `CREATE OR REPLACE` retains the established
   service-role-only grant.

`node scripts/verify/new-dawn-identity-review-count-readback.mjs --live-read-only`
checks exact source bytes, the function hash, grants, index validity and
definition, migration ledger and aggregate review count. It emits no private
interaction content. Run it before release, after index build, and after
function replacement. The candidate **has not been installed on LIVE**.
If the concurrent index build fails, inspect `pg_index.indisvalid`; do not
replace the function or automatically retry the build. Any cleanup of an
invalid index is a separate reviewed change.

Disposable PostgreSQL 17 rehearsal used 180,000 mixed interactions and
119,431 retained Email rows, including missing Email sources, non-Gmail
`DRAFT` labels, other tenants and other statuses. Old and new counts both
totalled 168,536 across the two tenants. The original two-tenant count took
about 80 ms; the replacement took about 8 ms. The primary-tenant plan
completed in about 19 ms and used the partial draft index, with 931 matching
draft entries.
Three source/readback tests pass. This is synthetic performance evidence; a
LIVE readback and worker resumption observation are required before calling
the incident resolved. Do not manually retry exhausted jobs as part of this
source-only candidate.
