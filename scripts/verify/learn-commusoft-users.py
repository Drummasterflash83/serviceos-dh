"""One synthetic /users source page through real SQL, inside network-isolated Postgres."""
import shutil
import subprocess
import sys
import time
import uuid
import concurrent.futures
from pathlib import Path

root = Path(__file__).resolve().parents[2]
shared_lease = sys.argv[1:] == ['--shared-lease']
if sys.argv[1:] not in ([], ['--shared-lease']):
    raise SystemExit('Usage: learn-commusoft-users.py [--shared-lease]')
docker = shutil.which('docker') or '/usr/local/bin/docker'
name = 'serviceos-commusoft-users-' + uuid.uuid4().hex[:8]
created = False


def sql(source):
    result = subprocess.run([docker, 'exec', '-i', name, 'psql', '-h', '127.0.0.1',
                             '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                            input=source, text=True, capture_output=True, timeout=40)
    if result.returncode:
        raise RuntimeError(result.stderr[-4000:])
    return result.stdout.strip()


def file(path):
    return (root / path).read_text()


try:
    subprocess.run([docker, 'run', '-d', '--pull=never', '--network', 'none',
                    '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
                    'postgres:15'], check=True, capture_output=True, timeout=30)
    created = True
    for _ in range(40):
        if subprocess.run([docker, 'exec', name, 'pg_isready', '-h', '127.0.0.1',
                           '-U', 'postgres'], capture_output=True).returncode == 0:
            break
        time.sleep(.25)
    else:
        raise RuntimeError('Disposable database unavailable')
    for path in ['scripts/verify/learn-commusoft-permits.fixture.sql',
                 'scripts/verify/learn-commusoft-worker.fixture.sql',
                 'scripts/verify/learn-operator-inputs.fixture.sql']:
        sql(file(path))
    queue = file('supabase/migrations/20260710120000_platform_job_queue.sql')
    sql(queue.split('-- ── Register the async queue worker')[0])
    for path in ['supabase/migrations/20261031090000_learn_commusoft_page_permits.sql',
                 'supabase/migrations/20261031100000_learn_business_input_pages.sql',
                 'supabase/migrations/20261031110000_learn_commusoft_worker.sql']:
        sql(file(path))
    authority = file('supabase/migrations/20260821120000_openfolk_control_plane.sql')
    sql(authority[authority.index('create table if not exists platform_authority_grants ('):
                  authority.index('-- OpenFolk-operator resolver')])
    resolver = file('supabase/migrations/20260822120000_platform_authority_decoupled_from_role.sql')
    sql(resolver[resolver.index('create or replace function current_user_is_openfolk_operator('):
                 resolver.index('-- ── Governed record')])
    for path in ['supabase/migrations/20261031160000_learn_operator_inputs.sql',
                 'supabase/migrations/20261031200000_learn_commusoft_resume.sql',
                 'supabase/migrations/20261101020000_learn_commusoft_contact_traversal.sql']:
        sql(file(path))
    signatures = [
        'learn_operator_input_request(uuid,uuid,uuid,jsonb,text)',
        'learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)',
        'learn_commusoft_commit_page(uuid,uuid,text,integer,uuid,jsonb)',
    ]
    expressions = ','.join("'public." + signature + "'::regprocedure" for signature in signatures)
    contract = ("select md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,'')"
                "||proowner::text,'' order by oid)) from pg_proc where oid in (" + expressions + ");")
    before = sql(contract)
    migration = file('supabase/migrations/20261105180000_commusoft_source_users.sql')
    sql(migration.replace('\ncommit;', '\nrollback;'))
    assert sql(contract) == before, 'Rollback changed authority functions, grants or owner'
    sql(migration)
    assert sql(contract) != before, 'Users authority unchanged after migration'
    for signature in signatures:
        definition = sql("select pg_get_functiondef('public." + signature + "'::regprocedure);")
        assert "'users'" in definition, 'Users resource not enabled in ' + signature
    if shared_lease:
        shared = file('supabase/migrations/20261106140000_new_dawn_commusoft_shared_lease.sql')
        worker = "select md5(pg_get_functiondef('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)'::regprocedure));"
        before_worker = sql(worker)
        sql(shared.replace('\ncommit;', '\nrollback;'))
        assert sql(worker) == before_worker, 'Shared lease rollback changed worker acquisition'
        assert sql("select count(*) from information_schema.columns where table_schema='public' and table_name='learn_business_input_request_gates' and column_name='lease_owner_id';") == '0', 'Shared lease rollback retained columns'
        sql(shared)
        assert sql(worker) != before_worker, 'Shared lease did not patch worker acquisition'
        print(sql(file('scripts/verify/new-dawn-commusoft-shared-lease.assert.sql')))

        def race(owner):
            return sql("set request.jwt.claim.role='service_role'; select public.learn_commusoft_shared_lease_acquire(repeat('a',64),'source_page','" + owner + "')->>'state';")

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = sorted(pool.map(race, ['dddddddd-dddd-4ddd-8ddd-dddddddddddd:1', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee:1']))
        assert outcomes == ['ready', 'wait'], 'Concurrent source leases were not serialized: ' + repr(outcomes)
        print('PASS: concurrent credential-fingerprint claims produce one owner and one wait')
    print(sql(file('scripts/verify/learn-commusoft-users.assert.sql')))
    if shared_lease:
        fingerprint = "encode(sha256(convert_to('commusoft:SYNTHETIC_USERS_NO_NETWORK','UTF8')),'hex')"
        assert sql("select lease_owner_kind is null from public.learn_business_input_request_gates where credential_fingerprint=" + fingerprint + ";") == 't', 'Committed source page kept its in-flight lease'
        print('PASS: committed synthetic source page released its in-flight lease')
    print('PASS: migration rollback preserves existing function definitions, grants and ownership')
finally:
    if created:
        subprocess.run([docker, 'rm', '-f', name], check=True, capture_output=True, timeout=30)
