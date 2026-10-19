# M3 money evidence contract

The first owner-facing money read uses **retained QuickBooks Online invoices** already
captured for a selected tenant. It does not call QuickBooks, change accounting
records, or enable a connector. The RPC is
`learn_quickbooks_owner_money(p_tenant, p_environment, p_operator_reason)`;
the client validates its response with `readOwnerMoney` in
`src/lib/learn-owner-money.ts`.

Access follows the existing retained-finance gate: a current company owner/admin
may read their tenant, and an authorised OpenFolk operator may read a selected
tenant with a reason. Each read writes an immutable finance audit event. The
response is marked `Cache-Control: no-store`. The dedicated tenant flag
`new_dawn.owner_money` must be exactly `true` for both the RPC and UI; this
change does not create or enable that flag.

For each QuickBooks realm and currency, the response gives the exact decimal
string for retained invoice balance and age bands based on the invoice due date
at the UTC read date. A list of at most 20 oldest overdue invoices carries
their exact source-version and QuickBooks invoice references for review; the
response also gives the full overdue-invoice count. It never converts a monetary value to JavaScript
`Number`, combines currencies or realms, or infers invoice-to-job links.
Conflicted latest records are counted but excluded from sums. If any invoice
balance is missing, or the currency is unknown, the group's total is null. If
any positive balance has a missing/invalid due date, overdue and age bands are
null. Negative invoice balances remain in outstanding and are counted
separately; age bands cover positive balances only.

The response labels its source, coverage, as-of date, read time, oldest/newest
observations and newest QuickBooks update time. `retained_unreconciled_invoices`
does **not** assert that every QuickBooks invoice was imported or that the
figures equal a formal A/R report. Accounts gross profit, field gross profit,
net profit, ARR and Further Works remain unavailable/withheld, with a reason;
no proxy figure is calculated from invoice totals. In particular, a company
P&L report has not yet been captured, so no net-profit value is exposed.

Before using this in LIVE, apply the migration, verify the RPC and access/audit
on a real owner and a denied non-owner, and compare a bounded sample against
QuickBooks. The panel is in the job-first home but remains hidden until the
dedicated flag is enabled after that readback.

## Bounded LIVE invoice comparison (operator only)

`20261106090000_new_dawn_invoice_comparison.sql` and
`learn-quickbooks-invoice-check` provide a separate one-use verification path.
Installation and deployment do not run a check or change the money flag. An
authorised OpenFolk platform operator signs in, selects the exact Drummonds
tenant and production QuickBooks connection, and chooses **two or three current,
nonconflicted retained Invoice version IDs from that same realm**. The operator
records a specific reason. No job link is inferred.

The operator calls the new Edge function once with a fresh UUID `requestId`,
the selected `tenantId`, `connectionId`, `versionIds` (two or three UUIDs), and
`reason`, using the signed-in Auth bearer token. The route checks the real user,
then creates an audited one-use permit. The server alone retrieves the existing
Vault access token, provided it has over two minutes left; this route **does not
refresh** it. It makes only `GET /v3/company/{realm}/invoice/{exactId}` calls,
with no provider write, import commit, scheduler or bulk traversal. It accepts
at most 128 KiB per response and compares the original JSON decimal `Balance`
and `DueDate` in Postgres, avoiding JavaScript number rounding. The response
contains only invoice/source IDs, the two values and match indicators with
retained/provider timestamps. A mismatch may simply mean the retained capture
is older; inspect the timestamps before changing any product claim.

Verify in order on TEST, then LIVE: (1) denied ordinary user and wrong-tenant
request cause no provider request; (2) one/four IDs, duplicate IDs, stale or
conflicted versions and a changed connection are denied; (3) two or three
selected Drummonds invoices return exact balance/date comparisons and an
immutable finance audit event; (4) retrying the same request UUID cannot fetch
again. Use a fresh request only for a deliberate repeat. If the access token is
near expiry, wait for the existing authorised refresh cycle; never extract or
print it. Keep the dedicated money flag **off** until the comparison, owner
access denial, signed-in UI and audit results have been reviewed. This check
does not establish complete QuickBooks A/R coverage or a reconciled P&L.

The next report-capture PR should add two **GET-only** QuickBooks Online
Reports API requests for the bound realm: `reports/ProfitAndLoss` for an explicit
start/end period and accounting basis, and `reports/AgedReceivables` for an
explicit report date and report-date ageing method. Both are named in
[Intuit's developer API collection](https://www.postman.com/intuit-developer/intuit-developer-quickbooks-online-accounting-api/documentation/4884662-e6c576f1-f6d3-440f-b090-da9ff1ac519d).
The currently installed entity-query worker cannot issue or retain those
reports. A report request needs its own durable permit, bounded response size,
tenant/realm/credential checks, immutable raw response receipt, and explicit
period, basis, currency, provider time and summary-row validation. Do not
publish accounts GP or MD-only NP until Drummonds' actual report response is
captured and reconciled. The AgedReceivables response is a separate comparison
to, not a relabeling of, this invoice-age calculation. An
[Intuit P&L response example](https://help.developer.intuit.com/s/question/0D5TR00000JyTuE0AV/i-want-to-generate-profit-and-loss-report-via-api-so-that-it-has-the-same-data-as-one-i-generate-using-quickbooks-online)
shows the period, basis, currency and GrossProfit/NetIncome summary groups that
must be checked, rather than inferred from invoices.
