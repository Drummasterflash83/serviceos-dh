# M3 saved QuickBooks report summary — release handoff

This change reads two already retained, immutable QuickBooks report receipts. It makes no provider request and writes no financial record. Its only new write is an immutable OpenFolk audit event for a successful operator read. Installation seeds no flag or grant; `new_dawn.report_summary_preview` must remain absent/off until the release owner approves the operator preview.

## Source and mapping

- LIVE September 2026 accrual `ProfitAndLoss`: request `737e4103-5197-4561-83c2-1fe11e945bba`, 10,954-byte verified receipt, SHA-256 `de9328bf0aeecb87e0518eef8ec6aef4c167845723786e454adf0ea363c110aa`. The unique top-level `GrossProfit` and `NetIncome` section summaries provide accounts gross profit and net profit for 1–30 September 2026.
- LIVE `AgedReceivables` as of 30 September 2026: request `ecf7c766-041e-401b-b9d9-bc9e205fd457`, 21,124-byte verified receipt, SHA-256 `b24598f35dd568f7ed1abb342b7e9b89aaba192850d0cbc14958c6da8fe25653`. The unique top-level `GrandTotal` summary provides current, 1–30, 31–60, 61–90, 91+ and total receivables. The parser checks exact column order and that the five buckets sum exactly to total.
- Both receipts are GBP and were independently checked by read-only structural queries. No private account rows, customers or amounts were printed during inspection. The captured GET requests had only report date/basis parameters; no extra class or department filter was requested.
- Values stay decimal strings throughout the RPC and UI; no JavaScript floating-point conversion is used. This is a QuickBooks company accounts report, not Commusoft job gross profit, a job-level invoice link, ARR, or a reconciliation against retained invoices.

The parser holds an unexpected report name, currency, column, unique section, decimal or bucket-total shape. The read RPC requires two explicit request IDs, a matching tenant/realm/connection/environment and report date, verified receipts, a reason, a signed-in current OpenFolk platform admin, and the separate preview flag. Raw report rows remain inaccessible to browser roles. The visible panel sits only in OpenFolk QuickBooks operator controls; the client `OwnerMoneyPanel` is untouched.

## Verification and rollout

`node scripts/verify/new-dawn-report-summary-rehearse.mjs` passed on TEST in one rolled-back transaction with synthetic reports, including flag-off and ordinary-user denials. `node --test src/lib/learn-quickbooks-report-summary.test.ts`, `npx tsc --noEmit`, and `npm run build` passed. The TEST project does not yet retain the report-capture migration, so the rehearsal installs that dependency inside the same rolled-back transaction.

Release owner sequence: review the migration and source mapping; install SQL with before/after function and receipt counts; deploy the UI with the flag still off; verify the flag is off and both LIVE receipts remain unchanged. If an operator-only preview is desired, enable only `new_dawn.report_summary_preview` for the Drummonds tenant, then use the signed-in OpenFolk QuickBooks screen with the two exact request IDs and an audit reason. Inspect the returned source hashes, dates and audit event without copying private values into a ticket. Disable the flag to withdraw the preview; no retained source is deleted.

## Still held

No real Drummonds MD login is enabled, so this is **not** a signed-in client owner acceptance and net profit must not appear in a client view. Chris is OpenFolk's founder, not the Drummonds MD. Confirm the intended accounting definitions (period, basis, tax treatment and the status of any post-report adjustments) with the future client owner before publishing these figures to clients. A fresh report would be needed for any later as-of date. Field gross profit needs evidenced Commusoft job costs; ARR needs verified recurrence. Neither can be derived from these two reports.
