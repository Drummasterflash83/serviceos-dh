"""Offline full-schema proof of fixed historical Slack ranges. No hosted/provider calls."""
import argparse
import hashlib
import json
import subprocess
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
    options = parser.parse_args()
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
            # Actual production helpers, both the tenant bot route and logged
            # cross-client user-token operator route. All synthetic rows are
            # contained in disposable child databases.
            report['journeys'] = []
            for clone, names in [
                ('historical_tenant', ['learn-production-slack', 'learn-production-slack-threads', 'learn-slack-historical-recovery']),
                ('historical_operator', ['learn-production-slack-setup']),
                *([('message_kinds', ['learn-production-slack', 'learn-slack-message-kinds'])] if options.with_message_kinds else []),
            ]:
                target.query('create database '+clone+' template postgres;')
                target.query('alter role supabase_admin in database '+clone+' set search_path=public,pg_catalog;')
                args = target._psql(); args[args.index('-d')+1] = clone
                try:
                    for name in names:
                        path = Path('scripts/verify')/(name+'.assert.sql')
                        probe = 'set plpgsql.check_asserts=on;\n'+(path.read_text() if name in ('learn-slack-historical-recovery', 'learn-slack-message-kinds') else historical_probe(path))
                        (out/(name+'.sql')).write_text(probe)
                        result = subprocess.run([target.docker, *args], input=probe.encode(), stdout=subprocess.PIPE,
                                                stderr=subprocess.PIPE, timeout=300)
                        if result.returncode:
                            write_private(out/(name+'-error.json'), {'error': result.stderr.decode()})
                            raise RecoveryError('Historical journey failed: '+name)
                        report['journeys'].append({'path': str(path), 'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                                  'probeSha256': hashlib.sha256(probe.encode()).hexdigest(), 'passed': True})
                        print('PASS: historical '+name, flush=True)
                finally:
                    target.query('drop database '+clone+';')
            report['postJourneyPreservation'] = compare_native_data(before, restored_fingerprints(target))
            if schema() != after_schema:
                raise RecoveryError('Journey changed retained schema')
            write_private(out/'schema.json', after_schema)
            report.update(state='slack_historical_ranges_rehearsed_offline', changedFunctions=sorted(changed),
                          existingFunctionAuthorityUnchanged=True, tablesViewsAndDataUnchanged=True,
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
