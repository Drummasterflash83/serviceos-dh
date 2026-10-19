"""Disposable synthetic tenant/visibility check; no LIVE data or provider call."""
import shutil
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCKER = shutil.which("docker") or "/usr/local/bin/docker"
NAME = "serviceos-job-context-" + uuid.uuid4().hex[:8]


def run(*args, input=None):
    result = subprocess.run([DOCKER, *args], input=input, text=True,
                            capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr[-2500:])
    return result.stdout.strip()


FIXTURE = r"""
create schema auth;
create role authenticated;
create role anon;
create role service_role;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$
 select current_setting('request.jwt.claim.role',true) $$;
create table public.feature_flags(tenant_id uuid,flag text,value jsonb);
create table public.jobs(id uuid primary key,tenant_id uuid,source_system text,external_id text,
 customer_person_id uuid,customer_company_id uuid,metadata jsonb);
create table public.learn_business_input_current_links(tenant_id uuid,connection_id uuid,
 entity_id uuid,entity_kind text,entity_table text,provider text,collection text,
 external_id text,source_version_id uuid);
create table public.interactions(id uuid primary key,tenant_id uuid,source_table text,
 source_id uuid,occurred_at timestamptz,related_person_id uuid,related_company_id uuid,
 related_job_id uuid,status text,metadata jsonb);
create table public.phone_calls(id uuid primary key,tenant_id uuid);
create table public.email_messages(id uuid primary key,tenant_id uuid,is_draft boolean);
create table public.slack_messages(id uuid primary key,tenant_id uuid,team_id text,
 channel_id text,source_version text,withheld boolean);
create table public.slack_message_versions(id uuid primary key,tenant_id uuid,
 message_id uuid,source_version text);
create table public.slack_channel_visibility_receipts(id uuid primary key,tenant_id uuid,
 team_id text,channel_id text);
create table public.slack_source_visibility_proofs(receipt_id uuid,version_id uuid);
create table public.controlplane_change_log(id uuid,tenant_id uuid,actor text,action text,
 resource_type text,resource_id text,after jsonb,reason text,correlation_id text,
 view_as_active boolean,source text);
create function public.learn_operator_input_access(p_tenant uuid,p_actor uuid,p_write boolean)
returns void language plpgsql as $$begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is distinct from p_actor
  or p_actor is distinct from '00000000-0000-4000-8000-000000000090'::uuid
  or p_tenant is null or current_setting('fixture.view_as',true)='on' then
  raise exception 'operator_denied' using errcode='42501';end if;
end$$;
create function public.learn_interaction_is_draft(p_tenant uuid,p_table text,p_source uuid)
returns boolean language sql stable as $$select p_table='email_messages' and exists(
 select 1 from public.email_messages where tenant_id=p_tenant and id=p_source and is_draft)$$;
create function public.learn_slack_interaction_withheld(p_tenant uuid,p_interaction uuid)
returns boolean language sql stable as $$select exists(
 select 1 from public.interactions i join public.slack_messages s on s.id=i.source_id
 where i.id=p_interaction and i.tenant_id=p_tenant and s.tenant_id=p_tenant and s.withheld)$$;
insert into jobs values
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010',
  'commusoft:connection:00000000-0000-4000-8000-000000000020','001',null,
  '00000000-0000-4000-8000-000000000030',
  '{"learn_business_input":{"source_version_id":"00000000-0000-4000-8000-000000000040"}}'),
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000010',
  'commusoft:connection:00000000-0000-4000-8000-000000000020','008',null,
  '00000000-0000-4000-8000-000000000030',
  '{"learn_business_input":{"source_version_id":"00000000-0000-4000-8000-000000000041"}}'),
 ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000011',
  'commusoft:connection:00000000-0000-4000-8000-000000000021','001',null,
  '00000000-0000-4000-8000-000000000031',
  '{"learn_business_input":{"source_version_id":"00000000-0000-4000-8000-000000000042"}}');
insert into learn_business_input_current_links values
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020',
  '00000000-0000-4000-8000-000000000001','job','jobs','commusoft','jobs','001',
  '00000000-0000-4000-8000-000000000040'),
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020',
  '00000000-0000-4000-8000-000000000002','job','jobs','commusoft','jobs','008',
  '00000000-0000-4000-8000-000000000041'),
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020',
  '00000000-0000-4000-8000-000000000030','customer','companies','commusoft','customers','30',
  '00000000-0000-4000-8000-000000000043');
insert into phone_calls values
 ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000010'),
 ('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000010');
insert into email_messages values
 ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000010',false),
 ('00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000010',true);
insert into slack_messages values
 ('00000000-0000-4000-8000-000000000105','00000000-0000-4000-8000-000000000010','T1','C1','v1',false),
 ('00000000-0000-4000-8000-000000000106','00000000-0000-4000-8000-000000000010','T1','C1','v1',true),
 ('00000000-0000-4000-8000-000000000107','00000000-0000-4000-8000-000000000010','T1','C1','v1',false);
insert into slack_message_versions values
 ('00000000-0000-4000-8000-000000000115','00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000105','v1'),
 ('00000000-0000-4000-8000-000000000116','00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000106','v1');
insert into slack_channel_visibility_receipts values
 ('00000000-0000-4000-8000-000000000120','00000000-0000-4000-8000-000000000010','T1','C1');
insert into slack_source_visibility_proofs values
 ('00000000-0000-4000-8000-000000000120','00000000-0000-4000-8000-000000000115'),
 ('00000000-0000-4000-8000-000000000120','00000000-0000-4000-8000-000000000116');
insert into interactions
 select ('00000000-0000-4000-8000-000000000' || right(n::text,3))::uuid,
  '00000000-0000-4000-8000-000000000010',
  case when n in(101,102) then 'phone_calls' when n in(103,104) then 'email_messages'
   else 'slack_messages' end,
  ('00000000-0000-4000-8000-000000000' || right(n::text,3))::uuid,
  now()-interval '1 day',null,'00000000-0000-4000-8000-000000000030',
  case when n=102 then '00000000-0000-4000-8000-000000000002'::uuid end,'active',
  case when n in(105,106,107) then '{"source_version":"v1"}'::jsonb else '{}'::jsonb end
 from generate_series(101,107) n;
insert into interactions values
 ('00000000-0000-4000-8000-000000000108','00000000-0000-4000-8000-000000000011',
  'phone_calls','00000000-0000-4000-8000-000000000101',now(),null,
  '00000000-0000-4000-8000-000000000030',null,'active','{}');
"""

