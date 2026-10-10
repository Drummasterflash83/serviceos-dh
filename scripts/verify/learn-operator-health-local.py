"""Run recovered operator-health schemas and RLS in disposable, networkless PG17.
Uses the observed TEST operator predicate and synthetic data only. No hosted writes.
"""
import json, subprocess, time, uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
prior=json.loads((ROOT/'.verification-results/operator-health-prior.json').read_text())
assert prior['catalog']['tables']==[] and len(prior['catalog']['functions'])==1
operator=prior['catalog']['functions'][0]['definition']
assert prior['catalog']['functions'][0]['signature']=='current_user_is_openfolk_operator(text)'
name='serviceos-operator-health-'+uuid.uuid4().hex[:8]
docker='/usr/local/bin/docker';db='postgres';created=False
sources=['20261016120000_client_portal.sql','20261017120000_receptionist_workspace.sql','20261101002000_client_portal_view_as_writes.sql']
a='10000000-0000-4000-8000-000000000001';b='10000000-0000-4000-8000-000000000002';c='10000000-0000-4000-8000-000000000003'
admin='20000000-0000-4000-8000-000000000001';client='20000000-0000-4000-8000-000000000002';foreign='20000000-0000-4000-8000-000000000003'
checks=[]
def run(sql,check=True):
 r=subprocess.run([docker,'exec','-i',name,'psql','-h','127.0.0.1','-U','supabase_admin','-d',db,'-XAtq','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,timeout=45)
 if check and r.returncode:raise RuntimeError(r.stderr[-3000:])
 return r
def user(actor,sql,check=True):return run(f"set role authenticated;set request.jwt.claim.sub='{actor}';"+sql,check)
def count(actor,table):return int(user(actor,'select count(*) from public.'+table).stdout.strip())
def passed(label):checks.append(label);print(label,flush=True)
try:
 subprocess.run([docker,'run','-d','--pull=never','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','public.ecr.aws/supabase/postgres:17.6.1.141'],capture_output=True,check=True,timeout=30);created=True
 for _ in range(100):
  if run('select 1',False).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('Postgres did not start')
 run('create database operator_health_test template template0');db='operator_health_test'
 run("""create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon,service_role;
 create table public.tenants(id uuid primary key);create table public.profiles(id uuid primary key,role text);
 create table public.platform_authority_grants(profile_id uuid,permission text,effective_from timestamptz,effective_to timestamptz);
 create table public.view_as_context(actor_user_id uuid,ended_at timestamptz,expires_at timestamptz);
 """+operator+';')
 for source in sources:run((ROOT/'supabase/migrations'/source).read_text())
 run(f"insert into tenants values('{a}'),('{b}'),('{c}');insert into profiles values('{admin}','owner'),('{client}','owner'),('{foreign}','owner');insert into platform_authority_grants values('{admin}','platform.controlplane.admin',now()-interval '1 hour',now()+interval '1 hour');insert into client_portal_access(tenant_id,profile_id) values('{a}','{client}'),('{b}','{foreign}');insert into client_programmes(tenant_id,content) values('{a}','{{}}'),('{b}','{{}}');insert into receptionist_workspaces(tenant_id,company,name,assistant_id,vapi_secret_name) values('{a}','Synthetic A','Example A','{a}','RECEPTIONIST_VAPI_SYNTHETIC'),('{b}','Synthetic B','Example B','{b}','RECEPTIONIST_VAPI_SYNTHETIC');")
 assert count(admin,'client_programmes')==2 and count(client,'client_programmes')==1
 assert count(client,'receptionist_workspaces')==1 and count(foreign,'receptionist_workspaces')==1
 passed('Operator sees both companies; each portal member sees only their assigned company.')
 user(admin,f"update client_programmes set content='{{\"status\":\"reviewed\"}}' where tenant_id='{a}'")
 assert run(f"select version from client_programmes where tenant_id='{a}'").stdout.strip()=='2'
 assert run('select count(*) from client_programme_revisions').stdout.strip()=='3'
 assert run('select count(*) from client_notification_outbox').stdout.strip()=='3'
 passed('Programme updates atomically stamp versions, retain revisions and queue notifications.')
 assert user(client,f"update client_programmes set content='{{}}' where tenant_id='{a}' returning tenant_id").stdout.strip()==''
 user(client,f"insert into client_programme_notes(tenant_id,body) values('{a}','Synthetic note')")
 assert user(client,f"insert into client_programme_notes(tenant_id,body) values('{b}','Foreign note')",False).returncode!=0
 user(client,f"insert into receptionist_feedback(tenant_id,title,body) values('{a}','Synthetic feedback','Synthetic detail')")
 assert count(foreign,'receptionist_feedback')==0 and count(client,'receptionist_feedback')==1
 assert user(client,f"update receptionist_feedback set status='Resolved' where tenant_id='{a}' returning id").stdout.strip()==''
 passed('Clients can submit their own notes and feedback, but cannot edit programmes or resolve feedback.')
 run(f"insert into view_as_context values('{admin}',null,null)")
 assert count(admin,'client_programmes')==2
 assert user(admin,f"update client_programmes set content='{{}}' where tenant_id='{a}' returning tenant_id").stdout.strip()==''
 assert user(admin,f"update receptionist_feedback set status='Resolved' where tenant_id='{a}' returning id").stdout.strip()==''
 for sql in [f"insert into client_programmes(tenant_id,content) values('{c}','{{}}')",f"insert into client_programme_notes(tenant_id,body) values('{a}','Blocked preview note')",f"insert into receptionist_feedback(tenant_id,title,body) values('{a}','Blocked','Blocked preview feedback')"]:
  assert user(admin,sql,False).returncode!=0
 passed('Active View-As retains reads but blocks all five direct programme/note/feedback write paths.')
 run(f"update view_as_context set expires_at=now()-interval '1 second' where actor_user_id='{admin}'")
 assert user(admin,f"update client_programmes set content='{{}}' where tenant_id='{a}' returning version").stdout.strip()=='3'
 run(f"update platform_authority_grants set effective_to=now()-interval '1 second' where profile_id='{admin}'")
 assert count(admin,'client_programmes')==0
 passed('Expired preview permits normal authorized editing; expired operator grant removes cross-company access.')
 assert run('set role anon;select * from client_programmes',False).returncode!=0
 assert user(client,'select * from claim_client_notifications()',False).returncode!=0
 assert int(run('set role service_role;select count(*) from claim_client_notifications()').stdout.strip())>=5
 passed('Anonymous reads and client notification claims are denied; only the service can claim the queue.')
 report={'version':'learn-operator-health-local/1','state':'passed','sources':sources,'checks':checks,'limitations':['Synthetic disposable database with minimal FK prerequisites and the actual observed operator predicate. Hosted compatibility and full receptionist workflows remain separate checks.']}
 (ROOT/'.verification-results/operator-health-local.json').write_text(json.dumps(report,indent=2)+'\n')
finally:
 if created:subprocess.run([docker,'rm','-f',name],capture_output=True,timeout=30)
