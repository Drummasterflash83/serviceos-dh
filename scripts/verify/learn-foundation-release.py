"""Exercise the additive TEST foundation against a recorded schema projection.

No live database or existing local database is read. A disposable, network-isolated
Postgres container restores recorded columns/defaults/constraints/indexes/policies
and four helpers. Auth is an ID-only stand-in; email protocol triggers and launch
views are outside the projection. Hosted rollback rehearsal is still required.
"""
import hashlib
import json
import shutil
import sys
import subprocess
import time
import uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
DOCKER=shutil.which('docker') or '/usr/local/bin/docker'
NODE=shutil.which('node') or '/usr/local/bin/node'
IMAGE='public.ecr.aws/supabase/postgres:17.6.1.141'
TARGET='serviceos-foundation-'+uuid.uuid4().hex[:8]
DB='foundation_verify'

def docker(*args, **kwargs):
    return subprocess.run([DOCKER,*args],capture_output=True,check=True,**kwargs)
def run(sql, check=True):
    r=subprocess.run([DOCKER,'exec','-i',TARGET,'psql','-h','127.0.0.1','-U','supabase_admin','-d',DB,'-At','-v','ON_ERROR_STOP=1','-f','-'],input=sql.encode(),capture_output=True)
    if check and r.returncode:
        print('\n'.join(x for x in r.stderr.decode().splitlines() if any(k in x.upper() for k in ['ERROR','FATAL','HINT:','CONTEXT:']))[-1600:])
        raise RuntimeError('Synthetic foundation SQL failed')
    return r
def apply(sql,label):
    run(sql);print(label+': PASS',flush=True)
def ident(s):return '"'+s.replace('"','""')+'"'
def lit(s):return "'"+s.replace("'","''")+"'"
def node(code):return subprocess.run([NODE,'--input-type=module','-e',code],cwd=ROOT,capture_output=True,check=True).stdout.decode()
def snapshot():
    c=json.loads(run(catalog_sql).stdout)
    return {'tables':[t for t in c['tables'] if t['name'] in names], 'helpers':c['helpers']}

