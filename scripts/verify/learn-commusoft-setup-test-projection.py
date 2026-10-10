"""Rehearse the pinned Commusoft connection package against observed TEST table contracts.

Disposable PG17 with no network, host mounts or ports. Auth functions/users are
fixture stand-ins; no hosted data or Vault secret is copied. Reproduces exact
relevant tables, constraints, indexes, policies, triggers, helpers and grants.
"""
import hashlib,json,re,shutil,subprocess,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
if len(sys.argv)!=2:raise SystemExit('Provide the verified TEST Commusoft connection schema catalog')
c=json.loads(Path(sys.argv[1]).read_text())
assert c['projectRef']=='saatxzwxvdvqevbnskxy' and len(c['tables'])==106 and len(c['readiness']['customMigrationEntries'])==28
manifest=json.loads((ROOT/'supabase/release/learn-test/028_commusoft_connection.manifest.json').read_text())
release=(ROOT/'supabase/release/learn-test/028_commusoft_connection.sql').read_text()
assert hashlib.sha256(release.encode()).hexdigest()==manifest['sha256']
for source in manifest['sources']:assert hashlib.sha256((ROOT/source['path']).read_bytes()).hexdigest()==source['sha256']
DOCKER=shutil.which('docker') or '/usr/local/bin/docker'
NODE=shutil.which('node') or '/usr/local/bin/node'
NAME='serviceos-commusoft_connection-release-'+uuid.uuid4().hex[:8]
IMAGE='public.ecr.aws/supabase/postgres:17.6.1.141'
DB='postgres';created=False
q=lambda s:"'"+str(s).replace("'","''")+"'"
i=lambda s:'"'+s.replace('"','""')+'"'
def run(sql,check=True):
 r=subprocess.run([DOCKER,'exec','-i',NAME,'psql','-h','127.0.0.1','-U','supabase_admin','-d',DB,'-XAtq','-v','ON_ERROR_STOP=1'],input="set search_path=public,pg_catalog;\n"+sql,text=True,capture_output=True,timeout=60)
 if check and r.returncode:raise RuntimeError(r.stderr[-3000:])
 return r
