# Open-job identity triage

The operator queue already groups On-hold and Pending Commusoft jobs and shows held reasons, but reviewing a source identity from IDs alone takes repeated navigation. The existing reader also derives every page from retained job history. This release adds bounded recorded work, company/contact and property labels to that same audited queue and reads the exact current-job projection installed in the previous release. A contact label is not proof of the account holder. Every ambiguous job stays unlinked and requires review.

The migration replaces `public.new_dawn_open_identity_review_page(uuid,uuid,text,text,integer)` only. It keeps the actor, tenant, connection, review-flag, cursor and audit checks and the candidate recheck. No source row, customer, site, job link, feature flag or provider setting changes. The response moves from `/1` to `/2`; the client parser accepts both during deployment and rejects malformed or oversized labels. Historical observations are read only for keys that changed after the cursor anchor.

Release sequence:

1. Confirm the exact source hash and baseline LIVE function using `node scripts/verify/new-dawn-open-identity-triage-readback.mjs --live-read-only`. This reads no private job rows. Do not install if it reports a changed baseline.
2. Install `supabase/migrations/20261113040000_new_dawn_open_identity_triage.sql` through the normal approved production migration route, recording that exact source in the migration ledger. The migration checks the prior and resulting function hashes and preserves authenticated-only EXECUTE.
3. Run the readback again, then open the signed-in operator review for Drummonds. Confirm the grouped urgent list and paged queue display bounded source context, correct held reasons, an audit receipt, and a usable first/next page. Compare a few labels with saved Commusoft source; do not infer or apply a link from a name.
4. If the signed-in reader fails, run `supabase/release/new-dawn-open-identity-triage/rollback.sql` after checking its candidate hash. It restores only the prior function. Keep the installed ledger entry as a record and document the rollback separately; do not replay the migration blindly.

Local proof: `node --test src/lib/new-dawn-open-identity-review.test.ts`; `node scripts/verify/new-dawn-open-identity-triage-synthetic.mjs | psql -X -v ON_ERROR_STOP=1` against a disposable PostgreSQL 17 database; TypeScript and full build. The synthetic proof covers labels, tenant/cursor denial, audit, rollback/reapply and a later import during paging. It is not a substitute for signed-in LIVE usability or performance acceptance.

The additional `scripts/verify/new-dawn-open-identity-triage-load.sql` runs after that fixture in the same disposable database. With 15,005 projected keys and 120,008 observations, its 40-row first and second pages returned in 14.8 ms and 13.1 ms locally. This detects a gross retained-history scan regression, but the synthetic status mix and stubbed identity candidate differ from LIVE.