bundle=json.loads(node("import {checkedFoundation} from './scripts/verify/learn-foundation-bundle.mjs';process.stdout.write(JSON.stringify(checkedFoundation()));"))
manifest=bundle['manifest']
assert hashlib.sha256(bundle['sql'].encode()).hexdigest()==manifest['sha256']
release="set role postgres;set serviceos.release_target='saatxzwxvdvqevbnskxy';set serviceos.release_source_sha256="+lit(manifest['sha256'])+";\n"+bundle['sql']
catalog_sql=node("import {FOUNDATION_CATALOG_QUERY} from './scripts/verify/learn-foundation-catalog.mjs';process.stdout.write(FOUNDATION_CATALOG_QUERY);")
catalog=json.loads((ROOT/'docs/operations/evidence/learn-test-foundation-schema-2026-10-09.json').read_text())
names=[t['name'] for t in catalog['tables']]
assert len(names)==26 and all(t['owner']=='postgres' for t in catalog['tables'])
try:
    docker('run','-d','--pull=never','--network','none','--name',TARGET,'-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE)
    for _ in range(100):
        try:
            docker('exec',TARGET,'psql','-h','127.0.0.1','-U','supabase_admin','-d','postgres','-Atc','select 1');break
        except subprocess.CalledProcessError:time.sleep(.25)
    else:raise RuntimeError('Disposable database did not start')
    docker('exec',TARGET,'createdb','-U','supabase_admin','-T','template0',DB)
    existing=set(run('select rolname from pg_roles').stdout.decode().splitlines())
    roles={'authenticated','anon','service_role','learn_launch_metadata_reader','email_ingestion_protocol_owner'}
    roles.update(r for t in catalog['tables'] for p in t['policies'] for r in p['roles'] if r!='public')
    sql=['create schema auth;create table auth.users(id uuid primary key);',
         "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;"]
    sql += ['create role '+ident(r)+' nologin;' for r in roles-existing]
    sql += ['alter role service_role bypassrls;', 'alter role postgres nologin nosuperuser createrole bypassrls;',
      'grant usage,create on schema public to postgres with grant option;',
      'grant usage on schema public,auth to postgres,authenticated,anon,service_role;',
      'grant references on auth.users to postgres;']
    for t in catalog['tables']:
        cols=','.join(ident(c['name'])+' '+c['type']+(' default '+c['default'] if c['default'] else '')+(' not null' if c['notNull'] else '') for c in t['columns'])
        sql += ['create table public.'+ident(t['name'])+'('+cols+');','alter table public.'+ident(t['name'])+' owner to postgres;']
    # Unique indexes may support foreign keys even when not constraint-backed.
    for t in catalog['tables']:
        for k in t['constraints']:
            if k['kind']!='f':sql.append('alter table public.'+ident(t['name'])+' add constraint '+ident(k['name'])+' '+k['definition']+';')
        backing={k['name'] for k in t['constraints'] if k['kind'] in ['p','u','x']}
        sql += [i['definition']+';' for i in t['indexes'] if i['name'] not in backing]
    for t in catalog['tables']:
        sql += ['alter table public.'+ident(t['name'])+' add constraint '+ident(k['name'])+' '+k['definition']+';' for k in t['constraints'] if k['kind']=='f']
    for f in catalog['helpers']:
        sql += [f['definition']+';', 'alter function public.'+ident(f['name'])+'() owner to postgres;']
    for f in catalog['helpers']:
        sql.append('revoke all on function public.'+ident(f['name'])+'() from public,anon,authenticated;')
    for t in catalog['tables']:
        if t['rls']:sql.append('alter table public.'+ident(t['name'])+' enable row level security;')
        if t['forceRls']:sql.append('alter table public.'+ident(t['name'])+' force row level security;')
        if t['authenticatedSelect']:sql.append('grant select on public.'+ident(t['name'])+' to authenticated;')
        for p in t['policies']:
            sql.append('create policy '+ident(p['name'])+' on public.'+ident(t['name'])+' as '+p['permissive']+' for '+p['command']+' to '+','.join(ident(r) for r in p['roles'])+(' using('+p['using']+')' if p['using'] else '')+(' with check('+p['check']+')' if p['check'] else '')+';')
        sql += [tgr['definition']+';' for tgr in t['triggers'] if tgr['function']=='set_updated_at']
    sql += ['create schema of_test_deploy authorization postgres;', 'create table of_test_deploy.migrations(source_sha256 text,migration_name text primary key,project_ref text,applied_at timestamptz);alter table of_test_deploy.migrations owner to postgres;']
    sql += ['insert into of_test_deploy.migrations values('+','.join(lit(e[k]) for k in ['source_sha256','migration_name','project_ref','applied_at'])+');' for e in catalog['readiness']['customMigrationEntries']]
    apply('\n'.join(sql),'Recorded schema projection under non-superuser release owner')
    apply((ROOT/'scripts/verify/learn-foundation-release.seed.sql').read_text(),'Synthetic pre-existing companies, logins and retained email')
    before=snapshot()
    apply("alter table of_test_deploy.migrations add constraint receipt_failure check(migration_name<>'learn_card_work_foundations_v1');",'Injected receipt failure')
    failed=run(release,False)
    assert failed.returncode and b'receipt_failure' in failed.stderr, failed.stderr.decode()[-800:]
    assert snapshot()==before
    absent="select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ("+','.join(lit(n) for n in manifest['tables'])+")"
    assert run(absent).stdout.strip()==b'0'
    assert run("select to_regprocedure('public.learn_foundation_reference_guard()') is null").stdout.strip()==b't'
    apply('alter table of_test_deploy.migrations drop constraint receipt_failure;','Atomic rollback leaves no foundation tables or guard')
    rehearsal=node("import {foundationRehearsalSql} from './scripts/verify/learn-test-foundation-rehearsal.mjs';process.stdout.write(foundationRehearsalSql());")
    apply('set role postgres;'+rehearsal,'Exact hosted rehearsal executes and rolls back')
    assert snapshot()==before and run(absent).stdout.strip()==b'0'
    refused=run('set role postgres;'+bundle['sql'],False)
    assert refused.returncode and b'Explicit TEST target' in refused.stderr
    print('Unscoped release refused: PASS',flush=True)
    apply(release,'Generated 33-table foundation release')
    if '--write-expected' in sys.argv:
        observed=json.loads(run(catalog_sql).stdout)
        expected={'sourceSha256':manifest['sha256'],'tables':[t for t in observed['tables'] if t['name'] in manifest['tables']],'guard':observed['foundationGuard']}
        (ROOT/'supabase/release/learn-test/002_card_work_foundations.expected.json').write_text(json.dumps(expected,indent=2)+'\n')
    assert snapshot()==before, 'Existing source definitions changed'
    print('Existing table/helper definitions preserved: PASS',flush=True)
    helper=(ROOT/'supabase/release/learn-test/003_foundation_helper_access.sql').read_text()
    helper_hash=hashlib.sha256(helper.encode()).hexdigest()
    apply("set role postgres;set serviceos.release_target='saatxzwxvdvqevbnskxy';set serviceos.release_source_sha256="+lit(helper_hash)+';'+helper,'Explicit helper access follow-up release')
    apply((ROOT/'scripts/verify/learn-foundation-release.assert.sql').read_text(),'Tenant isolation, reference integrity and retained communication assertions')
    tables=','.join(lit(t) for t in manifest['tables'])
    apply("do $$ declare t record;begin for t in select c.oid,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ("+tables+") loop assert t.relrowsecurity;assert has_table_privilege('authenticated',t.oid,'SELECT');assert not has_table_privilege('authenticated',t.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');assert not has_table_privilege('anon',t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');assert has_table_privilege('service_role',t.oid,'SELECT') and has_table_privilege('service_role',t.oid,'INSERT') and has_table_privilege('service_role',t.oid,'UPDATE') and has_table_privilege('service_role',t.oid,'DELETE');end loop;assert (select count(*)=33 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ("+tables+"));end $$;",'All 33 tables enforce explicit privileges and RLS')
    duplicate=run(release,False)
    assert duplicate.returncode and b'Foundation receipt exists' in duplicate.stderr
    print('Duplicate installation refused: PASS',flush=True)
finally:
    subprocess.run([DOCKER,'rm','-f',TARGET],capture_output=True)
