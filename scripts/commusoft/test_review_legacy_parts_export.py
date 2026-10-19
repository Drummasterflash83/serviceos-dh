import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


MODULE_PATH = Path(__file__).with_name("review-legacy-parts-export.py")
spec = importlib.util.spec_from_file_location("review_legacy_parts_export", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

MANIFEST = {
    "tenant_id": "00000000-0000-4000-8000-000000000001",
    "connection_id": "00000000-0000-4000-8000-000000000005",
    "source": "commusoft_original_parts_html_xls",
    "file_label_date": "2026-08-04",
    "retained_evidence_id": "FILE-339",
}


def raw_parts(rows):
    def tr(cells):
        return "<tr>" + "".join(f"<td>{value}</td>" for value in cells) + "</tr>"
    return ("<html><table>" + tr(module.RAW_COLUMNS) +
            "".join(tr(row) for row in rows) + "</table></html>").encode()


def part(**changes):
    values = {name: "" for name in module.RAW_COLUMNS}
    values.update({"Part Name": "Valve", "Job Number": "001",
                   "Quantity": "2", "Status": "Requested", "Cost Price": "12.50",
                   "Sale Price": "20.00"})
    values.update(changes)
    return [values[name] for name in module.RAW_COLUMNS]


def scope(raw):
    return {**MANIFEST, "expected_sha256": hashlib.sha256(raw).hexdigest()}


class ReviewLegacyPartsExportTest(unittest.TestCase):
    def test_source_number_and_price_are_held_with_file_row_provenance(self):
        raw = raw_parts([part(), part(**{"Job Number": "", "Cost Price": "unknown"})])
        report = module.review_parts_export_bytes(scope(raw), raw)
        self.assertEqual(report["counts"], {
            "rows": 2, "held": 2, "with_source_job_number": 1,
            "without_source_job_number": 1, "with_numeric_quantity_and_prices": 1,
        })
        self.assertEqual(report["publication"], "off")
        self.assertEqual(report["records"][0]["job_link"], {
            "state": "unverified", "source_job_number": "001", "current_v2_job_id": None,
        })
        self.assertEqual(report["records"][0]["source_locator"]["data_row_ordinal"], 1)
        self.assertIsNone(report["records"][0]["source_locator"]["stable_provider_line_id"])
        self.assertIn("price_shape_unverified", report["records"][1]["review"]["reasons"])
        self.assertIn("source_job_number_missing", report["records"][1]["review"]["reasons"])
        self.assertNotIn("Customer Name", report["records"][0]["source_fields"])

    def test_rejects_wrong_schema_or_provenance(self):
        valid = raw_parts([part()])
        with self.assertRaisesRegex(ValueError, "parts_manifest_invalid"):
            module.review_parts_export_bytes({**scope(valid), "tenant_id": "not-a-uuid"}, valid)
        with self.assertRaisesRegex(ValueError, "parts_columns_invalid"):
            bad = valid.replace(b"Job Number", b"Job ID")
            module.review_parts_export_bytes(scope(bad), bad)
        with self.assertRaisesRegex(ValueError, "parts_format_invalid"):
            bad = b"Part Name,Job Number\nValve,001\n"
            module.review_parts_export_bytes(scope(bad), bad)
        with self.assertRaisesRegex(ValueError, "parts_size_invalid"):
            bad = b"x" * (module.MAX_BYTES + 1)
            module.review_parts_export_bytes(scope(bad), bad)
        with self.assertRaisesRegex(ValueError, "parts_source_hash_mismatch"):
            module.review_parts_export_bytes(scope(valid), valid + b" ")

    def test_cli_writes_private_once_and_prints_aggregate_only(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            manifest = root / "scope.json"
            source = root / "parts.xls"
            output = root / "parts-review.json"
            raw = raw_parts([part(**{"Part Name": "Private part name"})])
            manifest.write_text(json.dumps(scope(raw)))
            source.write_bytes(raw)
            command = [sys.executable, str(MODULE_PATH), "--manifest", str(manifest),
                       "--source", str(source), "--out", str(output)]
            run = subprocess.run(command, capture_output=True, text=True, check=True)
            self.assertNotIn("Private part name", run.stdout)
            self.assertEqual(json.loads(run.stdout)["counts"]["rows"], 1)
            self.assertEqual(os.stat(output).st_mode & 0o777, 0o600)
            self.assertIn("Private part name", output.read_text())
            second = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual(output.read_text().count("Private part name"), 1)

    def test_cli_rejects_output_in_git_checkout_including_symlinked_parent(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            checkout = root / "public-checkout"
            checkout.mkdir()
            (checkout / ".git").mkdir()
            linked = root / "linked-checkout"
            linked.symlink_to(checkout, target_is_directory=True)
            manifest = root / "scope.json"
            source = root / "parts.xls"
            raw = raw_parts([part()])
            manifest.write_text(json.dumps(scope(raw)))
            source.write_bytes(raw)
            for output in (checkout / "private.json", linked / "private.json",
                           MODULE_PATH.parents[2] / "private.json"):
                command = [sys.executable, str(MODULE_PATH), "--manifest", str(manifest),
                           "--source", str(source), "--out", str(output)]
                run = subprocess.run(command, capture_output=True, text=True)
                self.assertNotEqual(run.returncode, 0)
                self.assertIn("parts_private_output_outside_git_required", run.stderr)
                self.assertFalse(output.exists())

    def test_cli_rejects_oversized_source_before_parsing_or_output(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            manifest = root / "scope.json"
            source = root / "oversized.xls"
            output = root / "private.json"
            manifest.write_text(json.dumps({**MANIFEST, "expected_sha256": "0" * 64}))
            with source.open("wb") as file:
                file.truncate(module.MAX_BYTES + 1)
            command = [sys.executable, str(MODULE_PATH), "--manifest", str(manifest),
                       "--source", str(source), "--out", str(output)]
            run = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(run.returncode, 0)
            self.assertIn("parts_size_invalid", run.stderr)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
