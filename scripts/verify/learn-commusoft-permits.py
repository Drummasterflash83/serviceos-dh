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
if sys.argv[1:] not in ([], ['--pages'], ['--worker'], ['--customers'], ['--work'], ['--batches']):
    raise SystemExit('Usage: learn-commusoft-permits.py [--pages|--worker|--customers|--work|--batches]')


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
    if sys.argv[1:] in (['--customers'], ['--work'], ['--batches']):
        sql('\n'.join((root / path).read_text() for path in paths[:2]))
        sql((root / 'supabase/migrations/20261031100000_learn_business_input_pages.sql').read_text())
        sql((root / 'scripts/verify/learn-commusoft-worker.fixture.sql').read_text())
        queue = (root / 'supabase/migrations/20260710120000_platform_job_queue.sql').read_text()
        marker = '-- ── Register the async queue worker'
        if queue.count(marker) != 1:
            raise RuntimeError('Original queue source boundary changed')
        sql(queue.split(marker)[0])
        sql((root / 'supabase/migrations/20261031110000_learn_commusoft_worker.sql').read_text())
        sql("update platform_jobs set status='running',attempt_count=1,claimed_by='fixture-worker',lease_expires_at=clock_timestamp()+interval '1 hour';")
        sql("create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at:=now();return new;end$$;")
        foundation = (root / 'supabase/migrations/20260709120000_customer_cards_foundation.sql').read_text()
        start = 'create table if not exists companies ('
        end = '-- interaction_match_suggestions —'
        if foundation.count(start) != 1 or foundation.count(end) != 1:
            raise RuntimeError('Canonical customer schema boundary changed')
        sql(foundation[foundation.index(start):foundation.index(end)])
        sql((root / 'scripts/verify/learn-business-input-customers.fixture.sql').read_text())
        authority = (root / 'supabase/migrations/20261031080000_learn_import_batches.sql').read_text()
        start = 'create function learn_import_batch_authority('
        end = 'create function learn_import_match_batch('
        if authority.count(start) != 1 or authority.count(end) != 1:
            raise RuntimeError('Import authority source boundary changed')
        sql(authority[authority.index(start):authority.index(end)])
        migration = (root / 'supabase/migrations/20261031120000_learn_business_input_customers.sql').read_text()
        sql(migration.replace('\ncommit;', '\nrollback;'))
        if sql("select to_regclass('public.learn_business_input_links') is null and to_regprocedure('public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text)') is null;") != 't':
            raise RuntimeError('Customer projection rollback left objects')
        print('Customer projection migration rollback: no new objects retained.')
        print(sql(migration + '\n' + (root / 'scripts/verify/learn-business-input-customers.assert.sql').read_text()))

        def review(_):
            return sql("set request.jwt.claim.role='service_role'; set role service_role; select fixture_review(9,'person',null)->>'already';")

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(review, [1, 2]))
        if sorted(results) != ['false', 'true']:
            raise RuntimeError(f'Concurrent customer review failed: {results}')
        if sql("select count(*) from learn_business_input_links where external_id='9';") != '1':
            raise RuntimeError('Concurrent review duplicated identity')
        print('Concurrent customer review: one identity/card and one replay acknowledgement.')
        sql("create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;")
        review_migration = (root / 'supabase/migrations/20261031130000_learn_business_input_review.sql').read_text()
        before = sql("select md5(pg_get_functiondef('public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text)'::regprocedure));")
        sql(review_migration.replace('\ncommit;', '\nrollback;'))
        if sql("select md5(pg_get_functiondef('public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text)'::regprocedure));") != before:
            raise RuntimeError('Review facade rollback changed private writer')
        print(sql(review_migration + '\n' + (root / 'scripts/verify/learn-business-input-review.assert.sql').read_text()))
        if sys.argv[1:] in (['--work'], ['--batches']):
            schema = (root / 'supabase/migrations/20260814120000_universal_imports_and_jobs.sql').read_text()
            start, end = 'create table if not exists sites (', '-- ── Job-number aliases'
            if schema.count(start) != 1 or schema.count(end) != 1:
                raise RuntimeError('Canonical work schema boundary changed')
            sql(schema[schema.index(start):schema.index(end)])
            migration = (root / 'supabase/migrations/20261031140000_learn_business_input_work.sql').read_text()
            sql(migration.replace('\ncommit;', '\nrollback;'))
            if sql("select to_regclass('public.learn_business_input_projection_attempts') is null and to_regprocedure('public.learn_commusoft_confirm_work_record(uuid,uuid,uuid,text)') is null;") != 't':
                raise RuntimeError('Work projection rollback left objects')
            print(sql(migration + '\n' + (root / 'scripts/verify/learn-business-input-work.fixture.sql').read_text() + '\n' + (root / 'scripts/verify/learn-business-input-work.assert.sql').read_text()))

            def work_review(_):
                return sql("set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080'; set role authenticated; select learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','111'),null,'Synthetic work review')->>'already';")

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(work_review, [1, 2]))
            if sorted(results) != ['false', 'true'] or sql("select count(*) from jobs where external_id='111';") != '1':
                raise RuntimeError('Concurrent work projection duplicated or lost identity')
            print('Concurrent job projection: one canonical job and one exact replay acknowledgement.')
            if sys.argv[1:] == ['--batches']:
                migration = (root / 'supabase/migrations/20261031150000_learn_business_input_work_batches.sql').read_text()
                sql(migration.replace('\ncommit;', '\nrollback;'))
                if sql("select to_regclass('public.learn_business_input_projection_batches') is null;") != 't':
                    raise RuntimeError('Batch rollback retained receipt table')
                print(sql(migration + '\n' + (root / 'scripts/verify/learn-business-input-work-batches.assert.sql').read_text()))

                def batch_race(cancel):
                    return sql("set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080'; set role authenticated; select learn_commusoft_work_batch(fixture_id(1),fixture_id(95),fixture_id(5),'job',jsonb_build_array(jsonb_build_object('version_id',fixture_work_version('jobs','205'),'target_id',null)),'Synthetic race'," + ('true' if cancel else 'false') + ")->>'state';")

                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                    results = list(pool.map(batch_race, [False, True]))
                if results not in (['recorded', 'recorded'], ['cancelled', 'cancelled']):
                    raise RuntimeError(f'Batch race returned inconsistent receipts: {results}')
                expected_jobs = '1' if results[0] == 'recorded' else '0'
                if sql("select count(*) from jobs where external_id='205';") != expected_jobs:
                    raise RuntimeError('Batch race receipt disagrees with canonical state')
                print('Concurrent apply/cancel: both callers receive the same retained outcome; canonical state matches.')
        raise SystemExit(0)
    if sys.argv[1:] == ['--worker']:
        sql('\n'.join((root / path).read_text() for path in paths[:2]))
        sql((root / 'scripts/verify/learn-commusoft-worker.fixture.sql').read_text())
        queue = (root / 'supabase/migrations/20260710120000_platform_job_queue.sql').read_text()
        marker = '-- ── Register the async queue worker'
        if queue.count(marker) != 1:
            raise RuntimeError('Original queue source boundary changed')
        sql(queue.split(marker)[0])  # Original claim function; no scheduler definitions.
        sql((root / 'supabase/migrations/20261031100000_learn_business_input_pages.sql').read_text())
        migration = (root / 'supabase/migrations/20261031110000_learn_commusoft_worker.sql').read_text()
        hash_query = "select md5(pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure)||pg_get_functiondef('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)'::regprocedure)||pg_get_functiondef('public.learn_commusoft_commit_page(uuid,uuid,text,integer,uuid,jsonb)'::regprocedure));"
        before = sql(hash_query)
        sql(migration.replace('\ncommit;', '\nrollback;'))
        if sql(hash_query) != before or sql("select to_regprocedure('public.learn_commusoft_claim_jobs(uuid)') is null;") != 't':
            raise RuntimeError('Worker rollback changed prior functions')
        print('Worker rollback restores generic claim and credential acquisition.')
        print(sql(migration + '\n' + (root / 'scripts/verify/learn-commusoft-worker.assert.sql').read_text()))
        sql("""insert into platform_jobs(id,tenant_id,job_type,job_key,status,attempt_count,max_attempts,payload)
          values(fixture_id(32),fixture_id(1),'commusoft.source_sync','race','queued',0,3,'{}');""")

        def claim(worker):
            return sql(f"set request.jwt.claim.role='service_role'; set role service_role; select id from learn_commusoft_claim_jobs(fixture_id({worker}));")

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(claim, [70, 71]))
        if sorted(results) != ['', '00000000-0000-4000-8000-000000000032']:
            raise RuntimeError(f'Worker claim race failed: {results}')
        print('Concurrent worker claims: only one worker owns the queued job.')
        raise SystemExit(0)
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
