"""Canonical-card search in a disposable schema-only clone; no real source rows copied.
Existing local Supabase schema is read only. The temporary container has no network,
mounts or host ports. Uses actual table columns/RLS, synthetic companies and identities.
"""
import json,shutil,subprocess,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DOCKER=shutil.which('docker') or '/usr/local/bin/docker'
SOURCE='supabase_db_serviceos-dh'
IMAGE='public.ecr.aws/supabase/postgres:17.6.1.141'
TARGET='serviceos-card-search-'+uuid.uuid4().hex[:8]
def docker(*args,**kwargs):return subprocess.run([DOCKER,*args],capture_output=True,check=True,**kwargs)
def run(sql,check=True,db='card_search_verify'):
 r=subprocess.run([DOCKER,'exec','-i',TARGET,'psql','-h','127.0.0.1','-U','supabase_admin','-d',db,'-qAt','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True)
 if check and r.returncode:raise RuntimeError(r.stderr[-2000:])
 return r
q=lambda s:"'"+str(s).replace("'","''")+"'"
T='ca510000-0000-4000-8000-000000000001';OTHER='ca510000-0000-4000-8000-000000000002';ACTOR='ca510000-0000-4000-8000-000000000003';FOREIGN='ca510000-0000-4000-8000-000000000004';G='ca510000-0000-4000-8000-000000000005'
TABLES=['customer_cards','jobs','team_members','org_units']
metadata="select jsonb_agg(jsonb_build_object('table',c.relname,'acl',c.relacl::text,'rls',c.relrowsecurity,'policies',(select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where p.schemaname='public' and p.tablename=c.relname)) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('customer_cards','jobs','team_members','org_units');"
fingerprints=' union all '.join("select '"+t+"' as name,count(*)::int,md5(coalesce(string_agg(to_jsonb(s)::text,'' order by id),'')) from "+t+' s' for t in TABLES)
def call(kind,query,page=0,group=None,tenant=T,actor=ACTOR,role='authenticated'):
 return f"set role {role};set request.jwt.claim.sub={q(actor)};select learn_card_search({q(tenant)},{q(kind)},{q(query)},{page},{q(group) if group else 'null'});"
def read(*a,**kw):return json.loads(run(call(*a,**kw)).stdout)
def denied(sql):
 r=run(sql,False);assert r.returncode and ('permission denied' in r.stderr or 'Sign-in required' in r.stderr or 'Invalid card search' in r.stderr),r.stderr[-500:]
try:
 docker('run','-d','--pull=never','--network','none','--name',TARGET,'-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE)
 for _ in range(100):
  if run('select 1',False,db='postgres').returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('Disposable database did not start')
 roles=set(docker('exec',SOURCE,'psql','-U','supabase_admin','-d','postgres','-Atc',"select rolname from pg_roles where rolname not like 'pg_%'").stdout.decode().splitlines())
 existing=set(run('select rolname from pg_roles',db='postgres').stdout.splitlines())
 for role in sorted(roles-existing):run('create role "'+role.replace('"','""')+'" NOLOGIN',db='postgres')
 docker('exec',TARGET,'createdb','-U','supabase_admin','-T','template0','card_search_verify')
 schema=docker('exec',SOURCE,'pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner').stdout.decode()
 run(schema);print('Schema-only clone with existing card-table RLS: PASS',flush=True)
 run(f"insert into tenants(id,slug,display_name,industry) values('{T}','search-a','Search A','hvac'),('{OTHER}','search-b','Search B','hvac');insert into auth.users(id,email,is_sso_user,is_anonymous) values('{ACTOR}','search-a@example.invalid',false,false),('{FOREIGN}','search-b@example.invalid',false,false);update profiles set tenant_id=case when id='{ACTOR}' then '{T}'::uuid else '{OTHER}'::uuid end,role='owner' where id in ('{ACTOR}','{FOREIGN}');")
 run(f"insert into org_units(id,tenant_id,kind,name) values('{G}','{T}','team','Search Office'),(gen_random_uuid(),'{OTHER}','team','Search Office');insert into team_members(tenant_id,org_unit_id,display_name,formal_role,effective_to) values('{T}','{G}','Ada Search','Service engineer',null),('{T}',null,'Other Search','Office coordinator',null),('{T}','{G}','Former Search','Service engineer',now()),('{OTHER}',null,'Foreign Search','Service engineer',null);")
 run(f"insert into customer_cards(id,tenant_id,title,updated_at) select ('ca510001-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'{T}','Search customer '||lpad(n::text,3,'0'),'2026-10-01' from generate_series(1,61)n;insert into customer_cards(tenant_id,title) values('{OTHER}','Search foreign');insert into jobs(tenant_id,title,source_system,job_number) select '{T}','Synthetic installation '||n,'native','DH-'||n from generate_series(1,10000)n;")
 literals=['100%_*','(A,B) "quoted"',"O'Connor",'École',"x'); select 1; --"]
 for term in literals:run(f"insert into customer_cards(tenant_id,title) values('{T}',{q('Literal '+term+' customer')});")
 before=run(metadata).stdout;original=run(fingerprints).stdout
 migration=(ROOT/'supabase/migrations/20261101150000_learn_card_search.sql').read_text()
 run(migration.replace('\ncommit;\n','\nrollback;\n'));assert run("select to_regprocedure('public.learn_card_search(uuid,text,text,integer,uuid)') is null;").stdout.strip()=='t'
 run(migration);assert run(metadata).stdout==before
 run('begin;'+(ROOT/'scripts/verify/learn-card-search-hosted.assert.sql').read_text()+'rollback;')
 print('Exact hosted card-search role probe: PASS',flush=True)
 assert run("select not prosecdef and provolatile='s' from pg_proc where oid='public.learn_card_search(uuid,text,text,integer,uuid)'::regprocedure;").stdout.strip()=='t'
 print('Rollback, stable invoker contract and unchanged table grants/RLS: PASS',flush=True)
 pages=[read('customer','sEaRcH customer',i) for i in range(3)]
 assert [len(r['rows']) for r in pages]==[24,24,13] and [r['hasMore'] for r in pages]==[True,True,False]
 ids=[r['id'] for p in pages for r in p['rows']];assert len(set(ids))==61 and ids==sorted(ids)
 for term in literals:
  r=read('customer',term);assert len(r['rows'])==1 and term in r['rows'][0]['title']
 assert read('customer','missing')['rows']==[]
 job=read('job','DH-10000');assert len(job['rows'])==1 and job['rows'][0]['job_number']=='DH-10000'
 # Verify every matching job is reachable through bounded search pages.
 run(f"""set role authenticated;set request.jwt.claim.sub='{ACTOR}';
 do $$declare r jsonb;page integer:=0;ids uuid[]:=array[]::uuid[];n integer;begin
  loop
   r:=learn_card_search('{T}','job','installation',page);
   assert jsonb_array_length(r->'rows')<=24;
   ids:=ids||array(select (x->>'id')::uuid from jsonb_array_elements(r->'rows') x);
   exit when not (r->>'hasMore')::boolean;
   page:=page+1;assert page<=417;
  end loop;
  select count(distinct x) into n from unnest(ids)x;
  assert n=10000 and array_length(ids,1)=10000;
 end $$;""")
 assert len(read('member','engineer',group=G)['rows'])==1
 assert len(read('member','Search')['rows'])==2
 assert len(read('team','office',group=G)['rows'])==1
 print('Literal punctuation/Unicode, 61 tied rows, all 10,000 jobs and active-member/team filtering: PASS',flush=True)
 for kind in ['customer','job','member','team']:
  assert read(kind,'Search',tenant=OTHER)['rows']==[]
  assert read(kind,'Search',actor=FOREIGN)['rows']==[]
  denied(call(kind,'Search',role='anon'));denied(call(kind,'Search',role='service_role'));denied(call(kind,'Search',actor=''))
 run(f"update profiles set role='viewer' where id='{ACTOR}';")
 assert len(read('customer','Search customer')['rows'])==24
 run('revoke select on customer_cards from authenticated;');denied(call('customer','Search'));run('grant select on customer_cards to authenticated;')
 for args in [('customer',''),('customer','a'*121),('customer','a\nb'),('customer','Search',-1),('customer','Search',10001),('bad','Search')]:denied(call(*args))
 denied(call('customer','Search',group=G))
 assert run(fingerprints).stdout==original
 assert run(metadata).stdout==before
 print('Foreign company, anonymous/service/missing identity, viewer/RLS, revoked table access and invalid-query denials: PASS',flush=True)
 print('All synthetic card source rows preserved: PASS',flush=True)
 responses=[{'kind':'customer','query':'sEaRcH customer','page':i,'group':None,'response':p} for i,p in enumerate(pages)]
 responses += [{'kind':'job','query':'DH-10000','page':0,'group':None,'response':job}]
 parsed=subprocess.run(['node',str(ROOT/'scripts/verify/learn-card-search-readback.mjs')],input=json.dumps({'tenant':T,'responses':responses}),text=True,capture_output=True)
 if parsed.returncode:raise RuntimeError(parsed.stderr[-1000:])
 print(parsed.stdout.strip(),flush=True)
finally:docker('rm','-f',TARGET)
