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
TARGET = 'serviceos-team-residence-verify-' + uuid.uuid4().hex[:8]


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
    import concurrent.futures
    def race(i):
        sql = """set request.jwt.claim.sub='bbbb0000-0000-0000-0000-000000000001';
        set role authenticated;
        select learn_work_residence_collect('aaaa0000-0000-0000-0000-000000000001',
          'cccc0000-0000-0000-0000-000000000001','dddd0000-0000-0000-0000-000000000002',1,
          (select window_start-interval '2 seconds' from measurements where id='ffff0000-0000-0000-0000-000000000001'),
          (select window_end from measurements where id='ffff0000-0000-0000-0000-000000000001'),
          'ffff0000-0000-0000-0000-0000000000%02d','Concurrent collection');""" % (9+i)
        return subprocess.run([DOCKER,'exec',TARGET,'psql','-U','supabase_admin','-d','roster_verify',
          '-v','ON_ERROR_STOP=1','-c',sql],capture_output=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(race,range(2)))
    assert sum(r.returncode==0 for r in results)==1, 'Exactly one same-cell collection must succeed'
    assert any(b'already exists' in r.stderr for r in results), 'Competing collection must be rejected'
    print('Concurrent member collection retains one observation: PASS')
    def team_race(i):
        sql = """set request.jwt.claim.sub='bbbb0000-0000-0000-0000-000000000003';
        set role authenticated;
        select learn_team_work_residence_collect('aaaa0000-0000-0000-0000-000000000003',
          'aaaa0000-0000-0000-0000-000000000011','dddd0000-0000-0000-0000-000000000012',1,
          (select start_at-interval '2 seconds' from team_residence_period),
          (select end_at from team_residence_period),
          'ffff0000-0000-0000-0000-0000000000%02d','Concurrent team collection');""" % (31+i)
        return subprocess.run([DOCKER,'exec',TARGET,'psql','-U','supabase_admin','-d','roster_verify',
          '-v','ON_ERROR_STOP=1','-c',sql],capture_output=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(team_race,range(2)))
    if sum(r.returncode==0 for r in results)!=1:
        print('\n'.join(r.stderr.decode()[-1600:] for r in results))
    assert sum(r.returncode==0 for r in results)==1, 'Exactly one team collection must succeed'
    assert any(b'already exists' in r.stderr for r in results), 'Competing team collection must be rejected'
    print('Concurrent team collection retains one observation: PASS')
    readback_sql="""set request.jwt.claim.sub='bbbb0000-0000-0000-0000-000000000003';set role authenticated;
    select jsonb_build_object('measurement',to_jsonb(m),
      'policy',(select value from operating_profile_entries where tenant_id=m.tenant_id and scope_ref='team:all'),
      'reviews',(select jsonb_agg(to_jsonb(r)) from learn_performance_reviews r where r.measurement_id=m.id),
      'receipt',(select to_jsonb(r) from learn_team_work_measurement_runs r where r.id=m.id))
    from measurements m where m.id='ffff0000-0000-0000-0000-000000000021';"""
    data=docker('exec',TARGET,'psql','-U','supabase_admin','-d','roster_verify','-qAtc',readback_sql).stdout
    parsed=subprocess.run(['node',str(ROOT/'scripts/verify/learn-team-work-readback.mjs')],input=data,capture_output=True)
    if parsed.returncode:
        print(parsed.stderr.decode()[-1600:])
        raise RuntimeError('Team SQL-to-client parsing failed')
    print(parsed.stdout.decode().strip())

finally:
    subprocess.run([DOCKER, 'rm', '-f', TARGET], capture_output=True)
