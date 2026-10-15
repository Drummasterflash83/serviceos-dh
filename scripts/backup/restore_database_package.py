"""Recover an encrypted package and verify its DB offline using supplied keys.

No Supabase/API/key-store calls. Secret material arrives through stdin when run
as a command. The caller separately proves download and key-store provenance.
"""
import json
import os
import sys
from pathlib import Path
from database_backup_package import (PackageError, private_directory, restore_package,
                                     read_json, write_private, canonical, describe,
                                     FORMAT, DAILY_FORMAT, package_files)
from database_restore_sandbox import RecoveryError
from restore_production_database import run as restore_database


def expected_vault_count(manifest, extracted):
    if manifest['format'] == FORMAT:
        count = read_json(extracted / 'vault-recovery-report.json').get('vaultSecretsVerified')
    elif manifest['format'] == DAILY_FORMAT:
        archived = read_json(extracted / 'native-archive-fingerprints.json')
        recovered = read_json(extracted / 'native-restored-fingerprints.json')
        if archived != recovered:
            raise PackageError('vault_ciphertext_inventory_unverified')
        vault = [t for t in archived['tables'] if t.get('schema') == 'vault'
                 and t.get('table') == 'secrets']
        if len(vault) != 1:
            raise PackageError('vault_count_missing')
        count = vault[0].get('rows')
    else:
        raise PackageError('package_format_invalid')
    if type(count) is not int or count < 0:
        raise PackageError('vault_count_missing')
    return count


def recover_database_package(encrypted, destination, *, expected, identity, root_key, age):
    destination = Path(destination)
    private_directory(destination.parent)
    os.mkdir(destination, 0o700)
    report = {'contract': 'database-package-restore/1', 'state': 'preflight',
              'sourceAPIRequests': False, 'independentStorageVerified': False,
              'keyEscrowVerified': False, 'fullApplicationRecoveryVerified': False,
              'productionWrites': False}
    try:
        if not isinstance(root_key, bytes) or len(root_key) != 64 or any(c not in b'0123456789abcdefABCDEF' for c in root_key):
            raise PackageError('vault_root_key_invalid')
        extracted = destination / 'snapshot'
        manifest = restore_package(encrypted, extracted, expected=expected, identity=identity, age=age)
        identity = b''
        prior = read_json(extracted / 'restore-native-comparison-report.json')
        count = expected_vault_count(manifest, extracted)
        evidence = destination / 'verification'
        evidence.mkdir(mode=0o700)
        result = restore_database(source_root=extracted, evidence_root=evidence,
                                  compare_native=True, vault_root_key=root_key,
                                  expected_vault_count=count)
        root_key = b''
        for field in ('nativeDataComparison', 'networkSupplementComparison', 'recordingRelationships', 'noActorRows'):
            if result[field] != prior[field]:
                raise RecoveryError('Recovered database differs from packaged restore evidence')
        if not result['containerRemoved'] or not result['vaultDecryptionProven']:
            raise RecoveryError('Recovered database cleanup or Vault verification incomplete')
        # Verification reports must not overwrite any of the recovered originals.
        if {name: describe(extracted / name) for name in package_files(manifest['format'])} != manifest['files']:
            raise PackageError('recovered_snapshot_was_modified')
        report.update(state='encrypted_package_database_and_vault_restored',
                      snapshotAt=manifest['snapshot']['observedAt'],
                      nativeDataComparison=result['nativeDataComparison'],
                      networkSupplementComparison=result['networkSupplementComparison'],
                      recordingRelationships=result['recordingRelationships'],
                      vaultSecretsVerified=result['vaultSecretsVerified'],
                      allPhysicalTablesCovered=result['allInventoriedPhysicalTablesCaptured'],
                      tableCatalogMatched=result['tableCatalogMatched'],
                      extensionVersionsMatched=result['extensionVersionsMatched'],
                      noActorRows=result['noActorRows'], containment=result['containmentAfter'],
                      originalPackageFilesUnchanged=True, containerRemoved=True)
        write_private(destination / 'report.json', canonical(report))
        return report
    except BaseException as error:
        report.update(state='database_package_restore_not_verified',
                      failure='Package or offline database verification failed; raw details withheld')
        # Any failed restore's container cleanup result is retained separately in
        # verification/restore-native-comparison-report.json; never assume it.
        write_private(destination / 'report.json', canonical(report))
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            raise
        raise PackageError('database_package_restore_not_verified') from None


if __name__ == '__main__':
    if sys.argv[1:]:
        raise SystemExit('Recovery input is accepted only through stdin')
    try:
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384:
            raise PackageError('recovery_input_too_large')
        data = json.loads(raw)
        raw = b''
        identity = data.pop('ageIdentity').encode('ascii')
        root_key = data.pop('rootKey').encode('ascii')
        result = recover_database_package(data['encryptedPath'], data['destination'],
            expected=data['descriptor'], identity=identity, root_key=root_key, age=Path(data['agePath']))
        identity = root_key = b''
        print(json.dumps(result))
    except BaseException:
        print(json.dumps({'state': 'database_package_restore_not_verified', 'secretsPrinted': False}))
        raise SystemExit(1) from None
