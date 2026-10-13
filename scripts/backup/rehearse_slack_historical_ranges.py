"""Offline full-schema proof of fixed historical Slack ranges. No hosted/provider calls."""
import argparse
import hashlib
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from database_restore_sandbox import RestoreSandbox, RecoveryError
from restore_production_database import ROOT, IMAGE, PINNED_IMAGE, write_private
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_production_rules import prefix
from native_copy_fingerprints import restored_fingerprints, compare_native_data

SOURCE = Path('supabase/migrations/20261101650000_learn_slack_historical_ranges.sql')
CHANGED = {'learn_slack_start_import', 'learn_slack_start_thread_import',
           'learn_slack_commit_page_private', 'learn_slack_history_state',
           'learn_slack_thread_recovery_state'}


def historical_probe(path):
    """Run established storage/recovery/authority journeys over ten years.

    Only literal bounds and the observed root timestamp change. The later reply
    timestamps stay in 2026, proving the old root does not truncate its replies.
    Existing assertions, page budgets, source identities and permissions remain.
    """
    sql = path.read_text()
    if "'2026-01-01'" not in sql or "'2026-01-02'" not in sql:
        raise RecoveryError('Expected historical fixture dates missing')
    return sql.replace("'2026-01-01'", "'2016-01-01'").replace(
        "'2026-01-02'", "'2026-10-01'").replace('1767225700.000001', '1451606500.000001')


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--with-message-kinds', action='store_true')
    parser.add_argument('--with-campaigns', action='store_true')
    parser.add_argument('--with-campaign-threads', action='store_true')
    parser.add_argument('--with-campaign-lifecycle', action='store_true')
    parser.add_argument('--with-campaign-controller', action='store_true')
    options = parser.parse_args()
    if options.with_campaign_controller:
        options.with_campaign_lifecycle = True
    if options.with_campaign_lifecycle:
        options.with_campaign_threads = True
    if options.with_campaign_threads:
        options.with_campaigns = True
    if options.with_campaigns:
        options.with_message_kinds = True
    out = Path(options.output).resolve()
    if out.parent != Path('.verification-results').resolve() or out.exists():
        raise SystemExit('Fresh private output directory required')
    out.mkdir(mode=0o700)
    report = {'state': 'preflight', 'productionChanged': False, 'hostedTestChanged': False,
              'providerRequests': 0, 'source': str(SOURCE), 'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest()}
    target = None
    try:
        packages = []
        paths = sorted(Path('supabase/release/learn-production').glob('[0-9][0-9][0-9]_*.manifest.json'))
        if [int(p.name[:3]) for p in paths] != list(range(1, 24)):
            raise RecoveryError('Reviewed twenty-three prerequisites required')
        for path in paths:
            manifest = json.loads(path.read_text())
            sql = path.with_name(path.name.replace('.manifest.json', '.sql')).read_text()
            if hashlib.sha256(sql.encode()).hexdigest() != manifest['sha256']:
                raise RecoveryError('Prerequisite checksum differs')
            for s in manifest.get('sources', [manifest['source']] if 'source' in manifest else []):
                if hashlib.sha256(Path(s['path']).read_bytes()).hexdigest() != s['sha256']:
                    raise RecoveryError('Prerequisite source checksum differs')
            packages.append((manifest, sql))
        target = RestoreSandbox(image=IMAGE, network_extension=True, storage_policy_hook=True,
                                synthetic_vault=True, private_diagnostics=out/'private-error')
        with target:
            if target.image_id != PINNED_IMAGE:
                raise RecoveryError('Image pin differs')
            prepare_archive_roles(target, json.loads((ROOT/'source-inventory.json').read_text()))
            archive = target.restore_native_archive(ROOT/'database.dump')
            if any(m['baselineArchive'] != archive for m, _ in packages):
                raise RecoveryError('Archive pin differs')
            report.update(archive=archive, containment=target.verify_boundary())
            for m, sql in packages[:21]:
                target.query(prefix(m)+sql)
            # Simulate 022's drain only in this networkless clone and restore
            # archived job values immediately. This is not live drain evidence.
            target.query("create schema historical_rehearsal;create table historical_rehearsal.running as select id,status from public.platform_jobs where status='running';begin;alter table public.platform_jobs disable trigger user;update public.platform_jobs set status='cancelled' where id in(select id from historical_rehearsal.running);alter table public.platform_jobs enable trigger user;commit;")
            m, sql = packages[21]
            target.query(prefix(m)+sql)
            target.query("begin;alter table public.platform_jobs disable trigger user;update public.platform_jobs j set status=r.status from historical_rehearsal.running r where j.id=r.id;alter table public.platform_jobs enable trigger user;drop schema historical_rehearsal cascade;commit;")
            m, sql = packages[22]
            target.query(prefix(m)+sql)
            print('All 23 prerequisites installed offline; testing historical range migration.', flush=True)
            inventory = Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
            schema = lambda: json.loads(target.query(inventory))
            before_schema = schema()
            before = restored_fingerprints(target)
            source = SOURCE.read_text()
            target.query(source.replace('\ncommit;\n', '\nrollback;\n'))
            if schema() != before_schema:
                raise RecoveryError('Rollback changed schema')
            compare_native_data(before, restored_fingerprints(target))
            report['rollbackVerified'] = True
            target.query(source)
            after_schema = schema()
            old = {(f['name'], f['arguments']): f for f in before_schema['functions']}
            changed = []
            for f in after_schema['functions']:
                prior = old.pop((f['name'], f['arguments']), None)
                if prior is None:
                    raise RecoveryError('Unexpected new function')
                if prior != f:
                    if {k:v for k,v in prior.items() if k != 'hash'} != {k:v for k,v in f.items() if k != 'hash'}:
                        raise RecoveryError('Existing function authority changed')
                    changed.append(f['name'])
            if old or set(changed) != CHANGED or before_schema['tables'] != after_schema['tables'] or before_schema['views'] != after_schema['views']:
                raise RecoveryError('Unexpected schema change')
            report['preservation'] = compare_native_data(before, restored_fingerprints(target))
            try:
                target.query(source)
            except RecoveryError:
                log = Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                if 'Reviewed Slack historical range predicate differs' not in log or schema() != after_schema:
                    raise RecoveryError('Duplicate/drift rejection differs')
            else:
                raise RecoveryError('Duplicate migration accepted')
            report['duplicateRejected'] = True
            if options.with_message_kinds:
                kinds = Path('supabase/migrations/20261101660000_learn_slack_message_kinds.sql')
                kinds_source = kinds.read_text()
                target.query(kinds_source.replace('\ncommit;\n', '\nrollback;\n'))
                if schema() != after_schema:
                    raise RecoveryError('Message kinds rollback changed schema')
                target.query(kinds_source)
                kind_schema = schema()
                old_functions = {(f['name'], f['arguments']): f for f in after_schema['functions']}
                new_functions = {(f['name'], f['arguments']): f for f in kind_schema['functions']}
                added = set(new_functions) - set(old_functions)
                if len(added) != 1 or next(iter(added))[0] != 'learn_slack_message_kind' or set(old_functions)-set(new_functions):
                    raise RecoveryError('Unexpected message-kind function inventory')
                changed_kinds = []
                for key, prior in old_functions.items():
                    current = new_functions[key]
                    if current != prior:
                        if {k:v for k,v in prior.items() if k != 'hash'} != {k:v for k,v in current.items() if k != 'hash'}:
                            raise RecoveryError('Message-kind authority changed')
                        changed_kinds.append(key[0])
                if changed_kinds != ['learn_slack_store_records'] or after_schema['tables'] != kind_schema['tables'] or after_schema['views'] != kind_schema['views']:
                    raise RecoveryError('Unexpected message-kind schema change')
                compare_native_data(before, restored_fingerprints(target))
                try:
                    target.query(kinds_source)
                except RecoveryError:
                    if schema() != kind_schema:
                        raise RecoveryError('Duplicate message-kind migration changed schema')
                else:
                    raise RecoveryError('Duplicate message-kind migration accepted')
                after_schema = kind_schema
                report['messageKinds'] = {'source': str(kinds), 'sha256': hashlib.sha256(kinds_source.encode()).hexdigest(),
                                         'rollbackVerified': True, 'duplicateRejected': True,
                                         'existingFunctionAuthorityUnchanged': True, 'existingDataUnchanged': True}
            if options.with_campaigns:
                campaign_path = Path('supabase/migrations/20261101670000_learn_slack_history_campaigns.sql')
                campaign_source = campaign_path.read_text()
                target.query(campaign_source.replace('\ncommit;\n', '\nrollback;\n'))
                if schema() != after_schema:
                    raise RecoveryError('Campaign rollback changed schema')
                compare_native_data(before, restored_fingerprints(target))
                target.query(campaign_source)
                campaign_schema = schema()
                old_tables = {t['name']: t for t in after_schema['tables']}
                new_tables = {t['name']: t for t in campaign_schema['tables']}
                expected_tables = {'slack_history_campaigns','slack_history_campaign_channels',
                                   'slack_history_campaign_requests','slack_history_campaign_dispatches'}
                if set(new_tables)-set(old_tables) != expected_tables or any(new_tables.get(k)!=v for k,v in old_tables.items()):
                    raise RecoveryError('Campaign changed existing table schema')
                before_campaign = restored_fingerprints(target)
                added_tables = [t for t in before_campaign['tables'] if t['schema']=='public' and t['table'] in expected_tables]
                if len(added_tables)!=4 or any(t['rows']!=0 for t in added_tables):
                    raise RecoveryError('Campaign migration seeded data')
                stripped = {**before_campaign,'tables':[t for t in before_campaign['tables'] if t not in added_tables]}
                report['campaignOriginalDataPreservation'] = compare_native_data(before,stripped)
                old_funcs = {(f['name'],f['arguments']):f for f in after_schema['functions']}
                new_funcs = {(f['name'],f['arguments']):f for f in campaign_schema['functions']}
                changed_campaign = []
                for key,prior in old_funcs.items():
                    current = new_funcs.get(key)
                    if current is None or {k:v for k,v in prior.items() if k!='hash'} != {k:v for k,v in current.items() if k!='hash'}:
                        raise RecoveryError('Campaign changed existing function authority')
                    if current != prior:
                        changed_campaign.append(key[0])
                expected_changed = {'learn_slack_reference_guard','learn_slack_start_import','learn_slack_resume_history',
                  'learn_slack_start_thread_import','learn_slack_resume_thread','learn_slack_recurring_control','learn_slack_claim_jobs',
                  'learn_slack_read_credential','learn_slack_read_thread_credential','learn_slack_commit_page_private','slack_thread_commit_page'}
                if set(changed_campaign)!=expected_changed or after_schema['views']!=campaign_schema['views']:
                    raise RecoveryError('Unexpected campaign function/view change')
                try:
                    target.query(campaign_source)
                except RecoveryError:
                    if schema()!=campaign_schema:
                        raise RecoveryError('Duplicate campaign migration changed schema')
                else:
                    raise RecoveryError('Duplicate campaign migration accepted')
                before = before_campaign
                after_schema = campaign_schema
                report['campaigns'] = {'source':str(campaign_path),'sha256':hashlib.sha256(campaign_source.encode()).hexdigest(),
                  'rollbackVerified':True,'duplicateRejected':True,'newTables':sorted(expected_tables),
                  'changedFunctions':sorted(changed_campaign),'existingAuthorityUnchanged':True}
            if options.with_campaign_threads:
                thread_path = Path('supabase/migrations/20261101680000_learn_slack_campaign_threads.sql')
                thread_source = thread_path.read_text()
                target.query(thread_source.replace('\ncommit;\n', '\nrollback;\n'))
                if schema() != after_schema:
                    raise RecoveryError('Campaign threads rollback changed schema')
                compare_native_data(before, restored_fingerprints(target))
                target.query(thread_source)
                thread_schema = schema()
                old_tables = {t['name']:t for t in after_schema['tables']}
                new_tables = {t['name']:t for t in thread_schema['tables']}
                expected_tables = {'slack_history_campaign_thread_scans','slack_history_campaign_threads'}
                if set(new_tables)-set(old_tables)!=expected_tables or any(new_tables.get(k)!=v for k,v in old_tables.items()):
                    raise RecoveryError('Campaign threads changed existing table schema')
                before_threads = restored_fingerprints(target)
                added_tables = [t for t in before_threads['tables'] if t['schema']=='public' and t['table'] in expected_tables]
                if len(added_tables)!=2 or any(t['rows']!=0 for t in added_tables):
                    raise RecoveryError('Campaign threads migration seeded data')
                stripped = {**before_threads,'tables':[t for t in before_threads['tables'] if t not in added_tables]}
                report['campaignThreadDataPreservation'] = compare_native_data(before,stripped)
                old_funcs = {(f['name'],f['arguments']):f for f in after_schema['functions']}
                new_funcs = {(f['name'],f['arguments']):f for f in thread_schema['functions']}
                changed_threads = []
                for key,prior in old_funcs.items():
                    current = new_funcs.get(key)
                    if current is None or {k:v for k,v in prior.items() if k!='hash'}!={k:v for k,v in current.items() if k!='hash'}:
                        raise RecoveryError('Campaign threads changed existing function authority')
                    if current!=prior:
                        changed_threads.append(key[0])
                if set(changed_threads)!={'learn_slack_reference_guard','learn_slack_campaign_job_allowed','learn_slack_schedule_campaigns','learn_slack_campaign_read'} or after_schema['views']!=thread_schema['views']:
                    raise RecoveryError('Unexpected campaign thread function/view change')
                try:
                    target.query(thread_source)
                except RecoveryError:
                    if schema()!=thread_schema:
                        raise RecoveryError('Duplicate campaign threads migration changed schema')
                else:
                    raise RecoveryError('Duplicate campaign threads migration accepted')
                before = before_threads
                after_schema = thread_schema
                report['campaignThreads'] = {'source':str(thread_path),'sha256':hashlib.sha256(thread_source.encode()).hexdigest(),
                  'rollbackVerified':True,'duplicateRejected':True,'newTables':sorted(expected_tables),
                  'changedFunctions':sorted(changed_threads),'existingAuthorityUnchanged':True}
            if options.with_campaign_lifecycle:
                lifecycle_path = Path('supabase/migrations/20261101690000_learn_slack_campaign_lifecycle.sql')
                lifecycle_source = lifecycle_path.read_text()
                target.query(lifecycle_source.replace('\ncommit;\n', '\nrollback;\n'))
                if schema() != after_schema:
                    raise RecoveryError('Campaign lifecycle rollback changed schema')
                compare_native_data(before, restored_fingerprints(target))
                target.query(lifecycle_source)
                lifecycle_schema = schema()
                old_tables = {t['name']:t for t in after_schema['tables']}
                new_tables = {t['name']:t for t in lifecycle_schema['tables']}
                expected_tables = {'slack_history_campaign_closures'}
                if set(new_tables)-set(old_tables)!=expected_tables or any(new_tables.get(k)!=v for k,v in old_tables.items()):
                    raise RecoveryError('Campaign lifecycle changed existing table schema')
                before_lifecycle = restored_fingerprints(target)
                added_tables = [t for t in before_lifecycle['tables'] if t['schema']=='public' and t['table'] in expected_tables]
                if len(added_tables)!=1 or any(t['rows']!=0 for t in added_tables):
                    raise RecoveryError('Campaign lifecycle migration seeded data')
                stripped = {**before_lifecycle,'tables':[t for t in before_lifecycle['tables'] if t not in added_tables]}
                report['campaignLifecycleDataPreservation'] = compare_native_data(before,stripped)
                old_funcs = {(f['name'],f['arguments']):f for f in after_schema['functions']}
                new_funcs = {(f['name'],f['arguments']):f for f in lifecycle_schema['functions']}
                changed_lifecycle = []
                for key,prior in old_funcs.items():
                    current = new_funcs.get(key)
                    if current is None or {k:v for k,v in prior.items() if k!='hash'}!={k:v for k,v in current.items() if k!='hash'}:
                        raise RecoveryError('Campaign lifecycle changed existing function authority')
                    if current!=prior:
                        changed_lifecycle.append(key[0])
                if set(changed_lifecycle)!={'learn_slack_campaign_job_allowed','learn_slack_campaign_control','learn_slack_campaign_channel_progress','learn_slack_campaign_read'} or after_schema['views']!=lifecycle_schema['views']:
                    raise RecoveryError('Unexpected campaign lifecycle function/view change')
                try:
                    target.query(lifecycle_source)
                except RecoveryError:
                    if schema()!=lifecycle_schema:
                        raise RecoveryError('Duplicate campaign lifecycle migration changed schema')
                else:
                    raise RecoveryError('Duplicate campaign lifecycle migration accepted')
                before = before_lifecycle
                after_schema = lifecycle_schema
                report['campaignLifecycle'] = {'source':str(lifecycle_path),'sha256':hashlib.sha256(lifecycle_source.encode()).hexdigest(),
                  'rollbackVerified':True,'duplicateRejected':True,'newTables':sorted(expected_tables),
                  'changedFunctions':sorted(changed_lifecycle),'existingAuthorityUnchanged':True}
            if options.with_campaign_controller:
                controller_path = Path('supabase/migrations/20261101700000_learn_slack_campaign_controller.sql')
                controller_source = controller_path.read_text()
                target.query(controller_source.replace('\ncommit;\n', '\nrollback;\n'))
                if schema()!=after_schema:
                    raise RecoveryError('Controller rollback changed schema')
                target.query(controller_source)
                controller_schema = schema()
                old_funcs = {(f['name'],f['arguments']):f for f in after_schema['functions']}
                new_funcs = {(f['name'],f['arguments']):f for f in controller_schema['functions']}
                if any(new_funcs.get(k)!=v for k,v in old_funcs.items()) or {k[0] for k in set(new_funcs)-set(old_funcs)}!={'learn_slack_campaign_list','learn_slack_campaign_dispatch'} or after_schema['tables']!=controller_schema['tables'] or after_schema['views']!=controller_schema['views']:
                    raise RecoveryError('Unexpected controller schema change')
                report['controllerDataPreservation'] = compare_native_data(before, restored_fingerprints(target))
                try:
                    target.query(controller_source)
                except RecoveryError:
                    if schema()!=controller_schema:
                        raise RecoveryError('Duplicate controller changed schema')
                else:
                    raise RecoveryError('Duplicate controller accepted')
                after_schema = controller_schema
                report['campaignController'] = {'source':str(controller_path),'sha256':hashlib.sha256(controller_source.encode()).hexdigest(),
                  'rollbackVerified':True,'duplicateRejected':True,'existingSchemaAndDataUnchanged':True}
            # Actual production helpers, both the tenant bot route and logged
            # cross-client user-token operator route. All synthetic rows are
            # contained in disposable child databases.
            report['journeys'] = []
            for clone, names in [
                ('historical_tenant', ['learn-production-slack', 'learn-production-slack-threads', 'learn-slack-historical-recovery']),
                ('historical_operator', ['learn-production-slack-setup']),
                *([('campaigns', ['learn-slack-campaign'])] if options.with_campaigns else []),
                *([('campaign_threads', ['learn-slack-campaign-threads', *(['learn-slack-campaign-lifecycle'] if options.with_campaign_lifecycle else []), *(['learn-slack-campaign-controller'] if options.with_campaign_controller else [])])] if options.with_campaign_threads else []),
                *([('message_kinds', ['learn-production-slack', 'learn-slack-message-kinds'])] if options.with_message_kinds else []),
            ]:
                target.query('create database '+clone+' template postgres;')
                target.query('alter role supabase_admin in database '+clone+' set search_path=public,pg_catalog;')
                args = target._psql(); args[args.index('-d')+1] = clone
                try:
                    for name in names:
                        path = Path('scripts/verify')/(name+'.assert.sql')
                        probe = 'set plpgsql.check_asserts=on;\n'+(path.read_text() if name in ('learn-slack-historical-recovery', 'learn-slack-message-kinds', 'learn-slack-campaign', 'learn-slack-campaign-threads', 'learn-slack-campaign-lifecycle', 'learn-slack-campaign-controller') else historical_probe(path))
                        if options.with_campaign_threads and name == 'learn-slack-campaign':
                            # The same retained root now queues its replies after channel completion.
                            probe = probe.replace("state='history_captured_threads_pending'", "state='thread_queued'")
                        (out/(name+'.sql')).write_text(probe)
                        result = subprocess.run([target.docker, *args], input=probe.encode(), stdout=subprocess.PIPE,
                                                stderr=subprocess.PIPE, timeout=300)
                        if result.returncode:
                            write_private(out/(name+'-error.json'), {'error': result.stderr.decode()})
                            raise RecoveryError('Historical journey failed: '+name)
                        report['journeys'].append({'path': str(path), 'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                                  'probeSha256': hashlib.sha256(probe.encode()).hexdigest(), 'passed': True})
                        if name == 'learn-slack-campaign':
                            def reserve(slot):
                                probe = "set request.jwt.claim.role='service_role';set role service_role;select public.learn_slack_campaign_reserve_request(verify.id(1),job_id,claimed_by,attempt,"+('9' if slot==1 else '1')+") from verify.concurrent_jobs where slot="+str(slot)+";"
                                result = subprocess.run([target.docker,*args],input=probe.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
                                if result.returncode:
                                    write_private(out/('campaign-race-'+str(slot)+'-error.json'), {'error':result.stderr.decode()})
                                    raise RecoveryError('Campaign reservation race failed')
                                return result.stdout.decode().strip().splitlines()[-1]
                            with ThreadPoolExecutor(max_workers=2) as pool:
                                results = list(pool.map(reserve,[1,2]))
                            if sorted(results)!=['f','t']:
                                raise RecoveryError('Campaign shared budget was not enforced concurrently')
                            check = "do $$begin assert (select requests_reserved=9 from public.slack_history_campaigns where id=verify.id(60));assert (select count(*)=9 from public.slack_history_campaign_dispatches where campaign_id=verify.id(60));end$$;"
                            result = subprocess.run([target.docker,*args],input=check.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
                            if result.returncode:
                                raise RecoveryError('Campaign final concurrent budget differs')
                            report['campaigns']['concurrentLastReservationVerified'] = True
                        print('PASS: historical '+name, flush=True)
                finally:
                    target.query('drop database '+clone+';')
            report['postJourneyPreservation'] = compare_native_data(before, restored_fingerprints(target))
            if schema() != after_schema:
                raise RecoveryError('Journey changed retained schema')
            write_private(out/'schema.json', after_schema)
            report.update(state='slack_historical_ranges_rehearsed_offline', changedFunctions=sorted(changed),
                          existingFunctionAuthorityUnchanged=True, existingTablesViewsAndDataUnchanged=True,
                          containmentAfter=target.verify_boundary(), fullHistoryAccepted=False)
        report['containerRemoved'] = target.cleaned
    except Exception as error:
        report.update(state='requires_inspection', containerRemoved=bool(target and target.cleaned),
                      failure=str(error) if isinstance(error, RecoveryError) else 'Inspect private diagnostics')
        raise
    finally:
        write_private(out/'report.json', report)
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    run()
