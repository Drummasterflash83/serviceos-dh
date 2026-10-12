"""Real resume/worker SQL on a disposable database, with synthetic data only.
No network, host mounts, provider requests or hosted permission changes.
"""
import shutil
import sys
import subprocess
import time
import uuid
from pathlib import Path
root = Path(__file__).resolve().parents[2]
docker = shutil.which('docker') or '/usr/local/bin/docker'
name = 'serviceos-contact-traversal-' + uuid.uuid4().hex[:8]
created = False
if sys.argv[1:] not in ([], ["--legacy-resume"], ["--update-windows"], ["--recurring"]): raise SystemExit("Unexpected mode")
legacy = sys.argv[1:] == ["--legacy-resume"]
recurring = sys.argv[1:] == ["--recurring"]
update_windows = sys.argv[1:] in (["--update-windows"], ["--recurring"])

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
    sql(source('supabase/migrations/20261031200000_learn_commusoft_resume.sql'))
    migration = source('supabase/migrations/20261101020000_learn_commusoft_contact_traversal.sql')
    before = sql("select md5(string_agg(pg_get_functiondef(p.oid),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('learn_commusoft_acquire_page','learn_commusoft_commit_page','learn_operator_input_request','learn_operator_inputs','learn_operator_resume_commusoft')")
    sql(migration.replace('\ncommit;', '\nrollback;'))
    assert sql("select to_regclass('learn_commusoft_contact_targets') is null") == 't'
    after = sql("select md5(string_agg(pg_get_functiondef(p.oid),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('learn_commusoft_acquire_page','learn_commusoft_commit_page','learn_operator_input_request','learn_operator_inputs','learn_operator_resume_commusoft')")
    assert before == after
    print('Migration rollback restores all five existing functions and leaves no target table.', flush=True)
    sql(migration)
    assertions = 'scripts/verify/learn-commusoft-resume.assert.sql' if legacy else 'scripts/verify/learn-commusoft-contact-traversal.assert.sql'
    print(sql(source(assertions)), flush=True)
    if not legacy: subprocess.run(['node','scripts/verify/learn-commusoft-contact-traversal-bridge.mjs',docker,name],cwd=root,check=True,timeout=60)
    if not legacy:
        print(sql("begin;\n"+source('scripts/verify/learn-commusoft-property-refresh.assert.sql')+"\nrollback;"),flush=True)
        sql("alter table tenants alter column status set default 'active',add column slug text,add column display_name text,add column metadata jsonb default '{}';alter table provider_connections alter column updated_at set default clock_timestamp();")
        sql("begin;\n"+source('scripts/verify/learn-commusoft-contact-traversal-hosted.assert.sql')+"\nrollback;")
        print('Hosted rollback probe also passed against the disposable database.',flush=True)
    if update_windows:
        window_migration = source('supabase/migrations/20261101540000_learn_commusoft_update_windows.sql')
        original = sql("select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")
        sql(window_migration.replace('\ncommit;', '\nrollback;'))
        assert sql("select to_regprocedure('learn_commusoft_update_window(jsonb)') is null") == 't'
        assert original == sql("select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")
        sql(window_migration)
        print(sql(source('scripts/verify/learn-commusoft-update-windows.assert.sql')),flush=True)
        print('Update-window migration and rollback passed; existing definitions and grants restored by rollback.',flush=True)
    if recurring:
        recurring_migration = source('supabase/migrations/20261101550000_learn_commusoft_recurring.sql')
        original = sql("select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")
        sql(recurring_migration.replace('\ncommit;', '\nrollback;'))
        assert sql("select to_regclass('learn_commusoft_recurring') is null") == 't'
        assert original == sql("select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")
        sql(recurring_migration)
        print(sql(source('scripts/verify/learn-commusoft-recurring.assert.sql')),flush=True)
        print('Recurring installation rollback restores all definitions and grants; no hosted changes.',flush=True)
    overview = sql("set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;select learn_operator_inputs(fixture_id(100));")
    path=root/('.verification-results/commusoft-contact-traversal-overview-legacy.json' if legacy else '.verification-results/commusoft-contact-traversal-overview.json')
    path.write_text(overview+'\n')
    subprocess.run(['node','--input-type=module','-e',"import{readFileSync}from'node:fs';import{readOperatorInputs}from'./src/lib/learn-operator-inputs.ts';const data=JSON.parse(readFileSync(process.argv[1]));await readOperatorInputs({rpc:async()=>({data,error:null})},data.tenant_id);",str(path)],cwd=root,check=True,capture_output=True)
    print('Actual operator overview passes the application parser.',flush=True)
finally:
    if created: subprocess.run([docker,'rm','-f',name],check=True,capture_output=True,timeout=30)
