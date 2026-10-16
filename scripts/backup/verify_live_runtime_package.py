"""Verify one age-encrypted Edge source package without extracting its contents.

The identity arrives on stdin and is passed to age on stdin. The verified tar is
kept in process memory; no key, source file, Auth material or runtime secret is
written to disk. The CLI is pinned to the exact retained LIVE source package.
"""
import argparse
import hashlib
import io
import json
import os
import re
import stat
import subprocess
import sys
import tarfile
from pathlib import Path

from package_live_runtime_archive import AGE_SHA256, PROJECT, PackageError, digest, safe_relative

ACTUAL = {
    'encryptedBytes': 5971576,
    'encryptedSha256': '40f3d703e9febd5c2e93f5ec5491b4423e763a3bc808e7539dfd7233343f3ec5',
    'manifestSha256': 'bf66a05aba6ccf44cf8394261f43dac66ccc2927c5e27f99ccbcedba8c10e303',
    'functions': 102,
    'files': 720,
    'sourceBytes': 4788552,
}
MAX_IDENTITY_BYTES = 4096
MAX_CLEAR_BYTES = 64 * 1024 * 1024
SLUG = re.compile(r'^[a-z0-9][a-z0-9-]{0,99}$')
HEX = re.compile(r'^[a-f0-9]{64}$')


def require(condition, code):
    if not condition:
        raise PackageError(code)


def private_file(path):
    parent = path.parent.lstat()
    source = path.lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == os.getuid()
            and parent.st_mode & 0o077 == 0, 'runtime_private_directory_required')
    require(stat.S_ISREG(source.st_mode) and source.st_uid == os.getuid()
            and source.st_mode & 0o077 == 0, 'runtime_encrypted_file_invalid')


def verify_package(encrypted, age, identity, expected):
    encrypted = Path(encrypted)
    age = Path(age)
    require(isinstance(identity, bytes) and 1 <= len(identity) <= MAX_IDENTITY_BYTES
            and b'AGE-SECRET-KEY-' in identity, 'runtime_identity_invalid')
    require(age.is_file() and digest(age) == AGE_SHA256, 'age_binary_pin_mismatch')
    private_file(encrypted)
    require(encrypted.stat().st_size == expected['encryptedBytes']
            and HEX.fullmatch(expected['encryptedSha256'])
            and digest(encrypted) == expected['encryptedSha256'], 'runtime_ciphertext_changed')
    with encrypted.open('rb') as source:
        require(source.read(22) == b'age-encryption.org/v1\n', 'runtime_age_header_invalid')
    try:
        result = subprocess.run([str(age), '-d', '-i', '-', str(encrypted)], input=identity,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                timeout=120, env={'PATH':'/usr/bin:/bin', 'LANG':'C'}, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise PackageError('runtime_decryption_unconfirmed') from None
    require(result.returncode == 0 and len(result.stdout) <= MAX_CLEAR_BYTES,
            'runtime_decryption_unconfirmed')
    try:
        with tarfile.open(fileobj=io.BytesIO(result.stdout), mode='r:') as tar:
            members = tar.getmembers()
            require(len(members) == expected['files'] + 2 and
                    len({member.name for member in members}) == len(members) and
                    all(member.isfile() and member.mode & 0o777 == 0o600 and
                        member.uid == 0 and member.gid == 0 and member.mtime == 0
                        for member in members), 'runtime_tar_inventory_invalid')
            contents = {member.name: tar.extractfile(member).read() for member in members}
    except (tarfile.TarError, OSError, EOFError, AttributeError):
        raise PackageError('runtime_tar_invalid') from None
    package_raw = contents.pop('package.json', None)
    manifest_raw = contents.pop('manifest.private.json', None)
    require(package_raw is not None and manifest_raw is not None and
            len(package_raw) <= 8192 and len(manifest_raw) <= 1024 * 1024 and
            hashlib.sha256(manifest_raw).hexdigest() == expected['manifestSha256'],
            'runtime_manifest_changed')
    try:
        descriptor = json.loads(package_raw)
        manifest = json.loads(manifest_raw)
    except (ValueError, TypeError):
        raise PackageError('runtime_package_metadata_invalid') from None
    require(descriptor.get('contract') == 'serviceos-live-edge-source-package/1' and
            descriptor.get('project') == PROJECT and
            descriptor.get('sourceManifestSha256') == expected['manifestSha256'] and
            descriptor.get('functions') == expected['functions'] and
            descriptor.get('files') == expected['files'] and
            descriptor.get('sourceInventoryCompletedAt') == manifest.get('completedAt') and
            manifest.get('contract') == 'build01-live-runtime-archive/1' and
            manifest.get('project') == PROJECT and manifest.get('inventoryStable') is True and
            manifest.get('activeFunctions') == expected['functions'] and
            isinstance(manifest.get('entries'), list) and
            len(manifest['entries']) == expected['functions'],
            'runtime_package_metadata_invalid')
    found_files = 0
    found_bytes = 0
    slugs = set()
    for entry in manifest['entries']:
        slug = entry.get('slug')
        require(isinstance(slug, str) and SLUG.fullmatch(slug) and slug not in slugs and
                type(entry.get('version')) is int and entry['version'] >= 1 and
                type(entry.get('verifyJwt')) is bool and
                isinstance(entry.get('files'), list) and entry['files'],
                'runtime_manifest_entry_invalid')
        slugs.add(slug)
        for item in entry['files']:
            relative = safe_relative(item.get('path'))
            name = f'edge/{slug}/supabase/functions/{slug}/{relative}'
            source = contents.pop(name, None)
            require(source is not None and type(item.get('bytes')) is int and
                    0 < item['bytes'] <= 1024 * 1024 and
                    isinstance(item.get('sha256'), str) and HEX.fullmatch(item['sha256']) and
                    len(source) == item['bytes'] and
                    hashlib.sha256(source).hexdigest() == item['sha256'],
                    'runtime_source_changed')
            found_files += 1
            found_bytes += len(source)
    require(not contents and found_files == expected['files'] and
            found_bytes == expected['sourceBytes'], 'runtime_tar_inventory_invalid')
    return {
        'state': 'decrypted_live_edge_source_verified',
        'functions': len(slugs), 'sourceFiles': found_files,
        'sourceBytes': found_bytes,
        'encryptedBytes': expected['encryptedBytes'],
        'encryptedSha256': expected['encryptedSha256'],
        'manifestSha256': expected['manifestSha256'],
        'keyPersisted': False, 'sourceExtractedToDisk': False,
        'offSiteCopyVerified': False, 'applicationRecoveryVerified': False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--encrypted', required=True, type=Path)
    parser.add_argument('--age', required=True, type=Path)
    args = parser.parse_args()
    identity = sys.stdin.buffer.read(MAX_IDENTITY_BYTES + 1)
    try:
        print(json.dumps(verify_package(args.encrypted, args.age, identity, ACTUAL), sort_keys=True))
    except BaseException as error:
        code = str(error) if isinstance(error, PackageError) else 'runtime_restore_unconfirmed'
        print(json.dumps({'state':'runtime_restore_unverified', 'code':code}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
