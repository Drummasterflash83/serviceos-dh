"""Local age-encrypted database packages. No network, key creation or secret logs.

All inputs must be an already restored, complete snapshot. Recovery extracts only
an exact flat allowlist after authentication and digest verification. Real key
escrow, S3 transfer and full-service recovery are separate acceptance gates.
"""
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
from pathlib import Path

PROJECT = 'tgbnakbxwcqjeimygroz'
IMAGE = 'sha256:ba10e934f0a59990379f78ab9ed93926f1c291dd61a12fe4026f4202f1b89770'
AGE_SHA256 = '4012dfc2725883beafb710894af4f599b7a94f8c8e0f51f02cc96ab8df33915e'
MAX_BYTES = 1024 ** 3
MAX_JSON = 8 * 1024 ** 2
FILES = ('database.dump', 'net-tables.sql', 'source-inventory.json', 'report.json',
         'restore-native-comparison-report.json', 'vault-recovery-report.json')
FORMAT = 'serviceos-database-package/1'


class PackageError(RuntimeError):
    """Fixed safe code only; never include raw subprocess or source errors."""


def need(ok, code):
    if not ok:
        raise PackageError(code)


def private_directory(path):
    path = Path(path)
    s = path.lstat()
    need(stat.S_ISDIR(s.st_mode) and s.st_uid == os.getuid()
         and s.st_mode & 0o077 == 0, 'private_directory_required')
    return path


