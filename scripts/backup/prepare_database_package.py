"""Prepare + decrypt-check a local package. All key input is stdin; no network."""
import json
import shutil
import sys
from pathlib import Path
from database_backup_package import (package_snapshot, canonical,
                                     private_directory, write_private, PackageError)
from restore_database_package import recover_database_package


def prepare(data):
    directory = private_directory(Path(data['directory']))
    source = private_directory(Path(data['source']))
    identity = data.pop('ageIdentity').encode('ascii')
    root_key = data.pop('rootKey').encode('ascii')
    encrypted = directory / 'snapshot.age'
    descriptor = package_snapshot(source, encrypted, recipient=data['ageRecipient'],
                                  revision=data['revision'], age=Path(data['agePath']))
    recovered = directory / 'local-database-check'
    verified = recover_database_package(encrypted, recovered, expected=descriptor,
        identity=identity, root_key=root_key, age=Path(data['agePath']))
    manifest = json.loads((recovered / 'snapshot/manifest.json').read_text())
    identity = root_key = b''
    write_private(directory / 'local-recovery-report.json', canonical(verified))
    shutil.rmtree(recovered)
    write_private(directory / 'descriptor.json', canonical(descriptor))
    proof = {'contract': 'database-package-preparation/1',
             'state': 'package_encrypted_and_decrypt_checked', 'descriptor': descriptor,
             'archive': manifest['files']['database.dump'],
             'snapshotAt': manifest['snapshot']['observedAt'],
             'localDatabaseRestoreVerified': True,
             'providerRequests': False, 'recoveryKeysWrittenToHostFiles': False}
    write_private(directory / 'preparation.json', canonical(proof))
    return proof


if __name__ == '__main__':
    try:
        if sys.argv[1:]:
            raise PackageError('stdin_only')
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384:
            raise PackageError('input_too_large')
        data = json.loads(raw)
        raw = b''
        print(json.dumps(prepare(data)))
    except BaseException:
        print(json.dumps({'state': 'package_preparation_not_verified', 'secretsPrinted': False}))
        raise SystemExit(1) from None
