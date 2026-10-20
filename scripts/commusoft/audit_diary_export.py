#!/usr/bin/env python3
"""Read-only, aggregate-only audit of a private Commusoft diary export.

This checks whether an export can support a governed visit import. It never
emits row content, person names, job numbers, or an inferred job link.
"""

import argparse
import csv
import hashlib
from html.parser import HTMLParser
from io import StringIO
import json
from pathlib import Path

RAW_COLUMNS = (
    "Customer Name", "Customer Account Number", "WorkAddress Account Number",
    "Type of Event", "Record number", "Job Address Name", "Job Address Line 1",
    "Diary Date", "Engineer Name", "Time", "Engineer Status",
    "Record created date", "Record description", "Customer reference",
    "Quoted Amount", "Diary Created By", "Diary Created On", "Event Description",
    "Event Notes", "Total Travel Time", "Total Time on Site", "Total Labour Cost",
    "Total Travel Cost", "Business unit",
)
DERIVED_COLUMNS = (
    "Source file", "Diary Date parsed", "Fiscal year", "Travel minutes",
    "Onsite minutes", "Job event flag", "Completed visit flag", "Negative status flag",
)
MAX_BYTES = 12 * 1024 * 1024
MAX_ROWS = 20_000


class _Rows(HTMLParser):
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

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(" ".join(self.cell.split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if len(self.rows) > MAX_ROWS + 3:
                raise ValueError("diary_row_limit")
            self.rows.append(self.row)
            self.row = None


def audit_diary_bytes(raw: bytes) -> dict:
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError("diary_size_invalid")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("diary_utf8_invalid") from error
    if text.lstrip().lower().startswith("<html"):
        parser = _Rows()
        parser.feed(text)
        header_positions = [i for i, row in enumerate(parser.rows) if tuple(row) == RAW_COLUMNS]
        if len(header_positions) != 1:
            raise ValueError("diary_columns_invalid")
        rows = parser.rows[header_positions[0] + 1:]
        fmt = "commusoft-html-xls"
    else:
        rows = list(csv.reader(StringIO(text, newline="")))
        if not rows or tuple(rows[0]) != RAW_COLUMNS + DERIVED_COLUMNS:
            raise ValueError("diary_columns_invalid")
        rows = rows[1:]
        fmt = "normalized-csv"
    if not rows or len(rows) > MAX_ROWS:
        raise ValueError("diary_row_limit")
    expected_width = len(RAW_COLUMNS) + (len(DERIVED_COLUMNS) if fmt == "normalized-csv" else 0)
    if any(len(row) != expected_width for row in rows):
        raise ValueError("diary_columns_invalid")

    kinds = {"Job": 0, "Normal": 0, "Estimate": 0, "Opportunity": 0, "other": 0}
    job_record_numbers = set()
    with_number = 0
    with_date = 0
    with_time = 0
    for row in rows:
        kind = row[3].strip()
        kinds[kind if kind in kinds else "other"] += 1
        if kind != "Job":
            continue
        number = row[4].strip()
        if number:
            with_number += 1
            job_record_numbers.add(number)
        with_date += bool(row[7].strip())
        with_time += bool(row[9].strip())
    return {
        "version": "commusoft-diary-schema-audit/1",
        "format": fmt,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "rows": len(rows),
        "event_types": kinds,
        "job_rows_with_record_number": with_number,
        "distinct_job_record_numbers": len(job_record_numbers),
        "job_rows_with_diary_date": with_date,
        "job_rows_with_time_text": with_time,
        "event_level_source_id_column": False,
        "zoned_start_end_columns": False,
        "current_api_job_id_link_verified": False,
        "visit_projection": "held_source_contract",
    }


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("path", type=Path, help="Private source export; no copy is written")
    args = cli.parse_args()
    print(json.dumps(audit_diary_bytes(args.path.read_bytes()), sort_keys=True))
