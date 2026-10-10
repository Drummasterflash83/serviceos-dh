"""Offline PostgreSQL 17 release/rollback metadata check; reads a schema-only catalog file.
Never connects to a hosted database or an existing local container.
"""
import hashlib,json,shutil,subprocess,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DOCKER=shutil.which('docker') or '/usr/local/bin/docker'
NODE=shutil.which('node') or '/usr/local/bin/node'
NAME='serviceos-correction-release-'+uuid.uuid4().hex[:8]
IMAGE='public.ecr.aws/supabase/postgres:17.6.1.141'
if len(sys.argv)!=2:raise SystemExit('Provide the verified release-017 schema-only catalog path')
catalog=json.loads(Path(sys.argv[1]).read_text())
assert len(catalog['tables'])==89 and len(catalog['readiness']['customMigrationEntries'])==18
sql=(ROOT/'supabase/release/learn-test/018_performance_corrections.sql').read_text();sha=hashlib.sha256(sql.encode()).hexdigest()
def node(code):return subprocess.run([NODE,'--input-type=module','-e',code],cwd=ROOT,capture_output=True,check=True).stdout.decode()
def run(sql,check=True):
 r=subprocess.run([DOCKER,'exec','-i',NAME,'psql','-h','127.0.0.1','-U','supabase_admin','-d','postgres','-At','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True)
 if check and r.returncode:raise RuntimeError(r.stderr[-2000:])
 return r
queries=node("import {FOUNDATION_CATALOG_QUERY} from './scripts/verify/learn-foundation-catalog.mjs';import {CORRECTION_FUNCTION_QUERY,CORRECTION_ACCESS_QUERY} from './scripts/verify/learn-performance-corrections-catalog.mjs';console.log(JSON.stringify([FOUNDATION_CATALOG_QUERY,CORRECTION_FUNCTION_QUERY,CORRECTION_ACCESS_QUERY]));")
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
  if t['name'] not in ['tenants','profiles','measurements']:continue
  cols=','.join('"'+c['name']+'" '+c['type'] for c in t['columns'])
  run('create table public.'+t['name']+'('+cols+');alter table '+t['name']+' add primary key(id);alter table '+t['name']+' owner to postgres;')
 for name in ['current_tenant_id','current_user_role']:
  run(next(f['definition'] for f in catalog['helpers'] if f['name']==name)+';')
 run("create function public.objectives_append_only() returns trigger language plpgsql as $$ begin raise exception 'append only' using errcode='23001';end $$;")
 run('create schema of_test_deploy authorization postgres;create table of_test_deploy.migrations(source_sha256 text,migration_name text primary key,project_ref text,applied_at timestamptz);alter table of_test_deploy.migrations owner to postgres;')
 for e in catalog['readiness']['customMigrationEntries']:
  run('insert into of_test_deploy.migrations values('+','.join(q(e[k]) for k in ['source_sha256','migration_name','project_ref','applied_at'])+');')
 prefix="set role postgres;set serviceos.release_target='saatxzwxvdvqevbnskxy';set serviceos.release_source_sha256="+q(sha)+';'
 run(prefix+sql.replace('\ncommit;\n','\nrollback;\n'))
 assert run("select to_regclass('public.learn_performance_corrections') is null and to_regprocedure('public.learn_performance_correct(uuid,uuid,uuid,integer,numeric,text)') is null;").stdout.strip()=='t'
 run("alter table of_test_deploy.migrations add constraint fail_receipt check(migration_name<>'learn_performance_corrections_v1');")
 failed=run(prefix+sql,False);assert failed.returncode and 'fail_receipt' in failed.stderr
 assert run("select to_regclass('public.learn_performance_corrections') is null;").stdout.strip()=='t'
 run('alter table of_test_deploy.migrations drop constraint fail_receipt;')
 run(prefix+sql)
 c=json.loads(run(queries[0]).stdout);f=json.loads(run(queries[1]).stdout);a=json.loads(run(queries[2]).stdout)
 expected={'table':next(t for t in c['tables'] if t['name']=='learn_performance_corrections'),'functions':f,'access':a}
 assert len(f)==1 and f[0]['owner']=='postgres' and f[0]['authenticatedExecute'] and not f[0]['anonExecute'] and not f[0]['serviceExecute']
 assert expected['table']['rls'] and not expected['table']['authenticatedWrite'] and not expected['table']['anonAccess']
 assert all(r['allowed']==(r['privilege']=='SELECT' and r['role'] in ['authenticated','service_role']) for r in a)
 (ROOT/'.verification-results/learn-performance-corrections-expected.json').write_text(json.dumps(expected,indent=2)+'\n')
 print(json.dumps({'state':'passed','sourceSha256':sha,'checks':['Exact release DDL installs under a non-superuser deployment owner using recorded reference-column types.','Explicit rollback removes all new objects; receipt failure atomically rolls back the ledger and RPC.','New ledger SELECT-only grants, RLS and RPC execution rights match the intended contract.'],'limitations':['Three referenced tables restored without customer rows; original helper bodies and append-only trigger stand-in. Functional behavior was checked separately; full hosted compatibility and signed-in acceptance remain.']},indent=2))
finally:subprocess.run([DOCKER,'rm','-f',NAME],capture_output=True)
