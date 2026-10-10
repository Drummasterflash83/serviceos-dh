"""Recurring approval/scheduling in disposable offline PostgreSQL.
Uses real history storage/setup and capture predicate, with minimal queue/Auth
fixtures. No network, live database, credentials, source import or deployment.
"""
import shutil
import json
import subprocess
import time
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[2]
docker = shutil.which('docker') or '/usr/local/bin/docker'
name = 'serviceos-slack-recurring-threads-' + uuid.uuid4().hex[:8]
image = 'public.ecr.aws/supabase/postgres:17.6.1.141'
def sql(text):
    r = subprocess.run([docker, 'exec', '-i', name, 'psql', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'recurring_test', '-At', '-v', 'ON_ERROR_STOP=1'], input=text, text=True, capture_output=True)
    if r.returncode:
        print(r.stdout[-1200:])
        print(r.stderr[-2200:])
        raise RuntimeError('Recurring SQL checks failed')
    passed = [line for line in r.stdout.splitlines() if line.startswith('PASS:')]
    print('\n'.join(passed) if passed else r.stdout[-400:], flush=True)
    return r.stdout

try:
    subprocess.run([docker, 'run', '-d', '--pull=never', '--network', 'none', '--name', name,
                    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image], check=True, capture_output=True)
    for _ in range(100):
        r = subprocess.run([docker, 'exec', name, 'psql', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'postgres', '-Atc', 'select 1'], capture_output=True)
        if r.returncode == 0:
            break
        time.sleep(.25)
    else:
        raise RuntimeError('Disposable database unavailable')
    subprocess.run([docker, 'exec', name, 'createdb', '-U', 'supabase_admin', '-T', 'template0', 'recurring_test'], check=True, capture_output=True)
    base = (root/'scripts/verify/learn-slack-history.test.sql').read_text()
    for role in ['anon', 'authenticated', 'service_role bypassrls']:
        base = base.replace('create role ' + role + ';', '')
    paths = ['supabase/migrations/20260708140000_interactions.sql',
             'supabase/migrations/20261029130000_learn_slack_history.sql',
             'scripts/verify/learn-slack-setup.fixture.sql',
             'supabase/migrations/20261029140000_learn_slack_import_setup.sql']
    sql(base + '\n' + '\n'.join((root/p).read_text() for p in paths))
    catalog = json.loads((root/'docs/operations/evidence/learn-test-foundation-schema-2026-10-09.json').read_text())
    sql('\n'.join(f['definition']+';' for f in catalog['helpers'] if f['name'] in ['current_tenant_id','current_user_role']))
    capture = (root/'supabase/migrations/20261031230000_learn_capture_controls.sql').read_text()
    predicate = capture[capture.index('create function public.learn_capture_allowed('):capture.index('-- Operator data')]
    sql("""
      alter table tenants add status text not null default 'active';
      alter table platform_jobs add metadata jsonb not null default '{}';
      create table feature_flags(tenant_id uuid,flag text,value jsonb,primary key(tenant_id,flag));
      create table platform_authority_grants(profile_id uuid,permission text,effective_from timestamptz,effective_to timestamptz);
      create or replace function auth.role() returns text language sql stable as $$select current_setting('test.role',true)$$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      create schema verify;
      create table verify.fixture(account_id uuid,first_job uuid,initial_cursor jsonb,initial_settings jsonb);
      grant usage on schema verify to authenticated,service_role;
      grant select on verify.fixture to authenticated,service_role;
    """ + predicate)
    health = json.loads((root/'supabase/release/learn-test/034_operator_health.expected.json').read_text())
    operator = next(f['definition'] for f in health['catalog']['functions'] if f['signature'].startswith('current_user_is_openfolk_operator('))
    sql(operator + ';')
    sql((root/'supabase/migrations/20261101003000_learn_slack_recurring.sql').read_text())

    thread_source=(root/'supabase/migrations/20261030120000_learn_slack_thread_storage.sql').read_text()
    table=thread_source[thread_source.index('create table public.slack_thread_imports('):thread_source.index('create function public.learn_slack_start_thread_import(')]
    sql("create function public.learn_foundation_reference_guard() returns trigger language plpgsql as $$begin return new;end$$;"+table)
    observed=json.loads((root/'supabase/release/learn-test/011_slack_threads.expected.json').read_text())
    sql("alter table platform_jobs add claimed_by text,add attempt_count integer,add lease_expires_at timestamptz,add created_at timestamptz default clock_timestamp(),add error_code text,add result jsonb;grant select on platform_jobs to service_role;"+
        '\n'.join(f['definition']+';' for f in observed['functions'] if f['name'] in ['slack_thread_commit_page','learn_slack_read_thread_credential']))
    sql((root/'supabase/migrations/20261031050000_learn_slack_thread_resume.sql').read_text())
    sql((root/'supabase/migrations/20261101005000_learn_slack_recurring_threads.sql').read_text())
    initial=(root/'scripts/verify/learn-slack-recurring.assert.sql').read_text().split('-- Terminal status')[0]
    sql(initial)
    sql((root/'scripts/verify/learn-slack-recurring-threads.assert.sql').read_text())
    sql("""
      update connector_accounts set sync_cursor=jsonb_build_object('complete',true,'pages',1,'cursor',null);
      update platform_jobs set status='succeeded',metadata=jsonb_build_object('slack_page_v1',jsonb_build_object('account_id',payload->>'connector_account_id','next',(select sync_cursor from connector_accounts))) where job_type='slack.history_sync' and status='queued';
    """)
    command=[docker,'exec','-i',name,'psql','-h','127.0.0.1','-U','supabase_admin','-d','recurring_test','-Atq','-v','ON_ERROR_STOP=1']
    held=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    held.stdin.write("begin;select pg_advisory_xact_lock(hashtextextended('slack.thread:'||account_id::text||':101.1:'||extract(epoch from (definition->>'start')::timestamptz)::text||':'||extract(epoch from (definition->>'end')::timestamptz)::text,0)) from slack_history_imports where id=(select current_import from slack_recurring_channels);select pg_sleep(3);commit;\n")
    held.stdin.flush()
    for _ in range(60):
        seen=subprocess.run(command,input="select count(*) from pg_locks where locktype='advisory' and granted;",text=True,capture_output=True,check=True)
        if int(seen.stdout.strip())>0:break
        time.sleep(.05)
    else:raise RuntimeError('Recovery lock fixture did not start')
    # A real conflicting window lock must be skipped, not waited on while holding the account.
    attempted=subprocess.run(command,input="set statement_timeout='1s';set test.role='service_role';set role service_role;select learn_slack_queue_recurring_threads((select account_id from verify.fixture));",text=True,capture_output=True,timeout=2)
    assert attempted.returncode==0 and attempted.stdout.strip()=='f',attempted.stderr
    held.stdin.close();held.wait(timeout=10)
    assert held.returncode==0,held.stderr.read()
    from concurrent.futures import ThreadPoolExecutor
    def queue():
        return subprocess.run(command,input="set test.role='service_role';set role service_role;select learn_slack_queue_recurring_threads((select account_id from verify.fixture));",text=True,capture_output=True,timeout=10)
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:queue(),range(2)))
    assert all(r.returncode==0 for r in results),[r.stderr for r in results]
    sql("do $$begin if (select count(*) from slack_recurring_thread_members where history_import_id=(select current_import from slack_recurring_channels))<>23 then raise exception 'Concurrent thread duplication or missing batch';end if;end $$;")
    print('PASS: conflicting recovery lock is skipped promptly; concurrent schedulers retain one import per parent/window',flush=True)
    (root/'.verification-results/slack-recurring-threads-local.json').write_text(json.dumps({
      'state':'passed','scope':'Synthetic PostgreSQL; actual scheduler/control/thread functions with minimal Auth/queue fixtures',
      'limits':['No provider calls, hosted deployment or UI activation. Reference guard is a fixture; full reference guard and worker round trip remain separate.']},indent=2)+'\n')
finally:
    subprocess.run([docker, 'rm', '-f', name], capture_output=True)
