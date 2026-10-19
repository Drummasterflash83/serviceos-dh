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
response is marked `Cache-Control: no-store`.

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
QuickBooks. Separately add a durable, tenant-bound read-only Reports API
capture for ProfitAndLoss and AgedReceivables. Intuit's report response includes
report periods, basis, currency and summary rows; those must be retained and
validated before any GP or NP claim. Reference:
[Intuit QuickBooks P&L report example](https://help.developer.intuit.com/s/question/0D5TR00000JyTuE0AV/i-want-to-generate-profit-and-loss-report-via-api-so-that-it-has-the-same-data-as-one-i-generate-using-quickbooks-online).
