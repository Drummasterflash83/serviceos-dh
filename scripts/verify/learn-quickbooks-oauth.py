"""Isolated real-Postgres verification; synthetic Vault contract, no host mounts/network."""
from pathlib import Path
import concurrent.futures
import os
import shutil
import subprocess
import time
import uuid

root = Path(__file__).resolve().parents[2]
docker = shutil.which('docker') or '/usr/local/bin/docker'
name = 'serviceos-quickbooks-oauth-' + uuid.uuid4().hex[:8]
created = False

def sql(statement):
    result = subprocess.run([docker, 'exec', '-i', name, 'psql', '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                            input=statement, text=True, capture_output=True, timeout=40)
    if result.returncode:
        raise RuntimeError(result.stderr[-3000:])
    if 'f' in result.stdout.splitlines():
        raise RuntimeError('Synthetic SQL boolean assertion returned false')
    return result.stdout.strip()

def source(path):
    return (root / path).read_text()

try:
    subprocess.run([docker, 'run', '-d', '--pull=never', '--network', 'none', '--name', name,
                    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:15'], check=True, capture_output=True, timeout=30)
    created = True
    for _ in range(80):
        if subprocess.run([docker, 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0:
            break
        time.sleep(.25)
    else:
        raise RuntimeError('Synthetic database unavailable')
    sql(source('scripts/verify/learn-quickbooks-oauth.fixture.sql'))
    resolver = source('supabase/migrations/20260822120000_platform_authority_decoupled_from_role.sql')
    sql(resolver[resolver.index('create or replace function current_user_is_openfolk_operator('):resolver.index('-- ── Governed record')])
    operator = source('supabase/migrations/20261031160000_learn_operator_inputs.sql')
    sql(operator[operator.index('create function public.learn_operator_input_immutable()'):operator.index('create trigger learn_operator_input_immutable')])
    sql(operator[operator.index('create function public.learn_operator_input_access('):operator.index('-- Explicit booleans only.')])
    sql(source('supabase/migrations/20260810120000_provider_secret_broker.sql'))
    migration = source('supabase/migrations/20261102000000_learn_quickbooks_oauth.sql')
    sql(migration.replace('\ncommit;', '\nrollback;'))
    assert sql("select to_regclass('learn_quickbooks_apps') is null") == 't'
    sql(migration)
    sql(source('scripts/verify/learn-quickbooks-oauth.assert.sql'))
    print('PASS: rollback, permissions, tenant binding, replay, company confirmation, pause, revoked/banned actors, expiry and atomic refresh.')
    sql("set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000010';set role authenticated;select learn_quickbooks_begin(fixture_id(1),fixture_id(32),fixture_id(20),fixture_id(43),repeat('d',64),'Concurrent callback');")
    def claim(_):
        try:
            sql("set request.jwt.claim.role='service_role';set role service_role;select learn_quickbooks_claim(repeat('d',64));")
            return 'claimed'
        except RuntimeError as e:
            if 'quickbooks_authorization_invalid' not in str(e):
                raise
            return 'denied'
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(claim, range(2))) == ['claimed', 'denied']
    print('PASS: racing callbacks release credentials exactly once.')
    subprocess.run(['node', str(root / 'scripts/verify/learn-quickbooks-oauth-flow.mjs')], check=True,
                   env={**os.environ, 'SERVICEOS_QB_TEST_CONTAINER': name, 'SERVICEOS_QB_TEST_DOCKER': docker}, timeout=40)
    ingestion = source('supabase/migrations/20261102010000_learn_quickbooks_import.sql')
    sql(ingestion.replace('\ncommit;', '\nrollback;'))
    assert sql("select to_regclass('learn_quickbooks_imports') is null") == 't'
    sql(ingestion)
    sql(source('scripts/verify/learn-quickbooks-import.assert.sql'))
    print('PASS: durable imports, exact financial decimals, replay recovery, version deduplication, module fence and realm-wide throttling.')
    subprocess.run(['node', str(root / 'scripts/verify/learn-quickbooks-import-flow.mjs')], check=True,
                   env={**os.environ, 'SERVICEOS_QB_TEST_CONTAINER': name, 'SERVICEOS_QB_TEST_DOCKER': docker}, timeout=60)
    sql("alter table profiles add column tenant_id uuid,add column role text;create table customer_cards(id uuid primary key,tenant_id uuid not null);")
    authority = source('supabase/migrations/20261031080000_learn_import_batches.sql')
    sql(authority[authority.index('create function learn_import_batch_authority('):authority.index('create function learn_import_match_batch(')])
    finance = source('supabase/migrations/20261102020000_learn_quickbooks_customer_finance.sql')
    sql(finance.replace('\ncommit;', '\nrollback;'))
    assert sql("select to_regclass('learn_quickbooks_customer_links') is null") == 't'
    sql(finance)
    sql(source('scripts/verify/learn-quickbooks-finance.assert.sql'))
    print('PASS: reviewed customer links, identity drift, currency-separated exact totals, conflict exclusions, tenant/role fences and retained finance audit.')
    retained_finance = source('supabase/migrations/20261102040000_learn_quickbooks_retained_finance.sql')
    sql(retained_finance.replace('\ncommit;', '\nrollback;'))
    assert sql("select to_regprocedure('learn_quickbooks_retained_finance_access(uuid,text)') is null") == 't'
    sql(retained_finance)
    sql(source('scripts/verify/learn-quickbooks-retained-finance.assert.sql'))
    print('PASS: paused intake preserves authorised finance reads; master switch, link-write fence, tenant/role/banned-user checks and source history preserved.')
    sql(source('supabase/migrations/20261102200000_learn_quickbooks_customer_search.sql'))
    sql(source('scripts/verify/learn-quickbooks-customer-search.assert.sql'))
    print('PASS: bounded retained-customer search, literal filters, pagination, role and tenant isolation, no link mutation.')
    # Export is an operations query, not a new RPC/grant. Verify real SQL scope,
    # exact decimals and credential exclusion against the retained fixture.
    sql("reset role;insert into learn_quickbooks_source_versions(tenant_id,environment,realm_id,entity,external_id,content_hash,payload,sync_token) values(fixture_id(2),'production','other-realm','Customer','other','other-hash','{\"Id\":\"other\",\"DisplayName\":\"OTHER_TENANT_EXPORT_SENTINEL\"}',0);")
    export_sql = subprocess.run(['node', str(root / 'scripts/operations/quickbooks-export-query.mjs'),
                                 '00000000-0000-4000-8000-000000000001', 'production'],
                                check=True, capture_output=True, text=True, timeout=10).stdout
    exported = sql(export_sql)
    import json
    lines = [json.loads(line) for line in exported.splitlines()]
    assert lines[0]['kind'] == 'manifest'
    assert lines[0]['environment'] == 'production'
    versions = [row['data'] for row in lines if row['kind'] == 'source_version']
    assert versions and all(row['tenant_id'] == '00000000-0000-4000-8000-000000000001' and row['environment'] == 'production' for row in versions)
    assert any('9007199254740993.01' in row['payload_text'] for row in versions)
    assert 'OTHER_TENANT_EXPORT_SENTINEL' not in exported
    assert all(key not in exported for key in ['synthetic-access', 'synthetic-refresh', 'token_secret_id', 'state_hash', 'token_digest'])
    assert any(row['kind'] == 'customer_link' for row in lines)
    sandbox_sql = export_sql.replace("'production'", "'sandbox'")
    sandbox_lines = [json.loads(line) for line in sql(sandbox_sql).splitlines()]
    assert any(row['kind'] == 'page' for row in sandbox_lines)
    assert any(row['kind'] == 'observation' for row in sandbox_lines)
    print('PASS: tenant/environment-isolated read-only export, history, exact financial decimals and no credentials.')
    disconnect = source('supabase/migrations/20261102030000_learn_quickbooks_disconnect.sql')
    sql(disconnect.replace('\ncommit;', '\nrollback;'))
    assert sql("select to_regclass('learn_quickbooks_disconnections') is null") == 't'
    sql(disconnect)
    subprocess.run(['node', str(root / 'scripts/verify/learn-quickbooks-disconnect-flow.mjs')], check=True,
                   env={**os.environ, 'SERVICEOS_QB_TEST_CONTAINER': name, 'SERVICEOS_QB_TEST_DOCKER': docker}, timeout=60)
    def disconnect_claim(_):
        return sql("set request.jwt.claim.role='service_role';set role service_role;select learn_quickbooks_disconnect_acquire(fixture_id(854))->>'state';")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(disconnect_claim, range(2))) == ['ready', 'revoking']
    sql("update platform_authority_grants set effective_to=clock_timestamp();set request.jwt.claim.role='service_role';set role service_role;select fixture_denied('select learn_quickbooks_disconnect_acquire(fixture_id(854))');")
    print('PASS: racing disconnect workers release credentials once; ended operator grants deny subsequent access.')
finally:
    if created:
        subprocess.run([docker, 'rm', '-fv', name], check=True, capture_output=True, timeout=30)
