"""Rehearse operator/context package 015 after all fourteen production candidates.

Only a disposable, network-isolated restore is changed. Existing archive checks
run first; operator journeys use separate clones so fixture sequence use cannot
alter the retained-data comparison database.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from database_restore_sandbox import RecoveryError
from restore_production_database import write_private
from native_copy_fingerprints import restored_fingerprints, compare_native_data
from rehearse_production_rules import prefix
import rehearse_production_microsoft as prerequisites


def operator_package(target):
    directory = Path('supabase/release/learn-production/015_operator_context')
    manifest = json.loads(directory.with_suffix('.manifest.json').read_text())
    sql = directory.with_suffix('.sql').read_text()
    if hashlib.sha256(sql.encode()).hexdigest() != manifest['sha256']:
        raise RecoveryError('Operator candidate pin differs')
    for source in manifest['sources']:
        if hashlib.sha256(Path(source['path']).read_bytes()).hexdigest() != source['sha256']:
            raise RecoveryError('Operator source pin differs')
    inventory = Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
    catalog = json.loads(target.query(inventory))
    storage = target.query('set search_path=public,pg_catalog;' + inventory.replace("='public'", "='storage'"))
    roles_sql = """select jsonb_build_object(
      'roles',(select jsonb_agg(to_jsonb(r)-'rolpassword' order by rolname) from pg_roles r),
      'memberships',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m));"""
    roles = target.query(roles_sql)
    ledger_sql = "select jsonb_agg(to_jsonb(m) order by migration_name) from of_learn_deploy.migrations m where migration_name<>'learn_operator_context_v1';"
    ledger = target.query(ledger_sql)
    before = restored_fingerprints(target)
    results = {'sha256': manifest['sha256'], 'negativeChecks': [], 'journeys': []}
    cases = [
        ('wrong_target', 'Reviewed production operator target and checksum required',
         prefix(manifest).replace('tgbnakbxwcqjeimygroz', 'saatxzwxvdvqevbnskxy') + sql),
        ('catalog_drift', 'Production operator table baseline differs',
         prefix(manifest) + sql.replace('begin;\n', 'begin;\nalter table public.customer_cards add column rehearsal_drift text;\n', 1)),
        ('helper_drift', 'Production operator helper baseline differs',
         prefix(manifest) + sql.replace('begin;\n', 'begin;\ngrant execute on function public.learn_commusoft_work_batch_result(uuid,uuid) to anon;\n', 1)),
        ('late_failure', 'division by zero',
         prefix(manifest) + sql.replace('\ncommit;\n', '\nselect 1/0;\ncommit;\n')),
    ]
    for name, expected, statement in cases:
        try:
            target.query(statement)
        except RecoveryError:
            log = Path(str(target.private_diagnostics) + '-' + target.run_id + '-' + str(target.failed_command_count) + '.log').read_text()
            if expected not in log or json.loads(target.query(inventory)) != catalog or target.query(ledger_sql) != ledger:
                raise RecoveryError('Operator negative check failed: ' + name)
            results['negativeChecks'].append(name)
        else:
            raise RecoveryError('Operator negative case accepted: ' + name)
    target.query(prefix(manifest) + sql)
    after_catalog = json.loads(target.query(inventory))
    if after_catalog['tables'] != catalog['tables'] or after_catalog['views'] != catalog['views']:
        raise RecoveryError('Operator package changed existing tables or views')
    if target.query(roles_sql) != roles or target.query('set search_path=public,pg_catalog;' + inventory.replace("='public'", "='storage'")) != storage:
        raise RecoveryError('Operator package changed roles, memberships or Storage')
    changed = set(manifest['changedFunctions'])
    for original in catalog['functions']:
        matches = [f for f in after_catalog['functions'] if f['name'] == original['name'] and f['arguments'] == original['arguments']]
        if len(matches) != 1:
            raise RecoveryError('Existing operator prerequisite signature disappeared')
        observed = matches[0]
        if original['name'] in changed:
            if {k: v for k, v in original.items() if k != 'hash'} != {k: v for k, v in observed.items() if k != 'hash'}:
                raise RecoveryError('Review function authority or signature changed')
        elif original != observed:
            raise RecoveryError('Unrelated production function changed: ' + original['name'])
    additions = [f for f in after_catalog['functions'] if not any(f['name'] == old['name'] and f['arguments'] == old['arguments'] for old in catalog['functions'])]
    if {f['name'] for f in additions} != set(manifest['newFunctions']) or len(additions) != 6:
        raise RecoveryError('Unexpected operator function additions')
    after = restored_fingerprints(target)
    if target.query(ledger_sql) != ledger:
        raise RecoveryError('Prior release receipts changed')
    target.query("do $$begin assert(select count(*)=1 from of_learn_deploy.migrations where migration_name='learn_operator_context_v1');end$$;")
    for fingerprint in [before, after]:
        fingerprint['tables'] = [t for t in fingerprint['tables'] if (t['schema'], t['table']) != ('of_learn_deploy', 'migrations')]
        fingerprint['rows'] = sum(t['rows'] for t in fingerprint['tables'])
    results['preservation'] = compare_native_data(before, after)
    results['priorReleaseReceiptsUnchanged'] = True
    results['addedReleaseReceipts'] = 1
    results['existingTablesViewsRolesStorageUnchanged'] = True
    try:
        target.query(prefix(manifest) + sql)
    except RecoveryError:
        log = Path(str(target.private_diagnostics) + '-' + target.run_id + '-' + str(target.failed_command_count) + '.log').read_text()
        if 'Production operator candidate already exists; inspect before retry' not in log or json.loads(target.query(inventory)) != after_catalog:
            raise RecoveryError('Operator duplicate rejection differs')
        results['duplicateRejected'] = True
    else:
        raise RecoveryError('Duplicate operator package accepted')
    for index, name in enumerate(['openfolk-client-information.assert.sql', 'openfolk-business-review.assert.sql',
                                  'learn-customer-business-context.assert.sql', 'learn-operator-phone-playback.assert.sql']):
        path = Path('scripts/verify') / name
        clone = 'learn_operator_journey_' + str(index)
        target.query('create database ' + clone + ' template postgres;')
        target.query('alter role supabase_admin in database ' + clone + ' set search_path=public,pg_catalog;')
        args = target._psql()
        args[args.index('-d') + 1] = clone
        probe = 'begin;set local search_path=public,pg_catalog;set local plpgsql.check_asserts=on;\n' + path.read_text() + '\nreset role;rollback;'
        try:
            result = subprocess.run([target.docker, *args], input=probe.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)
            if result.returncode:
                write_private(prerequisites.OUT / (name + '-error.json'), {'error': result.stderr.decode()})
                raise RecoveryError('Operator production journey failed: ' + name)
        finally:
            target.query('drop database ' + clone + ';')
        results['journeys'].append({'name': name, 'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                    'probeSha256': hashlib.sha256(probe.encode()).hexdigest()})
        print(json.dumps({'operatorJourneyPassed': name}), flush=True)
    final = restored_fingerprints(target)
    final['tables'] = [t for t in final['tables'] if (t['schema'], t['table']) != ('of_learn_deploy', 'migrations')]
    final['rows'] = sum(t['rows'] for t in final['tables'])
    results['postJourneyPreservation'] = compare_native_data(after, final)
    if json.loads(target.query(inventory)) != after_catalog or target.query(roles_sql) != roles:
        raise RecoveryError('Journeys changed final schema or roles')
    write_private(prerequisites.OUT / 'operator-report.json', results)
    return results


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    out = Path(args.output).resolve()
    if out.parent != Path('.verification-results').resolve() or out.exists():
        raise SystemExit('A new direct child of .verification-results is required')
    prerequisites.OUT = out
    prerequisites.run(additional_journeys=operator_package, synthetic_vault=True)
    report = json.loads((out / 'report.json').read_text())
    report['state'] = 'production_operator_context_rehearsed_offline'
    report['packages'].append(report['combinedJourneyGroups']['sha256'])
    write_private(out / 'report.json', report)
    print(json.dumps({'state': report['state'], 'packages': len(report['packages']),
                      'containerRemoved': report['containerRemoved']}), flush=True)


if __name__ == '__main__':
    run()
