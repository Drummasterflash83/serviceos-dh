"""Rehearse additive roster package 016 against the retained production archive.

No hosted connection, provider request, host mount, exposed port or active cron.
All journey records live in a disposable clone; original data is compared by COPY.
"""
import argparse
import io
import hashlib
import json
import subprocess
from pathlib import Path
from database_restore_sandbox import RestoreSandbox, RecoveryError
from restore_production_database import ROOT, IMAGE, PINNED_IMAGE, write_private, ident, literal
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_production_rules import prefix
from rehearse_production_measurements import project_original_columns
from native_copy_fingerprints import restored_fingerprints, compare_native_data, copy_fingerprints

DIRECTORY = Path('supabase/release/learn-production')

def check_packages():
    paths = sorted(DIRECTORY.glob('[0-9][0-9][0-9]_*.manifest.json'))
    if [int(p.name[:3]) for p in paths] != list(range(1, 17)):
        raise RecoveryError('Exact sixteen-package candidate required')
    packages = []
    for path in paths:
        manifest = json.loads(path.read_text())
        sql = path.with_name(path.name.replace('.manifest.json', '.sql')).read_text()
        if hashlib.sha256(sql.encode()).hexdigest() != manifest['sha256']:
            raise RecoveryError('Candidate checksum differs')
        for source in manifest.get('sources', []):
            if hashlib.sha256(Path(source['path']).read_bytes()).hexdigest() != source['sha256']:
                raise RecoveryError('Candidate source checksum differs')
        packages.append((manifest, sql))
    return packages

def without_ledger(value):
    value = dict(value)
    value['tables'] = [t for t in value['tables'] if (t['schema'], t['table']) != ('of_learn_deploy', 'migrations')]
    value['rows'] = sum(t['rows'] for t in value['tables'])
    return value

def projected(target, before, after, original_ids=None):
    observed = {(t['schema'], t['table']): t for t in after['tables']}
    result = dict(after)
    result['tables'] = []
    for table in before['tables']:
        now = observed.get((table['schema'], table['table']))
        if now is None:
            raise RecoveryError('Original table missing')
        key = (table['schema'], table['table'])
        if original_ids and key in original_ids:
            name = ident(table['schema'])+'.'+ident(table['table'])
            cols = ', '.join(map(ident,table['columns']))
            ids = 'array['+','.join(literal(x) for x in original_ids[key])+']::text[]'
            statement = "set timezone='UTC';set datestyle='ISO, MDY';set extra_float_digits=3;set bytea_output='hex';COPY (select "+cols+' from '+name+' where id::text=any('+ids+')) TO STDOUT;'
            rows = target._run(target._psql(),data=statement.encode())
            stream = ('COPY '+name+' ('+cols+') FROM stdin;\n').encode()+rows+b'\\.\n'
            result['tables'].append(copy_fingerprints(io.BytesIO(stream))['tables'][0])
        else:
            result['tables'].append(now if now['columns'] == table['columns'] else project_original_columns(target, table))
    result['rows'] = sum(t['rows'] for t in result['tables'])
    result['sequences'] = [s for s in after['sequences'] if s['name'] in {v['name'] for v in before['sequences']}]
    return result

