"""Bounded native COPY diagnostics without storing or printing source rows."""
import io
import unittest
from unittest.mock import patch

import native_copy_fingerprints as fingerprints
from database_restore_sandbox import RecoveryError


class NativeCopyBoundsTest(unittest.TestCase):
    def test_small_complete_copy(self):
        result = fingerprints.copy_fingerprints(io.BytesIO(
            b'COPY public.example (id) FROM stdin;\n1\n\\.\n'))
        self.assertEqual(result['rows'], 1)
        self.assertEqual(len(result['tables']), 1)

    def test_line_bound_has_specific_safe_failure(self):
        with patch.object(fingerprints, 'MAX_LINE', 4):
            with self.assertRaisesRegex(RecoveryError, '^Native COPY line exceeds bound$'):
                fingerprints.copy_fingerprints(io.BytesIO(
                    b'COPY public.example (id) FROM stdin;\n1\n\\.\n'))

    def test_total_bound_has_specific_safe_failure(self):
        with patch.object(fingerprints, 'MAX_BYTES', 10):
            with self.assertRaisesRegex(RecoveryError, '^Native COPY stream exceeds total bound$'):
                fingerprints.copy_fingerprints(io.BytesIO(
                    b'COPY public.example (id) FROM stdin;\n1\n\\.\n'))

    def test_truncated_line_has_specific_safe_failure(self):
        with self.assertRaisesRegex(RecoveryError, '^Native COPY stream line is truncated$'):
            fingerprints.copy_fingerprints(io.BytesIO(
                b'COPY public.example (id) FROM stdin;\n1'))


if __name__ == '__main__':
    unittest.main()
