# MD Money presentation cleanup — release review

The audited MD Money page already has a verified saved P&L and A/R pair, but its first view shows formula text, read hashes, audit identifiers, an invoice-source inspector and several repeated explanations of missing data. Those controls make the presentation harder to use without improving a money decision. This outcome keeps the dated figures and their limits visible, presents each missing measure in one short line, and keeps the age bands behind a disclosure. The 91+ invoice-source inspector moves to the existing OpenFolk-only job/money diagnostics, where it retains its audited, tenant-scoped backend read and source proof.

No QuickBooks request, financial action, chase draft, tenant grant, staff login, report value, source receipt or database function changes. The underlying operator report-summary preview still shows the saved receipt hashes and audit proof. The MD read remains guarded by its existing short-lived OpenFolk presentation session and logs each source request.

## Release and acceptance

This is a frontend-only outcome. Use the next planned LIVE batch after the job-first Home release, with one combined build and signed-in check. Confirm that:

1. `/client-md` Money opens the newest verified saved period and shows the same GP, NP, A/R and four tile states as before. The report cutoff, accounting basis, saved time and any stale/partial-period cue remain visible.
2. A/R explicitly includes credits and is not described as collectible debt. Its age groups open on request; a positive 91+ bucket is still a review cue, while a net credit is labelled as a credit.
3. The default MD page contains no receipt hash, audit identifier, raw invoice-source list or draft-chase control. It says clearly that completed-not-invoiced needs exact job-to-invoice evidence and that the FY27 net-profit target is pending.
4. The existing OpenFolk-only operator diagnostics still expose the bounded saved 91+ invoice-source review after an audited job preview. A non-operator does not see or execute that review. The operator report-summary preview still exposes exact receipt hashes for support.
5. The Home Money strip remains unchanged, and no figure is presented as a live account balance or job margin.

If the MD figures differ or the operator review disappears, roll the frontend back to the previous verified Git deployment. There is no database or provider rollback in this outcome.

## Source verification

The source branch passed TypeScript, the production build with its 48 prebuild checks, and nine focused saved-money and aged-invoice parser tests. The signed-in LIVE comparison before this source change confirmed the excessive technical content; a signed-in after-release check is required before calling the client presentation accepted. No extra 21 October LIVE batch is claimed by preparing this branch.
