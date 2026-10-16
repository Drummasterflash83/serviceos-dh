"""Offline native restore for one daily source; no provider or recovery key."""
import json
import re
import sys
from pathlib import Path
from database_backup_package import PackageError, private_directory
from restore_production_database import run

SAFE_STAGES = frozenset({
    'preflight', 'preparing_local_roles', 'restoring_native_archive',
    'comparing_native_archive_rows', 'verifying_all_table_fingerprints',
})
SAFE_FAILURES = {
    'Recovery container command unavailable or timed out': 'restore_command_unavailable_or_timeout',
    'Recovery container command failed; raw output withheld': 'restore_container_command_failed',
    'Recovery database startup did not complete': 'restore_database_startup_failed',
    'Recovery containment check failed': 'restore_containment_failed',
    'Production-matching image pin differs': 'restore_image_pin_failed',
    'Source archive integrity mismatch': 'restore_archive_integrity_failed',
    'Native archive changed during restore': 'restore_archive_changed',
    'Archived COPY rows differ from restored COPY rows': 'restore_row_mismatch',
    'Archived sequence states differ from restored database': 'restore_sequence_mismatch',
    'Restored table ownership or RLS catalog differs': 'restore_catalog_mismatch',
    'Restored extension versions differ': 'restore_extension_mismatch',
    'Recovery container cleanup unconfirmed': 'restore_cleanup_unconfirmed',
    'Native capture does not cover the physical table inventory': 'restore_inventory_coverage_mismatch',
    'Restored inputs exposed without an authenticated actor': 'restore_no_actor_access_mismatch',
    'Network table supplement integrity mismatch': 'restore_network_supplement_integrity_failed',
    'Native COPY stream exceeds bound or is truncated': 'restore_native_stream_bound_or_truncated',
    'Native COPY table exceeds row bound': 'restore_native_row_bound',
    'Native COPY export process did not complete': 'restore_native_copy_process_failed',
    'Unsupported statement outside native COPY data': 'restore_native_statement_unrecognized',
    'Restored network table columns differ': 'restore_network_columns_mismatch',
    'Restored network rows exceed comparison bound': 'restore_network_rows_bound',
}
SAFE_FAILURE_CLASSES = {
    'KeyError': 'restore_unexpected_key',
    'TypeError': 'restore_unexpected_type',
    'ValueError': 'restore_unexpected_value',
    'IndexError': 'restore_unexpected_index',
    'OSError': 'restore_unexpected_os',
    'JSONDecodeError': 'restore_unexpected_json',
    'TimeoutExpired': 'restore_unexpected_timeout',
    'Other': 'restore_unexpected_other',
}


def safe_failure(source_arg):
    stage, code = 'preflight', 'restore_failure_unclassified'
    try:
        source = Path(source_arg)
        report = json.loads((source / 'restore-native-comparison-report.json').read_text())
        if report.get('state') in SAFE_STAGES:
            stage = report['state']
        code = SAFE_FAILURES.get(report.get('failure'), code)
        if code == 'restore_failure_unclassified':
            code = SAFE_FAILURE_CLASSES.get(report.get('failureClass'), code)
    except (AttributeError, IndexError, OSError, TypeError, ValueError):
        pass
    return {'state': 'native_restore_failed_safe', 'stage': stage,
            'code': code, 'secretsPrinted': False}


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
        print(json.dumps(safe_failure(sys.argv[1] if len(sys.argv) > 1 else '')))
        raise SystemExit(1) from None
