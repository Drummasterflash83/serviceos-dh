# M3 September accounts on the job-first home — release handoff

This is a small OpenFolk founder/operator preview of two figures from an explicitly reviewed pair of **already saved** QuickBooks reports. It makes no provider call, changes no financial record, and displays no implicit latest report. The new `new_dawn.job_home_accounts_preview` tenant flag is **not seeded** and remains OFF. The existing operator report-summary flag must also be ON before the panel appears; its audited RPC independently enforces signed-in OpenFolk authority, matching tenant/realm/connection/date, the report-request actor, verified receipts and an access reason.

The job-first home offers the panel only after an OpenFolk operator opens the audited job preview. The operator enters two exact saved-report request IDs and acknowledges the company, receipts and reason. The browser sends these IDs to `learn_quickbooks_report_summary_preview` and applies the existing strict reader plus a September 2026 production/accrual/date check. No receipt IDs, hashes, account values or provider credentials are embedded in frontend source. The compact panel shows **accounts gross profit** and **net profit** from the September P&L, with the report period, basis, QuickBooks source, A/R as-of date and an audit trail. Field gross profit and ARR remain visibly held. It does not present a current result, job costing or reconciled invoice balance.

| Audience | Result |
| --- | --- |
| OpenFolk operator with the specific report finance authority | Can request the saved summary after both flags, reviewed IDs and reason; the server logs the successful read. |
| Ordinary Drummonds team role | No panel; no report-summary RPC authority. |
| Drummonds owner/admin | No panel from this slice. The owner login and separate client acceptance remain unresolved. |
| OpenFolk founder viewing a client workspace | Only the OpenFolk operator path can request the audited preview; client `new_dawn.owner_money` remains OFF. |

`node --test src/lib/new-dawn-founder-accounts-preview.test.ts src/lib/learn-quickbooks-report-summary.test.ts`, `npx tsc --noEmit` and `npm run build` passed locally. Before release, review the flag and server grants, deploy the frontend with the new flag OFF, then perform a signed-in OpenFolk operator check using the reviewed report pair and a real access reason. Confirm that ordinary roles cannot see the panel or call the RPC, and inspect the audit without copying private values into logs or Git. Keep the client owner-money flag OFF. Publishing a client owner view needs a separate tenant-scoped access and accounting-definition review; it cannot reuse the current operator-only RPC as-is.
