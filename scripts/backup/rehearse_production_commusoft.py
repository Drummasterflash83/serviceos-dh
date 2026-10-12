"""Offline combined release rehearsal; no hosted connections or provider calls."""
import re
import io
import hashlib
import subprocess
import json
import time
from pathlib import Path
from database_restore_sandbox import RecoveryError, RestoreSandbox
from restore_production_database import ROOT, IMAGE, PINNED_IMAGE, write_private, ident, literal
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_production_rules import prefix
from rehearse_production_measurements import project_original_columns
from native_copy_fingerprints import restored_fingerprints, compare_native_data, copy_fingerprints

OUT=Path('.verification-results/production-commusoft-rehearsal-v4')
DIRECTORY=Path('supabase/release/learn-production')


def verify_journeys(target):
    names=['learn-commusoft-setup-projection','learn-commusoft-contact-traversal',
        'learn-commusoft-contact-traversal-hosted','learn-commusoft-mapping-hosted',
        'learn-commusoft-partial-times-hosted','learn-commusoft-contacts-projection',
        'learn-production-commusoft-guard']
    results=[]
    for index,name in enumerate(names):
        clone="learn_commusoft_journey_"+str(index)
        target.query("create database "+clone+" template postgres;")
        target.query("alter role supabase_admin in database "+clone+" set search_path=public,pg_catalog;")
        args=target._psql();args[args.index("-d")+1]=clone
        path=Path('scripts/verify')/(name+'.assert.sql');sql=path.read_text()
        extra=[]
        if name=='learn-commusoft-setup-projection':
            sql,count=re.subn(r'(insert into profiles\b[\s\S]+?);',r'\1 on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role,email=excluded.email;',sql,flags=re.I)
            if count!=1:raise RecoveryError('Setup profile fixture boundary differs')
            old='if exists(select 1 from platform_jobs) or exists(select 1 from feature_flags)'
            if old not in sql:raise RecoveryError('Setup capture assertion boundary differs')
            sql=sql.replace(old,"if exists(select 1 from platform_jobs where tenant_id='99000000-0000-0000-0000-000000000001') or exists(select 1 from feature_flags where tenant_id='99000000-0000-0000-0000-000000000001')")
            sql="insert into tenants(id,slug,display_name) values('99000000-0000-0000-0000-000000000001','commusoft-setup-offline','Synthetic setup company');\n"+sql
        elif name=='learn-commusoft-contact-traversal':
            old="insert into vault.decrypted_secrets values(fixture_id(107),'provider_secret:'||fixture_id(100)||':commusoft:api_key','SYNTHETIC_NO_NETWORK');"
            if sql.count(old)!=1:raise RecoveryError('Stub Vault fixture boundary differs')
            prelude=Path('scripts/verify/learn-production-commusoft.fixture.sql')
            sql=prelude.read_text()+sql.replace(old,'-- Synthetic key is encrypted by the actual Vault extension in the prelude.')
            extra.append({'path':str(prelude),'sha256':hashlib.sha256(prelude.read_bytes()).hexdigest()})
            extension=Path('scripts/verify/learn-production-commusoft-card.assert.sql')
            old_properties='[{"id":101,"type":"customer"},{"id":202,"type":"customer"},{"id":303,"type":"workaddress","parentPropertyID":101}]'
            new_properties='[{"id":101,"type":"customer","contact":{"firstName":"Synthetic","lastName":"Customer"}},{"id":202,"type":"customer"},{"id":303,"type":"workaddress","parentPropertyID":101,"addressLine1":"Synthetic site"}]'
            if sql.count(old_properties)!=1:raise RecoveryError('Synthetic property fixture boundary differs')
            sql=sql.replace(old_properties,new_properties)+'\n'+extension.read_text()
            extra.append({'path':str(extension),'sha256':hashlib.sha256(extension.read_bytes()).hexdigest()})
        elif name=='learn-commusoft-contacts-projection':
            sql,count=re.subn(r'(insert into profiles\b[\s\S]+?);',r'\1 on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;',sql,flags=re.I)
            if count!=1:raise RecoveryError('Contact profile fixture boundary differs')
        # Traversal models separate worker transactions: production jobs use now()
        # for creation timestamps. One enclosing transaction collapses their ordering.
        if name=='learn-commusoft-contact-traversal':
            sql='set search_path=public,pg_catalog;\n'+sql
        else:
            sql='begin;set local search_path=public,pg_catalog;\n'+sql+'\nreset role;rollback;'
        result=subprocess.run([target.docker,*args],input=sql.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
        if result.returncode:
            write_private(OUT/(name+'-error.json'),{'error':result.stderr.decode()})
            raise RecoveryError('Commusoft journey failed: '+name)
        results.append({'path':str(path),'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'probeSha256':hashlib.sha256(sql.encode()).hexdigest(),'additionalSources':extra})
        print(json.dumps({'journeyPassed':name}),flush=True)
    return results


def run():
    OUT.mkdir(mode=0o700,exist_ok=False)
    report={'state':'preflight','productionChanged':False,'hostedTestChanged':False,'providerRequests':0,
        'fullReleaseAccepted':False,'signedInAcceptance':False}
    target=None;started=time.monotonic()
    try:
        packages=[]
        for name in ['001_launch_metadata_views','002_foundation_rules','003_measurements_work','004_governed_work_actions','005_scoring_working_time','006_slack_intake','007_capture_controls','008_governed_imports','009_commusoft_api']:
            m=json.loads((DIRECTORY/(name+'.manifest.json')).read_text());s=(DIRECTORY/(name+'.sql')).read_text()
            if hashlib.sha256(s.encode()).hexdigest()!=m['sha256']:raise RecoveryError('Candidate pin differs')
            packages.append((m,s))
        report['packages']=[m['sha256'] for m,_ in packages]
        target=RestoreSandbox(image=IMAGE,network_extension=True,synthetic_vault=True,private_diagnostics=OUT/'private-error')
        with target:
            if target.image_id!=PINNED_IMAGE:raise RecoveryError('Image pin differs')
            prepare_archive_roles(target,json.loads((ROOT/'source-inventory.json').read_text()))
            report['state']='restoring_offline_archive';write_private(OUT/'report.json',report);print(json.dumps({'stage':report['state']}),flush=True)
            archive=target.restore_native_archive(ROOT/'database.dump')
            if any(m['baselineArchive']!=archive for m,_ in packages):raise RecoveryError('Archive pin differs')
            report['containmentBefore']=target.verify_boundary();before=restored_fingerprints(target)
            profile_ids=json.loads(target.query("select coalesce(jsonb_agg(id),'[]') from public.import_profiles;"))
            inventory_sql=Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
            for m,s in packages[:8]:target.query(prefix(m)+s)
            prior_catalog=json.loads(target.query(inventory_sql))
            m,s=packages[8]
            report['state']='rehearsing_commusoft_api';write_private(OUT/'report.json',report);print(json.dumps({'stage':report['state']}),flush=True)
            cases=[('wrong_target','Reviewed production Commusoft target and checksum required',prefix(m).replace('tgbnakbxwcqjeimygroz','saatxzwxvdvqevbnskxy')+s),
                ('catalog_drift','Production Commusoft table baseline differs',prefix(m)+s.replace('begin;\n','begin;\nalter table public.customer_cards add column rehearsal_drift text;\n',1)),
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
                    elif facet=='indexes':
                        if sorted(v['name'] for v in added)!=sorted(m.get('newExistingIndexes',{}).get(name,[])):raise RecoveryError('Unexpected index additions: '+name)
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
            access_probes=[]
            report['accessProbes']=[]
            for name in access_probes:
                path=Path('scripts/verify')/(name+'.assert.sql');sql=path.read_text()
                target.query(sql)
                report['accessProbes'].append({'path':str(path),'sha256':hashlib.sha256(sql.encode()).hexdigest()})
            after=restored_fingerprints(target)
            original_tables={(x['schema'],x['table']):x for x in before['tables']}
            extras=[x for x in after['tables'] if (x['schema'],x['table']) not in original_tables]
            expected={('of_learn_deploy','migrations',9)}|{('public',n,0) for n in ['learn_member_history','learn_scorecard_publications','learn_performance_reviews','learn_work_measurement_runs',*packages[4][0]['newTables'],*packages[5][0]['newTables'],*packages[6][0]['newTables'],*packages[7][0]['newTables'],*m['newTables']]}
            if {(x['schema'],x['table'],x['rows']) for x in extras}!=expected:raise RecoveryError('Unexpected retained synthetic data')
            after['tables']=[x for x in after['tables'] if (x['schema'],x['table']) in original_tables]
            for i,row in enumerate(after['tables']):
                if row['schema']=='public' and row['table'] in packages[2][0]['extendedTables']:
                    after['tables'][i]=project_original_columns(target,original_tables[(row['schema'],row['table'])])
            original_sequences={x['name'] for x in before['sequences']}
            if {x['name'] for x in after['sequences']}-original_sequences!={'public.learn_member_history_sequence_seq','public.learn_work_capture_sequence'}:raise RecoveryError('Unexpected sequence additions')
            after['sequences']=[x for x in after['sequences'] if x['name'] in original_sequences]
            profiles_key=('public','import_profiles')
            original_profile=original_tables[profiles_key]
            name='public.import_profiles';cols=', '.join(map(ident,original_profile['columns']))
            ids='array['+','.join(literal(x) for x in profile_ids)+']::uuid[]'
            query="set timezone='UTC';set datestyle='ISO, MDY';set extra_float_digits=3;set bytea_output='hex';COPY (select "+cols+' from '+name+' where id=any('+ids+')) TO STDOUT;'
            rows=target._run(target._psql(),data=query.encode())
            stream=('COPY '+name+' ('+cols+') FROM stdin;\n').encode()+rows+b'\\.\n'
            original_only=copy_fingerprints(io.BytesIO(stream))['tables'][0]
            for i,row in enumerate(after['tables']):
                if (row['schema'],row['table'])==profiles_key:after['tables'][i]=original_only
            raw=Path('supabase/release/learn-test/022_governed_imports.sql').read_text()
            seed=raw[raw.index('insert into import_profiles ('):];seed=seed[seed.index('values\n'):seed.index('on conflict do nothing;')]
            probe="with expected(tenant_id,source_system,entity_type,name,definition) as ("+seed+") select count(*)=3 and bool_and(p.definition=e.definition and p.active and p.version=1 and p.created_by is null) from public.import_profiles p join expected e on p.tenant_id is null and p.source_system=e.source_system and p.entity_type=e.entity_type and p.name=e.name where not p.id=any("+ids+");"
            if target.query(probe).strip()!='t' or target.query('select count(*)=3 from public.import_profiles where not id=any('+ids+');').strip()!='t':raise RecoveryError('Prepared profile additions differ')
            report['addedImportTemplates']=3
            report['sourcePreservation']=compare_native_data(before,after)
            report['sourcePreservation']['scope']='Every original archived column/row and sequence; added columns verified separately without invented historical evidence.'
            try:target.query(prefix(m)+s)
            except RecoveryError:
                log=Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                if 'Production Commusoft candidate already exists; inspect before retry' not in log or json.loads(target.query(inventory_sql))!=after_catalog:raise RecoveryError('Duplicate rejection differs')
                report['duplicateRejected']=True
            else:raise RecoveryError('Duplicate accepted')
            report['journeys']=verify_journeys(target)
            report['containmentAfter']=target.verify_boundary()
        report['containerRemoved']=target.cleaned;report['elapsedSeconds']=round(time.monotonic()-started,2)
        report['state']='production_commusoft_api_rehearsed_offline'
        write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
    except Exception as error:
        report['failure']=str(error) if isinstance(error,RecoveryError) else 'Rehearsal failed; private diagnostics retained'
        report['containerRemoved']=bool(target and target.cleaned);write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
        raise SystemExit(1) from None


if __name__=='__main__':run()
