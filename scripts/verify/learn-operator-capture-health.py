"""Exercise actual operator-control SQL in isolated Postgres; no network or host mounts."""
import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[2]
docker = shutil.which('docker') or '/usr/local/bin/docker'
name = 'serviceos-capture-health-' + uuid.uuid4().hex[:8]
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
    sql(source('scripts/verify/learn-operator-capture-health.fixture.sql'))
    migration=source('supabase/migrations/20261031210000_learn_operator_capture_health.sql')
    sql(migration.replace('\ncommit;','\nrollback;'))
    assert sql("select to_regprocedure('learn_operator_capture_health(uuid,text)') is null")=='t'
    sql(migration)
    print(sql(source('scripts/verify/learn-operator-capture-health.assert.sql')),flush=True)
    sql(source('scripts/verify/learn-email-capture-evidence.fixture.sql'))
    before=sql("select pg_get_functiondef('learn_operator_capture_health(uuid,text)'::regprocedure)")
    migration=source('supabase/migrations/20261031220000_learn_email_capture_evidence.sql')
    sql(migration.replace('\ncommit;','\nrollback;'))
    assert sql("select pg_get_functiondef('learn_operator_capture_health(uuid,text)'::regprocedure)")==before
    assert sql("select to_regclass('learn_email_capture_run_lookup') is null")=='t'
    sql(migration)
    print(sql(source('scripts/verify/learn-email-capture-evidence.assert.sql')),flush=True)
    # Original Phone tables and selector; synthetic registry/job fixture remains above.
    original=source('supabase/migrations/20260701120000_phone_input_foundation.sql')
    sql(original[original.index('create table if not exists phone_calls ('):original.index('-- phone_transcripts')].rsplit('-- ---------------------------------------------------------------------------',1)[0])
    sql(original[original.index('create table if not exists phone_transcripts ('):original.index('-- phone_sync_runs')].rsplit('-- ---------------------------------------------------------------------------',1)[0])
    sql(original[original.index('create table if not exists phone_sync_runs ('):original.index('alter table phone_sync_runs enable row level security;')]+ 'alter table phone_sync_runs enable row level security;')
    selection=source('supabase/migrations/20260711120000_phone_pipeline_selection.sql')
    sql(selection[selection.index('create or replace view phone_recording_pipeline_state'):selection.index('-- phone_select_pending')].rsplit('-- ---------------------------------------------------------------------------',1)[0])
    sql(source('supabase/migrations/20261024100000_phone_retry_fairness.sql'))
    capture=source('supabase/migrations/20261031230000_learn_capture_controls.sql')
    sql(capture[capture.index('create function public.learn_capture_allowed('):capture.index('-- Operator data')])
    # Load real immutable receipt DDL. Receipt fixtures below test the projection;
    # the actual settlement write path has its own integration/concurrency suite.
    settlement=source('supabase/migrations/20261101009000_learn_phone_schedule_settlement.sql')
    sql(settlement[settlement.index('create table public.learn_phone_schedule_settlements'):settlement.index('create function public.learn_phone_settle_schedule')])
    before=sql("select pg_get_functiondef('learn_operator_capture_health(uuid,text)'::regprocedure)||pg_get_functiondef('phone_pending_readiness(uuid)'::regprocedure)")
    migration=source('supabase/migrations/20261101010000_learn_phone_operator_evidence.sql')
    sql(migration.replace('\ncommit;','\nrollback;'))
    assert sql("select pg_get_functiondef('learn_operator_capture_health(uuid,text)'::regprocedure)||pg_get_functiondef('phone_pending_readiness(uuid)'::regprocedure)")==before
    assert sql("select to_regclass('learn_phone_schedule_health_lookup') is null and to_regprocedure('learn_phone_account_evidence(uuid,uuid)') is null and to_regprocedure('learn_phone_processing_evidence(uuid)') is null")=='t'
    sql(migration)
    print(sql(source('scripts/verify/learn-phone-operator-evidence.assert.sql')),flush=True)
    before=sql("select pg_get_functiondef('learn_operator_capture_health(uuid,text)'::regprocedure)")
    acl=sql("select proowner::text||coalesce(proacl::text,'') from pg_proc where oid='learn_operator_capture_health(uuid,text)'::regprocedure")
    records=sql("select md5(jsonb_agg(to_jsonb(r) order by id)::text) from email_sync_runs r")
    migration=source('supabase/migrations/20261101191000_learn_email_failure_health.sql')
    sql(migration.replace('\ncommit;','\nrollback;'))
    assert sql("select pg_get_functiondef('learn_operator_capture_health(uuid,text)'::regprocedure)")==before
    sql(migration)
    assert sql("select proowner::text||coalesce(proacl::text,'') from pg_proc where oid='learn_operator_capture_health(uuid,text)'::regprocedure")==acl
    assert sql("select md5(jsonb_agg(to_jsonb(r) order by id)::text) from email_sync_runs r")==records
    print(sql(source('scripts/verify/learn-email-failure-health.assert.sql')),flush=True)
    data=sql("set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000182';set role authenticated;select learn_operator_capture_health(fixture_id(100));")
    output=root/'.verification-results/learn-operator-capture-health-local.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(data+'\n')
    subprocess.run(['node','--input-type=module','-e',"import{readFileSync}from'node:fs';import{readCaptureHealth}from'./src/lib/learn-operator-capture-health.ts';const data=JSON.parse(readFileSync('.verification-results/learn-operator-capture-health-local.json'));await readCaptureHealth({rpc:async()=>({data,error:null})},data.tenant_id);"],cwd=root,check=True,capture_output=True)
    # Phone lies after 50+ mailbox rows, so parse every page, not just page one.
    cursor=json.loads(data)['next_cursor']
    while cursor:
        assert __import__('re').fullmatch(r'(email|phone|slack):[0-9a-f-]{36}',cursor)
        data=sql("set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000182';set role authenticated;select learn_operator_capture_health(fixture_id(100),'"+cursor+"');")
        output.write_text(data+'\n')
        subprocess.run(['node','--input-type=module','-e',"import{readFileSync}from'node:fs';import{readCaptureHealth}from'./src/lib/learn-operator-capture-health.ts';const data=JSON.parse(readFileSync('.verification-results/learn-operator-capture-health-local.json'));await readCaptureHealth({rpc:async()=>({data,error:null})},data.tenant_id,process.argv[1]);",cursor],cwd=root,check=True,capture_output=True)
        cursor=json.loads(data)['next_cursor']
    print('Every actual SQL health page passes application parser.',flush=True)
finally:
    if created:
        subprocess.run([docker, 'rm', '-f', name], check=True, capture_output=True, timeout=30)
