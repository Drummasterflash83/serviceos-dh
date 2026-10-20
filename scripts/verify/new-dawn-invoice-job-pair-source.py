"""Disposable PostgreSQL contract for the exact invoice/job source reader.

Uses only synthetic rows in a network-disabled, throwaway local container.
Both the migration rollback and the installed RPC are exercised; the container
is removed in finally. Never connects to a hosted database or provider.
"""
import shutil
import subprocess
import time
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DOCKER = shutil.which("docker") or "/usr/local/bin/docker"
NAME = "serviceos-invoice-job-pair-" + uuid.uuid4().hex[:8]
MIGRATION = ROOT / "supabase/migrations/20261108140000_new_dawn_invoice_job_pair_source.sql"


def run(*args, input=None):
    result = subprocess.run([DOCKER, *args], input=input, text=True,
                            capture_output=True, timeout=90)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout)[-4000:])
    return result.stdout.strip()


SCHEMA = r"""
create schema auth;
create role authenticated;
create role anon;
create role service_role;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$
 select current_setting('request.jwt.claim.role',true) $$;
create function public.fixture_id(n integer) returns uuid language sql immutable as $$
 select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function fixture_denied(statement text, expected text default '42501')
returns void language plpgsql as $$declare actual text;begin
 begin execute statement;
 exception when others then
  get stacked diagnostics actual=returned_sqlstate;
  if actual=expected then return;end if;
  raise exception 'wrong denial %, expected %: %; cause %',actual,expected,statement,sqlerrm;
 end;
 raise exception 'expected denial: %',statement;
end $$;
create table public.feature_flags(tenant_id uuid,flag text,value jsonb);
create table public.learn_quickbooks_connections(id uuid,tenant_id uuid,environment text,
 confirmed_at timestamptz,realm_id text,status text);
create table public.learn_quickbooks_source_versions(id uuid,tenant_id uuid,
 environment text,realm_id text,entity text,external_id text,content_hash text,
 payload jsonb,sync_token numeric,source_updated_at timestamptz);
create table public.learn_quickbooks_latest(tenant_id uuid,environment text,realm_id text,
 entity text,external_id text,version_id uuid,sync_token numeric,
 source_updated_at timestamptz,conflicted boolean,last_observed_at timestamptz);
create table public.jobs(id uuid,tenant_id uuid,metadata jsonb,external_id text,job_number text);
create table public.learn_business_input_current_links(tenant_id uuid,entity_kind text,
 entity_table text,entity_id uuid,provider text,collection text,connection_id uuid,
 source_version_id uuid,external_id text);
create table public.learn_business_input_versions(id uuid,tenant_id uuid,
 connection_id uuid,provider text,collection text,external_id text,
 content_hash text,payload jsonb,first_seen_at timestamptz);
create table public.learn_business_input_pages(id uuid,tenant_id uuid,connection_id uuid,
 provider text,collection text,committed_at timestamptz);
create table public.learn_business_input_observations(version_id uuid,page_id uuid);
create table public.learn_quickbooks_finance_events(id uuid default gen_random_uuid(),
 tenant_id uuid,actor_id uuid,event text,detail jsonb,reason text);
create function public.learn_operator_input_access(p_tenant uuid,p_actor uuid,p_write boolean)
returns void language plpgsql as $$begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is distinct from p_actor
  or p_actor is distinct from public.fixture_id(90) or current_setting('fixture.view_as',true)='on'
  or p_tenant not in(public.fixture_id(1),public.fixture_id(2)) then
  raise exception 'operator_denied' using errcode='42501';end if;
end $$;
create function public.learn_quickbooks_actor_access(p_tenant uuid,p_actor uuid)
returns void language plpgsql as $$begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
end $$;
create function public.learn_business_input_latest(p_tenant uuid,p_connection uuid,
 p_provider text,p_collection text,p_external text)
returns public.learn_business_input_versions language sql stable as $$
 select v.* from public.learn_business_input_versions v
 where v.tenant_id=p_tenant and v.connection_id=p_connection and v.provider=p_provider
  and v.collection=p_collection and v.external_id=p_external
 order by v.first_seen_at desc,v.id desc limit 1 $$;

insert into public.learn_quickbooks_connections values
 (public.fixture_id(20),public.fixture_id(1),'production',now()-interval '1 day','123','connected'),
 (public.fixture_id(21),public.fixture_id(2),'production',now()-interval '1 day','999','connected');
insert into public.learn_quickbooks_source_versions values
 (public.fixture_id(30),public.fixture_id(1),'production','123','Invoice','456',repeat('a',64),
  '{"Id":"456","DocNumber":"Q-456","CustomerRef":{"value":"C-1"},"CustomField":[{"Name":"P.O No.","StringValue":"PO-12"}]}',2,now()-interval '1 hour'),
 (public.fixture_id(31),public.fixture_id(1),'production','123','Invoice','456',repeat('b',64),
  '{"Id":"456","DocNumber":"OLD"}',1,now()-interval '2 days'),
 (public.fixture_id(32),public.fixture_id(2),'production','999','Invoice','456',repeat('c',64),
  '{"Id":"456","DocNumber":"OTHER TENANT"}',2,now()-interval '1 hour'),
 (public.fixture_id(33),public.fixture_id(1),'production','456','Invoice','456',repeat('d',64),
  '{"Id":"456","DocNumber":"OTHER REALM"}',2,now()-interval '1 hour');
insert into public.learn_quickbooks_latest
select tenant_id,environment,realm_id,entity,external_id,id,sync_token,
 source_updated_at,false,now()-interval '30 minutes'
from public.learn_quickbooks_source_versions where id=public.fixture_id(30);
insert into public.jobs values
 (public.fixture_id(40),public.fixture_id(1),jsonb_build_object('learn_business_input',jsonb_build_object(
  'source_version_id',public.fixture_id(50),'connection_id',public.fixture_id(22))), '345','001'),
 (public.fixture_id(41),public.fixture_id(1),'{}','346','008'),
 (public.fixture_id(42),public.fixture_id(2),'{}','345','001');
insert into public.learn_business_input_current_links values
 (public.fixture_id(1),'job','jobs',public.fixture_id(40),'commusoft','jobs',public.fixture_id(22),public.fixture_id(50),'345');
insert into public.learn_business_input_versions values
 (public.fixture_id(50),public.fixture_id(1),public.fixture_id(22),'commusoft','jobs','345',repeat('e',64),
  '{"id":345,"customerReference":"PO-12"}',now()-interval '2 hours');
insert into public.learn_business_input_pages values
 (public.fixture_id(60),public.fixture_id(1),public.fixture_id(22),'commusoft','jobs',now()-interval '1 hour');
insert into public.learn_business_input_observations values(public.fixture_id(50),public.fixture_id(60));
"""

