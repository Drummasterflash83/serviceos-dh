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
name='serviceos-projection-review-'+uuid.uuid4().hex[:8]
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
 sql("""create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
 grant usage on schema auth to authenticated,anon,service_role;
 create table auth.users(id uuid primary key,email text,banned_until timestamptz);
 create table profiles(id uuid primary key,tenant_id uuid,role text);create table platform_authority_grants(profile_id uuid,permission text,effective_from timestamptz,effective_to timestamptz,granted_by text,reason text);
 create table view_as_context(tenant_id uuid,actor_user_id uuid,subject_kind text,reason text,ended_at timestamptz,expires_at timestamptz);""")
 resolver=source('supabase/migrations/20260822120000_platform_authority_decoupled_from_role.sql')
 sql(resolver[resolver.index('create or replace function current_user_is_openfolk_operator('):resolver.index('-- ── Governed record')])
 guard=source('supabase/migrations/20261031160000_learn_operator_inputs.sql')
 sql(guard[guard.index('create function public.learn_operator_input_access('):guard.index('-- Explicit booleans only.')])
 candidate=source('supabase/migrations/20261101320000_learn_projection_operator_review.sql')
 sql(candidate.replace('\ncommit;','\nrollback;'))
 assert sql("select to_regclass('learn_projection_operator_reviews') is null")=='t'
 sql(candidate)
 sql('begin;'+source('scripts/verify/learn-projection-review.assert.sql')+'rollback;')
 print('PASS: operator projection comparison, atomic review/publication/audit, exact replay/cancel, stale review/pause and permission isolation',flush=True)
finally:
 if created:subprocess.run([docker,'rm','-f',name],capture_output=True,timeout=30)