ASSERTIONS = r"""
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000090';
set role authenticated;
do $$begin
 begin perform public.new_dawn_job_context_candidates('00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001','Synthetic review');
  raise exception 'default-off gate failed';
 exception when sqlstate '42501' then null;end;
end$$;
reset role;
insert into feature_flags values('00000000-0000-4000-8000-000000000010',
 'new_dawn.job_context_candidates','true');
set role authenticated;
do $$declare r jsonb;begin
 r:=public.new_dawn_job_context_candidates('00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001','Synthetic review');
 if r->>'state'<>'customer_context_only' or r->>'job_link_state'<>'unverified'
  or r->>'finance_state'<>'held_no_reviewed_cross_provider_job_mapping'
  or jsonb_array_length(r->'candidates')<>3 or r->'has_more'<>'false'::jsonb
  or exists(select 1 from jsonb_array_elements(r->'candidates') x
   where x->>'job_identity'<>'unverified' or x->>'customer_evidence'<>'company'
    or x->>'source_table' not in('phone_calls','email_messages','slack_messages'))
 then raise exception 'candidate contract invalid: %',r;end if;
 r:=public.new_dawn_job_context_candidates('00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001','Synthetic review',2);
 if jsonb_array_length(r->'candidates')<>2 or r->'has_more'<>'true'::jsonb then
  raise exception 'candidate bound invalid';end if;
 begin perform public.new_dawn_job_context_candidates('00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000003','Synthetic review');
  raise exception 'foreign tenant job visible';
 exception when sqlstate '42501' then null;end;
 begin perform public.new_dawn_job_context_candidates('00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001','Synthetic review',21);
  raise exception 'limit escaped';
 exception when sqlstate '22023' then null;end;
 perform set_config('fixture.view_as','on',true);
 begin perform public.new_dawn_job_context_candidates('00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001','Synthetic review');
  raise exception 'view-as escaped';
 exception when sqlstate '42501' then null;end;
 perform set_config('fixture.view_as','off',true);
end$$;
reset role;
delete from learn_business_input_current_links where entity_kind='customer';
set role authenticated;
do $$declare r jsonb;begin
 r:=public.new_dawn_job_context_candidates('00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001','Synthetic missing customer review');
 if r->>'state'<>'no_reviewed_customer_context' or jsonb_array_length(r->'candidates')<>0
 then raise exception 'unreviewed customer context escaped';end if;
end$$;
reset role;
select case when (select count(*) from controlplane_change_log)=3
 and (select count(*) from interactions)=8 and (select count(*) from jobs)=3
 then 'PASS: default-off, exact tenant/job, bounded customer context, Slack attestation/withholding, draft/linked exclusion, finance held and audited read'
 else 'FAIL: source mutation or audit mismatch' end;
"""


try:
    run("run", "-d", "--pull=never", "--network", "none", "--name", NAME,
        "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:15")
    for _ in range(40):
        result = subprocess.run([DOCKER, "exec", NAME, "pg_isready", "-h",
                                 "127.0.0.1", "-U", "postgres"], capture_output=True)
        if result.returncode == 0:
            break
        time.sleep(.25)
    else:
        raise RuntimeError("Isolated PostgreSQL did not become ready")
    source = (ROOT / "supabase/migrations/20261106220000_new_dawn_job_context_candidates.sql").read_text()
    rollback = source.replace("\ncommit;\n", "\nrollback;\n")
    assert rollback != source
    result = run("exec", "-i", NAME, "psql", "-X", "-qAt", "-h", "127.0.0.1",
                 "-U", "postgres", "-v", "ON_ERROR_STOP=1", input=FIXTURE + "\n" +
                 rollback + "\nselect to_regprocedure('public.new_dawn_job_context_candidates(uuid,uuid,text,integer)') is null;")
    if result != "t":
        raise RuntimeError("Migration rollback retained the reader")
    result = run("exec", "-i", NAME, "psql", "-X", "-qAt", "-h", "127.0.0.1",
                 "-U", "postgres", "-v", "ON_ERROR_STOP=1",
                 input=source + "\n" + ASSERTIONS)
    if not result.startswith("PASS:"):
        raise RuntimeError("Candidate fixture failed")
    print(result)
finally:
    subprocess.run([DOCKER, "rm", "-f", NAME], capture_output=True, timeout=30)
