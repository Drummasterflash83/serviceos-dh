import io
import unittest
from unittest.mock import patch
import native_copy_fingerprints as fingerprints
from native_copy_fingerprints import copy_fingerprints, compare_native_data
from database_restore_sandbox import RecoveryError


def sample(rows, header=b'COPY public.records (id, body) FROM stdin;'):
    return b'SET client_encoding = \'UTF8\';\n' + header + b'\n' + b''.join(r+b'\n' for r in rows) + b'\\.\n'


class NativeCopyTests(unittest.TestCase):
    def test_row_order_ignored_but_duplicates_and_content_are_not(self):
        expected = copy_fingerprints(io.BytesIO(sample([b'1\talpha', b'2\tbeta', b'2\tbeta'])))
        actual = copy_fingerprints(io.BytesIO(sample([b'2\tbeta', b'1\talpha', b'2\tbeta'])))
        self.assertEqual(compare_native_data(expected, actual)['rows'], 3)
        for rows in ([b'1\talpha', b'2\tbeta'], [b'1\tchanged', b'2\tbeta', b'2\tbeta']):
            with self.assertRaises(RecoveryError):
                compare_native_data(expected, copy_fingerprints(io.BytesIO(sample(rows))))

    def test_native_escapes_nulls_and_sql_looking_data_stay_data(self):
        rows = [b'1\t\\N', b'2\t', b'3\tline\\nline\\tvalue', b'-- data, not comment',
                b'COPY public.fake (x) FROM stdin;', b'\\\\.', '4\tcaf\u00e9'.encode()]
        result = copy_fingerprints(io.BytesIO(sample(rows)))
        self.assertEqual(result['rows'], len(rows))
        self.assertEqual(len(result['tables']), 1)

    def test_quoted_identifiers_and_columns(self):
        result = copy_fingerprints(io.BytesIO(sample([], b'COPY "Mixed Schema"."a.b" ("x,y", "quote""name") FROM stdin;')))
        self.assertEqual(result['tables'][0]['columns'], ['x,y', 'quote"name'])
        self.assertEqual(result['tables'][0]['table'], 'a.b')

    def test_truncation_duplicates_unknown_formats_fail_closed(self):
        for body in (sample([b'1\ta'])[:-3], sample([])+sample([]), b'INSERT INTO public.records VALUES (1);\n', b''):
            with self.assertRaises(RecoveryError):
                copy_fingerprints(io.BytesIO(body))

    def test_column_order_and_sequence_state_are_compared(self):
        left = sample([b'1\ta']) + b"SELECT pg_catalog.setval('public.records_id_seq', 12, true);\n"
        right = sample([b'1\ta']) + b"SELECT pg_catalog.setval('public.records_id_seq', 11, true);\n"
        with self.assertRaises(RecoveryError):
            compare_native_data(copy_fingerprints(io.BytesIO(left)), copy_fingerprints(io.BytesIO(right)))
        with self.assertRaises(RecoveryError):
            compare_native_data(copy_fingerprints(io.BytesIO(sample([b'1\ta']))),
                copy_fingerprints(io.BytesIO(sample([b'1\ta'], b'COPY public.records (body, id) FROM stdin;'))))


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
