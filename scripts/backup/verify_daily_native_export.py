"""Offline native restore for one daily source; no provider or recovery key."""
import json
import re
import sys
from pathlib import Path
from database_backup_package import PackageError, private_directory
from restore_production_database import run


def main(args):
    if len(args) != 1 or not re.fullmatch(
            r'\.verification-results/production-database-daily-[0-9]{8}-[a-f0-9-]{36}',
            args[0]):
        raise PackageError('daily_source_path_invalid')
    source = private_directory(Path(args[0]))
    result = run(source_root=source, evidence_root=source, compare_native=True)
    if (result.get('state') != 'native_archive_restored_full_recovery_unverified'
            or result.get('containerRemoved') is not True
            or result.get('allInventoriedPhysicalTablesCaptured') is not True
            or result.get('tableCatalogMatched') is not True
            or result.get('extensionVersionsMatched') is not True
            or result.get('nativeDataComparison', {}).get('state')
            != 'all_archived_copy_rows_and_sequences_match'
            or result.get('networkSupplementComparison', {}).get('state')
            != 'all_archived_copy_rows_and_sequences_match'):
        raise PackageError('daily_native_restore_unverified')
    print(json.dumps({'state': 'daily_native_restore_verified_vault_pending',
                      'containerRemoved': True, 'productionWrites': False}))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except BaseException:
        print(json.dumps({'state': 'daily_native_restore_not_verified',
                          'secretsPrinted': False}))
        raise SystemExit(1) from None
