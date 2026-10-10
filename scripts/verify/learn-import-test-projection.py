"""Exercise the exact import release against current TEST schema metadata.

No connection to a hosted DB or any existing container. Eleven relevant tables (twelve with --cards),
all their recorded constraints/indexes/policies/triggers and actual referenced
helpers are restored in a new network-isolated PG17 container. auth.users/uid are
explicit fixture stand-ins; Auth, Edge, marketing eligibility and UI acceptance
are outside this test. Historical suite's eligibility assertions are excluded,
not replaced by mock success functions.
"""
import hashlib,json,re,shutil,subprocess,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DOCKER=shutil.which('docker') or '/usr/local/bin/docker'
NODE=shutil.which('node') or '/usr/local/bin/node'
NAME='serviceos-import-test-'+uuid.uuid4().hex[:8]
IMAGE='public.ecr.aws/supabase/postgres:17.6.1.141'
DB='postgres'
if len(sys.argv) not in (2,3) or (len(sys.argv)==3 and sys.argv[2] not in ('--authority','--cards')):raise SystemExit('Provide a verified release-021 schema-only catalog and optional --authority or --cards')
catalog=json.loads(Path(sys.argv[1]).read_text())
assert catalog['projectRef']=='saatxzwxvdvqevbnskxy' and len(catalog['tables'])==91 and len(catalog['readiness']['customMigrationEntries'])==22
names=['tenants','profiles','view_as_context','people','companies','sites','jobs','data_imports','import_profiles','import_row_provenance','job_number_aliases']
if '--cards' in sys.argv:names.append('customer_cards')
tables=[t for t in catalog['tables'] if t['name'] in names]
assert len(tables)==len(names)
service_grants=None
if '--cards' in sys.argv:
 grant_snapshot=json.loads((ROOT/'docs/operations/evidence/learn-import-projection-grants-2026-10-10.json').read_text())
 assert grant_snapshot['projectRef']==catalog['projectRef'] and grant_snapshot['verifiedRelease']=='023+import-endpoint-v1'
 service_grants={g['name']:g['privileges'] for g in grant_snapshot['grants']}
 assert set(service_grants)==set(names)
 for t in tables:
  assert set(service_grants[t['name']])=={'SELECT','INSERT','UPDATE','DELETE'}
  assert all(type(v) is bool for v in service_grants[t['name']].values())
  assert all(service_grants[t['name']].values())==t['serviceDml']

