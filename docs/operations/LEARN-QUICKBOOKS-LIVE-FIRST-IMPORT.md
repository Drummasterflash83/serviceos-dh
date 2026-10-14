# Drummonds QuickBooks LIVE consent and first capture — prepared 14 October 2026

Status: approved by Chris on 14 October. Intuit consent completed at 06:58 UTC,
CompanyInfo verified, company confirmed through the logged LIVE operator UI.
The bounded first import is running; completion and coverage are not yet verified.
Intuit screen identifies
**OpenFolk ServiceOS → DRUMMOND HEATING**, signed in as Heidi. Observed accounting
realm is `1197397945`; verify returned CompanyInfo before confirming in ServiceOS.

## Approved consent

Click **Connect** on that exact Intuit consent screen. It shares QuickBooks
company, customer/supplier/employee information and subsequent changes with
OpenFolk ServiceOS, subject to Intuit's displayed Terms/Global Privacy Statement
and the published Drummonds ServiceOS terms/privacy. OAuth scope is
`com.intuit.quickbooks.accounting`; Intuit grants read/write-capable Accounting
access, although this connector implements accounting reads only. Tokens remain
in production encrypted Vault until revoked/retired; no passwords are collected.

Bind only production tenant `00000000-0000-0000-0000-000000000001` and the existing
production ServiceOS app. Confirm the returned company identity in the signed-in
logged operator controls. Stop if the realm/company differs.

## Bounded initial capture

After identity verification, enable only that tenant's QuickBooks input and start
one explicit source scan through the operator controls, then execute the existing
worker pinned to its recorded import ID. Up to **500 read-only accounting page
requests**, up to **100 records per page**, expires within **24 hours**. Failed
requests count; no automatic transport retries. Records: Customer, Invoice,
Payment, CreditMemo, SalesReceipt, Estimate, Vendor, Bill, BillPayment, Purchase,
VendorCredit, Account and Item. Provider product/plan restrictions may limit
coverage and must be reported honestly.

Retain original financial records/versions and import evidence in production,
accessible only to company owners/admins and authorised logged support. Pause
capture on completion, request cap, deadline or unresolved failure. Preserve
checkpoints and imported history. This first pass does not promise complete
historical coverage.

No new users/grants, scheduler, provider writes, payments, payroll, AI processing,
model training, automatic customer/job linking or job-code replacement. Current
Commusoft job codes remain authoritative; QuickBooks source references stay intact.

## Verification

Check OAuth/company identity, saved counts by source type, completed versus
checkpointed pages and bounded request use, tenant/realm bindings, import pause
and authorised finance reader. Never print raw financial records, tokens or
credential fingerprints. The existing tested disconnect controls provide a
revocation path; do not revoke the newly desired connection as a routine test.

## Execution identifiers

- Production connection: `04d68333-fc13-42c2-a500-789f386f015c`.
- First import: `0b89d0a8-02de-4f1c-91e9-25b8917eca68`.
- Definition readback matched all 13 entities, page size 100, minor version 75,
  maximum 500 requests and expiry 15 October 07:00:57 UTC.
- The exact worker is running locally with acquisition pinned to that run.
  No hosted trigger credential or ongoing schedule was enabled.
