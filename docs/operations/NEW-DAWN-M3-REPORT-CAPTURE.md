# M3 QuickBooks report evidence capture

This slice adds a deliberate OpenFolk operator action to capture **one** source
report at a time from a confirmed, tenant-bound QuickBooks connection. It
supports `ProfitAndLoss` and `AgedReceivables` only. It does not publish
accounts gross profit, net profit or formal accounts receivable, change any
QuickBooks record, refresh a token, start a schedule, or enable
`new_dawn.owner_money`.

The operator selects the company, enters a reason, reviews the report and its
dates, then confirms one request. P&L requires explicit start and end dates
covering at most 366 days, ending no later than today, and an explicit Cash or
Accrual basis. A/R requires a report date no older than 31 days and fixes the
ageing method to `Report_Date`. The Edge route makes exactly one GET against
the bound realm: `reports/ProfitAndLoss` or `reports/AgedReceivables`. These
report names are in [Intuit's official API collection](https://www.postman.com/intuit-developer/intuit-developer-quickbooks-online-accounting-api/documentation/4884662-e6c576f1-f6d3-440f-b090-da9ff1ac519d),
and [Intuit's report header definition](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippphpdevkitv3/entities/files/IPPReportHeader.html)
defines the returned report name, period and basis fields. No broader report
or filter URL can pass the provider transport allowlist.

The one-use SQL permit rechecks the actor, selected tenant, connection
revision, realm and token generation before the GET. The server alone reads
the existing Vault access token when over two minutes remain; the browser
never sees it. The response cap is 2 MiB. Postgres retains the original JSON
text as a private immutable receipt, with a SHA-256 of its exact UTF-8 bytes.
This preserves decimal characters without a JavaScript-number round trip.
The operator UI receives only receipt metadata and the immutable audit ID,
not raw rows or amounts. A 200 JSON response whose report name or requested
period/basis/date cannot be confirmed is retained with state `held` and an
explicit validation code. A held receipt must not support a money figure.

| Reader or action | Report route | Raw receipt | Owner-money panel |
| --- | --- | --- | --- |
| Anonymous or unsigned user | Denied | Denied | Denied |
| Ordinary client user, including a Drummonds staff member | Denied | Denied | Still hidden while its dedicated flag is off |
| Authorised OpenFolk platform operator with selected tenant and reason | One bounded capture; metadata result audited | No direct table grant; server-only receipt | Separate retained-invoice preview authority, not client acceptance |
| Service role inside the one-use Edge route | Claim, recheck, finish or fail only | Inserts immutable receipt | No client-view claim |

Heidi's login remains disabled. The hosted TEST rehearsal used a synthetic
ordinary-user denial and operator fixture; it does **not** establish a real
signed-in Drummonds owner or denied-user acceptance for the separate
`learn_quickbooks_owner_money` RPC. The M3 owner-money flag therefore stays
**off** until those separate checks pass. OpenFolk operator preview must not
be described as a client owner view.

The rollback-only TEST rehearsal
`node scripts/verify/new-dawn-report-capture-rehearse.mjs` installed the exact
migration temporarily, exercised a verified synthetic P&L, a verified
synthetic A/R report, and a held mismatched report, then rolled back. It
checked an authenticated platform operator's permit start, immutable receipts,
completed/held audit events, table/function grants and an ordinary signed-in
profile's start/result denials. It made zero
provider requests and returned no report values. Focused Edge/UI tests cover
exact GET URLs, tenant binding, denial before provider access, raw decimal
preservation, held responses and metadata-only display.

For LIVE release, record current main/PR head, tenant/realm/connection
binding, `new_dawn.owner_money` flag state, report table/function existence,
retained invoice and finance-event counts, and the currently active QuickBooks
connection. Install the migration and deploy only the new Edge route after
review; verify the baseline counts and flag are unchanged. Promote the
operator UI, then capture at most one explicitly dated report of each type
through the signed-in operator control. Confirm two immutable receipts and
their audit events or record their held/failure states. Do not repeat an
uncertain one-use request automatically. No client money figure follows from
this receipt alone: inspect the actual LIVE report structure, currency,
period/basis, and summary rows in a separate reviewed reconciliation slice.
