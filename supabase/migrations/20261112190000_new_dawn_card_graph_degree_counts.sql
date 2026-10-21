-- Customer-card graph degree: bounded, tenant-scoped, index-backed read.
-- Install before the corresponding Edge source. No graph/card rows are changed.
begin;
create function public.learn_customer_card_relationship_counts(p_tenant uuid,p_node_ids uuid[])
returns table(node_id uuid,edge_count bigint)
language plpgsql stable security invoker set search_path=pg_catalog as $$
begin
  if current_user<>'service_role' then
    raise exception 'card_graph_count_forbidden' using errcode='42501';
  end if;
  if p_tenant is null or p_node_ids is null or cardinality(p_node_ids) not between 1 and 40
    or array_position(p_node_ids,null) is not null
    or (select count(distinct u.node_id) from unnest(p_node_ids) as u(node_id))<>cardinality(p_node_ids) then
    raise exception 'card_graph_count_scope_invalid' using errcode='22023';
  end if;
  -- The caller already selected these person/people nodes for this tenant.
  -- Recheck here so another tenant's or synthetic graph node cannot be read.
  if (select count(*) from public.graph_nodes n
      where n.tenant_id=p_tenant and n.id=any(p_node_ids)
        and n.node_type='person' and n.source_table='people')<>cardinality(p_node_ids) then
    raise exception 'card_graph_count_nodes_invalid' using errcode='22023';
  end if;
  return query
    select n.id, f.c + t.c
    from unnest(p_node_ids) as n(id)
    cross join lateral (
      select count(*) as c from public.graph_edges e
      where e.tenant_id=p_tenant and e.from_node_id=n.id
    ) f
    cross join lateral (
      select count(*) as c from public.graph_edges e
      where e.tenant_id=p_tenant and e.to_node_id=n.id
    ) t;
end $$;
revoke all on function public.learn_customer_card_relationship_counts(uuid,uuid[])
  from public,anon,authenticated;
grant execute on function public.learn_customer_card_relationship_counts(uuid,uuid[])
  to service_role;
commit;
