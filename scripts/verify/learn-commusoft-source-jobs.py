"""Isolated source-card reader tests: real access functions, synthetic used-column tables.
No host mounts, network, provider requests, hosted credentials or production data.
"""
import shutil, subprocess, time, uuid
from pathlib import Path
root = Path(__file__).resolve().parents[2]
docker = shutil.which('docker') or '/usr/local/bin/docker'
name = 'serviceos-source-jobs-' + uuid.uuid4().hex[:8]
created = False
def source(p): return (root / p).read_text()
def sql(s):
    p = subprocess.run([docker, 'exec', '-i', name, 'psql', '-h', '127.0.0.1', '-XqAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=s, text=True, capture_output=True, timeout=45)
    if p.returncode: raise RuntimeError(p.stderr[-3500:])
    return p.stdout.strip()
def between(s, start, end):
    assert s.count(start) == 1 and s.count(end) == 1
    return s[s.index(start):s.index(end)]
try:
    subprocess.run([docker, 'run', '-d', '--pull=never', '--network', 'none', '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:15'], check=True, capture_output=True); created = True
    for _ in range(40):
        if subprocess.run([docker, 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0: break
        time.sleep(.25)
    sql(source('scripts/verify/learn-commusoft-source-jobs.fixture.sql'))
    sql(between(source('supabase/migrations/20261031080000_learn_import_batches.sql'), 'create function learn_import_batch_authority(', 'create function learn_import_match_batch('))
    sql(between(source('supabase/migrations/20260822120000_platform_authority_decoupled_from_role.sql'), 'create or replace function current_user_is_openfolk_operator(', '-- ── Governed record'))
    sql(between(source('supabase/migrations/20261031160000_learn_operator_inputs.sql'), 'create function public.learn_operator_input_access(', '-- Explicit booleans'))
    business = source('supabase/migrations/20261101510000_openfolk_business_review.sql')
    sql(between(business, 'create function public.learn_business_review_authority(', '-- Only the retained'))
    review = between(source('supabase/migrations/20261031130000_learn_business_input_review.sql'), 'create function public.learn_business_input_review_access(', 'create function public.learn_business_customer_summary(')
    sql(review.replace('public.learn_import_batch_authority(', 'public.learn_business_review_authority('))
    sql(business[business.index('create function public.openfolk_business_review('):].replace('\ncommit;', ''))
    migration = source('supabase/migrations/20261104150000_learn_commusoft_source_job_cards.sql')
    baseline = sql("select md5(pg_get_functiondef('openfolk_business_review(uuid,text,text,jsonb)'::regprocedure))")
    sql(migration.replace('\ncommit;', '\nrollback;'))
    assert sql("select to_regprocedure('learn_commusoft_source_job_cards(uuid,uuid,text,boolean,text)') is null") == 't'
    assert baseline == sql("select md5(pg_get_functiondef('openfolk_business_review(uuid,text,text,jsonb)'::regprocedure))")
    sql(migration)
    plan_patch = source('supabase/migrations/20261104151000_learn_commusoft_source_job_plan.sql')
    sql(plan_patch.replace('\ncommit;', '\nrollback;'))
    assert sql("select not ('enable_nestloop=off'=any(proconfig)) from pg_proc where oid='learn_commusoft_source_job_rows(uuid,uuid)'::regprocedure") == 't'
    sql(plan_patch)
    assert sql("select 'enable_nestloop=off'=any(proconfig) from pg_proc where oid='learn_commusoft_source_job_rows(uuid,uuid)'::regprocedure") == 't'
    print(sql(source('scripts/verify/learn-commusoft-source-jobs.assert.sql')), flush=True)
    data = sql("set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000010';set role authenticated;select learn_commusoft_source_job_cards(fixture_id(1),fixture_id(5),'001',true,null)")
    subprocess.run(['node', '--input-type=module', '-e', "import{readFileSync}from'node:fs';import{readSourceJobPage}from'./src/lib/learn-commusoft-source-jobs.ts';const d=JSON.parse(readFileSync(0,'utf8'));readSourceJobPage(d,{tenant:d.tenant_id,actor:d.actor_id,connection:d.connection_id,query:'001',openOnly:true,after:null});console.log('Actual SQL response passes the UI parser.');"], input=data, text=True, cwd=root, check=True)
    print('Transactional installation rollback restored operator dispatch; no hosted changes.', flush=True)
finally:
    if created: subprocess.run([docker, 'rm', '-f', name], capture_output=True, check=True)
