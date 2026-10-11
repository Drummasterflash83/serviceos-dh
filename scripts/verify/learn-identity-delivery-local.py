"""Atomic identity/card delivery against actual DDL in offline disposable PostgreSQL."""
import shutil,subprocess,time,uuid,concurrent.futures,json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
docker=shutil.which('docker') or '/usr/local/bin/docker'
name='serviceos-identity-delivery-'+uuid.uuid4().hex[:8]
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
 sql('begin;'+source('scripts/verify/learn-identity-delivery.assert.sql')+'commit;')
 print('PASS: atomic source-to-card/event delivery, exact replay, source/event revision holds, failure rollback, manual fields, identity review and permission isolation',flush=True)
 subprocess.run(['node','scripts/verify/learn-identity-delivery-client-probe.mjs',name],cwd=root,check=True,timeout=30)
 def iid(n):return 'b671cd32-bbbb-4000-8000-'+str(n).zfill(12)
 sql(f"insert into tenants(id) values('{iid(4)}');")
 def seed(n):
  sql(f"insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,phone_from,summary,processing_status) values('{iid(n)}','{iid(4)}','simwood','phone','phone_calls','{iid(n+1000)}','phone_call','inbound','2026-10-11T10:00:00Z','+441632960040','Synthetic concurrency summary','ready');")
 def rev(n):return sql(f"select learn_identity_revision(i) from interactions i where id='{iid(n)}'")
 def publish(n,r,v):return sql(f"set role service_role;select learn_identity_deliver('{iid(4)}','{iid(r)}','{iid(n)}','{v}','publish');")
 seed(40);v=rev(40)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  outcomes=list(pool.map(lambda _:publish(40,140,v),[1,2]))
 assert outcomes[0]==outcomes[1]
 seed(41);seed(42);v41=rev(41);v42=rev(42)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  futures=[pool.submit(publish,41,141,v41),pool.submit(publish,42,142,v42)]
  for f in futures:assert json.loads(f.result())['state']=='committed'
 assert sql(f"select count(*) from people where tenant_id='{iid(4)}'")=='1'
 assert sql(f"select count(*) from customer_cards where tenant_id='{iid(4)}'")=='1'
 assert sql(f"select count(*) from interactions where tenant_id='{iid(4)}' and processing_status='enriched'")=='3'
 print('PASS: overlapping identical and distinct deliveries retain one provisional identity and card',flush=True)
 seed(43);old=rev(43)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  writer=pool.submit(sql,f"begin;select id from interactions where id='{iid(43)}' for update;update interactions set summary='Changed during delivery' where id='{iid(43)}';select pg_advisory_xact_lock(19683072);select pg_sleep(1);commit;")
  for _ in range(50):
   if sql("select exists(select 1 from pg_locks where locktype='advisory' and objid=19683072 and granted)")=='t':break
   time.sleep(.02)
  else:raise RuntimeError('Concurrent writer was not observed')
  try:publish(43,143,old)
  except RuntimeError as e:assert 'identity_source_changed' in str(e)
  else:raise AssertionError('Stale concurrent source accepted')
  writer.result()
 assert sql(f"select processing_status from interactions where id='{iid(43)}'")=='ready'
 assert sql(f"select count(*) from learn_identity_delivery_receipts where request_id='{iid(143)}'")=='0'
 print('PASS: delivery waits for a concurrent source writer and refuses stale completion',flush=True)

finally:
 if created:subprocess.run([docker,'rm','-f',name],capture_output=True,timeout=30)
