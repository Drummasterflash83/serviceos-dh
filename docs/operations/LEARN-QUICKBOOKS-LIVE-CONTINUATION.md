# Drummonds QuickBooks LIVE history continuation — prepared 14 October 2026

Status: prepared, not approved or started. The first approved 500-request run is
verified at `limit_reached`, with its connection paused and Payment position
15,101 retained. Customer and Invoice traversals are complete. Do not alter
that run's definition or request budget.

## Proposed scope

Use the existing verified DRUMMOND HEATING connection
`04d68333-fc13-42c2-a500-789f386f015c`, production tenant
`00000000-0000-0000-0000-000000000001`, realm `1197397945`.
Create one new import through the logged OpenFolk operator controls, continuing
`0b89d0a8-02de-4f1c-91e9-25b8917eca68` from its saved entity and position.
Keep the original entity order, page size 100 and minor version 75:
Customer, Invoice, Payment, CreditMemo, SalesReceipt, Estimate, Vendor, Bill,
BillPayment, Purchase, VendorCredit, Account and Item.

Permit up to **2,000 additional read-only accounting page requests** within
**24 hours**. Failed requests consume the budget. This is an upper bound, not a
promise that every source type or all history will fit. No repeated full scan of
already traversed Customer pages. Stop at traversal, cap, expiry or unresolved
failure; pause capture and retain source versions and evidence.

The existing OAuth grant stays unchanged. Permit ordinary refresh of its existing
access token through Intuit's token endpoint, with the same app/company/scope and
production Vault destination, at most 24 refresh attempts during this run. An
uncertain refresh result stops for inspection; do not blindly retry rotating
refresh tokens. Accounting endpoints remain GET-only.

## Execution and verification

Use the existing repository worker with a local adapter pinned to the new run.
Before execution verify the exact parent checkpoint, entities, page size, minor
version, request ceiling, expiry, tenant, realm and current operator authority.
Restrict provider calls to the verified company's query endpoint and the official
Intuit token endpoint for an unchanged-grant refresh. The local adapter must
support the worker's refresh RPCs before this longer run; the first-pass adapter
was intentionally limited to a shorter token lifetime. Do not reuse it unchanged.

Verify persisted page/observation totals, source scope, conflicts, source
references, terminal checkpoint and paused connection. Preserve the former run
and report which entity types have and have not been traversed. Save aggregate
proof and the implementation checkpoint to the approved Git branches.

## Excluded

No new users, access grants, app/company consent, credential destination,
accounting writes, payments, payroll, AI/model training, automatic customer/job
matching or recurring schedule. Hosted unattended dispatch remains separate work.
Retained financial information stays limited to company owners/admins and logged
OpenFolk support. Source QuickBooks job codes do not replace Commusoft job codes.
