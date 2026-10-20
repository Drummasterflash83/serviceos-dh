# M5 Further Works: alternate source boundary after the denied API read

On 20 October 2026, the one authorised LIVE `GET /opportunities` returned
`access_denied`. Failed request `e44d5446-a414-4687-9625-35f0c26a2098` has an
immutable failure receipt, no retained provider result, and the M5 source flag
was read back **OFF**. A 403 establishes that this connection was denied; it does
not establish that the endpoint is absent or that its records are empty. Do not
retry the same scope. A separately reviewed provider permission or another
authorised source is needed.

## Retained historical exports

The following private Commusoft HTML-table `.xls` files already exist under
`/Users/chrisdrummond/Documents/DH Works/source_data/v2/commusoft/`. This
inventory read only local files, printed aggregate counts and schema, and made
no provider call or database write. The date in each filename is **not** a
verified freshness watermark or proof of a current master.

| File | SHA-256 | Rows and source fields relevant to M5 |
| --- | --- | --- |
| `opportunities_all_time_generated_2026-08-04.xls` | `f4dfb20b3b36a359e966e2f0d0e2b5310feecc19510256c9b999287e9be8c5dc` | 164; unique `Number`, pipeline stage, stage-change date/time and `Has proposal`. `Associated contract` and `Customer reference` are empty in all 164 rows. No accepted quote or stable job link is evidenced. |
| `estimates_all_time_enhanced_generated_2026-08-04.xls` | `148d5906c068ef280d736a2ef4554fd1626438ad82e0b6f5f52573e265926fd8` | 4,752; unique `Estimate Number`, `Estimate Date`, `Estimate Status`, `Estimate Total` and customer/site account. No source job ID, sent/accepted event date or version is in this export. |
| `further_works_open_tasks_generated_2026-08-04.xls` | `2fb1c9798f728c9dafd210b0acd338f6a89d1ea9cd9744e92fc9ff638bf73d9d` | 77; `Type :`, `Job or Estimate no`, task and creation fields. It contains 65 `Job` and 12 `Estimate` rows; all 77 say `Done=No` in this historical extract. Only five have `Assigned to` populated. |
| `additional_works_all_time_generated_2026-08-04.xls` | `d090d4e60f0927c7ccc616da42d4be3d924460ab3bd0443d1cacb00f9082f3b7` | 61 rows over 56 distinct `Job No` values, with additional-works status and source price/cost columns. Their current job identity and financial meaning are unreviewed. |

All 12 `Estimate`-typed further-works task numbers occur in the estimate export.
However, **33 of the 65 `Job`-typed task numbers also numerically collide with
estimate numbers**. Matching the number without `Type :` would misclassify work.
Even the 12 typed matches are only same-export candidates: neither export proves
the current v2 job identity, an accepted quote, actual send/decision time, a
contract obligation, or a complete denominator. The separate normalized CSVs
under `output/v2_analysis/normalized/` are derived analysis, not a provider
source or an alternative master.

## What can move safely

Keep Further Works total, open-quote age, 48-hour follow-up, conversion and PPM
measures **withheld** on LIVE. The saved Commusoft job `quotedAmount` is source
quote text, not an accepted estimate, revenue or a Further Works outcome. An
opportunity stage is not a sent or accepted quote event. A historically open
task is not currently open. Do not infer a link from a job-type code, reused
number, customer name, address or date.

The existing private, held `prepare-job-facet-csv.mjs` and
`review-job-facet-csv.mjs` contract supports an `estimates` facet only when an
authorised export supplies stable `source_record_id` **and** exact Commusoft
`job_id` along with its reviewed fields. The archived estimate export lacks
that job ID and does not match the strict header. It must not be adapted into a
supposed current linked job/quote feed or published to cards.

The smallest next source slice is one **current, bounded, read-only** provider
export or newly permitted API page, reviewed before any ingest. It needs the
Drummonds account/connection identity, exact export timestamp and coverage
window, stable opportunity/estimate/task IDs, source type (`Job` versus
`Estimate`), exact parent v2 job ID where claimed, customer/site IDs, status and
source version or updated time, plus explicit created, sent and customer
decision timestamps (with timezones) where those events exist. Quote
amount/currency, proposal version, correction/deletion semantics and a source
field dictionary need review before money or conversion is shown. Unknown or
missing fields remain held. If Commusoft cannot supply the relationship and
event fields, a source owner must identify the governing quote tracker and its
immutable row identity, current master, window and authority before a separate
held import is designed.

This note is a source-boundary inventory, not a LIVE M5 release or permission
to re-enable the denied route. It includes no customer rows or credentials.
