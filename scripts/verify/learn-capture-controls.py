"""Exercise actual operator-control SQL in isolated Postgres; no network or host mounts."""
import concurrent.futures
import shutil
import subprocess
import time
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[2]
docker = shutil.which('docker') or '/usr/local/bin/docker'
name = 'serviceos-capture-controls-' + uuid.uuid4().hex[:8]
created = False

def sql(text):
    r = subprocess.run([docker, 'exec', '-i', name, 'psql', '-h', '127.0.0.1', '-X', '-qAt', '-U', 'postgres',
                        '-v', 'ON_ERROR_STOP=1'], input=text, text=True, capture_output=True, timeout=40)
    if r.returncode:
        raise RuntimeError(r.stderr[-3000:])
    return r.stdout.strip()

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
    sql(source('scripts/verify/learn-commusoft-permits.fixture.sql'))
    sql(source('scripts/verify/learn-commusoft-worker.fixture.sql'))
    sql(source('scripts/verify/learn-operator-inputs.fixture.sql'))
    authority = source('supabase/migrations/20260821120000_openfolk_control_plane.sql')
    sql(authority[authority.index('create table if not exists platform_authority_grants ('):authority.index('-- OpenFolk-operator resolver')])
    resolver = source('supabase/migrations/20260822120000_platform_authority_decoupled_from_role.sql')
    sql(resolver[resolver.index('create or replace function current_user_is_openfolk_operator('):resolver.index('-- ── Governed record')])
    migration = source('supabase/migrations/20261031160000_learn_operator_inputs.sql')
    sql(migration.replace('\ncommit;', '\nrollback;'))
    if sql("select to_regclass('learn_operator_input_requests') is null and to_regprocedure('learn_operator_inputs(uuid)') is null") != 't':
        raise RuntimeError('Rollback retained operator objects')
    print('Operator migration rollback left no new objects.')
    sql(migration)
    print(sql(source('scripts/verify/learn-operator-inputs.assert.sql')))

    queue=source('supabase/migrations/20260710120000_platform_job_queue.sql')
    sql(queue[queue.index('create or replace function platform_jobs_claim('):queue.index('-- ── Register')])
    # Load the actual dedicated Slack claimant with its pacing table. Its finish
    # functions are unrelated to the filter change and remain separately verified.
    pacing=source('supabase/migrations/20261030150000_learn_slack_workspace_pacing.sql')
    sql(pacing[pacing.index('create table public.slack_workspace_pacing'):pacing.index('-- Keep all completion')])
    sql("create table slack_thread_imports(id uuid,tenant_id uuid,account_id uuid,scope jsonb,checkpoint jsonb);grant select on slack_thread_imports,connector_accounts,tenant_connectors to service_role;")
    sql("create table phone_recording_pipeline_state(id uuid,tenant_id uuid,stage text,sort_at timestamptz,has_provider_id boolean,is_incomplete boolean);create table phone_sync_runs(id uuid,tenant_id uuid,sync_type text,status text,metadata jsonb,started_at timestamptz);grant select on phone_recording_pipeline_state,phone_sync_runs to service_role;")
    sql(source('supabase/migrations/20261024100000_phone_retry_fairness.sql'))
    before=sql("select pg_get_functiondef('platform_jobs_claim(text,integer,integer,text[])'::regprocedure)||pg_get_functiondef('learn_slack_claim_jobs(uuid,integer)'::regprocedure)||pg_get_functiondef('phone_select_pending(uuid,integer,integer)'::regprocedure)")
    migration=source('supabase/migrations/20261031230000_learn_capture_controls.sql')
    sql(migration.replace('\ncommit;','\nrollback;'))
    assert sql("select to_regclass('learn_capture_control_requests') is null")=='t'
    assert sql("select pg_get_functiondef('platform_jobs_claim(text,integer,integer,text[])'::regprocedure)||pg_get_functiondef('learn_slack_claim_jobs(uuid,integer)'::regprocedure)||pg_get_functiondef('phone_select_pending(uuid,integer,integer)'::regprocedure)")==before
    sql(migration)
    print(sql(source('scripts/verify/learn-capture-controls.assert.sql')),flush=True)
    sql("update feature_flags set value='true' where tenant_id=fixture_id(100) and flag in ('learn.enabled','learn.inputs.email.enabled');")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        writer=pool.submit(sql,"begin;select pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||fixture_id(100)::text,0));update feature_flags set value='false' where tenant_id=fixture_id(100) and flag='learn.inputs.email.enabled';select pg_sleep(1.5);commit;")
        for _ in range(50):
            if sql("select pg_try_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||fixture_id(100)::text,0))")=='f':break
            time.sleep(.02)
        else:raise RuntimeError('Concurrent control transaction was not observed')
        admitted=sql("set role service_role;select learn_capture_admission(fixture_id(100),'email')->>'allowed';")
        writer.result()
        assert admitted=='false','Admission reused a snapshot from before the control lock'
    print('Concurrent pause takes effect before a waiting admission; no stale policy snapshot.',flush=True)

finally:
    if created:
        subprocess.run([docker, 'rm', '-f', name], check=True, capture_output=True, timeout=30)
