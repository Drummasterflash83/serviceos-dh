"""Disposable no-network PostgreSQL rehearsal of the signed-in source-user restore."""
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCKER = shutil.which('docker') or '/usr/local/bin/docker'
NAME = 'serviceos-users-trial-' + uuid.uuid4().hex[:8]
MARKER = "set request.jwt.claim.role='authenticated';"


def sql(source):
    result = subprocess.run([DOCKER, 'exec', '-i', NAME, 'psql', '-h', '127.0.0.1',
                             '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                            input=source, text=True, capture_output=True, timeout=45)
    if result.returncode:
        raise RuntimeError(result.stderr[-4000:])
    return result.stdout.strip()


def generated(name, arm):
    code = (
        "import {" + name + "} from './scripts/verify/new-dawn-m2-users-trial-gates.mjs';"
        "process.stdout.write(" + name + "({armId:'" + arm + "',"
        "accountId:'00000000-0000-4000-8000-000000000303',"
        "actorId:'00000000-0000-4000-8000-000000000180',"
        "reason:'Isolated synthetic trial'}));"
    )
    return subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
                          check=True, capture_output=True, text=True, timeout=10).stdout


if sys.argv[1:] != ['--isolated']:
    raise SystemExit('Usage: new-dawn-m2-users-trial.py --isolated')

created = False
try:
    subprocess.run([DOCKER, 'run', '-d', '--pull=never', '--network', 'none',
                    '--name', NAME, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:15'],
                   check=True, capture_output=True, timeout=30)
    created = True
    for _ in range(40):
        if subprocess.run([DOCKER, 'exec', NAME, 'pg_isready', '-h', '127.0.0.1',
                           '-U', 'postgres'], capture_output=True).returncode == 0:
            break
        time.sleep(.25)
    else:
        raise RuntimeError('Disposable database unavailable')
    fixture = (ROOT / 'scripts/verify/new-dawn-m2-users-trial.assert.sql').read_text()
    schema, cases = fixture.split(MARKER, 1)
    sql(schema)
    migration = (ROOT / 'supabase/migrations/20261108130000_new_dawn_commusoft_users_trial_restore.sql').read_text()
    sql(migration.replace('\ncommit;', '\nrollback;'))
    if sql("select to_regprocedure('public.learn_commusoft_users_trial_restore(uuid,uuid,uuid,uuid,text,text)') is null") != 't':
        raise RuntimeError('Migration rollback left restore RPC installed')
    sql(migration)
    print(sql(MARKER + cases))
    # The real guarded helper must pause recurrence atomically before exposing
    # the users flag, and fail closed without resuming or deleting any source.
    sql("""
      alter table public.learn_commusoft_recurring add column connection_revision timestamptz;
      alter table public.connector_accounts add column account_key text;
      create table public.provider_connections(id uuid primary key,tenant_id uuid,status text,
       revoked_at timestamptz,updated_at timestamptz,provider text,non_secret_config jsonb);
      create function public.learn_commusoft_recurring_actor(p_actor uuid) returns boolean
       language sql stable as $$select p_actor=public.fixture_id(180)$$;
      insert into public.learn_commusoft_recurring(account_id,tenant_id,connection_id,enabled,
       phase,current_request,last_state,revision,next_check_at,updated_at,connection_revision)
       values(public.fixture_id(303),'00000000-0000-0000-0000-000000000001',
       public.fixture_id(305),true,0,null,'cycle_complete',1,clock_timestamp(),
       clock_timestamp(),'2026-01-01Z');
      insert into public.connector_accounts(id,tenant_id,status,settings,sync_cursor,account_key)
       values(public.fixture_id(303),'00000000-0000-0000-0000-000000000001',
       'active',jsonb_build_object('commusoft_import',
        jsonb_build_object('approvalId',public.fixture_id(301),'resource','jobs')),
       jsonb_build_object('approvalId',public.fixture_id(301),'complete',true,'pages',1,'after',null),
       'fixture-account');
      insert into public.provider_connections values(public.fixture_id(305),
       '00000000-0000-0000-0000-000000000001','configured',null,
       '2026-01-01Z','commusoft','{"account_key":"fixture-account"}');
      insert into public.feature_flags(tenant_id,flag,value) values
       ('00000000-0000-0000-0000-000000000001','learn.enabled','true'::jsonb),
       ('00000000-0000-0000-0000-000000000001','learn.inputs.commusoft.enabled','true'::jsonb);
    """)
    arm = '00000000-0000-4000-8000-000000000311'
    sql(generated('armSql', arm).replace('commit;', 'rollback;'))
    if sql("select enabled and revision=1 from public.learn_commusoft_recurring where account_id=public.fixture_id(303)") != 't':
        raise RuntimeError('Arm rollback changed recurring state')
    sql(generated('armSql', arm))
    if sql("select not enabled and revision=2 and last_state='source_user_trial_paused' from public.learn_commusoft_recurring where account_id=public.fixture_id(303)") != 't':
        raise RuntimeError('Arm did not pause recurrence')
    if sql("select value='true'::jsonb from public.feature_flags where tenant_id='00000000-0000-0000-0000-000000000001' and flag='learn.inputs.commusoft.users.enabled'") != 't':
        raise RuntimeError('Arm did not enable only tenant users flag')
    sql(generated('failClosedSql', arm))
    if sql("select value='false'::jsonb from public.feature_flags where tenant_id='00000000-0000-0000-0000-000000000001' and flag='learn.inputs.commusoft.users.enabled'") != 't':
        raise RuntimeError('Fail closed left users flag On')
    if sql("select not enabled from public.learn_commusoft_recurring where account_id=public.fixture_id(303)") != 't':
        raise RuntimeError('Fail closed resumed recurrence')
    print('new-dawn-m2-users-trial-arm-and-fail-closed-synthetic/1')
    sql("""
      create function public.learn_commusoft_recurring_control(p_tenant uuid,p_request uuid,
       p_actor uuid,p_definition jsonb,p_mode text default 'apply') returns jsonb
       language plpgsql security definer set search_path=pg_catalog as $$
       declare s public.learn_commusoft_recurring%rowtype;aid uuid:=(p_definition->>'account_id')::uuid;
       begin
        select * into s from public.learn_commusoft_recurring where account_id=aid;
        if s.account_id is null then return '{"state":"missing"}'::jsonb;end if;
        return '{"state":"recorded"}'::jsonb;
       end$$;
      create function public.learn_operator_input_request(p_tenant uuid,p_request uuid,
       p_actor uuid,p_definition jsonb,p_mode text default 'apply') returns jsonb
       language plpgsql security definer set search_path=pg_catalog as $$
       declare a public.connector_accounts%rowtype;resource text:=p_definition->>'resource';
       begin
        select * into a from public.connector_accounts where id=(p_definition->>'account_id')::uuid;
  if found then
   if a.status is distinct from 'active' then raise exception 'account_changed';end if;
        end if;
        insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt)
         values(p_request,p_tenant,p_actor,p_definition,
          jsonb_build_object('account_id',a.id,'state','recorded'));
        return '{"state":"recorded"}'::jsonb;
       end$$;
      create function public.learn_operator_resume_commusoft(p_tenant uuid,p_request uuid,
       p_actor uuid,p_definition jsonb,p_mode text default 'apply') returns jsonb
       language plpgsql security definer set search_path=pg_catalog as $$
       declare a public.connector_accounts%rowtype;cfg jsonb;cp jsonb;
       begin
        select * into a from public.connector_accounts where id=(p_definition->>'account_id')::uuid;
        cfg:=a.settings->'commusoft_import';cp:=a.sync_cursor;
        return '{"state":"recorded"}'::jsonb;
       end$$;
    """)
    fence = (ROOT / 'supabase/migrations/20261108131000_new_dawn_commusoft_users_trial_resume_fence.sql').read_text()
    before = sql("select md5(pg_get_functiondef('public.learn_commusoft_recurring_control(uuid,uuid,uuid,jsonb,text)'::regprocedure))")
    sql(fence.replace('\ncommit;', '\nrollback;'))
    if sql("select md5(pg_get_functiondef('public.learn_commusoft_recurring_control(uuid,uuid,uuid,jsonb,text)'::regprocedure))") != before:
        raise RuntimeError('Fence rollback changed recurring control')
    sql(fence)
    call = "select public.learn_commusoft_recurring_control('00000000-0000-0000-0000-000000000001'," \
           "public.fixture_id(312),public.fixture_id(180)," \
           "jsonb_build_object('account_id',public.fixture_id(303)))->>'state'"
    for state in ('paused', 'audit_unmatched'):
        try:
            sql(call)
            raise RuntimeError('Recurring control accepted an active users trial: ' + state)
        except RuntimeError as error:
            if 'commusoft_users_trial_active' not in str(error):
                raise
        if state == 'paused':
            # Even an accidental direct recurrence state edit cannot bypass the
            # unmatched immutable arm audit after the users flag was switched Off.
            sql("update public.learn_commusoft_recurring set enabled=true,last_state='approved' where account_id=public.fixture_id(303)")
    input_call = "select public.learn_operator_input_request('00000000-0000-0000-0000-000000000001'," \
        "public.fixture_id({request}),public.fixture_id({actor})," \
        "jsonb_build_object('account_id',public.fixture_id(303),'resource','{resource}'))->>'state'"
    try:
        sql(input_call.format(request=315, actor=180, resource='jobs'))
        raise RuntimeError('Ordinary import accepted during users trial')
    except RuntimeError as error:
        if 'commusoft_users_trial_active' not in str(error):
            raise
    try:
        sql(input_call.format(request=313, actor=180, resource='users'))
        raise RuntimeError('First users request accepted after fail-closed flag Off')
    except RuntimeError as error:
        if 'commusoft_users_trial_active' not in str(error):
            raise
    sql("update public.feature_flags set value='true'::jsonb where tenant_id='00000000-0000-0000-0000-000000000001' "
        "and flag='learn.inputs.commusoft.users.enabled'")
    sql("update public.learn_commusoft_recurring set enabled=false,last_state='source_user_trial_paused' "
        "where account_id=public.fixture_id(303)")
    try:
        sql(input_call.format(request=314, actor=181, resource='users'))
        raise RuntimeError('Different actor started users trial')
    except RuntimeError as error:
        if 'commusoft_users_trial_active' not in str(error):
            raise
    if sql(input_call.format(request=316, actor=180, resource='users')) != 'recorded':
        raise RuntimeError('First bounded users request was refused')
    for request, actor in ((317, 180), (318, 181)):
        try:
            sql(input_call.format(request=request, actor=actor, resource='users'))
            raise RuntimeError('Extra users request accepted during users trial')
        except RuntimeError as error:
            if 'commusoft_users_trial_active' not in str(error):
                raise
    try:
        sql("select public.learn_operator_resume_commusoft('00000000-0000-0000-0000-000000000001'," \
            "public.fixture_id(319),public.fixture_id(180)," \
            "jsonb_build_object('account_id',public.fixture_id(303)))->>'state'")
        raise RuntimeError('Second-page continuation accepted during users trial')
    except RuntimeError as error:
        if 'commusoft_users_trial_active' not in str(error):
            raise
    print('new-dawn-m2-users-trial-input-and-continuation-fence-synthetic/1')
    sql("insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,correlation_id,source) "
        "values('00000000-0000-0000-0000-000000000001',public.fixture_id(180)::text,"
        "'learn.commusoft.users_trial.restore','source_users_trial',public.fixture_id(313)::text,"
        "'" + arm + "','new-dawn-m2-users-trial')")
    sql("update public.feature_flags set value='false'::jsonb where tenant_id='00000000-0000-0000-0000-000000000001' "
        "and flag='learn.inputs.commusoft.users.enabled'")
    sql("update public.learn_commusoft_recurring set enabled=true,last_state='source_user_trial_restored' "
        "where account_id=public.fixture_id(303)")
    if sql(call) != 'recorded':
        raise RuntimeError('Completed trial still blocked recurring control')
    print('new-dawn-m2-users-trial-recurring-resume-fence-synthetic/1')
finally:
    if created:
        subprocess.run([DOCKER, 'rm', '-f', NAME], check=True, capture_output=True, timeout=30)
