"""Exercise actual operator-control SQL in isolated Postgres; no network or host mounts."""
import concurrent.futures
import shutil
import subprocess
import time
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[2]
docker = shutil.which('docker') or '/usr/local/bin/docker'
name = 'serviceos-operator-inputs-' + uuid.uuid4().hex[:8]
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
        if subprocess.run([docker, 'exec', name, 'pg_isready', '-U', 'postgres'], capture_output=True).returncode == 0:
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
    print(sql(source('scripts/verify/learn-operator-inputs.assert.sql')))
    # Equal flags keep the definition stable across concurrent readers.
    sql("insert into fixture_input_definitions values('race',jsonb_build_object('kind','set_modules','reason','Synthetic concurrent approval','expected',jsonb_build_object('learn.enabled',true,'learn.inputs.commusoft.enabled',true),'values',jsonb_build_object('learn.enabled',true,'learn.inputs.commusoft.enabled',true)));")
    def race(mode):
        return sql("set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;select learn_operator_input_request(fixture_id(100),fixture_id(210),fixture_id(180),fixture_definition('race'),'" + mode + "')->>'state';")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(race, ['apply', 'cancel']))
    if results not in (['recorded', 'recorded'], ['cancelled', 'cancelled']):
        raise RuntimeError('Concurrent apply/cancel returned different outcomes')
    if sql('select count(*) from learn_operator_input_requests where id=fixture_id(210)') != '1':
        raise RuntimeError('Concurrent request duplicated receipt')
    print('Concurrent apply/cancel returned one durable outcome.')
    overview = sql("set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;select learn_operator_inputs(fixture_id(100));")
    output = root / '.verification-results' / 'learn-operator-inputs-overview.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(overview + '\n')
    # Consume the actual SQL response through the application parser. No mock shape.
    subprocess.run(['node', '--input-type=module', '-e',
                    "import {readFileSync} from 'node:fs';import {readOperatorInputs} from './src/lib/learn-operator-inputs.ts';const data=JSON.parse(readFileSync('.verification-results/learn-operator-inputs-overview.json','utf8'));await readOperatorInputs({rpc:async()=>({data,error:null})},'00000000-0000-4000-8000-000000000100');"],
                   cwd=root, check=True, capture_output=True, timeout=15)
    print('Actual SQL overview passed the application response parser.')
finally:
    if created:
        subprocess.run([docker, 'rm', '-f', name], check=True, capture_output=True, timeout=30)
