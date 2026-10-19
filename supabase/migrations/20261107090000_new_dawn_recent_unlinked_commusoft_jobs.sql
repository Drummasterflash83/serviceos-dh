-- Operator-only entry point to recent retained Commusoft jobs awaiting review.
-- It reads saved evidence; it does not link identities or request the provider.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.new_dawn_recent_unlinked_commusoft_jobs(
 p_tenant uuid,p_connection uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog set statement_timeout='15s' as $$
declare actor uuid:=auth.uid();window_start timestamptz:=clock_timestamp()-interval '24 hours';
 checked timestamptz;audit uuid:=gen_random_uuid();unlinked_count integer;
 newest_source timestamptz;latest_page timestamptz;entries jsonb;
begin
 if actor is null or p_tenant is null or p_connection is null
  or auth.role() is distinct from 'authenticated'
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'recent_unlinked_request_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,false);
 -- An OpenFolk read uses platform authority, not a client's import role.
 -- Match the retained source-review availability checks without entering its
 -- write-capable operator review context or impersonating tenant staff.
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='learn.enabled' and value='true'::jsonb for share;
 if not found then raise exception 'recent_unlinked_module_unavailable' using errcode='42501';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='learn.inputs.commusoft.enabled' and value='true'::jsonb for share;
 if not found then raise exception 'recent_unlinked_module_unavailable' using errcode='42501';end if;
 perform 1 from public.tenant_connectors where tenant_id=p_tenant
  and provider='commusoft' and connector_id='commusoft'
  and enabled and status='active' for share;
 if not found then raise exception 'recent_unlinked_connector_unavailable' using errcode='42501';end if;
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=p_connection
  and provider='commusoft' and status='configured' and revoked_at is null
  and verified_at<=clock_timestamp() for share;
 if not found then raise exception 'recent_unlinked_connection_unavailable' using errcode='42501';end if;
 with source_rows as materialized (
  select external_id,version_id,observed_at,source_status,
   relationship_state,customer_identity_state,reviewed_job_id
  from public.learn_commusoft_source_job_rows(p_tenant,p_connection)
 ), recent as materialized (
  select * from source_rows where observed_at>=window_start and reviewed_job_id is null
 ), page as (
  select * from recent order by observed_at desc,external_id collate "C" desc limit 25
 )
 select (select count(*)::integer from recent),
  (select max(observed_at) from source_rows),
  coalesce((select jsonb_agg(jsonb_build_object(
   'external_id',external_id,'version_id',version_id,'source_observed_at',observed_at,
   'source_status',source_status,'relationship_state',relationship_state,
   'customer_identity_state',customer_identity_state)
   order by observed_at desc,external_id collate "C" desc) from page),'[]'::jsonb)
 into unlinked_count,newest_source,entries;
 select max(committed_at) into latest_page from public.learn_business_input_pages
  where tenant_id=p_tenant and connection_id=p_connection
   and provider='commusoft' and collection='jobs';
 perform public.learn_operator_input_access(p_tenant,actor,false);
 checked:=clock_timestamp();
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'client_jobs.recent_unlinked_source_review',
  'jobs',p_connection::text,jsonb_build_object(
   'unlinked_count',unlinked_count,'returned_count',jsonb_array_length(entries),
   'window_start',window_start,'latest_source_observed_at',newest_source,
   'latest_checkpoint_at',latest_page),
  btrim(p_reason),audit::text,false,'new-dawn-recent-unlinked-jobs');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-recent-unlinked-jobs/1',
  'tenant_id',p_tenant,'connection_id',p_connection,'actor_id',actor,
  'audit_id',audit,'observed_at',checked,'window_start',window_start,
  'unlinked_count',unlinked_count,'latest_source_observed_at',newest_source,
  'latest_checkpoint_at',latest_page,'rows',entries);
end $$;
revoke all on function public.new_dawn_recent_unlinked_commusoft_jobs(uuid,uuid,text)
 from public,anon,service_role;
grant execute on function public.new_dawn_recent_unlinked_commusoft_jobs(uuid,uuid,text)
 to authenticated;
commit;
