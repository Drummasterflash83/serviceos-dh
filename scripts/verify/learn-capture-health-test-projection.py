"""Rehearse capture health against observed TEST table contracts.

Disposable PG17 with no network, host mounts or ports. Auth functions/users are
fixture stand-ins; no hosted data or Vault secret is copied. Reproduces exact
relevant tables, constraints, indexes, policies, triggers, helpers and grants.
"""
import hashlib,json,re,shutil,subprocess,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
if len(sys.argv)!=2:raise SystemExit('Provide the verified current TEST capture schema catalog')
c=json.loads(Path(sys.argv[1]).read_text())
assert c['projectRef']=='saatxzwxvdvqevbnskxy' and len(c['tables'])==110 and len(c['readiness']['customMigrationEntries'])==31
manifest=json.loads((ROOT/'supabase/release/learn-test/031_capture_health.manifest.json').read_text())
release=(ROOT/'supabase/release/learn-test/031_capture_health.sql').read_text()
assert hashlib.sha256(release.encode()).hexdigest()==manifest['sha256']
for entry in manifest['sources']:assert hashlib.sha256((ROOT/entry['path']).read_bytes()).hexdigest()==entry['sha256']
DOCKER=shutil.which('docker') or '/usr/local/bin/docker'
NODE=shutil.which('node') or '/usr/local/bin/node'
NAME='serviceos-capture-health-projection-'+uuid.uuid4().hex[:8]
IMAGE='public.ecr.aws/supabase/postgres:17.6.1.141'
DB='postgres';created=False
q=lambda s:"'"+str(s).replace("'","''")+"'"
i=lambda s:'"'+s.replace('"','""')+'"'
def run(sql,check=True):
 r=subprocess.run([DOCKER,'exec','-i',NAME,'psql','-h','127.0.0.1','-U','supabase_admin','-d',DB,'-XAtq','-v','ON_ERROR_STOP=1'],input="set search_path=public,pg_catalog;\n"+sql,text=True,capture_output=True,timeout=60)
 if check and r.returncode:raise RuntimeError(r.stderr[-3000:])
 return r
