"""Offline original-source read checks. New isolated PostgreSQL 17; no existing database access."""
import json,subprocess,time,uuid,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DOCKER=shutil.which('docker') or '/usr/local/bin/docker'
NODE=shutil.which('node') or '/usr/local/bin/node'
NAME='serviceos-card-sources-'+uuid.uuid4().hex[:8]
IMAGE='public.ecr.aws/supabase/postgres:17.6.1.141'
T='11111111-1111-4111-8111-111111111111';OTHER='22222222-2222-4222-8222-222222222222';OWNER='33333333-3333-4333-8333-333333333333';FOREIGN='44444444-4444-4444-8444-444444444444';SOURCE='55555555-5555-4555-8555-555555555555';OTHER_SOURCE='66666666-6666-4666-8666-666666666666'
def run(sql,check=True):
 r=subprocess.run([DOCKER,'exec','-i',NAME,'psql','-h','127.0.0.1','-U','supabase_admin','-d','postgres','-At','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True)
 if check and r.returncode:raise RuntimeError(r.stderr[-2000:])
 return r
checks=[]
try:
 subprocess.run([DOCKER,'run','-d','--pull=never','--network','none','--name',NAME,'-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE],capture_output=True,check=True)
 for _ in range(100):
  if run('select 1',False).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('Disposable source database did not start')
 run("create schema if not exists auth;create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;alter role postgres nosuperuser createrole bypassrls;grant usage,create on schema public to postgres with grant option;grant execute on function auth.uid() to postgres with grant option;grant usage on schema public to authenticated,anon,service_role;")
 catalog=json.loads((ROOT/'docs/operations/evidence/learn-test-foundation-schema-2026-10-09.json').read_text())
 tables=['profiles','interactions','email_messages','phone_calls','phone_recordings']
 for t in catalog['tables']:
  if t['name'] not in tables:continue
  cols=','.join('"'+c['name']+'" '+c['type']+(' default '+c['default'] if c['default'] else '')+(' not null' if c['notNull'] else '') for c in t['columns'])
  run('create table public.'+t['name']+'('+cols+');alter table '+t['name']+' add primary key(id);alter table '+t['name']+' owner to postgres;alter table '+t['name']+' enable row level security;revoke all on '+t['name']+' from public,anon,authenticated,service_role;')
 run(f"insert into profiles(id,tenant_id,role) values('{OWNER}','{T}','owner'),('{FOREIGN}','{OTHER}','owner');")
 for tenant,source in [(T,SOURCE),(OTHER,OTHER_SOURCE)]:
  run(f"insert into email_messages(id,tenant_id,provider,provider_message_id,subject,snippet,body_text,body_html,raw_payload) values('{source}','{tenant}','gmail','synthetic-{source}','Synthetic email',repeat('😀',4500),'PRIVATE BODY','PRIVATE HTML','{{\"secret\":\"PRIVATE RAW\"}}');insert into phone_calls(id,tenant_id,provider,provider_call_id,direction,started_at,duration_seconds,outcome,from_number,to_number,cost,raw_payload) values('{source}','{tenant}','simwood','synthetic-{source}','IN','2026-10-10T00:00:00Z',120,'completed','PRIVATE FROM','PRIVATE TO',123,'{{\"secret\":\"PRIVATE RAW\"}}');insert into phone_recordings(id,tenant_id,provider,provider_recording_id,started_at,duration_seconds,storage_path,recording_uri,raw_payload) values('{source}','{tenant}','simwood','synthetic-{source}','2026-10-10T00:00:00Z',115,'PRIVATE PATH','PRIVATE URI','{{\"secret\":\"PRIVATE RAW\"}}');")
 base=(ROOT/'supabase/migrations/20261031010000_learn_card_communications.sql').read_text();run('set role postgres;'+base)
 migration=(ROOT/'supabase/migrations/20261031030000_learn_card_sources.sql').read_text()
 metadata="select jsonb_build_object('grants',(select jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'acl',a.attacl::text) order by c.relname,a.attname) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('email_messages','phone_calls','phone_recordings') and a.attnum>0),'memberships',(select jsonb_agg(jsonb_build_object('role',r.rolname,'member',u.rolname,'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option)) from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where r.rolname='learn_card_communication_reader'));"
 before=run(metadata).stdout
 for table in ['profiles','email_messages']:
  run('alter table '+table+' disable row level security;')
  failed=run('set role postgres;'+migration,False);assert failed.returncode and 'RLS required' in failed.stderr
  run('alter table '+table+' enable row level security;')
 fingerprints=' union all '.join("select '"+t+"' as name,md5(string_agg(row_to_json(s)::text,'' order by id)) from "+t+' s' for t in tables)
 source_before=run(fingerprints).stdout
 run('set role postgres;'+migration.replace('\ncommit;\n','\nrollback;\n'))
 assert run(metadata).stdout==before
 assert run("select to_regprocedure('public.learn_card_source_read(uuid,text,uuid)') is null and not exists(select 1 from pg_policies where policyname in ('learn_card_email_source_read','learn_card_call_source_read','learn_card_recording_source_read'));").stdout.strip()=='t'
 run('set role postgres;'+migration)
 checks.append('Caller-profile/source RLS prerequisites, non-superuser installation and exact rollback of reader grants, policies and RPC passed.')
 def call(table,source=SOURCE,tenant=T,actor=OWNER,role='authenticated'):
  return f"set role {role};set request.jwt.claim.sub='{actor}';select learn_card_source_read('{tenant}','{table}','{source}');"
 def response(*args,**kwargs):return json.loads(run(call(*args,**kwargs)).stdout.splitlines()[-1])
 def denied(sql,fragments=('permission denied','Company owner/admin','supported source')):
  r=run(sql,False);assert r.returncode and any(s in r.stderr for s in fragments),r.stderr[-1000:]
 responses=[]
 for table in ['email_messages','phone_calls','phone_recordings']:
  r=response(table);responses.append(r);assert r['record']['id']==SOURCE and r['record']['tenant_id']==T and 'PRIVATE' not in json.dumps(r)
  assert response(table,source=OTHER_SOURCE)['record'] is None
  denied(call(table,tenant=OTHER));denied(call(table,actor=FOREIGN));denied(call(table,role='anon'));denied(call(table,role='service_role'))
  denied('set role authenticated;select * from '+table+';')
  assert response(table,source=OTHER_SOURCE,tenant=OTHER,actor=FOREIGN)['record']['id']==OTHER_SOURCE
 assert len(responses[0]['record']['snippet'])==4021 and responses[0]['record']['snippet'].endswith('… [excerpt shortened]')
 assert set(responses[0]['record'])=={'id','tenant_id','subject','snippet','sent_at','received_at','direction'}
 assert set(responses[1]['record'])=={'id','tenant_id','provider','direction','started_at','duration_seconds','outcome'}
 assert set(responses[2]['record'])=={'id','tenant_id','provider','started_at','duration_seconds'}
 checks.append('Owner and foreign-company owner receive only their requested row; Unicode clipping and exact field allowlists passed. Raw bodies, phone numbers, storage pointers and provider payloads are absent.')
 for role in ['viewer','ops','openfolk']:
  run(f"update profiles set role='{role}' where id='{OWNER}';");denied(call('email_messages'))
 run(f"update profiles set role='admin' where id='{OWNER}';");assert response('phone_calls')['record']['duration_seconds']==120
 for table in ['profiles','email_accounts','phone_transcripts',"email_messages; select 1"]:denied(call(table))
 denied(f"set role authenticated;set request.jwt.claim.sub='{OWNER}';select learn_card_source_read('{T}','email_messages',null);")
 denied('set session authorization authenticated;set role learn_card_communication_reader;')
 for table,column in [('email_messages','body_text'),('email_messages','raw_payload'),('phone_calls','from_number'),('phone_recordings','storage_path')]:
  denied(f'set role learn_card_communication_reader;select {column} from {table};')
 assert run("select has_schema_privilege('learn_card_communication_reader','auth','USAGE') or has_schema_privilege('learn_card_communication_reader','public','CREATE');").stdout.strip()=='f'
 assert run("select count(*) from pg_auth_members where roleid='learn_card_communication_reader'::regrole and (member<>'postgres'::regrole or inherit_option or set_option);").stdout.strip()=='0'
 checks.append('Same-session demotion and unsupported references are denied; clients cannot assume the reader role; the reader cannot read excluded columns or create objects.')
 run(f"update profiles set role='owner' where id='{OWNER}';")
 assert run(fingerprints).stdout==source_before
 checks.append('All existing synthetic source/profile rows have identical fingerprints after reads and checks.')
 (ROOT/'.verification-results/learn-card-sources-responses.json').write_text(json.dumps(responses,ensure_ascii=False))
 print(json.dumps({'state':'passed','checks':checks,'limitations':['Offline recorded column types and synthetic UID/profile/source data. No hosted Auth, provider ingestion, audio playback or production acceptance.']},indent=2))
finally:subprocess.run([DOCKER,'rm','-f',NAME],capture_output=True)
