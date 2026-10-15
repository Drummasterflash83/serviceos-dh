"""Encrypt a previously verified snapshot without accessing recovery secrets.

This proves source evidence, package structure and ciphertext integrity. It
explicitly does not prove that this particular ciphertext can be decrypted;
that remains a separate supervised restore drill.
"""
import json
import sys
from pathlib import Path
from database_backup_package import (PackageError, canonical, describe, read_json,
                                     package_snapshot, private_directory,
                                     write_private)


def prepare(data):
    directory = private_directory(Path(data['directory']))
    source = private_directory(Path(data['source']))
    descriptor = package_snapshot(source, directory / 'snapshot.age',
                                  recipient=data['ageRecipient'],
                                  revision=data['revision'], age=Path(data['agePath']))
    archive = read_json(source / 'report.json')['archive']
    if archive != describe(source / 'database.dump'):
        raise PackageError('source_archive_changed')
    write_private(directory / 'descriptor.json', canonical(descriptor))
    proof = {'contract': 'database-package-preparation/1',
             'state': 'package_encrypted_source_evidence_verified_restore_pending',
             'descriptor': descriptor, 'archive': archive,
             'snapshotAt': descriptor['snapshotAt'],
             'sourceDatabaseRestoreVerified': True,
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
    except BaseException:
        print(json.dumps({'state': 'package_preparation_not_verified', 'secretsPrinted': False}))
        raise SystemExit(1) from None
