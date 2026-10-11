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
TARGET='serviceos-roster-pages-'+uuid.uuid4().hex[:8]
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
create role roster_http_reader nologin;
create table public.team_members as select
 md5('member-'||n)::uuid id, '10000000-0000-4000-8000-000000000001'::uuid tenant_id,
 'Member '||lpad(n::text,4,'0') display_name, 'Coordinator'::text formal_role,
 'proposed'::text formal_role_status, null::text target_role, null::text observed_role,
 null::text observed_status, 'individual'::text authority_level, null::uuid org_unit_id,
 null::uuid profile_id, '2026-01-01'::timestamptz effective_from, null::timestamptz effective_to
 from generate_series(1,2503) n;
create table public.responsibility_assignments as select id,tenant_id,id member_id,
 'workflow'::text kind,null::uuid target_ref,'Shared label'::text label,'responsible'::text raci_role,
 true is_shared,31 weekday_mask,null::uuid cover_for,false confirmed,effective_from,effective_to,1 version from team_members;
create table public.authority_grants as select id,tenant_id,id member_id,'work.assign'::text permission,
 'self'::text scope,null::uuid scope_ref,false confirmed,effective_from,effective_to from team_members;
insert into team_members select md5('foreign')::uuid,'20000000-0000-4000-8000-000000000001'::uuid,
 'Foreign',formal_role,formal_role_status,target_role,observed_role,observed_status,authority_level,org_unit_id,profile_id,effective_from,effective_to from team_members limit 1;
insert into responsibility_assignments select md5('ended')::uuid,tenant_id,member_id,kind,target_ref,label,raci_role,is_shared,weekday_mask,cover_for,confirmed,effective_from,'2026-02-01',version from responsibility_assignments limit 1;
insert into authority_grants select md5('ended')::uuid,tenant_id,member_id,permission,scope,scope_ref,confirmed,effective_from,'2026-02-01' from authority_grants limit 1;
grant usage on schema public to roster_http_reader;
grant select on team_members,responsibility_assignments,authority_grants to roster_http_reader;
""")
    fingerprint="select md5(jsonb_build_array((select jsonb_agg(to_jsonb(t) order by id) from team_members t),(select jsonb_agg(to_jsonb(t) order by id) from responsibility_assignments t),(select jsonb_agg(to_jsonb(t) order by id) from authority_grants t))::text)"
    before=sql(fingerprint)
    docker('run','-d','--pull=never','--network','container:'+TARGET,'--name',SIDECAR,
      '-e','PGRST_DB_URI=postgresql://supabase_admin@127.0.0.1:5432/postgres',
      '-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=roster_http_reader',
      '-e','PGRST_DB_MAX_ROWS=137','public.ecr.aws/supabase/postgrest:v14.5')
    for _ in range(40):
        try:
            probe=docker('exec',TARGET,'curl','-s','--max-time','1','-o','/dev/null','-w','%{http_code}','http://127.0.0.1:3000/')
            if probe.stdout==b'200': break
        except subprocess.CalledProcessError:
            pass
        time.sleep(.25)
    else: raise RuntimeError('Isolated PostgREST unavailable')
    result=subprocess.run(['node',str(ROOT/'scripts/verify/learn-roster-pagination-http.mjs'),TARGET,DOCKER],cwd=ROOT,capture_output=True,text=True)
    if result.returncode:
        print(result.stderr[-2000:]); raise RuntimeError('Isolated pagination reader failed')
    assert sql(fingerprint)==before,'Synthetic source records changed'
    report=json.loads(result.stdout)
    report['sourceFingerprintsPreserved']=True
    report['hostedSchemaOrAuthorizationAcceptance']=False
    print(json.dumps(report),flush=True)
finally:
    subprocess.run([DOCKER,'rm','-f',SIDECAR,TARGET],capture_output=True)
