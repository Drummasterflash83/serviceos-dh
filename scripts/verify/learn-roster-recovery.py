"""Integration-check recovered roster writers using a local schema-only clone.

The source container is READ ONLY. No table rows, auth credentials, storage
objects, or role passwords are dumped. Verification runs with synthetic data in
a disposable network-isolated container with no host mounts or published ports.
Requires the existing local Supabase container and its cached Postgres image.
This verifies integration with that schema, not a fresh replay of every project
migration. Do not point this tool at a hosted database.
"""
import shutil
import subprocess
import uuid
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCKER = shutil.which('docker') or '/usr/local/bin/docker'
SOURCE = 'supabase_db_serviceos-dh'
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.141'
TARGET = 'serviceos-roster-verify-' + uuid.uuid4().hex[:8]


def docker(*args, **kwargs):
    return subprocess.run([DOCKER, *args], capture_output=True, check=True, **kwargs)


def query(container, sql):
    # The image briefly starts a socket-only server during initialization.
    # TCP ensures readiness refers to the final server, after its restart.
    host = ['-h', '127.0.0.1'] if container == TARGET else []
    return docker('exec', container, 'psql', *host, '-U', 'supabase_admin', '-d',
                  'postgres', '-Atc', sql).stdout.decode().splitlines()


def apply(sql, label):
    result = subprocess.run([DOCKER, 'exec', '-i', TARGET, 'psql', '-U',
                             'supabase_admin', '-d', 'roster_verify', '-v',
                             'ON_ERROR_STOP=1', '-f', '-'],
                            input=sql, capture_output=True)
    if result.returncode:
        # Do not print schema bodies or arbitrary source data on failure.
        messages = result.stderr.decode().splitlines()
        print(label + ': FAILED')
        print('\n'.join(line for line in messages if 'ERROR:' in line or 'ASSERT' in line)[-1000:])
        raise RuntimeError(label + ' failed')
    print(label + ': PASS')


try:
    docker('run', '-d', '--pull=never', '--network', 'none', '--name', TARGET,
           '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE)
    for attempt in range(80):
        try:
            query(TARGET, 'select 1')
            break
        except subprocess.CalledProcessError:
            time.sleep(.25)
    else:
        raise RuntimeError('Disposable database did not start')
    # Names only; missing roles are empty NOLOGIN roles, never copies of logins.
    roles = set(query(SOURCE, "select rolname from pg_roles where rolname not like 'pg_%'"))
    existing = set(query(TARGET, 'select rolname from pg_roles'))
    for role in sorted(roles-existing):
        query(TARGET, 'CREATE ROLE "' + role.replace('"', '""') + '" NOLOGIN')
    docker('exec', TARGET, 'createdb', '-U', 'supabase_admin', '-T', 'template0', 'roster_verify')
    schema = docker('exec', SOURCE, 'pg_dump', '-U', 'postgres', '-d', 'postgres',
                    '--schema-only', '--no-owner').stdout
    apply(schema, 'Schema-only local clone')
    migrations = [
        '20260913120000_office_roster_controlplane.sql',
        '20260914120000_roster_supersede_tenant_guard.sql',
        '20261029200000_learn_roster_recovery_guards.sql',
    ]
    apply('\n'.join((ROOT/'supabase/migrations'/p).read_text() for p in migrations).encode(),
          'Recovered roster migrations and write guards')
    apply((ROOT/'scripts/verify/learn-roster-recovery.assert.sql').read_bytes(),
          'Roster lifecycle, scope, date, audit and privilege assertions')
    # Two real sessions try to supersede the same open assignment.
    import concurrent.futures
    statement = """select cp_upsert_responsibility('aaaa0000-0000-0000-0000-0000000000a1',
      'cccc0000-0000-0000-0000-0000000000a1',null,null,null,'Concurrent replacement',null,null,null,null,null,null,
      'synthetic-operator','Concurrency test',null,false);"""
    def race(_):
        return subprocess.run([DOCKER,'exec',TARGET,'psql','-U','supabase_admin','-d','roster_verify',
          '-v','ON_ERROR_STOP=1','-c',statement],capture_output=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(race,range(2)))
    assert sum(r.returncode==0 for r in results)==1, 'Exactly one supersede must succeed'
    assert any(b'already ended' in r.stderr for r in results), 'Second supersede must be refused'
    apply(b"""do $$ begin
      assert (select count(*) from responsibility_assignments where label='Concurrent replacement' and effective_to is null)=1;
    end $$;""",'Concurrent supersede retains one successor')
finally:
    subprocess.run([DOCKER, 'rm', '-f', TARGET], capture_output=True)
