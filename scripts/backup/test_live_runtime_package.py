"""Round-trip and tamper checks for the private Edge source recovery package."""
import hashlib
import io
import json
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from package_live_runtime_archive import PackageError, package
from verify_live_runtime_package import verify_package

AGE = Path('/private/tmp/serviceos-age-1.3.2/age')
KEYGEN = Path('/private/tmp/serviceos-age-1.3.2/age-keygen')


class RuntimePackageTest(unittest.TestCase):
    def test_round_trip_and_changed_source_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'archive'
            slug = 'synthetic-edge'
            source = archive / slug / 'supabase/functions' / slug / 'index.ts'
            source.parent.mkdir(parents=True)
            body = b'export default "synthetic only";\n'
            source.write_bytes(body)
            marker = archive / slug / 'supabase/.temp/cli-latest'
            marker.parent.mkdir(parents=True)
            marker.write_text('v2.53.5\n')
            manifest = {
                'contract': 'build01-live-runtime-archive/1',
                'project': 'tgbnakbxwcqjeimygroz',
                'startedAt': '2026-10-16T00:00:00Z',
                'completedAt': '2026-10-16T00:01:00Z',
                'inventoryStable': True, 'activeFunctions': 1,
                'entries': [{'slug':slug, 'version':3, 'verifyJwt':True,
                             'files':[{'path':'index.ts','bytes':len(body),
                                       'sha256':hashlib.sha256(body).hexdigest()}]}],
            }
            manifest_path = archive / 'manifest.private.json'
            manifest_path.write_text(json.dumps(manifest))
            manifest_sha = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
            identity = root / 'identity'
            subprocess.run([str(KEYGEN), '-o', str(identity)], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, check=True)
            recipient = next(line.split(': ',1)[1] for line in identity.read_text().splitlines()
                             if line.startswith('# public key: '))
            recipient_path = root / 'recipient.json'
            recipient_path.write_text(json.dumps({'project':'tgbnakbxwcqjeimygroz',
                                                  'recipient':recipient}))
            encrypted = root / 'sources.age'
            result = package(archive, encrypted, recipient_path, AGE, manifest_sha, 1)
            self.assertEqual(result['functions'], 1)
            self.assertEqual(result['files'], 1)
            expected = {'encryptedBytes':result['encryptedBytes'],
                        'encryptedSha256':result['encryptedSha256'],
                        'manifestSha256':manifest_sha, 'functions':1,
                        'files':1, 'sourceBytes':len(body)}
            verified = verify_package(encrypted, AGE, identity.read_bytes(), expected)
            self.assertEqual(verified['state'], 'decrypted_live_edge_source_verified')
            self.assertEqual(verified['sourceFiles'], 1)
            wrong_identity = root / 'wrong-identity'
            subprocess.run([str(KEYGEN), '-o', str(wrong_identity)], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, check=True)
            with self.assertRaisesRegex(PackageError, 'runtime_decryption_unconfirmed'):
                verify_package(encrypted, AGE, wrong_identity.read_bytes(), expected)
            changed_ciphertext = root / 'changed-ciphertext.age'
            tampered = bytearray(encrypted.read_bytes())
            tampered[-1] ^= 1
            changed_ciphertext.write_bytes(tampered)
            changed_ciphertext.chmod(0o600)
            with self.assertRaisesRegex(PackageError, 'runtime_ciphertext_changed'):
                verify_package(changed_ciphertext, AGE, identity.read_bytes(), expected)
            decrypted = subprocess.run([str(AGE), '-d', '-i', str(identity), str(encrypted)],
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                       check=True).stdout
            with tarfile.open(fileobj=io.BytesIO(decrypted), mode='r:') as tar:
                self.assertEqual(sorted(tar.getnames()),
                                 ['edge/synthetic-edge/supabase/functions/synthetic-edge/index.ts',
                                  'manifest.private.json', 'package.json'])
                self.assertEqual(tar.extractfile(tar.getmember(
                    'edge/synthetic-edge/supabase/functions/synthetic-edge/index.ts')).read(), body)
            source.write_bytes(b'changed\n')
            with self.assertRaisesRegex(PackageError, 'runtime_source_changed'):
                package(archive, root / 'changed.age', recipient_path, AGE, manifest_sha, 1)
            self.assertFalse((root / 'changed.age').exists())
            source.write_bytes(body)
            extra = archive / 'unexpected.txt'
            extra.write_text('not in the pinned manifest')
            with self.assertRaisesRegex(PackageError, 'runtime_archive_has_missing_or_extra_files'):
                package(archive, root / 'extra.age', recipient_path, AGE, manifest_sha, 1)
            self.assertFalse((root / 'extra.age').exists())
            extra.unlink()
            with self.assertRaisesRegex(PackageError, 'runtime_manifest_changed'):
                package(archive, root / 'wrong-manifest.age', recipient_path, AGE,
                        '0' * 64, 1)


if __name__ == '__main__':
    unittest.main()
