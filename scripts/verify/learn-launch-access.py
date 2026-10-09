"""Test the proposed TEST metadata views in an offline privilege projection.

The recorded hosted TEST catalog supplies columns and policies. No live database
is contacted; constraints, triggers and other functions are outside this projection.
Verification runs with synthetic data in a disposable network-isolated container
with no host mounts or published ports. Requires Docker and the cached Postgres
image below; no existing local database is read or changed. This verifies the
recorded privilege model, not full schema compatibility or hosted JWT behavior.
"""
import shutil
import subprocess
import uuid
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCKER = shutil.which('docker') or '/usr/local/bin/docker'
NODE = shutil.which('node') or '/usr/local/bin/node'
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.141'
TARGET = 'serviceos-launch-access-' + uuid.uuid4().hex[:8]


def docker(*args, **kwargs):
    return subprocess.run([DOCKER, *args], capture_output=True, check=True, **kwargs)


def query(container, sql):
    # The image briefly starts a socket-only server during initialization.
    # TCP ensures readiness refers to the final server, after its restart.
    host = ['-h', '127.0.0.1']
    return docker('exec', container, 'psql', *host, '-U', 'supabase_admin', '-d',
                  'postgres', '-Atc', sql).stdout.decode().splitlines()


def apply(sql, label, as_deployer=False):
    if as_deployer:
        sql = b'set role postgres;\n' + sql
    result = subprocess.run([DOCKER, 'exec', '-i', TARGET, 'psql', '-U',
                             'supabase_admin', '-d', 'roster_verify', '-v',
                             'ON_ERROR_STOP=1', '-f', '-'],
                            input=sql, capture_output=True)
    if result.returncode:
        # Do not print schema bodies or arbitrary source data on failure.
        messages = result.stderr.decode().splitlines()
        print(label + ': FAILED (exit ' + str(result.returncode) + ')')
        print('\n'.join(line for line in messages if any(k in line.upper() for k in ['ERROR', 'FATAL', 'ASSERT', 'HINT:']))[-1000:])
        raise RuntimeError(label + ' failed')
    print(label + ': PASS')


def metadata_report():
    # Run the actual catalog SQL and assessor against this disposable database.
    # No hand-authored fixture substitutes for PostgreSQL's privilege answers.
    query_sql = subprocess.run([NODE, '--input-type=module', '-e',
        "import {CATALOG_QUERY} from './scripts/verify/learn-test-readiness.mjs'; process.stdout.write(CATALOG_QUERY);"],
        cwd=ROOT, capture_output=True, check=True).stdout
    result = docker('exec', '-i', TARGET, 'psql', '-U', 'supabase_admin', '-d',
                    'roster_verify', '-At', '-v', 'ON_ERROR_STOP=1', input=query_sql)
    assessed = subprocess.run([NODE, '--input-type=module', '-e',
        "import {assessTestCatalog} from './scripts/verify/learn-test-readiness.mjs';"
        "let s='';for await(const c of process.stdin)s+=c;"
        "process.stdout.write(JSON.stringify(assessTestCatalog(JSON.parse(s),[]).launchMetadata));"],
        cwd=ROOT, input=result.stdout, capture_output=True, check=True)
    return json.loads(assessed.stdout)


