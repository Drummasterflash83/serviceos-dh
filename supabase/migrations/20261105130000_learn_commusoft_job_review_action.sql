-- A human review of a retained Commusoft job is OpenFolk work, not a
-- Commusoft appointment or a provider-side job assignment. Never infer a
-- technician from userGroup, businessUnit, or the customer/site relationship.
create function public.learn_commusoft_create_job_review_action(
  p_tenant uuid,p_connection uuid,p_external_id text,p_version uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare source_row record; existing uuid; task_id uuid; actor uuid:=auth.uid();
  job_node uuid; review_at timestamptz:=clock_timestamp();
begin
  if auth.role() is distinct from 'authenticated' or actor is null
    or p_external_id is null or p_external_id!~'^[1-9][0-9]{0,15}$'
    or p_version is null or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
    raise exception 'job_review_request_invalid' using errcode='22023';
  end if;
  perform public.learn_business_input_review_access(p_tenant,p_connection);
  -- One open review task per provider job. A replay returns the same task;
  -- closed historical reviews are retained and a later review is new work.
  perform pg_advisory_xact_lock(hashtextextended(
    'learn-commusoft-job-review:'||p_tenant::text||':'||p_connection::text||':'||p_external_id,0));
  select * into source_row from public.learn_commusoft_source_job_rows(p_tenant,p_connection)
    where external_id=p_external_id;
  if not found or source_row.version_id is distinct from p_version
    or source_row.source_status not in ('Open','ongoing','pending','on_hold') then
    raise exception 'job_review_source_changed' using errcode='PT409';
  end if;
  select id into existing from public.intelligence_objects
    where tenant_id=p_tenant and object_class='action'
      and attributes->>'action_type'='openfolk_commusoft_job_review'
      and attributes->>'source_connection_id'=p_connection::text
      and attributes->>'job_external_id'=p_external_id
      and status not in ('complete','cancelled','dismissed')
    order by created_at desc limit 1;
  if existing is not null then
    if (select attributes->>'source_version_id' from public.intelligence_objects where id=existing)
       is distinct from p_version::text then
      raise exception 'job_review_existing_source_changed' using errcode='PT409';
    end if;
    return jsonb_build_object('id',existing,'created',false,'source_version_id',
      (select attributes->>'source_version_id' from public.intelligence_objects where id=existing));
  end if;
  if source_row.reviewed_job_id is not null then
    select id into job_node from public.graph_nodes
      where tenant_id=p_tenant and node_type='job' and source_table='jobs'
        and source_id=source_row.reviewed_job_id limit 1;
  end if;
  insert into public.intelligence_objects(tenant_id,domain,object_type,object_class,
    subject,status,evidence,source_entities,created_by,created_from,attributes)
  values(p_tenant,'serviceos','Action','action',
    'Review captured Commusoft job '||p_external_id,'ready',
    jsonb_build_array(jsonb_build_object('source','commusoft_retained_job',
      'connection_id',p_connection,'external_id',p_external_id,
      'source_version_id',p_version,'observed_at',source_row.observed_at,
      'recorded_status',source_row.source_status)),
    case when job_node is null then '{}'::uuid[] else array[job_node] end,
    actor::text,'openfolk.human_source_review',
    jsonb_build_object('action_type','openfolk_commusoft_job_review',
      'source_provider','commusoft','source_connection_id',p_connection,
      'source_version_id',p_version,'job_external_id',p_external_id,
      'job_id',source_row.reviewed_job_id,
      'source_observed_at',source_row.observed_at,'recorded_source_status',source_row.source_status,
      'outcome','Review retained job source and resolve the source or identity gap',
      'recommended_action','Open the original Commusoft job evidence and record the reviewed outcome',
      'done_when','The source version, current provider status, and customer/job relationship have been reviewed and the outcome recorded',
      'review_only',true)) returning id into task_id;
  insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,
    resource_id,after,reason,view_as_active,source)
  values(p_tenant,actor::text,'learn.job_review_action.create','intelligence_object',task_id::text,
    jsonb_build_object('source_version_id',p_version,'connection_id',p_connection,
      'job_external_id',p_external_id,'source_observed_at',source_row.observed_at,
      'recorded_status',source_row.source_status,'created_at',review_at),
    p_reason,false,'openfolk-job-source-review');
  return jsonb_build_object('id',task_id,'created',true,'source_version_id',p_version);
end $$;
revoke all on function public.learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)
  to authenticated;
