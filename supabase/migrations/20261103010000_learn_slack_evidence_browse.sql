-- Read committed, unassigned company observations using the existing public-source
-- reader for every result. No capture, attribution, provider or worker changes.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
create index learn_slack_evidence_receipt_page on public.learn_observation_receipts(tenant_id,observation_id);
create function public.learn_slack_evidence_read(p_tenant uuid,p_after uuid default null,p_operator_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();operator_mode boolean:=p_operator_reason is not null;
 row record;source jsonb;entries jsonb:='[]';last_id uuid;next_id uuid;audit uuid;scanned int:=0;
begin
 if auth.role() is distinct from 'authenticated' or actor is null or p_tenant is null then
  raise exception 'slack_evidence_forbidden' using errcode='42501';end if;
 if operator_mode then
  perform public.learn_operator_input_access(p_tenant,actor,true);
  if length(btrim(p_operator_reason)) not between 3 and 500 then raise exception 'slack_evidence_reason_invalid' using errcode='22023';end if;
 else perform public.learn_import_batch_authority(p_tenant,actor);end if;
 -- UUID keyset ordering is stable, not a claim that the page is chronological.
 -- A bounded scan can return an empty page WITH a continuation, never complete
 -- coverage by silently discarding inaccessible or changed candidates.
 for row in
  select o.id,o.subject,o.created_at,i.id interaction_id,i.source_id,
   o.attributes#>>'{retained_source_context,source_version}' source_version
  from public.learn_observation_receipts r
  join public.intelligence_objects o on o.id=r.observation_id and o.tenant_id=r.tenant_id
  join public.interactions i on i.id=r.interaction_id and i.tenant_id=r.tenant_id
  join public.intelligence_ingestions g on g.tenant_id=r.tenant_id and g.interaction_id=i.id
   and g.observe_job_id=r.job_id and g.observation_id=o.id and g.status='observed' and g.mapper_version='obs-ingest/2'
  where r.tenant_id=p_tenant and (p_after is null or o.id>p_after)
   and o.object_class='observation' and o.object_type='Observation' and o.created_from='intelligence.ingest_interaction'
   and o.source_interactions=array[i.id] and i.source_table='slack_messages' and i.source_connector_id='slack'
   and i.source_type='chat' and i.interaction_type='slack_message' and coalesce(i.status,'') not in('deleted','removed')
   and i.related_person_id is null and i.related_company_id is null and i.related_job_id is null
   and o.attributes#>>'{retained_source_context,version}'='learn-retained-source-context/1'
   and o.attributes#>>'{retained_source_context,scope}'='company_source'
   and o.attributes#>>'{retained_source_context,attribution}'='unresolved'
   and o.attributes#>>'{retained_source_context,tenant_id}'=p_tenant::text
   and o.attributes#>>'{retained_source_context,interaction_id}'=i.id::text
   and o.attributes#>>'{retained_source_context,source_id}'=i.source_id::text
   and o.attributes#>>'{retained_source_context,source_version}'=i.metadata->>'source_version'
   and r.receipt->>'version'='learn-observation-delivery/1' and r.receipt->>'state'='committed'
   and r.receipt->>'tenant_id'=p_tenant::text and r.receipt->>'interaction_id'=i.id::text
   and r.receipt->>'observation_id'=o.id::text and r.receipt->>'job_id'=r.job_id::text
   and r.receipt->'can_execute'='false'::jsonb and r.receipt->'action_ids'='[]'::jsonb
  order by o.id limit 51
 loop
  if scanned=50 or jsonb_array_length(entries)=25 then next_id:=last_id;exit;end if;
  scanned:=scanned+1;last_id:=row.id;
  begin
   -- Reuses its exact current-revision public-channel proof, connection lock,
   -- tenant/role/View-As checks and logged operator source access.
   source:=public.learn_slack_card_source_read(p_tenant,row.source_id,p_operator_reason)->'record';
  exception when insufficient_privilege then continue;
  end;
  if source->>'source_version' is distinct from row.source_version then continue;end if;
  entries:=entries||jsonb_build_array(jsonb_build_object('id',row.id,'interaction_id',row.interaction_id,
   'source_id',row.source_id,'source_version',row.source_version,'recorded_at',row.created_at,
   'posted_at',source->>'posted_at','channel_id',source->>'channel_id',
   'summary',left(row.subject,240),'excerpt',left(source->>'message_text',320),'attribution','unresolved'));
 end loop;
 if operator_mode then
  perform public.learn_operator_input_access(p_tenant,actor,true);audit:=gen_random_uuid();
  insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
  values(audit,p_tenant,actor::text,'slack_evidence.read','intelligence_objects',p_tenant::text,
   jsonb_build_object('record_ids',(select coalesce(jsonb_agg(e->'id'),'[]') from jsonb_array_elements(entries)e),'after',p_after),
   btrim(p_operator_reason),audit::text,false,'learn-slack-evidence');
 else perform public.learn_import_batch_authority(p_tenant,actor);end if;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','learn-slack-evidence/1','tenant_id',p_tenant,'actor_id',actor,
  'after',p_after,'rows',entries,'next_after',next_id,'scanned',scanned,'observed_at',clock_timestamp(),
  'operator_mode',operator_mode,'audit_id',audit);
end$$;
revoke all on function public.learn_slack_evidence_read(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_evidence_read(uuid,uuid,text) to authenticated;
commit;