try:
    import json
    docker('run', '-d', '--pull=never', '--network', 'none', '--name', TARGET,
           '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE)
    for attempt in range(80):
        try:
            query(TARGET, 'select 1')
            break
        except subprocess.CalledProcessError:
            time.sleep(.25)
    else: raise RuntimeError('Disposable database did not start')
    docker('exec', TARGET, 'createdb', '-U', 'supabase_admin', '-T', 'template0', 'roster_verify')
    catalog=json.loads((ROOT/'docs/operations/evidence/learn-test-schema-2026-10-09.json').read_text())
    needed=['profiles','email_messages','phone_calls','phone_recordings','phone_transcripts',
      'email_accounts','google_workspace_mailboxes','email_sync_runs','phone_sync_runs']
    tables=[t for t in catalog['tables'] if t['schema']=='public' and t['name'] in needed]
    assert len(tables)==len(needed)
    existing=set(query(TARGET,'select rolname from pg_roles'))
    for role in ['authenticated','anon','service_role','email_ingestion_protocol_owner']:
        if role not in existing: query(TARGET, 'create role '+role+' nologin')
    def ident(s): return '"'+s.replace('"','""')+'"'
    sql=["create schema auth; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema public,auth to authenticated,anon;"]
    for t in tables:
        # Intentionally a privilege projection, NOT a full schema clone: retain
        # actual column types/policies, but do not guess absent defaults/FKs.
        sql.append('create table public.'+ident(t['name'])+'('+','.join(ident(c['name'])+' '+c['type'] for c in t['columns'])+');')
        if t['rls']:sql.append('alter table public.'+ident(t['name'])+' enable row level security;')
        if t['forceRls']:sql.append('alter table public.'+ident(t['name'])+' force row level security;')
        if t['authenticatedSelect']:sql.append('grant select on public.'+ident(t['name'])+' to authenticated;')
        for policy in t['policies']:
            sql.append('create policy '+ident(policy['name'])+' on public.'+ident(t['name'])+' for '+policy['command']+' to '+','.join(ident(r) for r in policy['roles'])+
              (' using('+policy['using']+')' if policy['using'] else '')+(' with check('+policy['check']+')' if policy['check'] else '')+';')
    ledger=json.loads((ROOT/'docs/operations/evidence/learn-test-readiness-2026-10-09.json').read_text())['customMigrationEntries'][0]
    sql.append("create schema of_test_deploy; create table of_test_deploy.migrations(source_sha256 text,migration_name text,project_ref text,applied_at timestamptz);")
    sql.append("insert into of_test_deploy.migrations values ('"+ledger['source_sha256']+"','openfolk_test_learn_bootstrap_v5','saatxzwxvdvqevbnskxy',now());")
    sql.append("create table public.test_policy_before as select * from pg_policies where schemaname='public';")
    apply('\n'.join(sql).encode(),'Actual TEST column/policy privilege projection')
    # Hosted metadata queries confirmed all nine tables are owned by postgres,
    # which is NOSUPERUSER, CREATEROLE, BYPASSRLS. Do not silently rely on the
    # disposable image's superuser for release ownership changes.
    deployer = ["alter role postgres nologin nosuperuser createrole bypassrls;",
        "grant usage,create on schema public to postgres with grant option;",
        "grant usage on schema auth to postgres with grant option;",
        "grant execute on function auth.uid() to postgres with grant option;",
        "grant usage on schema of_test_deploy to postgres;",
        "grant select on of_test_deploy.migrations to postgres;"]
    deployer += ['alter table public.' + ident(name) + ' owner to postgres;' for name in needed]
    apply('\n'.join(deployer).encode(), 'Hosted non-superuser deployment privilege model')
    before = metadata_report()
    assert before['state'] == 'blocked' and 'missing_reader_role' in before['roleIssues']
    assert all('missing_view' in view['issues'] for view in before['views'])
    print('Catalog audit recognizes absent release: PASS')
    rehearsal = subprocess.run([NODE, '--input-type=module', '-e',
        "import {rehearsalSql} from './scripts/verify/learn-test-launch-rehearsal.mjs'; process.stdout.write(rehearsalSql());"],
        cwd=ROOT, capture_output=True, check=True).stdout
    apply(rehearsal, 'Exact hosted rehearsal SQL executes and rolls back', as_deployer=True)
    assert metadata_report() == before, 'Rollback must restore the pre-rehearsal privilege catalog'
    proposal=(ROOT/'supabase/release/learn-test/001_launch_metadata_views.sql').read_text()
    # Refuse unscoped application, then ensure its transaction created nothing.
    denied=subprocess.run([DOCKER,'exec','-i',TARGET,'psql','-U','supabase_admin','-d','roster_verify','-v','ON_ERROR_STOP=1','-f','-'],input=proposal.encode(),capture_output=True)
    assert denied.returncode!=0 and b'Explicit existing TEST target required' in denied.stderr
    print('Unscoped release refused: PASS')
    apply(("set serviceos.release_target='saatxzwxvdvqevbnskxy';\n"+proposal).encode(),'Proposed metadata views', as_deployer=True)
    apply((ROOT/'scripts/verify/learn-launch-access.assert.sql').read_bytes(),'Owner/admin, tenant, viewer, redaction and preservation assertions')
    after = metadata_report()
    if after['roleIssues']:
        print(docker('exec', TARGET, 'psql', '-U', 'supabase_admin', '-d', 'roster_verify', '-Atc',
            "select jsonb_build_object('member',m.rolname,'grantor',g.rolname,'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option) from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member join pg_roles g on g.oid=a.grantor where r.rolname='learn_launch_metadata_reader'").stdout.decode())
    assert after['state'] == 'needs_semantic_and_user_verification', after
    print('Actual catalog recognizes restricted view contract without declaring release: PASS')
    apply(b'grant select(transcript_text) on phone_transcripts to learn_launch_metadata_reader;', 'Synthetic excess privilege')
    drift = metadata_report()
    assert drift['state'] == 'blocked'
    assert 'reader_extra_columns_or_unknown' in next(s for s in drift['sources'] if s['source'] == 'phone_transcripts')['issues']
    apply(b'revoke select(transcript_text) on phone_transcripts from learn_launch_metadata_reader;', 'Restore synthetic privilege')
    apply(b'grant learn_launch_metadata_reader to authenticated;', 'Synthetic role membership')
    assert 'reader_memberships_need_review' in metadata_report()['roleIssues']
    apply(b'revoke learn_launch_metadata_reader from authenticated;', 'Restore synthetic membership')
    assert metadata_report()['state'] == 'needs_semantic_and_user_verification'
    print('Catalog audit detects private-column and role-membership drift: PASS')
finally:
    subprocess.run([DOCKER,'rm','-f',TARGET],capture_output=True)
