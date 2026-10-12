"""Run earlier delivery journeys against the complete fourteen-package candidate.

Reuses the pinned archive, package guards, preservation checks and Microsoft/
voicemail/input-to-card suites. Earlier suites run on clones of the FINAL schema,
not on their original intermediate package group. No live service is contacted.
"""
import argparse
import hashlib
import importlib
import json
from pathlib import Path
from database_restore_sandbox import RecoveryError
from restore_production_database import ident, write_private
from native_copy_fingerprints import restored_fingerprints, compare_native_data
import rehearse_production_microsoft as candidate

GROUPS = ('scoring', 'slack', 'capture', 'imports', 'commusoft', 'email', 'phone', 'cards')


def database_names(target):
    return set(json.loads(target.query("select json_agg(datname order by datname) from pg_database;")))


def earlier_journeys(target):
    before = restored_fingerprints(target)
    catalog_sql = Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
    catalog = target.query(catalog_sql)
    groups = []
    for name in GROUPS:
        module = importlib.import_module('rehearse_production_' + name)
        module.OUT = candidate.OUT / name
        module.OUT.mkdir(mode=0o700)
        databases = database_names(target)
        print(json.dumps({'combinedGroup': name, 'state': 'running'}), flush=True)
        result = {'group': name, 'runnerSha256': hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()}
        try:
            result['journeys'] = module.verify_journeys(target)
            if name == 'capture':
                result['pauseAdmissionRace'] = module.verify_pause_race(target)
        finally:
            # Only databases created by this synchronous group, in this isolated
            # disposable container. Keep the final-schema comparison DB intact.
            created = database_names(target) - databases
            if any(not name.startswith('learn_') for name in created):
                raise RecoveryError('Unexpected rehearsal database created')
            for clone in sorted(created):
                target.query('drop database ' + ident(clone) + ';')
        result['fixtureDatabasesRemoved'] = sorted(created)
        groups.append(result)
        write_private(candidate.OUT / 'combined-progress.json', groups)
        print(json.dumps({'combinedGroup': name, 'state': 'passed', 'journeys': len(result['journeys'])}), flush=True)
    if target.query(catalog_sql) != catalog:
        raise RecoveryError('Combined journeys changed the final comparison catalog')
    preserved = compare_native_data(before, restored_fingerprints(target))
    write_private(candidate.OUT / 'combined-primary-preservation.json', preserved)
    return {'groups': groups, 'finalComparisonDatabasePreserved': preserved,
            'scope': 'Final fourteen-package schema with synthetic provider payloads; no hosted or real-provider acceptance.'}


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, help='New private directory under .verification-results')
    args = parser.parse_args()
    output = Path(args.output).resolve()
    root = Path('.verification-results').resolve()
    if output.parent != root or output.exists():
        raise SystemExit('A new direct child of .verification-results is required')
    candidate.OUT = output
    candidate.run(additional_journeys=earlier_journeys, synthetic_vault=True)


if __name__ == '__main__':
    run()
