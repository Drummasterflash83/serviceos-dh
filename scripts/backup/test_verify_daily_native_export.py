import json
import tempfile
import unittest
from pathlib import Path
from verify_daily_native_export import safe_failure


class SafeNativeFailureTests(unittest.TestCase):
    def test_native_copy_failures_are_classified_without_private_details(self):
        cases = {
            'Native COPY export process did not complete': 'restore_native_copy_process_failed',
            'Native COPY stream did not complete': 'restore_native_stream_bound_or_truncated',
            'Native COPY table exceeds row bound': 'restore_native_row_bound',
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'restore-native-comparison-report.json'
            for failure, code in cases.items():
                path.write_text(json.dumps({'state': 'comparing_native_archive_rows',
                                            'failure': failure, 'privateValue': 'never-publish'}))
                result = safe_failure(directory)
                self.assertEqual(result['code'], code)
                self.assertEqual(result['stage'], 'comparing_native_archive_rows')
                self.assertNotIn('privateValue', result)


if __name__ == '__main__':
    unittest.main()
