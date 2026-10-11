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
TARGET='serviceos-readiness-pages-'+uuid.uuid4().hex[:8]
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
create role readiness_http_reader nologin;
create table communication_endpoints as select md5('endpoint-'||n)::uuid id,'10000000-0000-4000-8000-000000000001'::uuid tenant_id,
 'phone'::text channel,'ddi'::text endpoint_kind,'active'::text status,'2026-01-01'::timestamptz effective_from,null::timestamptz effective_to from generate_series(1,2503)n;
create table team_members as select md5('person-'||n)::uuid id,'10000000-0000-4000-8000-000000000001'::uuid tenant_id,
 '2026-01-01'::timestamptz effective_from,null::timestamptz effective_to from generate_series(1,2503)n;
create table org_units as select md5('team-'||n)::uuid id,'10000000-0000-4000-8000-000000000001'::uuid tenant_id from generate_series(1,2503)n;
create table endpoint_ownership_assignments as select md5(e.id::text||r)::uuid id,e.tenant_id,e.id endpoint_id,'person'::text owner_kind,
 md5('person-2503')::uuid owner_member_id,null::uuid owner_org_unit_id,null::text owner_role,r assignment_role,
 effective_from,effective_to,.9::numeric confidence,'confirmed'::text review_state from communication_endpoints e cross join unnest(array['accountable','primary_handler']) r;
create table config_versions as select md5('policy-'||n)::uuid id,'10000000-0000-4000-8000-000000000001'::uuid tenant_id,
 'policy'::text artifact_kind,'customer_health'::text artifact_key,n version,case when n=2503 then 'published' else 'draft' end status from generate_series(1,2503)n;
create table operating_profile_entries(id uuid,tenant_id uuid,scope_kind text,namespace text,key text,value jsonb);
insert into operating_profile_entries values(md5('source')::uuid,'10000000-0000-4000-8000-000000000001','tenant','customer_health','source.allowlist','{"enabled":true,"sources":["phone_call"]}');
insert into operating_profile_entries values(md5('team-source')::uuid,'10000000-0000-4000-8000-000000000001','team','customer_health','source.allowlist','{"enabled":false}');
insert into communication_endpoints select md5('foreign')::uuid,'20000000-0000-4000-8000-000000000001',channel,endpoint_kind,status,effective_from,effective_to from communication_endpoints limit 1;
grant usage on schema public to readiness_http_reader;
grant select on communication_endpoints,endpoint_ownership_assignments,team_members,org_units,config_versions,operating_profile_entries to readiness_http_reader;
""")
    tables=['team_members','org_units','communication_endpoints','endpoint_ownership_assignments','config_versions','operating_profile_entries']
    fingerprint="select md5(jsonb_build_array("+','.join('(select jsonb_agg(to_jsonb(t) order by id) from '+t+' t)' for t in tables)+")::text)"
    before=sql(fingerprint)
    docker('run','-d','--pull=never','--network','container:'+TARGET,'--name',SIDECAR,
      '-e','PGRST_DB_URI=postgresql://supabase_admin@127.0.0.1:5432/postgres',
      '-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=readiness_http_reader',
      '-e','PGRST_DB_MAX_ROWS=137','public.ecr.aws/supabase/postgrest:v14.5')
    for _ in range(40):
        try:
            probe=docker('exec',TARGET,'curl','-s','--max-time','1','-o','/dev/null','-w','%{http_code}','http://127.0.0.1:3000/')
            if probe.stdout==b'200': break
        except subprocess.CalledProcessError:
            pass
        time.sleep(.25)
    else: raise RuntimeError('Isolated PostgREST unavailable')
    result=subprocess.run(['node',str(ROOT/'scripts/verify/learn-phone-readiness-http.mjs'),TARGET,DOCKER],cwd=ROOT,capture_output=True,text=True)
    if result.returncode:
        print(result.stderr[-2000:]); raise RuntimeError('Isolated pagination reader failed')
    assert sql(fingerprint)==before,'Synthetic source records changed'
    report=json.loads(result.stdout)
    report['sourceFingerprintsPreserved']=True
    report['hostedSchemaOrAuthorizationAcceptance']=False
    print(json.dumps(report),flush=True)
finally:
    subprocess.run([DOCKER,'rm','-f',SIDECAR,TARGET],capture_output=True)
