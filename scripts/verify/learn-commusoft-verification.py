"""Real verification SQL in disposable PostgreSQL; no provider traffic or host mounts."""
import concurrent.futures
import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[2]
docker = shutil.which('docker') or '/usr/local/bin/docker'
name = 'serviceos-commusoft-verification-' + uuid.uuid4().hex[:8]
created = False

def sql(text):
    result = subprocess.run([docker, 'exec', '-i', name, 'psql', '-X', '-qAt', '-U', 'postgres',
                             '-v', 'ON_ERROR_STOP=1'], input=text, text=True, capture_output=True, timeout=40)
    if result.returncode:
        raise RuntimeError(result.stderr[-3000:])
    return result.stdout.strip()

def source(path):
    return (root / path).read_text()

try:
    subprocess.run([docker, 'run', '-d', '--pull=never', '--network', 'none', '--name', name,
                    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:15'], check=True, capture_output=True, timeout=30)
    created = True
    for _ in range(40):
        if subprocess.run([docker, 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0:
            break
        time.sleep(.25)
    else:
        raise RuntimeError('Isolated database unavailable')
    for path in ['scripts/verify/learn-commusoft-permits.fixture.sql',
                 'supabase/migrations/20261031090000_learn_commusoft_page_permits.sql',
                 'scripts/verify/learn-commusoft-worker.fixture.sql',
                 'scripts/verify/learn-operator-inputs.fixture.sql']:
        sql(source(path))
    authority = source('supabase/migrations/20260821120000_openfolk_control_plane.sql')
    sql(authority[authority.index('create table if not exists platform_authority_grants ('):authority.index('-- OpenFolk-operator resolver')])
    resolver = source('supabase/migrations/20260822120000_platform_authority_decoupled_from_role.sql')
    sql(resolver[resolver.index('create or replace function current_user_is_openfolk_operator('):resolver.index('-- ── Governed record')])
    for path in ['supabase/migrations/20261031160000_learn_operator_inputs.sql',
                 'scripts/verify/learn-commusoft-connection.fixture.sql',
                 'supabase/migrations/20260810120000_provider_secret_broker.sql',
                 'supabase/migrations/20261031170000_learn_commusoft_connection_setup.sql']:
        sql(source(path))
    migration = source('supabase/migrations/20261031180000_learn_commusoft_connection_verification.sql')
    sql(migration.replace('\ncommit;', '\nrollback;'))
    if sql("select to_regclass('learn_commusoft_verification_requests') is null and to_regprocedure('learn_commusoft_verify_acquire(uuid,uuid)') is null") != 't':
        raise RuntimeError('Verification rollback retained new objects')
    sql(migration)
    print(sql(source('scripts/verify/learn-commusoft-verification.assert.sql')))
    subprocess.run(['node', 'scripts/verify/learn-commusoft-verification-bridge.mjs', docker, name],
                   cwd=root, check=True, timeout=45)
    # Two actual DB sessions competing to acquire one approved read cannot both
    # receive its key, even when their replies arrive in the opposite order.
    sql("select fixture_v_prepare(470);set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;select fixture_v_request(470);")
    def acquire(_):
        return sql("set request.jwt.claim.role='service_role';set role service_role;select coalesce(learn_commusoft_verify_acquire(fixture_id(300),fixture_id(470))->>'state','not_released');")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(acquire, [0, 1]))
    if sorted(results) != ['not_released', 'ready']:
        raise RuntimeError('Concurrent verification acquisition released duplicate credentials')
    print('Concurrent acquisitions released one credential; the other was refused.')
    # Keep only safe aggregate evidence outside the container.
    evidence = json.loads(sql("select jsonb_build_object('requests',(select count(*) from learn_commusoft_verification_requests),'permits',(select count(*) from learn_commusoft_verification_permits),'results',(select count(*) from learn_commusoft_verification_results),'fixture_jobs',(select count(*) from platform_jobs where tenant_id=fixture_id(300)))"))
    evidence['concurrent_acquisition'] = 'passed'
    evidence['rollback'] = 'passed'
    evidence['production_executor_sql_bridge'] = 'passed'
    output = root / '.verification-results' / 'learn-commusoft-verification-sql.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(evidence, indent=2) + '\n')
finally:
    if created:
        subprocess.run([docker, 'rm', '-f', name], check=True, capture_output=True, timeout=30)
