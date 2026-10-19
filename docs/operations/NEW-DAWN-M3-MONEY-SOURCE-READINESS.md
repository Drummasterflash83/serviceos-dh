# M3 field GP and ARR source readiness — review handoff

This is an OpenFolk operator **metadata** read, not a money calculation. The new `learn_quickbooks_money_source_readiness` RPC returns counts of retained source records and field presence for one selected, confirmed QuickBooks realm, plus tenant-wide retained Commusoft job-version counts. It returns no amounts, names, IDs of financial records or provider payload. Each successful read has an immutable finance audit; installation performs no provider request, creates no flag/grant, and changes no financial record. The UI and RPC require the dedicated `new_dawn.money_source_readiness` tenant flag, which this PR leaves absent/off.

## Count-only LIVE observation on 19 October 2026

- QuickBooks production latest records: 21,658 Invoices, 41,894 Bills, 11,885 Purchases and 102 Items. Of 21,658 Invoice rows, 21,655 were nonconflicted in the earlier check.
- 8,848 QuickBooks Customer rows carried the Job/subcustomer markers; 11,277 Bills and 403 Purchases carried a line-level CustomerRef; 21,655 Invoices carried a line ItemRef; 96 Items had a PurchaseCost field. These are potential accounting inputs, **not** evidenced links to Commusoft jobs or actual job costs. The released function excludes conflicted latest pointers, so its live numbers may be slightly lower than this inventory snapshot.
- 12,761 retained Commusoft job versions were present. None had any of the checked direct-cost/recurrence top-level keys. All had `quotedAmount`, which is neither realised revenue nor incurred cost. The exact-job detail receipt retains status, stage, assigned source users and expected times, not cost/invoice lines.
- No latest Invoice had any of the five explicit recurrence-marker keys checked. The current QuickBooks importer does not include a recurring-transaction entity. This does **not** prove Drummonds has no recurring revenue; it shows the required contract/schedule evidence has not been retained or verified.

All observations were read-only aggregates over saved LIVE source. No amount, customer row, invoice line, job row, secret or raw provider response was returned or logged.

## Meaning of the held status

**Field gross profit** requires an exact, reviewed mapping from a Commusoft job identity to the relevant QuickBooks job/customer or another accepted finance source, plus actual recognised revenue and actual incurred cost lines, timing and inclusion rules. A QBO line CustomerRef is a *candidate reference* only. An Item PurchaseCost is a catalogue field, not actual cost on a job. Commusoft `quotedAmount` is a quote. No figure may be inferred from them.

**ARR** requires a verified recurring contract or subscription source with start/end dates, frequency, amount, currency and changes/cancellations, plus an agreed definition of annualisation. Repeated invoices, item prices and unverified recurrence marker absence cannot establish ARR.

The next operator decision is to select a bounded, authorised source for Commusoft visits/parts/costs and the accounting job mapping, and a separate bounded recurring-contract source. The [M2 job-record handoff](NEW-DAWN-M2-JOB-RECORD.md) documents the exact-detail and private CSV facet contracts. No source acquisition or client publication is included here.

## Release and reversal

The function is restricted to a signed-in current OpenFolk platform admin, explicit tenant and confirmed connection, reason, and the new flag. It rechecks authority before the audit write. Ordinary users, wrong connections and an off flag are denied. Its result labels the selected QuickBooks realm, latest observation time, tenant-wide Commusoft scope and exact held reasons. `Cache-Control: no-store` is set.

`node scripts/verify/new-dawn-money-source-readiness-rehearse.mjs` installs the migration in a single TEST transaction that ends with `ROLLBACK`, with flag-off, wrong-connection and ordinary-user denial checks; it makes no provider call. Focused TypeScript validation refuses a mismatched tenant/connection/realm, a non-held claim, unsafe counts, unexpected financial fields or changed limits. After review, install SQL before the frontend, verify the flag remains absent/off, then consider enabling it for operator use only. Disable the flag to withdraw the panel. Do not enable the separate client `new_dawn.owner_money` flag on this evidence.
