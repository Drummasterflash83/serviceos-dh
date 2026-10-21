# MD presentation clarity — release review

The audited MD Money page already has a verified saved P&L and A/R pair, but its first view shows formula text, read hashes, audit identifiers, an invoice-source inspector and several repeated explanations of missing data. Those controls make the presentation harder to use without improving a money decision. This outcome keeps the dated figures and their limits visible, presents each missing measure in one short line, and keeps the age bands behind a disclosure. The 91+ invoice-source inspector moves to the existing OpenFolk-only job/money diagnostics, where it retains its audited, tenant-scoped backend read and source proof.

No QuickBooks request, financial action, chase draft, tenant grant, staff login, report value, source receipt or database function changes. The underlying operator report-summary preview still shows the saved receipt hashes and audit proof. The MD read remains guarded by its existing short-lived OpenFolk presentation session and logs each source request.

The same client presentation also replaces technical matching shorthand in the job list and oldest On-hold rows with "Recorded customer and site". Home's customer coverage and grouped work use ordinary, explicit wording for confirmed and still-unmatched jobs. Unconfirmed matches remain labelled as such, and the job detail still names Commusoft and exposes its saved time and source limits. The desktop header no longer prints Chris's OpenFolk email while presenting; the preview badge and expandable audit/access notice remain visible.

For attention jobs whose canonical customer/site identity is still held, a separate **user-opened** section groups saved job rows only by exact Commusoft customer ID inside the same connection. It reads the existing authenticated, audited paged job RPC at a fixed snapshot and stops at the first Open job; no provider call, database migration or identity write is added. The 200-row cap is labelled as a bounded first portion if reached. Missing parent IDs or inconsistent names remain individual jobs, and jobs already present in the confirmed customer groups are excluded when that read is available. The section explicitly says these are recorded source names, not verified ServiceOS links. This is a way to find the remaining work without relaxing the approved matching rule.

## Release and acceptance

This is a frontend-only outcome. Use the next planned LIVE batch after the job-first Home release, with one combined build and signed-in check. Confirm that:

1. `/client-md` Money opens the newest verified saved period and shows the same GP, NP, A/R and four tile states as before. The report cutoff, accounting basis, saved time and any stale/partial-period cue remain visible.
2. A/R explicitly includes credits and is not described as collectible debt. Its age groups open on request; a positive 91+ bucket is still a review cue, while a net credit is labelled as a credit.
3. The default MD page contains no receipt hash, audit identifier, raw invoice-source list or draft-chase control. It says clearly that completed-not-invoiced needs exact job-to-invoice evidence and that the FY27 net-profit target is pending.
4. The existing OpenFolk-only operator diagnostics still expose the bounded saved 91+ invoice-source review after an audited job preview. A non-operator does not see or execute that review. The operator report-summary preview still exposes exact receipt hashes for support.
5. The Home Money strip remains unchanged, and no figure is presented as a live account balance or job margin.
6. Home and paged jobs show the recorded source customer and site in ordinary language. Unconfirmed identity is still explicit; opening a job shows provenance, the saved time and any verified link. The presentation header does not expose Chris's email, but the OpenFolk preview/access notice is still present.
7. "See jobs still being matched" makes at most four 50-row audited saved-job page reads on demand. It shows source-ID groups and individual unresolved rows with status and saved time; same-name/different-ID customers stay separate, conflicting-name/same-ID rows stay ungrouped, and no source group is labelled a confirmed customer. The full paged list remains available if this bounded view is partial or fails.

If the MD figures differ or the operator review disappears, roll the frontend back to the previous verified Git deployment. There is no database or provider rollback in this outcome.

## Source verification

The expanded source branch passed TypeScript, the production build with all 48 prebuild checks, and six focused job-label/source-group tests. Nine saved-money and aged-invoice parser tests passed on the Money change, which the grouping addition did not alter. The signed-in LIVE comparison before this source change confirmed the excessive technical content and that old office/account rows still lead the full all-jobs page; confirmed customer work is already above them, and the new recorded-customer view is deliberately user-opened. A signed-in after-release desktop and phone check must prove the on-demand pages, exact-ID grouping, job detail and Money/operator separation before calling the presentation accepted. No extra 21 October LIVE batch is claimed by preparing this branch.
