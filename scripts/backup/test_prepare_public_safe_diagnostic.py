"""Synthetic fixed-code diagnostics only; no source export or provider."""
import errno
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from database_backup_package import (FILES, DAILY_FILES, DAILY_FORMAT, MAX_BYTES,
                                     PACKAGE_DISK_RESERVE, PackageError, call_age,
                                     package_snapshot, require_package_disk_capacity)
from prepare_public_database_package import safe_preparation_code, safe_preparation_diagnostic


class SafePreparationTests(unittest.TestCase):
    def test_only_fixed_codes_survive_python_boundary(self):
        self.assertEqual(safe_preparation_code(PackageError('package_size_invalid')),
                         'encrypt_package_size_invalid')
        self.assertEqual(safe_preparation_code(PackageError('private path /secret')),
                         'encrypt_unexpected_failure')
        self.assertEqual(safe_preparation_code(RuntimeError('private provider text')),
                         'encrypt_unexpected_failure')
        result = subprocess.run([sys.executable, '-B',
                                 str(Path(__file__).with_name('prepare_public_database_package.py'))],
                                input=b'{}', capture_output=True, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr, b'')
        self.assertEqual(json.loads(result.stdout), {
            'state': 'package_preparation_failed_safe',
            'code': 'encrypt_unexpected_failure', 'secretsPrinted': False})

    def test_age_timeout_returns_fixed_code_without_process_text(self):
        with tempfile.TemporaryDirectory() as root:
            with (patch('database_backup_package.validate_tool'),
                  patch('database_backup_package.subprocess.run',
                        side_effect=subprocess.TimeoutExpired('PRIVATE', 180))):
                with self.assertRaisesRegex(PackageError, '^age_operation_timeout$'):
                    call_age(Path('/synthetic/age'), ['--encrypt'], Path(root) / 'cipher.age',
                             input_file=io.BytesIO(b'synthetic'))

    def test_disk_full_is_classified_without_widening_package_limit(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'source'
            source.mkdir(mode=0o700)
            for name in FILES:
                (source / name).write_bytes(b'x')
            with patch('database_backup_package.copy_bounded',
                       side_effect=OSError(errno.ENOSPC, 'PRIVATE /source/path')):
                with self.assertRaisesRegex(PackageError, '^disk_full$'):
                    package_snapshot(source, Path(root) / 'cipher.age',
                                     recipient='age1' + 'a' * 58, revision='a' * 40,
                                     age=Path('/synthetic/age'))

    def test_size_failure_reports_only_bounded_aggregate_input_bytes(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'source'
            source.mkdir(mode=0o700)
            for name in DAILY_FILES:
                (source / name).write_bytes(b'x' * 10)
            with (patch('database_backup_package.MAX_BYTES', 50),
                  patch('database_backup_package.MAX_JSON', 1)):
                with self.assertRaisesRegex(PackageError, '^package_size_invalid$') as raised:
                    package_snapshot(source, Path(root) / 'cipher.age',
                                     recipient='age1' + 'a' * 58, revision='a' * 40,
                                     age=Path('/synthetic/age'), format_version=DAILY_FORMAT)
            self.assertEqual(safe_preparation_diagnostic(raised.exception), {
                'state': 'package_preparation_failed_safe',
                'code': 'encrypt_package_size_invalid', 'packageInputBytes': 70,
                'secretsPrinted': False})
            self.assertFalse((Path(root) / 'cipher.age').exists())

    def test_measured_archive_fits_new_cap_only_with_staging_capacity(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'source'
            source.mkdir(mode=0o700)
            (source / 'database.dump').touch()
            with (source / 'database.dump').open('r+b') as archive:
                archive.truncate(2_274_014_810)
            for name in DAILY_FILES:
                if name != 'database.dump':
                    (source / name).write_bytes(b'x')
            total = 2_274_014_810 + len(DAILY_FILES) - 1
            required = 3 * total + PACKAGE_DISK_RESERVE
            with patch('database_backup_package.os.statvfs', return_value=SimpleNamespace(
                    f_bavail=required, f_frsize=1)):
                self.assertEqual(require_package_disk_capacity(source, root, DAILY_FILES), total)
            with patch('database_backup_package.os.statvfs', return_value=SimpleNamespace(
                    f_bavail=required - 1, f_frsize=1)):
                with self.assertRaisesRegex(PackageError, '^disk_capacity_insufficient$'):
                    require_package_disk_capacity(source, root, DAILY_FILES)
            self.assertEqual(safe_preparation_code(PackageError('disk_capacity_insufficient')),
                             'encrypt_disk_capacity_insufficient')

    def test_aggregate_at_cap_is_rejected_before_staging(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'source'
            source.mkdir(mode=0o700)
            (source / 'database.dump').touch()
            with (source / 'database.dump').open('r+b') as archive:
                archive.truncate(MAX_BYTES)
            for name in DAILY_FILES:
                if name != 'database.dump':
                    (source / name).write_bytes(b'x')
            with patch('database_backup_package.os.statvfs') as statvfs:
                with self.assertRaisesRegex(PackageError, '^package_size_invalid$'):
                    require_package_disk_capacity(source, root, DAILY_FILES)
                statvfs.assert_not_called()


if __name__ == '__main__':
    unittest.main()
