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

The release helper has a read-only preflight and **three separate, pinned
commands for two schema stages**: concurrent index, exact ledger record, then
guarded function replacement with its ledger. Run from this branch or a
reviewed merge containing the same file hashes. Each command checks the
current stage before one write, then reads back exact source bytes, function
hash, grants, index validity/definition and both ledger entries. A missing
HTTP acknowledgement never triggers replay; inspect the readback first.
It emits no private interaction content.

```sh
node scripts/verify/new-dawn-identity-review-count-release.mjs --live-read-only

NEW_DAWN_IDENTITY_REVIEW_PROJECT=tgbnakbxwcqjeimygroz \
NEW_DAWN_IDENTITY_REVIEW_INDEX_SHA=98823b2aca835b6c828f298389ca3d5865caf95059ddc3f0ed9cad42a7c2caaa \
NEW_DAWN_IDENTITY_REVIEW_FUNCTION_SHA=a48b888c2fb1eaaac59f29c2aabdb489f005dce534bcac9aceb378a59a82dcf7 \
node scripts/verify/new-dawn-identity-review-count-release.mjs --live-index-exact

NEW_DAWN_IDENTITY_REVIEW_PROJECT=tgbnakbxwcqjeimygroz \
NEW_DAWN_IDENTITY_REVIEW_INDEX_SHA=98823b2aca835b6c828f298389ca3d5865caf95059ddc3f0ed9cad42a7c2caaa \
NEW_DAWN_IDENTITY_REVIEW_FUNCTION_SHA=a48b888c2fb1eaaac59f29c2aabdb489f005dce534bcac9aceb378a59a82dcf7 \
node scripts/verify/new-dawn-identity-review-count-release.mjs --live-index-ledger-exact

NEW_DAWN_IDENTITY_REVIEW_PROJECT=tgbnakbxwcqjeimygroz \
NEW_DAWN_IDENTITY_REVIEW_INDEX_SHA=98823b2aca835b6c828f298389ca3d5865caf95059ddc3f0ed9cad42a7c2caaa \
NEW_DAWN_IDENTITY_REVIEW_FUNCTION_SHA=a48b888c2fb1eaaac59f29c2aabdb489f005dce534bcac9aceb378a59a82dcf7 \
node scripts/verify/new-dawn-identity-review-count-release.mjs --live-function-exact
```

The first command sends only the migration's standalone `CREATE INDEX
CONCURRENTLY` through Management `/database/query`, **without** `BEGIN`, `SET`,
or a query timeout prefix. A bounded disposable TEST probe verified this
endpoint accepts and builds a valid concurrent index; the probe table/schema
were removed afterward. [Supabase CLI documentation](https://supabase.com/docs/guides/local-development/cli-workflows)
also says its `db push` path detects concurrent indexes and runs them
standalone, but this helper avoids a broad migration push. The second and
third commands are separate, guarded transactions. Do not combine them into
one Management request or use a blocking `CREATE INDEX` fallback.

The candidate **has not been installed on LIVE by its author**. If the
concurrent index build fails, inspect `pg_index.indisvalid`; do not replace
the function or automatically retry the build. Any cleanup of an invalid
index is a separate reviewed change.

Disposable PostgreSQL 17 rehearsal used 180,000 mixed interactions and
119,431 retained Email rows, including missing Email sources, non-Gmail
`DRAFT` labels, other tenants and other statuses. Old and new counts both
totalled 168,536 across the two tenants. The original two-tenant count took
about 80 ms; the replacement took about 8 ms. The primary-tenant plan
completed in about 19 ms and used the partial draft index, with 931 matching
draft entries.
Ten source, readback and release-mode tests pass. A second disposable PG17
rehearsal ran the exact standalone index SQL, the exact index-ledger SQL and
the exact function-release SQL in sequence. Final function MD5 was
`424e42ecd066f3e6dd7ac553b11f1156`, the synthetic count stayed 4/4,
both ledger hashes matched their source files, and a replay was rejected by
the guard. This is synthetic performance and release-mechanism evidence; a
LIVE readback and worker resumption observation are required before calling
the incident resolved. Do not manually retry exhausted jobs as part of this
source-only candidate.