q=lambda s:"'"+str(s).replace("'","''")+"'"
i=lambda s:'"'+s.replace('"','""')+'"'
release=(ROOT/'supabase/release/learn-test/022_governed_imports.sql').read_text()
manifest=json.loads((ROOT/'supabase/release/learn-test/022_governed_imports.manifest.json').read_text())
sha=hashlib.sha256(release.encode()).hexdigest();assert sha==manifest['sha256']
def run(sql,check=True):
 r=subprocess.run([DOCKER,'exec','-i',NAME,'psql','-h','127.0.0.1','-U','supabase_admin','-d',DB,'-At','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True)
 if check and r.returncode:raise RuntimeError(r.stderr[-2800:])
 return r
def apply(sql,label):run(sql);print(label+': PASS',flush=True)
def node(code):return subprocess.run([NODE,'--input-type=module','-e',code],cwd=ROOT,capture_output=True,check=True).stdout.decode()
catalog_query=node("import {FOUNDATION_CATALOG_QUERY} from './scripts/verify/learn-foundation-catalog.mjs';process.stdout.write(FOUNDATION_CATALOG_QUERY);")
import_queries=json.loads(node("import {IMPORT_FUNCTION_QUERY,IMPORT_PROFILE_QUERY} from './scripts/verify/learn-governed-import-catalog.mjs';console.log(JSON.stringify([IMPORT_FUNCTION_QUERY,IMPORT_PROFILE_QUERY]));"))
prefix="set role postgres;set serviceos.release_target='saatxzwxvdvqevbnskxy';set serviceos.release_source_sha256="+q(sha)+';'
def snapshot():return json.loads(run(catalog_query).stdout)['tables']
def retained():return {n:run('select coalesce(jsonb_agg(to_jsonb(t) order by id),\'[]\') from public.'+i(n)+' t').stdout for n in names}
try:
 subprocess.run([DOCKER,'run','-d','--pull=never','--network','none','--name',NAME,'-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE],capture_output=True,check=True)
 for _ in range(100):
  if run('select 1',False).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('Disposable import database did not start')
 run('create database learn_import_test template template0;')
 DB='learn_import_test'
 existing_roles=set(run('select rolname from pg_roles').stdout.splitlines())
 for role in sorted({r for t in tables for p in t['policies'] for r in p['roles']}-existing_roles-{'public'}):
  run('create role '+i(role)+' nologin;')
 sql=["create schema auth;create table auth.users(id uuid primary key,email text,is_sso_user boolean,is_anonymous boolean);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
 "alter role postgres nosuperuser createrole bypassrls;grant usage,create on schema public to postgres with grant option;grant usage on schema public,auth to postgres,authenticated,anon,service_role;grant references on auth.users to postgres;"]
 for t in tables:
  cols=','.join(i(c['name'])+' '+c['type']+(' default '+c['default'] if c['default'] else '')+(' not null' if c['notNull'] else '') for c in t['columns'])
  sql+=['create table public.'+i(t['name'])+'('+cols+');alter table public.'+i(t['name'])+' owner to postgres;']
 for t in tables:
  for k in t['constraints']:
   if k['kind']!='f':sql+=['alter table '+i(t['name'])+' add constraint '+i(k['name'])+' '+k['definition']+';']
  backing={k['name'] for k in t['constraints'] if k['kind'] in ['p','u','x']}
  sql += [x['definition']+';' for x in t['indexes'] if x['name'] not in backing]
 for t in tables:sql += ['alter table '+i(t['name'])+' add constraint '+i(k['name'])+' '+k['definition']+';' for k in t['constraints'] if k['kind']=='f']
 helpers=catalog['helpers']+[dict(catalog['foundationGuard'],name='learn_foundation_reference_guard')]+[f for f in catalog['actionFunctions'] if f['name'] in ['learn_work_authority_input_lock','learn_work_registry_input_lock']]
 for f in helpers:sql += [f['definition']+';alter function public.'+i(f['name'])+'() owner to postgres;']
 for t in tables:
  if t['rls']:sql+=['alter table '+i(t['name'])+' enable row level security;']
  if t['forceRls']:sql+=['alter table '+i(t['name'])+' force row level security;']
  if t['authenticatedSelect']:sql+=['grant select on '+i(t['name'])+' to authenticated;']
  if service_grants:
   sql += ['grant '+priv+' on '+i(t['name'])+' to service_role;' for priv,enabled in service_grants[t['name']].items() if enabled]
  elif t['serviceDml']:sql+=['grant select,insert,update,delete on '+i(t['name'])+' to service_role;']
  for p in t['policies']:sql+=['create policy '+i(p['name'])+' on '+i(t['name'])+' as '+p['permissive']+' for '+p['command']+' to '+','.join(i(r) for r in p['roles'])+(' using('+p['using']+')' if p['using'] else '')+(' with check('+p['check']+')' if p['check'] else '')+';']
  for tr in t['triggers']:
   assert tr['function'] in [f['name'] for f in helpers],tr['function']
   sql += [tr['definition']+';']
 sql += ['create schema of_test_deploy authorization postgres;create table of_test_deploy.migrations(source_sha256 text,migration_name text primary key,project_ref text,applied_at timestamptz);alter table of_test_deploy.migrations owner to postgres;']
 for e in catalog['readiness']['customMigrationEntries']:sql+=['insert into of_test_deploy.migrations values('+','.join(q(e[k]) for k in ['source_sha256','migration_name','project_ref','applied_at'])+');']
 apply('\n'.join(sql),'Current TEST import-related table definitions and guards')
 apply("insert into tenants(id,slug,display_name) values('99000000-0000-0000-0000-000000000001','retained-import-test','Retained synthetic company');insert into people(id,tenant_id,display_name,primary_email,verified,created_source) values('99000000-0000-0000-0000-000000000002','99000000-0000-0000-0000-000000000001','Retained synthetic person','retained@example.invalid',true,'interaction');",'Retained pre-release canonical fixture')
 before=snapshot();before_rows=retained()
 apply(prefix+release.replace('\ncommit;\n','\nrollback;\n'),'Exact release rollback rehearsal')
 assert snapshot()==before and retained()==before_rows
 apply("alter table of_test_deploy.migrations add constraint fail_receipt check(migration_name<>'learn_governed_imports_v1');",'Inject receipt failure')
 failed=run(prefix+release,False);assert failed.returncode and 'fail_receipt' in failed.stderr
 assert snapshot()==before and retained()==before_rows
 apply('alter table of_test_deploy.migrations drop constraint fail_receipt;','Failed receipt restores all definitions and rows')
 apply(prefix+release,'Exact import release as non-superuser deployment owner')
 after=snapshot();old_after=[t for t in after if t['name'] in names]
 for t in old_after:t['indexes']=[x for x in t['indexes'] if x['name'] not in manifest['existingTableIndexes']]
 assert before==old_after
 after_rows=retained();assert all(before_rows[n]==after_rows[n] for n in names if n!='import_profiles')
 assert run("select count(*)=3 from import_profiles where definition->'governed'='true'::jsonb").stdout.strip()=='t'
 duplicate=run(prefix+release,False);assert duplicate.returncode
 # The historical fixture expects an Auth signup trigger. Here insert profiles
 # explicitly, without a fake trigger or changes to production code.
 regression=(ROOT/'supabase/tests/commusoft_import.test.sql').read_text()
 marker="update profiles set role='owner',"
 pos=regression.index(marker)
 regression=regression[:pos]+"insert into profiles(id,email) select u.id,u.email from auth.users u where not exists(select 1 from profiles p where p.id=u.id);\n"+regression[pos:]
 eligibility="  assert marketing_endpoint_eligibility('aaaa0000-0000-0000-0000-0000000000a1', v_pid, 'email') = 'unknown',\n    '2b: imported endpoint must resolve to the safe unknown state';"
 assert regression.count(eligibility)==1;regression=regression.replace(eligibility,'-- Eligibility resolver is not installed in this TEST foundation; not asserted here.')
 start=regression.index('-- ── (9) MARKETING SAFETY');end=regression.index('-- ── (10) RLS + privilege boundaries')
 regression=regression[:start]+regression[end:]
 assert regression.rstrip().endswith('rollback;')
 regression=regression.rstrip()[:-len('rollback;')]+(ROOT/'scripts/verify/learn-import-recovery.assert.sql').read_text()+'\n'+(ROOT/'scripts/verify/learn-import-test-projection.assert.sql').read_text()+'\nrollback;'
 apply(regression,'Historical import assertions (excluding marketing eligibility), exact-site and endpoint boundaries')
 assert retained()==after_rows
 functions=json.loads(run(import_queries[0]).stdout)
 assert len(functions)==25 and all(f['owner']=='postgres' and not f['authenticatedExecute'] and not f['anonExecute'] and f['serviceExecute'] for f in functions)
 expected={'sourceSha256':sha,'tables':[t for t in snapshot() if t['name'] in manifest['tables']],
  'indexes':[dict(x,table=t['name']) for t in snapshot() for x in t['indexes'] if x['name'] in manifest['existingTableIndexes']],
  'functions':functions,'profiles':json.loads(run(import_queries[1]).stdout)}
 (ROOT/'.verification-results/learn-import-expected.json').write_text(json.dumps(expected,indent=2)+'\n')
 if '--authority' in sys.argv or '--cards' in sys.argv:
  authority=(ROOT/'supabase/release/learn-test/023_import_authority.sql').read_text()
  authority_prefix="set role postgres;set serviceos.release_target='saatxzwxvdvqevbnskxy';set serviceos.release_source_sha256="+q(hashlib.sha256(authority.encode()).hexdigest())+';'
  old_function=run("select pg_get_functiondef('public.import_row_preamble(uuid,uuid,uuid,integer,jsonb,jsonb,text)'::regprocedure)").stdout
  tables_before=snapshot();rows_before=retained()
  apply(authority_prefix+authority.replace('\ncommit;\n','\nrollback;\n'),'Row authority rollback rehearsal')
  assert old_function==run("select pg_get_functiondef('public.import_row_preamble(uuid,uuid,uuid,integer,jsonb,jsonb,text)'::regprocedure)").stdout
  assert snapshot()==tables_before and retained()==rows_before
  run("alter table of_test_deploy.migrations add constraint fail_authority_receipt check(migration_name<>'learn_import_actor_authority_v1');")
  failed=run(authority_prefix+authority,False);assert failed.returncode and 'fail_authority_receipt' in failed.stderr
  assert old_function==run("select pg_get_functiondef('public.import_row_preamble(uuid,uuid,uuid,integer,jsonb,jsonb,text)'::regprocedure)").stdout
  assert snapshot()==tables_before and retained()==rows_before
  run('alter table of_test_deploy.migrations drop constraint fail_authority_receipt;')
  apply(authority_prefix+authority,'Atomic row authority checks installed locally')
  assert snapshot()==tables_before and retained()==rows_before
  authority_functions=json.loads(run(import_queries[0]).stdout)
  authority_expected=[f for f in authority_functions if f['name']=='import_row_preamble']
  assert len(authority_expected)==1 and authority_expected[0]['serviceExecute'] and not authority_expected[0]['authenticatedExecute'] and not authority_expected[0]['anonExecute']
  assert [f for f in authority_functions if f['name']!='import_row_preamble']==[f for f in functions if f['name']!='import_row_preamble']
  (ROOT/'.verification-results/learn-import-authority-expected.json').write_text(json.dumps(authority_expected,indent=2)+'\n')
  apply((ROOT/'scripts/verify/learn-import-authority.assert.sql').read_text(),'Active/ended/expired preview, suspension, demotion and stale snapshots')
  # A live row transaction holds the same locks as authority-edit triggers.
  hold="set application_name='learn-import-authority-hold';begin;select import_row_preamble('88000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-000000000021','88000000-0000-0000-0000-000000000011',4,'{}','{\"source\":\"commusoft\"}','customers');select pg_sleep(3);commit;"
  holder=subprocess.Popen([DOCKER,'exec','-i',NAME,'psql','-h','127.0.0.1','-U','supabase_admin','-d',DB,'-At','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  holder.stdin.write(hold);holder.stdin.close()
  try:
   for _ in range(50):
    if run("select exists(select 1 from pg_stat_activity where application_name='learn-import-authority-hold' and wait_event='PgSleep')").stdout.strip()=='t':break
    time.sleep(.05)
   else:raise RuntimeError('Authority row transaction was not observed live')
   for update in ["update profiles set role='viewer' where id='88000000-0000-0000-0000-000000000011'", "update tenants set status='suspended' where id='88000000-0000-0000-0000-000000000001'", "update view_as_context set expires_at=clock_timestamp()+interval '1 hour' where actor_user_id='88000000-0000-0000-0000-000000000011'"]:
    run("do $$ declare denied boolean:=false;begin begin "+update+";exception when sqlstate 'PT409' then denied:=true;end;assert denied,'authority edit must conflict with a live import row';end $$;")
   holder.wait(timeout=10);assert holder.returncode==0
  finally:
   if holder.poll() is None:holder.terminate();holder.wait(timeout=10)
   holder.stdout.close();holder.stderr.close()
  print('Concurrent role, company and View As changes cannot race a live row: PASS',flush=True)
 if '--cards' in sys.argv:
  cards=(ROOT/'supabase/migrations/20261031070000_learn_import_customer_cards.sql').read_text()
  apply("insert into import_entity_links(id,tenant_id,source_system,entity_kind,external_id,entity_table,entity_id,link_strategy) values('99000000-0000-0000-0000-000000000003','99000000-0000-0000-0000-000000000001','commusoft','customer','retained-before-card-projection','people','99000000-0000-0000-0000-000000000002','email');",'Pre-existing imported identity without a card')
  apply("insert into customer_cards(id,tenant_id,person_id) values('99000000-0000-0000-0000-000000000004','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000002'),('99000000-0000-0000-0000-000000000005','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000002');",'Synthetic duplicate legacy cards')
  duplicate_tables=snapshot();duplicate_rows=retained()
  duplicate=run('set role postgres;'+cards,False);assert duplicate.returncode and 'learn_customer_card_person_uk' in duplicate.stderr
  assert snapshot()==duplicate_tables and retained()==duplicate_rows,'duplicate preflight must preserve history'
  run("delete from customer_cards where id in ('99000000-0000-0000-0000-000000000004','99000000-0000-0000-0000-000000000005');")
  print('Duplicate legacy card identities refuse migration without modifying rows: PASS',flush=True)
  cards_tables=snapshot();cards_rows=retained()
  apply('set role postgres;'+cards.replace('\ncommit;','\nrollback;'),'Customer card projection rollback')
  assert snapshot()==cards_tables and retained()==cards_rows
  apply('set role postgres;'+cards,'Customer card projection installed as non-superuser owner')
  assert retained()==cards_rows,'migration cannot backfill or change existing source rows'
  apply((ROOT/'scripts/verify/learn-import-cards.assert.sql').read_text(),'Imported customer projection, protected cards, bounded repair and tenant boundaries')
  apply(regression,'Historical governed row suite with card projection enabled')
  hold="set role service_role;set application_name='learn-import-card-hold';begin;select learn_import_customer_card('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000003');select pg_sleep(3);commit;"
  holder=subprocess.Popen([DOCKER,'exec','-i',NAME,'psql','-h','127.0.0.1','-U','supabase_admin','-d',DB,'-At','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  holder.stdin.write(hold);holder.stdin.close()
  try:
   for _ in range(60):
    if run("select exists(select 1 from pg_stat_activity where application_name='learn-import-card-hold' and wait_event='PgSleep')").stdout.strip()=='t':break
    time.sleep(.05)
   else:raise RuntimeError('Card projection transaction was not observed live')
   second=run("set role service_role;select learn_import_customer_card('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000003');").stdout
   holder.wait(timeout=10);assert holder.returncode==0,holder.stderr.read()
   first=holder.stdout.read()
   assert re.findall(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',first)==re.findall(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',second)
   assert run("select count(*)=1 from customer_cards where person_id='99000000-0000-0000-0000-000000000002'").stdout.strip()=='t'
  finally:
   if holder.poll() is None:holder.terminate();holder.wait(timeout=10)
   holder.stdout.close();holder.stderr.close()
  print('Concurrent service projections reuse one card identity: PASS',flush=True)

 print(json.dumps({'state':'passed','sourceSha256':sha,'restoredTables':len(tables),'importFunctions':len(manifest['functions']),'addedTables':manifest['tables'],'historicalMarketingEligibilityTested':False,'hostedWrite':False,'limitations':['Auth is a fixture stand-in; actual signed-in Edge/UI acceptance remains.','Only import-related TEST tables and their actual guards restored; not the whole TEST application.','Hosted rollback, exact catalog comparison and source/row preservation remain release gates.']},indent=2))
finally:subprocess.run([DOCKER,'rm','-f',NAME],capture_output=True)
