"""Offline tests of the exact list reader and additive capability migration.
Uses only synthetic rows in a disposable network-isolated database. Access helper
is a fixture: hosted ACL/body preservation is checked separately before deployment.
"""
import json,subprocess,time,uuid
from pathlib import Path
root=Path(__file__).resolve().parents[2]
name='serviceos-slack-capability-'+uuid.uuid4().hex[:8]
created=False

def run(*args,input=None):
 r=subprocess.run(['/usr/local/bin/docker',*args],input=input,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr[-2000:])
 return r.stdout.strip()
def sql(s):return run('exec','-i',name,'psql','-h','127.0.0.1','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1',input=s)
try:
 run('run','-d','--pull=never','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','public.ecr.aws/supabase/postgres:17.6.1.141');created=True
 for _ in range(60):
  try:sql('select 1');break
  except RuntimeError:time.sleep(.25)
 else:raise RuntimeError('Disposable database unavailable')
 sql("""do $$begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;
 create table public.slack_history_campaigns(id uuid primary key,tenant_id uuid,starts_at timestamptz,ends_at timestamptz,enabled boolean);
 create table public.slack_history_campaign_channels(campaign_id uuid);
 create table public.slack_history_campaign_closures(campaign_id uuid,tenant_id uuid,outcome text);
 create function public.learn_slack_control_access(uuid,boolean,text) returns void language plpgsql as $$begin if $1<>'00000000-0000-4000-8000-000000000001'::uuid then raise insufficient_privilege;end if;end$$;
 create function public.learn_slack_recurring_access(uuid,boolean) returns boolean language sql as $$select true$$;
 insert into public.slack_history_campaigns select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000001',now()-interval '1 day',now(),false from generate_series(1,21) i;
 insert into public.slack_history_campaign_channels select id from public.slack_history_campaigns;
 """)
 source=(root/'supabase/migrations/20261101700000_learn_slack_campaign_controller.sql').read_text()
 source=source[source.index('create function public.learn_slack_campaign_list'):source.index('create function public.learn_slack_campaign_dispatch')]
 sql(source)
 query="select public.learn_slack_campaign_list('00000000-0000-4000-8000-000000000001',null)"
 before=json.loads(sql('set role authenticated;'+query))
 definition=sql("select pg_get_functiondef('public.learn_slack_campaign_list(uuid,uuid)'::regprocedure)")
 migration=(root/'supabase/migrations/20261101970000_learn_slack_control_capabilities.sql').read_text()
 sql(migration.replace('commit;','rollback;'))
 assert definition==sql("select pg_get_functiondef('public.learn_slack_campaign_list(uuid,uuid)'::regprocedure)")
 sql(migration)
 after=json.loads(sql('set role authenticated;'+query))
 assert after.pop('capabilities')=={'sourceReplay':False,'pageRecovery':False}
 assert before==after and len(after['campaigns'])==20 and after['next'] is not None
 sql('create function public.learn_slack_campaign_source_replay(uuid,uuid,jsonb,text) returns void language sql as $$select$$;')
 assert json.loads(sql('set role authenticated;'+query))['capabilities']=={'sourceReplay':True,'pageRecovery':False}
 sql('create function public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text) returns void language sql as $$select$$;')
 assert json.loads(sql('set role authenticated;'+query))['capabilities']['pageRecovery'] is False
 sql('create function public.learn_slack_campaign_recovery_read(uuid,uuid,uuid,uuid) returns void language sql as $$select$$;')
 assert json.loads(sql('set role authenticated;'+query))['capabilities']=={'sourceReplay':True,'pageRecovery':True}
 for role in ['anon','service_role']:
  try:sql('set role '+role+';'+query)
  except RuntimeError as e:assert 'permission denied' in str(e)
  else:raise AssertionError('Unauthorized role accepted')
 try:sql('set role authenticated;'+query.replace('000000000001','000000000002'))
 except RuntimeError:pass
 else:raise AssertionError('Access helper bypassed')
 print(json.dumps({'state':'passed','checks':['Exact migration rollback restores reader.','Pagination, rows and write authority are unchanged.','Absent, partial and installed optional controls advertise accurately.','Anonymous/service execute denied; tenant helper still called.'],'limitations':['Synthetic helper does not prove live tenant authority; hosted definition/ACL preservation checked separately.'],'providerRequests':0}))
finally:
 if created:run('rm','-fv',name)
