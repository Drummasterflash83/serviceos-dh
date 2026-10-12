"""Offline combined release rehearsal; no hosted connections or provider calls."""
import hashlib
import io
import json
import re
import time
from pathlib import Path
from database_restore_sandbox import RecoveryError, RestoreSandbox
from restore_production_database import ROOT, IMAGE, PINNED_IMAGE, write_private, ident
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_production_rules import prefix
from native_copy_fingerprints import restored_fingerprints, compare_native_data, copy_fingerprints

OUT=Path('.verification-results/production-measurements-rehearsal-v3')
DIRECTORY=Path('supabase/release/learn-production')


def project_original_columns(target, original):
    """Compare original COPY bytes when an additive migration extends a table."""
    name=ident(original['schema'])+'.'+ident(original['table'])
    cols=', '.join(map(ident,original['columns']))
    rows=target._run(target._psql(),data=("set timezone='UTC';set datestyle='ISO, MDY';set extra_float_digits=3;set bytea_output='hex';COPY "+name+' ('+cols+') TO STDOUT;').encode())
    stream=('COPY '+name+' ('+cols+') FROM stdin;\n').encode()+rows+b'\\.\n'
    return copy_fingerprints(io.BytesIO(stream))['tables'][0]


def build_probe():
    paths=['scripts/verify/learn-measurements-release.assert.sql','scripts/verify/learn-work-release.assert.sql']
    a,b=[Path(p).read_text() for p in paths]
    adjusted=[]
    for source in [a,b]:
        source,count=re.subn(r'insert into profiles\(id,tenant_id,role\) values([\s\S]*?);',
            r'insert into profiles(id,tenant_id,role) values\1 on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;',source)
        if count!=1:raise RecoveryError('Profile fixture adaptation differs')
        adjusted.append(source)
    a,b=adjusted
    # Production already has company-wide measurements visible to authorised
    # OpenFolk operators. The new restriction concerns staff performance facts.
    if a.count('assert (select count(*)=0 from measurements);')!=1:
        raise RecoveryError('Performance read assertion adaptation differs')
    a=a.replace('assert (select count(*)=0 from measurements);',
        "assert (select count(*)=0 from measurements where subject_kind<>'tenant'), 'Unauthorized performance facts visible';")
    # The original projected-schema tests had exactly one email and an earlier
    # tiny fixture. Full archived source preservation is checked independently.
    a='\n'.join(line for line in a.splitlines() if 'verify.email_before' not in line)
    a=a[:a.index('-- Existing membership has no historical evidence;')]
    b=b[b.index('insert into tenants'):]
    b='\n'.join(line for line in b.splitlines() if 'verify.email_before' not in line)
    start=b.index('-- Actual pre-capture items remain uncovered;')
    end=b.index('-- An unresolved reference',start)
    b=b[:start]+b[end:]
    return """begin;set local search_path=public,pg_catalog;
create schema verify;
create function verify.id(n int) returns uuid language sql immutable as $$
 select ('f0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
grant usage on schema verify to authenticated,service_role;
grant execute on function verify.id(int) to authenticated,service_role;
"""+a+'\n'+b+'\nrollback;',paths


def run():
    OUT.mkdir(mode=0o700,exist_ok=False)
    report={'state':'preflight','productionChanged':False,'hostedTestChanged':False,'providerRequests':0,
        'fullReleaseAccepted':False,'signedInAcceptance':False}
    target=None;started=time.monotonic()
    try:
        packages=[]
        for name in ['001_launch_metadata_views','002_foundation_rules','003_measurements_work']:
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
            for m,s in packages[:2]:target.query(prefix(m)+s)
            prior_catalog=json.loads(target.query(inventory_sql))
            m,s=packages[2]
            report['state']='rehearsing_measurements_and_work';write_private(OUT/'report.json',report);print(json.dumps({'stage':report['state']}),flush=True)
            cases=[('wrong_target','Reviewed production measurement target and checksum required',prefix(m).replace('tgbnakbxwcqjeimygroz','saatxzwxvdvqevbnskxy')+s),
                ('catalog_drift','Production measurement baseline catalog differs',prefix(m)+s.replace('begin;\n','begin;\nalter table public.measurements add column rehearsal_drift text;\n',1)),
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
                if any(original[k]!=observed[k] for k in ['owner','rls','forceRls']):raise RecoveryError('Table authority changed')
                if name!='object_state_history' and original['acl']!=observed['acl']:raise RecoveryError('Existing table grants changed')
            if set(actual)-{t['name'] for t in prior_catalog['tables']}!=set(m['newTables']):raise RecoveryError('Unexpected new tables')
            for f in prior_catalog['functions']:
                if f not in after_catalog['functions']:raise RecoveryError('Existing function changed')
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
            probe,paths=build_probe();report['probeSources']=[{'path':p,'sha256':hashlib.sha256(Path(p).read_bytes()).hexdigest()} for p in paths]
            report['generatedProbeSha256']=hashlib.sha256(probe.encode()).hexdigest()
            target.query(probe);report['measurementAndWorkJourneysVerified']=True
            after=restored_fingerprints(target)
            original_tables={(x['schema'],x['table']):x for x in before['tables']}
            extras=[x for x in after['tables'] if (x['schema'],x['table']) not in original_tables]
            expected={('of_learn_deploy','migrations',3)}|{('public',n,0) for n in ['learn_member_history','learn_scorecard_publications',*m['newTables']]}
            if {(x['schema'],x['table'],x['rows']) for x in extras}!=expected:raise RecoveryError('Unexpected retained synthetic data')
            after['tables']=[x for x in after['tables'] if (x['schema'],x['table']) in original_tables]
            for i,row in enumerate(after['tables']):
                if row['schema']=='public' and row['table'] in m['extendedTables']:
                    after['tables'][i]=project_original_columns(target,original_tables[(row['schema'],row['table'])])
            original_sequences={x['name'] for x in before['sequences']}
            if {x['name'] for x in after['sequences']}-original_sequences!={'public.learn_member_history_sequence_seq','public.learn_work_capture_sequence'}:raise RecoveryError('Unexpected sequence additions')
            after['sequences']=[x for x in after['sequences'] if x['name'] in original_sequences]
            report['sourcePreservation']=compare_native_data(before,after)
            report['sourcePreservation']['scope']='Every original archived column/row and sequence; added columns verified separately without invented historical evidence.'
            try:target.query(prefix(m)+s)
            except RecoveryError:
                log=Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                if 'Production measurement candidate already exists; inspect before retry' not in log or json.loads(target.query(inventory_sql))!=after_catalog:raise RecoveryError('Duplicate rejection differs')
                report['duplicateRejected']=True
            else:raise RecoveryError('Duplicate accepted')
            report['containmentAfter']=target.verify_boundary()
        report['containerRemoved']=target.cleaned;report['elapsedSeconds']=round(time.monotonic()-started,2)
        report['state']='production_measurement_work_prerequisites_rehearsed_offline'
        write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
    except Exception as error:
        report['failure']=str(error) if isinstance(error,RecoveryError) else 'Rehearsal failed; private diagnostics retained'
        report['containerRemoved']=bool(target and target.cleaned);write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
        raise SystemExit(1) from None


if __name__=='__main__':run()
