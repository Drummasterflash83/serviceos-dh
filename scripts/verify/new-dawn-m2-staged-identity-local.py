"""Disposable, network-disabled PostgreSQL proof of staged exact-ID identity links.

The fixture contains invented IDs and people only. It never reads a provider or
LIVE tenant and never changes an existing local database.
"""
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAME = 'new-dawn-staged-identity-' + uuid.uuid4().hex[:8]
DB = 'postgres'
CREATED = False
TENANT = '00000000-0000-4000-8000-000000000001'
OTHER = '00000000-0000-4000-8000-000000000002'
ACTOR = '10000000-0000-4000-8000-000000000001'
CONNECTION = '10000000-0000-4000-8000-000000000002'
PROPERTY = '10000000-0000-4000-8000-000000000003'
JOB = '10000000-0000-4000-8000-000000000004'
BATCH = '10000000-0000-4000-8000-000000000005'


def run(sql):
    result = subprocess.run(
        ['docker', 'exec', '-i', NAME, 'psql', '-h', '127.0.0.1',
         '-U', 'supabase_admin', '-d', DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'],
        input=sql, text=True, capture_output=True, timeout=90,
    )
    if result.returncode:
        raise RuntimeError(result.stderr[-8000:])
    return result.stdout.strip()


def expect_error(sql, fragment):
    try:
        run(sql)
    except RuntimeError as error:
        assert fragment in str(error), str(error)
        return
    raise AssertionError('Expected error: ' + fragment)


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
    run('create database new_dawn_staged_identity_test template template0')
    DB = 'new_dawn_staged_identity_test'
    run(f"""
      create schema if not exists auth;
      create or replace function auth.uid() returns uuid language sql stable as $$
       select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create or replace function auth.role() returns text language sql stable as $$
       select nullif(current_setting('request.jwt.claim.role',true),'') $$;
      do $$begin if not exists(select 1 from pg_roles where rolname='learn_card_communication_reader')
       then create role learn_card_communication_reader;end if;end$$;
      create table public.tenants(id uuid primary key,status text);
      create table public.profiles(id uuid primary key,tenant_id uuid);
      create table public.provider_connections(id uuid primary key,tenant_id uuid,
       provider text,status text,revoked_at timestamptz,verified_at timestamptz);
      create table public.feature_flags(tenant_id uuid,flag text,value jsonb);
      create table public.tenant_connectors(tenant_id uuid,provider text,
       connector_id text,enabled boolean,status text);
      create table public.learn_business_input_versions(id uuid primary key,
       tenant_id uuid,connection_id uuid,provider text,collection text,
       external_id text,payload jsonb,created_at timestamptz default clock_timestamp());
      create table public.learn_business_input_pages(id uuid primary key,
       tenant_id uuid,connection_id uuid,provider text,collection text,
       committed_at timestamptz);
      create table public.learn_business_input_observations(
       page_id uuid,version_id uuid);
      create table public.learn_business_input_links(id uuid primary key default gen_random_uuid(),
       tenant_id uuid,connection_id uuid,provider text,collection text,external_id text,
       source_version_id uuid,entity_kind text,entity_table text,entity_id uuid,
       card_id uuid,request jsonb,actor_id uuid,created_at timestamptz default clock_timestamp(),
       unique(tenant_id,connection_id,provider,collection,external_id));
      create table public.learn_business_input_refreshes(tenant_id uuid,link_id uuid,
       source_version_id uuid,revision integer);
      create table public.new_dawn_commusoft_exact_link_events(
       id uuid primary key default gen_random_uuid(),tenant_id uuid,link_id uuid,
       action text,actor_id uuid,source_version_id uuid,rule text,reason text,
       created_at timestamptz default clock_timestamp());
      create table public.new_dawn_commusoft_exact_site_events(
       id uuid primary key default gen_random_uuid(),tenant_id uuid,link_id uuid,
       action text,actor_id uuid,source_version_id uuid,rule text,reason text,
       created_at timestamptz default clock_timestamp());
      create table public.new_dawn_commusoft_customer_link_events(
       id uuid primary key default gen_random_uuid(),tenant_id uuid,link_id uuid,
       action text,actor_id uuid,source_version_id uuid,reason text,
       created_at timestamptz default clock_timestamp());
      create table public.people(id uuid primary key default gen_random_uuid(),tenant_id uuid,
       display_name text,first_name text,last_name text,primary_email text,
       primary_phone text,address_text text,postcode text,verified boolean,
       created_source text,metadata jsonb);
      create table public.companies(id uuid primary key default gen_random_uuid(),tenant_id uuid,
       name text,phone text,address_text text,postcode text,verified boolean,
       created_source text,metadata jsonb);
      create table public.customer_cards(id uuid primary key default gen_random_uuid(),
       tenant_id uuid,person_id uuid,company_id uuid,title text,summary text,
       owner_id uuid,updated_at timestamptz default clock_timestamp(),metadata jsonb);
      create table public.sites(id uuid primary key default gen_random_uuid(),
       tenant_id uuid,source_system text,external_id text,person_id uuid,company_id uuid,
       label text,address_text text,postcode text,created_source text,verified boolean,
       metadata jsonb,unique(tenant_id,source_system,external_id));
      create table public.jobs(id uuid primary key default gen_random_uuid(),
       tenant_id uuid,source_system text,external_id text,job_number text,
       customer_person_id uuid,customer_company_id uuid,site_id uuid,title text,
       description text,status text,created_date timestamptz,
       completed_date timestamptz,created_source text,verified boolean,metadata jsonb,
       updated_at timestamptz default clock_timestamp(),
       unique(tenant_id,source_system,external_id));
      create table public.import_entity_links(tenant_id uuid,source_system text,
       entity_kind text,external_id text);
      create table public.controlplane_change_log(id uuid,tenant_id uuid,actor text,
       action text,resource_type text,resource_id text,after jsonb,reason text,
       correlation_id text,view_as_active boolean,source text);
      create or replace function public.learn_business_input_retain() returns trigger
       language plpgsql as $$begin raise exception 'immutable';end$$;
      create or replace function public.learn_operator_input_access(p_tenant uuid,
       p_actor uuid,p_write boolean) returns void language plpgsql as $$begin
       if p_tenant<>'{TENANT}'::uuid or p_actor<>'{ACTOR}'::uuid
       then raise exception 'operator_denied' using errcode='42501';end if;
       end$$;
      create or replace function public.learn_import_batch_authority(p_tenant uuid,
       p_actor uuid) returns void language plpgsql as $$begin
       if p_tenant<>'{TENANT}'::uuid or p_actor<>'{ACTOR}'::uuid
       then raise exception 'batch_authority_denied' using errcode='42501';end if;
       end$$;
      create or replace function public.learn_business_input_latest(p_tenant uuid,
       p_connection uuid,p_provider text,p_collection text,p_external text)
       returns public.learn_business_input_versions language sql stable as $$
       select v from public.learn_business_input_versions v
       where v.tenant_id=p_tenant and v.connection_id=p_connection
        and v.provider=p_provider and v.collection=p_collection
        and v.external_id=p_external order by v.created_at desc,v.id desc limit 1 $$;
      create or replace function public.learn_business_customer_summary(p_payload jsonb)
       returns jsonb language sql as $$select jsonb_build_object('address',
        p_payload->>'addressLine1')$$;
      create or replace function public.learn_business_input_text(p_payload jsonb,p_key text)
       returns text language sql as $$select p_payload->>p_key$$;
      create or replace function public.learn_commusoft_job_fields(p_payload jsonb,p_id text)
       returns jsonb language sql as $$select jsonb_build_object('state','ready',
        'fields',jsonb_build_object('title','Job '||p_id,'status','open',
        'created_date','2026-10-20T00:00:00Z'))$$;
      create view public.learn_business_input_current_links as
       select l.id,l.tenant_id,l.connection_id,l.provider,l.collection,l.external_id,
        coalesce(r.source_version_id,l.source_version_id) source_version_id,
        l.entity_kind,l.entity_table,l.entity_id,l.card_id,l.request,l.actor_id,l.created_at
       from public.learn_business_input_links l left join lateral (
        select x.source_version_id from public.learn_business_input_refreshes x
        where x.tenant_id=l.tenant_id and x.link_id=l.id
        order by x.revision desc limit 1) r on true;
      create or replace function public.learn_commusoft_review_customer(
       p_tenant uuid,p_actor uuid,p_version uuid,p_kind text,p_target uuid,p_reason text)
       returns jsonb language plpgsql as $$declare v public.learn_business_input_versions%rowtype;
        e uuid;c uuid;l uuid;begin
        select * into v from public.learn_business_input_versions where id=p_version;
        if p_kind='person' then
         insert into public.people(tenant_id,display_name,postcode) values
          (p_tenant,v.payload->'contact'->>'firstName',v.payload->>'postcode') returning id into e;
         insert into public.customer_cards(tenant_id,person_id,title)
          values(p_tenant,e,'Synthetic customer') returning id into c;
        else
         insert into public.companies(tenant_id,name,postcode) values
          (p_tenant,v.payload->>'companyName',v.payload->>'postcode') returning id into e;
         insert into public.customer_cards(tenant_id,company_id,title)
          values(p_tenant,e,'Synthetic customer') returning id into c;
        end if;
        insert into public.learn_business_input_links
         (tenant_id,connection_id,provider,collection,external_id,source_version_id,
          entity_kind,entity_table,entity_id,card_id,request,actor_id)
        values(p_tenant,v.connection_id,'commusoft','properties',v.external_id,p_version,
         'customer',case when p_kind='person' then 'people' else 'companies' end,
         e,c,'{{}}'::jsonb,p_actor) returning id into l;
        return jsonb_build_object('already',false,'entity_id',e,'link_id',l);
       end$$;
      create or replace function public.new_dawn_commusoft_exact_site_candidate(
       p_tenant uuid,p_connection uuid,p_external text,p_existing uuid default null)
       returns jsonb language sql stable as $$
       select jsonb_build_object('state','ready','site_version_id',s.id,
        'customer_link_id',l.id)
       from public.learn_business_input_versions s
       join public.learn_business_input_current_links l
        on l.tenant_id=s.tenant_id and l.connection_id=s.connection_id
        and l.external_id=s.payload->>'parentPropertyID' and l.entity_kind='customer'
       where s.tenant_id=p_tenant and s.connection_id=p_connection
        and s.collection='properties' and s.external_id=p_external $$;
      create or replace function public.new_dawn_commusoft_exact_link_candidate(
       p_tenant uuid,p_connection uuid,p_external text,p_ignore_link uuid default null)
       returns jsonb language sql stable as $$
       select jsonb_build_object('state','ready','job_version_id',j.id,
        'customer_link_id',c.id,'property_external_id',p.external_id,
        'site_id',s.entity_id,'site_link_id',s.id,
        'fields',jsonb_build_object('title','Work job','status','open'))
       from public.learn_business_input_versions j
       join public.learn_business_input_versions p
        on p.tenant_id=j.tenant_id and p.connection_id=j.connection_id
        and p.collection='properties' and p.external_id=j.payload->>'propertyID'
       join public.learn_business_input_current_links s
        on s.tenant_id=p.tenant_id and s.connection_id=p.connection_id
        and s.external_id=p.external_id and s.entity_kind='site'
       join public.learn_business_input_current_links c
        on c.tenant_id=p.tenant_id and c.connection_id=p.connection_id
        and c.external_id=p.payload->>'parentPropertyID' and c.entity_kind='customer'
       where j.tenant_id=p_tenant and j.connection_id=p_connection
        and j.collection='jobs' and j.external_id=p_external $$;
      create or replace view public.learn_business_input_current_links as
       select l.id,l.tenant_id,l.connection_id,l.provider,l.collection,l.external_id,
        coalesce(r.source_version_id,l.source_version_id) source_version_id,
        l.entity_kind,l.entity_table,l.entity_id,l.card_id,l.request,l.actor_id,l.created_at
       from public.learn_business_input_links l left join lateral (
        select x.source_version_id from public.learn_business_input_refreshes x
        where x.tenant_id=l.tenant_id and x.link_id=l.id
        order by x.revision desc limit 1) r on true;
      insert into public.tenants values('{TENANT}','active'),('{OTHER}','active');
      insert into public.profiles values('{ACTOR}','{TENANT}');
      insert into public.provider_connections values
       ('{CONNECTION}','{TENANT}','commusoft','configured',null,
        clock_timestamp()-interval '1 day');
      insert into public.feature_flags values
       ('{TENANT}','learn.enabled','true'),
       ('{TENANT}','learn.inputs.commusoft.enabled','true');
      insert into public.tenant_connectors values
       ('{TENANT}','commusoft','commusoft',true,'active');
      insert into public.learn_business_input_versions
       (id,tenant_id,connection_id,provider,collection,external_id,payload) values
       ('{PROPERTY}','{TENANT}','{CONNECTION}','commusoft','properties','21',
        '{{"id":21,"type":"customer","customerType":4,"companyName":"Synthetic Works A","addressLine1":"1 Synthetic Road","postcode":"AB1 2CD"}}'),
       ('{JOB}','{TENANT}','{CONNECTION}','commusoft','jobs','31',
        '{{"id":31,"propertyID":21}}');
    """)
    run((ROOT / 'supabase/migrations' /
         '20261101150000_learn_card_search.sql').read_text())
    for stamp in ('20261111100000', '20261111110000',
                  '20261111120000', '20261111130000', '20261111140000'):
        migration = next((ROOT / 'supabase/migrations').glob(stamp + '*.sql'))
        run(migration.read_text())

    assert run("select has_function_privilege('service_role',"
               "'public.new_dawn_m2_identity_apply_one(uuid,integer)','execute')") == 'f'
    assert run("select has_function_privilege('anon',"
               "'public.new_dawn_m2_identity_apply_group(uuid,text)','execute')") == 'f'
    assert run("select has_table_privilege('authenticated',"
               "'public.new_dawn_m2_direct_sites','select')") == 'f'
    items = f'''[{{"kind":"customer","shape":"customer","external_id":"21",
       "source_version_id":"{PROPERTY}","customer_external_id":null,
       "property_external_id":null,"customer_kind":"company"}},
      {{"kind":"site","shape":"direct","external_id":"21",
       "source_version_id":"{PROPERTY}","customer_external_id":"21",
       "property_external_id":null,"customer_kind":null}},
      {{"kind":"job","shape":"direct","external_id":"31",
       "source_version_id":"{JOB}","customer_external_id":"21",
       "property_external_id":"21","customer_kind":null}}]'''
    register = f"""select set_config('request.jwt.claim.sub','{ACTOR}',true);
     select public.new_dawn_m2_identity_batch_register('{BATCH}','{TENANT}',
      '{CONNECTION}', $json${items}$json$::jsonb,'{{"4":"company","5":"person"}}'::jsonb,
      repeat('a',64),'Synthetic reviewed kind and exact IDs')->>'state';"""
    assert run('begin; ' + register + ' commit;').splitlines()[-1] == 'prepared'
    assert run("select count(*) from public.learn_business_input_links") == '0'
    apply = f"""select set_config('request.jwt.claim.role','service_role',true);
      select public.new_dawn_m2_identity_apply_group('{BATCH}','21')->>'state';"""
    expect_error(f"select public.new_dawn_m2_identity_apply_group('{BATCH}','21')",
                 'staged_group_forbidden')
    expect_error('begin; ' + apply + ' commit;', 'staged_apply_disabled')
    assert run("select count(*) from public.learn_business_input_links") == '0'
    run(f"insert into public.feature_flags values('{TENANT}',"
        "'new_dawn.m2_staged_batch_apply','true')")
    assert run('begin; ' + apply + ' commit;').splitlines()[-1] == 'linked'
    assert run("select count(*) from public.learn_business_input_current_links") == '2'
    assert run("select count(*) from public.new_dawn_m2_current_direct_sites") == '1'
    assert run("select count(*) from public.jobs") == '1'
    assert run("select count(*) from public.new_dawn_m2_identity_items "
               "where state='linked'") == '3'
    search = f"""select set_config('request.jwt.claim.sub','{ACTOR}',true);
      select set_config('request.jwt.claim.role','authenticated',true);
      select jsonb_array_length(public.learn_card_search('{TENANT}',
       'job','Job 31',0,null)->'rows');"""
    assert run('begin; ' + search + ' commit;').splitlines()[-1] == '1'
    customer_search = search.replace("'job','Job 31'", "'customer','Synthetic customer'")
    assert run('begin; ' + customer_search + ' commit;').splitlines()[-1] == '1'
    expect_error(f"""begin;
      select set_config('request.jwt.claim.sub','{ACTOR}',true);
      select set_config('request.jwt.claim.role','authenticated',true);
      select public.new_dawn_m2_staged_search_visible('{OTHER}','job',
       '10000000-0000-4000-8000-000000000099');commit;""", 'operator_denied')
    assert run('begin; ' + apply + ' commit;').splitlines()[-1] == 'already_linked'
    # An unrelated current job on the new site must block reversal. Reversing
    # that dependent link then permits the staged group to reverse atomically.
    run(f"""insert into public.learn_business_input_versions
      (id,tenant_id,connection_id,provider,collection,external_id,payload)
      values('10000000-0000-4000-8000-000000000006','{TENANT}','{CONNECTION}',
       'commusoft','jobs','32','{{"id":32,"propertyID":21}}');
      insert into public.jobs(tenant_id,source_system,external_id,site_id)
      select '{TENANT}','commusoft:connection:{CONNECTION}','32',site_id
      from public.new_dawn_m2_current_direct_sites limit 1;
      insert into public.learn_business_input_links
       (tenant_id,connection_id,provider,collection,external_id,source_version_id,
        entity_kind,entity_table,entity_id,card_id,request,actor_id)
      select '{TENANT}','{CONNECTION}','commusoft','jobs','32',
       '10000000-0000-4000-8000-000000000006','job','jobs',j.id,d.card_id,
       '{{}}'::jsonb,'{ACTOR}' from public.jobs j
      join public.new_dawn_m2_current_direct_sites d on d.site_id=j.site_id
      where j.external_id='32';""")
    reverse = f"""select set_config('request.jwt.claim.role','service_role',true);
      select public.new_dawn_m2_identity_reverse_group('{BATCH}','21',
       'Synthetic operator-approved batch reversal')->>'state';"""
    expect_error('begin; ' + reverse + ' commit;', 'staged_site_in_use')
    assert run("select count(*) from public.new_dawn_m2_identity_items "
               "where state='linked'") == '3'
    run(f"""insert into public.new_dawn_m2_direct_job_events
      (tenant_id,link_id,action,actor_id,source_version_id,batch_id,reason)
      select '{TENANT}',id,'reversed','{ACTOR}',source_version_id,'{BATCH}',
       'Synthetic dependent review reversal' from public.learn_business_input_links
      where external_id='32' and collection='jobs';""")
    assert run('begin; ' + reverse + ' commit;').splitlines()[-1] == 'reversed'
    assert run("select count(*) from public.learn_business_input_current_links") == '0'
    assert run("select count(*) from public.new_dawn_m2_current_direct_sites") == '0'
    assert run("select count(*) from public.learn_business_input_links") == '3'
    assert run("select count(*) from public.jobs") == '2'
    assert run("select count(*) from public.new_dawn_m2_identity_items "
               "where state='reversed'") == '3'
    assert run('begin; ' + search + ' commit;').splitlines()[-1] == '0'
    assert run('begin; ' + customer_search + ' commit;').splitlines()[-1] == '0'
    run(f"""insert into public.jobs(tenant_id,source_system,external_id,
      job_number,title,status) values('{TENANT}','native','fixture-native',
      'N-1','Native job remains searchable','open');
      insert into public.customer_cards(tenant_id,title)
      values('{TENANT}','Native customer remains searchable');""")
    assert run('begin; ' + search.replace('Job 31','Native job') +
               ' commit;').splitlines()[-1] == '1'
    assert run('begin; ' + customer_search.replace('Synthetic customer',
               'Native customer') + ' commit;').splitlines()[-1] == '1'
    assert run('begin; ' + reverse + ' commit;').splitlines()[-1] == 'already_reversed'
    expect_error("update public.new_dawn_m2_direct_site_events set reason='tampered'",
                 'immutable')
    # A changed current source after registration holds the whole second group.
    second = '10000000-0000-4000-8000-000000000007'
    property2 = '10000000-0000-4000-8000-000000000008'
    job2 = '10000000-0000-4000-8000-000000000009'
    latest2 = '10000000-0000-4000-8000-000000000010'
    run(f"""insert into public.learn_business_input_versions
       (id,tenant_id,connection_id,provider,collection,external_id,payload) values
       ('{property2}','{TENANT}','{CONNECTION}','commusoft','properties','22',
        '{{"id":22,"type":"customer","customerType":4,"companyName":"Synthetic Works B","addressLine1":"2 Synthetic Road","postcode":"XY1 2ZZ"}}'),
       ('{job2}','{TENANT}','{CONNECTION}','commusoft','jobs','33',
        '{{"id":33,"propertyID":22}}');""")
    items2 = items.replace('"21"', '"22"').replace('"31"', '"33"') \
        .replace(PROPERTY, property2).replace(JOB, job2)
    register2 = register.replace(BATCH, second).replace(items, items2)
    assert run('begin; ' + register2 + ' commit;').splitlines()[-1] == 'prepared'
    run(f"""insert into public.learn_business_input_versions
       (id,tenant_id,connection_id,provider,collection,external_id,payload,
        created_at) values('{latest2}','{TENANT}','{CONNECTION}',
        'commusoft','properties','22',
        '{{"id":22,"type":"customer","customerType":4,"companyName":"Synthetic Works B","addressLine1":"Changed","postcode":"XY1 2ZZ"}}',
        clock_timestamp()+interval '1 second');""")
    held = apply.replace(BATCH, second).replace("'21'", "'22'")
    assert run('begin; ' + held + ' commit;').splitlines()[-1] == 'held'
    assert run(f"select count(*) from public.new_dawn_m2_identity_items "
               f"where batch_id='{second}' and state='held'") == '3'
    summary = f"""select set_config('request.jwt.claim.sub','{ACTOR}',true);
      select public.new_dawn_m2_identity_batch_summary('{second}')
       #>> '{{held_classes,0,jobs_affected}}';"""
    assert run('begin; ' + summary + ' commit;').splitlines()[-1] == '1'
    assert run("select has_function_privilege('anon',"
               "'public.new_dawn_m2_identity_batch_summary(uuid)','execute')") == 'f'
    assert run("select count(*) from public.companies") == '1'
    assert run("select count(*) from public.sites") == '1'
    # Work-address shape uses an independent property ID under the exact
    # customer ID; its site uses the canonical property link path.
    third = '10000000-0000-4000-8000-000000000011'
    customer3 = '10000000-0000-4000-8000-000000000012'
    work3 = '10000000-0000-4000-8000-000000000013'
    job3 = '10000000-0000-4000-8000-000000000014'
    run(f"""insert into public.learn_business_input_versions
       (id,tenant_id,connection_id,provider,collection,external_id,payload) values
       ('{customer3}','{TENANT}','{CONNECTION}','commusoft','properties','23',
        '{{"id":23,"type":"customer","customerType":4,"companyName":"Synthetic Works C","addressLine1":"3 Synthetic Road","postcode":"QR1 2ST"}}'),
       ('{work3}','{TENANT}','{CONNECTION}','commusoft','properties','24',
        '{{"id":24,"type":"workaddress","parentPropertyID":23,"addressLine1":"4 Synthetic Road","postcode":"QR3 4ST"}}'),
       ('{job3}','{TENANT}','{CONNECTION}','commusoft','jobs','34',
        '{{"id":34,"propertyID":24}}');""")
    items3 = f'''[{{"kind":"customer","shape":"customer","external_id":"23",
      "source_version_id":"{customer3}","customer_external_id":null,
      "property_external_id":null,"customer_kind":"company"}},
     {{"kind":"site","shape":"workaddress","external_id":"24",
      "source_version_id":"{work3}","customer_external_id":"23",
      "property_external_id":null,"customer_kind":null}},
     {{"kind":"job","shape":"workaddress","external_id":"34",
      "source_version_id":"{job3}","customer_external_id":"23",
      "property_external_id":"24","customer_kind":null}}]'''
    register3 = register.replace(BATCH, third).replace(items, items3)
    assert run('begin; ' + register3 + ' commit;').splitlines()[-1] == 'prepared'
    work_apply = apply.replace(BATCH, third).replace("'21'", "'23'")
    assert run('begin; ' + work_apply + ' commit;').splitlines()[-1] == 'linked'
    assert run("select count(*) from public.learn_business_input_current_links "
               "where external_id in ('23','24','34')") == '3'
    work_reverse = reverse.replace(BATCH, third).replace("'21'", "'23'")
    assert run('begin; ' + work_reverse + ' commit;').splitlines()[-1] == 'reversed'
    assert run("select count(*) from public.learn_business_input_current_links "
               "where external_id in ('23','24','34')") == '0'
    fourth = '10000000-0000-4000-8000-000000000015'
    property4 = '10000000-0000-4000-8000-000000000016'
    job4 = '10000000-0000-4000-8000-000000000017'
    run(f"""insert into public.learn_business_input_versions
       (id,tenant_id,connection_id,provider,collection,external_id,payload) values
       ('{property4}','{TENANT}','{CONNECTION}','commusoft','properties','25',
        '{{"id":25,"type":"customer","customerType":4,"companyName":"Synthetic Works D","addressLine1":"5 Synthetic Road","postcode":"CX1 3ZZ"}}'),
       ('{job4}','{TENANT}','{CONNECTION}','commusoft','jobs','35',
        '{{"id":35,"propertyID":25}}');
      insert into public.sites(tenant_id,source_system,external_id,postcode)
       values('{TENANT}','native','fixture-collision','CX1 3ZZ');""")
    items4 = items.replace('"21"', '"25"').replace('"31"', '"35"') \
        .replace(PROPERTY, property4).replace(JOB, job4)
    register4 = register.replace(BATCH, fourth).replace(items, items4)
    assert run('begin; ' + register4 + ' commit;').splitlines()[-1] == 'prepared'
    collision = apply.replace(BATCH, fourth).replace("'21'", "'25'")
    assert run('begin; ' + collision + ' commit;').splitlines()[-1] == 'held'
    assert run(f"select distinct hold_reason from public.new_dawn_m2_identity_items "
               f"where batch_id='{fourth}'") == 'site_postcode_collision'
    assert run("select count(*) from public.companies") == '2'
    assert run("select count(*) from public.learn_business_input_links "
               "where external_id='25'") == '0'
    fifth = '10000000-0000-4000-8000-000000000018'
    property5 = '10000000-0000-4000-8000-000000000019'
    job5 = '10000000-0000-4000-8000-000000000020'
    run(f"""insert into public.learn_business_input_versions
       (id,tenant_id,connection_id,provider,collection,external_id,payload) values
       ('{property5}','{TENANT}','{CONNECTION}','commusoft','properties','26',
        '{{"id":26,"type":"customer","customerType":5,"contact":{{"firstName":"Ellie","lastName":"Example"}},"addressLine1":"6 Synthetic Road","postcode":"PX1 3YZ"}}'),
       ('{job5}','{TENANT}','{CONNECTION}','commusoft','jobs','36',
        '{{"id":36,"propertyID":26}}');""")
    items5 = items.replace('"21"', '"26"').replace('"31"', '"36"') \
        .replace(PROPERTY, property5).replace(JOB, job5) \
        .replace('"customer_kind":"company"', '"customer_kind":"person"')
    register5 = register.replace(BATCH, fifth).replace(items, items5)
    assert run('begin; ' + register5 + ' commit;').splitlines()[-1] == 'prepared'
    person = apply.replace(BATCH, fifth).replace("'21'", "'26'")
    assert run('begin; ' + person + ' commit;').splitlines()[-1] == 'held'
    assert run(f"select distinct hold_reason from public.new_dawn_m2_identity_items "
               f"where batch_id='{fifth}'") == 'account_holder_review_required'
    assert run("select count(*) from public.people") == '0'
    run(f"""insert into public.learn_business_input_pages values
      ('10000000-0000-4000-8000-000000000021','{TENANT}','{CONNECTION}',
       'commusoft','properties',clock_timestamp()),
      ('10000000-0000-4000-8000-000000000022','{TENANT}','{CONNECTION}',
       'commusoft','jobs',clock_timestamp());
      insert into public.learn_business_input_observations
      select case when collection='properties' then
       '10000000-0000-4000-8000-000000000021'::uuid else
       '10000000-0000-4000-8000-000000000022'::uuid end,id
      from public.learn_business_input_versions where tenant_id='{TENANT}';""")
    snapshot_sql = (ROOT / 'scripts/verify' /
                    'new-dawn-m2-identity-snapshot.sql').read_text()
    result = subprocess.run(
        ['docker', 'exec', '-i', NAME, 'psql', '-h', '127.0.0.1',
         '-U', 'supabase_admin', '-d', DB, '-XAtq', '-v', 'ON_ERROR_STOP=1',
         '-v', f'tenant_id={TENANT}', '-v', f'connection_id={CONNECTION}'],
        input=snapshot_sql, text=True, capture_output=True, timeout=90,
    )
    assert result.returncode == 0, result.stderr[-5000:]
    snapshot_rows = [line for line in result.stdout.splitlines()
                     if line.startswith('{')]
    assert snapshot_rows and '"kind": "scope"' in snapshot_rows[0]
    assert '"kind": "end"' in snapshot_rows[-1]
    assert sum('"kind": "source_version"' in line
               for line in snapshot_rows) >= 10
    print('PASS: isolated migrations, OFF gate, direct identity, immutable audit, '
          'work-address identity, dependency/stale/collision/person holds, '
          'client search reversal and tenant denial')
finally:
    if CREATED:
        subprocess.run(['docker', 'rm', '-f', NAME], capture_output=True, timeout=30)
