"""Real resume/worker SQL on a disposable database, with synthetic data only.
No network, host mounts, provider requests or hosted permission changes.
"""
import concurrent.futures
import shutil
import subprocess
import time
import uuid
from pathlib import Path
root = Path(__file__).resolve().parents[2]
docker = shutil.which('docker') or '/usr/local/bin/docker'
name = 'serviceos-commusoft-resume-' + uuid.uuid4().hex[:8]
created = False

def sql(text):
    r = subprocess.run([docker, 'exec', '-i', name, 'psql', '-h', '127.0.0.1', '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=text, text=True, capture_output=True, timeout=40)
    if r.returncode: raise RuntimeError(r.stderr[-4000:])
    return r.stdout.strip()

def source(path): return (root / path).read_text()
try:
    subprocess.run([docker, 'run', '-d', '--pull=never', '--network', 'none', '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:15'], check=True, capture_output=True, timeout=30)
    created = True
    for _ in range(40):
        if subprocess.run([docker, 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0: break
        time.sleep(.25)
    else: raise RuntimeError('Disposable database unavailable')
    for path in ['scripts/verify/learn-commusoft-permits.fixture.sql', 'scripts/verify/learn-commusoft-worker.fixture.sql', 'scripts/verify/learn-operator-inputs.fixture.sql']:
        sql(source(path))
    queue = source('supabase/migrations/20260710120000_platform_job_queue.sql')
    sql(queue.split('-- ── Register the async queue worker')[0])
    for path in ['supabase/migrations/20261031090000_learn_commusoft_page_permits.sql','supabase/migrations/20261031100000_learn_business_input_pages.sql','supabase/migrations/20261031110000_learn_commusoft_worker.sql']:
        sql(source(path))
    authority = source('supabase/migrations/20260821120000_openfolk_control_plane.sql')
    sql(authority[authority.index('create table if not exists platform_authority_grants ('):authority.index('-- OpenFolk-operator resolver')])
    resolver = source('supabase/migrations/20260822120000_platform_authority_decoupled_from_role.sql')
    sql(resolver[resolver.index('create or replace function current_user_is_openfolk_operator('):resolver.index('-- ── Governed record')])
    sql(source('supabase/migrations/20261031160000_learn_operator_inputs.sql'))
    migration = source('supabase/migrations/20261031200000_learn_commusoft_resume.sql')
    sql(migration.replace('\ncommit;', '\nrollback;'))
    assert sql("select to_regprocedure('learn_operator_resume_commusoft(uuid,uuid,uuid,jsonb,text)') is null") == 't'
    sql(migration)
    print(sql(source('scripts/verify/learn-commusoft-resume.assert.sql')), flush=True)
    def race(mode):
        return sql("set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;select learn_operator_resume_commusoft(fixture_id(100),fixture_id(230),fixture_id(180),fixture_definition('race'),'" + mode + "')->>'state';")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results = list(pool.map(race, ['apply','cancel']))
    assert results in (['recorded','recorded'],['cancelled','cancelled']), results
    assert sql('select count(*) from learn_operator_input_requests where id=fixture_id(230)') == '1'
    print('Concurrent continuation/cancellation returns one immutable outcome.', flush=True)
    sql("update platform_jobs set status='dead_letter' where tenant_id=fixture_id(100) and status='queued';insert into fixture_input_definitions values('two_requests',fixture_resume_definition());")
    def competing(n):
        return sql("set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;do $$begin begin perform learn_operator_resume_commusoft(fixture_id(100),fixture_id("+str(n)+"),fixture_id(180),fixture_definition('two_requests'));exception when object_not_in_prerequisite_state then null;end;end$$;")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: list(pool.map(competing,[231,232]))
    assert sql('select count(*) from learn_operator_input_requests where id in (fixture_id(231),fixture_id(232))') == '1'
    assert sql("select count(*) from platform_jobs where tenant_id=fixture_id(100) and status='queued'") == '1'
    print('Competing continuation requests enqueue exactly one job.',flush=True)
    receipt = sql("select receipt from learn_operator_input_requests where id=fixture_id(220)")
    definition = sql("select definition from fixture_input_definitions where name='resume'")
    output = root/'.verification-results/commusoft-resume-local.json'
    output.write_text('{"receipt":'+receipt+',"definition":'+definition+'}\n')
    subprocess.run(['node','--input-type=module','-e',"import{readFileSync}from'node:fs';import{resolveOperatorInput}from'./src/lib/learn-operator-inputs.ts';const{receipt,definition}=JSON.parse(readFileSync('.verification-results/commusoft-resume-local.json'));await resolveOperatorInput({rpc:async()=>({data:receipt,error:null})},{tenantId:receipt.tenant_id,actorId:'00000000-0000-4000-8000-000000000180',requestId:receipt.request_id,definition},'check');"], cwd=root,check=True,capture_output=True)
    print('Actual SQL continuation receipt accepted by application adapter.',flush=True)
finally:
    if created: subprocess.run([docker,'rm','-f',name],check=True,capture_output=True,timeout=30)
