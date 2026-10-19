import csv
from io import StringIO
import unittest

from audit_diary_export import RAW_COLUMNS, DERIVED_COLUMNS, audit_diary_bytes


def row(kind="Job", number="00123", date="18/10/26", time="09:00 to 10:00"):
    cells = [""] * len(RAW_COLUMNS)
    cells[3], cells[4], cells[7], cells[9] = kind, number, date, time
    return cells


class DiaryAuditTest(unittest.TestCase):
    def test_raw_html_keeps_visit_and_job_link_held(self):
        header = "".join(f"<td>{v}</td>" for v in RAW_COLUMNS)
        values = "".join("<tr>" + "".join(f"<td>{v}</td>" for v in r) + "</tr>"
                         for r in [row(), row(number="00123"), row(kind="Normal", number="")])
        result = audit_diary_bytes(("<html><table><tr>" + header + "</tr>" + values +
                                    "</table></html>").encode())
        self.assertEqual(result["format"], "commusoft-html-xls")
        self.assertEqual(result["event_types"]["Job"], 2)
        self.assertEqual(result["distinct_job_record_numbers"], 1)
        self.assertEqual(result["job_rows_with_diary_date"], 2)
        self.assertFalse(result["current_api_job_id_link_verified"])
        self.assertEqual(result["visit_projection"], "held_source_contract")
        self.assertNotIn("00123", str(result))

    def test_normalized_csv_ignores_derived_completed_visit_flag(self):
        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(RAW_COLUMNS + DERIVED_COLUMNS)
        writer.writerow(row() + ["source", "2026-10-18", "2026", "0", "60", "True", "True", "False"])
        result = audit_diary_bytes(output.getvalue().encode())
        self.assertEqual(result["format"], "normalized-csv")
        self.assertEqual(result["event_types"]["Job"], 1)
        self.assertFalse(result["event_level_source_id_column"])
        self.assertFalse(result["zoned_start_end_columns"])

    def test_changed_columns_and_oversized_input_fail_closed(self):
        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(tuple(RAW_COLUMNS[:-1]) + ("Other",) + DERIVED_COLUMNS)
        writer.writerow(row() + [""] * len(DERIVED_COLUMNS))
        with self.assertRaisesRegex(ValueError, "diary_columns_invalid"):
            audit_diary_bytes(output.getvalue().encode())
        with self.assertRaisesRegex(ValueError, "diary_size_invalid"):
            audit_diary_bytes(b"x" * (12 * 1024 * 1024 + 1))


if __name__ == "__main__":
    unittest.main()
