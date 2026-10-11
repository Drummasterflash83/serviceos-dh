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
TARGET='serviceos-connections-pages-'+uuid.uuid4().hex[:8]
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
create role connections_http_reader nologin;
create table google_workspace_connections(id uuid,tenant_id uuid,domain text,status text,last_verified_at timestamptz,created_at timestamptz,updated_at timestamptz);
insert into google_workspace_connections values(md5('gw')::uuid,'10000000-0000-4000-8000-000000000001','example.invalid','disabled','2026-09-01','2026-01-01','2026-10-10');
create table provider_connections(id uuid,tenant_id uuid,provider text,status text,auth_mode text,account_ref text,configured_fields text[],secret_refs jsonb,verified_at timestamptz,last_test jsonb,revoked_at timestamptz,created_at timestamptz,updated_at timestamptz);
insert into provider_connections values(md5('phone')::uuid,'10000000-0000-4000-8000-000000000001','sipcentric','revoked','api','masked',array['api_key'],'{"api_key":"SYNTHETIC_PRIVATE_REF"}','2026-09-01','{"ok":false,"at":"2026-10-10T00:00:00Z"}','2026-10-10','2026-01-01','2026-10-10');
create table google_workspace_mailboxes as select md5('mailbox-'||n)::uuid id,'10000000-0000-4000-8000-000000000001'::uuid tenant_id,
 'person-'||n||'@example.invalid' email_address,'active'::text status from generate_series(1,2503)n;
create table telephony_inventory as select md5('phone-'||n)::uuid id,'10000000-0000-4000-8000-000000000001'::uuid tenant_id,
 'sipcentric'::text provider,n::text provider_object_id,'ddi'::text canonical_type,'Main'::text label,'active'::text status,'api'::text discovery_source from generate_series(1,2503)n;
create table operating_profile_entries(id uuid,tenant_id uuid,scope_kind text,namespace text,key text,value jsonb);
insert into operating_profile_entries values(md5('domains')::uuid,'10000000-0000-4000-8000-000000000001','tenant','controlplane','email.approved_domains','{"approved_domains":["example.invalid"]}');
create table provider_connection_events as select md5('event-'||n)::uuid id,'10000000-0000-4000-8000-000000000001'::uuid tenant_id,
 'other'::text provider,'discovery_completed'::text event,'2026-10-10'::timestamptz created_at from generate_series(1,2503)n;
insert into provider_connection_events values(md5('prior')::uuid,'10000000-0000-4000-8000-000000000001','sipcentric','discovery_completed','2026-09-01'),(md5('fail')::uuid,'10000000-0000-4000-8000-000000000001','sipcentric','discovery_failed','2026-10-01');
create table phone_sync_runs(id uuid,tenant_id uuid,provider text,sync_type text,status text,started_at timestamptz,completed_at timestamptz,records_processed integer);
insert into phone_sync_runs values(md5('test')::uuid,'10000000-0000-4000-8000-000000000001','sipcentric','test_connection','success','2026-10-10 23:00:00','2026-10-10 23:01:00',0),(md5('calls')::uuid,'10000000-0000-4000-8000-000000000001','sipcentric','calls','success','2026-10-09','2026-10-09 01:00:00',12),(md5('long')::uuid,'10000000-0000-4000-8000-000000000001','sipcentric','calls','success','2026-10-08','2026-10-10 01:00:00',7);
create table email_sync_runs (like phone_sync_runs);
insert into email_sync_runs values(md5('discover')::uuid,'10000000-0000-4000-8000-000000000001','google_workspace','workspace_discover','success','2026-10-09','2026-10-09 02:00:00',2503);
insert into telephony_inventory select md5('foreign')::uuid,'20000000-0000-4000-8000-000000000001',provider,provider_object_id,canonical_type,label,status,discovery_source from telephony_inventory limit 1;
grant usage on schema public to connections_http_reader;
grant select on google_workspace_connections,provider_connections,google_workspace_mailboxes,telephony_inventory,operating_profile_entries,provider_connection_events,phone_sync_runs,email_sync_runs to connections_http_reader;
""")
    tables=['google_workspace_connections','provider_connections','google_workspace_mailboxes','telephony_inventory','operating_profile_entries','provider_connection_events','phone_sync_runs','email_sync_runs']
    fingerprint="select md5(jsonb_build_array("+','.join('(select jsonb_agg(to_jsonb(t) order by id) from '+t+' t)' for t in tables)+")::text)"
    before=sql(fingerprint)
    docker('run','-d','--pull=never','--network','container:'+TARGET,'--name',SIDECAR,
      '-e','PGRST_DB_URI=postgresql://supabase_admin@127.0.0.1:5432/postgres',
      '-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=connections_http_reader',
      '-e','PGRST_DB_MAX_ROWS=137','public.ecr.aws/supabase/postgrest:v14.5')
    for _ in range(40):
        try:
            probe=docker('exec',TARGET,'curl','-s','--max-time','1','-o','/dev/null','-w','%{http_code}','http://127.0.0.1:3000/')
            if probe.stdout==b'200': break
        except subprocess.CalledProcessError:
            pass
        time.sleep(.25)
    else: raise RuntimeError('Isolated PostgREST unavailable')
    result=subprocess.run(['node',str(ROOT/'scripts/verify/learn-connection-inventory-http.mjs'),TARGET,DOCKER],cwd=ROOT,capture_output=True,text=True)
    if result.returncode:
        print(result.stderr[-2000:]); raise RuntimeError('Isolated pagination reader failed')
    assert sql(fingerprint)==before,'Synthetic source records changed'
    report=json.loads(result.stdout)
    report['sourceFingerprintsPreserved']=True
    report['hostedSchemaOrAuthorizationAcceptance']=False
    print(json.dumps(report),flush=True)
finally:
    subprocess.run([DOCKER,'rm','-f',SIDECAR,TARGET],capture_output=True)
