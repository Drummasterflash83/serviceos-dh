"""Rehearse packages 001–021 on the retained isolated production archive.
No provider or hosted calls. Source data is compared before/after; synthetic
operator journeys run in a disposable clone with real permissions and Vault.
"""
import argparse
import hashlib
import json
from pathlib import Path
from database_restore_sandbox import RestoreSandbox, RecoveryError
from restore_production_database import ROOT, IMAGE, PINNED_IMAGE, write_private, ident
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_production_rules import prefix
from rehearse_production_roster import without_ledger, projected
from native_copy_fingerprints import restored_fingerprints, compare_native_data


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    out = Path(parser.parse_args().output).resolve()
    if out.parent != Path('.verification-results').resolve() or out.exists():
        raise SystemExit('Fresh private output directory required')
    out.mkdir(mode=0o700)
    report = {'state': 'preflight', 'productionChanged': False, 'hostedTestChanged': False, 'providerRequests': 0}
    target = None
    try:
        paths = sorted(Path('supabase/release/learn-production').glob('[0-9][0-9][0-9]_*.manifest.json'))
        if [int(p.name[:3]) for p in paths] != list(range(1, 22)):
            raise RecoveryError('Exact twenty-one-package candidate required')
        packages = []
        for path in paths:
            m = json.loads(path.read_text())
            sql = path.with_name(path.name.replace('.manifest.json', '.sql')).read_text()
            if hashlib.sha256(sql.encode()).hexdigest() != m['sha256']:
                raise RecoveryError('Package checksum differs')
            for s in m.get('sources', []):
                if hashlib.sha256(Path(s['path']).read_bytes()).hexdigest() != s['sha256']:
                    raise RecoveryError('Source checksum differs')
            packages.append((m, sql))
        target = RestoreSandbox(image=IMAGE, network_extension=True, storage_policy_hook=True, synthetic_vault=True,
                                private_diagnostics=out/'private-error')
        with target:
            if target.image_id != PINNED_IMAGE:
                raise RecoveryError('Image pin differs')
            prepare_archive_roles(target, json.loads((ROOT/'source-inventory.json').read_text()))
            archive = target.restore_native_archive(ROOT/'database.dump')
            if any(m['baselineArchive'] != archive for m, _ in packages):
                raise RecoveryError('Archive pin differs')
            report.update(archive=archive, containment=target.verify_boundary())
            original = restored_fingerprints(target)
            original_ids = {}
            for schema, table in [('public', 'import_profiles'), ('storage', 'buckets')]:
                original_ids[(schema, table)] = json.loads(target.query(
                    "select coalesce(jsonb_agg(id::text),'[]') from " + ident(schema)+'.'+ident(table)+';'))
            for m, sql in packages[:20]:
                target.query(prefix(m)+sql)
            print(json.dumps({'stage': 'twenty_prerequisites_installed'}), flush=True)
            inventory = Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
            before_catalog = json.loads(target.query(inventory))
            write_private(out/'before-schema.json', before_catalog)
            write_private(out/'package-context-schema.json', json.loads(target.query('set role postgres;set search_path=public,pg_catalog;'+inventory)))
            before = without_ledger(restored_fingerprints(target))
            storage_sql = 'set search_path=public,pg_catalog;' + inventory.replace("='public'", "='storage'")
            storage = target.query(storage_sql)
            roles_sql = "select jsonb_build_object('roles',(select jsonb_agg(to_jsonb(r)-'rolpassword' order by rolname) from pg_roles r),'memberships',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m));"
            roles = target.query(roles_sql)
            ledger_sql = "select jsonb_agg(to_jsonb(m) order by migration_name) from of_learn_deploy.migrations m where migration_name<>'learn_slack_work_context_v1';"
            ledger = target.query(ledger_sql)
            m, sql = packages[-1]
            cases = [
                ('wrong_target', 'Production Slack context target/checksum required',
                 prefix(m).replace('tgbnakbxwcqjeimygroz', 'saatxzwxvdvqevbnskxy')+sql),
                ('missing_prerequisite', 'Pinned Slack context prerequisite missing', prefix(m)+sql.replace(
                    'begin;\n', "begin;\ndelete from of_learn_deploy.migrations where migration_name='learn_commusoft_recurring_v1';\n", 1)),
                ('late_failure', 'division by zero', prefix(m)+sql.replace('\ncommit;\n', '\nselect 1/0;\ncommit;\n')),
            ]
            report['negativeChecks'] = []
            for name, expected, statement in cases:
                try:
                    target.query(statement)
                except RecoveryError:
                    log = Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                    if expected not in log or json.loads(target.query(inventory)) != before_catalog or target.query(ledger_sql) != ledger:
                        raise RecoveryError('Negative check failed: '+name)
                    report['negativeChecks'].append(name)
                else:
                    raise RecoveryError('Negative case accepted: '+name)
            target.query(prefix(m)+sql)
            after_catalog = json.loads(target.query(inventory))
            retained_tables = json.loads(json.dumps([t for t in after_catalog['tables'] if t['name'] not in m['newTables']]))
            interactions = next(t for t in retained_tables if t['name']=='interactions')
            added_trigger = [t for t in interactions['triggers'] if t['name']=='learn_slack_context_source_changed']
            if len(added_trigger)!=1 or added_trigger[0]['enabled']!='O':
                raise RecoveryError('Slack source-change trigger absent or disabled')
            interactions['triggers']=[t for t in interactions['triggers'] if t['name']!='learn_slack_context_source_changed']
            if retained_tables != before_catalog['tables'] or after_catalog['views'] != before_catalog['views']:
                raise RecoveryError('Unexpected table/view change')
            new_tables = [t for t in after_catalog['tables'] if t['name'] in m['newTables']]
            if sorted(t['name'] for t in new_tables) != sorted(m['newTables']) or any(
                not t['rls'] or t['owner'] != 'postgres' or t['policies'] or
                any(a['role'] in ['PUBLIC','anon','authenticated','service_role'] for a in t['acl']) for t in new_tables):
                raise RecoveryError('Slack context table isolation differs')
            originals = {(f['name'], f['arguments']): f for f in before_catalog['functions']}
            additions, changed = [], []
            for f in after_catalog['functions']:
                old = originals.pop((f['name'], f['arguments']), None)
                if old is None:
                    additions.append(f)
                elif old != f:
                    if {k: v for k, v in old.items() if k != 'hash'} != {k: v for k, v in f.items() if k != 'hash'}:
                        raise RecoveryError('Existing function authority changed')
                    changed.append(f['name'])
            if originals or sorted(changed) != sorted(m['changedFunctions']) or sorted(f['name'] for f in additions) != sorted(m['newFunctions']):
                raise RecoveryError('Unexpected function changes')
            for f in additions:
                expected_auth = f['name'] in ['learn_operator_slack_context','learn_operator_slack_context_review']
                expected_service = False
                if f['anonExecute'] or f['authenticatedExecute'] != expected_auth or f['serviceExecute'] != expected_service or f['securityDefiner'] != (f['name']!='learn_slack_context_source_changed') or f['owner'] != 'postgres':
                    raise RecoveryError('Slack context function authority differs')
            if target.query(storage_sql) != storage or target.query(roles_sql) != roles or target.query(ledger_sql) != ledger:
                raise RecoveryError('Unrelated Storage/role/receipt change')
            target.query("do $$begin assert(select count(*)=1 from of_learn_deploy.migrations where migration_name='learn_slack_work_context_v1');end$$;")
            after = without_ledger(restored_fingerprints(target))
            report['preservation'] = compare_native_data(before, projected(target, before, after))
            if any(t['rows'] for t in after['tables'] if t['schema']=='public' and t['table'] in m['newTables']):
                raise RecoveryError('Installation unexpectedly created review data')
            report['originalArchivePreservation'] = compare_native_data(original, projected(target, original, after, original_ids))
            write_private(out/'schema.json', after_catalog)
            try:
                target.query(prefix(m)+sql)
            except RecoveryError:
                log = Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                if 'Slack context already exists; inspect before retry' not in log or json.loads(target.query(inventory)) != after_catalog:
                    raise RecoveryError('Duplicate rejection differs')
                report['duplicateRejected'] = True
            else:
                raise RecoveryError('Duplicate package accepted')
            paths = [Path('scripts/verify/learn-slack-work-context.assert.sql')]
            probe = 'set role postgres;set search_path=public,pg_catalog;begin;\n'+paths[0].read_text()+'\nrollback;'
            target.query(probe)
            report['journey'] = {'passed': True, 'probeSha256': hashlib.sha256(probe.encode()).hexdigest(),
                'sources': [{'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]}
            report['postJourneyPreservation'] = compare_native_data(after, without_ledger(restored_fingerprints(target)))
            if json.loads(target.query(inventory)) != after_catalog or target.query(roles_sql) != roles:
                raise RecoveryError('Journey changed retained database')
            report.update(packages=[p['sha256'] for p, _ in packages], newFunctions=len(m['newFunctions']), changedFunctions=len(m['changedFunctions']), newTables=len(m['newTables']),
                existingTablesUnchangedExceptReviewedInteractionTrigger=True, existingViewsRolesStorageUnchanged=True, priorReceiptsUnchanged=True,
                addedReleaseReceipts=1, containmentAfter=target.verify_boundary())
        report.update(state='production_slack_context_rehearsed_offline', containerRemoved=target.cleaned)
        write_private(out/'report.json', report)
        print(json.dumps(report), flush=True)
    except Exception as error:
        report.update(state='rehearsal_failed', containerRemoved=bool(target and target.cleaned),
            failure=str(error) if isinstance(error, RecoveryError) else 'Rehearsal failed; private diagnostics retained')
        write_private(out/'report.json', report)
        print(json.dumps(report), flush=True)
        raise SystemExit(1) from None


if __name__ == '__main__':
    run()
