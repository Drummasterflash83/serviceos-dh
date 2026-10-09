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


def apply(sql, label):
    result = subprocess.run([DOCKER, 'exec', '-i', TARGET, 'psql', '-U',
                             'supabase_admin', '-d', 'roster_verify', '-v',
                             'ON_ERROR_STOP=1', '-f', '-'],
                            input=sql, capture_output=True)
    if result.returncode:
        # Do not print schema bodies or arbitrary source data on failure.
        messages = result.stderr.decode().splitlines()
        print(label + ': FAILED')
        print('\n'.join(line for line in messages if 'ERROR:' in line or 'ASSERT' in line)[-1000:])
        raise RuntimeError(label + ' failed')
    print(label + ': PASS')


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
    proposal=(ROOT/'supabase/release/learn-test/001_launch_metadata_views.sql').read_text()
    # Refuse unscoped application, then ensure its transaction created nothing.
    denied=subprocess.run([DOCKER,'exec','-i',TARGET,'psql','-U','supabase_admin','-d','roster_verify','-v','ON_ERROR_STOP=1','-f','-'],input=proposal.encode(),capture_output=True)
    assert denied.returncode!=0 and b'Explicit existing TEST target required' in denied.stderr
    print('Unscoped release refused: PASS')
    apply(("set serviceos.release_target='saatxzwxvdvqevbnskxy';\n"+proposal).encode(),'Proposed metadata views')
    apply((ROOT/'scripts/verify/learn-launch-access.assert.sql').read_bytes(),'Owner/admin, tenant, viewer, redaction and preservation assertions')
finally:
    subprocess.run([DOCKER,'rm','-f',TARGET],capture_output=True)
