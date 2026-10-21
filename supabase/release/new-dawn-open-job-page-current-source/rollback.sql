-- Roll back only the derived page reader. The projection and retained source
-- history remain available for the already released Home summary and groups.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $rollback$
declare
 signature regprocedure := 'public.new_dawn_open_job_page_base(uuid,text,text,text,integer)'::regprocedure;
 prior text := pg_get_functiondef(signature);
 changed text;
 first_at integer;
 last_at integer;
 replacement text := $query$with latest_time as materialized (
   select v.connection_id,v.external_id,max(pg.committed_at) observed_at
   from public.learn_business_input_versions v
   join public.learn_business_input_observations o on o.version_id=v.id
   join public.learn_business_input_pages pg on pg.id=o.page_id
    and pg.tenant_id=v.tenant_id and pg.connection_id=v.connection_id
    and pg.provider=v.provider and pg.collection=v.collection
   where v.tenant_id=p_tenant and v.provider='commusoft'
    and v.collection='jobs' and pg.committed_at<=anchor
   group by v.connection_id,v.external_id
  ), unique_latest as materialized (
   select t.connection_id,t.external_id,t.observed_at,
    min(v.id::text)::uuid version_id
   from latest_time t
   join public.learn_business_input_versions v
    on v.tenant_id=p_tenant and v.connection_id=t.connection_id
     and v.provider='commusoft' and v.collection='jobs'
     and v.external_id=t.external_id
   join public.learn_business_input_observations o on o.version_id=v.id
   join public.learn_business_input_pages pg on pg.id=o.page_id
    and pg.tenant_id=p_tenant and pg.connection_id=t.connection_id
    and pg.provider='commusoft' and pg.collection='jobs'
    and pg.committed_at=t.observed_at
   group by t.connection_id,t.external_id,t.observed_at
   having count(distinct v.id)=1
  )$query$;
begin
 if encode(sha256(convert_to(prior,'UTF8')),'hex') <>
  '92e1e37fcd0b20a333b209dfb6223c6206121a65e20cd716426faa048aec2e26'
 then raise exception 'open_job_page_current_source_rollback_state_changed'; end if;
 first_at:=strpos(prior,'with current_at_anchor as materialized (');
 last_at:=strpos(prior,', open_source as materialized (');
 if first_at=0 or last_at<=first_at
 then raise exception 'open_job_page_current_source_rollback_marker_changed'; end if;
 changed:=left(prior,first_at-1)||replacement||substr(prior,last_at);
 execute changed;
 if encode(sha256(convert_to(pg_get_functiondef(signature),'UTF8')),'hex') <>
  '408a51b873f52f48ee5acad60d932b8d2c7ee4d1ba20fb0c8e698a6cb26307f8'
 then raise exception 'open_job_page_current_source_rollback_candidate_changed'; end if;
end $rollback$;
commit;
