"""Actual private-intake DDL and permissions in disposable, offline PostgreSQL."""
import json, subprocess, shutil, uuid, time, concurrent.futures, sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
docker=shutil.which('docker') or '/usr/local/bin/docker'
name='serviceos-voicemail-intake-'+uuid.uuid4().hex[:8]
created=False
command=[docker,'exec','-i',name,'psql','-h','127.0.0.1','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1']
def sql(s):
 r=subprocess.run(command,input=s,text=True,capture_output=True,timeout=30)
 if r.returncode:raise RuntimeError(r.stderr[-5000:])
 return r.stdout.strip()
def file(p):return (root/p).read_text()
def ident(n):return 'ce420000-aaaa-4000-8000-'+str(n).zfill(12)
def lit(s):return "'"+str(s).replace("'","''")+"'"
def call(source,candidate,route=4):
 return "select public.voicemail_intake_prepare('%s','%s',%s::jsonb,%s::jsonb);"%(ident(1),ident(route),lit(json.dumps(source)),lit(json.dumps(candidate)))
source={'email_id':'abcdef01','received_at':'2026-10-10T12:00:00Z','raw_sha256':'a'*64,'raw_bytes':100,'audio_sha256':'b'*64,'audio_bytes':4,'content_sha256':'c'*64,'signing_domain':'synthetic.birchills.invalid'}
candidate={'version':'birchills-voicemail-email/1','system_reference':ident(20),'extension':'601','caller_number':'01234567890','caller_name':None,'duration_seconds':28,'transcript':'Synthetic source text'}
def denied(statement,marker):
 try:sql(statement)
 except RuntimeError as e:
  assert marker in str(e),str(e)
 else:raise AssertionError('Expected denial: '+marker)
