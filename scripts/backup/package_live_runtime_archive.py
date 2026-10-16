"""Verify and age-encrypt one retained LIVE Edge source inventory.

No network, production API, credential read or provider write. The caller pins
the exact manifest digest; this tool never treats an archive directory as fresh
merely because its name says LIVE. The output is a recovery input, not proof
that the application can be restored or that this copy is off site.
"""
import argparse
import hashlib
import io
import json
import os
import re
import stat
import subprocess
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

PROJECT = 'tgbnakbxwcqjeimygroz'
AGE_SHA256 = '4012dfc2725883beafb710894af4f599b7a94f8c8e0f51f02cc96ab8df33915e'
HEX = re.compile(r'^[a-f0-9]{64}$')
SLUG = re.compile(r'^[a-z0-9][a-z0-9-]{0,99}$')
RECIPIENT = re.compile(r'^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$')


class PackageError(RuntimeError):
    pass


def require(condition, code):
    if not condition:
        raise PackageError(code)


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def regular(path):
    mode = path.lstat().st_mode
    require(stat.S_ISREG(mode), 'runtime_file_not_regular')
    return path


def safe_relative(value):
    require(isinstance(value, str) and value and '\\' not in value, 'runtime_path_invalid')
    p = PurePosixPath(value)
    require(not p.is_absolute() and all(part not in ('', '.', '..') for part in p.parts)
            and str(p) == value, 'runtime_path_invalid')
    return p


def verify_archive(root, expected_sha, expected_functions):
    require(not root.is_symlink(), 'runtime_archive_invalid')
    root = root.resolve(strict=True)
    require(root.is_dir(), 'runtime_archive_invalid')
    manifest_path = regular(root / 'manifest.private.json')
    require(HEX.fullmatch(expected_sha) and digest(manifest_path) == expected_sha,
            'runtime_manifest_changed')
    raw = manifest_path.read_bytes()
    require(len(raw) <= 1024 * 1024, 'runtime_manifest_too_large')
    manifest = json.loads(raw)
    entries = manifest.get('entries')
    require(manifest.get('contract') == 'build01-live-runtime-archive/1'
            and manifest.get('project') == PROJECT
            and manifest.get('inventoryStable') is True
            and manifest.get('activeFunctions') == expected_functions
            and isinstance(entries, list) and len(entries) == expected_functions,
            'runtime_inventory_unverified')
    expected = {'manifest.private.json'}
    source = []
    slugs = set()
    for entry in entries:
        slug = entry.get('slug')
        require(isinstance(slug, str) and SLUG.fullmatch(slug) and slug not in slugs
                and type(entry.get('version')) is int and entry['version'] >= 1
                and type(entry.get('verifyJwt')) is bool
                and isinstance(entry.get('files'), list) and entry['files'],
                'runtime_entry_invalid')
        slugs.add(slug)
        for file in entry['files']:
            relative = safe_relative(file.get('path'))
            stored = PurePosixPath(slug, 'supabase', 'functions', slug, relative)
            name = str(stored)
            require(name not in expected and type(file.get('bytes')) is int
                    and 0 < file['bytes'] <= 1024 * 1024
                    and isinstance(file.get('sha256'), str)
                    and HEX.fullmatch(file['sha256']), 'runtime_file_manifest_invalid')
            expected.add(name)
            path = root
            for part in stored.parts:
                path = path / part
                require(not path.is_symlink(), 'runtime_path_symlink')
            path = regular(path)
            require(path.stat().st_size == file['bytes'] and digest(path) == file['sha256'],
                    'runtime_source_changed')
            source.append((name, path, file['bytes'], file['sha256']))
    # Supabase's downloader leaves one CLI version marker per function. It is
    # tooling metadata, not deployed source, and is deliberately not packaged.
    markers = set()
    for slug in slugs:
        marker = root / slug / 'supabase' / '.temp' / 'cli-latest'
        value = regular(marker).read_text().strip()
        require(value == '' or re.fullmatch(r'v?\d+(\.\d+){1,3}', value) is not None,
                'runtime_download_marker_invalid')
        markers.add(str(marker.relative_to(root)))
    actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() or p.is_symlink()}
    require(actual == expected | markers, 'runtime_archive_has_missing_or_extra_files')
    return raw, sorted(source), manifest


