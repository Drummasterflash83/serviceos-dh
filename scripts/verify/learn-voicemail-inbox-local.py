"""Offline PostgreSQL: existing voicemail RLS through historical inbox discovery."""
import json, subprocess, shutil, uuid, time
from pathlib import Path
root=Path(__file__).resolve().parents[2]
docker=shutil.which('docker') or '/usr/local/bin/docker'
name='serviceos-voicemail-inbox-'+uuid.uuid4().hex[:8]
created=False
def sql(s):
 r=subprocess.run([docker,'exec','-i',name,'psql','-h','127.0.0.1','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],input=s,text=True,capture_output=True,timeout=30)
 if r.returncode:raise RuntimeError(r.stderr[-3500:])
 return r.stdout.strip()
def ident(n):return 'ce770000-aaaa-4000-8000-'+str(n).zfill(12)
def session(actor,tenant=1):return f"set role authenticated;set test.tenant='{ident(tenant)}';set request.jwt.claim.sub='{ident(actor)}';"
def read(actor,tenant=1,after=None,scope=1):
 return json.loads(sql(session(actor,scope)+f"select learn_voicemail_mailboxes('{ident(tenant)}',{repr(after) if after else 'null'});"))
def denied(s):
 try:sql(s)
 except RuntimeError as e:assert 'permission denied' in str(e) or 'Signed-in voicemail access required' in str(e)
 else:raise AssertionError('Expected denial')
try:
 subprocess.run([docker,'run','-d','--pull=never','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15'],capture_output=True,check=True,timeout=30);created=True
 for _ in range(60):
  if subprocess.run([docker,'exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.25)
 sql((root/'scripts/voicemail-test-bootstrap.sql').read_text())
 sql((root/'supabase/migrations/20261023210000_receptionist_voicemails.sql').read_text())
 sql(f"insert into tenants values('{ident(1)}'),('{ident(2)}');insert into auth.users values('{ident(10)}'),('{ident(11)}'),('{ident(12)}'),('{ident(13)}');")
 sql(f"insert into receptionist_mailboxes(id,tenant_id,provider_mailbox_id,display_name,extension,owner_user_id,notification_email,email_enabled) values('{ident(20)}','{ident(1)}','synthetic','New owners private configuration','601','{ident(11)}','current-owner@example.invalid',true),('{ident(21)}','{ident(2)}','foreign','Foreign mailbox','602','{ident(13)}',null,null);")
 sql(f"insert into receptionist_voicemails(id,tenant_id,mailbox_id,provider_message_id,owner_user_id,received_at) values('{ident(30)}','{ident(1)}','{ident(20)}','old-owner','{ident(10)}',now()),('{ident(31)}','{ident(1)}','{ident(20)}','new-owner','{ident(11)}',now()),('{ident(32)}','{ident(2)}','{ident(21)}','foreign','{ident(13)}',now());")
 assert sql(session(10)+f"select count(*) from voicemail_mailbox_summary('{ident(1)}');")=='0'
 assert sql(session(10)+'select count(*) from receptionist_voicemails;')=='1'
 before=sql("select md5(string_agg(to_jsonb(v)::text,'' order by id)) from receptionist_voicemails v;")
 migration=(root/'supabase/migrations/20261101460000_learn_voicemail_inbox_history.sql').read_text()
 sql(migration.replace('\ncommit;','\nrollback;'))
 assert sql("select to_regprocedure('learn_voicemail_mailboxes(uuid,uuid)') is null;")=='t'
 sql(migration)
 old=read(10)['rows'];assert len(old)==1 and old[0]['message_count']==1 and old[0]['access_scope']=='retained_messages'
 assert old[0]['display_name']=='Earlier private messages' and old[0]['extension']==''
 assert all(old[0][k] is None for k in ['notification_email','email_enabled','last_synced_at'])
 current=read(11)['rows'];assert len(current)==1 and current[0]['message_count']==1 and current[0]['access_scope']=='current'
 assert read(12)['rows']==[] and read(10,tenant=2)['rows']==[] and read(10,scope=2)['rows']==[]
 sql(f"insert into receptionist_mailbox_managers values('{ident(1)}','{ident(20)}','{ident(12)}','{ident(12)}',now());")
 manager=read(12)['rows'];assert len(manager)==1 and manager[0]['message_count']==2 and manager[0]['access_scope']=='current'
 sql('delete from receptionist_mailbox_managers;');assert read(12)['rows']==[]
 # A current owner with no saved messages still sees their empty assigned mailbox.
 sql(f"insert into receptionist_mailboxes(id,tenant_id,provider_mailbox_id,display_name,extension,owner_user_id) values('{ident(22)}','{ident(1)}','empty','Empty assigned mailbox','603','{ident(11)}');")
 assert any(r['id']==ident(22) and r['message_count']==0 for r in read(11)['rows'])
 for n in range(100,122):
  sql(f"insert into receptionist_mailboxes(id,tenant_id,provider_mailbox_id,display_name,extension,owner_user_id) values('{ident(n)}','{ident(1)}','synthetic-{n}','Owned {n}','{n}','{ident(10)}');")
 first=read(10);second=read(10,after=first['next_after']);assert len(first['rows'])==20 and len(second['rows'])==3 and second['next_after'] is None
 assert len(set(r['id'] for r in first['rows']+second['rows']))==23
 denied('set role anon;select learn_voicemail_mailboxes(null,null);')
 denied('set role service_role;select learn_voicemail_mailboxes(null,null);')
 denied('set role authenticated;set request.jwt.claim.sub=\'\';select learn_voicemail_mailboxes(null,null);')
 assert sql("select md5(string_agg(to_jsonb(v)::text,'' order by id)) from receptionist_voicemails v;")==before
 assert sql("select not prosecdef from pg_proc where proname='learn_voicemail_mailboxes';")=='t'
 print('PASS: regression reproduced; historical owner discovery; current settings hidden; new owner sees only own message; manager grant/revocation; tenant isolation; empty assigned mailbox; 20+3 pagination; anonymous/service/unsigned denial; rollback; source preservation; SECURITY INVOKER')
finally:
 if created:subprocess.run([docker,'rm','-f',name],capture_output=True,timeout=30)
