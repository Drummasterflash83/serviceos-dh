#!/usr/bin/env python3
"""Stage a retained Commusoft parts HTML export for private, held review.

This does not contact Commusoft or a database. Its source job number is not a
verified current v2 job ID; its prices are unreviewed historical source text.
Only the private JSON output contains row fields. Stdout contains counts/hash.
"""

import argparse
from datetime import date
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import uuid


RAW_COLUMNS = (
    "Part Name", "Job Address Line 1", "Job Number", "Quantity", "Status",
    "Customer Name", "Customer Account Number", "WorkAddress Account Number",
    "Job Address Name", "Job Address Line 2", "Job Address Town",
    "Job Address Postcode", "Job Description", "Manufacturer Number",
    "Cost Price", "Sale Price", "Requested Time", "Fulfilled Time", "Created By",
)
RETAINED_COLUMNS = (
    "Part Name", "Job Number", "Quantity", "Status", "Manufacturer Number",
    "Cost Price", "Sale Price", "Requested Time", "Fulfilled Time",
)
MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 20_000
MAX_CELL = 4_000
DECIMAL = re.compile(r"^-?\d{1,12}(?:\.\d{1,4})?$")


class _TableRows(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = ""

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data
            if len(self.cell) > MAX_CELL:
                raise ValueError("parts_cell_too_long")

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(" ".join(self.cell.split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None
            if len(self.rows) > MAX_ROWS + 3:
                raise ValueError("parts_row_limit")


def _manifest(manifest):
    if not isinstance(manifest, dict) or manifest.get("source") != "commusoft_original_parts_html_xls":
        raise ValueError("parts_manifest_invalid")
    try:
        tenant = str(uuid.UUID(manifest["tenant_id"]))
        connection = str(uuid.UUID(manifest["connection_id"]))
        file_label_date = date.fromisoformat(manifest["file_label_date"]).isoformat()
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("parts_manifest_invalid") from error
    evidence_id = manifest.get("retained_evidence_id")
    if not isinstance(evidence_id, str) or not re.fullmatch(r"FILE-[1-9][0-9]{0,5}", evidence_id):
        raise ValueError("parts_manifest_invalid")
    expected_sha256 = manifest.get("expected_sha256")
    if not isinstance(expected_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise ValueError("parts_manifest_invalid")
    return {
        "tenant_id": tenant, "connection_id": connection,
        "source": manifest["source"], "file_label_date": file_label_date,
        "retained_evidence_id": evidence_id, "expected_sha256": expected_sha256,
    }


def review_parts_export_bytes(manifest, raw):
    scope = _manifest(manifest)
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError("parts_size_invalid")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("parts_utf8_invalid") from error
    if not text.lstrip().lower().startswith("<html"):
        raise ValueError("parts_format_invalid")
    table = _TableRows()
    table.feed(text)
    headers = [index for index, row in enumerate(table.rows) if tuple(row) == RAW_COLUMNS]
    if len(headers) != 1:
        raise ValueError("parts_columns_invalid")
    rows = table.rows[headers[0] + 1:]
    if not rows or len(rows) > MAX_ROWS or any(len(row) != len(RAW_COLUMNS) for row in rows):
        raise ValueError("parts_rows_invalid")

    source_sha256 = hashlib.sha256(raw).hexdigest()
    if source_sha256 != scope["expected_sha256"]:
        raise ValueError("parts_source_hash_mismatch")
    records = []
    for ordinal, cells in enumerate(rows, 1):
        fields = dict(zip(RAW_COLUMNS, cells))
        retained = {name: fields[name] for name in RETAINED_COLUMNS}
        reasons = ["source_line_id_absent", "current_v2_job_link_unverified",
                   "historical_source_freshness_unverified", "price_semantics_unreviewed"]
        if not fields["Job Number"]:
            reasons.append("source_job_number_missing")
        if not fields["Part Name"]:
            reasons.append("part_name_missing")
        if not DECIMAL.fullmatch(fields["Quantity"]):
            reasons.append("quantity_shape_unverified")
        if not DECIMAL.fullmatch(fields["Cost Price"]) or not DECIMAL.fullmatch(fields["Sale Price"]):
            reasons.append("price_shape_unverified")
        records.append({
            "source_locator": {"file_sha256": source_sha256, "data_row_ordinal": ordinal,
                               "stable_provider_line_id": None},
            "source_fields": retained,
            "job_link": {"state": "unverified", "source_job_number": fields["Job Number"],
                         "current_v2_job_id": None},
            "review": {"state": "held", "reasons": reasons},
        })
    return {
        "version": "commusoft-retained-parts-review/1", "scope": scope,
        "source": {"sha256": source_sha256, "format": "commusoft-html-xls",
                   "rows": len(records), "record_updated_at": "not_supplied",
                   "current_provider_state": "unverified"},
        "publication": "off",
        "counts": {"rows": len(records), "held": len(records),
                   "with_source_job_number": sum(bool(r["job_link"]["source_job_number"]) for r in records),
                   "without_source_job_number": sum(not r["job_link"]["source_job_number"] for r in records),
                   "with_numeric_quantity_and_prices": sum(
                       DECIMAL.fullmatch(r["source_fields"]["Quantity"]) is not None and
                       DECIMAL.fullmatch(r["source_fields"]["Cost Price"]) is not None and
                       DECIMAL.fullmatch(r["source_fields"]["Sale Price"]) is not None
                       for r in records)},
        "records": records,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    report = review_parts_export_bytes(json.loads(args.manifest.read_text(encoding="utf-8")),
                                       args.source.read_bytes())
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(args.out, flags, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        json.dump(report, output, ensure_ascii=False, indent=2)
        output.write("\n")
    print(json.dumps({"version": report["version"], "sha256": report["source"]["sha256"],
                      "publication": report["publication"], "counts": report["counts"]},
                     sort_keys=True))


if __name__ == "__main__":
    main()
