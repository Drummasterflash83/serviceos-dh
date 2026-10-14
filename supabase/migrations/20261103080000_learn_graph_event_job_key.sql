-- One graph.enriched receipt per graph job lets a retry confirm a lost event
-- response without appending duplicate downstream evidence. Historical unkeyed
-- graph events remain unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if to_regclass('public.learn_graph_enriched_job_uk') is not null
 then raise exception 'graph_event_job_key_index_exists';end if;
 if exists(select 1 from public.graph_events
  where event_type='graph.enriched' and source_event_id is not null
  group by tenant_id,source_event_id having count(*)>1)
 then raise exception 'graph_event_job_keys_conflict';end if;
end$$;
create unique index learn_graph_enriched_job_uk on public.graph_events(tenant_id,source_event_id)
 where event_type='graph.enriched' and source_event_id is not null;
commit;
