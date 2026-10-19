"""Encrypt a previously verified snapshot without accessing recovery secrets.

This proves source evidence, package structure and ciphertext integrity. It
explicitly does not prove that this particular ciphertext can be decrypted;
that remains a separate supervised restore drill.
"""
import json
import sys
from pathlib import Path
from database_backup_package import (PackageError, canonical, describe, read_json,
                                     package_snapshot, private_directory, FORMAT,
                                     DAILY_FORMAT,
                                     MAX_DIAGNOSTIC_INPUT_BYTES, write_private)

SAFE_PACKAGE_ERRORS = frozenset({
    'private_directory_required', 'regular_file_required', 'file_size_invalid',
    'json_size_invalid', 'package_format_invalid', 'export_not_complete',
    'snapshot_missing', 'archive_evidence_mismatch', 'supplement_evidence_mismatch',
    'native_restore_unverified', 'row_comparison_unverified',
    'restore_containment_unverified', 'native_fingerprints_unverified',
    'vault_ciphertext_inventory_unverified', 'inventory_incomplete',
    'source_archive_changed', 'output_already_exists', 'recipient_invalid',
    'revision_invalid', 'package_size_invalid', 'age_binary_pin_mismatch',
    'age_binary_unavailable', 'age_operation_failed', 'age_operation_timeout', 'disk_full',
    'permission_denied', 'source_missing', 'disk_capacity_insufficient',
    'package_preparation_failed',
})


def safe_preparation_code(error):
    code = str(error) if isinstance(error, PackageError) else None
    return 'encrypt_' + (code if code in SAFE_PACKAGE_ERRORS else 'unexpected_failure')


def safe_preparation_diagnostic(error):
    code = safe_preparation_code(error)
    result = {'state': 'package_preparation_failed_safe', 'code': code,
              'secretsPrinted': False}
    size = getattr(error, 'package_input_bytes', None)
    if code in ('encrypt_package_size_invalid', 'encrypt_file_size_invalid') and \
            type(size) is int and 0 <= size <= MAX_DIAGNOSTIC_INPUT_BYTES:
        result['packageInputBytes'] = size
    return result


def prepare(data):
    directory = private_directory(Path(data['directory']))
    source = private_directory(Path(data['source']))
    format_version = data.get('formatVersion', FORMAT)
    if format_version not in (FORMAT, DAILY_FORMAT):
        raise PackageError('package_format_invalid')
    descriptor = package_snapshot(source, directory / 'snapshot.age',
                                  recipient=data['ageRecipient'],
                                  revision=data['revision'], age=Path(data['agePath']),
                                  format_version=format_version)
    archive = read_json(source / 'report.json')['archive']
    if archive != describe(source / 'database.dump'):
        raise PackageError('source_archive_changed')
    write_private(directory / 'descriptor.json', canonical(descriptor))
    daily = format_version == DAILY_FORMAT
    proof = {'contract': 'database-package-preparation/1',
             'state': ('package_encrypted_native_evidence_verified_vault_pending' if daily
                       else 'package_encrypted_source_evidence_verified_restore_pending'),
             'descriptor': descriptor, 'archive': archive,
             'snapshotAt': descriptor['snapshotAt'],
             'sourceDatabaseRestoreVerified': not daily,
             'sourceNativeRestoreVerified': True,
             'localDatabaseRestoreVerified': False,
             'providerRequests': False,
             'recoveryKeysRead': False,
             'recoveryKeysWrittenToHostFiles': False}
    write_private(directory / 'preparation.json', canonical(proof))
    return proof


if __name__ == '__main__':
    try:
        if sys.argv[1:]:
            raise PackageError('stdin_only')
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384:
            raise PackageError('input_too_large')
        result = prepare(json.loads(raw))
        print(json.dumps({'state': result['state'], 'recoveryKeysRead': False}))
    except BaseException as error:
        print(json.dumps(safe_preparation_diagnostic(error)))
        raise SystemExit(1) from None
