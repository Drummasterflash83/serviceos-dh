"""Offline combined release rehearsal; no hosted connections or provider calls."""
import hashlib
import subprocess
import json
import time
from pathlib import Path
from database_restore_sandbox import RecoveryError, RestoreSandbox
from restore_production_database import ROOT, IMAGE, PINNED_IMAGE, write_private
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_production_rules import prefix
from rehearse_production_measurements import project_original_columns
from native_copy_fingerprints import restored_fingerprints, compare_native_data

OUT=Path('.verification-results/production-slack-rehearsal-v2')
DIRECTORY=Path('supabase/release/learn-production')


def verify_journeys(target):
    target.query('create database learn_slack_journeys template postgres;')
    target.query('alter role supabase_admin in database learn_slack_journeys set search_path=public,pg_catalog;')
    args=target._psql();args[args.index('-d')+1]='learn_slack_journeys'
    names=['learn-production-slack','learn-production-slack-threads']
    results=[]
    for name in names:
        path=Path('scripts/verify')/(name+'.assert.sql');sql=path.read_text()
        result=subprocess.run([target.docker,*args],input=('set search_path=public,pg_catalog;'+sql).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
        if result.returncode:
            write_private(OUT/(name+'-error.json'),{'error':result.stderr.decode()})
            raise RecoveryError('Slack journey failed: '+name)
        results.append({'path':str(path),'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'probeSha256':hashlib.sha256(sql.encode()).hexdigest()})
        print(json.dumps({'journeyPassed':name}),flush=True)
    return results


def run():
    OUT.mkdir(mode=0o700,exist_ok=False)
    report={'state':'preflight','productionChanged':False,'hostedTestChanged':False,'providerRequests':0,
        'fullReleaseAccepted':False,'signedInAcceptance':False}
    target=None;started=time.monotonic()
    try:
        packages=[]
        for name in ['001_launch_metadata_views','002_foundation_rules','003_measurements_work','004_governed_work_actions','005_scoring_working_time','006_slack_intake']:
            m=json.loads((DIRECTORY/(name+'.manifest.json')).read_text());s=(DIRECTORY/(name+'.sql')).read_text()
            if hashlib.sha256(s.encode()).hexdigest()!=m['sha256']:raise RecoveryError('Candidate pin differs')
            packages.append((m,s))
        report['packages']=[m['sha256'] for m,_ in packages]
        target=RestoreSandbox(image=IMAGE,network_extension=True,private_diagnostics=OUT/'private-error')
        with target:
            if target.image_id!=PINNED_IMAGE:raise RecoveryError('Image pin differs')
            prepare_archive_roles(target,json.loads((ROOT/'source-inventory.json').read_text()))
            report['state']='restoring_offline_archive';write_private(OUT/'report.json',report);print(json.dumps({'stage':report['state']}),flush=True)
            archive=target.restore_native_archive(ROOT/'database.dump')
            if any(m['baselineArchive']!=archive for m,_ in packages):raise RecoveryError('Archive pin differs')
            report['containmentBefore']=target.verify_boundary();before=restored_fingerprints(target)
            inventory_sql=Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
            for m,s in packages[:5]:target.query(prefix(m)+s)
            prior_catalog=json.loads(target.query(inventory_sql))
            m,s=packages[5]
            report['state']='rehearsing_slack_intake';write_private(OUT/'report.json',report);print(json.dumps({'stage':report['state']}),flush=True)
            cases=[('wrong_target','Reviewed production Slack target and checksum required',prefix(m).replace('tgbnakbxwcqjeimygroz','saatxzwxvdvqevbnskxy')+s),
                ('catalog_drift','Production Slack table baseline differs',prefix(m)+s.replace('begin;\n','begin;\nalter table public.platform_jobs add column rehearsal_drift text;\n',1)),
                ('late_failure','division by zero',prefix(m)+s.replace('\ncommit;\n','\nselect 1/0;\ncommit;\n'))]
            report['negativeChecks']=[]
            for name,message,query in cases:
                try:target.query(query)
                except RecoveryError:
                    log=Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                    if message not in log:raise RecoveryError('Unexpected failure reason: '+name)
                    if json.loads(target.query(inventory_sql))!=prior_catalog:raise RecoveryError('Failed migration did not roll back')
                    report['negativeChecks'].append(name)
                else:raise RecoveryError('Negative case passed')
            target.query(prefix(m)+s)
            after_catalog=json.loads(target.query(inventory_sql));actual={t['name']:t for t in after_catalog['tables']}
            for original in prior_catalog['tables']:
                observed=actual[original['name']];name=original['name']
                old_columns={c['name']:c for c in original['columns']};new_columns={c['name']:c for c in observed['columns']}
                if any(new_columns.get(n)!=c for n,c in old_columns.items()):raise RecoveryError('Original column definition changed')
                if set(new_columns)!=set(old_columns):raise RecoveryError('Unexpected added columns')
                for facet in ['constraints','indexes','triggers','policies']:
                    if any(v not in observed[facet] for v in original[facet]):raise RecoveryError('Existing catalog object replaced')
                    added=[v for v in observed[facet] if v not in original[facet]]
                    expected_triggers=m['newExistingTriggers'].get(name,[])
                    if facet=='triggers':
                        if sorted(v['name'] for v in added)!=sorted(expected_triggers):raise RecoveryError('Unexpected trigger changes')
                    elif facet=='constraints':
                        if sorted(v['name'] for v in added)!=sorted(m['newExistingConstraints'].get(name,[])) or any(v['kind']!='f' for v in added):raise RecoveryError('Unexpected receipt constraint additions: '+name)
                    elif added:raise RecoveryError('Unexpected catalog additions: '+name+'/'+facet)
                if any(original[k]!=observed[k] for k in ['owner','rls','forceRls']):raise RecoveryError('Table authority changed')
                if original['acl']!=observed['acl']:raise RecoveryError('Existing table grants changed')
            if set(actual)-{t['name'] for t in prior_catalog['tables']}!=set(m['newTables']):raise RecoveryError('Unexpected new tables')
            for f in prior_catalog['functions']:
                if f['name'] not in m['changedFunctions'] and f not in after_catalog['functions']:raise RecoveryError('Existing function changed')
                if f['name'] in m['changedFunctions']:
                    actual_fn=next(x for x in after_catalog['functions'] if x['name']==f['name'] and x['arguments']==f['arguments'])
                    if {k:v for k,v in f.items() if k!='hash'}!={k:v for k,v in actual_fn.items() if k!='hash'}:raise RecoveryError('Changed helper authority differs')
            if {f['name'] for f in after_catalog['functions'] if f not in prior_catalog['functions']}!=set(m['newFunctions']+m['changedFunctions']):raise RecoveryError('Unexpected function additions')
            if prior_catalog['views']!=after_catalog['views']:raise RecoveryError('Existing views changed')
            target.query("""do $$ begin
 assert not exists(select 1 from public.metric_definitions where measurement_scope<>'tenant');
 assert not exists(select 1 from public.measurements where subject_kind<>'tenant' or subject_id is not null or policy_id is not null);
 assert not exists(select 1 from public.object_state_history where work_before is not null or work_after is not null or transition_verb is not null or capture_kind is not null or capture_sequence is not null);
 assert not has_table_privilege('authenticated','public.object_state_history','INSERT,UPDATE,DELETE,TRUNCATE');
 assert not has_table_privilege('anon','public.object_state_history','INSERT,UPDATE,DELETE,TRUNCATE');
 assert not has_table_privilege('service_role','public.object_state_history','TRUNCATE');
 end $$;""")
            report['legacyColumnsAndCatalogPreserved']=True;report['noInventedHistoricalEvidence']=True
            access_probes=['learn-slack-recurring-hosted','learn-slack-auto-threads-hosted']
            report['accessProbes']=[]
            for name in access_probes:
                path=Path('scripts/verify')/(name+'.assert.sql');sql=path.read_text()
                target.query(sql)
                report['accessProbes'].append({'path':str(path),'sha256':hashlib.sha256(sql.encode()).hexdigest()})
            after=restored_fingerprints(target)
            original_tables={(x['schema'],x['table']):x for x in before['tables']}
            extras=[x for x in after['tables'] if (x['schema'],x['table']) not in original_tables]
            expected={('of_learn_deploy','migrations',6)}|{('public',n,0) for n in ['learn_member_history','learn_scorecard_publications','learn_performance_reviews','learn_work_measurement_runs',*packages[4][0]['newTables'],*m['newTables']]}
            if {(x['schema'],x['table'],x['rows']) for x in extras}!=expected:raise RecoveryError('Unexpected retained synthetic data')
            after['tables']=[x for x in after['tables'] if (x['schema'],x['table']) in original_tables]
            for i,row in enumerate(after['tables']):
                if row['schema']=='public' and row['table'] in packages[2][0]['extendedTables']:
                    after['tables'][i]=project_original_columns(target,original_tables[(row['schema'],row['table'])])
            original_sequences={x['name'] for x in before['sequences']}
            if {x['name'] for x in after['sequences']}-original_sequences!={'public.learn_member_history_sequence_seq','public.learn_work_capture_sequence'}:raise RecoveryError('Unexpected sequence additions')
            after['sequences']=[x for x in after['sequences'] if x['name'] in original_sequences]
            report['sourcePreservation']=compare_native_data(before,after)
            report['sourcePreservation']['scope']='Every original archived column/row and sequence; added columns verified separately without invented historical evidence.'
            try:target.query(prefix(m)+s)
            except RecoveryError:
                log=Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                if 'Production Slack candidate already exists; inspect before retry' not in log or json.loads(target.query(inventory_sql))!=after_catalog:raise RecoveryError('Duplicate rejection differs')
                report['duplicateRejected']=True
            else:raise RecoveryError('Duplicate accepted')
            report['journeys']=verify_journeys(target)
            report['containmentAfter']=target.verify_boundary()
        report['containerRemoved']=target.cleaned;report['elapsedSeconds']=round(time.monotonic()-started,2)
        report['state']='production_slack_intake_rehearsed_offline'
        write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
    except Exception as error:
        report['failure']=str(error) if isinstance(error,RecoveryError) else 'Rehearsal failed; private diagnostics retained'
        report['containerRemoved']=bool(target and target.cleaned);write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
        raise SystemExit(1) from None


if __name__=='__main__':run()
