"""Offline selector equivalence and volume regression; synthetic sources only."""
import json,subprocess,time,uuid,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
base=root
ordered='--ordered' in sys.argv
def source(p):return (root/p).read_text()
def function_sql(text,name):
 start=text.index('create '+('or replace function ' if 'create or replace function '+name in text else 'function ')+name)
 end=text.index('$$;',start)+3
 return text[start:end]

name='serviceos-projection-perf-'+uuid.uuid4().hex[:8]
docker='/usr/local/bin/docker'
cmd=[docker,'exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1']
def sql(q,timeout=60):
 r=subprocess.run(cmd,input=q,text=True,capture_output=True,timeout=timeout)
 if r.returncode:raise RuntimeError(r.stderr[-1200:])
 return r.stdout.strip()
created=False
try:
 subprocess.run([docker,'run','-d','--pull=never','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15'],check=True,capture_output=True);created=True
 for _ in range(60):
  if subprocess.run([docker,'exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.2)
 sql('''create table tenants(id uuid primary key,status text);create table email_messages(id uuid primary key,tenant_id uuid,provider text,provider_message_id text,provider_thread_id text,direction text,received_at timestamptz,sent_at timestamptz,created_at timestamptz,subject text,snippet text,from_email text,from_name text,to_emails jsonb,cc_emails jsonb,raw_payload jsonb,body_text text,body_html text,origin_campaign_id uuid);create table phone_calls(id uuid primary key,tenant_id uuid,provider text,provider_call_id text,direction text,from_number text,to_number text,started_at timestamptz,created_at timestamptz,duration_seconds int,outcome text,linked_id text);create table phone_ai_insights(id uuid primary key,tenant_id uuid,call_id uuid,summary text,sentiment text,created_at timestamptz);create index on phone_ai_insights(tenant_id,call_id,created_at desc);create table interactions(id uuid primary key,tenant_id uuid,source_table text,source_id uuid,metadata jsonb,source_version text,unique(tenant_id,source_table,source_id));create table learn_interaction_projection_receipts(request_id uuid primary key,tenant_id uuid,source_kind text,source_id uuid,source_revision text,receipt jsonb,created_at timestamptz);create index on learn_interaction_projection_receipts(tenant_id,source_kind,source_id,source_revision);''')
 projection=source('supabase/migrations/20261101310000_learn_interaction_projection.sql')
 drafts=source('supabase/migrations/20261101380000_learn_email_draft_eligibility.sql')
 for text,f in [(projection,'public.learn_phone_source_fields'),(drafts,'public.learn_email_is_draft'),(drafts,'public.learn_email_source_fields'),(projection,'public.learn_projection_revision'),(source('supabase/migrations/20260714120000_input_reliability_finalisation.sql'),'phone_projection_version')]:sql(function_sql(text,f))
 sql("alter function learn_projection_revision(jsonb,text) called on null input;alter function phone_projection_version(uuid,uuid) set search_path=pg_catalog,public;")
 original=function_sql(drafts,'public.learn_projection_pending');sql(original)
 sql("create role anon;create role authenticated;create role service_role;revoke all on function learn_projection_pending(uuid,text,integer) from public;grant execute on function learn_projection_pending(uuid,text,integer) to service_role;")
 candidate=source('supabase/migrations/20261102110000_learn_projection_ordered_selection.sql' if ordered else 'supabase/migrations/20261102100000_learn_projection_selection_work.sql')
 original_catalog=sql("select json_build_array(proowner,proacl,prosecdef,proconfig) from pg_proc where oid='learn_projection_pending(uuid,text,integer)'::regprocedure")
 sql("""insert into tenants values('00000000-0000-4000-8000-000000000001','active');insert into email_messages select md5(n::text)::uuid,'00000000-0000-4000-8000-000000000001','gmail',n::text,null,'inbound','2026-01-01'::timestamptz+n*interval '1 minute',null,'2026-01-01','Synthetic','Synthetic snippet','customer@example.invalid','Synthetic Customer','[]','[]',jsonb_build_object('body',repeat('synthetic payload ',800)),repeat('synthetic body ',800),repeat('<p>synthetic</p>',800),null from generate_series(1,36500)n;insert into interactions select m.id,m.tenant_id,'email_messages',m.id,jsonb_build_object('source_projection',jsonb_build_object('revision',learn_projection_revision(learn_email_source_fields(m),''))),null from email_messages m;update email_messages set snippet='changed' where provider_message_id='36000';analyze;""")
 # Missing projection markers reflect the currently retained legacy inventory.
 sql("update interactions set metadata='{}';analyze;")
 results=[]
 def select(which='all',limit='20',tenant='00000000-0000-4000-8000-000000000001'):
  return json.loads(sql(f"set statement_timeout='20s';select coalesce(jsonb_agg(x),'[]') from learn_projection_pending('{tenant}',{which if which=='null' else chr(39)+which+chr(39)},{limit})x;"))
 for label,definition in [('original',original),('ordered_selection' if ordered else 'bounded_fingerprint',candidate)]:
  sql(definition)
  start=time.monotonic();rows=select()
  results.append({'variant':label,'seconds':round(time.monotonic()-start,3),'rows':rows})
 if ordered:
  start=candidate.index('return query ')+len('return query ')
  selection=candidate[start:candidate.index('\nend$$;',start)].replace('p_tenant',"'00000000-0000-4000-8000-000000000001'::uuid").replace('p_source',"'all'::text").replace('p_limit','20')
  plan=json.loads(sql('explain(analyze,buffers,format json) '+selection))
  def nodes(node):
   yield node
   for child in node.get('Plans',[]):yield from nodes(child)
  scans=[n for n in nodes(plan[0]['Plan']) if n.get('Index Name')=='learn_email_projection_order_idx']
  assert scans and sum(n['Actual Rows']*n['Actual Loops'] for n in scans)<=40, 'Early eligible batch must use ordered source index'
  results[1]['orderedEmailRowsVisited']=sum(n['Actual Rows']*n['Actual Loops'] for n in scans)
 assert results[0]['rows']==results[1]['rows'] and len(results[1]['rows'])==20
 assert sql("select json_build_array(proowner,proacl,prosecdef,proconfig) from pg_proc where oid='learn_projection_pending(uuid,text,integer)'::regprocedure")==original_catalog
 # Baseline alias exists only inside this disposable synthetic database.
 sql(original.replace('public.learn_projection_pending(','public.learn_projection_pending_baseline(',1))
 sql("""insert into tenants values('00000000-0000-4000-8000-000000000002','active'),('00000000-0000-4000-8000-000000000003','inactive');
 update email_messages set raw_payload=jsonb_build_object('label_ids',jsonb_build_array('DRAFT')) where provider_message_id='1';
 update email_messages set origin_campaign_id='00000000-0000-4000-8000-000000000088' where provider_message_id='2';
 update interactions i set metadata=jsonb_build_object('source_projection',jsonb_build_object('revision',learn_projection_revision(learn_email_source_fields(m),coalesce(m.origin_campaign_id::text,'')))) from email_messages m where m.id=i.source_id and m.provider_message_id in('3','4');
 update email_messages set snippet='source changed again' where provider_message_id='4';
 insert into learn_interaction_projection_receipts select gen_random_uuid(),m.tenant_id,'email',m.id,learn_projection_revision(learn_email_source_fields(m),coalesce(m.origin_campaign_id::text,'')),jsonb_build_object('state','review_required'),now() from email_messages m where provider_message_id in('5','6');
 update email_messages set snippet='held source changed' where provider_message_id='6';
 insert into phone_calls select md5(('phone'||n)::text)::uuid,'00000000-0000-4000-8000-000000000001','sipcentric',n::text,'IN','+441632960001','+441632960002','2025-01-01'::timestamptz+n*interval '1 minute',now(),30,'answered',null from generate_series(1,4)n;
 insert into interactions select c.id,c.tenant_id,'phone_calls',c.id,jsonb_build_object('phone_handoff',true),phone_projection_version(c.tenant_id,c.id) from phone_calls c where provider_call_id='2';
 insert into interactions select c.id,c.tenant_id,'phone_calls',c.id,jsonb_build_object('source_projection',jsonb_build_object('revision',learn_projection_revision(learn_phone_source_fields(c),null))),null from phone_calls c where provider_call_id='3';
 insert into learn_interaction_projection_receipts select gen_random_uuid(),c.tenant_id,'phone',c.id,learn_projection_revision(learn_phone_source_fields(c),null),jsonb_build_object('state','review_required'),now() from phone_calls c where provider_call_id='4';
 analyze;""")
 comparisons=0
 for mode in ['force_generic_plan','force_custom_plan']:
  for source_kind in ['all','email','phone']:
   for limit in ['1','20','null']:
    q=f"set plan_cache_mode='{mode}';select coalesce(jsonb_agg(x),'[]') from FUNCTION('00000000-0000-4000-8000-000000000001','{source_kind}',{limit})x;"
    assert sql(q.replace('FUNCTION','learn_projection_pending'))==sql(q.replace('FUNCTION','learn_projection_pending_baseline'))
    comparisons+=1
 assert select('phone')==select('phone','null') and len(select('phone'))==1
 assert select('all','20','00000000-0000-4000-8000-000000000002')==[]
 assert select('all','20','00000000-0000-4000-8000-000000000003')==[]
 for invalid in ['slack','null']:
  try:select(invalid)
  except RuntimeError as e:assert 'projection_source_invalid' in str(e)
  else:raise AssertionError('Invalid source accepted')
 for role in ['anon','authenticated']:
  try:sql(f"set role {role};select * from learn_projection_pending('00000000-0000-4000-8000-000000000001','all',1);")
  except RuntimeError as e:assert 'permission denied' in str(e)
  else:raise AssertionError('Unprivileged selector access')
 # Older installed schemas lack the optional campaign column. Preserve the existing
 # empty-origin interpretation, without requiring a new source column or grant.
 sql("update email_messages set origin_campaign_id=null;alter table email_messages drop column origin_campaign_id;")
 q="select coalesce(jsonb_agg(x),'[]') from FUNCTION('00000000-0000-4000-8000-000000000001','all',20)x;"
 assert sql(q.replace('FUNCTION','learn_projection_pending'))==sql(q.replace('FUNCTION','learn_projection_pending_baseline'))
 comparisons+=1
 # An updated authoritative phone insight re-enters selection with its new revision.
 sql("insert into phone_ai_insights select gen_random_uuid(),tenant_id,id,'new insight','neutral',now() from phone_calls where provider_call_id='2';")
 assert len(select('phone'))==2
 # Ties across input kinds, timestamp fallbacks and limits must preserve the
 # exact global selection, including eligibility checks before per-input limits.
 if ordered:
  sql("update email_messages set received_at='2025-01-01 00:01Z' where provider_message_id in('2','4','5','6','7');update phone_calls set started_at='2025-01-01 00:01Z';update email_messages set received_at=null,sent_at='2025-01-01 00:01Z' where provider_message_id='8';update email_messages set received_at=null,sent_at=null,created_at='2025-01-01 00:01Z' where provider_message_id='9';")
  for limit in ['-1','0','1','2','20','null']:
   q=f"select coalesce(jsonb_agg(x),'[]') from FUNCTION('00000000-0000-4000-8000-000000000001','all',{limit})x;"
   assert sql(q.replace('FUNCTION','learn_projection_pending'))==sql(q.replace('FUNCTION','learn_projection_pending_baseline'))
   comparisons+=1
 # Exercise the exact guarded production patch and reversal on synthetic data.
 package=root/'supabase/release/learn-production-patches/projection-selection-v1'
 manifest=json.loads((package/'manifest.json').read_text())
 sql((package/'original-selector.sql').read_text())
 pin_sql="select md5(pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure))"
 assert sql(pin_sql)==manifest['beforeDefinitionMd5']
 settings="set serviceos.release_target='tgbnakbxwcqjeimygroz';set serviceos.release_sha256='"+manifest['source']['sha256']+"';"
 apply=(package/'apply.sql').read_text();rollback=(package/'rollback.sql').read_text()
 for attempt in [settings.replace('tgbnakbxwcqjeimygroz','wrong-target')+apply,settings+apply.replace('commit;','select 1/0;commit;')]:
  try:sql(attempt)
  except RuntimeError:pass
  else:raise AssertionError('Release guard/failure should roll back')
  assert sql(pin_sql)==manifest['beforeDefinitionMd5']
 sql(settings+apply)
 assert sql("select md5(prosrc) from pg_proc where oid='public.learn_projection_pending(uuid,text,integer)'::regprocedure")==manifest['afterBodyMd5']
 sql(settings+rollback)
 assert sql(pin_sql)==manifest['beforeDefinitionMd5']
 if ordered:
  package=root/'supabase/release/learn-production-patches/projection-selection-v2'
  manifest=json.loads((package/'manifest.json').read_text())
  sql("drop index learn_email_projection_order_idx;drop index learn_phone_projection_order_idx;")
  sql((package/'original-selector.sql').read_text())
  assert sql(pin_sql)==manifest['beforeDefinitionMd5']
  settings="set serviceos.release_target='tgbnakbxwcqjeimygroz';set serviceos.release_sha256='"+manifest['source']['sha256']+"';"
  apply=(package/'apply.sql').read_text();rollback=(package/'rollback.sql').read_text()
  for attempt in [settings.replace('tgbnakbxwcqjeimygroz','wrong-target')+apply,settings+apply.replace('commit;','select 1/0;commit;')]:
   try:sql(attempt)
   except RuntimeError:pass
   else:raise AssertionError('Ordered release guard/failure should roll back')
   assert sql(pin_sql)==manifest['beforeDefinitionMd5']
   assert sql("select to_regclass('learn_email_projection_order_idx') is null and to_regclass('learn_phone_projection_order_idx') is null")=='t'
  sql(settings+apply)
  assert sql("select md5(prosrc) from pg_proc where oid='public.learn_projection_pending(uuid,text,integer)'::regprocedure")==manifest['afterBodyMd5']
  sql(settings+rollback)
  assert sql(pin_sql)==manifest['beforeDefinitionMd5']
  assert sql("select to_regclass('learn_email_projection_order_idx') is null and to_regclass('learn_phone_projection_order_idx') is null")=='t'
 print(json.dumps({'state':'offline_synthetic_verified','emails':36500,'baselineEquivalenceCases':comparisons,'timings':[{'variant':x['variant'],'seconds':x['seconds'],**({'orderedEmailRowsVisited':x['orderedEmailRowsVisited']} if 'orderedEmailRowsVisited' in x else {})} for x in results],'checks':['draft exclusion','exact campaign revision','unchanged markers','changed source','current review holds','stale review re-entry','authoritative phone handoff','updated phone insight','tenant isolation','inactive tenant','source validation','optional campaign column absent','original owner ACL and settings preserved','anonymous and client denied','exact production patch and rollback','wrong target rejection','late failure rollback']+(['cross-source ties and timestamp fallbacks','exact ordered patch and index rollback'] if ordered else [])}),flush=True)
finally:
 if created:subprocess.run([docker,'rm','-f',name],capture_output=True)
