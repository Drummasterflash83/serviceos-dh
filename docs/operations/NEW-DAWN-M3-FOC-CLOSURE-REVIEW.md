# M3 · recorded free-of-charge closure review

This is a narrow OpenFolk operator source review, not a client money publication.
The new `new_dawn_foc_closure_review` RPC reads only saved exact Commusoft job
detail receipts with source-native `closedOutcome=FreeOfCharge`. It requires the
current reviewed Commusoft job link and latest saved source version to match the
receipt, then returns at most 20 dated candidates and an audited read. A later
exact detail for the same job supersedes an earlier free-of-charge receipt. The
new `new_dawn.m3_foc_closure_review` tenant flag is absent by default. The
operator panel is mounted only after an audited job-home read and never in the
client or MD presentation view.

The count-only LIVE read on 20 October found one completed v5 exact-job receipt
with a `FreeOfCharge` outcome, recorded completion time and FOC reason. Its
reviewed job link still matched the current source version. Two older exact-job
receipts lacked v5 closure data. The new function was absent and the flag was
OFF on that baseline read. This source fact warrants a human check of
why the job was closed free of charge. It does **not** establish an uninvoiced
job, a missing payment, a completed visit, a job cost or financial impact. The
QuickBooks invoice/job pair remains unverified. Field GP, ARR, Further Works
conversion and the proposed GP target remain held.

The rollback-only hosted TEST rehearsal created a synthetic exact job receipt
inside one transaction, checked flag-off and ordinary-user denial, exact
operator result/audit, wrong-tenant denial, a later receipt superseding the
candidate, and function grants. It made no provider request and verified the
function was absent after rollback. Decoder tests, TypeScript and build pass.

The guarded release helper pins the exact migration SHA-256
`8017df2770cfc3242a8d532b5b40dad8a1221cb11f5784d8613db18ed91c5075`,
the existing access, latest-source and detail-finish function definitions,
the active Drummonds tenant, protected receipt table, absent target ledger and
RPC, and all client/FOC flags OFF. It records one exact source in the
`supabase_migrations.schema_migrations` ledger, then independently verifies
the installed function hash, grants, ledger, unchanged source/audit counts and
flags. An uncertain write is read back once and never replayed automatically.
The exact installer transaction also passed a separate rollback-only hosted
TEST rehearsal with synthetic prerequisites; its ledger, function and tenant
were absent after rollback.

Run the preflight first, then install only after the release review:

```sh
NEW_DAWN_M3_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m3-foc-closure-release.mjs --live-read-only
NEW_DAWN_M3_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m3-foc-closure-release.mjs --live-install-exact
```

The read-only preflight returned `exact_foc_review_ready` with source SHA-256
matching the above value, no review audit and the flag OFF. No LIVE install was
run in this branch task. The TEST check is:
`node scripts/verify/new-dawn-m3-foc-closure-release-rehearse.mjs --test-rollback-only`.

Release owner: install the additive SQL only after review, verify the function
grant and that no flag or source row was changed, then separately consider a
Drummonds-only operator flag switch. The signed-in OpenFolk job-home reason,
private panel, source ID/hash and audit must be checked on desktop and mobile;
ordinary client and MD presentation views must remain free of this cue. If
anything misleads, leave or turn the flag OFF and restore the prior frontend.
The additive function and immutable source/audit history can remain for review.