def node(code):return subprocess.run([NODE,'--input-type=module','-e',code],cwd=ROOT,capture_output=True,check=True).stdout.decode()
names=json.loads(node("import {CAPTURE_BASE_TABLES} from './scripts/verify/learn-capture-health-catalog.mjs';console.log(JSON.stringify(CAPTURE_BASE_TABLES));"))
tables=[t for t in c['tables'] if t['name'] in names];assert len(tables)==len(names)
queries=json.loads(node("import {CAPTURE_FUNCTION_QUERY,CAPTURE_GRANTS_QUERY} from './scripts/verify/learn-capture-health-catalog.mjs';import {FOUNDATION_CATALOG_QUERY} from './scripts/verify/learn-foundation-catalog.mjs';console.log(JSON.stringify([CAPTURE_FUNCTION_QUERY,CAPTURE_GRANTS_QUERY,FOUNDATION_CATALOG_QUERY]));"))
prefix="set role postgres;set serviceos.release_target='saatxzwxvdvqevbnskxy';set serviceos.release_source_sha256="+q(manifest['sha256'])+';'
def snapshot():return {'tables':[t for t in json.loads(run(queries[2]).stdout)['tables'] if t['name'] in names],'functions':json.loads(run(queries[0]).stdout),'grants':json.loads(run(queries[1]).stdout)}
def retained():return {n:run('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),\'[]\') from public.'+i(n)+" t").stdout for n in names}
try:
 subprocess.run([DOCKER,'run','-d','--pull=never','--network','none','--name',NAME,'-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE],capture_output=True,check=True,timeout=30);created=True
 for _ in range(100):
  if run('select 1',False).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('Disposable PG17 did not start')
 run('create database learn_capture_health_test template template0;');DB='learn_capture_health_test'
 roles={g['role'] for g in c['captureGrants']}|{r for t in tables for p in t['policies'] for r in p['roles']}
 existing=set(run('select rolname from pg_roles').stdout.splitlines())
 for role in sorted(roles-existing-{'public'}):run('create role '+i(role)+' nologin;')
 statements=["create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;",
 "create extension supabase_vault cascade;revoke all on schema vault from public,anon,authenticated;grant usage on schema vault to postgres,service_role;revoke all on vault.secrets,vault.decrypted_secrets from postgres;grant select on vault.secrets,vault.decrypted_secrets to postgres;grant execute on function vault.create_secret(text,text,text,uuid),vault.update_secret(uuid,text,text,text,uuid) to postgres;",
 "alter role postgres nosuperuser createrole bypassrls;grant usage,create on schema public to postgres with grant option;grant usage on schema public,auth to postgres,authenticated,anon,service_role;grant references on auth.users to postgres;"]
 for t in tables:
  cols=','.join(i(col['name'])+' '+col['type']+(' default '+col['default'] if col['default'] else '')+(' not null' if col['notNull'] else '') for col in t['columns'])
  statements+=['create table public.'+i(t['name'])+'('+cols+');alter table public.'+i(t['name'])+' owner to postgres;']
 for t in tables:
  for k in t['constraints']:
   if k['kind']!='f':statements+=['alter table '+i(t['name'])+' add constraint '+i(k['name'])+' '+k['definition']+';']
  backing={k['name'] for k in t['constraints'] if k['kind'] in ['p','u','x']}
  statements += [x['definition']+';' for x in t['indexes'] if x['name'] not in backing]
 for t in tables:statements+=['alter table '+i(t['name'])+' add constraint '+i(k['name'])+' '+k['definition']+';' for k in t['constraints'] if k['kind']=='f']
 # Allow the observed definitions to be restored in catalog order; execution below
 # still resolves their real dependencies. No function implementation is replaced.
 statements+=['set check_function_bodies=off;']
 for f in c['captureFunctions']:
  signature='public.'+i(f['name'])+'('+f['arguments']+')'
  statements += [f['definition']+';alter function '+signature+' owner to '+i(f['owner'])+';', 'revoke all on function '+signature+' from public,anon,authenticated,service_role;']
  for role,key in [('authenticated','authenticatedExecute'),('anon','anonExecute'),('service_role','serviceExecute')]:
   if f[key]:statements+=['grant execute on function '+signature+' to '+i(role)+';']
 statements+=['reset check_function_bodies;']
 for t in tables:
  if t['rls']:statements+=['alter table '+i(t['name'])+' enable row level security;']
  if t['forceRls']:statements+=['alter table '+i(t['name'])+' force row level security;']
  for p in t['policies']:statements+=['create policy '+i(p['name'])+' on '+i(t['name'])+' as '+p['permissive']+' for '+p['command']+' to '+','.join('public' if r=='public' else i(r) for r in p['roles'])+(' using('+p['using']+')' if p['using'] else '')+(' with check('+p['check']+')' if p['check'] else '')+';']
  for tr in t['triggers']:
   assert tr['function'] in [f['name'] for f in c['captureFunctions']],tr['function']
   statements+=[tr['definition']+';']
 for g in c['captureGrants']:
  statements+=['grant '+g['privilege']+('('+i(g['column'])+')' if g['column'] else '')+' on '+i(g['table'])+' to '+('public' if g['role']=='public' else i(g['role']))+(' with grant option' if g['grantable'] else '')+';']
 statements+=['create schema of_test_deploy authorization postgres;create table of_test_deploy.migrations(source_sha256 text,migration_name text primary key,project_ref text,applied_at timestamptz default now());alter table of_test_deploy.migrations owner to postgres;']
 for e in c['readiness']['customMigrationEntries']:statements+=['insert into of_test_deploy.migrations values('+','.join(q(e[k]) for k in ['source_sha256','migration_name','project_ref','applied_at'])+');']
 run('\n'.join(statements))
 before=snapshot()
 assert before['tables']==tables,'Projected table contract differs'
 assert before['functions']==c['captureFunctions'],'Projected function contract differs'
 assert before['grants']==c['captureGrants'],'Projected grants differ'
 print('All observed dependent table, function and grant contracts reproduced.',flush=True)
 run((ROOT/'scripts/verify/learn-capture-health-projection.fixture.sql').read_text())
 rows=retained()
 run(prefix+release.replace('\ncommit;','\nrollback;'))
 assert snapshot()==before and retained()==rows
 assert run("select to_regprocedure('learn_operator_capture_health(uuid,text)') is null").stdout.strip()=='t'
 print('Capture health rollback retains prior schema, permissions and synthetic rows.',flush=True)
 run("alter table of_test_deploy.migrations add constraint fail_receipt check(migration_name<>'learn_capture_health_v1');")
 failed=run(prefix+release,False);assert failed.returncode and 'fail_receipt' in failed.stderr
 assert snapshot()==before and retained()==rows
 assert run("select to_regprocedure('learn_operator_capture_health(uuid,text)') is null").stdout.strip()=='t'
 run('alter table of_test_deploy.migrations drop constraint fail_receipt;')
 print('Failed deployment receipt rolls back the capture health function and permissions.',flush=True)
 run(prefix+release)
 assert run(prefix+release,False).returncode,'Duplicate package applied'
 assert run('select count(*) from of_test_deploy.migrations').stdout.strip()=='32'
 assert snapshot()['tables']==before['tables'] and snapshot()['grants']==before['grants'] and retained()==rows
 assert [f for f in snapshot()['functions'] if f['name']!='learn_operator_capture_health']==before['functions']
 query=re.sub(r"p\.proname in \([^)]*\)","p.proname in ('learn_operator_capture_health')",queries[0])
 actual=json.loads(run(query).stdout)
 assert len(actual)==1 and actual[0]['owner']=='postgres' and actual[0]['authenticatedExecute'] and not actual[0]['anonExecute'] and not actual[0]['serviceExecute']
 (ROOT/'.verification-results/capture-health-projected-function.json').write_text(json.dumps(actual,indent=2)+'\n')
 (ROOT/'.verification-results/learn-capture-health-expected.json').write_text(json.dumps({'sourceSha256':manifest['sha256'],'tables':[],'functions':actual,'grants':[]},indent=2)+'\n')
 print('Installed as actual non-superuser owner, with authenticated RPC only; no existing rows changed.',flush=True)
 assertions=(ROOT/'scripts/verify/learn-operator-capture-health.assert.sql').read_text()
 print(run(assertions).stdout.strip(),flush=True)
 run("insert into view_as_context(tenant_id,actor_user_id,subject_kind,expires_at) values(fixture_id(100),fixture_id(182),'role',clock_timestamp()+interval '1 hour');")
 run("set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000182';set role authenticated;do $$begin begin perform learn_operator_capture_health(fixture_id(100));raise exception 'View As incorrectly granted capture access';exception when insufficient_privilege then null;end;end$$;")
 run("update view_as_context set ended_at=clock_timestamp() where actor_user_id=fixture_id(182);")
 print('Active View As prevents platform capture reads even with a valid viewer grant.',flush=True)

 assert snapshot()['tables']==before['tables'] and snapshot()['grants']==before['grants']
 data=run("set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000182';set role authenticated;select learn_operator_capture_health(fixture_id(100));").stdout.strip()
 output=ROOT/'.verification-results/capture-health-projected-page.json';output.write_text(data+'\n')
 node("import{readFileSync}from'node:fs';import{readCaptureHealth}from'./src/lib/learn-operator-capture-health.ts';const data=JSON.parse(readFileSync('.verification-results/capture-health-projected-page.json'));await readCaptureHealth({rpc:async()=>({data,error:null})},data.tenant_id);")
 print('Capture health passed actual TEST contracts and application parser; no hosted mutation or provider request.',flush=True)

finally:
 if created:subprocess.run([DOCKER,'rm','-f',NAME],capture_output=True,check=True,timeout=30)
