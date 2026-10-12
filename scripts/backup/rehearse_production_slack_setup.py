"""Rehearse packages 001–018 on the retained isolated production archive.
No provider or hosted calls. Source data is compared before/after; synthetic
operator journeys run in a disposable clone with real permissions and Vault.
"""
import argparse
import hashlib
import json
import subprocess
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
        if [int(p.name[:3]) for p in paths] != list(range(1, 19)):
            raise RecoveryError('Exact eighteen-package candidate required')
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
            for m, sql in packages[:17]:
                target.query(prefix(m)+sql)
            print(json.dumps({'stage': 'seventeen_prerequisites_installed'}), flush=True)
            inventory = Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
            before_catalog = json.loads(target.query(inventory))
            before = without_ledger(restored_fingerprints(target))
            storage_sql = 'set search_path=public,pg_catalog;' + inventory.replace("='public'", "='storage'")
            storage = target.query(storage_sql)
            roles_sql = "select jsonb_build_object('roles',(select jsonb_agg(to_jsonb(r)-'rolpassword' order by rolname) from pg_roles r),'memberships',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m));"
            roles = target.query(roles_sql)
            ledger_sql = "select jsonb_agg(to_jsonb(m) order by migration_name) from of_learn_deploy.migrations m where migration_name<>'learn_slack_user_operator_v1';"
            ledger = target.query(ledger_sql)
            m, sql = packages[-1]
            cases = [
                ('wrong_target', 'Reviewed production Slack setup target and checksum required',
                 prefix(m).replace('tgbnakbxwcqjeimygroz', 'saatxzwxvdvqevbnskxy')+sql),
                ('function_acl_drift', 'Production Slack setup function baseline differs', prefix(m)+sql.replace(
                    'begin;\n', 'begin;\ngrant execute on function public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text) to anon;\n', 1)),
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
            def unchanged_table(t):
                return {k:v for k,v in t.items() if k != 'triggers' or t['name'] not in m['changedTriggerTables']}
            if [unchanged_table(t) for t in after_catalog['tables'] if t['name'] not in m['newTables']] != [unchanged_table(t) for t in before_catalog['tables']] or after_catalog['views'] != before_catalog['views']:
                raise RecoveryError('Unexpected table/view change')
            for name in m['changedTriggerTables']:
                old = next(t['triggers'] for t in before_catalog['tables'] if t['name']==name)
                new = next(t['triggers'] for t in after_catalog['tables'] if t['name']==name)
                if len(old)!=len(new) or sum(a!=b for a,b in zip(old,new))!=1 or any({k:v for k,v in a.items() if k!='hash'}!={k:v for k,v in b.items() if k!='hash'} for a,b in zip(old,new)):
                    raise RecoveryError('Only one reference trigger per Slack table may change')
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
            expected_authority = {
                'learn_slack_credential_field': (False, True, True, False),
                'learn_slack_configure': (False, True, False, True),
                'learn_slack_control_access': (False, False, False, True),
                'learn_slack_reference_guard': (False, False, True, True),
                'learn_slack_connections_read': (False, True, False, True),
            }
            for f in additions:
                if tuple(f[k] for k in ['anonExecute','authenticatedExecute','serviceExecute','securityDefiner']) != expected_authority[f['name']]:
                    raise RecoveryError('New function authority differs')
            added_tables = [t for t in after_catalog['tables'] if t['name'] in m['newTables']]
            if len(added_tables) != 1 or not added_tables[0]['rls'] or added_tables[0]['policies'] or any(a['role'] != 'postgres' for a in added_tables[0]['acl']):
                raise RecoveryError('Private request table permissions differ')
            target.query("do $$begin assert not exists(select 1 from public.learn_slack_connection_requests);end$$;")
            if target.query(storage_sql) != storage or target.query(roles_sql) != roles or target.query(ledger_sql) != ledger:
                raise RecoveryError('Unrelated Storage/role/receipt change')
            target.query("do $$begin assert(select count(*)=1 from of_learn_deploy.migrations where migration_name='learn_slack_user_operator_v1');end$$;")
            after = without_ledger(restored_fingerprints(target))
            report['preservation'] = compare_native_data(before, projected(target, before, after))
            report['originalArchivePreservation'] = compare_native_data(original, projected(target, original, after, original_ids))
            write_private(out/'schema.json', after_catalog)
            try:
                target.query(prefix(m)+sql)
            except RecoveryError:
                log = Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                if 'Production Slack setup candidate already exists; inspect before retry' not in log or json.loads(target.query(inventory)) != after_catalog:
                    raise RecoveryError('Duplicate rejection differs')
                report['duplicateRejected'] = True
            else:
                raise RecoveryError('Duplicate package accepted')
            paths = [Path('scripts/verify/learn-production-slack-setup.assert.sql')]
            probe = 'set search_path=public,pg_catalog;set plpgsql.check_asserts=on;\n'+paths[0].read_text()
            clone = 'learn_slack_setup_journey'
            target.query('create database '+clone+' template postgres;')
            target.query('alter role supabase_admin in database '+clone+' set search_path=public,pg_catalog;')
            args = target._psql(); args[args.index('-d')+1] = clone
            try:
                result = subprocess.run([target.docker, *args], input=probe.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)
                if result.returncode:
                    write_private(out/'journey-error.json', {'error': result.stderr.decode()})
                    raise RecoveryError('Slack setup production-schema journey failed')
            finally:
                target.query('drop database '+clone+';')
            report['journey'] = {'passed': True, 'probeSha256': hashlib.sha256(probe.encode()).hexdigest(),
                'sources': [{'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]}
            import rehearse_production_slack as legacy
            legacy.OUT = out
            report['legacyBotJourneys'] = legacy.verify_journeys(target)
            target.query('drop database learn_slack_journeys;')
            report['postJourneyPreservation'] = compare_native_data(after, without_ledger(restored_fingerprints(target)))
            if json.loads(target.query(inventory)) != after_catalog or target.query(roles_sql) != roles:
                raise RecoveryError('Journey changed retained database')
            report.update(packages=[p['sha256'] for p, _ in packages], newFunctions=5, changedFunctions=15, newPrivateTables=1,
                existingTableDataAndPrivilegesUnchanged=True, scopedSlackReferenceTriggersChanged=2, viewsRolesStorageUnchanged=True, priorReceiptsUnchanged=True,
                addedReleaseReceipts=1, containmentAfter=target.verify_boundary())
        report.update(state='production_slack_setup_rehearsed_offline', containerRemoved=target.cleaned)
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
