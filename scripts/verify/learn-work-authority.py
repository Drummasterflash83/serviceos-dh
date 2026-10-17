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
TARGET = 'serviceos-work-authority-' + uuid.uuid4().hex[:8]


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
                             'supabase_admin', '-d', 'authority_verify', '-v',
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
    docker('exec', TARGET, 'createdb', '-U', 'supabase_admin', '-T', 'template0', 'authority_verify')
    schema = docker('exec', SOURCE, 'pg_dump', '-U', 'postgres', '-d', 'postgres',
                    '--schema-only', '--no-owner').stdout
    apply(schema, 'Schema-only local clone')
    migrations = [
        '20260913120000_office_roster_controlplane.sql',
        '20260914120000_roster_supersede_tenant_guard.sql',
        '20261029200000_learn_roster_recovery_guards.sql',
        '20261029180000_learn_work_transition_history.sql',
        '20261029190000_learn_work_source_capture.sql',
        '20261029210000_learn_work_scoped_authority.sql',
        '20261105120000_learn_roster_member_identity_confirmation.sql',
    ]
    apply('\n'.join((ROOT/'supabase/migrations'/p).read_text() for p in migrations).encode(),
          'Recovered roster migrations and write guards')
    apply((ROOT/'scripts/verify/learn-roster-recovery.assert.sql').read_bytes(),
          'Roster lifecycle, scope, date, audit and privilege assertions')
    apply((ROOT/'scripts/verify/learn-work-authority.assert.sql').read_bytes(),
          'Work scope, cover weekdays, viewer staff and commit-time authority assertions')
    apply((ROOT/'scripts/verify/learn-roster-member-identity.assert.sql').read_bytes(),
          'Member login confirmation scope, version, privilege and audit assertions')
    apply((ROOT/'scripts/verify/learn-job-review-action-fixture.sql').read_bytes(),
          'Synthetic source-job reader and tenant-authority fixture')
    apply((ROOT/'supabase/migrations/20261105130000_learn_commusoft_job_review_action.sql').read_bytes(),
          'Source-linked OpenFolk job-review action migration')
    apply((ROOT/'scripts/verify/learn-job-review-action.assert.sql').read_bytes(),
          'Source version, tenant authority, repeat, audit and provider-boundary assertions')
finally:
    subprocess.run([DOCKER, 'rm', '-f', TARGET], capture_output=True)
