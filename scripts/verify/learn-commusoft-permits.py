"""Synthetic Commusoft credential/pacing checks in disposable isolated Postgres.

No host mounts, ports, live credentials, external provider or ServiceOS database.
"""
import concurrent.futures
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[2]
docker = shutil.which('docker') or '/usr/local/bin/docker'
name = 'serviceos-commusoft-permits-' + uuid.uuid4().hex[:8]
created = False
if sys.argv[1:] not in ([], ['--pages']):
    raise SystemExit('Usage: learn-commusoft-permits.py [--pages]')


def sql(text):
    result = subprocess.run([docker, 'exec', '-i', name, 'psql', '-X', '-qAt',
                             '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                            input=text, text=True, capture_output=True, timeout=40)
    if result.returncode:
        raise RuntimeError(result.stderr[-3000:])
    return result.stdout.strip()


try:
    subprocess.run([docker, 'run', '-d', '--pull=never', '--network', 'none',
                    '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
                    'postgres:15'], check=True, capture_output=True, timeout=30)
    created = True
    for attempt in range(40):
        result = subprocess.run([docker, 'exec', name, 'pg_isready', '-h',
                                 '127.0.0.1', '-U', 'postgres'], capture_output=True, timeout=5)
        if result.returncode == 0:
            break
        time.sleep(.25)
    else:
        raise RuntimeError('Isolated PostgreSQL did not become ready')
    paths = [
        'scripts/verify/learn-commusoft-permits.fixture.sql',
        'supabase/migrations/20261031090000_learn_commusoft_page_permits.sql',
        'scripts/verify/learn-commusoft-permits.assert.sql',
    ]
    if sys.argv[1:] == ['--pages']:
        sql('\n'.join((root / path).read_text() for path in paths[:2]))
        page_migration = (root / 'supabase/migrations/20261031100000_learn_business_input_pages.sql').read_text()
        sql(page_migration.replace('\ncommit;', '\nrollback;'))
        if sql("select to_regclass('public.learn_business_input_pages') is null "
               "and position('commusoft_page_v1' in pg_get_functiondef('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)'::regprocedure))=0;") != 't':
            raise RuntimeError('Page rollback retained tables or acquisition changes')
        print('Page rollback restores tables and credential acquisition function.')
        print(sql(page_migration + '\n' + (root / 'scripts/verify/learn-commusoft-pages.assert.sql').read_text()))
        prior_pages = int(sql('select count(*) from learn_business_input_pages;'))
        sql("""update connector_accounts set sync_cursor='{}',settings=jsonb_set(settings,'{commusoft_import,approvalId}',to_jsonb(fixture_id(26)::text));
          update learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second';
          insert into platform_jobs select fixture_id(22),tenant_id,job_type,'running',payload,claimed_by,1,clock_timestamp()+interval '1 hour','{}' from platform_jobs where id=fixture_id(2);
          set request.jwt.claim.role='service_role';
          update fixture_page_state set permit=(fixture_acquire(fixture_expected(fixture_id(22)),fixture_id(22))->>'permitId')::uuid,
            envelope='{"data":[{"id":99,"type":"customer"}],"pagination":{"hasMore":false,"nextCursor":99}}';""")

        def publish(_):
            return sql("""set request.jwt.claim.role='service_role'; set role service_role;
              select public.learn_commusoft_commit_page(fixture_id(1),fixture_id(22),'fixture-worker',1,permit,envelope)->>'already' from fixture_page_state;""")

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(publish, [1, 2]))
        if sorted(results) != ['false', 'true']:
            raise RuntimeError(f'Concurrent publication failed: {results}')
        if int(sql('select count(*) from learn_business_input_pages;')) != prior_pages + 1:
            raise RuntimeError('Concurrent publication duplicated a page')
        print('Concurrent publication: one new page and one exact replay acknowledgement.')
        raise SystemExit(0)
    print(sql('\n'.join((root / path).read_text() for path in paths)))

    def acquire(job):
        return sql(f"""set request.jwt.claim.role='service_role'; set role service_role;
          select public.fixture_acquire(public.fixture_expected(public.fixture_id({job})),
            public.fixture_id({job}))->>'state';""")

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(acquire, [2, 12]))
    if sorted(results) != ['ready', 'wait']:
        raise RuntimeError(f'Concurrent quota reservation failed: {results}')
    if sql('select count(*) from public.learn_business_input_request_permits;') != '1':
        raise RuntimeError('Concurrent workers created more than one permit')
    print('Concurrent workers: exactly one permit; second worker paced without a key.')
    # Verifies all permit DDL is transactional, using the real migration again.
    sql('drop function public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb);'
        'drop function public.learn_commusoft_defer_page(uuid,uuid,text,integer,uuid,timestamptz);'
        'drop table public.learn_business_input_request_permits;'
        'drop table public.learn_business_input_request_gates;')
    migration = (root / paths[1]).read_text()
    sql(migration.replace('\ncommit;', '\nrollback;'))
    if sql("select to_regclass('public.learn_business_input_request_gates') is null "
           "and to_regprocedure('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)') is null;") != 't':
        raise RuntimeError('Rollback left permit objects behind')
    print('Rollback rehearsal: no permit tables or functions retained.')
finally:
    if created:
        subprocess.run([docker, 'rm', '-f', name], check=True, capture_output=True, timeout=30)