try:
 subprocess.run([docker,'run','-d','--pull=never','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15'],capture_output=True,check=True,timeout=30);created=True
 for _ in range(60):
  if subprocess.run([docker,'exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('Offline database not ready')
 sql(file('scripts/voicemail-test-bootstrap.sql'))
 sql("alter table storage.objects add column metadata jsonb;create table email_accounts(id uuid primary key,tenant_id uuid,email_address text,provider text,status text);create table feature_flags(tenant_id uuid,flag text,value jsonb);alter table tenants add column status text default 'active';")
 # Use the actual installed capture-check function, not a mock boolean.
 controls=file('supabase/migrations/20261031230000_learn_capture_controls.sql')
 sql(controls[controls.index('create function public.learn_capture_allowed'):controls.index('-- Operator data')])
 sql('grant execute on function learn_capture_allowed(uuid,text) to service_role;')
 sql(file('supabase/migrations/20261023210000_receptionist_voicemails.sql'))
 migration=file('supabase/migrations/20261101420000_learn_voicemail_private_intake.sql')
 sql(migration.replace('\ncommit;','\nrollback;'))
 assert sql("select to_regclass('receptionist_voicemail_intakes') is null")=='t'
 sql(migration)
 if any(flag in sys.argv for flag in ['--queue','--discovery','--dispatch']):
  sql("create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;")
  sql(file('supabase/migrations/20260708130000_platform_jobs.sql'))
  queue=file('supabase/migrations/20260710120000_platform_job_queue.sql')
  sql(queue[:queue.index('-- ── Register the async queue worker')])
  sql(file('supabase/migrations/20260804120000_active_job_key_include_retrying.sql'))
  sql('grant select,insert,update on platform_jobs to service_role;')
  queued=file('supabase/migrations/20261101430000_learn_voicemail_queue.sql')
  sql(queued.replace('\ncommit;','\nrollback;'))
  assert sql("select to_regclass('receptionist_voicemail_jobs') is null and to_regprocedure('voicemail_queue_recover()') is null")=='t'
  sql(queued)
 sql('grant usage on schema storage to service_role;grant select on storage.objects,storage.buckets,email_accounts to service_role;')
 sql(f"insert into tenants(id) values('{ident(1)}'),('{ident(2)}');insert into auth.users(id) values('{ident(10)}'),('{ident(11)}'),('{ident(12)}');insert into email_accounts values('{ident(3)}','{ident(1)}','synthetic@example.invalid','gmail','active_dwd');insert into receptionist_mailboxes(id,tenant_id,provider_mailbox_id,display_name,extension,owner_user_id) values('{ident(5)}','{ident(1)}','synthetic','Synthetic mailbox','601','{ident(10)}');insert into receptionist_mailbox_managers values('{ident(1)}','{ident(5)}','{ident(12)}','{ident(12)}',now());insert into receptionist_voicemail_email_routes(id,tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,owner_user_id,access_mode,received_from,binding_evidence,verified_by) values('{ident(4)}','{ident(1)}','{ident(5)}','{ident(3)}','synthetic@example.invalid','synthetic.birchills.invalid','{ident(10)}','owner','2026-10-01','Synthetic fixture only','{ident(12)}');")
 denied('set role authenticated;'+call(source,candidate),'permission denied')
 denied('set role anon;select * from receptionist_voicemail_sources;','permission denied')
 denied('set role service_role;'+call(source,candidate),'voicemail_route_unverified')
 sql(f"update receptionist_voicemail_email_routes set enabled=true where id='{ident(4)}';")
 denied('set role service_role;'+call({**source,'received_at':'2026-09-01T00:00:00Z'},candidate),'voicemail_route_unverified')
 denied('set role service_role;'+call({**source,'signing_domain':'wrong.invalid'},candidate),'voicemail_provider_binding_changed')
 denied('set role service_role;'+call(source,{**candidate,'owner_user_id':ident(11)}),'voicemail_source_invalid')
 request='set role service_role;'+call(source,candidate)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  receipts=list(pool.map(lambda _:json.loads(sql(request)),[1,2]))
 assert receipts[0]==receipts[1]
 receipt=receipts[0];intake=receipt['intake_id'];src=receipt['source_id']
 assert sql('select count(*) from receptionist_voicemail_intakes')=='1'
 assert sql('select count(*) from receptionist_voicemails')=='0'
 denied('set role service_role;'+call({**source,'audio_sha256':'d'*64},candidate),'voicemail_duplicate_conflict')
 denied('set role service_role;'+call({**source,'raw_sha256':'d'*64},candidate),'voicemail_email_replay_conflict')
 denied('set role service_role;'+call(source,{**candidate,'system_reference':ident(21)}),'voicemail_email_replay_conflict')
 assert sql('select count(*) from receptionist_voicemail_intakes')=='1'
 sql(f"insert into receptionist_voicemail_email_routes(id,tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,owner_user_id,access_mode,received_from,binding_evidence,verified_by,enabled) select '{ident(6)}',tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,owner_user_id,access_mode,received_from,'Second synthetic route',verified_by,true from receptionist_voicemail_email_routes where id='{ident(4)}';")
 denied('set role service_role;'+call(source,candidate,route=6),'voicemail_email_replay_conflict')
 # A separate email copy preserves its own receipt without duplicating the voicemail.
 copy=json.loads(sql('set role service_role;'+call({**source,'email_id':'abcdef02','received_at':'2026-10-10T12:00:01Z','raw_sha256':'e'*64},candidate)))
 assert copy['intake_id']==intake and copy['source_id']!=src
 assert sql('select count(*) from receptionist_voicemail_sources')=='2'
 publish=f"set role service_role;select voicemail_intake_publish('{ident(1)}','{intake}','{src}','{'a'*64}','{'b'*64}');"
 denied(publish,'voicemail_upload_incomplete')
 sql(f"insert into storage.objects(bucket_id,name,metadata) values('receptionist-voicemails',{lit(receipt['audio_path'])},'{{\"size\":4,\"mimetype\":\"audio/mpeg\"}}');")
 denied(publish,'voicemail_upload_incomplete')
 sql(f"insert into storage.objects(bucket_id,name,metadata) values('learn-voicemail-sources',{lit(receipt['source_path'])},'{{\"size\":100,\"mimetype\":\"message/rfc822\"}}');")
 denied(publish.replace('a'*64,'f'*64),'voicemail_upload_unverified')
 # Deliberately fail after the message insert: the whole publication must roll back.
 sql("create function intake_failure_probe() returns trigger language plpgsql as $$begin raise exception 'synthetic_publish_failure';end$$;create trigger intake_failure_probe before update on receptionist_voicemail_intakes for each row execute function intake_failure_probe();")
 denied(publish,'synthetic_publish_failure')
 assert sql('select count(*) from receptionist_voicemails')=='0'
 assert sql('select state from receptionist_voicemail_intakes')=='prepared'
 sql('drop trigger intake_failure_probe on receptionist_voicemail_intakes;drop function intake_failure_probe();')
 sql(f"insert into feature_flags values('{ident(1)}','learn.inputs.email.enabled','false');")
 denied(publish,'voicemail_capture_paused')
 sql('delete from feature_flags;')
 sql(f"insert into feature_flags values('{ident(1)}','learn.inputs.phone.enabled','false');")
 denied(publish,'voicemail_capture_paused')
 denied('set role service_role;'+call({**source,'email_id':'abcdef03'},candidate),'voicemail_capture_paused')
 assert sql('select count(*) from receptionist_voicemails')=='0'
 sql('delete from feature_flags;')
 # Mailbox reassignment cannot change the explicitly verified historical snapshot.
 sql(f"update receptionist_mailboxes set owner_user_id='{ident(11)}';")
 denied(f"update receptionist_voicemail_email_routes set owner_user_id='{ident(11)}';",'voicemail_evidence_immutable')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  published=list(pool.map(lambda _:sql(publish),[1,2]))
 assert published[0]==published[1]
 assert sql('select count(*) from receptionist_voicemails')=='1'
 assert sql('select owner_user_id from receptionist_voicemails')==ident(10)
 # Actual client RLS sees only the authorized owner or explicit manager.
 def visible(user):return sql(f"set role authenticated;select set_config('test.tenant','{ident(1)}',false);select set_config('request.jwt.claim.sub','{ident(user)}',false);select count(*) from receptionist_voicemails;").splitlines()[-1]
 assert visible(10)=='1' and visible(11)=='0' and visible(12)=='1'
 sql('delete from receptionist_mailbox_managers;')
 assert visible(12)=='0'
 denied('set role authenticated;select * from receptionist_voicemail_intakes;','permission denied')
 assert sql("set role authenticated;select count(*) from storage.objects where bucket_id in ('receptionist-voicemails','learn-voicemail-sources');")=='0'
 denied(f"set role service_role;select voicemail_intake_publish('{ident(2)}','{intake}','{src}','{'a'*64}','{'b'*64}');",'voicemail_upload_unverified')
 sql('update receptionist_voicemail_email_routes set enabled=false;')
 assert json.loads(sql(publish))['state']=='published' # read-only acknowledgement of completed work
 sql("update storage.objects set metadata=jsonb_set(metadata,'{size}','0') where bucket_id='receptionist-voicemails';")
 denied(publish,'voicemail_upload_incomplete')
 sql("update storage.objects set metadata=jsonb_set(metadata,'{size}','4') where bucket_id='receptionist-voicemails';")
 denied('set role service_role;'+call({**source,'email_id':'abcdef04'},candidate),'voicemail_route_unverified')
 assert sql('select count(*) from receptionist_voicemails')=='1'
 print('PASS: actual private intake DDL, rollback rehearsal, disabled routes, sender/time binding, permission denials, concurrent retry, distinct email evidence, conflicting replay, incomplete uploads, capture pause, atomic publication, historical owner snapshot, manager revocation, private storage, tenant isolation and retained history')
 subprocess.run(['node','scripts/verify/learn-voicemail-import-client-probe.mjs',name],cwd=root,check=True,timeout=60)
 if any(flag in sys.argv for flag in ['--queue','--discovery','--dispatch']):subprocess.run(['node','scripts/verify/learn-voicemail-queue-client-probe.mjs',name],cwd=root,check=True,timeout=90)
 if '--discovery' in sys.argv or '--dispatch' in sys.argv:
  from voicemail_discovery_probe import verify_discovery
  verify_discovery(sql,denied,file)
  subprocess.run(['node','scripts/verify/learn-voicemail-discovery-journey.mjs',name],cwd=root,check=True,timeout=60)
 if '--dispatch' in sys.argv:
  from voicemail_dispatch_probe import verify_dispatch
  verify_dispatch(sql,denied,file)
finally:
 if created:subprocess.run([docker,'rm','-f',name],capture_output=True,timeout=30)
