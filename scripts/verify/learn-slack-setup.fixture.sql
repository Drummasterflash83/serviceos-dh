-- Additional isolated fixture, after the history-storage assertions.
create table profiles(id uuid primary key,tenant_id uuid,role text);
create table view_as_context(actor_user_id uuid,ended_at timestamptz,expires_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
create or replace function current_tenant_id() returns uuid language sql security definer stable as $$ select tenant_id from profiles where id=auth.uid() $$;
create function current_user_role() returns text language sql security definer stable as $$ select role from profiles where id=auth.uid() $$;
alter table provider_connections add updated_at timestamptz default '2026-10-09T10:00:00Z',add configured_fields text[] default '{}',add secret_refs jsonb default '{}';
alter table tenant_connectors alter id set default gen_random_uuid(),add provider text,add category text;
create unique index test_connector_unique on tenant_connectors(tenant_id,connector_id);
alter table connector_accounts alter id set default gen_random_uuid(),alter settings set default '{}',add account_key text,add display_name text;
create unique index test_account_unique on connector_accounts(tenant_connector_id,account_key);
alter table platform_jobs add connector_id text,add job_key text,add max_attempts integer,add available_at timestamptz,add created_by uuid;
create unique index test_active_job on platform_jobs(tenant_id,job_key) where status in ('queued','running','retrying');
