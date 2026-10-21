# Drummonds MD Home: job and company money together

The New Dawn owner view should answer what needs attention without making the
reader change pages to understand the company's money. This slice places a
compact four-part company-money strip immediately after the job-attention hero
in the short-lived, audited `/client-md` presentation. The Jobs, Customers and
Team cards and full paged job list remain below it; the separate Money page
retains the detailed accounting period picker, A/R context and source audit.

The strip reuses `MdMoneyPanel`'s existing flagged, authenticated and audited
QuickBooks report-pair reads. It does not request a new report, change any
accounting record or infer a Commusoft-to-QuickBooks job link. It shows accounts
gross-profit percentage only when the saved total-income denominator verifies,
and net profit only inside the MD presentation. Further Works and recurring
revenue stay visibly held until their own source facts exist. The source period,
accounting basis and saved time sit under the figures; no example number or
current-balance claim is shown. A link opens the existing full Money page.

The money component mounts after the initial job-status summary and first page
settle, so those primary work reads are not delayed by concurrent accounting
queries. It unmounts when the audited MD presentation expires. Ordinary client
`OpenJobHomeWithEvidence` does not pass the money strip, and the backend still
checks every money read against the operator's identity, tenant, reason and
feature flags.

This frontend change is bundled with draft PR #327's job-first and LEARN
reliability release. That PR's separately reviewed LIVE migration must install
and read back before the frontend merges. After Vercel builds pass, verify the
signed-in `/client-md` Home at desktop and phone widths: On-hold/Pending work
first, then the dated QuickBooks strip, then Jobs/Customers/Team and the job
list. Check the same report period and values against the existing Money page,
and confirm the figures disappear when the MD presentation expires. The
normal client route must not show net profit.
