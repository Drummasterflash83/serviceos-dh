"""Integration-check elapsed ownership observations using a local schema-only clone.

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
TARGET = 'serviceos-work-calendar-verify-' + uuid.uuid4().hex[:8]


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
    more = [
      '20261029150000_learn_performance_measurements.sql',
      '20261029160000_learn_performance_reviews.sql',
      '20261029180000_learn_work_transition_history.sql',
      '20261029190000_learn_work_source_capture.sql',
      '20261029220000_learn_member_history.sql',
      '20261029230000_learn_work_handoff_measurements.sql',
      '20261029120000_learn_scorecard_drafts.sql',
      '20261030000000_learn_scorecard_publication.sql',
      '20261030010000_learn_work_residence_measurements.sql',

    ]
    apply('\n'.join((ROOT/'supabase/migrations'/p).read_text() for p in more).encode(),
      'Performance, work capture, membership and handoff adapter migrations')
    apply((ROOT/'scripts/verify/learn-work-residence.assert.sql').read_bytes(),
      'Real capture through residence collection, preservation and review assertions')
    apply((ROOT/'supabase/migrations/20261030050000_learn_measurement_group_history.sql').read_bytes(), 'Historical membership append guards')
    apply((ROOT/'supabase/migrations/20261030060000_learn_work_collection_release_guards.sql').read_bytes(), 'Existing collection release guards')
    team_sql=(ROOT/'supabase/migrations/20261101080000_learn_team_work_residence.sql').read_bytes()
    apply(b'begin;'+team_sql+b'rollback;', 'Team migration rollback rehearsal')
    apply(team_sql, 'Team residence migration')
    apply(b'begin;'+(ROOT/'scripts/verify/learn-team-work-hosted.assert.sql').read_bytes()+b'rollback;', 'Exact hosted team role and ledger probe')
    apply((ROOT/'scripts/verify/learn-team-work-residence.assert.sql').read_bytes(), 'Team history, scope and preservation assertions')
    batch_sql=(ROOT/'supabase/migrations/20261101090000_learn_resumable_work_collection.sql').read_bytes()
    apply(b'begin;'+batch_sql+b'rollback;', 'Resumable collection rollback rehearsal')
    apply(batch_sql, 'Resumable collection migration')
    apply(b'begin;'+(ROOT/'scripts/verify/learn-resumable-work-hosted.assert.sql').read_bytes()+b'rollback;', 'Resumable collector role and ledger boundary probe')
    apply((ROOT/'scripts/verify/learn-resumable-work.assert.sql').read_bytes(), 'Frozen population, batching and collection assertions')
    calendar_sql=(ROOT/'supabase/migrations/20261101100000_learn_work_calendars.sql').read_bytes()
    apply(b'begin;'+calendar_sql+b'rollback;', 'Calendar migration rollback rehearsal')
    apply(calendar_sql, 'Versioned calendar migration')
    apply((ROOT/'scripts/verify/learn-work-calendars.assert.sql').read_bytes(), 'Calendar revision, authority, DST and history assertions')

    sql="""set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';
    select jsonb_build_object('read',learn_work_calendar_read('aaa40000-0000-0000-0000-000000000004'),
      'preview',learn_work_calendar_preview('aaa40000-0000-0000-0000-000000000004','ca140000-0000-4000-8000-000000000001','2026-10-05T00:00:00Z','2026-10-12T00:00:00Z'),
      'snapshot',(select snapshot from calendar_frozen));"""
    data=docker('exec',TARGET,'psql','-U','supabase_admin','-d','roster_verify','-qAtc',sql).stdout
    parsed=subprocess.run(['node',str(ROOT/'scripts/verify/learn-work-calendars-readback.mjs')],input=data,capture_output=True)
    if parsed.returncode:
        print(parsed.stderr.decode()[-1600:]);raise RuntimeError('Calendar SQL-to-client parsing failed')
    print(parsed.stdout.decode().strip())

    import concurrent.futures
    def save_race(i):
        sql=f"""set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';set role authenticated;
        select learn_work_calendar_save('aaa40000-0000-0000-0000-000000000004',2,(select definition from calendar_fixture),
        'ca140000-0000-4000-8000-00000000009{i}','Concurrent calendar save');"""
        return subprocess.run([DOCKER,'exec',TARGET,'psql','-U','supabase_admin','-d','roster_verify','-qAt','-v','ON_ERROR_STOP=1','-c',sql],capture_output=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(save_race,range(2)))
    assert sum(r.returncode==0 for r in results)==1, 'Exactly one calendar revision must win'
    assert any(b'Calendar revision changed' in r.stderr for r in results), 'Concurrent stale save must conflict'
    print('Concurrent calendar saves retain one next revision: PASS')

finally:
    subprocess.run([DOCKER, 'rm', '-f', TARGET], capture_output=True)
