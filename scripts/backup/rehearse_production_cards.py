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

OUT=Path('.verification-results/production-cards-rehearsal-v3')
DIRECTORY=Path('supabase/release/learn-production')


def verify_journeys(target):
    results=[]
    paths=['learn-identity-delivery.assert.sql','learn-production-interaction-projection.assert.sql','learn-production-projection-review.assert.sql','learn-identity-review.assert.sql','learn-processing-queue.assert.sql','learn-production-email-draft.assert.sql','learn-production-card-draft.assert.sql','learn-production-card-readers.assert.sql','learn-production-card-search.assert.sql','learn-card-search-hosted.assert.sql','learn-production-input-to-card.assert.sql']
    for index,name in enumerate(paths):
        clone='learn_cards_journey_'+str(index)
        target.query('create database '+clone+' template postgres;')
        target.query('alter role supabase_admin in database '+clone+' set search_path=public,pg_catalog;')
        args=target._psql();args[args.index('-d')+1]=clone
        path=Path('scripts/verify')/name
        body=path.read_text()
        sql='begin;set local search_path=public,pg_catalog;set local plpgsql.check_asserts=on;\n'+body+'\nreset role;rollback;'
        result=subprocess.run([target.docker,*args],input=sql.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
        if result.returncode:
            write_private(OUT/(name+'-error.json'),{'error':result.stderr.decode()})
            raise RecoveryError('Cards journey failed: '+name)
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
        for name in ['001_launch_metadata_views','002_foundation_rules','003_measurements_work','004_governed_work_actions','005_scoring_working_time','006_slack_intake','007_capture_controls','008_governed_imports','009_commusoft_api','010_email_capture','011_phone_capture','012_communication_cards']:
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
            profile_ids=json.loads(target.query("select coalesce(jsonb_agg(id),'[]') from public.import_profiles;"))
            inventory_sql=Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
            for m,s in packages[:11]:target.query(prefix(m)+s)
            prior_catalog=json.loads(target.query(inventory_sql))
            m,s=packages[11]
            report['state']='rehearsing_communication_cards';write_private(OUT/'report.json',report);print(json.dumps({'stage':report['state']}),flush=True)
            cases=[('wrong_target','Reviewed production Cards target and checksum required',prefix(m).replace('tgbnakbxwcqjeimygroz','saatxzwxvdvqevbnskxy')+s),
                ('catalog_drift','Production Cards table baseline differs',prefix(m)+s.replace('begin;\n','begin;\nalter table public.customer_cards add column rehearsal_drift text;\n',1)),
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
                if set(new_columns)-set(old_columns)!=set(m['extendedTables'].get(name,[])):raise RecoveryError('Unexpected added columns')
                for facet in ['constraints','indexes','triggers','policies']:
                    if any(v not in observed[facet] for v in original[facet]):raise RecoveryError('Existing catalog object replaced')
                    added=[v for v in observed[facet] if v not in original[facet]]
                    expected_triggers=m['newExistingTriggers'].get(name,[])
                    if facet=='triggers':
                        if sorted(v['name'] for v in added)!=sorted(expected_triggers):raise RecoveryError('Unexpected trigger changes')
                    elif facet=='constraints':
                        if sorted(v['name'] for v in added)!=sorted(m['newExistingConstraints'].get(name,[])):raise RecoveryError('Unexpected receipt constraint additions: '+name)
                    elif facet=='indexes':
                        if sorted(v['name'] for v in added)!=sorted(m.get('newExistingIndexes',{}).get(name,[])):raise RecoveryError('Unexpected index additions: '+name)
                    elif facet=='policies':
                        if sorted(v['name'] for v in added)!=sorted(m['newExistingPolicies'].get(name,[])) or any(v['roles']!=[m['newRole']] for v in added):raise RecoveryError('Unexpected policy changes')
                if any(original[k]!=observed[k] for k in ['owner','rls','forceRls']):raise RecoveryError('Table authority changed')
                if original['acl']!=[g for g in observed['acl'] if g['role']!=m['newRole']]:raise RecoveryError('Existing table grants changed')
            if set(actual)-{t['name'] for t in prior_catalog['tables']}!=set(m['newTables']):raise RecoveryError('Unexpected new tables')
            for f in prior_catalog['functions']:
                if f['name'] not in m['changedFunctions'] and f not in after_catalog['functions']:raise RecoveryError('Existing function changed')
                if f['name'] in m['changedFunctions']:
                    actual_fn=next(x for x in after_catalog['functions'] if x['name']==f['name'] and x['arguments']==f['arguments'])
                    if {k:v for k,v in f.items() if k!='hash'}!={k:v for k,v in actual_fn.items() if k!='hash'}:raise RecoveryError('Changed helper authority differs')
            if {f['name'] for f in after_catalog['functions'] if f not in prior_catalog['functions']}!=set(m['newFunctions']+m['changedFunctions']):raise RecoveryError('Unexpected function additions')
            for v in prior_catalog['views']:
                actual_view=next(x for x in after_catalog['views'] if x['name']==v['name'])
                if v['name'] in m['changedViews']:
                    if {k:val for k,val in v.items() if k!='hash'}!={k:val for k,val in actual_view.items() if k!='hash'}:raise RecoveryError('View authority changed')
                elif actual_view!=v:raise RecoveryError('Existing view changed')
            if len(after_catalog['views'])!=len(prior_catalog['views']):raise RecoveryError('Unexpected view additions')
            target.query("do $$ begin assert not exists(select 1 from public.phone_transcripts where source_storage_path is not null or source_sha256 is not null or processing_run_id is not null);assert not exists(select 1 from public.phone_ai_insights where source_transcript_sha256 is not null or processing_run_id is not null);end$$;")
            target.query("""do $$ begin
 assert not exists(select 1 from public.metric_definitions where measurement_scope<>'tenant');
 assert not exists(select 1 from public.measurements where subject_kind<>'tenant' or subject_id is not null or policy_id is not null);
 assert not exists(select 1 from public.object_state_history where work_before is not null or work_after is not null or transition_verb is not null or capture_kind is not null or capture_sequence is not null);
 assert not has_table_privilege('authenticated','public.object_state_history','INSERT,UPDATE,DELETE,TRUNCATE');
 assert not has_table_privilege('anon','public.object_state_history','INSERT,UPDATE,DELETE,TRUNCATE');
 assert not has_table_privilege('service_role','public.object_state_history','TRUNCATE');
 end $$;""")
            target.query("do $$ begin assert not exists(select 1 from public.google_workspace_mailboxes where directory_primary_email is not null or directory_identity_conflict);assert not exists(select 1 from pg_auth_members where member='email_ingestion_protocol_owner'::regrole or (roleid='email_ingestion_protocol_owner'::regrole and (member<>'postgres'::regrole or inherit_option or set_option or not admin_option)));assert not has_schema_privilege('email_ingestion_protocol_owner','public','CREATE');assert exists(select 1 from pg_roles where rolname='email_ingestion_protocol_owner' and not rolcanlogin and not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb and not rolinherit);end$$;")
            grant_sql="""select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select n.nspname as schema,c.relname as table,null::text as column,g.privilege_type as privilege,g.is_grantable as grantable
 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl) g
 where g.grantee='email_ingestion_protocol_owner'::regrole and n.nspname='public'
 union all select n.nspname,c.relname,a.attname,g.privilege_type,g.is_grantable
 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(a.attacl) g
 where g.grantee='email_ingestion_protocol_owner'::regrole and n.nspname='public') x;"""
            expected_grants=json.loads(Path('supabase/reference/learn-email-ingestion-test-2026-10-10.json').read_text())['protocolGrants']
            normalized=lambda rows: sorted(json.dumps(r,sort_keys=True) for r in rows)
            if normalized(json.loads(target.query(grant_sql)))!=normalized(expected_grants):raise RecoveryError('Protocol grants differ from restricted reference')
            report['protocolRoleGrantsExact']=True
            target.query("do $$ begin assert exists(select 1 from pg_roles where rolname='learn_card_communication_reader' and not rolcanlogin and not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb and not rolinherit);assert not has_schema_privilege('learn_card_communication_reader','public','CREATE');assert not exists(select 1 from pg_auth_members where member='learn_card_communication_reader'::regrole or (roleid='learn_card_communication_reader'::regrole and (member<>'postgres'::regrole or inherit_option or set_option or not admin_option)));assert not has_column_privilege('learn_card_communication_reader','public.email_messages','body_text','SELECT');assert not has_column_privilege('learn_card_communication_reader','public.interactions','metadata','SELECT');assert not has_table_privilege('learn_card_communication_reader','public.email_oauth_tokens','SELECT');end$$;")
            report['privateReaderNoLoginNoApplicationMembership']=True
            report['legacyColumnsAndCatalogPreserved']=True;report['noInventedHistoricalEvidence']=True
            access_probes=[]
            report['accessProbes']=[]
            for name in access_probes:
                path=Path('scripts/verify')/name;sql=path.read_text()
                target.query(sql)
                report['accessProbes'].append({'path':str(path),'sha256':hashlib.sha256(sql.encode()).hexdigest()})
            after=restored_fingerprints(target)
            original_tables={(x['schema'],x['table']):x for x in before['tables']}
            extras=[x for x in after['tables'] if (x['schema'],x['table']) not in original_tables]
            expected={('of_learn_deploy','migrations',12)}|{('public',n,0) for n in ['learn_member_history','learn_scorecard_publications','learn_performance_reviews','learn_work_measurement_runs',*packages[4][0]['newTables'],*packages[5][0]['newTables'],*packages[6][0]['newTables'],*packages[7][0]['newTables'],*packages[8][0]['newTables'],*packages[9][0]['newTables'],*packages[10][0]['newTables'],*m['newTables']]}
            if {(x['schema'],x['table'],x['rows']) for x in extras}!=expected:raise RecoveryError('Unexpected retained synthetic data')
            after['tables']=[x for x in after['tables'] if (x['schema'],x['table']) in original_tables]
            for i,row in enumerate(after['tables']):
                if row['schema']=='public' and row['table'] in set(packages[2][0]['extendedTables'])|set(packages[9][0]['extendedTables'])|set(packages[10][0]['extendedTables'])|set(m['extendedTables']):
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
                if 'Production Cards candidate already exists; inspect before retry' not in log or json.loads(target.query(inventory_sql))!=after_catalog:raise RecoveryError('Duplicate rejection differs')
                report['duplicateRejected']=True
            else:raise RecoveryError('Duplicate accepted')
            report['journeys']=verify_journeys(target)
            report['containmentAfter']=target.verify_boundary()
        report['containerRemoved']=target.cleaned;report['elapsedSeconds']=round(time.monotonic()-started,2)
        report['state']='production_communication_cards_rehearsed_offline'
        write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
    except Exception as error:
        report['failure']=str(error) if isinstance(error,RecoveryError) else 'Rehearsal failed; private diagnostics retained'
        report['containerRemoved']=bool(target and target.cleaned);write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
        raise SystemExit(1) from None


if __name__=='__main__':run()
