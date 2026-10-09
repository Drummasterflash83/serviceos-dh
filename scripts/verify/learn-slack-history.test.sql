-- Isolated fixture only, never run on a ServiceOS database.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create function auth.role() returns text language sql stable as $$ select current_user::text $$;
grant usage on schema auth to service_role,authenticated;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant',true),'')::uuid $$;
create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now();return new;end $$;
create table tenants(id uuid primary key);
create table platform_jobs(id uuid primary key,tenant_id uuid,job_type text,status text,payload jsonb);
create table tenant_connectors(id uuid primary key,tenant_id uuid,connector_id text,enabled boolean,status text);
create table connector_accounts(id uuid primary key,tenant_id uuid,tenant_connector_id uuid,status text,settings jsonb,sync_cursor jsonb not null default '{}');
-- interactions schema is loaded from the real existing migration by the runner.
