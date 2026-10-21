-- Run only in an isolated disposable PostgreSQL 17 database, after copying
-- 20261112190000_new_dawn_card_graph_degree_counts.sql to /tmp/card_counts.sql.
\set ON_ERROR_STOP on
do $$begin
 if not exists(select 1 from pg_roles where rolname='service_role') then execute 'create role service_role';end if;
 if not exists(select 1 from pg_roles where rolname='anon') then execute 'create role anon';end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then execute 'create role authenticated';end if;
end $$;
alter role service_role bypassrls;
create table public.graph_nodes(id uuid primary key,tenant_id uuid not null,node_type text not null,source_table text);
create table public.graph_edges(id uuid primary key,tenant_id uuid not null,from_node_id uuid not null,to_node_id uuid not null,status text not null);
create index graph_edges_tenant_from_idx on public.graph_edges(tenant_id,from_node_id);
create index graph_edges_tenant_to_idx on public.graph_edges(tenant_id,to_node_id);
grant usage on schema public to service_role;
grant select on public.graph_nodes,public.graph_edges to service_role;
insert into public.graph_nodes values
 ('00000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','person','people'),
 ('00000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','person','people'),
 ('00000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','person','people'),
 ('00000000-0000-0000-0000-000000000004','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','person','people'),
 ('00000000-0000-0000-0000-000000000005','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','company','companies');
insert into public.graph_edges values
 ('00000000-0000-0000-0000-000000000101','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','active'),
 ('00000000-0000-0000-0000-000000000102','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','active'),
 ('00000000-0000-0000-0000-000000000103','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','inactive'),
 ('00000000-0000-0000-0000-000000000104','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','active');
\i /tmp/card_counts.sql
set role service_role;
do $$declare got bigint[];begin
 select array_agg(edge_count order by node_id) into got
 from public.learn_customer_card_relationship_counts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   array['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003']::uuid[]);
 if got is distinct from array[4,2,0]::bigint[] then raise exception 'degree semantics changed: %',got;end if;
end $$;
do $$begin
 perform * from public.learn_customer_card_relationship_counts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   array['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001']::uuid[]);
 raise exception 'duplicate node accepted';
exception when sqlstate '22023' then null;end $$;
do $$begin
 perform * from public.learn_customer_card_relationship_counts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   array['00000000-0000-0000-0000-000000000004']::uuid[]);
 raise exception 'cross-tenant node accepted';
exception when sqlstate '22023' then null;end $$;
do $$begin
 perform * from public.learn_customer_card_relationship_counts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   array['00000000-0000-0000-0000-000000000005']::uuid[]);
 raise exception 'company node accepted';
exception when sqlstate '22023' then null;end $$;
do $$begin
 perform * from public.learn_customer_card_relationship_counts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   array(select gen_random_uuid() from generate_series(1,41)));
 raise exception 'oversized batch accepted';
exception when sqlstate '22023' then null;end $$;
reset role;
set role anon;
do $$begin
 perform * from public.learn_customer_card_relationship_counts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   array['00000000-0000-0000-0000-000000000001']::uuid[]);
 raise exception 'anon received graph count';
exception when sqlstate '42501' then null;end $$;
reset role;
\echo 'customer-card graph degree SQL semantics and grants passed'
