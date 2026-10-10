"""Offline role/RLS tests against recorded source columns; no existing container or live data access."""
import json,subprocess,time,uuid,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DOCKER=shutil.which('docker') or '/usr/local/bin/docker'
TARGET='serviceos-card-comms-'+uuid.uuid4().hex[:8]
IMAGE='public.ecr.aws/supabase/postgres:17.6.1.141'
def docker(*args):return subprocess.run([DOCKER,*args],capture_output=True,check=True)
def run(sql,check=True):
 r=subprocess.run([DOCKER,'exec','-i',TARGET,'psql','-h','127.0.0.1','-U','supabase_admin','-d','postgres','-At','-v','ON_ERROR_STOP=1','-f','-'],input=sql.encode(),capture_output=True)
 if check and r.returncode:raise RuntimeError(r.stderr.decode()[-2200:])
 return r
T='11111111-1111-4111-8111-111111111111';OTHER='22222222-2222-4222-8222-222222222222';OWNER='33333333-3333-4333-8333-333333333333';FOREIGN='44444444-4444-4444-8444-444444444444';COMPANY='55555555-5555-4555-8555-555555555555'
def call(args,who=OWNER,role='authenticated'):
 return f"set role {role};set request.jwt.claim.sub='{who}';select public.learn_card_communications_read({args});"
def deny(sql):
 r=run(sql,False);assert r.returncode and (b'permission denied' in r.stderr or b'Company owner/admin' in r.stderr or b'bounded communication scope' in r.stderr),r.stderr.decode()
def response(args,who=OWNER):return json.loads(run(call(args,who)).stdout.decode().splitlines()[-1])
checks=[]
try:
 docker('run','-d','--pull=never','--network','none','--name',TARGET,'-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE)
 for _ in range(100):
  try:docker('exec',TARGET,'psql','-h','127.0.0.1','-U','supabase_admin','-d','postgres','-Atc','select 1');break
  except subprocess.CalledProcessError:time.sleep(.25)
 else:raise RuntimeError('Disposable database did not start')
 existing=set(run('select rolname from pg_roles').stdout.decode().splitlines());sql=[]
 for role in ['authenticated','anon','service_role']:
  if role not in existing:sql.append(f'create role {role} nologin;')
 sql += ['create schema if not exists auth;',"create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",'alter role postgres nosuperuser createrole bypassrls;','grant usage,create on schema public to postgres with grant option;','grant usage on schema auth to postgres with grant option;','grant execute on function auth.uid() to postgres with grant option;','grant usage on schema public to authenticated,anon,service_role;']
 catalog=json.loads((ROOT/'docs/operations/evidence/learn-test-foundation-schema-2026-10-09.json').read_text())
 for t in catalog['tables']:
  if t['name'] not in ['profiles','interactions']:continue
  cols=','.join('"'+c['name']+'" '+c['type']+(' default '+c['default'] if c['default'] else '')+(' not null' if c['notNull'] else '') for c in t['columns'])
  sql += ['create table public.'+t['name']+'('+cols+');','alter table public.'+t['name']+' owner to postgres;','alter table public.'+t['name']+' enable row level security;','revoke all on public.'+t['name']+' from public,authenticated,anon,service_role;']
 sql += [f"insert into profiles(id,tenant_id,role) values('{OWNER}','{T}','owner'),('{FOREIGN}','{OTHER}','owner');",f"insert into interactions(tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,occurred_at,related_company_id,body_preview,metadata) select '{T}',case when n%3=0 then 'simwood' when n%3=1 then 'gmail' else 'slack' end,'communication','email_messages',gen_random_uuid(),'message','2026-10-10T00:00:00Z'::timestamptz+n*interval '1 second','{COMPANY}',repeat('😀',4500),jsonb_build_object('secret','not-returned') from generate_series(1,55) n;",f"insert into interactions(tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,occurred_at,related_company_id,status) values('{OTHER}','gmail','email','email_messages',gen_random_uuid(),'email',now(),'{COMPANY}','active'),('{T}','gmail','email','email_messages',gen_random_uuid(),'email',now(),'{COMPANY}','deleted');"]
 run('\n'.join(sql));fingerprint="select md5(string_agg(row_to_json(i)::text,'' order by id)) from interactions i;";before=run(fingerprint).stdout
 migration=(ROOT/'supabase/migrations/20261031010000_learn_card_communications.sql').read_text()
 run('set role postgres;'+migration.replace('\ncommit;\n','\nrollback;\n'))
 assert run("select count(*) from pg_roles where rolname='learn_card_communication_reader'").stdout.strip()==b'0'
 run('set role postgres;'+migration);checks.append('Non-superuser migration and rollback including role ownership transfer passed.')
 result=response(f"'{T}',p_company=>'{COMPANY}'");assert len(result['rows'])==51 and all(r['tenant_id']==T and r['status']!='deleted' and 'metadata' not in r and len(r['body_preview'])==4021 for r in result['rows'])
 assert result['rows'][0]['occurred_at']>result['rows'][-1]['occurred_at'];checks.append('51-row sentinel, deterministic ordering, deletion filtering, excerpts and field allowlist passed.')
 ids=[r['id'] for r in result['rows'][:2]];rows=response(f"'{T}',p_ids=>array['{ids[0]}'::uuid,'{ids[1]}'::uuid]")['rows'];assert {r['id'] for r in rows}==set(ids)
 deny(call(f"'{OTHER}',p_company=>'{COMPANY}'"));assert not response(f"'{OTHER}',p_ids=>array['{ids[0]}'::uuid]",FOREIGN)['rows']
 for role in ['viewer','ops','openfolk']:
  run(f"update profiles set role='{role}' where id='{OWNER}';");deny(call(f"'{T}',p_company=>'{COMPANY}'"))
 run(f"update profiles set role='admin' where id='{OWNER}';");assert len(response(f"'{T}',p_company=>'{COMPANY}'")['rows'])==51
 deny(call(f"'{T}',p_company=>'{COMPANY}'",role='anon'));deny(call(f"'{T}',p_company=>'{COMPANY}'",role='service_role'))
 deny("set role authenticated;select metadata from interactions;");deny("set session authorization authenticated;set role learn_card_communication_reader;")
 checks.append('Owner/admin success, viewer/ops/operator/anonymous/service denial, same-session revocation and cross-company isolation passed.')
 for args in [f"'{T}'",f"'{T}',p_ids=>array[]::uuid[]",f"'{T}',p_ids=>array_fill(gen_random_uuid(),array[51])",f"'{T}',p_ids=>array[null::uuid]",f"'{T}',p_job=>gen_random_uuid(),p_company=>'{COMPANY}'"]:deny(call(args))
 assert run(fingerprint).stdout==before
 assert run("select count(*) from pg_auth_members where roleid='learn_card_communication_reader'::regrole and (member<>'postgres'::regrole or inherit_option or set_option);").stdout.strip()==b'0'
 checks.append('Invalid/unbounded scopes denied; source rows unchanged; temporary deployer SET/INHERIT privileges removed (PostgreSQL retains creator ADMIN ownership).')
 (ROOT/'.verification-results/learn-card-communications-response.json').write_text(json.dumps(result))
 print(json.dumps({'state':'passed','checks':checks,'limitations':['Offline recorded source columns; synthetic Auth UID/profile and source fixtures, not hosted Auth or full existing policy projection.']},indent=2),flush=True)
finally:
 subprocess.run([DOCKER,'rm','-f',TARGET],capture_output=True)
