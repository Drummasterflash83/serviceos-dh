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
