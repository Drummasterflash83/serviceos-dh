"""Actual phone publication SQL in offline disposable PostgreSQL; no provider or hosted writes."""
import concurrent.futures
import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path
root=Path(__file__).resolve().parents[2]
docker=shutil.which('docker') or '/usr/local/bin/docker'
name='serviceos-phone-publication-'+uuid.uuid4().hex[:8]
created=False
command=[docker,'exec','-i',name,'psql','-h','127.0.0.1','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1']
def sql(s):
 r=subprocess.run(command,input=s,text=True,capture_output=True,timeout=30)
 if r.returncode: raise RuntimeError(r.stderr[-3000:])
 return r.stdout.strip()
def source(p):return(root/p).read_text()
try:
 subprocess.run([docker,'run','-d','--pull=never','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15'],capture_output=True,check=True,timeout=30);created=True
 for _ in range(60):
  if subprocess.run([docker,'exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('Offline database unavailable')
 sql(source('scripts/verify/learn-phone-publication.fixture.sql'))
 original=source('supabase/migrations/20260701120000_phone_input_foundation.sql')
 sql(original[original.index('create table if not exists phone_calls ('):original.index('-- phone_transcripts')].rsplit('-- ---------------------------------------------------------------------------',1)[0])
 sql(original[original.index('create table if not exists phone_sync_runs ('):original.index('alter table phone_sync_runs enable row level security;')]+ 'alter table phone_sync_runs enable row level security;')
 registry=source('supabase/migrations/20260708120000_platform_connector_config.sql')
 sql(registry[registry.index('create table if not exists tenant_connectors ('):registry.index('-- Tenant-scoped SELECT')].rsplit('-- ---------------------------------------------------------------------------',1)[0])
 capture=source('supabase/migrations/20261031230000_learn_capture_controls.sql')
 sql(capture[capture.index('create function public.learn_capture_allowed('):capture.index('-- Operator data')])
 migration=source('supabase/migrations/20261101006000_learn_phone_page_publication.sql')
 sql(migration.replace('\ncommit;','\nrollback;'))
 assert sql("select to_regclass('learn_phone_capture_pages') is null")=='t'
 sql(migration)
 print(sql(source('scripts/verify/learn-phone-publication.assert.sql')),flush=True)
 def run_concurrent(held,attempt,check):
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   writer=pool.submit(sql,held)
   for _ in range(80):
    if sql("select count(*) from pg_stat_activity where application_name='phone-publisher-fixture' and wait_event='PgSleep'")=='1':break
    time.sleep(.025)
   else:raise RuntimeError('Held transaction not observed')
   result=sql(attempt);writer.result();assert check(result),result
 # A direct switch insertion/update must fence just like the controller RPC.
 run_concurrent("set application_name='phone-publisher-fixture';begin;update feature_flags set value='false';select pg_sleep(1);commit;",
  "set role service_role;do $$begin begin perform fixture_page(14,'calls',1,'after-pause');raise exception 'Stale pause admitted';exception when sqlstate 'PT409' then assert SQLERRM='learn_capture_paused';end;end$$;select 'denied';",lambda r:r=='denied')
 sql("update feature_flags set value='true';")
 # A page already publishing commits first; then the pause can commit.
 run_concurrent("set application_name='phone-publisher-fixture';begin;set local role service_role;select fixture_page(15,'calls',1,'before-pause');select pg_sleep(1);commit;",
  "update feature_flags set value='false';select count(*) from phone_calls where provider_call_id='before-pause';",lambda r:r=='1')
 sql("update feature_flags set value='true';")
 # Native row locking rechecks the changed registry after waiting.
 run_concurrent("set application_name='phone-publisher-fixture';begin;update connector_accounts set status='disabled';select pg_sleep(1);commit;",
  "set role service_role;do $$begin begin perform fixture_page(16,'calls',1,'after-disable');raise exception 'Stale account admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_account_unavailable';end;end$$;select 'denied';",lambda r:r=='denied')
 sql("update connector_accounts set status='active';")
 # Two genuinely concurrent new-recording upserts yield exactly one new ID.
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  results=list(pool.map(lambda run:sql(f"set role service_role;select jsonb_array_length(fixture_page({run},'recordings',1,'concurrent')->'newRecordingIds');"),[21,22]))
 assert sorted(results)==['0','1'],results
 assert sql("select count(*) from phone_recordings where provider_recording_id='concurrent'")=='1'
 print('PASS: real concurrent pause-first, publication-first, account-disable and one-new-recording ordering',flush=True)
 report={'observedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'state':'passed','scope':'Actual SQL and original source/registry tables in networkless PostgreSQL 15 with synthetic rows.','checks':['migration rollback','exact replay and conflicting definitions','tenant/run/page validation','recording storage retention and new-recording classification','pause/account denial','atomic rollback on receipt failure','page bounds and browser/service privileges','immutable receipts','concurrent pause-first and publication-first','concurrent account disable','concurrent insertion returns exactly one new recording ID'],'limits':['No hosted deployment, real provider, application UI or complete source-pipeline acceptance.','Existing controller uses the same lock; its full authorization RPC is separately tested, not loaded in this fixture.']}
 (root/'.verification-results/phone-publication-local.json').write_text(json.dumps(report,indent=2)+'\n')
finally:
 if created:subprocess.run([docker,'rm','-f',name],capture_output=True,timeout=30)
