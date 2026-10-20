"""Network-disabled PostgreSQL proof of the ten-ID customer spot-check route."""
import json
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
NAME = 'new-dawn-customer-spotcheck-' + uuid.uuid4().hex[:8]
DB = 'postgres'
CREATED = False
TENANT = '00000000-0000-0000-0000-000000000001'
OTHER = '00000000-0000-0000-0000-000000000002'
ACTOR = '10000000-0000-4000-8000-000000000001'
CONNECTION = '10000000-0000-4000-8000-000000000002'
SECRET = '10000000-0000-4000-8000-000000000003'
BATCH = '10000000-0000-4000-8000-000000000004'


def run(sql):
    result = subprocess.run(['docker', 'exec', '-i', NAME, 'psql', '-h', '127.0.0.1',
        '-U', 'supabase_admin', '-d', DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'],
        input=sql, text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr[-6000:])
    return result.stdout.strip()


def expect_fail(sql, fragment):
    try:
        run(sql)
    except RuntimeError as error:
        if fragment not in str(error):
            raise
    else:
        raise AssertionError('Expected refusal: ' + fragment)


try:
    subprocess.run(['docker', 'run', '-d', '--pull=never', '--network', 'none', '--name', NAME,
        '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'public.ecr.aws/supabase/postgres:17.6.1.141'],
        capture_output=True, check=True, timeout=30)
    CREATED = True
    for _ in range(100):
        try:
            if run('select 1') == '1':
                break
        except RuntimeError:
            time.sleep(.25)
    else:
        raise RuntimeError('Disposable PostgreSQL unavailable')
    run('create database new_dawn_customer_spotcheck_test template template0')
    DB = 'new_dawn_customer_spotcheck_test'
    run(f"""
      create schema if not exists auth;
      create schema if not exists vault;
      create or replace function auth.uid() returns uuid language sql stable as $$
       select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create or replace function auth.role() returns text language sql stable as $$
       select nullif(current_setting('request.jwt.claim.role',true),'') $$;
      create table public.tenants(id uuid primary key,status text);
      create table public.profiles(id uuid primary key);
      create table public.provider_connections(id uuid primary key,tenant_id uuid,provider text,
       status text,auth_mode text,revoked_at timestamptz,verified_at timestamptz,
       updated_at timestamptz,non_secret_config jsonb,secret_refs jsonb);
      create table public.feature_flags(tenant_id uuid,flag text,value jsonb);
      create table public.tenant_connectors(tenant_id uuid,provider text,connector_id text,
       enabled boolean,status text);
      create table public.platform_jobs(tenant_id uuid,job_type text,status text);
      create table public.learn_business_input_versions(id uuid primary key,
       tenant_id uuid,connection_id uuid,provider text,collection text,external_id text,payload jsonb);
      create table public.learn_business_input_request_gates(credential_fingerprint text primary key,
       next_allowed_at timestamptz);
      create table public.controlplane_change_log(id uuid,tenant_id uuid,actor text,
       action text,resource_type text,resource_id text,after jsonb,reason text,
       correlation_id text,view_as_active boolean,source text);
      create table vault.decrypted_secrets(id uuid,name text,decrypted_secret text);
      create or replace function public.learn_business_input_retain() returns trigger
       language plpgsql as $$begin raise exception 'immutable';end$$;
      create or replace function public.learn_operator_input_access(p_tenant uuid,
       p_actor uuid,p_write boolean) returns void language plpgsql as $$begin
       if p_tenant<>'{TENANT}'::uuid or p_actor<>'{ACTOR}'::uuid or not p_write
       then raise exception 'operator_denied' using errcode='42501';end if;end$$;
      create or replace function public.new_dawn_commusoft_job_actor_access(p_tenant uuid,p_actor uuid)
       returns void language plpgsql as $$begin
       if p_tenant<>'{TENANT}'::uuid or p_actor<>'{ACTOR}'::uuid
       then raise exception 'actor_denied' using errcode='42501';end if;end$$;
      create or replace function public.learn_business_input_latest(p_tenant uuid,p_connection uuid,
       p_provider text,p_collection text,p_external text)
       returns public.learn_business_input_versions language sql stable as $$
       select v from public.learn_business_input_versions v where v.tenant_id=p_tenant
        and v.connection_id=p_connection and v.provider=p_provider
        and v.collection=p_collection and v.external_id=p_external
        order by v.id desc limit 1 $$;
      insert into public.tenants values('{TENANT}','active'),('{OTHER}','active');
      insert into public.profiles values('{ACTOR}');
      insert into public.provider_connections values
       ('{CONNECTION}','{TENANT}','commusoft','configured','private_api_key',null,
        clock_timestamp()-interval '1 day',clock_timestamp(),
        '{{"region":"uk"}}','{{"api_key":"{SECRET}"}}');
      insert into public.feature_flags values
       ('{TENANT}','learn.enabled','true'),
       ('{TENANT}','learn.inputs.commusoft.enabled','true'),
       ('{TENANT}','new_dawn.m2_customer_spotcheck','true');
      insert into public.tenant_connectors values
       ('{TENANT}','commusoft','commusoft',true,'active');
      insert into vault.decrypted_secrets values
       ('{SECRET}','provider_secret:{TENANT}:commusoft:api_key','fixture-key');
    """)
    items = []
    for index in range(1, 11):
        source = f'20000000-0000-4000-8000-{index:012d}'
        items.append({'external_id': str(index), 'source_version_id': source})
        run(f"""insert into public.learn_business_input_versions values
         ('{source}','{TENANT}','{CONNECTION}','commusoft','properties','{index}',
          '{{"id":{index},"type":"customer","customerType":2,
            "companyName":"Fixture {index}","contact":{{"firstName":"Test","lastName":"Person"}},
            "postcode":"A1 2BC"}}');""")
    migration = (ROOT / 'supabase/migrations/20261110220000_new_dawn_commusoft_customer_spotcheck.sql').read_text()
    run(migration)
    assert run("""select has_function_privilege('authenticated',
     'public.new_dawn_commusoft_customer_spotcheck_register(uuid,uuid,jsonb,text)','execute')::text || ',' ||
     has_function_privilege('anon',
     'public.new_dawn_commusoft_customer_spotcheck_register(uuid,uuid,jsonb,text)','execute')::text || ',' ||
     has_table_privilege('authenticated','public.new_dawn_commusoft_customer_spotcheck_items','select')::text;
    """) == 'true,false,false'
    payload = json.dumps(items)
    result = run(f"""select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','{ACTOR}',false);
      select public.new_dawn_commusoft_customer_spotcheck_register(
       '{TENANT}','{BATCH}','{payload}'::jsonb,'Ten exact fixture customers')->>'state';""")
    assert result.splitlines()[-1] == 'prepared', result
    assert run('select count(*) from public.new_dawn_commusoft_customer_spotcheck_items') == '11'
    assert run('select count(*) from public.controlplane_change_log') == '1'
    # The one-batch tenant key cannot admit a second, arbitrary sample, and the
    # other tenant cannot use the first tenant's retained source/connection.
    expect_fail(f"""select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','{ACTOR}',false);
      select public.new_dawn_commusoft_customer_spotcheck_register(
       '{TENANT}',gen_random_uuid(),'{payload}'::jsonb,'Duplicate fixture run');""", 'duplicate key')
    expect_fail(f"""select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','{ACTOR}',false);
      select public.new_dawn_commusoft_customer_spotcheck_register(
       '{OTHER}',gen_random_uuid(),'{payload}'::jsonb,'Wrong tenant fixture');""", 'operator_denied')
    assert run('select count(*) from public.new_dawn_commusoft_customer_spotcheck_batches') == '1'
    result = run(f"""select set_config('request.jwt.claim.role','service_role',false);
      select public.new_dawn_commusoft_customer_spotcheck_acquire('{BATCH}',1)->>'state';""")
    assert result.splitlines()[-1] == 'ready', result
    assert run(f"""select set_config('request.jwt.claim.role','service_role',false);
      select public.new_dawn_commusoft_customer_spotcheck_current('{BATCH}',1);""").splitlines()[-1] == 't'
    run(f"""update public.feature_flags set value='false' where tenant_id='{TENANT}'
      and flag='new_dawn.m2_customer_spotcheck';""")
    assert run(f"""select set_config('request.jwt.claim.role','service_role',false);
      select public.new_dawn_commusoft_customer_spotcheck_current('{BATCH}',1);""").splitlines()[-1] == 'f'
    run(f"""update public.feature_flags set value='true' where tenant_id='{TENANT}'
      and flag='new_dawn.m2_customer_spotcheck';""")
    raw = json.dumps({'id': 1, 'type': 'customer', 'customerType': 2,
        'companyName': 'Fixture 1', 'contact': {'firstName': 'Test', 'lastName': 'Person'},
        'postcode': 'A12BC'})
    result = run(f"""select set_config('request.jwt.claim.role','service_role',false);
      select public.new_dawn_commusoft_customer_spotcheck_finish(
       '{BATCH}',1,'{raw}')->>'state';""")
    assert result.splitlines()[-1] == 'complete', result
    assert run(f"select result->>'postcode_matches' from public.new_dawn_commusoft_customer_spotcheck_items where batch_id='{BATCH}' and ordinal=1") == 'true'
    assert run(f"""select set_config('request.jwt.claim.role','service_role',false);
      select public.new_dawn_commusoft_customer_spotcheck_current('{BATCH}',1);""").splitlines()[-1] == 'f'
    # An existing permit cannot read a corrected parent source version.
    run(f"""insert into public.learn_business_input_versions values
      ('30000000-0000-4000-8000-000000000002','{TENANT}','{CONNECTION}',
       'commusoft','properties','2',
       '{{"id":2,"type":"customer","customerType":2,"companyName":"Corrected"}}');""")
    expect_fail(f"""select set_config('request.jwt.claim.role','service_role',false);
      select public.new_dawn_commusoft_customer_spotcheck_acquire('{BATCH}',2);""", 'spotcheck_scope_changed')
    assert run(f"""select state from public.new_dawn_commusoft_customer_spotcheck_items
      where batch_id='{BATCH}' and ordinal=2""") == 'prepared'
    # The one optional taxonomy GET has a separate ordinal, the same pacing
    # gate, and a fail-closed structured response rather than inferred kinds.
    run("update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second'")
    result = run(f"""select set_config('request.jwt.claim.role','service_role',false);
      select public.new_dawn_commusoft_customer_spotcheck_acquire('{BATCH}',0)->>'resource';""")
    assert result.splitlines()[-1] == 'customer_types', result
    types_raw = json.dumps([{'id': 2, 'name': 'Company', 'companyNameRequired': 'Yes'}])
    result = run(f"""select set_config('request.jwt.claim.role','service_role',false);
      select public.new_dawn_commusoft_customer_spotcheck_finish(
       '{BATCH}',0,'{types_raw}')->>'resource';""")
    assert result.splitlines()[-1] == 'customer_types', result
    assert run(f"select result->'types'->0->>'name' from public.new_dawn_commusoft_customer_spotcheck_items where batch_id='{BATCH}' and ordinal=0") == 'Company'
    assert run(f"""select set_config('request.jwt.claim.role','service_role',false);
      select public.new_dawn_commusoft_customer_spotcheck_current('{BATCH}',0);""").splitlines()[-1] == 'f'
    assert run('select count(*) from public.controlplane_change_log') == '3'
    print('PASS: ten exact source-bound GET permits, one optional taxonomy read, lease, audit, two-tenant and replay refusal')
finally:
    if CREATED:
        subprocess.run(['docker', 'rm', '-f', NAME], capture_output=True, timeout=30)
