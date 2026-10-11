"""Verify company calendars and optional approved delays in a schema-only clone.

The source container is READ ONLY. No table rows, auth credentials, storage
objects, or role passwords are dumped. Verification runs with synthetic data in
a disposable network-isolated container with no host mounts or published ports.
Requires the existing local Supabase container and its cached Postgres image.
This verifies integration with that schema, not a fresh replay of every project
migration. Do not point this tool at a hosted database.
"""
import shutil
import sys
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

    apply((ROOT/'scripts/verify/learn-work-calendar-recovery.assert.sql').read_bytes(), 'Calendar exact recovery, cancellation and access assertions')

    sql="""set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';
    select jsonb_build_object('read',learn_work_calendar_read('aaa40000-0000-0000-0000-000000000004'),
      'preview',learn_work_calendar_preview('aaa40000-0000-0000-0000-000000000004','ca140000-0000-4000-8000-000000000001','2026-10-05T00:00:00Z','2026-10-12T00:00:00Z'),
      'snapshot',(select snapshot from calendar_frozen),
      'resolution',learn_work_calendar_resolve('aaa40000-0000-0000-0000-000000000004','save','ca140000-0000-4000-8000-000000000001',jsonb_build_object('expectedRevision',0,'definition',(select definition from calendar_fixture),'reason','Initial company hours'),false));"""
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

    # Actual simultaneous clients, using the same request lock. Either a recorded
    # operation or a retained cancellation may win, never both or neither.
    import json
    def calendar_query(sql):
        return docker('exec', TARGET, 'psql', '-U', 'supabase_admin', '-d',
                      'roster_verify', '-qAtc', sql).stdout.decode().strip()
    for kind in ['save', 'publish']:
        for attempt in range(2):
            request_id = str(uuid.uuid4())
            head = json.loads(calendar_query("select jsonb_build_object('revision',revision,'id',id,'publication',(select id from learn_work_calendar_publications order by effective_from desc limit 1)) from learn_work_calendar_versions order by revision desc limit 1"))
            if kind == 'publish':
                # Ensure a fresh unpublished revision even if the prior publish won.
                fresh = str(uuid.uuid4())
                calendar_query(f"set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';select learn_work_calendar_save('aaa40000-0000-0000-0000-000000000004',{head['revision']},(select definition from calendar_fixture),'{fresh}','Prepare publication race')")
                head['id'] = fresh
            reason = 'Concurrent exact request recovery'
            if kind == 'save':
                payload = f"jsonb_build_object('expectedRevision',{head['revision']},'definition',(select definition from calendar_fixture),'reason','{reason}')"
                write = f"learn_work_calendar_save('aaa40000-0000-0000-0000-000000000004',{head['revision']},(select definition from calendar_fixture),'{request_id}','{reason}')"
            else:
                payload = f"jsonb_build_object('versionId','{head['id']}','expectedPublication','{head['publication']}','reason','{reason}')"
                write = f"learn_work_calendar_publish('aaa40000-0000-0000-0000-000000000004','{head['id']}','{head['publication']}','{request_id}','{reason}')"
            cancel = f"learn_work_calendar_resolve('aaa40000-0000-0000-0000-000000000004','{kind}','{request_id}',{payload},true)"
            def competing_call(call):
                sql = f"set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';set role authenticated;select {call};"
                return subprocess.run([DOCKER,'exec',TARGET,'psql','-U','supabase_admin','-d','roster_verify','-qAt','-v','ON_ERROR_STOP=1','-c',sql],capture_output=True)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                write_result, cancel_result = list(pool.map(competing_call, [write, cancel]))
            assert cancel_result.returncode == 0, 'Exact cancellation/resolution must settle'
            outcome = json.loads(next(line for line in cancel_result.stdout.decode().splitlines() if line.startswith('{')))
            if outcome['state'] == 'cancelled':
                assert write_result.returncode != 0 and b'Calendar request cancelled' in write_result.stderr
            else:
                assert outcome['state'] == 'recorded' and write_result.returncode == 0
            count = calendar_query(f"select (select count(*) from learn_work_calendar_versions where id='{request_id}')+(select count(*) from learn_work_calendar_publications where id='{request_id}')+(select count(*) from learn_work_calendar_cancellations where id='{request_id}')")
            assert count == '1', 'Request must have exactly one terminal outcome'
            settled = competing_call(cancel)
            assert settled.returncode == 0
            assert json.loads(next(line for line in settled.stdout.decode().splitlines() if line.startswith('{'))) == outcome
        print(f'Concurrent calendar {kind}/cancel has one stable terminal outcome: PASS')

    if '--include-delays' in sys.argv:
        delay_sql=(ROOT/'supabase/migrations/20261101110000_learn_work_delays.sql').read_bytes()
        apply(b'begin;'+delay_sql+b'rollback;', 'Delay review migration rollback rehearsal')
        apply(delay_sql, 'Delay review migration')
        apply((ROOT/'scripts/verify/learn-work-delays.assert.sql').read_bytes(), 'Delay approval, reversal, recovery, scope and preservation assertions')
        if '--include-working-time' in sys.argv:
            working_sql=(ROOT/'supabase/migrations/20261101120000_learn_working_time_calculation.sql').read_bytes()
            apply(b'begin;'+working_sql+b'rollback;', 'Working-time calculation rollback rehearsal')
            apply(working_sql, 'Private working-time calculation')
            apply((ROOT/'scripts/verify/learn-working-time.assert.sql').read_bytes(), 'Working-time interval arithmetic, attribution, missing coverage and preservation')
            working_data=docker('exec',TARGET,'psql','-U','supabase_admin','-d','roster_verify','-qAtc',
                "select jsonb_agg(to_jsonb(r) order by name) from working_time_results r").stdout
            working_parsed=subprocess.run(['node',str(ROOT/'scripts/verify/learn-working-time-readback.mjs')],input=working_data,capture_output=True)
            if working_parsed.returncode:
                print(working_parsed.stderr.decode()[-1600:]);raise RuntimeError('Working-time SQL-to-client verification failed')
            print(working_parsed.stdout.decode().strip())
        sql="""set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';
        select jsonb_build_object('request',payload,'page',learn_work_delay_read('aaa40000-0000-0000-0000-000000000004','de1a0000-0000-4000-8000-000000000001',0,null),
          'snapshot',first_snapshot,'current',learn_work_delay_snapshot('aaa40000-0000-0000-0000-000000000004','de1a0000-0000-4000-8000-000000000001',starts,ends,clock_timestamp()),
          'evidence',learn_work_delay_evidence('aaa40000-0000-0000-0000-000000000004','de1a0000-0000-4000-8000-000000000001','de1a0000-0000-4000-8000-000000000011'),
          'resolution',learn_work_delay_resolve('aaa40000-0000-0000-0000-000000000004','de1a0000-0000-4000-8000-000000000011',payload,false),
          'union',(select value from delay_union_snapshot)) from delay_fixture;"""
        data=docker('exec',TARGET,'psql','-U','supabase_admin','-d','roster_verify','-qAtc',sql).stdout
        parsed=subprocess.run(['node',str(ROOT/'scripts/verify/learn-work-delays-readback.mjs')],input=data,capture_output=True)
        if parsed.returncode:
            print(parsed.stderr.decode()[-1600:]);raise RuntimeError('Delay SQL-to-client parsing failed')
        lines=parsed.stdout.decode().splitlines()
        selected=json.loads(next(line for line in lines if line.startswith('{')))['selectedApproval']
        print('\n'.join(line for line in lines if not line.startswith('{')))
        selected_json=json.dumps(selected).replace("'", "''")
        apply(f"""begin;
          set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';set role authenticated;
          do $$declare p jsonb:='{selected_json}'::jsonb;r jsonb;e jsonb;begin
            r:=learn_work_delay_record('aaa40000-0000-0000-0000-000000000004','de1a0000-0000-4000-8000-000000000620',p);
            assert (r->'entry'->>'revision')::int=(p->>'expectedRevision')::int+1;
            e:=learn_work_delay_evidence('aaa40000-0000-0000-0000-000000000004','de1a0000-0000-4000-8000-000000000001','de1a0000-0000-4000-8000-000000000620');
            assert e->'capture'->>'count'='1','Shorter approval must not capture its excluded closing event';
            assert e->'approval'->'evidenceIds'=p->'evidenceIds';
            assert (e->'approval'->'period'->>'end')::timestamptz=(p->'period'->>'end')::timestamptz;
          end $$;rollback;""".encode(), 'Actual browser selection descriptor through SQL approval and retained shorter proof')

        delay_tenant='aaa40000-0000-0000-0000-000000000004'
        delay_object='de1a0000-0000-4000-8000-000000000001'
        def delay_head():
            return int(calendar_query(f"select max(revision) from learn_work_delay_events where tenant_id='{delay_tenant}' and object_id='{delay_object}'"))
        expected=delay_head()
        def same_head_approval(request_id):
            return competing_call(f"learn_work_delay_record('{delay_tenant}','{request_id}',(select payload from delay_fixture)||jsonb_build_object('expectedRevision',{expected}))")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(same_head_approval,[str(uuid.uuid4()),str(uuid.uuid4())]))
        assert sum(r.returncode==0 for r in results)==1, 'Only one same-head delay review may win'
        assert any(b'Delay review history changed' in r.stderr for r in results)
        print('Concurrent same-head delay approvals retain one next revision: PASS')
        for decision in ['approve','reverse']:
            request_id=str(uuid.uuid4())
            if decision=='reverse':
                fresh_id=str(uuid.uuid4())
                prepared=competing_call(f"learn_work_delay_record('{delay_tenant}','{fresh_id}',(select payload from delay_fixture)||jsonb_build_object('expectedRevision',{delay_head()}))")
                assert prepared.returncode==0
                payload=f"jsonb_build_object('objectId','{delay_object}','expectedRevision',{delay_head()},'decision','reverse','approvalId','{fresh_id}','period',null,'label',null,'evidenceIds','[]'::jsonb,'reason','Concurrent reversal recovery')"
            else:
                payload=f"((select payload from delay_fixture)||jsonb_build_object('expectedRevision',{delay_head()}))"
            record=f"learn_work_delay_record('{delay_tenant}','{request_id}',{payload})"
            cancel=f"learn_work_delay_resolve('{delay_tenant}','{request_id}',{payload},true)"
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                write_result,cancel_result=list(pool.map(competing_call,[record,cancel]))
            assert cancel_result.returncode==0
            outcome=json.loads(next(line for line in cancel_result.stdout.decode().splitlines() if line.startswith('{')))
            if outcome['state']=='cancelled':
                assert write_result.returncode!=0 and b'Delay request cancelled' in write_result.stderr
            else:
                assert outcome['state']=='recorded' and write_result.returncode==0
            assert calendar_query(f"select (select count(*) from learn_work_delay_events where id='{request_id}')+(select count(*) from learn_work_delay_cancellations where id='{request_id}')")=='1'
            settled=competing_call(cancel)
            assert settled.returncode==0 and json.loads(next(line for line in settled.stdout.decode().splitlines() if line.startswith('{')))==outcome
            print(f'Concurrent delay {decision}/cancel has one stable terminal outcome: PASS')
        apply(b"do $$begin assert (select history=(select md5(string_agg(to_jsonb(x)::text,'' order by capture_sequence)) from object_state_history x) from delay_source_before);assert (select measurements=(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from measurements x) from delay_before);end $$;",'Post-concurrency work history and measurement preservation')

finally:
    subprocess.run([DOCKER, 'rm', '-f', TARGET], capture_output=True)
