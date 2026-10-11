"""Atomic identity/card delivery against actual DDL in offline disposable PostgreSQL."""
import shutil,subprocess,time,uuid,concurrent.futures,json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
docker=shutil.which('docker') or '/usr/local/bin/docker'
name='serviceos-identity-review-'+uuid.uuid4().hex[:8]
created=False
cmd=[docker,'exec','-i',name,'psql','-h','127.0.0.1','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1']
def sql(s):
 r=subprocess.run(cmd,input=s,text=True,capture_output=True,timeout=30)
 if r.returncode:raise RuntimeError(r.stderr[-4500:])
 return r.stdout.strip()
def source(p):return(root/p).read_text()
try:
 subprocess.run([docker,'run','-d','--pull=never','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15'],capture_output=True,check=True,timeout=30);created=True
 for _ in range(60):
  if subprocess.run([docker,'exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('Offline PostgreSQL unavailable')
 sql(source('scripts/verify/learn-phone-publication.fixture.sql'))
 sql('alter table tenants add column slug text,add column display_name text,add column metadata jsonb;')
 sql('create function current_tenant_id() returns uuid language sql as $$select null::uuid$$;')
 for f in ['20260708140000_interactions.sql','20260709120000_customer_cards_foundation.sql','20260709140000_identity_engine.sql','20260709150000_platform_events.sql']:
  sql(source('supabase/migrations/'+f))
 unique=source('supabase/migrations/20261031070000_learn_import_customer_cards.sql')
 sql(unique[:unique.index('create function learn_import_customer_card')]+'commit;')
 candidate=source('supabase/migrations/20261101300000_learn_identity_delivery.sql')
 sql(candidate.replace('\ncommit;','\nrollback;'))
 assert sql("select to_regclass('learn_identity_delivery_receipts') is null")=='t'
 sql(candidate)
 sql("""create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
 grant usage on schema auth to authenticated,anon,service_role;
 create table auth.users(id uuid primary key,email text,banned_until timestamptz);
 create table profiles(id uuid primary key,tenant_id uuid,role text);create table platform_authority_grants(profile_id uuid,permission text,effective_from timestamptz,effective_to timestamptz,granted_by text,reason text);
 create table view_as_context(tenant_id uuid,actor_user_id uuid,subject_kind text,reason text,ended_at timestamptz,expires_at timestamptz);""")
 resolver=source('supabase/migrations/20260822120000_platform_authority_decoupled_from_role.sql')
 sql(resolver[resolver.index('create or replace function current_user_is_openfolk_operator('):resolver.index('-- ── Governed record')])
 guard=source('supabase/migrations/20261031160000_learn_operator_inputs.sql')
 sql(guard[guard.index('create function public.learn_operator_input_access('):guard.index('-- Explicit booleans only.')])
 candidate=source('supabase/migrations/20261101330000_learn_identity_operator_review.sql')
 before=sql("select pg_get_functiondef('learn_identity_deliver(uuid,uuid,uuid,text,text)'::regprocedure)")
 sql(candidate.replace('\ncommit;','\nrollback;'))
 assert sql("select to_regclass('learn_identity_operator_reviews') is null")=='t'
 assert before==sql("select pg_get_functiondef('learn_identity_deliver(uuid,uuid,uuid,text,text)'::regprocedure)")
 sql(candidate)
 sql('begin;'+source('scripts/verify/learn-identity-delivery.assert.sql')+'rollback;')
 print('PASS: existing automatic identity/card delivery regression assertions',flush=True)
 sql('begin;'+source('scripts/verify/learn-identity-review.assert.sql')+'commit;')
 print('PASS: governed attribution, exact replay, stale evidence, permissions, pagination, immutable audit and all-or-nothing card/event recovery',flush=True)
 def ir(n):return 'c9821047-eeee-4000-8000-'+str(n).zfill(12)
 def seed(n):
  sql(f"""insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,phone_from,processing_status)
   values('{ir(n)}','{ir(1)}','simwood','phone','phone_calls','{ir(n+1000)}','phone_call','inbound','2026-10-11T10:00:00Z','+441632960000','ready');
   select learn_identity_deliver('{ir(1)}','{ir(n+2000)}','{ir(n)}',learn_identity_revision(i),'publish') from interactions i where id='{ir(n)}';""")
 def definition(n,person):
  revision=sql(f"select learn_identity_review_state('{ir(1)}','{ir(n)}','{ir(person)}')->>'revision'")
  return json.dumps({'action':'attribute_contact','person_id':ir(person),'revision':revision,'reason':'Offline simultaneous operator review'})
 def apply(n,request,definition):
  return sql(f"set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='{ir(10)}';set role authenticated;select learn_operator_identity_review('{ir(1)}','{ir(10)}','{ir(request)}','{ir(n)}','{definition}'::jsonb);")
 seed(300);d=definition(300,30)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  out=list(pool.map(lambda _:apply(300,3300,d),[1,2]))
 assert out[0]==out[1] and json.loads(out[0])['state']=='recorded'
 assert sql(f"select count(*) from learn_identity_operator_reviews where interaction_id='{ir(300)}'")=='1'
 seed(301);d1=definition(301,30);d2=definition(301,31)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  futures=[pool.submit(apply,301,3301,d1),pool.submit(apply,301,3302,d2)]
  successes=0;conflicts=0
  for f in futures:
   try:assert json.loads(f.result())['state']=='recorded';successes+=1
   except RuntimeError as e:assert 'identity_review_changed' in str(e);conflicts+=1
 assert successes==1 and conflicts==1
 assert sql(f"select count(*) from learn_identity_operator_reviews where interaction_id='{ir(301)}'")=='1'
 print('PASS: overlapping identical decisions share one receipt; competing contacts cannot both publish',flush=True)

finally:
 if created:subprocess.run([docker,'rm','-f',name],capture_output=True,timeout=30)
