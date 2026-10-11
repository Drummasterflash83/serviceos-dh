"""Guarded retained-source interaction publication in offline disposable PostgreSQL; no provider or hosted writes."""
import concurrent.futures
import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path
root=Path(__file__).resolve().parents[2]
docker=shutil.which('docker') or '/usr/local/bin/docker'
name='serviceos-interaction-projection-'+uuid.uuid4().hex[:8]
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
 hardening=source('supabase/migrations/20260702130000_security2_feed_rls.sql')
 sql(hardening[hardening.index('alter table phone_ai_insights add column'):hardening.index('-- Tenant-scoped SELECT')].rsplit('-- ---------------------------------------------------------------------------',1)[0])
 sql('create table graph_nodes(id uuid primary key,tenant_id uuid);')
 pi=source('supabase/migrations/20260805120000_phone_intelligence_v1.sql')
 sql('create function public.current_tenant_id() returns uuid language sql as $$select null::uuid$$;')
 sql(pi)
 sql(source('supabase/migrations/20260807120000_telephony_directory_endpoints.sql'))
 derived=source('supabase/migrations/20261101210000_learn_phone_derived_versions.sql')
 sql(derived.replace('\ncommit;','\nrollback;'))
 assert sql("select to_regclass('learn_phone_result_versions') is null")=='t'
 assert sql("select count(*) from information_schema.columns where table_name='phone_transcripts' and column_name='source_storage_path'")=='0'
 sql(derived)

 sql('alter table tenants add column slug text,add column display_name text,add column metadata jsonb;')
 sql(source('supabase/migrations/20260708140000_interactions.sql'))
 for file in ['20260709150000_platform_events.sql','20260713120000_phone_projection_incremental.sql','20260714120000_input_reliability_finalisation.sql']:
  sql(source('supabase/migrations/'+file))
 candidate=source('supabase/migrations/20261101290000_learn_phone_atomic_handoff.sql')
 prior_version_config=sql("select proconfig::text from pg_proc where oid='phone_projection_version(uuid,uuid)'::regprocedure")
 sql(candidate.replace('\ncommit;','\nrollback;'))
 assert sql("select proconfig::text from pg_proc where oid='phone_projection_version(uuid,uuid)'::regprocedure")==prior_version_config
 assert sql("select to_regclass('learn_phone_handoff_receipts') is null")=='t'
 sql(candidate)
 sql(source('supabase/migrations/20260702140000_email_input_foundation.sql'))
 candidate=source('supabase/migrations/20261101310000_learn_interaction_projection.sql')
 sql(candidate.replace('\ncommit;','\nrollback;'))
 assert sql("select to_regclass('learn_interaction_projection_receipts') is null")=='t'
 sql(candidate)
 sql('begin;'+source('scripts/verify/learn-interaction-projection.assert.sql')+'commit;')
 print('PASS: guarded Phone/Email projection, authoritative handoff delegation, incremental repair, review holds, exact replay and failure rollback',flush=True)
 for f in ['20260709120000_customer_cards_foundation.sql','20260709140000_identity_engine.sql']:
  sql(source('supabase/migrations/'+f))
 unique=source('supabase/migrations/20261031070000_learn_import_customer_cards.sql')
 sql(unique[:unique.index('create function learn_import_customer_card')]+'commit;')
 sql(source('supabase/migrations/20261101300000_learn_identity_delivery.sql'))
 subprocess.run(['node','scripts/verify/learn-interaction-projection-client-probe.mjs',name],cwd=root,check=True,timeout=60)
 def iid(n):return 'ac68d905-cccc-4000-8000-'+str(n).zfill(12)
 sql(f"insert into tenants(id) values('{iid(4)}');")
 def seed(n):
  sql(f"insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,to_emails,cc_emails,snippet,direction,received_at) values('{iid(n)}','{iid(4)}','gmail','concurrent-{n}','customer@example.invalid','[]','[]','Synthetic concurrent preview','inbound','2026-10-11T14:00:00Z');")
 def rev(n):return sql(f"select learn_projection_revision(learn_email_source_fields(m),'') from email_messages m where id='{iid(n)}'")
 def publish(n,r,v):return sql(f"set role service_role;select learn_project_interaction('{iid(4)}','{iid(r)}','email','{iid(n)}','{v}','publish');")
 seed(400);v=rev(400)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  outcomes=list(pool.map(lambda _:publish(400,1400,v),[1,2]))
 assert outcomes[0]==outcomes[1]
 seed(401);v=rev(401)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  outcomes=list(pool.map(lambda r:json.loads(publish(401,r,v)),[1401,1402]))
 assert sorted(x['action'] for x in outcomes)==['created','unchanged']
 assert sql(f"select count(*) from interactions where tenant_id='{iid(4)}'")=='2'
 assert sql(f"select count(*) from platform_events where tenant_id='{iid(4)}' and status='pending'")=='2'
 print('PASS: overlapping identical and distinct requests create one canonical interaction and pending event per retained source',flush=True)
 seed(402);old=rev(402)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  writer=pool.submit(sql,f"begin;update email_messages set snippet='Concurrent source change' where id='{iid(402)}';select pg_advisory_xact_lock(19683073);select pg_sleep(1);commit;")
  for _ in range(50):
   if sql("select exists(select 1 from pg_locks where locktype='advisory' and objid=19683073 and granted)")=='t':break
   time.sleep(.02)
  else:raise RuntimeError('Concurrent writer was not observed')
  try:publish(402,1403,old)
  except RuntimeError as e:assert 'projection_source_changed' in str(e)
  else:raise AssertionError('Stale concurrent source accepted')
  writer.result()
 assert sql(f"select count(*) from interactions where source_id='{iid(402)}'")=='0'
 assert sql(f"select count(*) from learn_interaction_projection_receipts where request_id='{iid(1403)}'")=='0'
 print('PASS: publication waits for a concurrent source writer and refuses a stale selection',flush=True)

finally:
 if created:subprocess.run([docker,'rm','-f',name],capture_output=True,timeout=30)
