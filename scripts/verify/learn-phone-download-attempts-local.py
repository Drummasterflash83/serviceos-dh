"""Actual phone download ownership SQL in offline disposable PostgreSQL; no provider or hosted writes."""
import concurrent.futures
import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path
root=Path(__file__).resolve().parents[2]
docker=shutil.which('docker') or '/usr/local/bin/docker'
name='serviceos-phone-download-'+uuid.uuid4().hex[:8]
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
 sql(original[original.index('create table if not exists phone_transcripts ('):original.index('-- phone_sync_runs')].rsplit('-- ---------------------------------------------------------------------------',1)[0])
 selection=source('supabase/migrations/20260711120000_phone_pipeline_selection.sql')
 sql(selection[selection.index('create or replace view phone_recording_pipeline_state'):selection.index('-- phone_select_pending')].rsplit('-- ---------------------------------------------------------------------------',1)[0])
 sql(original[original.index('create table if not exists phone_sync_runs ('):original.index('alter table phone_sync_runs enable row level security;')]+ 'alter table phone_sync_runs enable row level security;')
 registry=source('supabase/migrations/20260708120000_platform_connector_config.sql')
 sql(registry[registry.index('create table if not exists tenant_connectors ('):registry.index('-- Tenant-scoped SELECT')].rsplit('-- ---------------------------------------------------------------------------',1)[0])
 capture=source('supabase/migrations/20261031230000_learn_capture_controls.sql')
 sql(capture[capture.index('create function public.learn_capture_allowed('):capture.index('-- Operator data')])
 migration=source('supabase/migrations/20261101006000_learn_phone_page_publication.sql')
 sql(migration.replace('\ncommit;','\nrollback;'))
 assert sql("select to_regclass('learn_phone_capture_pages') is null")=='t'
 sql(migration)

 sql(source('supabase/migrations/20261024100000_phone_retry_fairness.sql'))
 health=source('supabase/migrations/20261101010000_learn_phone_operator_evidence.sql')
 sql(health[health.index('create or replace function public.phone_pending_readiness'):health.index('create index learn_phone_schedule_health_lookup')])
 readiness_identity=sql("select json_build_object('owner',proowner,'acl',proacl,'body',pg_get_functiondef(oid)) from pg_proc where oid='phone_pending_readiness(uuid)'::regprocedure")
 download=source('supabase/migrations/20261101200000_learn_phone_download_attempts.sql')
 sql(download.replace('\ncommit;','\nrollback;'))
 assert sql("select to_regclass('learn_phone_processing_attempts') is null")=='t'
 assert sql("select json_build_object('owner',proowner,'acl',proacl,'body',pg_get_functiondef(oid)) from pg_proc where oid='phone_pending_readiness(uuid)'::regprocedure")==readiness_identity
 sql(download)
 sql('grant select on phone_recordings,phone_sync_runs,phone_recording_pipeline_state,phone_transcripts,phone_ai_insights to service_role;')
 print(sql(source('scripts/verify/learn-phone-download-attempts.assert.sql')),flush=True)
 # Two new calls contend on the actual recording row, never by mock ordering.
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  outputs=list(pool.map(lambda n: sql(f"set role service_role;do $$$$begin begin perform fixture_download({n},'claim');raise notice 'claimed';exception when sqlstate 'PT409' then assert SQLERRM='phone_recording_processing_held';end;end$$$$;".replace('$$$$','$$')), [20,21]))
 assert sql("select count(*) from learn_phone_processing_attempts where run_id in(fixture_id(20),fixture_id(21)) and state='running'")=='1'
 print('PASS: concurrent same-recording claims admit exactly one owner',flush=True)
finally:
 if created:subprocess.run([docker,'rm','-f',name],capture_output=True,timeout=20)
