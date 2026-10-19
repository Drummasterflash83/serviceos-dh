# M2 retained parts evidence: private held review

The Drummonds DH Works archive already contains an **original** Commusoft parts
HTML export, `FILE-339`, labelled 4 August 2026. Its SHA-256 is
`8ceab3eff80a556837a118c655fc107ce67518695961d776846a61aa1479a412`,
matching the archived source register. The file remains outside Git at
`/Users/chrisdrummond/Documents/DH Works/source_data/v2/commusoft/parts_all_time_enhanced_generated_2026-08-04.xls`.
The later normalized `parts.csv` adds derived calculations and is not source
authority for this review.

`scripts/commusoft/review-legacy-parts-export.py` reads the original locally.
It makes no provider or database request, writes no production data and has no
publish switch. It requires the original 19-column header, bounded UTF-8 HTML,
an exact archived file hash and a private manifest naming the tenant and
connection. It retains only part, job-number, quantity, status, manufacturer,
price and time **source text** in a mode-`0600` JSON file created once outside
Git. The terminal prints only counts and the file hash. Each row is located by
file hash plus data-row ordinal, **not** a claimed provider line ID.

Aggregate read of the original: **1,687 rows**, all held; all 1,687 contain a
source `Job Number`; 1,628 have numeric-shaped quantity, cost-price and sale-
price text. This is evidence of retained historical parts records, not 1,687
current job-linked parts. The archived report has no stable line-level source
ID or verified equality between its `Job Number` and the current v2
`GET /jobs/{jobID}` ID. It supplies no source currency or row-updated time.
The file date comes from its archive label; current provider state is
unverified. Price meaning, adjustments, cancellations, tax and any customer
charge are unreviewed. No job card, margin or invoice value may use these rows
yet. Source job numbers remain strings, including leading zeros.

To produce a private row review, use a manifest with the actual reviewed
Drummonds tenant and Commusoft connection IDs:

```json
{
  "tenant_id": "<reviewed Drummonds tenant UUID>",
  "connection_id": "<reviewed Commusoft connection UUID>",
  "source": "commusoft_original_parts_html_xls",
  "file_label_date": "2026-08-04",
  "retained_evidence_id": "FILE-339",
  "expected_sha256": "8ceab3eff80a556837a118c655fc107ce67518695961d776846a61aa1479a412"
}
```

```sh
python3 scripts/commusoft/review-legacy-parts-export.py \
  --manifest /private/path/parts-scope.json \
  --source '/Users/chrisdrummond/Documents/DH Works/source_data/v2/commusoft/parts_all_time_enhanced_generated_2026-08-04.xls' \
  --out /private/path/parts-held-review.json
```

The next source-owner ask is one **bounded current** Commusoft parts/stock-line
export for reviewed Drummonds jobs, with a stable provider line ID, explicit
parent v2 job ID, status/cancellation and last-updated timestamp, quantity,
currency, and a field dictionary for cost versus sale price, tax and credits.
The owner should identify its account/connection, covered window and correction
behavior. Only after that source arrives should a same-tenant exact-job-link
review and immutable retained receipt be designed. The existing five-facet
CSV staging path remains available for such a source; this historical source
must not be forced into that stricter contract by inventing IDs.

Verification: three focused synthetic tests cover leading-zero job-number
preservation, held provenance, wrong schema/hash, private file mode and no
overwrite. A local aggregate-only read of the real original matched the
archived SHA-256 and counts above; no private row data was logged or copied to
the repository.
