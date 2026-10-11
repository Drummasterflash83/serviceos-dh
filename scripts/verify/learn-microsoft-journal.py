"""Actual journal migration + Graph reader outputs in a network-isolated PostgreSQL.
Dependencies are synthetic minimal tables; not a hosted/full-schema acceptance test.
"""
import concurrent.futures,json,shutil,subprocess,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DOCKER=shutil.which('docker') or '/usr/local/bin/docker'
NAME='serviceos-microsoft-journal-'+uuid.uuid4().hex[:8]
checks=[]
def sql(statement,check=True):
 r=subprocess.run([DOCKER,'exec','-i',NAME,'psql','-h','127.0.0.1','-U','postgres','-At','-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True)
 if check and r.returncode: raise RuntimeError(r.stderr[-1800:])
 return r
q=lambda s:"'"+str(s).replace("'","''")+"'"
j=lambda obj:q(json.dumps(obj,separators=(',',':')))+'::jsonb'
uid=lambda n:f'00000000-0000-4000-8000-{n:012d}'
def call(expression,role='service_role',check=True):
 return sql(f'set role {role};select {expression};',check)
def value(expression):
 return json.loads(call(expression).stdout.strip().splitlines()[-1])
def denied(expression,code,role='service_role'):
 r=call(expression,role,False); assert r.returncode and code in r.stderr,r.stderr

def opened(kind='folders',folder='',initial=None,job=10):
 init=initial or fixtures['folders'][0]['before']
 return value(f'learn_microsoft_journal_open({q(uid(1))},{q(uid(2))},{q(uid(3))},{q(uid(4))},{q(kind)},{q(folder)},{j(init)},{q(uid(job))},\'worker\',1)')
def commit(stream,fixture,request=20,revision=0,job=None,worker='worker',claim=1,tenant=1):
 if job is None: job=10 if revision==0 else 12
 return f'learn_microsoft_journal_commit({q(uid(tenant))},{q(stream)},{q(uid(request))},{revision},{j(fixture["before"])},{j(fixture["page"])},{j(fixture["after"])},{q(uid(job))},{q(worker)},{claim})'
try:
 fixtures=json.loads(subprocess.run(['node','scripts/verify/learn-microsoft-journal-fixtures.mjs'],cwd=ROOT,text=True,capture_output=True,check=True).stdout)
 subprocess.run([DOCKER,'run','-d','--pull=never','--network','none','--name',NAME,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15'],capture_output=True,check=True)
 for _ in range(80):
  if subprocess.run([DOCKER,'exec',NAME,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.1)
 else:raise RuntimeError('Disposable database did not start')
 sql('''create role anon;create role authenticated;create role service_role;
 create table tenants(id uuid primary key,status text);
 create table feature_flags(tenant_id uuid,flag text,value jsonb);
 create table email_accounts(id uuid primary key,tenant_id uuid,provider text,status text,auth_state text,unique(tenant_id,id));
 create table platform_jobs(id uuid primary key,tenant_id uuid,status text,claimed_by text,attempt_count integer,lease_expires_at timestamptz,connector_id text,module_id text,job_type text,payload jsonb);
 ''')
 control=(ROOT/'supabase/migrations/20261031230000_learn_capture_controls.sql').read_text()
 sql(control[control.index('create function public.learn_capture_allowed('):control.index('-- Operator data')])
 migration=(ROOT/'supabase/migrations/20261101180000_learn_microsoft_source_journal.sql').read_text()
 sql(migration.removesuffix('commit;\n')+'rollback;\n')
 assert sql("select to_regclass('learn_microsoft_source_pages') is null and to_regclass('learn_microsoft_capture_streams') is null and to_regclass('learn_microsoft_mailbox_bindings') is null and to_regprocedure('learn_microsoft_journal_immutable()') is null;").stdout.strip()=='t' 
 checks.append('Migration rollback removes all new journal tables')
 sql(migration)
 job_migration=(ROOT/'supabase/migrations/20261101181000_learn_microsoft_job_receipts.sql').read_text()
 sql(job_migration.removesuffix('commit;\n')+'rollback;\n')
 assert sql("select to_regclass('learn_microsoft_source_page_job_unique') is null and to_regprocedure('learn_microsoft_journal_job(uuid,uuid,text,integer)') is null;").stdout.strip()=='t'
 sql(job_migration)
 sql(f"insert into tenants values({q(uid(1))},'active');insert into email_accounts values({q(uid(2))},{q(uid(1))},'microsoft_365','active','ok');insert into learn_microsoft_mailbox_bindings(id,tenant_id,email_account_id,microsoft_tenant_id,mailbox_id,enabled) values({q(uid(4))},{q(uid(1))},{q(uid(2))},{q(uid(5))},{q(uid(3))},true);")
 for number,kind,folder in [(10,'folders',''),(11,'messages','Folder1'),(12,'folders',''),(13,'folders','')]:
  payload={'email_account_id':uid(2),'mailbox_id':uid(3),'binding_id':uid(4),'kind':kind,'folder_id':folder}
  job_type='email.microsoft_discovery' if kind=='folders' else 'email.microsoft_sync'
  sql(f"insert into platform_jobs values({q(uid(number))},{q(uid(1))},'running','worker',1,clock_timestamp()+interval '10 minutes','microsoft-365','communications.email',{q(job_type)},{j(payload)});")
 for role in ['anon','authenticated','service_role']:
  for table in ['learn_microsoft_mailbox_bindings','learn_microsoft_capture_streams','learn_microsoft_source_pages']:
   assert not sql(f"set role {role};select * from {table};",False).returncode==0
   assert not sql(f"set role {role};delete from {table};",False).returncode==0
   assert not sql(f"set role {role};truncate {table};",False).returncode==0
 checks.append('All application roles including service_role lack direct journal reads/writes/truncate')
 stream=opened(); sid=stream['streamId'];assert stream['revision']=='0'
 assert opened()==stream
 for role in ['anon','authenticated']:
  denied(commit(sid,fixtures['folders'][0]),'permission denied',role)
 first=value(commit(sid,fixtures['folders'][0])); assert first['revision']=='1'
 assert value(commit(sid,fixtures['folders'][0]))==first
 assert opened()['checkpoint']==fixtures['folders'][0]['after']
 assert opened()['revision']=='1'
 checks.append('Actual reader page and checkpoint commit together; reopen and lost-response retry retain exact receipt')
 job_receipt=f"learn_microsoft_journal_job({q(uid(1))},{q(uid(10))},'worker',1)"
 recovered=value(job_receipt)
 assert recovered['receipt']['requestId']==uid(20) and recovered['receipt']['observationsStored']==1
 for role in ['anon','authenticated']: denied(job_receipt,'permission denied',role)
 denied(job_receipt.replace("'worker'","'stale'"),'learn_microsoft_lease_invalid')
 duplicate_job=commit(sid,fixtures['folders'][1],request=25,revision=1,job=10)
 denied(duplicate_job,'learn_microsoft_source_page_job_unique')
 assert opened()['revision']=='1'
 checks.append('Per-job receipt recovers saved checkpoint; unique job fence prevents a second page on retry')
 changed=json.loads(json.dumps(fixtures['folders'][0]));changed['page']['folders'][0]['raw']['displayName']='Changed identity'
 denied(commit(sid,changed),'learn_microsoft_request_conflict')
 denied(commit(sid,fixtures['folders'][0],request=21),'learn_microsoft_checkpoint_changed')
 denied(commit(sid,fixtures['folders'][1],request=21,revision=1,tenant=99),'learn_microsoft_stream_unavailable')
 denied(commit(sid,fixtures['folders'][1],request=21,revision=1,worker='stale'),'learn_microsoft_lease_invalid')
 denied(commit(sid,fixtures['folders'][1],request=21,revision=1,claim=2),'learn_microsoft_lease_invalid')
 checks.append('Changed request, stale revision, cross-company and stale worker/claim rejected')
 for mutation,restore,expected in [
  ("update learn_microsoft_mailbox_bindings set enabled=false","update learn_microsoft_mailbox_bindings set enabled=true",'binding_ineligible'),
  ("update email_accounts set status='disabled'","update email_accounts set status='active'",'account_ineligible'),
  ("update email_accounts set provider='gmail'","update email_accounts set provider='microsoft_365'",'account_ineligible'),
  ("update email_accounts set auth_state='revoked'","update email_accounts set auth_state='ok'",'account_ineligible'),
  ("insert into feature_flags select id,'learn.inputs.email.enabled','false'::jsonb from tenants","delete from feature_flags",'capture_paused'),
  ("update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second'","update platform_jobs set lease_expires_at=clock_timestamp()+interval '10 minutes'",'lease_invalid'),
  ("update platform_jobs set payload=payload||'{\"mailbox_id\":\"foreign\"}'",f"update platform_jobs set payload=payload||jsonb_build_object('mailbox_id',{q(uid(3))})",'job_identity_invalid'),
 ]:
  sql(mutation+';');denied(commit(sid,fixtures['folders'][1],request=21,revision=1),'learn_microsoft_'+expected)
  assert value(commit(sid,fixtures['folders'][0]))==first # safe receipt recovery only
  sql(restore+';')
 checks.append('Paused capture, revoked account/binding, wrong provider/job and expired lease block advancement; old exact receipts recover')
 bad=json.loads(json.dumps(fixtures['folders'][1]));bad['after']['scope']['accountId']=uid(99)
 denied(commit(sid,bad,request=21,revision=1),'learn_microsoft_page_invalid')
 bad=json.loads(json.dumps(fixtures['folders'][1]));bad['after']['visitedRequests']=[]
 denied(commit(sid,bad,request=21,revision=1),'learn_microsoft_page_invalid')
 assert opened()['revision']=='1'
 # Fail AFTER insertion but BEFORE checkpoint completion: no orphan page survives.
 sql("create function fail_checkpoint() returns trigger language plpgsql as $$begin raise exception 'synthetic_checkpoint_failure';end $$;create trigger synthetic_failure before update on learn_microsoft_capture_streams for each row execute function fail_checkpoint();")
 denied(commit(sid,fixtures['folders'][1],request=21,revision=1),'synthetic_checkpoint_failure')
 assert sql(f"select count(*) from learn_microsoft_source_pages where id={q(uid(21))};").stdout.strip()=='0'
 sql('drop trigger synthetic_failure on learn_microsoft_capture_streams;drop function fail_checkpoint();')
 checks.append('Invalid scope/continuation rejected; checkpoint failure rolls back source-page insertion')
 # Let a valid lease expire while the checkpoint update holds its transaction.
 sql(f"update platform_jobs set lease_expires_at=clock_timestamp()+interval '1 second' where id={q(uid(12))};create function slow_checkpoint() returns trigger language plpgsql as $$begin perform pg_sleep(1.2);return new;end $$;create trigger synthetic_slow before update on learn_microsoft_capture_streams for each row execute function slow_checkpoint();")
 denied(commit(sid,fixtures['folders'][1],request=21,revision=1),'learn_microsoft_lease_invalid')
 assert sql(f"select count(*) from learn_microsoft_source_pages where id={q(uid(21))};").stdout.strip()=='0'
 sql("drop trigger synthetic_slow on learn_microsoft_capture_streams;drop function slow_checkpoint();update platform_jobs set lease_expires_at=clock_timestamp()+interval '10 minutes';")
 checks.append('Lease expiry during transaction rolls back both page and checkpoint')
 # Competing queue jobs request different commits from the same prior revision.
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  first_race=pool.submit(sql,"begin;set application_name='microsoft-journal-first';set role service_role;select "+commit(sid,fixtures['folders'][1],request=21,revision=1,job=12)+";select pg_sleep(2);commit;",False)
  for _ in range(100):
   if sql("select count(*) from pg_stat_activity where application_name='microsoft-journal-first' and wait_event='PgSleep';").stdout.strip()=='1':break
   time.sleep(.01)
  else:raise RuntimeError('First writer did not hold its checkpoint lock')
  second_race=pool.submit(sql,"set application_name='microsoft-journal-second';set role service_role;select "+commit(sid,fixtures['folders'][1],request=22,revision=1,job=13)+";",False)
  for _ in range(100):
   if sql("select count(*) from pg_stat_activity where application_name='microsoft-journal-second' and wait_event_type='Lock';").stdout.strip()=='1':break
   time.sleep(.01)
  else:raise RuntimeError('Second writer was not observed waiting on the checkpoint lock')
  results=[first_race.result(),second_race.result()]
 assert sum(r.returncode==0 for r in results)==1,[r.stderr for r in results]
 assert sql(f"select count(*) from learn_microsoft_source_pages where stream_id={q(sid)};").stdout.strip()=='2'
 assert opened()['revision']=='2'
 checks.append('Two real sessions with distinct live jobs and observed lock contention advance one shared revision exactly once')
 # Message stream uses the same storage protocol without merging sparse/removal events.
 mail=opened('messages','Folder1',fixtures['messages']['before'],11);msid=mail['streamId']
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  duplicate=list(pool.map(lambda _:value(commit(msid,fixtures['messages'],request=30,job=11)),range(2)))
 assert duplicate[0]==duplicate[1]
 stored=json.loads(sql(f"select source_page from learn_microsoft_source_pages where id={q(uid(30))};").stdout)
 assert stored==fixtures['messages']['page'] and len(stored['events'])==3
 assert sql(f"select count(*) from learn_microsoft_source_pages where stream_id={q(msid)};").stdout.strip()=='1'
 for statement in ["update learn_microsoft_source_pages set source_page='{}'",'delete from learn_microsoft_source_pages','truncate learn_microsoft_source_pages',"update learn_microsoft_mailbox_bindings set mailbox_id=gen_random_uuid()"]:
  assert sql(statement+';',False).returncode!=0
 checks.append('Concurrent exact message submission shares receipt; sparse/removal/raw events and binding identity remain immutable')
 subprocess.run(['node','scripts/verify/learn-microsoft-capture-engine-cases.mjs',NAME],cwd=ROOT,check=True)
 subprocess.run(['node','scripts/verify/learn-microsoft-capture-job-cases.mjs',NAME],cwd=ROOT,check=True)
 subprocess.run(['node','scripts/verify/learn-microsoft-incremental-cases.mjs',NAME],cwd=ROOT,check=True)
 print(json.dumps({'state':'passed','checks':checks,'limitations':['Network-isolated PostgreSQL 15 with synthetic account/job dependencies; actual migration and actual reader-generated pages.','No hosted/full-schema/Auth/provider acceptance; live worker registration, credential provisioning, projection and schedule activation remain pending.']},indent=2))
finally:
 subprocess.run([DOCKER,'rm','-f',NAME],capture_output=True)
