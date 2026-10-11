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
TARGET='serviceos-ownership-pages-'+uuid.uuid4().hex[:8]
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
create role ownership_http_reader nologin;
create table communication_endpoints as select md5('endpoint-'||n)::uuid id,'10000000-0000-4000-8000-000000000001'::uuid tenant_id,
 'phone'::text channel,'extension'::text endpoint_kind,n::text normalized_value,null::text display_value,'sipcentric'::text provider,'seat-'||n provider_external_ref,
 false is_shared,'active'::text status,'2026-01-01'::timestamptz effective_from,null::timestamptz effective_to from generate_series(1,2503)n;
create table endpoint_ownership_assignments as select md5('assignment')::uuid id,tenant_id,id endpoint_id,'person'::text owner_kind,
 md5('accountable')::uuid owner_member_id,null::uuid owner_org_unit_id,null::text owner_role,'accountable'::text assignment_role,
 effective_from,effective_to,.9::numeric confidence,'confirmed'::text review_state from communication_endpoints where normalized_value='2503';
create table team_members(id uuid,tenant_id uuid,effective_from timestamptz default '2026-01-01',effective_to timestamptz);
insert into team_members(id,tenant_id) values(md5('accountable')::uuid,'10000000-0000-4000-8000-000000000001'),(md5('handler')::uuid,'10000000-0000-4000-8000-000000000001');
create table org_units(id uuid,tenant_id uuid);
create table responsibility_handoffs as select md5('handoff-'||n)::uuid id,'10000000-0000-4000-8000-000000000001'::uuid tenant_id,
 'interaction'::text subject_type,'call-1'::text subject_ref,jsonb_build_object('kind','person','ref',case when n=2503 then md5('handler') else md5('accountable') end::uuid) to_party,
 '2026-10-11'::timestamptz-interval '3000 seconds'+n*interval '1 second' occurred_at,'confirmed'::text observed_state from generate_series(1,2503)n;
insert into responsibility_handoffs values(md5('future')::uuid,'10000000-0000-4000-8000-000000000001','interaction','call-1',jsonb_build_object('kind','person','ref',md5('accountable')::uuid),'2027-01-01','confirmed');
insert into responsibility_handoffs values(md5('different-subject')::uuid,'10000000-0000-4000-8000-000000000001','commitment','call-1',jsonb_build_object('kind','person','ref',md5('accountable')::uuid),'2026-10-10 23:59:00','confirmed');
insert into communication_endpoints select md5('foreign')::uuid,'20000000-0000-4000-8000-000000000001',channel,endpoint_kind,normalized_value,display_value,provider,provider_external_ref,is_shared,status,effective_from,effective_to from communication_endpoints where normalized_value='2503';
grant usage on schema public to ownership_http_reader;
grant select on communication_endpoints,endpoint_ownership_assignments,responsibility_handoffs,team_members,org_units to ownership_http_reader;
""")
    tables=['team_members','org_units','communication_endpoints','endpoint_ownership_assignments','responsibility_handoffs']
    fingerprint="select md5(jsonb_build_array("+','.join('(select jsonb_agg(to_jsonb(t) order by id) from '+t+' t)' for t in tables)+")::text)"
    before=sql(fingerprint)
    docker('run','-d','--pull=never','--network','container:'+TARGET,'--name',SIDECAR,
      '-e','PGRST_DB_URI=postgresql://supabase_admin@127.0.0.1:5432/postgres',
      '-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=ownership_http_reader',
      '-e','PGRST_DB_MAX_ROWS=137','public.ecr.aws/supabase/postgrest:v14.5')
    for _ in range(40):
        try:
            probe=docker('exec',TARGET,'curl','-s','--max-time','1','-o','/dev/null','-w','%{http_code}','http://127.0.0.1:3000/')
            if probe.stdout==b'200': break
        except subprocess.CalledProcessError:
            pass
        time.sleep(.25)
    else: raise RuntimeError('Isolated PostgREST unavailable')
    result=subprocess.run(['node',str(ROOT/'scripts/verify/learn-ownership-evidence-http.mjs'),TARGET,DOCKER],cwd=ROOT,capture_output=True,text=True)
    if result.returncode:
        print(result.stderr[-2000:]); raise RuntimeError('Isolated pagination reader failed')
    assert sql(fingerprint)==before,'Synthetic source records changed'
    report=json.loads(result.stdout)
    report['sourceFingerprintsPreserved']=True
    report['hostedSchemaOrAuthorizationAcceptance']=False
    print(json.dumps(report),flush=True)
finally:
    subprocess.run([DOCKER,'rm','-f',SIDECAR,TARGET],capture_output=True)
