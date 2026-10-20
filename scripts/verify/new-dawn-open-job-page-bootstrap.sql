create schema auth;
create table public.learn_business_input_pages (
 id uuid,tenant_id uuid,provider text,collection text,connection_id uuid,
 committed_at timestamptz
);
create table public.learn_business_input_versions (
 id uuid,payload jsonb
);
set check_function_bodies=off;
