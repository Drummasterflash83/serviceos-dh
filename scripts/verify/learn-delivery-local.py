"""Exercise delivery publication and audit in disposable, networkless PG17.
Uses the observed TEST operator predicate and synthetic data only. No hosted writes.
"""
import json, subprocess, time, uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
prior=json.loads((ROOT/'supabase/release/learn-test/036_delivery_progress.prerequisites.json').read_text())
operator=next(f['definition'] for f in prior['catalog']['health']['functions'] if f['signature']=='current_user_is_openfolk_operator(text)')
name='serviceos-delivery-'+uuid.uuid4().hex[:8]
docker='/usr/local/bin/docker';db='postgres';created=False
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
def publish(actor,version=0,content=None,tenant=a,check=True):
 value=content if content is not None else {'summary':'Synthetic delivery','areas':[{'title':'LEARN','status':'In TEST','detail':'Synthetic only'}],'readinessNote':'Provider capture unverified','next':'Check provider'}
 encoded=json.dumps(value).replace("'","''")
 return user(actor,f"select operator_update_delivery('{tenant}',{version},'{encoded}'::jsonb,'Synthetic review')",check)
try:
 subprocess.run([docker,'run','-d','--pull=never','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','public.ecr.aws/supabase/postgres:17.6.1.141'],capture_output=True,check=True,timeout=30);created=True
 for _ in range(100):
  if run('select 1',False).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('Postgres did not start')
 run('create database delivery_test template template0');db='delivery_test'
 run("""create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon,service_role;
 create table public.tenants(id uuid primary key);create table public.profiles(id uuid primary key,role text);
 create table public.platform_authority_grants(profile_id uuid,permission text,effective_from timestamptz,effective_to timestamptz);
 create table public.view_as_context(actor_user_id uuid,ended_at timestamptz,expires_at timestamptz);
 """+operator+';')
 run((ROOT/'supabase/migrations/20261016120000_client_portal.sql').read_text())
 selected=subprocess.run(['node','--input-type=module','-e',"import {deliverySource} from './scripts/verify/learn-delivery-source.mjs';process.stdout.write(deliverySource().sql)"],cwd=ROOT,text=True,capture_output=True,check=True,timeout=15).stdout
 run(selected)
 run(f"insert into tenants values('{a}'),('{b}'),('{c}');insert into profiles values('{admin}','owner'),('{client}','owner'),('{foreign}','owner');insert into platform_authority_grants values('{admin}','platform.controlplane.admin',now()-interval '1 hour',now()+interval '1 hour');insert into client_portal_access(tenant_id,profile_id) values('{a}','{client}'),('{b}','{foreign}');insert into client_programmes(tenant_id,content) values('{a}','{{}}'),('{b}','{{}}');")
 assert publish(admin).stdout.strip()=='1'
 assert count(client,'client_delivery_updates')==1 and count(foreign,'client_delivery_updates')==0
 assert count(admin,'controlplane_change_log')==1 and count(client,'controlplane_change_log')==0
 assert run('set role anon;select * from client_delivery_updates',False).returncode!=0
 assert publish(client,1,check=False).returncode!=0
 assert user(admin,f"update client_delivery_updates set content='{{}}' where tenant_id='{a}'",False).returncode!=0
 passed('Only the operator publishes; portal members read their own progress and cannot access raw audit history.')
 assert publish(admin,1).stdout.strip()=='2'
 assert publish(admin,1,check=False).returncode!=0
 audit=run("select before->>'version',after->>'version',actor,reason from controlplane_change_log order by created_at desc limit 1").stdout.strip()
 assert audit==f'1|2|{admin}|Synthetic review'
 passed('Versioned edits retain actor, reason and before/after evidence; stale revisions refuse overwrite.')
 for bad in [{},[],{'summary':'x','next':'y','readinessNote':'','areas':[None]},{'summary':'x','next':'y','readinessNote':'','areas':[],'unexpected':True}]:assert publish(admin,2,bad,check=False).returncode!=0
 assert publish(admin,tenant=c,check=False).returncode!=0
 assert count(admin,'controlplane_change_log')==2
 passed('Invalid content and missing programmes cannot publish or append misleading audit receipts.')
 run(f"insert into view_as_context values('{admin}',null,null)")
 assert publish(admin,2,check=False).returncode!=0
 run(f"update view_as_context set expires_at=now()-interval '1 second' where actor_user_id='{admin}'")
 assert publish(admin,2).stdout.strip()=='3'
 passed('Active client preview blocks publication; expired preview restores normal operator editing.')
 run("create function synthetic_audit_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic audit unavailable';end$$;create trigger synthetic_audit_failure before insert on controlplane_change_log for each row execute function synthetic_audit_failure();")
 assert publish(admin,3,check=False).returncode!=0
 assert run(f"select version from client_delivery_updates where tenant_id='{a}'").stdout.strip()=='3'
 assert count(admin,'controlplane_change_log')==3
 run('drop trigger synthetic_audit_failure on controlplane_change_log')
 passed('Injected audit failure rolls back publication and its version change together.')
 from concurrent.futures import ThreadPoolExecutor
 with ThreadPoolExecutor(max_workers=2) as pool:
  outcomes=list(pool.map(lambda _:publish(admin,tenant=b,check=False),range(2)))
 assert sorted(r.returncode==0 for r in outcomes)==[False,True]
 assert run(f"select version from client_delivery_updates where tenant_id='{b}'").stdout.strip()=='1'
 assert count(admin,'controlplane_change_log')==4
 passed('Concurrent first publications serialize: one version and one audit receipt, with the other refused.')
 for sql in ['update controlplane_change_log set reason=reason','delete from controlplane_change_log','truncate controlplane_change_log']:
  assert run(sql,False).returncode!=0
  assert run('set role service_role;'+sql,False).returncode!=0
 passed('Audit update, delete and truncate fail, including table-owner and service paths.')
 run(f"update platform_authority_grants set effective_to=now()-interval '1 second' where profile_id='{admin}'")
 assert publish(admin,3,check=False).returncode!=0 and count(admin,'client_delivery_updates')==0
 passed('Expired platform grant removes cross-client reads and publishing authority.')
 report={'version':'learn-delivery-local/1','state':'passed','checks':checks,'limitations':['Disposable PostgreSQL with synthetic Auth/tenant/grant prerequisites and actual observed operator predicate. No hosted identity created; hosted and browser acceptance remain separate.']}
 (ROOT/'.verification-results/delivery-local.json').write_text(json.dumps(report,indent=2)+'\n')
finally:
 if created:subprocess.run([docker,'rm','-f',name],capture_output=True,timeout=30)
