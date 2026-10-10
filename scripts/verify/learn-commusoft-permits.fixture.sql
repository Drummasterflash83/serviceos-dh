-- Disposable synthetic database only; never run against TEST or production.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema vault;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
grant usage on schema auth to service_role,authenticated;
create table tenants(id uuid primary key,status text);
create table feature_flags(id uuid primary key,tenant_id uuid,flag text,value jsonb,unique(tenant_id,flag));
create table platform_jobs(id uuid primary key,tenant_id uuid,job_type text,status text,payload jsonb,claimed_by text,attempt_count integer,lease_expires_at timestamptz);
create table tenant_connectors(id uuid primary key,tenant_id uuid,connector_id text,provider text,enabled boolean,status text);
create table connector_accounts(id uuid primary key,tenant_id uuid,tenant_connector_id uuid,account_key text,status text,settings jsonb,sync_cursor jsonb);
create table provider_connections(id uuid primary key,tenant_id uuid,provider text,status text,auth_mode text,revoked_at timestamptz,verified_at timestamptz,updated_at timestamptz,non_secret_config jsonb,configured_fields text[],secret_refs jsonb);
create table vault.decrypted_secrets(id uuid primary key,name text,decrypted_secret text);
create function public.fixture_id(n integer) returns uuid language sql immutable as $$ select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
insert into tenants values(fixture_id(1),'active');
insert into feature_flags values(fixture_id(10),fixture_id(1),'learn.enabled','true'),(fixture_id(11),fixture_id(1),'learn.inputs.commusoft.enabled','true');
insert into platform_jobs values(fixture_id(2),fixture_id(1),'commusoft.source_sync','running',jsonb_build_object('connector_account_id',fixture_id(3)),'fixture-worker',1,clock_timestamp()+interval '1 hour');
insert into tenant_connectors values(fixture_id(4),fixture_id(1),'commusoft','commusoft',true,'active');
insert into connector_accounts values(fixture_id(3),fixture_id(1),fixture_id(4),'fixture-account','active',jsonb_build_object('commusoft_import',
  jsonb_build_object('approved',true,'approvalId',fixture_id(6),'connectionId',fixture_id(5),'consentReference','fixture-only',
    'expiresAt',clock_timestamp()+interval '1 day','maxPages',50,'pageSize',100,'resource','properties')),'{}');
insert into provider_connections values(fixture_id(5),fixture_id(1),'commusoft','configured','private_api_key',null,clock_timestamp(),clock_timestamp(),
  '{"region":"uk","account_key":"fixture-account"}',array['api_key'],jsonb_build_object('api_key',fixture_id(7)));
insert into vault.decrypted_secrets values(fixture_id(7),'provider_secret:'||fixture_id(1)||':commusoft:api_key','synthetic-commusoft-test-only');
create function public.fixture_expected(p_job uuid default public.fixture_id(2)) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('tenantId',a.tenant_id,'jobId',p_job,'accountId',a.id,'connectorId',a.tenant_connector_id,'connectionId',c.id,
    'connectionRevision',c.updated_at,'secretId',c.secret_refs->>'api_key','approval',a.settings->'commusoft_import','checkpoint',a.sync_cursor,
    'pages',0,'complete',false,'request',jsonb_build_object('region','uk','resource','properties','after',null,'limit',100))
  from public.connector_accounts a join public.provider_connections c on c.tenant_id=a.tenant_id;
$$;
set check_function_bodies=off;
create function public.fixture_acquire(p_expected jsonb default public.fixture_expected(),p_job uuid default public.fixture_id(2)) returns jsonb language sql as $$
  select public.learn_commusoft_acquire_page(public.fixture_id(1),p_job,'fixture-worker',1,p_expected);
$$;
reset check_function_bodies;
-- The SQL function above is parsed at first call (migration follows fixture).
