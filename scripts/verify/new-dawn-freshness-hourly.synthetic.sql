-- Isolated PostgreSQL fixture for the hourly freshness migration. Run in a
-- disposable database; no network request, provider credential or LIVE row.
create schema auth;
create schema vault;
create function auth.role() returns text language sql stable as $$
 select current_setting('test.role',true) $$;
create table public.tenants(id uuid primary key,status text);
create table public.provider_connections(
 id uuid primary key,tenant_id uuid,provider text,status text,auth_mode text,
 revoked_at timestamptz,verified_at timestamptz,non_secret_config jsonb,
 secret_refs jsonb,updated_at timestamptz
);
create table public.feature_flags(tenant_id uuid,flag text,value jsonb);
create table public.learn_business_input_versions(
 tenant_id uuid,connection_id uuid,provider text,collection text,
 external_id text,payload jsonb
);
create table vault.decrypted_secrets(id uuid,name text,decrypted_secret text);
create table public.new_dawn_commusoft_freshness_runs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid,check_day date,
 run_number integer not null default 1,
 connection_id uuid,connection_revision timestamptz,secret_id uuid,
 saved_id text,saved_created_at text,state text not null default 'collecting',
 failure_count integer not null default 0,claimed_at timestamptz,
 next_attempt_at timestamptz,page_count integer not null default 0,
 cursor_id bigint,claim_token uuid,checked_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 constraint new_dawn_commusoft_freshness_runs_run_number_check
  check(run_number between 1 and 8),
 unique(tenant_id,check_day,run_number)
);
create function public.learn_commusoft_shared_lease_acquire(text,text,text)
 returns jsonb language sql as $$select '{"state":"ready"}'::jsonb$$;
create function public.new_dawn_commusoft_freshness_current(uuid,uuid)
 returns boolean language sql as $$select true$$;

insert into public.tenants values
 ('11111111-1111-4111-8111-111111111111','active');
insert into public.provider_connections values
 ('22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111','commusoft','configured',
  'private_api_key',null,clock_timestamp(),'{"region":"uk"}',
  '{"api_key":"77777777-7777-4777-8777-777777777777"}',clock_timestamp());
insert into public.feature_flags values
 ('11111111-1111-4111-8111-111111111111','new_dawn.commusoft_freshness','true'),
 ('11111111-1111-4111-8111-111111111111','learn.enabled','true'),
 ('11111111-1111-4111-8111-111111111111','learn.inputs.commusoft.enabled','true');
insert into vault.decrypted_secrets values
 ('77777777-7777-4777-8777-777777777777',
  'provider_secret:11111111-1111-4111-8111-111111111111:commusoft:api_key',
  'synthetic-local-key');
insert into public.learn_business_input_versions values
 ('11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'commusoft','jobs','13446','{"id":13446,"createdOnDateTime":"2026-10-20T09:00:00Z"}');
insert into public.new_dawn_commusoft_freshness_runs
 (tenant_id,check_day,run_number,connection_id,connection_revision,secret_id,
  saved_id,saved_created_at,state,checked_at)
select '11111111-1111-4111-8111-111111111111',
 (clock_timestamp() at time zone 'Europe/London')::date,1,
 c.id,c.updated_at,'77777777-7777-4777-8777-777777777777',
 '13446','2026-10-20T09:00:00Z','complete',clock_timestamp()-interval '2 hours'
from public.provider_connections c;

-- Apply 20261110230000_new_dawn_hourly_commusoft_freshness.sql here.
-- The assertions below are kept in a separate file so the fixture can be
-- loaded before the migration under test.