CALL = "public.new_dawn_invoice_job_pair_source(public.fixture_id(1),public.fixture_id(30),public.fixture_id(40),'Synthetic exact-pair review')"
DENIED_CALL = CALL.replace("'", "''")

ASSERTIONS = f"""
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000090';
set role authenticated;
select fixture_denied('select {DENIED_CALL}');
reset role;
insert into feature_flags values(public.fixture_id(1),'new_dawn.invoice_job_pair_source_preview','true');
set role authenticated;
do $$declare r jsonb;begin
 r:={CALL};
 if r->>'relationship'<>'unverified' or r->>'audience'<>'openfolk_operator_only'
  or r#>>'{{invoice,version_id}}'<>public.fixture_id(30)::text
  or r#>>'{{job,version_id}}'<>public.fixture_id(50)::text
  or r#>>'{{job,job_number}}'<>'001'
  or r#>>'{{invoice,custom_fields,0,value}}'<>'PO-12'
  or r#>>'{{job,customer_reference}}'<>'PO-12'
  or r ? 'amount' or r ? 'balance' or r ? 'linked' or r->'invoice' ? 'balance'
  or r->'job' ? 'amount' or r->>'audit_id' is null then
  raise exception 'exact-pair response invalid: %',r;end if;
end$$;
select fixture_denied('select public.new_dawn_invoice_job_pair_source(public.fixture_id(1),public.fixture_id(31),public.fixture_id(40),''old invoice'')');
select fixture_denied('select public.new_dawn_invoice_job_pair_source(public.fixture_id(1),public.fixture_id(32),public.fixture_id(40),''other tenant invoice'')');
select fixture_denied('select public.new_dawn_invoice_job_pair_source(public.fixture_id(1),public.fixture_id(33),public.fixture_id(40),''other realm invoice'')');
select fixture_denied('select public.new_dawn_invoice_job_pair_source(public.fixture_id(1),public.fixture_id(30),public.fixture_id(41),''unreviewed job'')');
select fixture_denied('select public.new_dawn_invoice_job_pair_source(public.fixture_id(1),public.fixture_id(30),public.fixture_id(42),''other tenant job'')');
reset role;
update public.learn_quickbooks_latest set conflicted=true where tenant_id=public.fixture_id(1);
set role authenticated;
select fixture_denied('select {DENIED_CALL}');
reset role;
update public.learn_quickbooks_latest set conflicted=false,last_observed_at=now()-interval '8 days' where tenant_id=public.fixture_id(1);
set role authenticated;
select fixture_denied('select {DENIED_CALL}');
reset role;
update public.learn_quickbooks_latest set last_observed_at=now()-interval '30 minutes' where tenant_id=public.fixture_id(1);
update public.jobs set metadata='{{}}' where id=public.fixture_id(40);
set role authenticated;
select fixture_denied('select {DENIED_CALL}');
reset role;
update public.jobs set metadata=jsonb_build_object('learn_business_input',jsonb_build_object(
  'source_version_id',public.fixture_id(50),'connection_id',public.fixture_id(22))) where id=public.fixture_id(40);
insert into public.learn_business_input_versions values
 (public.fixture_id(51),public.fixture_id(1),public.fixture_id(22),'commusoft','jobs','345',repeat('f',64),
  '{{"id":345,"customerReference":"changed"}}',now()-interval '1 hour');
set role authenticated;
select fixture_denied('select {DENIED_CALL}');
reset role;
delete from public.learn_business_input_versions where id=public.fixture_id(51);
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000091';
set role authenticated;
select fixture_denied('select {DENIED_CALL}');
reset role;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000090';
set request.jwt.claim.role='anon';
set role anon;
select fixture_denied('select {DENIED_CALL}');
reset role;
select case when (select count(*) from public.learn_quickbooks_finance_events)=1
 and (select event from public.learn_quickbooks_finance_events)='invoice.job_pair_source_read'
 and (select detail->>'relationship' from public.learn_quickbooks_finance_events)='unverified'
 and (select detail->>'invoice_version_id' from public.learn_quickbooks_finance_events)=public.fixture_id(30)::text
 and (select detail->>'job_source_version_id' from public.learn_quickbooks_finance_events)=public.fixture_id(50)::text
 then 'PASS: operator-only, tenant/realm/version guards, default-off, audit and unverified response'
 else 'FAIL: audit or source contract' end;
"""


