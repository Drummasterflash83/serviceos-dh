"""Exercise actual operator-control SQL in isolated Postgres; no network or host mounts."""
import concurrent.futures
import shutil
import subprocess
import time
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[2]
docker = shutil.which('docker') or '/usr/local/bin/docker'
name = 'serviceos-commusoft-connection-' + uuid.uuid4().hex[:8]
created = False

def sql(text):
    r = subprocess.run([docker, 'exec', '-i', name, 'psql', '-X', '-qAt', '-U', 'postgres',
                        '-v', 'ON_ERROR_STOP=1'], input=text, text=True, capture_output=True, timeout=40)
    if r.returncode:
        raise RuntimeError(r.stderr[-3000:])
    return r.stdout.strip()

def source(path):
    return (root / path).read_text()

try:
    subprocess.run([docker, 'run', '-d', '--pull=never', '--network', 'none', '--name', name,
                    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:15'], check=True, capture_output=True, timeout=30)
    created = True
    for _ in range(40):
        # The image's temporary bootstrap server is socket-only. Wait for the
        # final TCP listener so initialization cannot stop the server under psql.
        if subprocess.run([docker, 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0:
            break
        time.sleep(.25)
    else:
        raise RuntimeError('Isolated database unavailable')
    sql(source('scripts/verify/learn-commusoft-permits.fixture.sql'))
    sql(source('scripts/verify/learn-commusoft-worker.fixture.sql'))
    sql(source('scripts/verify/learn-operator-inputs.fixture.sql'))
    authority = source('supabase/migrations/20260821120000_openfolk_control_plane.sql')
    sql(authority[authority.index('create table if not exists platform_authority_grants ('):authority.index('-- OpenFolk-operator resolver')])
    resolver = source('supabase/migrations/20260822120000_platform_authority_decoupled_from_role.sql')
    sql(resolver[resolver.index('create or replace function current_user_is_openfolk_operator('):resolver.index('-- ── Governed record')])
    migration = source('supabase/migrations/20261031160000_learn_operator_inputs.sql')
    sql(migration.replace('\ncommit;', '\nrollback;'))
    if sql("select to_regclass('learn_operator_input_requests') is null and to_regprocedure('learn_operator_inputs(uuid)') is null") != 't':
        raise RuntimeError('Rollback retained operator objects')
    print('Operator migration rollback left no new objects.')
    sql(migration)
    sql(source('scripts/verify/learn-commusoft-connection.fixture.sql'))
    sql(source('supabase/migrations/20260810120000_provider_secret_broker.sql'))
    connection = source('supabase/migrations/20261031170000_learn_commusoft_connection_setup.sql')
    sql(connection.replace('\ncommit;', '\nrollback;'))
    if sql("select to_regclass('learn_commusoft_connection_requests') is null and to_regprocedure('learn_commusoft_configure(uuid,uuid,uuid,jsonb,text,text)') is null") != 't':
        raise RuntimeError('Connection rollback retained objects')
    sql(connection)
    print(sql(source('scripts/verify/learn-commusoft-connection.assert.sql')))
    definition = sql("select fixture_connection_definition('reuse',updated_at) from provider_connections where tenant_id=fixture_id(300)")
    sql("insert into fixture_input_definitions values('connection-race','" + definition.replace("'", "''") + "'::jsonb)")
    def race(mode):
        return sql("set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;select learn_commusoft_configure(fixture_id(300),fixture_id(330),fixture_id(180),fixture_definition('connection-race'),'"+mode+"')->>'state';")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(race,['apply','cancel']))
    if results not in (['recorded','recorded'],['cancelled','cancelled']):
        raise RuntimeError('Concurrent connection actions diverged')
    print('Concurrent connection apply/cancel returned one durable outcome.')
    receipt = sql("set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;select learn_commusoft_configure(fixture_id(300),fixture_id(310),fixture_id(180),fixture_connection_definition(),'check');")
    output=root/'.verification-results'/'learn-commusoft-connection-receipt.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(receipt+'\n')
    subprocess.run(['node','--input-type=module','-e',
        "import {readFileSync} from 'node:fs';import {resolveCommusoftSetup} from './src/lib/learn-commusoft-connection.ts';const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');const data=JSON.parse(readFileSync('.verification-results/learn-commusoft-connection-receipt.json','utf8'));await resolveCommusoftSetup({rpc:async()=>({data,error:null})},{tenantId:id(300),actorId:id(180),requestId:id(310),definition:{kind:'configure_commusoft',reason:'Synthetic connection review',region:'uk',account_key:'synthetic-account',expected_revision:null,credential_mode:'replace',same_account_confirmed:true}},'check');"],cwd=root,check=True,capture_output=True,timeout=15)
    print('Actual SQL receipt passed the connection application adapter.')
finally:
    if created:
        subprocess.run([docker, 'rm', '-f', name], check=True, capture_output=True, timeout=30)
