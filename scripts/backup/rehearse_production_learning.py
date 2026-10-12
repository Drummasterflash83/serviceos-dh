"""Rehearse packages 001–022 on the retained isolated production archive.
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
        if [int(p.name[:3]) for p in paths] != list(range(1, 23)):
            raise RecoveryError('Exact twenty-two-package candidate required')
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
            for m, sql in packages[:21]:
                target.query(prefix(m)+sql)
            print(json.dumps({'stage': 'twenty_one_prerequisites_installed'}), flush=True)
            inventory = Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
            before_catalog = json.loads(target.query(inventory))
            write_private(out/'before-schema.json', before_catalog)
            write_private(out/'package-context-schema.json', json.loads(target.query('set role postgres;set search_path=public,pg_catalog;'+inventory)))
            # Archived running rows are not live executions in this networkless clone.
            # Exercise the guard, then simulate drain only here, retaining exact originals.
            m,sql=packages[-1]
            running=int(target.query("select count(*) from public.platform_jobs where status='running'"))
            if running:
                try:target.query(prefix(m)+sql)
                except RecoveryError:
                    log=Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                    if 'Running work must drain' not in log:raise RecoveryError('Archived running guard differed')
                else:raise RecoveryError('Running-work guard did not reject')
            target.query("create schema learning_rehearsal;create table learning_rehearsal.archived_running as select id,status from public.platform_jobs where status='running';begin;alter table public.platform_jobs disable trigger user;update public.platform_jobs set status='cancelled' where id in(select id from learning_rehearsal.archived_running);alter table public.platform_jobs enable trigger user;commit;")
            report['offlineDrainSimulation']={'archivedRunningRows':running,'runningGuardRejected':bool(running),'hostedChanges':False,'liveDrainProven':False}
            before = without_ledger(restored_fingerprints(target))
            storage_sql = 'set search_path=public,pg_catalog;' + inventory.replace("='public'", "='storage'")
            storage = target.query(storage_sql)
            roles_sql = "select jsonb_build_object('roles',(select jsonb_agg(to_jsonb(r)-'rolpassword' order by rolname) from pg_roles r),'memberships',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m));"
            roles = target.query(roles_sql)
            ledger_sql = "select jsonb_agg(to_jsonb(m) order by migration_name) from of_learn_deploy.migrations m where migration_name<>'learn_learning_delivery_reads_v1';"
            ledger = target.query(ledger_sql)
            m, sql = packages[-1]
            cases = [
                ('wrong_target', 'Production learning target/checksum required',
                 prefix(m).replace('tgbnakbxwcqjeimygroz', 'saatxzwxvdvqevbnskxy')+sql),
                ('missing_prerequisite', 'Pinned learning prerequisite missing', prefix(m)+sql.replace(
                    'begin;\n', "begin;\ndelete from of_learn_deploy.migrations where migration_name='learn_slack_work_context_v1';\n", 1)),
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
            if retained_tables != before_catalog['tables'] or after_catalog['views'] != before_catalog['views']:
                raise RecoveryError('Unexpected table/view change')
            new_tables = [t for t in after_catalog['tables'] if t['name'] in m['newTables']]
            if sorted(t['name'] for t in new_tables) != sorted(m['newTables']) or any(
                not t['rls'] or t['owner'] != 'postgres' or t['policies'] or
                any(a['role'] in ['PUBLIC','anon','authenticated','service_role'] for a in t['acl']) for t in new_tables):
                raise RecoveryError('Learning receipts isolation differs')
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
                expected_auth = False
                expected_service = True
                if f['anonExecute'] or f['authenticatedExecute'] != expected_auth or f['serviceExecute'] != expected_service or not f['securityDefiner'] or f['owner'] != 'postgres':
                    raise RecoveryError('Learning service function authority differs')
            if target.query(storage_sql) != storage or target.query(roles_sql) != roles or target.query(ledger_sql) != ledger:
                raise RecoveryError('Unrelated Storage/role/receipt change')
            target.query("do $$begin assert(select count(*)=1 from of_learn_deploy.migrations where migration_name='learn_learning_delivery_reads_v1');end$$;")
            after = without_ledger(restored_fingerprints(target))
            report['preservation'] = compare_native_data(before, projected(target, before, after))
            if any(t['rows'] for t in after['tables'] if t['schema']=='public' and t['table'] in m['newTables']):
                raise RecoveryError('Installation unexpectedly created review data')

            write_private(out/'schema.json', after_catalog)
            try:
                target.query(prefix(m)+sql)
            except RecoveryError:
                log = Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                if 'Learning package already exists; inspect before retry' not in log or json.loads(target.query(inventory)) != after_catalog:
                    raise RecoveryError('Duplicate rejection differs')
                report['duplicateRejected'] = True
            else:
                raise RecoveryError('Duplicate package accepted')
            fixture=json.loads(Path('.verification-results/learn-observation-synthetic-fixture.json').read_text())
            paths=[Path('scripts/verify/learn-observation-delivery.assert.sql'),Path('scripts/verify/openfolk-client-information.assert.sql'),Path('scripts/verify/openfolk-learning-information.assert.sql'),Path('scripts/verify/learn-learning-counts.assert.sql')]
            observation=paths[0].read_text()
            for key in ('draft','result'):
                observation=observation.replace('__'+key.upper()+'__',"$fixture$"+json.dumps(fixture[key])+"$fixture$::jsonb")
            probe='set role postgres;set search_path=public,pg_catalog;begin;set local plpgsql.check_asserts=on;\n'+observation+'\n'+paths[1].read_text()+'\n'+paths[2].read_text()+'\nreset role;\n'+paths[3].read_text()+'\nrollback;'
            target.query(probe)
            report['journey']={'passed':True,'probeSha256':hashlib.sha256(probe.encode()).hexdigest(),'sources':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]}
            post=without_ledger(restored_fingerprints(target))
            if after['tables']!=post['tables']:raise RecoveryError('Synthetic rollback changed retained rows')
            changes=[{'before':a,'after':b} for a,b in zip(after['sequences'],post['sequences']) if a!=b]
            if len(after['sequences'])!=len(post['sequences']) or len(changes)!=1 or changes[0]['before']['name']!='public.learn_work_capture_sequence':
                raise RecoveryError('Unexpected synthetic sequence change')
            report['syntheticSequenceAdvance']=changes
            report['postJourneyRetainedTablesPreserved']=True
            if json.loads(target.query(inventory)) != after_catalog or target.query(roles_sql) != roles:
                raise RecoveryError('Journey changed retained database')
            target.query("begin;alter table public.platform_jobs disable trigger user;update public.platform_jobs p set status=s.status from learning_rehearsal.archived_running s where p.id=s.id;alter table public.platform_jobs enable trigger user;drop schema learning_rehearsal cascade;commit;")
            restored=without_ledger(restored_fingerprints(target))
            # Synthetic work sequence advances cannot roll back. Original sequence
            # comparison excludes only that new release sequence, absent in the archive.
            report['originalArchivePreservation']=compare_native_data(original,projected(target,original,restored,original_ids))
            report['offlineDrainSimulation']['archivedRowsRestored']=True
            report.update(packages=[p['sha256'] for p, _ in packages], newFunctions=len(m['newFunctions']), changedFunctions=len(m['changedFunctions']), newTables=len(m['newTables']),
                existingTablesViewsRolesStorageUnchanged=True, existingViewsRolesStorageUnchanged=True, priorReceiptsUnchanged=True,
                addedReleaseReceipts=1, containmentAfter=target.verify_boundary())
        report.update(state='production_learning_rehearsed_offline', containerRemoved=target.cleaned)
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
