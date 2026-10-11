"""Synthetic receipt projection transport check. Cached images, no network/ports/mounts.

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
TARGET='serviceos-receipt-bindings-'+uuid.uuid4().hex[:8]
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
    fixtures=json.loads(subprocess.run(['node','--input-type=module','-e',"import {fixtures} from './scripts/verify/learn-measurement-receipts-fixture.mjs'; console.log(JSON.stringify(fixtures))"],cwd=ROOT,capture_output=True,text=True,check=True).stdout)
    sql("""
create role history_http_reader nologin;
create table learn_work_measurement_runs(id uuid,tenant_id uuid,member_id uuid,request jsonb,source_system text,metric_key text,observed_at timestamptz,proof jsonb);
create table learn_team_work_measurement_runs(id uuid,tenant_id uuid,team_id uuid,request jsonb,source_system text,metric_key text,observed_at timestamptz,proof jsonb);
create table learn_work_collection_runs(id uuid,tenant_id uuid,subject_id uuid,subject_kind text,policy_id uuid,policy_revision integer,window_start timestamptz,window_end timestamptz,source_system text,metric_key text,observed_at timestamptz,proof jsonb,unit text,state text,kind text,snapshot_at timestamptz,population integer,processed integer);
grant usage on schema public to history_http_reader;
grant select on learn_work_measurement_runs,learn_team_work_measurement_runs,learn_work_collection_runs to history_http_reader;
""")
    tables=['learn_work_measurement_runs','learn_team_work_measurement_runs','learn_work_collection_runs']
    for f in fixtures:
        assert f['table'] in tables
        literal=json.dumps(f['raw']).replace("'","''")
        sql("insert into "+f['table']+" select * from jsonb_populate_record(null::"+f['table']+",'"+literal+"'::jsonb)")
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
    result=subprocess.run(['node',str(ROOT/'scripts/verify/learn-measurement-receipts-http.mjs'),TARGET,DOCKER],cwd=ROOT,capture_output=True,text=True)
    if result.returncode:
        print(result.stderr[-2000:]); raise RuntimeError('Isolated receipt binding reader failed')
    assert sql(fingerprint)==before,'Synthetic source records changed'
    report=json.loads(result.stdout)
    report['sourceFingerprintsPreserved']=True
    report['hostedSchemaOrAuthorizationAcceptance']=False
    print(json.dumps(report),flush=True)
finally:
    subprocess.run([DOCKER,'rm','-f',SIDECAR,TARGET],capture_output=True)
