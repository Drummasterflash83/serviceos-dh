-- Disposable PostgreSQL 17 only. Compare current broad endpoint OR/global-id
-- query with index-backed endpoint counts using synthetic, non-private rows.
\set ON_ERROR_STOP on
create table graph_edges(id uuid primary key,tenant_id uuid not null,from_node_id uuid not null,to_node_id uuid not null);
create index graph_edges_tenant_from_idx on graph_edges(tenant_id,from_node_id);
create index graph_edges_tenant_to_idx on graph_edges(tenant_id,to_node_id);
insert into graph_edges
select md5('edge-'||g)::uuid,'00000000-0000-0000-0000-000000000001'::uuid,
  md5('from-'||g)::uuid,md5('to-'||g)::uuid from generate_series(1,200000) g;
insert into graph_edges
select md5('target-edge-'||g)::uuid,'00000000-0000-0000-0000-000000000001'::uuid,
  md5('target-'||(g%40+1))::uuid,md5('other-'||g)::uuid from generate_series(1,2000) g;
analyze graph_edges;
\echo 'Current broad OR plus global ID order'
explain (analyze,buffers,format text)
select id,from_node_id,to_node_id from graph_edges
where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
  and (from_node_id=any(array(select md5('target-'||g)::uuid from generate_series(1,40) g))
    or to_node_id=any(array(select md5('target-'||g)::uuid from generate_series(1,40) g)))
order by id limit 500;
\echo 'Index-backed outbound count, one target'
explain (analyze,buffers,format text)
select count(*) from graph_edges where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
  and from_node_id=md5('target-1')::uuid;
\echo 'Index-backed inbound count, one target'
explain (analyze,buffers,format text)
select count(*) from graph_edges where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
  and to_node_id=md5('target-1')::uuid;
\echo 'Bounded two-index lateral count for 40 targets'
explain (analyze,buffers,format text)
select n.id,coalesce(f.n,0)+coalesce(t.n,0) as edge_count
from unnest(array(select md5('target-'||g)::uuid from generate_series(1,40) g)) n(id)
cross join lateral (select count(*) n from graph_edges e where e.tenant_id='00000000-0000-0000-0000-000000000001'::uuid and e.from_node_id=n.id) f
cross join lateral (select count(*) n from graph_edges e where e.tenant_id='00000000-0000-0000-0000-000000000001'::uuid and e.to_node_id=n.id) t;
