"""Exercise the additive TEST foundation against a recorded schema projection.

No live database or existing local database is read. A disposable, network-isolated
Postgres container restores recorded columns/defaults/constraints/indexes/policies
and four helpers. Auth is an ID-only stand-in; email protocol triggers and launch
views are outside the projection. Hosted rollback rehearsal is still required.
"""
import hashlib
import json
import re
import shutil
import sys
import subprocess
import time
import uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
DOCKER=shutil.which('docker') or '/usr/local/bin/docker'
NODE=shutil.which('node') or '/usr/local/bin/node'
IMAGE='public.ecr.aws/supabase/postgres:17.6.1.141'
TARGET='serviceos-foundation-'+uuid.uuid4().hex[:8]
DB='foundation_verify'

def docker(*args, **kwargs):
    return subprocess.run([DOCKER,*args],capture_output=True,check=True,**kwargs)
def run(sql, check=True):
    r=subprocess.run([DOCKER,'exec','-i','-e','PGOPTIONS=-c search_path=public,pg_catalog',TARGET,'psql','-h','127.0.0.1','-U','supabase_admin','-d',DB,'-At','-v','ON_ERROR_STOP=1','-f','-'],input=sql.encode(),capture_output=True)
    if check and r.returncode:
        print('\n'.join(x for x in r.stderr.decode().splitlines() if any(k in x.upper() for k in ['ERROR','FATAL','HINT:','CONTEXT:']))[-1600:])
        raise RuntimeError('Synthetic foundation SQL failed')
    return r
def apply(sql,label):
    run(sql);print(label+': PASS',flush=True)
def ident(s):return '"'+s.replace('"','""')+'"'
def lit(s):return "'"+s.replace("'","''")+"'"
def node(code):return subprocess.run([NODE,'--input-type=module','-e',code],cwd=ROOT,capture_output=True,check=True).stdout.decode()
def snapshot():
    c=json.loads(run(catalog_sql).stdout)
    return {'tables':[t for t in c['tables'] if t['name'] in names], 'helpers':c['helpers']}

