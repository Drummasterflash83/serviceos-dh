"""QuickBooks DDL rehearsal in a network-isolated full local schema clone.
Reads schema only from the existing local Supabase; never reads its customer rows
or stores the dump on disk. Never modifies the source container.
"""
import hashlib,json,shutil,subprocess,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DOCKER=shutil.which('docker') or '/usr/local/bin/docker'
SOURCE='supabase_db_serviceos-dh'
TARGET='serviceos-quickbooks-schema-'+uuid.uuid4().hex[:8]
IMAGE='public.ecr.aws/supabase/postgres:17.6.1.141'
created=False
migrations=['20261102000000_learn_quickbooks_oauth.sql','20261102010000_learn_quickbooks_import.sql','20261102020000_learn_quickbooks_customer_finance.sql','20261102030000_learn_quickbooks_disconnect.sql']
def docker(*args,**kwargs):return subprocess.run([DOCKER,*args],capture_output=True,check=True,**kwargs)
def sql(text,db='quickbooks_schema'):
 r=subprocess.run([DOCKER,'exec','-i',TARGET,'psql','-h','127.0.0.1','-U','supabase_admin','-d',db,'-qAt','-v','ON_ERROR_STOP=1'],input=text,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr[-1600:])
 return r.stdout.strip()
try:
 docker('run','-d','--pull=never','--network','none','--name',TARGET,'-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE);created=True
 for _ in range(100):
  try:sql('select 1','postgres');break
  except RuntimeError:time.sleep(.25)
 else:raise RuntimeError('Disposable database unavailable')
 roles=set(docker('exec',SOURCE,'psql','-U','supabase_admin','-d','postgres','-Atc',"select rolname from pg_roles where rolname not like 'pg_%'").stdout.decode().splitlines())
 existing=set(sql('select rolname from pg_roles','postgres').splitlines())
 for role in sorted(roles-existing):sql('create role "'+role.replace('"','""')+'" NOLOGIN','postgres')
 docker('exec',TARGET,'createdb','-U','supabase_admin','-T','template0','quickbooks_schema')
 schema=docker('exec',SOURCE,'pg_dump','-U','postgres','-d','postgres','--schema-only').stdout.decode()
 sql(schema)
 sql("alter role postgres nosuperuser createrole bypassrls;grant usage,create on schema public to postgres with grant option")
 # This local database predates operator capture controls. Add the exact two
 # repository helper definitions to the clone only, and report this limitation.
 helpers=(ROOT/'supabase/migrations/20261031160000_learn_operator_inputs.sql').read_text()
 additions=[]
 for name,end in [('learn_operator_input_immutable','create trigger learn_operator_input_immutable'),('learn_operator_input_access','-- Explicit booleans only.')]:
  if sql("select exists(select 1 from pg_proc where proname='"+name+"')")=='f':
   begin=helpers.index('create function public.'+name+'(')
   sql('set role postgres;'+helpers[begin:helpers.index(end,begin)])
   additions.append(name)
 before=sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")
 # Match deployed ownership rather than test as a superuser.
 # Preserve the source schema's function/table ownership and use the normal
 # non-superuser migration role for new objects.
 for file in migrations:
  source=(ROOT/'supabase/migrations'/file).read_text()
  sql('set role postgres;'+source.replace('\ncommit;','\nrollback;'))
  table='learn_quickbooks_apps' if 'oauth' in file else 'learn_quickbooks_customer_links' if 'finance' in file else 'learn_quickbooks_disconnections' if 'disconnect' in file else 'learn_quickbooks_imports'
  assert sql(f"select to_regclass('public.{table}') is null")=='t'
  sql('set role postgres;'+source)
 assert sql("select count(*) from learn_quickbooks_apps")=='0'
 assert sql("select count(*) from learn_quickbooks_imports")=='0'
 assert sql("select bool_and(c.relrowsecurity and not has_table_privilege('authenticated',c.oid,'SELECT') and not has_table_privilege('anon',c.oid,'SELECT')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'learn_quickbooks_%' and c.relkind='r'")=='t'
 assert sql("select not has_function_privilege('authenticated','learn_quickbooks_import_acquire(uuid)','execute') and has_function_privilege('service_role','learn_quickbooks_import_acquire(uuid)','execute')")=='t'
 # Real local Vault extension stores only a synthetic app secret.
 sql("set role postgres;set request.jwt.claim.role='service_role';select learn_quickbooks_register_app('b0000000-0000-4000-8000-000000000001','sandbox','synthetic-app','https://example.invalid/functions/v1/quickbooks-oauth-callback','synthetic-secret');")
 assert sql("select s.decrypted_secret='synthetic-secret' from vault.decrypted_secrets s join learn_quickbooks_apps a on a.client_secret_id=s.id")=='t'
 print(json.dumps({'state':'passed','source':'local schema only','existingPublicTables':int(before),'addedRepositoryHelpers':additions,'checks':['All four exact migrations install under non-superuser postgres and roll back in the local schema augmented with the listed prerequisite helpers.','No connection, source import, feature activation or schedule seeded.','QuickBooks table RLS and user/service grants verified.','Real local Vault extension stores and retrieves a synthetic app secret.'],'limitations':['Local schema can differ from hosted TEST and production; hosted catalog preflight still required.','No real provider credential, company data, hosted encryption or signed-in browser acceptance.']},indent=2))
finally:
 if created:docker('rm','-fv',TARGET)
