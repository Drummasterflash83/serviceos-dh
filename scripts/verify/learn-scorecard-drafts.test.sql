-- Isolated PostgreSQL fixture only. Do not run on a ServiceOS database.
create role anon;
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
create table profiles(id uuid primary key,tenant_id uuid,role text);
create function current_tenant_id() returns uuid language sql security definer as $$ select tenant_id from profiles where id=auth.uid() $$;
create function current_user_role() returns text language sql security definer as $$ select role from profiles where id=auth.uid() $$;
create table org_units(id uuid primary key,tenant_id uuid,name text);
create table config_versions(id uuid primary key,tenant_id uuid,artifact_kind text,artifact_key text,version int,status text,supersedes uuid references config_versions(id),author text,note text,created_at timestamptz default now());
create unique index config_versions_published_uk on config_versions(artifact_kind,artifact_key) where status='published';
create table operating_profile_entries(id uuid primary key default gen_random_uuid(),tenant_id uuid,scope_kind text,scope_ref text,namespace text,key text,value jsonb,version_id uuid references config_versions(id),created_at timestamptz default now());
create unique index ope_natural_uk on operating_profile_entries(tenant_id,scope_kind,coalesce(scope_ref,''),namespace,key);
insert into profiles values
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','owner'),
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000010','viewer');
insert into org_units values('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000099','Other company');
-- Migration is injected here by the test runner, followed by the assertions file.
