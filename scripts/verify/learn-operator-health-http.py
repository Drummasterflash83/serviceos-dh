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
TARGET='serviceos-health-pages-'+uuid.uuid4().hex[:8]
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
create role health_http_reader nologin;
create table public.team_members as select md5('member-'||n)::uuid id,
 '10000000-0000-4000-8000-000000000001'::uuid tenant_id,
 '2026-01-01'::timestamptz effective_from,null::timestamptz effective_to from generate_series(1,2503) n;
create table public.communication_endpoints as select id,tenant_id,effective_from,effective_to,
 'email'::text channel,'email'::text endpoint_kind,id::text||'@example.invalid' normalized_value,
 null::text display_value,'email'::text provider,null::text provider_external_ref,false is_shared,
 'active'::text status,'synthetic'::text source,effective_from updated_at from team_members;
create table public.member_integration_identities as select id,tenant_id,effective_from,effective_to,id team_member_id,
 'email'::text provider,'user'::text identity_kind,id::text||'@example.invalid' external_ref,
 null::text display,null::text primary_login,'verified'::text verification_state from team_members;
create table public.endpoint_ownership_assignments as select id,tenant_id,effective_from,effective_to,id endpoint_id,
 'person'::text owner_kind,id owner_member_id,null::uuid owner_org_unit_id,null::text owner_role,
 'accountable'::text assignment_role,1::numeric confidence,'confirmed'::text review_state,effective_from updated_at from team_members;
create table public.google_workspace_mailboxes as select id,tenant_id,id::text||'@example.invalid' email_address,'active'::text status from team_members;
create table public.telephony_inventory as select id,tenant_id,'endpoint'::text canonical_type,'sipcentric'::text provider,'active'::text status from team_members;
update member_integration_identities set verification_state='unverified' where id=md5('member-2503')::uuid;
update endpoint_ownership_assignments set review_state='conflicted' where id=md5('member-2503')::uuid;
update google_workspace_mailboxes set status='suspended' where id=md5('member-2503')::uuid;
-- Foreign rows and past/future links must never become current health evidence.
insert into team_members values(md5('foreign')::uuid,'20000000-0000-4000-8000-000000000001','2026-01-01',null);
insert into member_integration_identities select md5('ended')::uuid,tenant_id,effective_from,'2026-10-11',team_member_id,provider,identity_kind,external_ref,display,primary_login,'unverified' from member_integration_identities limit 1;
insert into endpoint_ownership_assignments select md5('future')::uuid,tenant_id,'2027-01-01',effective_to,endpoint_id,owner_kind,owner_member_id,owner_org_unit_id,owner_role,assignment_role,confidence,'conflicted',updated_at from endpoint_ownership_assignments limit 1;
grant usage on schema public to health_http_reader;
grant select on team_members,communication_endpoints,member_integration_identities,endpoint_ownership_assignments,google_workspace_mailboxes,telephony_inventory to health_http_reader;
""")
    tables=['team_members','communication_endpoints','member_integration_identities','endpoint_ownership_assignments','google_workspace_mailboxes','telephony_inventory']
    fingerprint="select md5(jsonb_build_array("+','.join('(select jsonb_agg(to_jsonb(t) order by id) from '+t+' t)' for t in tables)+")::text)"
    before=sql(fingerprint)
    docker('run','-d','--pull=never','--network','container:'+TARGET,'--name',SIDECAR,
      '-e','PGRST_DB_URI=postgresql://supabase_admin@127.0.0.1:5432/postgres',
      '-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=health_http_reader',
      '-e','PGRST_DB_MAX_ROWS=137','public.ecr.aws/supabase/postgrest:v14.5')
    for _ in range(40):
        try:
            probe=docker('exec',TARGET,'curl','-s','--max-time','1','-o','/dev/null','-w','%{http_code}','http://127.0.0.1:3000/')
            if probe.stdout==b'200': break
        except subprocess.CalledProcessError:
            pass
        time.sleep(.25)
    else: raise RuntimeError('Isolated PostgREST unavailable')
    result=subprocess.run(['node',str(ROOT/'scripts/verify/learn-operator-health-http.mjs'),TARGET,DOCKER],cwd=ROOT,capture_output=True,text=True)
    if result.returncode:
        print(result.stderr[-2000:]); raise RuntimeError('Isolated pagination reader failed')
    assert sql(fingerprint)==before,'Synthetic source records changed'
    report=json.loads(result.stdout)
    report['sourceFingerprintsPreserved']=True
    report['hostedSchemaOrAuthorizationAcceptance']=False
    print(json.dumps(report),flush=True)
finally:
    subprocess.run([DOCKER,'rm','-f',SIDECAR,TARGET],capture_output=True)
