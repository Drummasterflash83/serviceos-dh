"""Actual candidate SQL and phone table definitions in a network-isolated disposable DB."""
import subprocess,shutil,time,uuid
from pathlib import Path
root=Path(__file__).resolve().parents[2]
docker=shutil.which('docker') or '/usr/local/bin/docker'
name='serviceos-playback-'+uuid.uuid4().hex[:8]
def sql(s):
 r=subprocess.run([docker,'exec','-i',name,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input=s,text=True,capture_output=True,timeout=30)
 if r.returncode:raise RuntimeError(r.stderr[-3000:])
 return r.stdout.strip()
def read(p):return(root/p).read_text()
created=False
try:
 subprocess.run([docker,'run','-d','--pull=never','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15'],check=True,capture_output=True,timeout=30);created=True
 for _ in range(60):
  if subprocess.run([docker,'exec',name,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('Database not ready')
 sql("create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table tenants(id uuid primary key,name text);create table profiles(id uuid primary key,tenant_id uuid,role text);create function set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;")
 original=read('supabase/migrations/20260701120000_phone_input_foundation.sql')
 sql(original[original.index('create table if not exists phone_calls ('):original.index('-- phone_transcripts')].rsplit('-- ---------------------------------------------------------------------------',1)[0])
 immutable=read('supabase/migrations/20261031160000_learn_operator_inputs.sql');start=immutable.index('create function public.learn_operator_input_immutable()');end=immutable.index('create trigger learn_operator_input_immutable',start)
 sql(immutable[start:end])
 migration=read('supabase/migrations/20261101230000_learn_phone_playback.sql')
 sql(migration)
 print(sql('begin;'+read('scripts/verify/learn-phone-playback.assert.sql')+'rollback;'),flush=True)
finally:
 if created:subprocess.run([docker,'rm','-f',name],capture_output=True,timeout=20)
