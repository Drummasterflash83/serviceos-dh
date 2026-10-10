"""Offline PostgreSQL 17 release/rollback metadata check; reads a schema-only catalog file.
Never connects to a hosted database or an existing local container.
"""
import hashlib,json,shutil,subprocess,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DOCKER=shutil.which('docker') or '/usr/local/bin/docker'
NODE=shutil.which('node') or '/usr/local/bin/node'
NAME='serviceos-thread-recovery-release-'+uuid.uuid4().hex[:8]
IMAGE='public.ecr.aws/supabase/postgres:17.6.1.141'
if len(sys.argv)!=2:raise SystemExit('Provide the verified release-020 schema-only catalog path')
catalog=json.loads(Path(sys.argv[1]).read_text())
assert len(catalog['tables'])==91 and len(catalog['readiness']['customMigrationEntries'])==21
sql=(ROOT/'supabase/release/learn-test/021_slack_thread_recovery.sql').read_text();sha=hashlib.sha256(sql.encode()).hexdigest()
def node(code):return subprocess.run([NODE,'--input-type=module','-e',code],cwd=ROOT,capture_output=True,check=True).stdout.decode()
def run(sql,check=True):
 r=subprocess.run([DOCKER,'exec','-i',NAME,'psql','-h','127.0.0.1','-U','supabase_admin','-d','postgres','-At','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True)
 if check and r.returncode:raise RuntimeError(r.stderr[-2000:])
 return r
queries=node("import {FOUNDATION_CATALOG_QUERY} from './scripts/verify/learn-foundation-catalog.mjs';import {THREAD_RECOVERY_FUNCTION_QUERY} from './scripts/verify/learn-slack-thread-recovery-catalog.mjs';console.log(JSON.stringify([FOUNDATION_CATALOG_QUERY,THREAD_RECOVERY_FUNCTION_QUERY]));")
queries=json.loads(queries)
q=lambda s:"'"+str(s).replace("'","''")+"'"
try:
 subprocess.run([DOCKER,'run','-d','--pull=never','--network','none','--name',NAME,'-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE],capture_output=True,check=True)
 for _ in range(100):
  if run('select 1',False).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('Disposable release database did not start')
 run('alter role postgres nosuperuser createrole bypassrls;grant usage,create on schema public to postgres with grant option;')
 # Restore actual referenced column types, not source rows or production credentials.
 for t in catalog['tables']:
  if t['name'] not in ['slack_thread_imports','connector_accounts','provider_connections','tenant_connectors','platform_jobs']:continue
  cols=','.join('"'+c['name']+'" '+c['type'] for c in t['columns'])
  run('create table public.'+t['name']+'('+cols+');alter table '+t['name']+' owner to postgres;')
 run('create schema of_test_deploy authorization postgres;create table of_test_deploy.migrations(source_sha256 text,migration_name text primary key,project_ref text,applied_at timestamptz);alter table of_test_deploy.migrations owner to postgres;')
 for e in catalog['readiness']['customMigrationEntries']:
  run('insert into of_test_deploy.migrations values('+','.join(q(e[k]) for k in ['source_sha256','migration_name','project_ref','applied_at'])+');')
 prefix="set role postgres;set serviceos.release_target='saatxzwxvdvqevbnskxy';set serviceos.release_source_sha256="+q(sha)+';'
 before=json.loads(run(queries[0]).stdout)
 absent="select to_regprocedure('public.learn_slack_resume_thread(uuid,uuid,uuid,text,text,integer,text)') is null and to_regprocedure('public.learn_slack_thread_recovery_read(uuid,uuid)') is null and to_regprocedure('public.learn_slack_thread_recovery_state(uuid,uuid)') is null and to_regclass('public.learn_slack_thread_approval_order') is null and to_regclass('public.learn_slack_thread_one_recovery') is null;"
 run(prefix+sql.replace('\ncommit;\n','\nrollback;\n'))
 assert run(absent).stdout.strip()=='t'
 run("alter table of_test_deploy.migrations add constraint fail_receipt check(migration_name<>'learn_slack_thread_recovery_v1');")
 failed=run(prefix+sql,False);assert failed.returncode and 'fail_receipt' in failed.stderr
 assert run(absent).stdout.strip()=='t'
 run('alter table of_test_deploy.migrations drop constraint fail_receipt;')
 run(prefix+sql)
 after=json.loads(run(queries[0]).stdout);f=json.loads(run(queries[1]).stdout)
 index_names=['learn_slack_thread_approval_order','learn_slack_thread_one_recovery']
 indexes=[i for t in after['tables'] if t['name']=='slack_thread_imports' for i in t['indexes'] if i['name'] in index_names]
 for t in after['tables']:t['indexes']=[i for i in t['indexes'] if i['name'] not in index_names]
 assert before['tables']==after['tables']
 expected={'functions':f,'indexes':indexes}
 assert len(indexes)==2 and len(f)==3 and all(v['owner']=='postgres' and not v['anonExecute'] and not v['serviceExecute'] and v['authenticatedExecute']==(v['name']!='learn_slack_thread_recovery_state') for v in f)
 (ROOT/'.verification-results/learn-thread-recovery-expected.json').write_text(json.dumps(expected,indent=2)+'\n')
 print(json.dumps({'state':'passed','sourceSha256':sha,'checks':['Exact release DDL installs under a non-superuser deployment owner using current TEST reference-column types.','Explicit rollback removes all new objects; receipt failure atomically rolls back all three functions and two indexes.','Only two indexes change table metadata; private helper and authenticated RPC execution rights match the intended contract.'],'limitations':['Five referenced tables restored without customer rows; no helper substitutions. Functional behavior was checked separately; full hosted compatibility and signed-in acceptance remain.']},indent=2))
finally:subprocess.run([DOCKER,'rm','-f',NAME],capture_output=True)
