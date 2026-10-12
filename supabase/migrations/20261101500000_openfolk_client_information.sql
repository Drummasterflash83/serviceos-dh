-- Explicit audited operator reads. No client RLS changes, provider calls or writes
-- to source records. Collection/column choices are server-owned allowlists.
begin;
create function public.openfolk_client_information(
 p_tenant uuid,p_collection text,p_reason text,p_after uuid default null,p_record uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 tab text; cols text[]; body text; result jsonb; entries jsonb; next_id uuid;
 audit_id uuid:=gen_random_uuid(); actor uuid:=auth.uid(); checked timestamptz;
begin
 -- Admin is required for business content, even though this operation only reads.
 perform public.learn_operator_input_access(p_tenant,actor,true);
 if p_reason is null or length(btrim(p_reason)) not between 3 and 500
  or p_collection is null or (p_after is not null and p_record is not null) then
  raise exception 'operator_information_request_invalid' using errcode='22023';end if;
 case p_collection
 when 'customers' then tab:='customer_cards';cols:=array['title','summary','status','priority','person_id','company_id','owner_id','due_at','latest_activity_at','recommended_action','updated_at'];
 when 'contacts' then tab:='people';cols:=array['display_name','first_name','last_name','primary_email','primary_phone','company_id','address_text','postcode','verified','updated_at'];
 when 'companies' then tab:='companies';cols:=array['name','domain','phone','address_text','postcode','verified','updated_at'];
 when 'sites' then tab:='sites';cols:=array['label','source_system','external_id','company_id','person_id','address_text','postcode','verified','updated_at'];
 when 'jobs' then tab:='jobs';cols:=array['title','job_number','description','source_system','external_id','customer_person_id','customer_company_id','site_id','status','priority','value_pennies','created_date','booked_date','completed_date','verified','updated_at'];
 when 'emails' then tab:='email_messages';cols:=array['provider','provider_message_id','provider_thread_id','from_email','from_name','to_emails','cc_emails','subject','snippet','body_text','sent_at','received_at','direction','updated_at'];
 when 'calls' then tab:='phone_calls';cols:=array['provider','provider_call_id','linked_id','direction','from_number','to_number','started_at','duration_seconds','outcome','updated_at'];
 when 'recordings' then tab:='phone_recordings';cols:=array['provider','provider_recording_id','provider_call_id','linked_id','file_size','started_at','duration_seconds','updated_at'];
 when 'transcripts' then tab:='phone_transcripts';cols:=array['recording_id','transcript_text','language','status','model','updated_at'];
 when 'communications' then tab:='interactions';cols:=array['source_connector_id','source_type','source_table','source_id','interaction_type','direction','occurred_at','subject','summary','body_preview','status','processing_status','related_person_id','related_company_id','related_job_id','updated_at'];
 when 'business_sources' then tab:='learn_business_input_versions';cols:=array['provider','collection','external_id','connection_id','content_hash','first_seen_at'];
 else raise exception 'operator_information_collection_invalid' using errcode='22023';end case;
 -- Project explicit columns, never return metadata, raw messages, credentials,
 -- provider recording URLs or Storage paths. Large scalar fields disclose truncation.
 select string_agg(format('%L,to_jsonb(t.%I)',c,c),',') into body from unnest(cols)c;
 if p_collection='business_sources' then
  body:=body||',''source_type'',t.payload->''type'',''source_status'',t.payload->''status'',''property_reference'',coalesce(t.payload->''propertyID'',t.payload->''parentPropertyID''),''description'',t.payload->''description'',''name'',t.payload->''name'',''address_line_1'',t.payload->''addressLine1'',''address_line_2'',t.payload->''addressLine2'',''postcode'',t.payload->''postcode''';
 end if;
 execute format($query$
  with page as materialized(
   select t.id,jsonb_build_object(%s) fields from public.%I t
   where t.tenant_id=$1 and ($2::uuid is null or t.id>$2)
    and ($3::uuid is null or t.id=$3) order by t.id limit 26
  ), shown as(select * from page order by id limit 25), mapped as(
   select id,jsonb_build_object('id',id,'fields',(
    select jsonb_object_agg(key,case when jsonb_typeof(value)='string' then to_jsonb(left(value#>>'{}',6000))
      when length(value::text)>6000 then to_jsonb(left(value::text,6000)) else value end)
    from jsonb_each(fields)),
    'truncated_fields',(select coalesce(jsonb_agg(key order by key),'[]'::jsonb) from jsonb_each(fields)
     where case when jsonb_typeof(value)='string' then length(value#>>'{}') else length(value::text) end>6000)) entry
   from shown
  ) select coalesce((select jsonb_agg(entry order by id) from mapped),'[]'::jsonb),
   case when (select count(*) from page)>25 then (select id from shown order by id desc limit 1) end
 $query$,body,tab) into entries,next_id using p_tenant,p_after,p_record;
 if p_record is not null and jsonb_array_length(entries)<>1 then
  raise exception 'operator_information_unavailable' using errcode='42501';end if;
 -- Recheck current effective authority before the response, retaining real actor.
 perform public.learn_operator_input_access(p_tenant,actor,true);
 checked:=clock_timestamp();
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit_id,p_tenant,actor::text,'client_information.read',p_collection,coalesce(p_record::text,p_tenant::text),
  jsonb_build_object('record_ids',(select coalesce(jsonb_agg(x->'id'),'[]'::jsonb) from jsonb_array_elements(entries)x),'after',p_after),
  btrim(p_reason),audit_id::text,false,'openfolk-client-information');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 result:=jsonb_build_object('version','openfolk-client-information/1','tenant_id',p_tenant,'actor_id',actor,
  'collection',p_collection,'after',p_after,'record',p_record,'rows',entries,'next_after',next_id,
  'observed_at',checked,'audit_id',audit_id);
 return result;
end$$;
revoke all on function public.openfolk_client_information(uuid,text,text,uuid,uuid) from public,anon,service_role;
grant execute on function public.openfolk_client_information(uuid,text,text,uuid,uuid) to authenticated;
commit;
