# M3 invoice-to-job boundary · 20 October 2026

This is a count-only LIVE source review and a proposed next slice. It creates no
cross-provider link, money claim, provider request, flag or client permission.
The existing saved-invoice candidate and company-report reads remain private
OpenFolk reviews.

## What the retained source establishes

The Drummonds production QuickBooks realm had 21,663 latest invoices, of which
21,660 were nonconflicted. There were 24 reviewed QuickBooks customer-to-card
links and 1,005 reviewed Commusoft job links. Seventeen reviewed QuickBooks
customer references shared a card with at least one reviewed Commusoft job;
19 current invoices directly addressed those references. That overlap proves
customer context only. It does not identify which job an invoice covers.

Among the 21,660 current invoices, all had `CustomerRef`; 21,443 had a nonempty
QuickBooks-native `LinkedTxn`. All had custom-field structures, but only 265
filled an `Estimate no.` field and 2,633 filled a `P.O No.` field. The retained
Commusoft exact-job reader exposes a quoted amount as source text, without an
estimate document number or invoice reference. Neither native QuickBooks
links, reused job codes, customer-card co-location, nor a quoted amount prove a
QuickBooks-invoice-to-Commusoft-job relationship. No dedicated reviewed
invoice/job decision exists in the current schema. These queries returned
counts and field labels only, not invoice IDs, amounts or source payloads.

## Smallest useful next slice

First inspect **one bounded pair** through existing private operator controls:
an exact retained QuickBooks invoice version and an exact retained Commusoft
job or its authorised invoice/estimate document. Record the original document
reference, issuing source, tenant, realm/connection, source version/hash,
observation time and why it links those two identities. A QuickBooks custom
field is a candidate to inspect, not a mapping rule. If no shared source
reference is present, record `unverified` and stop; do not build a matching
algorithm from names, addresses, amounts or job codes.

Once one real pair is evidenced, a small default-OFF OpenFolk review PR can
add an immutable decision history and audited current pointer. Each decision
would bind the exact QuickBooks invoice source version to the reviewed
Commusoft job link and exact source version, include the corroborating source
reference and reviewer, and recheck both sides for tenant, realm/connection,
conflict and source drift. It must allow an explicit correction/unlink and
recognise that one invoice may cover several jobs. Its first UI state should
say **“reviewed invoice relationship”** without allocating revenue, showing
paid status or calculating job margin. A per-job amount or payment claim needs
separately evidenced line allocation and accounting treatment.

The proposed code belongs in one additive SQL migration, an exact guarded
release/readback helper, a strict client decoder and an OpenFolk-only job
detail cue behind a new OFF flag. Focused checks should cover wrong tenant,
realm and connection; old/conflicted versions; reused codes; a customer-card
overlap without direct evidence; a shared invoice; audit and correction; and
ordinary-client denial. Installation must seed no link or flag and call no
provider. Keep all owner/client money flags OFF.

The alternative owner-accounts path uses saved P&L/Aged Receivables receipts,
not an invoice/job join. It still needs Drummonds' actual owner identity and
agreement on accounting basis, tax/adjustments and report period before any
client publication. Heidi's login remains disabled, so OpenFolk's operator
identity must not substitute for that owner.
