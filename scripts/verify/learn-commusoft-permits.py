"""Synthetic Commusoft credential/pacing checks in disposable isolated Postgres.

No host mounts, ports, live credentials, external provider or ServiceOS database.
"""
import concurrent.futures
import shutil
import subprocess
import time
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[2]
docker = shutil.which('docker') or '/usr/local/bin/docker'
name = 'serviceos-commusoft-permits-' + uuid.uuid4().hex[:8]
created = False


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
        subprocess.run([docker, 'rm', '-f', name], capture_output=True, timeout=30)