def open_read(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        need(stat.S_ISREG(s.st_mode), 'regular_file_required')
        need(0 < s.st_size <= MAX_BYTES, 'file_size_invalid')
        return os.fdopen(fd, 'rb')
    except BaseException:
        os.close(fd)
        raise


def describe(path):
    digest = hashlib.sha256()
    size = 0
    with open_read(path) as f:
        for chunk in iter(lambda: f.read(1024 ** 2), b''):
            size += len(chunk)
            need(size <= MAX_BYTES, 'file_size_invalid')
            digest.update(chunk)
    return {'bytes': size, 'sha256': digest.hexdigest()}


def write_private(path, value):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as f:
        f.write(value)


def read_json(path):
    with open_read(path) as f:
        data = f.read(MAX_JSON + 1)
    need(len(data) <= MAX_JSON, 'json_size_invalid')
    return json.loads(data)


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def containment(value):
    need(isinstance(value, dict) and value.get('network') == 'none'
         and value.get('hostMounts') == 0 and value.get('publishedPorts') == 0
         and value.get('cronLaunchActiveJobs') is False
         and value.get('maxWorkerProcesses') == 0, 'restore_containment_unverified')


def validate_snapshot(directory, entries):
    export = read_json(directory / 'report.json')
    restored = read_json(directory / 'restore-native-comparison-report.json')
    vault = read_json(directory / 'vault-recovery-report.json')
    need(export.get('project') == PROJECT
         and export.get('state') == 'export_complete_restore_unverified'
         and export.get('productionDataWrites') is False
         and export.get('snapshot', {}).get('readOnly') == 'on', 'export_not_complete')
    snapshot = export['snapshot']
    need(isinstance(snapshot.get('observedAt'), str) and snapshot['observedAt']
         and isinstance(snapshot.get('snapshot'), str) and snapshot['snapshot'], 'snapshot_missing')
    need(export.get('archive') == entries['database.dump'], 'archive_evidence_mismatch')
    net = export.get('netSupplement', {})
    need(net.get('bytes') == entries['net-tables.sql']['bytes']
         and net.get('sha256') == entries['net-tables.sql']['sha256']
         and net.get('format') == 'native-postgresql-copy'
         and net.get('tables') == ['_http_response', 'http_request_queue']
         and net.get('rowsUseExportedSnapshot') is True, 'supplement_evidence_mismatch')
    need(restored.get('sourceArchive') == entries['database.dump']
         and restored.get('sourceSnapshot') == snapshot
         and restored.get('state') == 'native_archive_restored_full_recovery_unverified'
         and restored.get('productionWrites') is False
         and restored.get('allInventoriedPhysicalTablesCaptured') is True
         and restored.get('knownArchiveOmissions') == []
         and restored.get('tableCatalogMatched') is True
         and restored.get('extensionVersionsMatched') is True
         and restored.get('containerRemoved') is True
         and restored.get('imageId') == IMAGE, 'native_restore_unverified')
    need(restored.get('nativeDataComparison', {}).get('state') == 'all_archived_copy_rows_and_sequences_match'
         and restored.get('networkSupplementComparison', {}).get('state') == 'all_archived_copy_rows_and_sequences_match',
         'row_comparison_unverified')
    containment(restored.get('containmentBefore'))
    containment(restored.get('containmentAfter'))
    need(vault.get('archive') == entries['database.dump']
         and vault.get('state') == 'all_archived_vault_secrets_decrypt_and_match_live'
         and vault.get('ciphertextMatchesLive') is True
         and vault.get('plaintextComparisonMatches') is True
         and vault.get('containerRemoved') is True
         and vault.get('productionWrites') is False, 'vault_restore_unverified')
    containment(vault.get('containment'))
    # The inventory is independently hashed in the package, not reconstructed.
    inventory = read_json(directory / 'source-inventory.json')
    need(isinstance(inventory, dict) and isinstance(inventory.get('tables'), list)
         and inventory['tables'] and isinstance(inventory.get('roles'), list), 'inventory_incomplete')
    return snapshot


def validate_tool(age):
    need(describe(age)['sha256'] == AGE_SHA256, 'age_binary_pin_mismatch')


def call_age(age, args, output, *, input_file=None, identity=None):
    validate_tool(age)
    need((input_file is None) != (identity is None), 'age_input_invalid')
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as out:
        # age diagnostics can disclose paths/recipients. Do not return or log them.
        result = subprocess.run([str(age)] + args, stdin=input_file, input=identity,
                                stdout=out, stderr=subprocess.DEVNULL, timeout=180,
                                env={'PATH': '/usr/bin:/bin', 'LANG': 'C'})
    need(result.returncode == 0, 'age_operation_failed')
    need(0 < Path(output).stat().st_size <= MAX_BYTES, 'package_size_invalid')


def copy_bounded(source, destination):
    size = 0
    with open_read(source) as inp, os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as out:
        for chunk in iter(lambda: inp.read(1024 ** 2), b''):
            size += len(chunk)
            need(size <= MAX_BYTES, 'file_size_invalid')
            out.write(chunk)


def package_snapshot(source, output, *, recipient, revision, age):
    """Create one new encrypted artifact. Never overwrite a prior package."""
    output = Path(output)
    try:
        private_directory(source)
        private_directory(output.parent)
        need(not output.exists() and not output.is_symlink(), 'output_already_exists')
        need(re.fullmatch(r'age1[0-9a-z]{58}', recipient) is not None, 'recipient_invalid')
        need(re.fullmatch(r'[0-9a-f]{40}', revision) is not None, 'revision_invalid')
        with tempfile.TemporaryDirectory(prefix='.database-package-', dir=output.parent) as temp:
            work = Path(temp)
            stage = work / 'source'
            stage.mkdir(mode=0o700)
            entries = {}
            total = 0
            for name in FILES:
                copy_bounded(Path(source) / name, stage / name)
                entries[name] = describe(stage / name)
                total += entries[name]['bytes']
                need(total < MAX_BYTES - MAX_JSON, 'package_size_invalid')
            snapshot = validate_snapshot(stage, entries)
            manifest = {'format': FORMAT, 'project': PROJECT, 'snapshot': snapshot,
                        'sourceRevision': revision, 'restoreImage': IMAGE,
                        'recipient': recipient, 'files': entries}
            write_private(stage / 'manifest.json', canonical(manifest))
            plain = work / 'snapshot.tar'
            with os.fdopen(os.open(plain, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as out:
                with tarfile.open(fileobj=out, mode='w', format=tarfile.USTAR_FORMAT) as tar:
                    for name in (*FILES, 'manifest.json'):
                        path = stage / name
                        info = tarfile.TarInfo(name)
                        info.size = path.stat().st_size
                        info.mode = 0o600
                        with open_read(path) as data:
                            tar.addfile(info, data)
            encrypted = work / 'snapshot.tar.age'
            with open_read(plain) as inp:
                call_age(age, ['--encrypt', '--recipient', recipient, '--output', '-'], encrypted, input_file=inp)
            descriptor = {'format': FORMAT, 'project': PROJECT,
                          'snapshotAt': snapshot['observedAt'], 'recipient': recipient,
                          'sourceRevision': revision, **describe(encrypted)}
            os.link(encrypted, output)  # Exclusive publication; an existing file is never replaced.
            return descriptor
    except PackageError:
        raise
    except Exception:
        raise PackageError('package_preparation_failed') from None


def restore_package(encrypted, destination, *, expected, identity, age):
    """Authenticate, validate and extract. Returns only after all checks pass.

    expected must come from the verified version receipt, not untrusted filename
    metadata. The private identity is bytes from the authorised secret store.
    """
    destination = Path(destination)
    created = False
    try:
        private_directory(destination.parent)
        need(isinstance(identity, bytes) and 0 < len(identity) < 4096, 'identity_invalid')
        lines = [line.strip() for line in identity.splitlines() if line.strip() and not line.startswith(b'#')]
        need(len(lines) == 1 and re.fullmatch(rb'AGE-SECRET-KEY-1[0-9A-Z]{50,100}', lines[0]) is not None, 'identity_invalid')
        need(expected.get('format') == FORMAT and expected.get('project') == PROJECT, 'descriptor_invalid')
        os.mkdir(destination, 0o700)  # Claims only a new empty recovery directory.
        created = True
        with tempfile.TemporaryDirectory(prefix='.database-recovery-', dir=destination.parent) as temp:
            work = Path(temp)
            copy_bounded(encrypted, work / 'input.age')
            need(describe(work / 'input.age') == {'bytes': expected.get('bytes'), 'sha256': expected.get('sha256')}, 'encrypted_integrity_mismatch')
            plain = work / 'snapshot.tar'
            call_age(age, ['--decrypt', '--identity', '-', '--output', '-', str(work / 'input.age')], plain, identity=identity)
            stage = work / 'verified'
            stage.mkdir(mode=0o700)
            names = set()
            total = 0
            with tarfile.open(plain, 'r:') as tar:
                for member in tar:
                    need(member.name in (*FILES, 'manifest.json') and member.name not in names
                         and member.isfile() and not member.pax_headers,
                         'package_member_invalid')
                    need(0 < member.size <= (MAX_JSON if member.name.endswith('.json') else MAX_BYTES), 'member_size_invalid')
                    total += member.size
                    need(total < MAX_BYTES, 'package_size_invalid')
                    names.add(member.name)
                    # Never use extract()/extractall(): symlinks and paths are forbidden.
                    with tar.extractfile(member) as inp, os.fdopen(os.open(stage / member.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as out:
                        shutil.copyfileobj(inp, out, 1024 ** 2)
                    need((stage / member.name).stat().st_size == member.size, 'member_size_mismatch')
            need(names == set((*FILES, 'manifest.json')), 'package_members_missing')
            manifest = read_json(stage / 'manifest.json')
            entries = {name: describe(stage / name) for name in FILES}
            need(manifest.get('format') == FORMAT and manifest.get('project') == PROJECT
                 and manifest.get('restoreImage') == IMAGE
                 and manifest.get('files') == entries
                 and manifest.get('recipient') == expected.get('recipient')
                 and manifest.get('sourceRevision') == expected.get('sourceRevision'), 'manifest_mismatch')
            snapshot = validate_snapshot(stage, entries)
            need(manifest.get('snapshot') == snapshot and snapshot['observedAt'] == expected.get('snapshotAt'), 'snapshot_mismatch')
            for name in (*FILES, 'manifest.json'):
                os.link(stage / name, destination / name)
            return manifest
    except BaseException as error:
        if created:
            shutil.rmtree(destination)
        if isinstance(error, (PackageError, KeyboardInterrupt, SystemExit)):
            raise
        raise PackageError('package_recovery_failed') from None
