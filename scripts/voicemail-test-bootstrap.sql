-- Standalone, disposable Postgres only. NEVER run against a real Supabase project.
do $$begin create role anon; exception when duplicate_object then null; end $$;
do $$begin create role authenticated; exception when duplicate_object then null; end $$;
do $$begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
create schema auth;
create schema storage;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
create table public.tenants(id uuid primary key);
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant',true),'')::uuid $$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated,anon;
grant select on storage.objects to authenticated,anon;
-- Simulates a mistakenly broad, unrelated policy. The new restrictive policy must win.
create policy test_broad_read on storage.objects for select to authenticated using(true);