def node(code):return subprocess.run([NODE,'--input-type=module','-e',code],cwd=ROOT,capture_output=True,check=True).stdout.decode()
names=json.loads(node("import {CONNECTION_BASE_TABLES} from './scripts/verify/learn-commusoft-setup-catalog.mjs';console.log(JSON.stringify(CONNECTION_BASE_TABLES));"))
tables=[t for t in c['tables'] if t['name'] in names];assert len(tables)==len(names)
queries=json.loads(node("import {CONNECTION_FUNCTION_QUERY,CONNECTION_GRANTS_QUERY,CONNECTION_VAULT_QUERY} from './scripts/verify/learn-commusoft-setup-catalog.mjs';import {FOUNDATION_CATALOG_QUERY} from './scripts/verify/learn-foundation-catalog.mjs';console.log(JSON.stringify([CONNECTION_FUNCTION_QUERY,CONNECTION_GRANTS_QUERY,FOUNDATION_CATALOG_QUERY,CONNECTION_VAULT_QUERY]));"))
prefix="set role postgres;set serviceos.release_target='saatxzwxvdvqevbnskxy';set serviceos.release_source_sha256="+q(manifest['sha256'])+';'
def snapshot():return {'tables':json.loads(run(queries[2]).stdout)['tables'],'functions':json.loads(run(queries[0]).stdout),'grants':json.loads(run(queries[1]).stdout),'vault':json.loads(run(queries[3]).stdout)}
def retained():return {n:run('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),\'[]\') from public.'+i(n)+" t").stdout for n in names}
try:
 subprocess.run([DOCKER,'run','-d','--pull=never','--network','none','--name',NAME,'-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE],capture_output=True,check=True,timeout=30);created=True
 for _ in range(100):
  if run('select 1',False).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('Disposable PG17 did not start')
 run('create database learn_commusoft_connection_test template template0;');DB='learn_commusoft_connection_test'
 roles={g['role'] for g in c['connectionGrants']}|{r for t in tables for p in t['policies'] for r in p['roles']}
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
 # Definitions are copied from the live TEST schema, not substituted for success.
 for f in c['connectionFunctions']:
  signature='public.'+i(f['name'])+'('+f['arguments']+')'
  statements += [f['definition']+';alter function '+signature+' owner to '+i(f['owner'])+';', 'revoke all on function '+signature+' from public,anon,authenticated,service_role;']
  for role,key in [('authenticated','authenticatedExecute'),('anon','anonExecute'),('service_role','serviceExecute')]:
   if f[key]:statements+=['grant execute on function '+signature+' to '+i(role)+';']
 for t in tables:
  if t['rls']:statements+=['alter table '+i(t['name'])+' enable row level security;']
  if t['forceRls']:statements+=['alter table '+i(t['name'])+' force row level security;']
  for p in t['policies']:statements+=['create policy '+i(p['name'])+' on '+i(t['name'])+' as '+p['permissive']+' for '+p['command']+' to '+','.join('public' if r=='public' else i(r) for r in p['roles'])+(' using('+p['using']+')' if p['using'] else '')+(' with check('+p['check']+')' if p['check'] else '')+';']
  for tr in t['triggers']:
   assert tr['function'] in [f['name'] for f in c['connectionFunctions']],tr['function']
   statements+=[tr['definition']+';']
 for g in c['connectionGrants']:
  statements+=['grant '+g['privilege']+('('+i(g['column'])+')' if g['column'] else '')+' on '+i(g['table'])+' to '+('public' if g['role']=='public' else i(g['role']))+(' with grant option' if g['grantable'] else '')+';']
 statements+=['create schema of_test_deploy authorization postgres;create table of_test_deploy.migrations(source_sha256 text,migration_name text primary key,project_ref text,applied_at timestamptz default now());alter table of_test_deploy.migrations owner to postgres;']
 for e in c['readiness']['customMigrationEntries']:statements+=['insert into of_test_deploy.migrations values('+','.join(q(e[k]) for k in ['source_sha256','migration_name','project_ref','applied_at'])+');']
 run('\n'.join(statements))
 before=snapshot();(ROOT/'.verification-results/commusoft_connection-projected-before.json').write_text(json.dumps(before,indent=2));assert before['tables']==tables,'Projected table contract differs';assert before['functions']==c['connectionFunctions'],'Projected functions differ';assert before['grants']==c['connectionGrants'],'Projected grants differ'
 assert before['vault']==c['connectionVault'],'Projected Vault capability contract differs'
 print('Observed TEST table, helper and privilege contracts reproduced.',flush=True)
 run("insert into tenants(id,slug,display_name) values('99000000-0000-0000-0000-000000000001','retained-commusoft_connection-test','Retained synthetic company');insert into people(id,tenant_id,display_name,primary_email,verified,created_source) values('99000000-0000-0000-0000-000000000002','99000000-0000-0000-0000-000000000001','Retained synthetic person','retained@example.invalid',true,'interaction');")
 run("insert into authority_permissions(permission,category,description) values('synthetic.retained','synthetic','Retained registry entry'),('platform.controlplane.admin','platform','Synthetic admin'),('platform.controlplane.view','platform','Synthetic view');")
 rows=retained()
 run(prefix+release.replace('\ncommit;\n','\nrollback;\n'))
 assert snapshot()==before and retained()==rows
 assert snapshot()['vault']==before['vault']
 print('Exact package rollback leaves prior schema, grants and rows unchanged.',flush=True)
 run("alter table of_test_deploy.migrations add constraint fail_receipt check(migration_name<>'learn_commusoft_connection_v1');")
 failed=run(prefix+release,False);assert failed.returncode and 'fail_receipt' in failed.stderr
 assert snapshot()==before and retained()==rows
 assert snapshot()['vault']==before['vault']
 run('alter table of_test_deploy.migrations drop constraint fail_receipt;')
 print('Injected receipt failure rolls back connection objects and broker helpers.',flush=True)
 run(prefix+release)
 after=snapshot();assert [t for t in after['tables'] if t['name'] in names]==before['tables'];assert retained()==rows
 assert [g for g in after['grants'] if g['table'] in names]==before['grants']
 new_functions=[f for f in after['functions'] if f['name'] in manifest['functions']]
 assert len(new_functions)==len(manifest['functions'])
 assert all(not f['anonExecute'] for f in new_functions)
 assert run('select count(*) from learn_commusoft_connection_requests').stdout.strip()=='0'
 assert run('select count(*) from learn_commusoft_verification_requests').stdout.strip()=='0'
 expected={'sourceSha256':manifest['sha256'],'tables':[t for t in after['tables'] if t['name'] in manifest['tables']],'functions':new_functions,'grants':[g for g in after['grants'] if g['table'] in manifest['tables']], 'vault':after['vault']}
 (ROOT/'.verification-results/learn-commusoft_connection-expected.json').write_text(json.dumps(expected,indent=2)+'\n')
 print('Package installed as non-superuser owner; prior rows/grants retained; no connection requests.',flush=True)
 assert run(prefix+release,False).returncode,'Duplicate package accepted'
 run((ROOT/'scripts/verify/learn-commusoft-setup-projection.assert.sql').read_text())
 assert snapshot()['vault']==before['vault']
 print('Actual encrypted Vault setup, key reuse, access permit and retained result passed with unchanged Vault privileges.',flush=True)
 print('Expected Commusoft connection catalog saved; duplicate installation refused.',flush=True)
finally:
 if created:subprocess.run([DOCKER,'rm','-f',NAME],capture_output=True,check=True,timeout=30)