def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    out = Path(args.output).resolve()
    if out.parent != Path('.verification-results').resolve() or out.exists():
        raise SystemExit('Fresh private output directory required')
    out.mkdir(mode=0o700)
    report = {'state':'preflight','productionChanged':False,'hostedTestChanged':False,'providerRequests':0}
    target = None
    try:
        packages = check_packages()
        target = RestoreSandbox(image=IMAGE, network_extension=True, storage_policy_hook=True,
                                private_diagnostics=out/'private-error')
        with target:
            if target.image_id != PINNED_IMAGE:
                raise RecoveryError('Image pin differs')
            prepare_archive_roles(target, json.loads((ROOT/'source-inventory.json').read_text()))
            archive = target.restore_native_archive(ROOT/'database.dump')
            if any(m['baselineArchive'] != archive for m, _ in packages):
                raise RecoveryError('Archive pin differs')
            report.update(archive=archive,containment=target.verify_boundary())
            original = restored_fingerprints(target)
            # Earlier reviewed packages add governed import profiles and a private
            # voicemail bucket. Compare every original row by its retained ID;
            # the complete post-015 set is separately protected around package 016.
            original_ids = {}
            for schema, table in [('public','import_profiles'),('storage','buckets')]:
                original_ids[(schema,table)] = json.loads(target.query("select coalesce(jsonb_agg(id::text),'[]') from "+ident(schema)+'.'+ident(table)+';'))
            for m, sql in packages[:15]:
                target.query(prefix(m)+sql)
            print(json.dumps({'stage':'fifteen_prerequisites_installed'}),flush=True)
            inventory = Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
            before_catalog = json.loads(target.query(inventory))
            before = without_ledger(restored_fingerprints(target))
            storage_sql = 'set search_path=public,pg_catalog;'+inventory.replace("='public'", "='storage'")
            storage = target.query(storage_sql)
            roles_sql = "select jsonb_build_object('roles',(select jsonb_agg(to_jsonb(r)-'rolpassword' order by rolname) from pg_roles r),'memberships',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m));"
            roles = target.query(roles_sql)
            ledger_sql = "select jsonb_agg(to_jsonb(m) order by migration_name) from of_learn_deploy.migrations m where migration_name<>'learn_roster_support_v1';"
            ledger = target.query(ledger_sql)
            m, sql = packages[15]
            report['negativeChecks'] = []
            cases = [
                ('wrong_target','Reviewed production roster target and checksum required',prefix(m).replace('tgbnakbxwcqjeimygroz','saatxzwxvdvqevbnskxy')+sql),
                ('table_drift','Production roster table baseline differs',prefix(m)+sql.replace('begin;\n','begin;\nalter table public.team_members add column rehearsal_drift text;\n',1)),
                ('late_failure','division by zero',prefix(m)+sql.replace('\ncommit;\n','\nselect 1/0;\ncommit;\n')),
            ]
            for name, expected, statement in cases:
                try:
                    target.query(statement)
                except RecoveryError:
                    log = Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                    if expected not in log or json.loads(target.query(inventory)) != before_catalog or target.query(ledger_sql) != ledger:
                        raise RecoveryError('Roster negative check failed: '+name)
                    report['negativeChecks'].append(name)
                else:
                    raise RecoveryError('Roster negative case accepted: '+name)
            target.query(prefix(m)+sql)
            after_catalog = json.loads(target.query(inventory))
            actual = {t['name']:t for t in after_catalog['tables']}
            if len(actual) != len(before_catalog['tables']) or after_catalog['views'] != before_catalog['views']:
                raise RecoveryError('Unexpected table/view change')
            for table in before_catalog['tables']:
                current = dict(actual[table['name']])
                if table['name'] == 'team_members':
                    extra = [c for c in current['columns'] if c['name'] not in {x['name'] for x in table['columns']}]
                    if {c['name'] for c in extra} != {'formal_role_status','target_role'}:
                        raise RecoveryError('Unexpected roster columns')
                    current['columns'] = [c for c in current['columns'] if c not in extra]
                    added = [c for c in current['constraints'] if c not in table['constraints']]
                    if len(added) != 1 or added[0]['name'] != 'team_members_formal_role_status_check':
                        raise RecoveryError('Unexpected roster constraint')
                    current['constraints'] = [c for c in current['constraints'] if c not in added]
                if current != table:
                    raise RecoveryError('Existing table properties changed: '+table['name'])
            originals = {(f['name'],f['arguments']):f for f in before_catalog['functions']}
            additions = []
            for f in after_catalog['functions']:
                key = (f['name'],f['arguments'])
                if key in originals:
                    if f != originals.pop(key):
                        raise RecoveryError('Existing function changed')
                else:
                    additions.append(f)
            if originals or len(additions) != 7 or {f['name'] for f in additions} != set(m['newFunctions']):
                raise RecoveryError('Unexpected roster functions')
            if any(f['anonExecute'] or f['authenticatedExecute'] or
                   f['serviceExecute'] != (f['name'] != 'learn_roster_write_guard') for f in additions):
                raise RecoveryError('Roster execute boundary differs')
            if target.query(storage_sql) != storage or target.query(roles_sql) != roles or target.query(ledger_sql) != ledger:
                raise RecoveryError('Unrelated Storage/role/receipt change')
            target.query("do $$begin assert not exists(select 1 from public.team_members where formal_role_status<>'proposed' or target_role is not null);assert(select count(*)=1 from of_learn_deploy.migrations where migration_name='learn_roster_support_v1');end$$;")
            after = without_ledger(restored_fingerprints(target))
            report['preservation'] = compare_native_data(before, projected(target,before,after))
            report['originalArchivePreservation'] = compare_native_data(original, projected(target,original,after,original_ids))
            write_private(out/'schema.json',after_catalog)
            try:
                target.query(prefix(m)+sql)
            except RecoveryError:
                log = Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                if 'Production roster candidate already exists; inspect before retry' not in log or json.loads(target.query(inventory)) != after_catalog:
                    raise RecoveryError('Roster duplicate rejection differs')
                report['duplicateRejected'] = True
            else:
                raise RecoveryError('Duplicate roster package accepted')
            fixture = Path('scripts/verify/learn-roster-recovery.assert.sql').read_text()
            old = "('work.assign','work','Assign work to others');"
            if fixture.count(old) != 1:
                raise RecoveryError('Roster fixture vocabulary changed')
            fixture = fixture.replace(old, "('work.assign','work','Assign work to others') on conflict(permission) do nothing;")
            clone = 'learn_roster_production_journey'
            target.query('create database '+clone+' template postgres;')
            target.query('alter role supabase_admin in database '+clone+' set search_path=public,pg_catalog;')
            args = target._psql();args[args.index('-d')+1]=clone
            probe = 'begin;set local search_path=public,pg_catalog;set local plpgsql.check_asserts=on;\n'+fixture+'\nreset role;rollback;'
            try:
                result = subprocess.run([target.docker,*args],input=probe.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
                if result.returncode:
                    write_private(out/'roster-journey-error.json',{'error':result.stderr.decode()})
                    raise RecoveryError('Production roster journey failed')
            finally:
                target.query('drop database '+clone+';')
            report['journey'] = {'name':'learn-roster-recovery.assert.sql','sourceSha256':hashlib.sha256(Path('scripts/verify/learn-roster-recovery.assert.sql').read_bytes()).hexdigest(),'probeSha256':hashlib.sha256(probe.encode()).hexdigest(),'passed':True}
            final = without_ledger(restored_fingerprints(target))
            report['postJourneyPreservation'] = compare_native_data(after,final)
            if json.loads(target.query(inventory)) != after_catalog or target.query(roles_sql) != roles:
                raise RecoveryError('Journey changed primary schema or role state')
            report.update(packages=[p['sha256'] for p,_ in packages],newFunctions=7,newColumns=2,
                          existingFunctionsViewsRolesStorageUnchanged=True,priorReceiptsUnchanged=True,
                          addedReleaseReceipts=1,containmentAfter=target.verify_boundary())
        report.update(state='production_roster_support_rehearsed_offline',containerRemoved=target.cleaned)
        write_private(out/'report.json',report)
        print(json.dumps(report),flush=True)
    except Exception as error:
        report.update(state='rehearsal_failed',containerRemoved=bool(target and target.cleaned),
                      failure=str(error) if isinstance(error,RecoveryError) else 'Rehearsal failed; private diagnostics retained')
        write_private(out/'report.json',report)
        print(json.dumps(report),flush=True)
        raise SystemExit(1) from None

if __name__ == '__main__':
    run()