def add_bytes(tar, name, data):
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = 0o600
    info.mtime = 0
    info.uid = info.gid = 0
    tar.addfile(info, io.BytesIO(data))


def package(root, output, recipient_file, age, expected_sha, expected_functions):
    require(regular(age).stat().st_size > 0 and digest(age) == AGE_SHA256,
            'age_binary_pin_mismatch')
    recipient_data = json.loads(regular(recipient_file).read_text())
    recipient = recipient_data.get('recipient')
    require(recipient_data.get('project') == PROJECT and isinstance(recipient, str)
            and RECIPIENT.fullmatch(recipient), 'recovery_recipient_invalid')
    raw, source, manifest = verify_archive(root, expected_sha, expected_functions)
    output = output.resolve(strict=False)
    require(not output.exists() and output.parent.is_dir()
            and not output.parent.is_symlink(), 'runtime_output_exists_or_invalid')
    descriptor = {
        'contract': 'serviceos-live-edge-source-package/1', 'project': PROJECT,
        'sourceManifestSha256': expected_sha,
        'sourceInventoryCompletedAt': manifest['completedAt'],
        'functions': len(manifest['entries']), 'files': len(source),
        'limitation': 'Source only; no Auth key, runtime secrets, frontend, off-site copy or restored service proof.',
    }
    fd, temporary = tempfile.mkstemp(prefix='.edge-package-', suffix='.age', dir=output.parent)
    try:
        with os.fdopen(fd, 'wb') as encrypted:
            proc = subprocess.Popen([str(age), '-r', recipient], stdin=subprocess.PIPE,
                                    stdout=encrypted, stderr=subprocess.DEVNULL,
                                    env={'PATH':'/usr/bin:/bin','LANG':'C'})
            try:
                with tarfile.open(fileobj=proc.stdin, mode='w|') as tar:
                    add_bytes(tar, 'package.json',
                              (json.dumps(descriptor, sort_keys=True, separators=(',', ':')) + '\n').encode())
                    add_bytes(tar, 'manifest.private.json', raw)
                    for name, path, length, sha in source:
                        body = path.read_bytes()
                        require(len(body) == length and hashlib.sha256(body).hexdigest() == sha,
                                'runtime_source_changed_during_package')
                        add_bytes(tar, 'edge/' + name, body)
                proc.stdin.close()
                require(proc.wait(timeout=120) == 0, 'age_encryption_failed')
            except BaseException:
                proc.kill()
                proc.wait()
                raise
        with Path(temporary).open('rb') as encrypted:
            header = encrypted.read(24)
        require(Path(temporary).stat().st_size > 64
                and header.startswith(b'age-encryption.org/v1'), 'age_package_unconfirmed')
        os.replace(temporary, output)
        return {**descriptor, 'encryptedBytes': output.stat().st_size,
                'encryptedSha256': digest(output), 'offSite': False,
                'productionWrites': False, 'providerRequests': 0}
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--recipient-file', required=True, type=Path)
    parser.add_argument('--age', required=True, type=Path)
    parser.add_argument('--expected-manifest-sha256', required=True)
    parser.add_argument('--expected-functions', type=int, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(package(args.archive, args.output, args.recipient_file,
                                 args.age, args.expected_manifest_sha256,
                                 args.expected_functions), sort_keys=True))
    except BaseException as error:
        print(json.dumps({'state':'runtime_package_unverified',
                          'code':str(error) if isinstance(error, PackageError)
                          else type(error).__name__}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
