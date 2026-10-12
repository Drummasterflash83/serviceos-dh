"""Synthetic encrypted round trips using the real pinned age binary; no providers."""
import io
import json
import os
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from database_backup_package import (FILES, FORMAT, IMAGE, PROJECT, PackageError,
    call_age, canonical, describe, package_snapshot, restore_package, write_private)

AGE = Path('/private/tmp/serviceos-age-1.3.2/age')
KEYGEN = AGE.with_name('age-keygen')
REVISION = 'a' * 40


def synthetic_identity():
    result = subprocess.run([str(KEYGEN)], capture_output=True, timeout=10, check=True)
    identity = result.stdout
    recipient = subprocess.run([str(KEYGEN), '-y'], input=identity,
                               capture_output=True, timeout=10, check=True).stdout.decode().strip()
    return identity, recipient


def fixture(root):
    root.mkdir(mode=0o700)
    write_private(root / 'database.dump', b'PGDMP-synthetic-fixture-no-customer-data\x00')
    write_private(root / 'net-tables.sql', b'-- synthetic operational supplement\n')
    write_private(root / 'source-inventory.json', canonical({'tables': [{'schema': 'public', 'table': 'synthetic'}], 'roles': []}))
    archive = describe(root / 'database.dump')
    snapshot = {'snapshot': 'synthetic-1', 'observedAt': '2026-10-12T00:00:00Z', 'readOnly': 'on'}
    boundary = {'network': 'none', 'hostMounts': 0, 'publishedPorts': 0,
                'cronLaunchActiveJobs': False, 'maxWorkerProcesses': 0}
    export = {'project': PROJECT, 'state': 'export_complete_restore_unverified',
              'productionDataWrites': False, 'snapshot': snapshot, 'archive': archive,
              'netSupplement': {**describe(root / 'net-tables.sql'), 'format': 'native-postgresql-copy',
                'tables': ['_http_response', 'http_request_queue'], 'rowsUseExportedSnapshot': True}}
    restored = {'sourceArchive': archive, 'sourceSnapshot': snapshot,
                'state': 'native_archive_restored_full_recovery_unverified', 'productionWrites': False,
                'allInventoriedPhysicalTablesCaptured': True, 'knownArchiveOmissions': [],
                'tableCatalogMatched': True, 'extensionVersionsMatched': True,
                'containerRemoved': True, 'imageId': IMAGE, 'containmentBefore': boundary,
                'containmentAfter': boundary,
                'nativeDataComparison': {'state': 'all_archived_copy_rows_and_sequences_match'},
                'networkSupplementComparison': {'state': 'all_archived_copy_rows_and_sequences_match'}}
    vault = {'archive': archive, 'state': 'all_archived_vault_secrets_decrypt_and_match_live',
             'ciphertextMatchesLive': True, 'plaintextComparisonMatches': True,
             'containerRemoved': True, 'productionWrites': False, 'containment': boundary}
    for name, value in [('report.json', export), ('restore-native-comparison-report.json', restored),
                        ('vault-recovery-report.json', vault)]:
        write_private(root / name, canonical(value))


class PackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not AGE.is_file():
            raise RuntimeError('Pinned age binary required; tests must not silently skip')
        cls.identity, cls.recipient = synthetic_identity()
        cls.wrong_identity, _ = synthetic_identity()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='serviceos-synthetic-package-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        fixture(self.source)
        self.encrypted = self.root / 'snapshot.age'
        self.destination = self.root / 'restored'

    def package(self):
        return package_snapshot(self.source, self.encrypted, recipient=self.recipient,
                                revision=REVISION, age=AGE)

    def recover(self, expected, **changes):
        return restore_package(self.encrypted, self.destination, expected=expected,
                               identity=changes.get('identity', self.identity), age=AGE)

    def change_json(self, name, change):
        path = self.source / name
        value = json.loads(path.read_text())
        change(value)
        path.write_bytes(canonical(value))

    def test_round_trip_preserves_every_file_and_private_permissions(self):
        descriptor = self.package()
        encrypted = self.encrypted.read_bytes()
        self.assertTrue(encrypted.startswith(b'age-encryption.org/v1\n'))
        self.assertNotIn(b'PGDMP-synthetic-fixture', encrypted)
        self.assertNotIn(self.identity, encrypted)
        manifest = self.recover(descriptor)
        self.assertEqual(manifest['files'], {n: describe(self.source / n) for n in FILES})
        self.assertEqual(self.destination.stat().st_mode & 0o777, 0o700)
        for name in FILES:
            self.assertEqual((self.source / name).read_bytes(), (self.destination / name).read_bytes())
            self.assertEqual((self.destination / name).stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.encrypted.stat().st_mode & 0o777, 0o600)
        self.assertFalse(list(self.root.glob('.database-*')))

    def test_wrong_key_and_existing_destination_preserve_sources(self):
        descriptor = self.package()
        with self.assertRaisesRegex(PackageError, 'age_operation_failed'):
            self.recover(descriptor, identity=self.wrong_identity)
        self.assertFalse(self.destination.exists())
        self.assertTrue(self.encrypted.exists())
        self.destination.mkdir(mode=0o700)
        marker = self.destination / 'keep'
        marker.write_text('keep')
        with self.assertRaises(PackageError):
            self.recover(descriptor)
        self.assertEqual(marker.read_text(), 'keep')

    def test_corruption_and_truncation_rejected_even_with_changed_ciphertext_digest(self):
        descriptor = self.package()
        original = self.encrypted.read_bytes()
        damaged = bytearray(original)
        damaged[-10] ^= 1
        for data in [bytes(damaged), original[:-32]]:
            self.encrypted.write_bytes(data)
            forged_descriptor = {**descriptor, **describe(self.encrypted)}
            with self.assertRaisesRegex(PackageError, 'age_operation_failed'):
                self.recover(forged_descriptor)
            self.assertFalse(self.destination.exists())
            self.assertFalse(list(self.root.glob('.database-*')))

    def test_receipt_digest_and_snapshot_binding_checked(self):
        descriptor = self.package()
        for field, value in [('sha256', '0' * 64), ('snapshotAt', 'wrong'),
                             ('sourceRevision', 'b' * 40), ('project', 'other-project')]:
            with self.subTest(field=field), self.assertRaises(PackageError):
                self.recover({**descriptor, field: value})
            self.assertFalse(self.destination.exists())

    def test_unverified_restore_and_mixed_snapshot_rejected_before_output(self):
        for name, change in [
            ('report.json', lambda x: x.update(project='other-project')),
            ('report.json', lambda x: x['netSupplement'].update(rowsUseExportedSnapshot=False)),
            ('restore-native-comparison-report.json', lambda x: x.update(allInventoriedPhysicalTablesCaptured=False)),
            ('restore-native-comparison-report.json', lambda x: x['sourceSnapshot'].update(snapshot='other-snapshot')),
            ('restore-native-comparison-report.json', lambda x: x['containmentAfter'].update(network='bridge')),
            ('vault-recovery-report.json', lambda x: x.update(plaintextComparisonMatches=False)),
        ]:
            with self.subTest(name=name):
                original = (self.source / name).read_bytes()
                self.change_json(name, change)
                with self.assertRaises(PackageError):
                    self.package()
                self.assertFalse(self.encrypted.exists())
                (self.source / name).write_bytes(original)

    def test_symlink_missing_file_and_existing_output_rejected(self):
        descriptor = self.package()
        before = self.encrypted.read_bytes()
        with self.assertRaisesRegex(PackageError, 'output_already_exists'):
            self.package()
        self.assertEqual(before, self.encrypted.read_bytes())
        self.encrypted.unlink()
        path = self.source / 'net-tables.sql'
        saved = self.root / 'saved.sql'
        path.rename(saved)
        with self.assertRaises(PackageError):
            self.package()
        path.symlink_to(saved)
        with self.assertRaises(PackageError):
            self.package()
        self.assertFalse(self.encrypted.exists())

    def forged_tar(self, descriptor, variant):
        self.recover(descriptor)
        plain = self.root / 'forged.tar'
        with tarfile.open(plain, 'w', format=tarfile.USTAR_FORMAT) as tar:
            for name in (*FILES, 'manifest.json'):
                if variant == 'missing' and name == 'net-tables.sql':
                    continue
                data = (self.destination / name).read_bytes()
                if variant == 'digest' and name == 'database.dump':
                    data += b'unexpected'
                info = tarfile.TarInfo(name)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
            if variant in ('traversal', 'symlink', 'duplicate'):
                info = tarfile.TarInfo('../escape' if variant == 'traversal' else 'database.dump')
                if variant == 'symlink':
                    info.type = tarfile.SYMTYPE
                    info.linkname = '/etc/passwd'
                else:
                    info.size = 1
                tar.addfile(info, io.BytesIO(b'x'))
        import shutil
        shutil.rmtree(self.destination)
        self.encrypted.unlink()
        with plain.open('rb') as inp:
            call_age(AGE, ['--encrypt', '--recipient', self.recipient, '--output', '-'], self.encrypted, input_file=inp)
        return {**descriptor, **describe(self.encrypted)}

    def test_authenticated_malicious_tar_cannot_escape_or_omit_or_replace(self):
        descriptor = self.package()
        original = self.encrypted.read_bytes()
        for variant in ('traversal', 'symlink', 'duplicate', 'missing', 'digest'):
            with self.subTest(variant=variant):
                self.encrypted.write_bytes(original)
                forged = self.forged_tar(descriptor, variant)
                with self.assertRaises(PackageError):
                    self.recover(forged)
                self.assertFalse(self.destination.exists())
                self.assertFalse((self.root / 'escape').exists())

    def test_tool_pin_and_public_directory_are_enforced(self):
        bad = self.root / 'not-age'
        bad.write_bytes(b'#!/bin/sh\nexit 0\n')
        bad.chmod(0o700)
        with self.assertRaisesRegex(PackageError, 'age_binary_pin_mismatch'):
            package_snapshot(self.source, self.encrypted, recipient=self.recipient,
                             revision=REVISION, age=bad)
        self.source.chmod(0o755)
        with self.assertRaisesRegex(PackageError, 'private_directory_required'):
            self.package()

    def test_real_encrypted_package_round_trip_through_sdk_transport(self):
        descriptor = self.package()
        descriptor_path = self.root / 'descriptor.json'
        write_private(descriptor_path, canonical(descriptor))
        downloaded = self.root / 'downloaded.age'
        script = '''
import { readFile } from 'node:fs/promises';
import { fixture } from './scripts/backup/test-support/s3-fixture.mjs';
import { uploadDatabasePackage, downloadDatabasePackage } from './scripts/backup/database-backup-transfer.mjs';
const [path, descriptorPath, output] = process.argv.slice(1);
const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
const f = fixture({ database: true });
try {
 const copied = await uploadDatabasePackage(path, descriptor, f, { now: f.now });
 await downloadDatabasePackage(copied.receipt, output, f, { now: f.now });
 console.log(JSON.stringify({state: copied.state, storedObjects: f.objects.size, realNetwork: false}));
} finally { f.close(); }
'''
        result = subprocess.run(['node', '--input-type=module', '--eval', script,
            str(self.encrypted), str(descriptor_path), str(downloaded)],
            cwd=Path(__file__).resolve().parents[2], capture_output=True, timeout=30)
        # Deliberately do not print raw subprocess diagnostics on failure.
        self.assertEqual(result.returncode, 0, 'Synthetic transport integration failed')
        self.assertEqual(json.loads(result.stdout)['storedObjects'], 2)
        self.assertEqual(downloaded.read_bytes(), self.encrypted.read_bytes())
        manifest = restore_package(downloaded, self.destination, expected=descriptor,
                                   identity=self.identity, age=AGE)
        self.assertEqual(manifest['files'], {n: describe(self.source / n) for n in FILES})


if __name__ == '__main__':
    unittest.main()
