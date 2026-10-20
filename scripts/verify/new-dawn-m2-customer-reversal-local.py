"""Network-disabled PostgreSQL proof of customer source-link reversal."""
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAME = 'new-dawn-customer-reverse-' + uuid.uuid4().hex[:8]
DB = 'postgres'
CREATED = False
TENANT = '00000000-0000-0000-0000-000000000001'
OTHER = '00000000-0000-0000-0000-000000000002'
ACTOR = '10000000-0000-4000-8000-000000000001'
CONNECTION = '10000000-0000-4000-8000-000000000002'
SOURCE = '10000000-0000-4000-8000-000000000003'
NEW_SOURCE = '10000000-0000-4000-8000-000000000004'
LINK = '10000000-0000-4000-8000-000000000005'
CARD = '10000000-0000-4000-8000-000000000006'
PERSON = '10000000-0000-4000-8000-000000000007'
SITE_LINK = '10000000-0000-4000-8000-000000000008'


def run(sql):
    result = subprocess.run(
        ['docker', 'exec', '-i', NAME, 'psql', '-h', '127.0.0.1',
         '-U', 'supabase_admin', '-d', DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'],
        input=sql, text=True, capture_output=True, timeout=60,
    )
    if result.returncode:
        raise RuntimeError(result.stderr[-6000:])
    return result.stdout.strip()


try:
    subprocess.run(
        ['docker', 'run', '-d', '--pull=never', '--network', 'none', '--name', NAME,
         '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
         'public.ecr.aws/supabase/postgres:17.6.1.141'],
        capture_output=True, check=True, timeout=30,
    )
    CREATED = True
    for _ in range(100):
        try:
            if run('select 1') == '1':
                break
        except RuntimeError:
            time.sleep(.25)
    else:
        raise RuntimeError('Disposable PostgreSQL unavailable')
    run('create database new_dawn_customer_reverse_test template template0')
    DB = 'new_dawn_customer_reverse_test'
    run(f"""
      create schema if not exists auth;
      create or replace function auth.uid() returns uuid language sql stable as $$
       select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      do $$begin if not exists(select 1 from pg_roles where rolname='learn_card_communication_reader')
       then create role learn_card_communication_reader;end if;end$$;
      create table public.tenants(id uuid primary key,status text);
      create table public.profiles(id uuid primary key);
      create table public.provider_connections(id uuid primary key,tenant_id uuid,provider text,
       status text,revoked_at timestamptz,verified_at timestamptz);
      create table public.feature_flags(tenant_id uuid,flag text,value jsonb);
      create table public.tenant_connectors(tenant_id uuid,provider text,connector_id text,
       enabled boolean,status text);
      create table public.learn_business_input_versions(id uuid primary key,
       tenant_id uuid,connection_id uuid,provider text,collection text,external_id text,payload jsonb);
      create table public.learn_business_input_links(id uuid primary key,tenant_id uuid,
       connection_id uuid,provider text,collection text,external_id text,
       source_version_id uuid,entity_kind text,entity_table text,entity_id uuid,
       card_id uuid,request jsonb,actor_id uuid,created_at timestamptz default clock_timestamp());
      create table public.learn_business_input_refreshes(tenant_id uuid,link_id uuid,
       source_version_id uuid,revision integer);
      create table public.new_dawn_commusoft_exact_link_events(tenant_id uuid,link_id uuid,
       action text,created_at timestamptz,id uuid);
      create table public.new_dawn_commusoft_exact_site_events(tenant_id uuid,link_id uuid,
       action text,created_at timestamptz,id uuid);
      create table public.people(id uuid primary key,tenant_id uuid);
      create table public.companies(id uuid primary key,tenant_id uuid);
      create table public.customer_cards(id uuid primary key,tenant_id uuid,
       person_id uuid,company_id uuid);
      create table public.controlplane_change_log(id uuid,tenant_id uuid,actor text,
       action text,resource_type text,resource_id text,after jsonb,reason text,
       correlation_id text,view_as_active boolean,source text);
      create or replace function public.learn_business_input_retain() returns trigger
       language plpgsql as $$begin raise exception 'immutable';end$$;
      create or replace function public.learn_operator_input_access(p_tenant uuid,
       p_actor uuid,p_write boolean) returns void language plpgsql as $$begin
       if p_tenant<>'{TENANT}'::uuid or p_actor<>'{ACTOR}'::uuid or not p_write
       then raise exception 'operator_denied' using errcode='42501';end if;
       end$$;
      create or replace function public.learn_business_input_latest(p_tenant uuid,p_connection uuid,
       p_provider text,p_collection text,p_external text)
       returns public.learn_business_input_versions language sql stable as $$
       select v from public.learn_business_input_versions v where v.tenant_id=p_tenant
        and v.connection_id=p_connection and v.provider=p_provider
        and v.collection=p_collection and v.external_id=p_external
        and v.id=nullif(current_setting('test.latest_version',true),'')::uuid $$;
      create view public.learn_business_input_current_links as
       select l.id,l.tenant_id,l.connection_id,l.provider,l.collection,l.external_id,
        coalesce(r.source_version_id,l.source_version_id) source_version_id,
        l.entity_kind,l.entity_table,l.entity_id,l.card_id,l.request,l.actor_id,l.created_at
       from public.learn_business_input_links l left join lateral (
        select x.source_version_id from public.learn_business_input_refreshes x
        where x.tenant_id=l.tenant_id and x.link_id=l.id order by x.revision desc limit 1) r on true;
      insert into public.tenants values('{TENANT}','active'),('{OTHER}','active');
      insert into public.profiles values('{ACTOR}');
      insert into public.provider_connections values
       ('{CONNECTION}','{TENANT}','commusoft','configured',null,clock_timestamp()-interval '1 day');
      insert into public.feature_flags values
       ('{TENANT}','learn.enabled','true'),
       ('{TENANT}','learn.inputs.commusoft.enabled','true');
      insert into public.tenant_connectors values
       ('{TENANT}','commusoft','commusoft',true,'active');
      insert into public.learn_business_input_versions values
       ('{SOURCE}','{TENANT}','{CONNECTION}','commusoft','properties','21',
        '{{"id":21,"type":"customer"}}'),
       ('{NEW_SOURCE}','{TENANT}','{CONNECTION}','commusoft','properties','21',
        '{{"id":21,"type":"customer"}}');
      insert into public.people values('{PERSON}','{TENANT}');
      insert into public.customer_cards values('{CARD}','{TENANT}','{PERSON}',null);
      insert into public.learn_business_input_links values
       ('{LINK}','{TENANT}','{CONNECTION}','commusoft','properties','21',
        '{SOURCE}','customer','people','{PERSON}','{CARD}','{{}}','{ACTOR}',clock_timestamp());
    """)
    migration = (ROOT / 'supabase/migrations/' /
        '20261110200000_new_dawn_commusoft_customer_link_reversal.sql').read_text()
    run(migration)
    assert run(f"""select has_function_privilege('authenticated',
     'public.new_dawn_commusoft_customer_link_toggle(uuid,uuid,text,text)','execute')::text || ',' ||
     has_function_privilege('anon',
     'public.new_dawn_commusoft_customer_link_toggle(uuid,uuid,text,text)','execute')::text || ',' ||
     has_table_privilege('authenticated','public.new_dawn_commusoft_customer_link_events','select')::text;""") == 'true,false,false'
    assert run(f"select count(*) from public.learn_business_input_current_links where id='{LINK}'") == '1'

    # A dependent current site blocks reversal, even though the customer link
    # itself has no event row and was created before this migration.
    run(f"""insert into public.learn_business_input_links values
     ('{SITE_LINK}','{TENANT}','{CONNECTION}','commusoft','properties','31',
      '{SOURCE}','site','sites','{SITE_LINK}','{CARD}',
      '{{"parent_link_id":"{LINK}"}}','{ACTOR}',clock_timestamp());""")
    result = run(f"""select set_config('request.jwt.claim.sub','{ACTOR}',false);
     select public.new_dawn_commusoft_customer_link_toggle(
      '{TENANT}','{LINK}','reverse','Fixture dependency hold')->>'reason';""")
    assert result.splitlines()[-1] == 'customer_link_in_use', result
    assert run('select count(*) from public.new_dawn_commusoft_customer_link_events') == '0'
    run(f"""insert into public.new_dawn_commusoft_exact_site_events values
      ('{TENANT}','{SITE_LINK}','reversed',clock_timestamp(),gen_random_uuid());""")
    result = run(f"""select set_config('request.jwt.claim.sub','{ACTOR}',false);
     select public.new_dawn_commusoft_customer_link_toggle(
      '{TENANT}','{LINK}','reverse','Fixture dependency reversed')->>'state';""")
    assert result.splitlines()[-1] == 'reversed', result
    assert run(f"select count(*) from public.learn_business_input_current_links where id='{LINK}'") == '0'
    assert run(f"select count(*) from public.learn_business_input_links where id='{LINK}'") == '1'
    assert run('select count(*) from public.controlplane_change_log') == '1'
    result = run(f"""select set_config('request.jwt.claim.sub','{ACTOR}',false);
     select public.new_dawn_commusoft_customer_link_toggle(
      '{TENANT}','{LINK}','reverse','Idempotent fixture')->>'state';""")
    assert result.splitlines()[-1] == 'already_reversed', result
    assert run('select count(*) from public.new_dawn_commusoft_customer_link_events') == '1'

    # Restore is held when the current source version changed, then succeeds
    # only with the original version and valid card/target/connection.
    result = run(f"""select set_config('request.jwt.claim.sub','{ACTOR}',false);
     select set_config('test.latest_version','{NEW_SOURCE}',false);
     select public.new_dawn_commusoft_customer_link_toggle(
      '{TENANT}','{LINK}','restore','Stale source fixture')->>'reason';""")
    assert result.splitlines()[-1] == 'customer_source_changed', result
    result = run(f"""select set_config('request.jwt.claim.sub','{ACTOR}',false);
     select set_config('test.latest_version','{SOURCE}',false);
     select public.new_dawn_commusoft_customer_link_toggle(
      '{TENANT}','{LINK}','restore','Exact source fixture')->>'state';""")
    assert result.splitlines()[-1] == 'restored', result
    assert run(f"select count(*) from public.learn_business_input_current_links where id='{LINK}'") == '1'
    assert run('select count(*) from public.controlplane_change_log') == '2'
    print('PASS: customer link dependency guard, audited reversal, source-locked restore, grants and retained provenance')
finally:
    if CREATED:
        subprocess.run(['docker', 'rm', '-f', NAME], capture_output=True, timeout=30)
