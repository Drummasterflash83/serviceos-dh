# M3 · saved aged-receivables review cue

This is a **default-OFF, OpenFolk-operator-only** addition to the audited saved
company accounts preview. It does not add a provider request, schedule, SQL
function, source row or client money permission. The separate tenant flag is
`new_dawn.aged_debt_exception_preview`; an absent flag means OFF. The existing
`new_dawn.job_home_accounts_preview` and `new_dawn.report_summary_preview`
controls, audited job view, explicit reason, matching saved production P&L/A/R
pair and summary read must all pass before any amount can be shown.

The cue uses the exact decimal `ar_91_plus` bucket returned by the existing
operator-only `learn_quickbooks_report_summary_preview` RPC. That RPC checks the
tenant, actor authority, saved receipt IDs, source hashes, production realm,
currency, as-of date, source shape and P&L/A/R match, and records the read. The
browser renders the cue only if the separate flag is ON and the net 91+ bucket
is positive; zero or negative balances make no claim of cleared invoices.
The visible label is **QuickBooks Aged Receivables · 91 and over · as of [date]**.
This is a company-level snapshot and review prompt, not an invoice list,
customer debt finding, job margin, current balance or permission to chase.
Net credits, allocations, later payments and subsequent adjustments may change
the interpretation. No invoice-to-job or customer attribution is inferred.

Release sequence for the owner after review: merge this PR, verify the Vercel
frontend and existing operator accounts preview, confirm all owner/client money
flags OFF and `new_dawn.aged_debt_exception_preview` absent/OFF for every tenant,
then separately approve a Drummonds-only flag switch. The switch must check the
exact tenant and existing operator flags and read back its single write. Signed-in
desktop and 390 px mobile acceptance should choose an October saved report pair,
perform the explicit audited read, confirm the date/source/amount and private
operator audience, and confirm no cue in an ordinary client view. No broad
enablement is part of this PR. To withdraw the cue, disable only
`new_dawn.aged_debt_exception_preview`; saved reports and audit remain intact.

The exact switch is `scripts/verify/new-dawn-m3-aged-receivables-flag.mjs`.
Its 20 October read-only LIVE preflight returned `operator_aged_review_off` for
the exact Drummonds tenant, with the selector ledger/source matching, the
parent operator controls ON, and every owner/client money flag OFF. It made no
provider request or write. The release owner can use this sequence only after
the switch PR is merged, frontend deployment checked and signed-in acceptance
planned:

1. `NEW_DAWN_M3_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m3-aged-receivables-flag.mjs --live-read-only`
2. `NEW_DAWN_M3_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m3-aged-receivables-flag.mjs --live-enable-drummonds-operator-only`
3. Repeat `--live-read-only`, then check the private desktop/mobile view and
   its existing `report.summary_preview_read` audit. Confirm ordinary client
   views remain withheld. The cue appears only for a positive saved 91+ bucket.

The transaction locks `feature_flags`, pins the exact selector migration and
function definition, production connection and Drummonds-only parent flags,
requires all client money controls OFF, and changes one tenant flag. It makes
one independent read-only management readback after the write; an uncertain
outcome is never automatically retried. To withdraw, use
`--live-disable-drummonds-operator-only` with the same project environment
variable. Withdrawal checks only the exact flag/project state, so stale or
missing report evidence cannot trap an enabled cue. If a write outcome is
unverified, inspect the fresh read-only state before any human retry.