try:
    run("run", "-d", "--pull=never", "--network", "none", "--name", NAME,
        "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:15")
    for _ in range(40):
        ready = subprocess.run([DOCKER, "exec", NAME, "pg_isready", "-h",
                                "127.0.0.1", "-U", "postgres"], capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(.25)
    else:
        raise RuntimeError("Isolated PostgreSQL did not become ready")
    source = MIGRATION.read_text()
    rollback = source.replace("\ncommit;\n", "\nrollback;\n")
    if rollback == source:
        raise RuntimeError("Migration rollback boundary not found")
    result = run("exec", "-i", NAME, "psql", "-X", "-qAt", "-h", "127.0.0.1",
                 "-U", "postgres", "-v", "ON_ERROR_STOP=1", input=SCHEMA + "\n" +
                 rollback + "\nselect to_regprocedure('public.new_dawn_invoice_job_pair_source(uuid,uuid,uuid,text)') is null;")
    if result != "t":
        raise RuntimeError("Migration rollback retained the RPC")
    result = run("exec", "-i", NAME, "psql", "-X", "-qAt", "-h", "127.0.0.1",
                 "-U", "postgres", "-v", "ON_ERROR_STOP=1", input=source + "\n" + ASSERTIONS)
    if not result.endswith("PASS: operator-only, tenant/realm/version guards, default-off, audit and unverified response"):
        raise RuntimeError("Exact-pair fixture did not pass: " + result[-1000:])
    print(result.splitlines()[-1])
finally:
    subprocess.run([DOCKER, "rm", "-f", NAME], capture_output=True, timeout=30)