bundle=json.loads(node("import {checkedFoundation} from './scripts/verify/learn-foundation-bundle.mjs';process.stdout.write(JSON.stringify(checkedFoundation()));"))
manifest=bundle['manifest']
assert hashlib.sha256(bundle['sql'].encode()).hexdigest()==manifest['sha256']
release="set role postgres;set serviceos.release_target='saatxzwxvdvqevbnskxy';set serviceos.release_source_sha256="+lit(manifest['sha256'])+";\n"+bundle['sql']
catalog_sql=node("import {FOUNDATION_CATALOG_QUERY} from './scripts/verify/learn-foundation-catalog.mjs';process.stdout.write(FOUNDATION_CATALOG_QUERY);")
catalog=json.loads((ROOT/'docs/operations/evidence/learn-test-foundation-schema-2026-10-09.json').read_text())
names=[t['name'] for t in catalog['tables']]
assert len(names)==26 and all(t['owner']=='postgres' for t in catalog['tables'])
try:
    docker('run','-d','--pull=never','--network','none','--name',TARGET,'-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE)
    for _ in range(100):
        try:
            docker('exec',TARGET,'psql','-h','127.0.0.1','-U','supabase_admin','-d','postgres','-Atc','select 1');break
        except subprocess.CalledProcessError:time.sleep(.25)
    else:raise RuntimeError('Disposable database did not start')
    docker('exec',TARGET,'createdb','-U','supabase_admin','-T','template0',DB)
    existing=set(run('select rolname from pg_roles').stdout.decode().splitlines())
    roles={'authenticated','anon','service_role','learn_launch_metadata_reader','email_ingestion_protocol_owner'}
    roles.update(r for t in catalog['tables'] for p in t['policies'] for r in p['roles'] if r!='public')
    sql=['create schema auth;create table auth.users(id uuid primary key);',
         "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;"]
    sql += ['create role '+ident(r)+' nologin;' for r in roles-existing]
    sql += ['alter role service_role bypassrls;', 'alter role postgres nologin nosuperuser createrole bypassrls;',
      'grant usage,create on schema public to postgres with grant option;',
      'grant usage on schema public,auth to postgres,authenticated,anon,service_role;',
      'grant references on auth.users to postgres;']
    for t in catalog['tables']:
        cols=','.join(ident(c['name'])+' '+c['type']+(' default '+c['default'] if c['default'] else '')+(' not null' if c['notNull'] else '') for c in t['columns'])
        sql += ['create table public.'+ident(t['name'])+'('+cols+');','alter table public.'+ident(t['name'])+' owner to postgres;']
    # Unique indexes may support foreign keys even when not constraint-backed.
    for t in catalog['tables']:
        for k in t['constraints']:
            if k['kind']!='f':sql.append('alter table public.'+ident(t['name'])+' add constraint '+ident(k['name'])+' '+k['definition']+';')
        backing={k['name'] for k in t['constraints'] if k['kind'] in ['p','u','x']}
        sql += [i['definition']+';' for i in t['indexes'] if i['name'] not in backing]
    for t in catalog['tables']:
        sql += ['alter table public.'+ident(t['name'])+' add constraint '+ident(k['name'])+' '+k['definition']+';' for k in t['constraints'] if k['kind']=='f']
    for f in catalog['helpers']:
        sql += [f['definition']+';', 'alter function public.'+ident(f['name'])+'() owner to postgres;']
    for f in catalog['helpers']:
        sql.append('revoke all on function public.'+ident(f['name'])+'() from public,anon,authenticated;')
    for t in catalog['tables']:
        if t['rls']:sql.append('alter table public.'+ident(t['name'])+' enable row level security;')
        if t['forceRls']:sql.append('alter table public.'+ident(t['name'])+' force row level security;')
        if t['authenticatedSelect']:sql.append('grant select on public.'+ident(t['name'])+' to authenticated;')
        for p in t['policies']:
            sql.append('create policy '+ident(p['name'])+' on public.'+ident(t['name'])+' as '+p['permissive']+' for '+p['command']+' to '+','.join(ident(r) for r in p['roles'])+(' using('+p['using']+')' if p['using'] else '')+(' with check('+p['check']+')' if p['check'] else '')+';')
        sql += [tgr['definition']+';' for tgr in t['triggers'] if tgr['function']=='set_updated_at']
    sql += ['create schema of_test_deploy authorization postgres;', 'create table of_test_deploy.migrations(source_sha256 text,migration_name text primary key,project_ref text,applied_at timestamptz);alter table of_test_deploy.migrations owner to postgres;']
    sql += ['insert into of_test_deploy.migrations values('+','.join(lit(e[k]) for k in ['source_sha256','migration_name','project_ref','applied_at'])+');' for e in catalog['readiness']['customMigrationEntries']]
    apply('\n'.join(sql),'Recorded schema projection under non-superuser release owner')
    apply((ROOT/'scripts/verify/learn-foundation-release.seed.sql').read_text(),'Synthetic pre-existing companies, logins and retained email')
    before=snapshot()
    apply("alter table of_test_deploy.migrations add constraint receipt_failure check(migration_name<>'learn_card_work_foundations_v1');",'Injected receipt failure')
    failed=run(release,False)
    assert failed.returncode and b'receipt_failure' in failed.stderr, failed.stderr.decode()[-800:]
    assert snapshot()==before
    absent="select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ("+','.join(lit(n) for n in manifest['tables'])+")"
    assert run(absent).stdout.strip()==b'0'
    assert run("select to_regprocedure('public.learn_foundation_reference_guard()') is null").stdout.strip()==b't'
    apply('alter table of_test_deploy.migrations drop constraint receipt_failure;','Atomic rollback leaves no foundation tables or guard')
    rehearsal=node("import {foundationRehearsalSql} from './scripts/verify/learn-test-foundation-rehearsal.mjs';process.stdout.write(foundationRehearsalSql());")
    apply('set role postgres;'+rehearsal,'Exact hosted rehearsal executes and rolls back')
    assert snapshot()==before and run(absent).stdout.strip()==b'0'
    refused=run('set role postgres;'+bundle['sql'],False)
    assert refused.returncode and b'Explicit TEST target' in refused.stderr
    print('Unscoped release refused: PASS',flush=True)
    apply(release,'Generated 33-table foundation release')
    if '--write-expected' in sys.argv:
        observed=json.loads(run(catalog_sql).stdout)
        expected={'sourceSha256':manifest['sha256'],'tables':[t for t in observed['tables'] if t['name'] in manifest['tables']],'guard':observed['foundationGuard']}
        (ROOT/'supabase/release/learn-test/002_card_work_foundations.expected.json').write_text(json.dumps(expected,indent=2)+'\n')
    assert snapshot()==before, 'Existing source definitions changed'
    print('Existing table/helper definitions preserved: PASS',flush=True)
    helper=(ROOT/'supabase/release/learn-test/003_foundation_helper_access.sql').read_text()
    helper_hash=hashlib.sha256(helper.encode()).hexdigest()
    apply("set role postgres;set serviceos.release_target='saatxzwxvdvqevbnskxy';set serviceos.release_source_sha256="+lit(helper_hash)+';'+helper,'Explicit helper access follow-up release')
    apply((ROOT/'scripts/verify/learn-foundation-release.assert.sql').read_text(),'Tenant isolation, reference integrity and retained communication assertions')
    tables=','.join(lit(t) for t in manifest['tables'])
    apply("do $$ declare t record;begin for t in select c.oid,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ("+tables+") loop assert t.relrowsecurity;assert has_table_privilege('authenticated',t.oid,'SELECT');assert not has_table_privilege('authenticated',t.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');assert not has_table_privilege('anon',t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');assert has_table_privilege('service_role',t.oid,'SELECT') and has_table_privilege('service_role',t.oid,'INSERT') and has_table_privilege('service_role',t.oid,'UPDATE') and has_table_privilege('service_role',t.oid,'DELETE');end loop;assert (select count(*)=33 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ("+tables+"));end $$;",'All 33 tables enforce explicit privileges and RLS')
    duplicate=run(release,False)
    assert duplicate.returncode and b'Foundation receipt exists' in duplicate.stderr
    print('Duplicate installation refused: PASS',flush=True)
    if '--rules' in sys.argv:
        rules=json.loads(node("import {checkedRules} from './scripts/verify/learn-rules-bundle.mjs';process.stdout.write(JSON.stringify(checkedRules()));"))
        rules_sql="set role postgres;set serviceos.release_target='saatxzwxvdvqevbnskxy';set serviceos.release_source_sha256="+lit(rules['manifest']['sha256'])+';'+rules['sql']
        rule_before=json.loads(run(catalog_sql).stdout)
        apply("alter table of_test_deploy.migrations add constraint rules_receipt_failure check(migration_name<>'learn_rules_membership_v1');",'Injected rules receipt failure')
        failed=run(rules_sql,False)
        assert failed.returncode and b'rules_receipt_failure' in failed.stderr,failed.stderr.decode()[-800:]
        rule_after=json.loads(run(catalog_sql).stdout)
        assert rule_after['tables']==rule_before['tables'] and rule_after['helpers']==rule_before['helpers']
        apply('alter table of_test_deploy.migrations drop constraint rules_receipt_failure;','Rules receipt failure restores all prior table definitions and triggers')
        assert run("select not has_function_privilege('authenticated','public.current_user_role()','EXECUTE')").stdout.strip()==b't'
        rehearsal=node("import {rulesRehearsalSql} from './scripts/verify/learn-test-rules-rehearsal.mjs';process.stdout.write(rulesRehearsalSql());")
        apply('set role postgres;'+rehearsal,'Exact rules rehearsal executes and rolls back')
        assert json.loads(run(catalog_sql).stdout)['tables']==rule_before['tables']
        apply(rules_sql,'Rules, publication and membership release as non-superuser')
        if '--write-rules-expected' in sys.argv:
            observed=json.loads(run(catalog_sql).stdout)
            fn_query=node("import {RULES_FUNCTION_QUERY} from './scripts/verify/learn-rules-catalog.mjs';process.stdout.write(RULES_FUNCTION_QUERY);")
            affected=rules['manifest']['tables']+['config_versions','operating_profile_entries','team_members']
            expected={'sourceSha256':rules['manifest']['sha256'],'tables':[t for t in observed['tables'] if t['name'] in affected],'functions':json.loads(run(fn_query).stdout)}
            (ROOT/'supabase/release/learn-test/004_rules_membership.expected.json').write_text(json.dumps(expected,indent=2)+'\n')
        assertions=(ROOT/'scripts/verify/learn-rules-release.assert.sql').read_text()
        if '--conflicts' in sys.argv:
            fn_query=node("import {RULES_FUNCTION_QUERY} from './scripts/verify/learn-rules-catalog.mjs';process.stdout.write(RULES_FUNCTION_QUERY);")
            before_fix=json.loads(run(fn_query).stdout)
            repair=node("import {conflictSql} from './scripts/verify/learn-test-scorecard-conflicts.mjs';process.stdout.write(conflictSql());")
            rollback=node("import {conflictSql} from './scripts/verify/learn-test-scorecard-conflicts.mjs';process.stdout.write(conflictSql({rehearse:true}));")
            apply('set role postgres;'+rollback,'Conflict repair rehearsal rolls back')
            assert json.loads(run(fn_query).stdout)==before_fix
            apply('set role postgres;'+repair,'Conflict repair preserves privileges and changes only four error codes')
            expected=json.loads(json.dumps(before_fix))
            for f in expected:f['definition']=f['definition'].replace("errcode='40001'","errcode='PT409'")
            assert json.loads(run(fn_query).stdout)==expected
            duplicate=run('set role postgres;'+repair,False)
            assert duplicate.returncode and b'Conflict repair receipt already exists' in duplicate.stderr
            assertions=assertions.replace('when serialization_failure',"when sqlstate 'PT409'")
        apply(assertions,'Saved-rule authority, prospective publication and retained membership checks')
        if '--measurements' in sys.argv:
            assert '--conflicts' in sys.argv,'Measurement release requires conflict repair'
            bundle_m=json.loads(node("import {checkedMeasurements} from './scripts/verify/learn-measurements-bundle.mjs';process.stdout.write(JSON.stringify(checkedMeasurements()));"))
            measure_sql="set role postgres;set serviceos.release_target='saatxzwxvdvqevbnskxy';set serviceos.release_source_sha256="+lit(bundle_m['manifest']['sha256'])+';'+bundle_m['sql']
            before_m=json.loads(run(catalog_sql).stdout)
            apply("alter table of_test_deploy.migrations add constraint measurement_receipt_failure check(migration_name<>'learn_measurements_reviews_v1');",'Injected measurement receipt failure')
            failed=run(measure_sql,False)
            assert failed.returncode and b'measurement_receipt_failure' in failed.stderr,failed.stderr.decode()[-800:]
            rolled=json.loads(run(catalog_sql).stdout)
            assert rolled['tables']==before_m['tables'] and rolled['helpers']==before_m['helpers']
            apply('alter table of_test_deploy.migrations drop constraint measurement_receipt_failure;','Atomic measurement rollback preserves existing schema')
            apply(measure_sql,'Objective/measurement/review release as non-superuser')
            after_m=json.loads(run(catalog_sql).stdout)
            assert [t for t in after_m['tables'] if t['name'] not in bundle_m['manifest']['tables']]==before_m['tables']
            assert after_m['helpers']==before_m['helpers'] and after_m['foundationGuard']==before_m['foundationGuard']
            fn_query=node("import {MEASUREMENT_FUNCTION_QUERY} from './scripts/verify/learn-measurements-catalog.mjs';process.stdout.write(MEASUREMENT_FUNCTION_QUERY);")
            if '--write-measurements-expected' in sys.argv:
                expected={'sourceSha256':bundle_m['manifest']['sha256'],'tables':[t for t in after_m['tables'] if t['name'] in bundle_m['manifest']['tables']],'functions':json.loads(run(fn_query).stdout)}
                (ROOT/'supabase/release/learn-test/006_measurements_reviews.expected.json').write_text(json.dumps(expected,indent=2)+'\n')
            apply((ROOT/'scripts/verify/learn-measurements-release.assert.sql').read_text(),'Measurement correction/review, observed group history, tenant boundaries and evidence retention')
            import concurrent.futures
            def review_race(n):
                return run("set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000511';set role authenticated;select learn_performance_review(verify.id(501),verify.id(542),verify.id("+str(n)+"),1,'confirmed','Concurrent synthetic review');",False)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                raced=list(pool.map(review_race,[601,602]))
            assert sum(r.returncode==0 for r in raced)==1,'Exactly one competing review must succeed'
            assert any(b'Review changed; reload' in r.stderr for r in raced),'Competing review must report a revision conflict'
            assert run("select count(*)=2 from learn_performance_reviews where measurement_id=verify.id(542)").stdout.strip()==b't'
            print('Concurrent review retains exactly one next revision: PASS',flush=True)
            if '--work' in sys.argv:
                bundle_w=json.loads(node("import {checkedWork} from './scripts/verify/learn-work-bundle.mjs';process.stdout.write(JSON.stringify(checkedWork()));"))
                work_sql="set role postgres;set serviceos.release_target='saatxzwxvdvqevbnskxy';set serviceos.release_source_sha256="+lit(bundle_w['manifest']['sha256'])+';'+bundle_w['sql']
                before_w=json.loads(run(catalog_sql).stdout)
                original_append=run("select pg_get_functiondef('public.learn_performance_append(uuid,jsonb,text)'::regprocedure)").stdout
                apply("insert into object_state_history(id,tenant_id,object_id,to_state,reason) values(verify.id(691),verify.id(1),verify.id(181),'ready','Retained legacy history');create table verify.old_work_history as select to_jsonb(h) payload from object_state_history h;",'Retained legacy history before capture')
                apply("alter table of_test_deploy.migrations add constraint work_receipt_failure check(migration_name<>'learn_work_capture_collectors_v1');",'Injected work receipt failure')
                failed=run(work_sql,False)
                assert failed.returncode and b'work_receipt_failure' in failed.stderr,failed.stderr.decode()[-800:]
                rolled=json.loads(run(catalog_sql).stdout)
                assert rolled['tables']==before_w['tables']
                assert run("select pg_get_functiondef('public.learn_performance_append(uuid,jsonb,text)'::regprocedure)").stdout==original_append
                apply('alter table of_test_deploy.migrations drop constraint work_receipt_failure;','Atomic work rollback restores writer and all prior table definitions')
                apply(work_sql,'Forward capture and collectors as non-superuser')
                after_w=json.loads(run(catalog_sql).stdout)
                affected=bundle_w['manifest']['affectedTables']
                assert [t for t in after_w['tables'] if t['name'] not in affected]==[t for t in before_w['tables'] if t['name'] not in affected]
                assert after_w['helpers']==before_w['helpers'] and after_w['foundationGuard']==before_w['foundationGuard']
                changed_append=run("select pg_get_functiondef('public.learn_performance_append(uuid,jsonb,text)'::regprocedure)").stdout
                assert changed_append==original_append.replace(b"'jobs','team_members')",b"'jobs','team_members','learn_work_measurement_runs')")
                fn_query=node("import {WORK_FUNCTION_QUERY} from './scripts/verify/learn-work-catalog.mjs';process.stdout.write(WORK_FUNCTION_QUERY);")
                seq_query=node("import {WORK_SEQUENCE_QUERY} from './scripts/verify/learn-work-catalog.mjs';process.stdout.write(WORK_SEQUENCE_QUERY);")
                if '--write-work-expected' in sys.argv:
                    expected={'sourceSha256':bundle_w['manifest']['sha256'],'tables':[t for t in after_w['tables'] if t['name'] in affected],'functions':json.loads(run(fn_query).stdout),'sequences':json.loads(run(seq_query).stdout)}
                    (ROOT/'supabase/release/learn-test/007_work_capture_collectors.expected.json').write_text(json.dumps(expected,indent=2)+'\n')
                apply((ROOT/'scripts/verify/learn-work-release.assert.sql').read_text(),'Forward capture, preserved legacy source, collectors and partial coverage assertions')
                def collection_race(n):
                    return run("set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000711';set role authenticated;select learn_work_handoffs_collect(verify.id(701),verify.id(732),policy_id,1,start_at,end_at,verify.id("+str(n)+"),'Concurrent synthetic collection') from verify.work_period;",False)
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                    raced=list(pool.map(collection_race,[771,772]))
                assert sum(r.returncode==0 for r in raced)==1,'Exactly one competing collection must succeed'
                assert any(b'already exists for this cell' in r.stderr for r in raced),'Competing collection must conflict'
                assert run("select count(*)=1 from measurements where id in (verify.id(771),verify.id(772))").stdout.strip()==b't'
                assert run("select count(*)=1 from learn_work_measurement_runs where id in (verify.id(771),verify.id(772))").stdout.strip()==b't'
                print('Concurrent work collection retains one matching observation and receipt: PASS',flush=True)
                if '--actions' in sys.argv:
                    bundle_a=json.loads(node("import {checkedActions} from './scripts/verify/learn-actions-bundle.mjs';process.stdout.write(JSON.stringify(checkedActions()));"))
                    actions_sql="set role postgres;set serviceos.release_target='saatxzwxvdvqevbnskxy';set serviceos.release_source_sha256="+lit(bundle_a['manifest']['sha256'])+';'+bundle_a['sql']
                    before_a=json.loads(run(catalog_sql).stdout)
                    registry_query=node("import {ACTIONS_REGISTRY_QUERY} from './scripts/verify/learn-actions-catalog.mjs';process.stdout.write(ACTIONS_REGISTRY_QUERY);")
                    registry_before=json.loads(run(registry_query).stdout)
                    apply("create table verify.pre_action_work as select to_jsonb(w) payload from intelligence_objects w;create table verify.pre_action_history as select to_jsonb(h) payload from object_state_history h;",'Retain pre-action work and history snapshots')
                    apply("alter table of_test_deploy.migrations add constraint action_receipt_failure check(migration_name<>'learn_governed_work_actions_v1');",'Injected action receipt failure')
                    failed=run(actions_sql,False)
                    assert failed.returncode and b'action_receipt_failure' in failed.stderr,failed.stderr.decode()[-800:]
                    rolled_a=json.loads(run(catalog_sql).stdout)
                    assert rolled_a['tables']==before_a['tables'] and rolled_a['helpers']==before_a['helpers'] and rolled_a['foundationGuard']==before_a['foundationGuard']
                    assert json.loads(run(registry_query).stdout)==registry_before
                    apply('alter table of_test_deploy.migrations drop constraint action_receipt_failure;','Atomic action rollback preserves catalog and vocabularies')
                    action_rehearsal=node("import {actionsRehearsalSql} from './scripts/verify/learn-test-actions-rehearsal.mjs';process.stdout.write(actionsRehearsalSql());")
                    apply('set role postgres;'+action_rehearsal,'Exact action rehearsal rolls back schema and registries')
                    assert json.loads(run(catalog_sql).stdout)['tables']==before_a['tables']
                    assert json.loads(run(registry_query).stdout)==registry_before
                    apply(actions_sql,'Governed action registry and writer as non-superuser')
                    after_a=json.loads(run(catalog_sql).stdout)
                    affected=bundle_a['manifest']['affectedTables']
                    assert [t for t in after_a['tables'] if t['name'] not in affected]==[t for t in before_a['tables'] if t['name'] not in affected]
                    assert after_a['helpers']==before_a['helpers'] and after_a['foundationGuard']==before_a['foundationGuard']
                    action_query=node("import {ACTIONS_FUNCTION_QUERY} from './scripts/verify/learn-actions-catalog.mjs';process.stdout.write(ACTIONS_FUNCTION_QUERY);")
                    classes_query=node("import {ACTIONS_CLASSES_QUERY} from './scripts/verify/learn-actions-catalog.mjs';process.stdout.write(ACTIONS_CLASSES_QUERY);")
                    expected={'sourceSha256':bundle_a['manifest']['sha256'],'tables':[t for t in after_a['tables'] if t['name'] in affected],'functions':json.loads(run(action_query).stdout),'registries':json.loads(run(registry_query).stdout),'classes':json.loads(run(classes_query).stdout)}
                    expected_path=ROOT/'supabase/release/learn-test/008_governed_work_actions.expected.json'
                    if '--write-actions-expected' in sys.argv:
                        expected_path.write_text(json.dumps(expected,indent=2)+'\n')
                    else:
                        assert expected==json.loads(expected_path.read_text()),'Installed action schema differs from reviewed projection'
                    apply((ROOT/'scripts/verify/learn-actions-release.assert.sql').read_text(),'Action authority, evidence, guarded conditions and atomic capture assertions')
                    duplicate=run(actions_sql,False)
                    assert duplicate.returncode and b'Action release already exists' in duplicate.stderr
                    print('Duplicate action installation refused: PASS',flush=True)
                    def action_race(n):
                        return run("set role service_role;select work_transition_apply(verify.id(801),verify.id(843),1,'in_progress','{}',jsonb_build_object('verb','start','reason','Concurrent synthetic action','actor',jsonb_build_object('user_id',verify.id(811))),null);",False)
                    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                        raced=list(pool.map(action_race,[1,2]))
                    assert sum(r.returncode==0 for r in raced)==1,'Exactly one competing action must succeed'
                    assert any(b'Work version changed' in r.stderr for r in raced),'Competing action must report a revision conflict'
                    assert run("select count(*)=2 from object_state_history where object_id=verify.id(843) and capture_kind is not null").stdout.strip()==b't'
                    assert run("select count(*)=1 from object_state_history where object_id=verify.id(843) and capture_kind is null").stdout.strip()==b't'
                    print('Concurrent action retains exactly one new capture and one attributed transition: PASS',flush=True)
                    import runpy
                    concurrency=runpy.run_path(str(ROOT/'scripts/verify/learn-actions-concurrency.py'))
                    race_tools=concurrency['verify_authority_races'](run,DOCKER,TARGET,DB)
                    if '--slack' in sys.argv:
                        bundle_s=json.loads(node("import {checkedSlack} from './scripts/verify/learn-slack-bundle.mjs';process.stdout.write(JSON.stringify(checkedSlack()));"))
                        slack_sql="set role postgres;set serviceos.release_target='saatxzwxvdvqevbnskxy';set serviceos.release_source_sha256="+lit(bundle_s['manifest']['sha256'])+';'+bundle_s['sql']
                        before_s=json.loads(run(catalog_sql).stdout)
                        apply("alter table of_test_deploy.migrations add constraint slack_receipt_failure check(migration_name<>'learn_slack_storage_setup_v1');",'Injected Slack receipt failure')
                        failed=run(slack_sql,False)
                        assert failed.returncode and b'slack_receipt_failure' in failed.stderr,failed.stderr.decode()[-1000:]
                        rolled_s=json.loads(run(catalog_sql).stdout)
                        assert {k:v for k,v in rolled_s.items() if k!='observedAt'}=={k:v for k,v in before_s.items() if k!='observedAt'},'Slack failure changed existing catalog'
                        apply('alter table of_test_deploy.migrations drop constraint slack_receipt_failure;','Atomic Slack rollback preserves prior catalog')
                        rehearsal=node("import {slackRehearsalSql} from './scripts/verify/learn-test-slack-rehearsal.mjs';process.stdout.write(slackRehearsalSql());")
                        apply('set role postgres;'+rehearsal,'Exact hosted Slack rehearsal executes and rolls back')
                        assert json.loads(run(catalog_sql).stdout)['tables']==before_s['tables']
                        apply(slack_sql,'Slack dependencies, retained sources and import setup as non-superuser')
                        after_s=json.loads(run(catalog_sql).stdout)
                        assert [t for t in after_s['tables'] if t['name'] not in bundle_s['manifest']['tables']]==before_s['tables'],'Slack changed existing source/queue tables'
                        assert after_s['helpers']==before_s['helpers'] and after_s['foundationGuard']==before_s['foundationGuard']
                        assert run('select count(*) from slack_history_imports').stdout.strip()==b'0'
                        assert run('select count(*) from tenant_connectors').stdout.strip()==b'0','Environment seed leaked into release'
                        slack_query=node("import {SLACK_FUNCTION_QUERY} from './scripts/verify/learn-slack-catalog.mjs';process.stdout.write(SLACK_FUNCTION_QUERY);")
                        expected={'sourceSha256':bundle_s['manifest']['sha256'],'tables':[t for t in after_s['tables'] if t['name'] in bundle_s['manifest']['tables']],'functions':json.loads(run(slack_query).stdout)}
                        expected_path=ROOT/'supabase/release/learn-test/009_slack_storage_setup.expected.json'
                        if '--write-slack-expected' in sys.argv:
                            expected_path.write_text(json.dumps(expected,indent=2)+'\n')
                        else:
                            assert expected==json.loads(expected_path.read_text()),'Slack definitions differ from reviewed projection'
                        apply((ROOT/'scripts/verify/learn-slack-release.assert.sql').read_text(),'Real-schema Slack approval, atomic page publication, retention and tenant/role checks')
                        duplicate=run(slack_sql,False)
                        assert duplicate.returncode and b'Slack storage release already exists' in duplicate.stderr
                        print('Duplicate Slack installation refused: PASS',flush=True)
                        Held=race_tools['Held'];race_after=race_tools['race_after'];refused=race_tools['refused']
                        run("update profiles set role='owner' where id=verify.id(911)")
                        def slack_approve(request,channel):
                            return "set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000911';select learn_slack_start_import(verify.id(901),verify.id("+str(request)+"),verify.id(921),updated_at::text,'"+channel+"','2026-01-01','2026-01-02',2,'Synthetic concurrent approval') from provider_connections where id=verify.id(921);"
                        with Held("reset role;update profiles set role='viewer' where id=verify.id(911);") as held:
                            refused(race_after(held,slack_approve(941,'CREVOKE'),'authenticated'),'Company owner/admin access required')
                        assert run("select count(*)=0 from slack_history_imports where id=verify.id(941)").stdout.strip()==b't'
                        run("update profiles set role='owner' where id=verify.id(911)")
                        with Held('set role authenticated;'+slack_approve(942,'CFIRST')) as held:
                            refused(run("update profiles set role='viewer' where id=verify.id(911);",False),'Work or authority is changing')
                            held.commit()
                        run("update profiles set role='viewer' where id=verify.id(911)")
                        refused(run('set role authenticated;'+slack_approve(943,'CAFTER'),False),'Company owner/admin access required')
                        refused(run('begin isolation level repeatable read;set role authenticated;'+slack_approve(944,'CSTALE'),False),'fresh read-committed snapshot')
                        print('Slack approval/revocation in both controlled orderings and stale-snapshot refusal: PASS',flush=True)
                        if '--slack-worker' in sys.argv:
                            prereqs=json.loads((ROOT/'docs/operations/evidence/learn-test-worker-before-schema-2026-10-09.json').read_text())
                            queue_functions=[f for f in prereqs['workerFunctions'] if f['name'].startswith('platform_jobs_')]
                            queue_source=''.join(f['definition']+';revoke all on function '+f['name']+'('+f['arguments']+') from public,anon,authenticated;grant execute on function '+f['name']+'('+f['arguments']+') to service_role;' for f in queue_functions)
                            apply('set role postgres;'+queue_source+'grant select,insert,update on platform_jobs to service_role;','Recorded queue functions and service privileges')
                            apply('create extension supabase_vault cascade;','Real Vault extension in disposable database')
                            worker_query=node("import {WORKER_FUNCTION_QUERY} from './scripts/verify/learn-slack-worker-catalog.mjs';process.stdout.write(WORKER_FUNCTION_QUERY);")
                            worker_before=json.loads(run(catalog_sql).stdout)
                            functions_before=json.loads(run(worker_query).stdout)
                            worker_sql=node("import {workerReleaseSql} from './scripts/verify/learn-test-worker-release.mjs';process.stdout.write(workerReleaseSql());")
                            apply("alter table of_test_deploy.migrations add constraint worker_receipt_failure check(migration_name<>'learn_slack_durable_worker_v1');",'Injected worker receipt failure')
                            failed=run('set role postgres;'+worker_sql,False)
                            assert failed.returncode and b'worker_receipt_failure' in failed.stderr,failed.stderr.decode()[-1000:]
                            assert json.loads(run(worker_query).stdout)==functions_before,'Failed worker installation changed functions'
                            assert json.loads(run(catalog_sql).stdout)['tables']==worker_before['tables']
                            apply('alter table of_test_deploy.migrations drop constraint worker_receipt_failure;','Failed worker installation rolls back all changes')
                            rehearsal=node("import {workerRehearsalSql} from './scripts/verify/learn-test-worker-release.mjs';process.stdout.write(workerRehearsalSql());")
                            apply('set role postgres;'+rehearsal,'Exact hosted worker rehearsal rolls back')
                            assert json.loads(run(worker_query).stdout)==functions_before
                            apply('set role postgres;'+worker_sql,'Worker and credential release as non-superuser')
                            worker_after=json.loads(run(catalog_sql).stdout)
                            assert worker_after['tables']==worker_before['tables'],'Worker changed existing table definitions or privileges'
                            source_sha=node("import {checkedWorker} from './scripts/verify/learn-slack-worker-bundle.mjs';process.stdout.write(checkedWorker().manifest.sha256);")
                            expected={'sourceSha256':source_sha,'functions':json.loads(run(worker_query).stdout)}
                            expected_path=ROOT/'supabase/release/learn-test/010_slack_durable_worker.expected.json'
                            if '--write-worker-expected' in sys.argv:expected_path.write_text(json.dumps(expected,indent=2)+'\n')
                            else:assert expected==json.loads(expected_path.read_text()),'Installed worker functions differ from reviewed projection'
                            duplicate=run('set role postgres;'+worker_sql,False)
                            assert duplicate.returncode and b'Slack worker release already exists' in duplicate.stderr
                            apply((ROOT/'scripts/verify/learn-slack-worker.assert.sql').read_text(),'Slack lease recovery, page replay, atomic continuation, bounded retries and isolation')
                            apply("insert into platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,payload) select verify.id(980),tenant_id,'slack','slack.history_sync','slack.history:'||account_id::text,'queued',5,jsonb_build_object('connector_account_id',account_id) from verify.worker_page;",'Synthetic concurrent Slack claim fixture')
                            with Held("select id from learn_slack_claim_jobs(verify.id(981),1);") as held:
                                assert run("set role service_role;select count(*)=0 from learn_slack_claim_jobs(verify.id(982),1)").stdout.strip().endswith(b't')
                                held.commit()
                            run("update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=verify.id(980)")
                            with Held("select id from learn_slack_claim_jobs(verify.id(982),1);") as held:
                                refused(race_after(held,"select learn_slack_finish_job(verify.id(901),verify.id(980),'learn-slack:'||verify.id(981),1,'{\"success\":true}');"),'slack_queue_not_owned')
                            print('Concurrent claim skips locked jobs; stale worker blocked behind replacement claim is refused: PASS',flush=True)
                            apply((ROOT/'scripts/verify/learn-slack-credential.assert.sql').read_text(),'Real Vault reference, tenant, revision, lease and browser access checks')
                            if '--slack-threads' in sys.argv:
                                thread_before=json.loads(run(catalog_sql).stdout)
                                thread_function_query="select coalesce(jsonb_agg(pg_get_functiondef(p.oid) order by p.oid),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f';"
                                thread_functions_before=json.loads(run(thread_function_query).stdout)
                                thread_sql=node("import {threadsReleaseSql} from './scripts/verify/learn-test-threads-release.mjs';process.stdout.write(threadsReleaseSql());")
                                injected=thread_sql.replace('insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)',"do $$begin raise exception 'Injected thread receipt failure';end $$;\ninsert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)")
                                failed=run('set role postgres;'+injected,False)
                                assert failed.returncode and b'Injected thread receipt failure' in failed.stderr
                                assert json.loads(run(catalog_sql).stdout)['tables']==thread_before['tables']
                                assert json.loads(run(thread_function_query).stdout)==thread_functions_before
                                print('Failed thread receipt rolls back all function, privilege and table changes: PASS',flush=True)
                                thread_rehearsal=node("import {threadsRehearsalSql} from './scripts/verify/learn-test-threads-release.mjs';process.stdout.write(threadsRehearsalSql());")
                                apply('set role postgres;'+thread_rehearsal, 'Exact thread release rollback rehearsal')
                                assert json.loads(run(catalog_sql).stdout)['tables']==thread_before['tables']
                                assert json.loads(run(thread_function_query).stdout)==thread_functions_before
                                apply('set role postgres;'+thread_sql, 'Retained thread approvals, scoped claims and shared source writer')
                                thread_after=json.loads(run(catalog_sql).stdout)
                                assert [t for t in thread_after['tables'] if t['name']!='slack_thread_imports']==thread_before['tables'],'Threads changed existing table definitions or privileges'
                                thread_query=node("import {THREADS_FUNCTION_QUERY} from './scripts/verify/learn-slack-threads-catalog.mjs';process.stdout.write(THREADS_FUNCTION_QUERY);")
                                thread_sha=node("import {checkedThreads} from './scripts/verify/learn-slack-threads-bundle.mjs';process.stdout.write(checkedThreads().manifest.sha256);")
                                thread_expected={'sourceSha256':thread_sha,'tables':[t for t in thread_after['tables'] if t['name']=='slack_thread_imports'],'functions':json.loads(run(thread_query).stdout)}
                                thread_expected_path=ROOT/'supabase/release/learn-test/011_slack_threads.expected.json'
                                if '--write-threads-expected' in sys.argv:thread_expected_path.write_text(json.dumps(thread_expected,indent=2)+'\n')
                                else:assert thread_expected==json.loads(thread_expected_path.read_text()),'Thread installed projection differs'
                                duplicate=run('set role postgres;'+thread_sql,False)
                                assert duplicate.returncode and b'Slack thread release already exists' in duplicate.stderr
                                apply((ROOT/'scripts/verify/learn-slack-thread-storage.assert.sql').read_text(),'Thread consent, source association, atomic checkpoint, replay and preservation')
                                if '--slack-operator' in sys.argv:
                                    operator_before=json.loads(run(catalog_sql).stdout)
                                    operator_functions_before=json.loads(run(thread_function_query).stdout)
                                    operator_sql=node("import {operatorReleaseSql} from './scripts/verify/learn-test-operator-release.mjs';process.stdout.write(operatorReleaseSql());")
                                    injected=operator_sql.replace('insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)',"do $$begin raise exception 'Injected operator receipt failure';end $$;\ninsert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)")
                                    failed=run('set role postgres;'+injected,False)
                                    assert failed.returncode and b'Injected operator receipt failure' in failed.stderr
                                    assert json.loads(run(thread_function_query).stdout)==operator_functions_before
                                    assert json.loads(run(catalog_sql).stdout)['tables']==operator_before['tables']
                                    operator_rehearsal=node("import {operatorRehearsalSql} from './scripts/verify/learn-test-operator-release.mjs';process.stdout.write(operatorRehearsalSql());")
                                    apply('set role postgres;'+operator_rehearsal,'Exact operator release rollback rehearsal')
                                    assert json.loads(run(thread_function_query).stdout)==operator_functions_before
                                    apply('set role postgres;'+operator_sql,'Company-scoped Slack operator reads')
                                    assert json.loads(run(catalog_sql).stdout)['tables']==operator_before['tables'],'Operator reads changed existing tables or privileges'
                                    operator_query=node("import {OPERATOR_FUNCTION_QUERY} from './scripts/verify/learn-slack-operator-catalog.mjs';process.stdout.write(OPERATOR_FUNCTION_QUERY);")
                                    operator_sha=node("import {checkedOperator} from './scripts/verify/learn-slack-operator-bundle.mjs';process.stdout.write(checkedOperator().manifest.sha256);")
                                    operator_expected={'sourceSha256':operator_sha,'tables':[],'functions':json.loads(run(operator_query).stdout)}
                                    operator_expected_path=ROOT/'supabase/release/learn-test/012_slack_operator.expected.json'
                                    if '--write-operator-expected' in sys.argv:operator_expected_path.write_text(json.dumps(operator_expected,indent=2)+'\n')
                                    else:assert operator_expected==json.loads(operator_expected_path.read_text()),'Operator definitions differ'
                                    duplicate=run('set role postgres;'+operator_sql,False)
                                    assert duplicate.returncode and b'Slack operator release already exists' in duplicate.stderr
                                    apply((ROOT/'scripts/verify/learn-slack-operator-reads.assert.sql').read_text(),'Observed thread paging, queue status, disabled connection retention and company isolation')
                                    if '--slack-pacing' in sys.argv:
                                        pacing_before=json.loads(run(catalog_sql).stdout)
                                        pacing_functions_before=json.loads(run(thread_function_query).stdout)
                                        pacing_sql=(ROOT/'supabase/migrations/20261030150000_learn_slack_workspace_pacing.sql').read_text()
                                        failed=run('set role postgres;'+pacing_sql.replace('\ncommit;','\ndo $$begin raise exception \'Injected pacing release failure\';end $$;\ncommit;'),False)
                                        assert failed.returncode and b'Injected pacing release failure' in failed.stderr
                                        assert json.loads(run(catalog_sql).stdout)['tables']==pacing_before['tables']
                                        assert json.loads(run(thread_function_query).stdout)==pacing_functions_before
                                        apply('set role postgres;'+pacing_sql,'Workspace-wide Slack admission and shared retry cooldown')
                                        assert [t for t in json.loads(run(catalog_sql).stdout)['tables'] if t['name']!='slack_workspace_pacing']==pacing_before['tables'],'Pacing changed existing table definitions or privileges'
                                        apply((ROOT/'scripts/verify/learn-slack-pacing.assert.sql').read_text(),'Shared history/thread/company budget, attempts, replay, crash recovery and retained sources')
                                        pacing_races={}
                                        exec((ROOT/'scripts/verify/learn-slack-pacing-concurrency.py').read_text(),pacing_races)
                                        pacing_races['verify_pacing_races'](run,Held,refused)















finally:
    subprocess.run([DOCKER,'rm','-f',TARGET],capture_output=True)
