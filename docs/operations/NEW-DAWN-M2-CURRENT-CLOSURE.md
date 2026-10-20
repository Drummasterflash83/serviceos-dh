# M2 current Commusoft job closure evidence

Commusoft's published exact [GET `/jobs/{jobID}`](https://developer.commusoft.com/jobs-24695919e0.md)
describes `closed.closedOutcome`, `closed.closedOnDateTime` and
`closed.focReason`. Its closure outcome may be “final invoiced”, “free of charge”
or “aborted”. This is a **job closure classification**, not an invoice document,
paid amount or verified visit. The saved list-source job reader already shows
older `closedOutcome` text when supplied; this slice adds it to the current,
one-use exact-job receipt.

The candidate migration `20261107160000_new_dawn_commusoft_job_closure_source_facts.sql`
replaces only the exact-job finish function. It retains a v5 immutable receipt
with three bounded source text facts. For the parent `closed` object and for
each child field, absent, explicit null, malformed and present stay distinct.
An unexpected closure shape cannot erase independently valid status, stage,
hold or quote facts. No date is converted into a visit instant, and no invoice
or cost is created. The frontend accepts v1–v5 receipts and shows the closure
facts only in the OpenFolk operator's audited exact-job view.

**Release order:** deploy the frontend and Edge route that accept v5 first;
verify their exact source head and deployed Edge source. Then install this one
SQL migration only after the existing `20261107150000` optional-fact migration
is verified on LIVE. Use the established exact migration ledger/hash and
function-definition readback. The candidate's rollback-only TEST rehearsal
prints the expected function hash. Keep all broad M2 flags OFF and zero active
one-job permits during installation. The migration itself makes no Commusoft
request or feature-flag change. A subsequent real exact-job read needs a fresh,
actor/job/source-version-bound one-use permit and the already authorised
read-only Drummonds scope. Recheck the latest reviewed job link and provider
response shape before claiming a real closure value. A failed or absent source
field remains unverified; do not retry an uncertain provider GET blindly.

The exact guarded release helper is
`scripts/verify/new-dawn-m2-closure-release.mjs`. The currently installed
LIVE Edge version 5 accepts only receipt versions through v4, so SQL v5 must
not be installed yet. The reviewed v5-compatible source closure contains
exactly three files (route entrypoint, exact-job handler and Retry-After
helper), SHA-256 `be16e43e707f180a11fa68cf73c71a5284aafb01698c405560683821cb755884`.
The local-only compiler
`scripts/verify/new-dawn-m2-closure-edge-prepare.mjs` uses pinned Edge
runtime image `sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c`;
its reviewed ESZIP SHA-256 is
`248a4d308a6663e3107c66c49578a9355d7373ee5e4ac541fdd066da5de1d640`
and exact EZBR transport SHA-256 is
`b665e27c909b952840327210b592af46e2339e929ff4baecffd406df3dca35eb`.
The private candidate is in
`/private/tmp/serviceos-new-dawn-m2-closure/.verification-results/m2-closure-edge-v5-20261019-2350/`.
The release helper accepts **only that EZBR hash**, never the old v5
`eafe6d43…` hash or another arbitrary release. The release lead must deploy
the reviewed artifact, download the deployed function and compare its source
closure with the reviewed commit, then record its actual Supabase version and
`ezbr_sha256`. A higher version number alone is not evidence of compatible
source. Run these commands from the reviewed source checkout. The examples use
version 6; replace that number if deployed-runtime readback reports another:

```sh
node --test scripts/verify/new-dawn-m2-closure-release.test.mjs
node scripts/verify/new-dawn-m2-closure-rehearse.mjs --test-rollback-only
NEW_DAWN_M2_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m2-closure-release.mjs --live-read-only --edge-version=6 --edge-sha256=b665e27c909b952840327210b592af46e2339e929ff4baecffd406df3dca35eb
NEW_DAWN_M2_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m2-closure-release.mjs --live-install-exact --edge-version=6 --edge-sha256=b665e27c909b952840327210b592af46e2339e929ff4baecffd406df3dca35eb
NEW_DAWN_M2_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m2-closure-release.mjs --live-read-only --edge-version=6 --edge-sha256=b665e27c909b952840327210b592af46e2339e929ff4baecffd406df3dca35eb
```

Proceed to the install command only when read-only preflight returns
`exact_closure_sql_ready`. The helper
pins the migration bytes, predecessor ledger bytes, prior function hash,
Edge ID/version/status/JWT/hash, zero active permits and both broad flags off.
Its write is one locked transaction; it reads back the exact new ledger bytes
and function hash. If the write outcome is uncertain, it reads back once and
never replays the write. If that readback also fails, stop and investigate
read-only. Do not run a provider request as part of this release.

The TEST rehearsal is:

```sh
node scripts/verify/new-dawn-m2-closure-rehearse.mjs --test-rollback-only
```

It uses a synthetic exact-job response, tests malformed and present closure
fields, retains existing scope and import guards, and rolls back the transaction.
No provider request is made. To withdraw display, revert the frontend release;
the additive immutable receipt history remains. To stop new v5 capture, restore
the prior reviewed finish function only after checking in-flight exact reads.

Review fingerprints for the candidate: migration source SHA-256
`ab50173c908aa8e3ed7edcf73cf87793d83a99b28c015d302e6f07eeed2306f8`;
TEST rollback-only `pg_get_functiondef` SHA-256
`7c4bb1e4baf72f56935ed40dd441ea1cbd25412d205576583152677d7f4ce36c`.
The prerequisite v4 optional-fact source hash is
`3d41c68570e53e9b4b96f4d9759283098dd8031af4a9755de77a1ac3f27082df`.
The release lead must compare those against the exact deployed source and
ledger, then independently read back the LIVE function definition and receipt.
The latest failed exact-job attempt was rejected by strict response validation;
that shape issue must be understood before a new provider GET.

**Coverage limit:** the 19 October aggregate LIVE read found 39 recently
observed jobs with **zero reviewed links**. This exact-job facet cannot refresh
the client daily queue by itself. More reviewed job/customer links, and a
controlled appointment/estimate/invoice/parts source, remain necessary. The
same day, an aggregate-only read of the 1,004 reviewed saved job versions found
994 with nonempty saved closure-outcome text. The new slice adds a **current
exact-job observation** and a separate immutable hash/audit when authorised;
it does not turn those older saved values into current evidence by installation.
No job ID, name or source text was emitted by that aggregate check. The
published Commusoft API index has no documented read endpoints for those core
facets. Historical diary exports lack stable event IDs and verified current v2
job links; see [the visit source boundary](NEW-DAWN-M2-VISIT-SOURCE-BOUNDARY.md).
