"""Synthetic pagination transport check. Cached images, no network/ports/mounts.

Tables reproduce the reader's selected columns for HTTP/count/cursor verification;
this does not copy or verify a hosted schema, operator session or source dataset.
"""
import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
DOCKER=shutil.which('docker') or '/usr/local/bin/docker'
TARGET='serviceos-history-pages-'+uuid.uuid4().hex[:8]
SIDECAR=TARGET+'-http'
def docker(*args,**kwargs):
    return subprocess.run([DOCKER,*args],capture_output=True,check=True,**kwargs)
def sql(statement):
    return docker('exec','-i',TARGET,'psql','-h','127.0.0.1','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-qAt',input=statement.encode()).stdout.decode().strip()
try:
    docker('run','-d','--pull=never','--network','none','--name',TARGET,
      '-e','POSTGRES_HOST_AUTH_METHOD=trust','public.ecr.aws/supabase/postgres:17.6.1.141')
    for _ in range(80):
        try: sql('select 1'); break
        except subprocess.CalledProcessError: time.sleep(.25)
    else: raise RuntimeError('Isolated database unavailable')
    sql("""
create role history_http_reader nologin;
create table phone_sync_runs as select md5('run-'||n)::uuid id,'10000000-0000-4000-8000-000000000001'::uuid tenant_id,
 'sipcentric'::text provider,'calls'::text sync_type,case when n%7=0 then 'failed' else 'success' end status,
 '2026-10-10 12:00:00'::timestamptz-n*interval '1 microsecond' started_at,'2026-10-10 13:00:00'::timestamptz completed_at,n records_processed,
 case when n%7=0 then 'Synthetic provider timeout' else null end error_message from generate_series(1,2203)n;
create table email_sync_runs as select md5('run-'||n)::uuid id,'10000000-0000-4000-8000-000000000001'::uuid tenant_id,
 'google_workspace'::text provider,'workspace_discover'::text sync_type,'success'::text status,
 '2026-10-10 12:00:00'::timestamptz-n*interval '1 microsecond' started_at,'2026-10-10 13:00:00'::timestamptz completed_at,n records_processed,null::text error_message from generate_series(1,200)n;
create table data_imports as select md5('run-'||n)::uuid id,'10000000-0000-4000-8000-000000000001'::uuid tenant_id,
 'csv'::text source_system,'contacts'::text entity_type,'completed'::text status,
 case when n>95 then null else '2026-10-10 12:00:00'::timestamptz-n*interval '1 microsecond' end started_at,
 '2026-10-10 13:00:00'::timestamptz completed_at,'2026-10-09'::timestamptz created_at,n row_count,n created_records,
 0 updated_records,0 skipped_records,0 duplicate_records,0 conflict_records,0 invalid_rows,null::uuid uploaded_by,null::text failure from generate_series(1,100)n;
insert into phone_sync_runs select md5('future')::uuid,tenant_id,provider,sync_type,status,'2027-01-01',completed_at,records_processed,error_message from phone_sync_runs limit 1;
insert into phone_sync_runs select md5('foreign')::uuid,'20000000-0000-4000-8000-000000000001',provider,sync_type,status,started_at,completed_at,records_processed,error_message from phone_sync_runs limit 1;
grant usage on schema public to history_http_reader;
grant select on phone_sync_runs,email_sync_runs,data_imports to history_http_reader;
""")
    tables=['phone_sync_runs','email_sync_runs','data_imports']
    fingerprint="select md5(jsonb_build_array("+','.join('(select jsonb_agg(to_jsonb(t) order by id) from '+t+' t)' for t in tables)+")::text)"
    before=sql(fingerprint)
    docker('run','-d','--pull=never','--network','container:'+TARGET,'--name',SIDECAR,
      '-e','PGRST_DB_URI=postgresql://supabase_admin@127.0.0.1:5432/postgres',
      '-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=history_http_reader',
      '-e','PGRST_DB_MAX_ROWS=37','public.ecr.aws/supabase/postgrest:v14.5')
    for _ in range(40):
        try:
            probe=docker('exec',TARGET,'curl','-s','--max-time','1','-o','/dev/null','-w','%{http_code}','http://127.0.0.1:3000/')
            if probe.stdout==b'200': break
        except subprocess.CalledProcessError:
            pass
        time.sleep(.25)
    else: raise RuntimeError('Isolated PostgREST unavailable')
    result=subprocess.run(['node',str(ROOT/'scripts/verify/learn-discovery-history-http.mjs'),TARGET,DOCKER],cwd=ROOT,capture_output=True,text=True)
    if result.returncode:
        print(result.stderr[-2000:]); raise RuntimeError('Isolated pagination reader failed')
    assert sql(fingerprint)==before,'Synthetic source records changed'
    report=json.loads(result.stdout)
    report['sourceFingerprintsPreserved']=True
    report['hostedSchemaOrAuthorizationAcceptance']=False
    print(json.dumps(report),flush=True)
finally:
    subprocess.run([DOCKER,'rm','-f',SIDECAR,TARGET],capture_output=True)
