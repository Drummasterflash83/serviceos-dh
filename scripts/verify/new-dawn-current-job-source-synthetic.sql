-- Disposable PostgreSQL bootstrap for the exact current-source migration.
-- Synthetic IDs and status rows only; no production data or network input.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
 $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
create function auth.role() returns text language sql stable as
 $$select 'authenticated'::text$$;
create table auth.users (
 id uuid primary key, deleted_at timestamptz, banned_until timestamptz
);
create table public.tenants (id uuid primary key,status text not null);
create table public.profiles (
 id uuid primary key,tenant_id uuid not null,role text not null
);
create table public.view_as_context (
 actor_user_id uuid,ended_at timestamptz,expires_at timestamptz
);
create table public.platform_authority_grants (
 profile_id uuid,permission text,effective_from timestamptz,effective_to timestamptz
);
create table public.feature_flags (
 tenant_id uuid,flag text,value jsonb,primary key(tenant_id,flag)
);
create table public.learn_business_input_pages (
 id uuid primary key,tenant_id uuid not null,connection_id uuid not null,
 provider text not null,collection text not null,committed_at timestamptz not null
);
create table public.learn_business_input_versions (
 id uuid primary key,tenant_id uuid not null,connection_id uuid not null,
 provider text not null,collection text not null,external_id text not null,
 payload jsonb not null
);
create table public.learn_business_input_observations (
 page_id uuid not null references public.learn_business_input_pages(id),
 version_id uuid not null references public.learn_business_input_versions(id),
 ordinal integer not null,primary key(page_id,ordinal)
);
create table public.jobs (id uuid primary key,tenant_id uuid not null,metadata jsonb);
create view public.learn_business_input_current_links as
 select null::uuid tenant_id,null::uuid connection_id,null::text provider,
  null::text collection,null::text external_id,null::text entity_kind,
  null::text entity_table,null::uuid entity_id,null::uuid source_version_id
 where false;
create table public.controlplane_change_log (
 id uuid,tenant_id uuid,actor text,action text,resource_type text,
 resource_id text,after jsonb,reason text,correlation_id text,
 view_as_active boolean,source text
);
create function public.learn_operator_input_access(uuid,uuid,boolean)
 returns void language plpgsql as $$begin null;end$$;

insert into auth.users(id) values('11111111-1111-4111-8111-111111111111');
insert into public.tenants values
 ('00000000-0000-0000-0000-000000000001','active'),
 ('00000000-0000-0000-0000-000000000002','active');
insert into public.profiles values
 ('11111111-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000001','owner');
insert into public.feature_flags values
 ('00000000-0000-0000-0000-000000000001',
  'new_dawn.open_job_page','true');

-- 101 moves from Open to On hold. 103 has two distinct latest versions at
-- the same timestamp and must be withheld. 104 is closed. 201 is another
-- tenant and must never be counted for tenant 1.
insert into public.learn_business_input_pages values
 ('30000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','2026-10-01'),
 ('30000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','2026-10-02'),
 ('30000000-0000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','2026-10-02'),
 ('30000000-0000-4000-8000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','2026-10-02'),
 ('30000000-0000-4000-8000-000000000005',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','2026-10-02'),
 ('30000000-0000-4000-8000-000000000006',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000200','commusoft','jobs','2026-10-02');
insert into public.learn_business_input_versions values
 ('20000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','101',
  '{"id":101,"status":"Open"}'),
 ('20000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','101',
  '{"id":101,"status":"on_hold"}'),
 ('20000000-0000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','103',
  '{"id":103,"status":"Open"}'),
 ('20000000-0000-4000-8000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','103',
  '{"id":103,"status":"pending"}'),
 ('20000000-0000-4000-8000-000000000005',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','104',
  '{"id":104,"status":"complete"}'),
 ('20000000-0000-4000-8000-000000000006',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000200','commusoft','jobs','201',
  '{"id":201,"status":"Open"}');
insert into public.learn_business_input_observations values
 ('30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',1),
 ('30000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002',1),
 ('30000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000003',1),
 ('30000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000004',1),
 ('30000000-0000-4000-8000-000000000005',
  '20000000-0000-4000-8000-000000000005',1),
 ('30000000-0000-4000-8000-000000000006',
  '20000000-0000-4000-8000-000000000006',1);
