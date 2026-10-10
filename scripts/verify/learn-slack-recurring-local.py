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
name = 'serviceos-slack-recurring-' + uuid.uuid4().hex[:8]
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
      create or replace function auth.role() returns text language sql stable as $$select current_setting('test.role',true)$$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      create schema verify;
      create table verify.fixture(account_id uuid,first_job uuid,initial_cursor jsonb,initial_settings jsonb);
      grant usage on schema verify to authenticated,service_role;
      grant select on verify.fixture to authenticated,service_role;
    """ + predicate)
    sql((root/'supabase/migrations/20261101003000_learn_slack_recurring.sql').read_text())
    sql((root/'scripts/verify/learn-slack-recurring.assert.sql').read_text())
    # Reconcile a synthetic completed page, then race actual concurrent scheduler
    # transactions. The second must skip the locked tenant, not create a duplicate.
    sql("""
      update connector_accounts set sync_cursor=jsonb_build_object('scopeKey',jsonb_build_array(tenant_id::text,
       settings->'slack_history'->>'teamId',settings->'slack_history'->>'channelId',settings->'slack_history'->>'oldest',
       settings->'slack_history'->>'latest',settings->'slack_history'->>'consentReference')::text,'complete',true,'pages',1,'cursor',null);
      update platform_jobs set status='succeeded',metadata=jsonb_build_object('slack_page_v1',jsonb_build_object(
       'account_id',payload->>'connector_account_id','next',(select sync_cursor from connector_accounts))) where status='queued';
      set test.actor='00000000-0000-4000-8000-000000000011';set test.role='authenticated';set role authenticated;
      select learn_slack_recurring_control('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000043',
       (select account_id from verify.fixture),3,true,'Resume after reviewed completion');
    """)
    command = [docker,'exec','-i',name,'psql','-h','127.0.0.1','-U','supabase_admin','-d','recurring_test','-At','-v','ON_ERROR_STOP=1']
    held = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    held.stdin.write("begin;set test.role='service_role';set role service_role;select learn_slack_schedule_recurring(10);select pg_sleep(2);commit;\n")
    held.stdin.flush()
    for _ in range(60):
        lock = subprocess.run(command, input="select count(*) from pg_locks where locktype='advisory' and granted;", text=True, capture_output=True, check=True)
        if int(lock.stdout.strip()) > 0:
            break
        time.sleep(.05)
    else:
        raise RuntimeError('Concurrent scheduler did not acquire its lock')
    second = sql("set test.role='service_role';set role service_role;select learn_slack_schedule_recurring(10);")
    assert '"queued": 0' in second, second
    held.stdin.close()
    held.wait(timeout=15)
    first = held.stdout.read()
    assert held.returncode == 0 and '"queued": 1' in first, held.stderr.read()
    sql("do $$begin if (select count(*) from platform_jobs where status='queued')<>1 then raise exception 'Concurrent duplicate';end if;end $$;")
    print('PASS: concurrent schedulers produce one window; locked tenant is skipped', flush=True)
finally:
    subprocess.run([docker, 'rm', '-f', name], capture_output=True)
