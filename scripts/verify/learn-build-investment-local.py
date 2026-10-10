"""Verify the recovered private estimate against the observed TEST authority gate in isolated PG17."""
import json, subprocess, time, uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
prior=json.loads((ROOT/'supabase/release/learn-test/036_delivery_progress.expected.json').read_text())
operator=next(f['definition'] for f in prior['catalog']['health']['functions'] if f['signature']=='current_user_is_openfolk_operator(text)')
name='serviceos-investment-'+uuid.uuid4().hex[:8]
docker='/usr/local/bin/docker'; db='postgres'; created=False
chris='20000000-0000-4000-8000-000000000001'; other='20000000-0000-4000-8000-000000000002'; client='20000000-0000-4000-8000-000000000003'
checks=[]
def run(sql,check=True):
 r=subprocess.run([docker,'exec','-i',name,'psql','-h','127.0.0.1','-U','supabase_admin','-d',db,'-XAtq','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,timeout=30)
 if check and r.returncode:raise RuntimeError(r.stderr[-2000:])
 return r
def read(actor,check=True):return run(f"set role authenticated;set request.jwt.claim.sub='{actor}';select public.openfolk_build_investment();",check)
def denied(actor):
 r=read(actor,False)
 assert r.returncode!=0 and 'OpenFolk administrator required' in r.stderr and 'estimatedHours' not in r.stdout

def passed(label):checks.append(label);print(label,flush=True)
try:
 subprocess.run([docker,'run','-d','--pull=never','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','public.ecr.aws/supabase/postgres:17.6.1.141'],capture_output=True,check=True,timeout=30);created=True
 for _ in range(100):
  if run('select 1',False).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('Postgres did not start')
 run('create database investment_test template template0');db='investment_test'
 run("""create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon,service_role;
 create table auth.users(id uuid primary key,email text);
 create table public.profiles(id uuid primary key);
 create table public.platform_authority_grants(profile_id uuid,permission text,effective_from timestamptz,effective_to timestamptz);
 create table public.view_as_context(actor_user_id uuid,ended_at timestamptz,expires_at timestamptz);
 """+operator+';')
 source=subprocess.run(['node','--input-type=module','-e',"import {investmentSource} from './scripts/verify/learn-build-investment-source.mjs';process.stdout.write(investmentSource().sql)"],cwd=ROOT,text=True,capture_output=True,check=True,timeout=15).stdout
 run(source)
 run(f"insert into auth.users values('{chris}','CHRIS@OPENFOLK.AI'),('{other}','other@example.invalid'),('{client}','client@example.invalid');insert into profiles values('{chris}'),('{other}'),('{client}');")
 denied(chris);denied(other);denied(client);denied('')
 assert run('set role anon;select public.openfolk_build_investment()',False).returncode!=0
 assert run('set role service_role;select public.openfolk_build_investment()',False).returncode!=0
 passed('Anonymous, service-without-user and ordinary authenticated accounts cannot retrieve the private estimate.')
 run(f"insert into platform_authority_grants values('{chris}','platform.controlplane.view',null,null),('{other}','platform.controlplane.admin',null,null)")
 denied(chris);denied(other)
 passed('A view-only Chris grant and another email with platform admin are both denied.')
 run(f"insert into platform_authority_grants values('{chris}','platform.controlplane.admin',now()-interval '1 hour',now()+interval '1 hour')")
 result=json.loads(read(chris).stdout)
 assert result['estimatedHours']==320 and result['rangeLow']==240 and result['rangeHigh']==400 and result['asOf']=='2026-09-29' and result['confidence']=='Low'
 assert 'judgement, not measured time' in result['basis'] and len(result)==12
 passed('The existing Chris/admin gate returns the original dated estimate and its uncertainty without recomputing it.')
 run(f"insert into view_as_context values('{chris}',null,null)");denied(chris)
 run(f"update view_as_context set expires_at=now()-interval '1 second'");assert json.loads(read(chris).stdout)==result
 run(f"update view_as_context set expires_at=null,ended_at=now()");assert json.loads(read(chris).stdout)==result
 passed('Active client preview denies the private estimate; ended or expired preview does not block the authorized operator.')
 run(f"update platform_authority_grants set effective_to=now()-interval '1 second' where profile_id='{chris}'");denied(chris)
 run(f"update platform_authority_grants set effective_from=now()+interval '1 hour',effective_to=null where profile_id='{chris}'");denied(chris)
 passed('Expired and not-yet-effective grants cannot retain private estimate access.')
 run(f"update platform_authority_grants set effective_from=null where profile_id='{chris}';delete from profiles where id='{chris}'");denied(chris)
 passed('An email and grant without the existing profile do not establish operator authority.')
 report={'version':'learn-build-investment-local/1','state':'passed','checks':checks,'limits':['Synthetic isolated PostgreSQL with the observed TEST operator predicate; hosted sign-in and browser acceptance remain separate.']}
 (ROOT/'.verification-results/build-investment-local.json').write_text(json.dumps(report,indent=2)+'\n')
finally:
 if created:subprocess.run([docker,'rm','-f',name],capture_output=True,timeout=30)
