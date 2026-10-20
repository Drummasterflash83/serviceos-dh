"""Network-disabled two-tenant PostgreSQL fixture for the aggregate roster query."""
import json
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAME = 'new-dawn-roster-' + uuid.uuid4().hex[:8]
TENANT = '00000000-0000-0000-0000-000000000001'
OTHER = '00000000-0000-0000-0000-000000000002'
DATABASE = 'postgres'
CREATED = False


def ident(n):
    return f'10000000-0000-4000-8000-{n:012d}'


def run(sql):
    result = subprocess.run(
        ['docker', 'exec', '-i', NAME, 'psql', '-h', '127.0.0.1',
         '-U', 'supabase_admin', '-d', DATABASE, '-XAtq', '-v', 'ON_ERROR_STOP=1'],
        input=sql, text=True, capture_output=True, timeout=60,
    )
    if result.returncode:
        raise RuntimeError(result.stderr[-5000:])
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
    run('create database new_dawn_roster_test template template0')
    DATABASE = 'new_dawn_roster_test'
    run("""
      create table public.provider_connections(
       id uuid primary key,tenant_id uuid,provider text,status text,revoked_at timestamptz);
      create table public.learn_business_input_versions(
       id uuid primary key,tenant_id uuid,connection_id uuid,provider text,
       collection text,external_id text,payload jsonb);
      create table public.learn_business_input_pages(
       id uuid primary key,tenant_id uuid,connection_id uuid,provider text,
       collection text,committed_at timestamptz);
      create table public.learn_business_input_observations(
       version_id uuid,page_id uuid);
      create table public.learn_business_input_current_links(
       id uuid,tenant_id uuid,connection_id uuid,provider text,collection text,
       external_id text,source_version_id uuid,entity_kind text,entity_table text,
       entity_id uuid,card_id uuid);
      create table public.customer_cards(id uuid,tenant_id uuid,person_id uuid,company_id uuid);
      create table public.people(id uuid,tenant_id uuid);
      create table public.companies(id uuid,tenant_id uuid);
      create table public.sites(id uuid,tenant_id uuid,postcode text,
       source_system text,external_id text);
      create table public.import_entity_links(
       id uuid,tenant_id uuid,source_system text,entity_kind text,
       external_id text,entity_id uuid,entity_table text);
    """)
    run(f"""
      insert into public.provider_connections values
       ('{ident(100)}','{TENANT}','commusoft','configured',null),
       ('{ident(200)}','{OTHER}','commusoft','configured',null);
      insert into public.learn_business_input_pages values
       ('{ident(101)}','{TENANT}','{ident(100)}','commusoft','jobs','2026-10-20T12:00:00Z'),
       ('{ident(102)}','{TENANT}','{ident(100)}','commusoft','properties','2026-10-20T12:00:00Z'),
       ('{ident(201)}','{OTHER}','{ident(200)}','commusoft','jobs','2026-10-20T12:00:00Z');
      insert into public.people values('{ident(300)}','{TENANT}');
      insert into public.customer_cards values
       ('{ident(301)}','{TENANT}','{ident(300)}',null);
      insert into public.learn_business_input_current_links values
       ('{ident(302)}','{TENANT}','{ident(100)}','commusoft','properties',
        '22','{ident(422)}','customer','people','{ident(300)}','{ident(301)}'),
       ('{ident(303)}','{TENANT}','{ident(100)}','commusoft','properties',
        '15','{ident(415)}','site','sites','{ident(350)}','{ident(301)}');
      insert into public.sites(id,tenant_id,postcode)
       values('{ident(350)}','{TENANT}','AA1 1AA');
    """)

    def source(version, collection, external, payload, tenant=TENANT, connection=100):
        page = 101 if collection == 'jobs' else 102
        if tenant == OTHER:
            page = 201
        data = json.dumps(payload).replace("'", "''")
        run(f"""insert into public.learn_business_input_versions values
          ('{ident(version)}','{tenant}','{ident(connection)}','commusoft',
           '{collection}','{external}','{data}'::jsonb);
          insert into public.learn_business_input_observations values
          ('{ident(version)}','{ident(page)}');""")

    source(411, 'properties', '11', {'id': 11, 'type': 'customer'})
    source(412, 'properties', '12', {'id': 12, 'type': 'workaddress',
                                      'parentPropertyID': 21, 'addressLine1': 'A',
                                      'postcode': 'AB1 1AB'})
    source(413, 'properties', '13', {'id': 13, 'type': 'workaddress',
                                      'parentPropertyID': 22, 'addressLine1': 'B',
                                      'postcode': 'AA1 1AA'})
    source(414, 'properties', '14', {'id': 14, 'type': 'workaddress',
                                      'parentPropertyID': 22, 'addressLine1': 'C',
                                      'postcode': 'CC1 1CC'})
    source(415, 'properties', '15', {'id': 15, 'type': 'workaddress',
                                      'parentPropertyID': 22, 'addressLine1': 'D',
                                      'postcode': 'DD1 1DD'})
    source(416, 'properties', '16', {'id': 16, 'type': 'workaddress',
                                      'parentPropertyID': 22, 'addressLine1': '',
                                      'postcode': 'EE1 1EE'})
    source(421, 'properties', '21', {'id': 21, 'type': 'customer'})
    source(422, 'properties', '22', {'id': 22, 'type': 'customer'})
    for job, prop in [(1, 11), (2, 12), (3, 13), (4, 14),
                      (5, 14), (6, 14), (7, 15), (8, 16)]:
        source(500 + job, 'jobs', str(job), {'id': job, 'propertyID': prop})
    # Job 6 has two distinct versions on the same latest committed page.
    source(606, 'jobs', '6', {'id': 6, 'propertyID': 14})
    source(701, 'jobs', '1', {'id': 1, 'propertyID': 99}, OTHER, 200)

    query = (ROOT / 'scripts/verify/sql/new-dawn-m1-roster-first-hold.sql').read_text()
    row = json.loads(run('select row_to_json(x) from (' +
                         query.replace('__TENANT__', TENANT).rstrip().rstrip(';') +
                         ') x;'))
    assert row['configured_connections'] == 1
    assert row['observed_job_ids'] == row['unlinked_job_ids'] == 8
    assert row['ambiguous_latest_job_ids'] == 1
    assert row['ambiguous_latest_property_ids'] == 0
    assert row['job_first_holds'] == {
        'job_source_hold': 1,
        'customer_property_outside_dual_id': 1,
        'customer_identity_unreviewed': 1,
        'postcode_collision': 1,
        'site_mapping_review': 1,
        'site_source_other_hold': 1,
        'provisional_site_review': 2,
    }, row['job_first_holds']
    assert row['distinct_property_ids_by_first_hold']['provisional_site_review'] == 1
    print('PASS: two-tenant first-hold partition, tied source replay, collision and provisional counts')

    # The M2 parent-path classifier must collapse multiple held work addresses
    # to one source parent, keep another tenant's exact identity out, and hold
    # a parent whose latest committed observation becomes ambiguous.
    source(417, 'properties', '17', {'id': 17, 'type': 'workaddress',
                                      'parentPropertyID': 21, 'addressLine1': 'F',
                                      'postcode': 'FF1 1FF'})
    source(509, 'jobs', '9', {'id': 9, 'propertyID': 17})
    run(f"""insert into public.import_entity_links values
     ('{ident(801)}','{OTHER}','commusoft','customer','21','{ident(300)}','people');""")
    generated = subprocess.run(
        ['node', '--input-type=module', '-e',
         "import { QUERY } from './scripts/verify/new-dawn-m2-parent-identity-readback.mjs'; console.log(QUERY)"],
        cwd=ROOT, text=True, capture_output=True, check=True, timeout=10,
    ).stdout

    def parent_path():
        return json.loads(run('select row_to_json(x) from (' +
                              generated.rstrip().rstrip(';') + ') x;'))

    parent = parent_path()
    assert (parent['held_jobs'], parent['held_workaddresses'],
            parent['held_parent_ids']) == (2, 2, 1), parent
    assert parent['holds'] == {'customer_link_missing': {
        'jobs': 2, 'workaddresses': 2, 'parent_ids': 1}}, parent
    assert parent['existing_target_clues'] == {
        'no_source_keyed_target': 1, 'one_source_keyed_target': 0,
        'multiple_source_keyed_targets': 0,
        'legacy_target_rows': 0, 'direct_target_rows': 0}, parent
    assert parent['parent_name_shapes']['neither_name_shape'] == 1, parent
    assert parent['site_source_shapes']['source_shape_candidate_after_parent_review'] == 2, parent
    assert parent['jobs_on_site_source_shape_candidates'] == 2, parent
    run(f"""insert into public.import_entity_links values
     ('{ident(802)}','{TENANT}','commusoft','customer','21','{ident(300)}','people');""")
    parent = parent_path()
    assert parent['existing_target_clues']['one_source_keyed_target'] == 1, parent
    assert parent['existing_target_clues']['legacy_target_rows'] == 1, parent
    source(423, 'properties', '21', {'id': 21, 'type': 'customer'})
    parent = parent_path()
    assert parent['holds'] == {'parent_source_missing_or_ambiguous': {
        'jobs': 2, 'workaddresses': 2, 'parent_ids': 1}}, parent
    assert parent['parent_name_shapes']['unresolved_source_kind'] == 1, parent
    print('PASS: parent-path two-tenant isolation, shared parent, exact clue and tied replay hold')
finally:
    if CREATED:
        subprocess.run(['docker', 'rm', '-f', NAME], capture_output=True, timeout=30)
