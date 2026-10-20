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

## Supported source route and exact export request

The [current Commusoft v2 API index](https://developer.commusoft.com/llms.txt)
lists Jobs, Opportunities and completed Forms, but no Invoice or Estimate
document GET. The [documented exact-job GET](https://developer.commusoft.com/jobs-24695919e0)
returns `customerReference` and `quotedAmount`, without an invoice/estimate
document identity or payment state. An Opportunity is a pre-job sales record,
not proof of a job invoice. We therefore must not construct a guessed
`/invoices` or `/estimates` URL, use an office task as a document, or launch a
LIVE provider trial for this link. This is a limit of the published v2 index,
not a claim that Drummonds cannot export the information by another route.

The existing private [M2 CSV preparation and held review](NEW-DAWN-M2-FACET-REVIEW.md)
can stage invoice/estimate rows but deliberately cannot approve a cross-provider
link. Ask Drummonds for **one bounded current export**, with a field dictionary,
source account/connection, export time with timezone and coverage window. For
each document to be checked, the minimum fields are:

| Evidence | Exact fields needed |
| --- | --- |
| Commusoft identity | Stable invoice/estimate document ID; exact v2 job ID; original job code as a string; customer/property ID; document number and document type. |
| Accounting bridge | QuickBooks `Invoice.Id` plus production realm or an integration receipt explicitly pairing that ID with the Commusoft document ID. If the source supplies only invoice numbers, retain them as review candidates until uniqueness and the original document are checked. |
| State and provenance | Source-created and source-updated times with timezone, issue date, document status, export time, original amount and currency as strings, and any void/credit/replacement reference. |
| Shared documents | Stable line IDs, exact line-to-job IDs and line amounts/currency, or an explicit `allocation_unknown` hold. One invoice can cover more than one job. |

Keep the full export private. The existing seven-column M2 CSV contract
(`source_record_id,job_id,job_code,issued_at,status,amount,currency`) is
enough for syntactic held review, **not** this QuickBooks pairing. Do not
silently extend that exact-header parser or treat its `ready_for_source_review`
state as approval. If the bridge or exact job ID is absent, record the missing
field and leave the invoice/job relationship unverified. A later source trial
can be one-use, read-only, operator-only and default-OFF after the actual export
shape and original field meanings are reviewed.

The alternative owner-accounts path uses saved P&L/Aged Receivables receipts,
not an invoice/job join. It still needs Drummonds' actual owner identity and
agreement on accounting basis, tax/adjustments and report period before any
client publication. Heidi's login remains disabled, so OpenFolk's operator
identity must not substitute for that owner.
