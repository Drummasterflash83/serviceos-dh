-- Bounded changed-record traversals. No activation, credentials, schedules or
-- refresh approvals are seeded. Existing raw pages and versions remain retained.
begin;
create function public.learn_commusoft_update_window(p_scope jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare first_at timestamptz;last_at timestamptz;k text;v text;
begin
 if p_scope is null or jsonb_typeof(p_scope)<>'object' then
  raise exception 'commusoft_update_window_invalid' using errcode='22023';end if;
 if not p_scope ?| array['updatedFrom','updatedBefore'] then return '{}'::jsonb;end if;
 foreach k in array array['updatedFrom','updatedBefore'] loop
  v:=p_scope->>k;
  if jsonb_typeof(p_scope->k) is distinct from 'string' or v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
   raise exception 'commusoft_update_window_invalid' using errcode='22023';end if;
  begin
   if to_char(v::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>v then
    raise exception 'commusoft_update_window_invalid' using errcode='22023';end if;
  exception when datetime_field_overflow or invalid_datetime_format then
   raise exception 'commusoft_update_window_invalid' using errcode='22023';end;
 end loop;
 first_at:=(p_scope->>'updatedFrom')::timestamptz;last_at:=(p_scope->>'updatedBefore')::timestamptz;
 if first_at<to_timestamp(0) or first_at>=last_at then
  raise exception 'commusoft_update_window_invalid' using errcode='22023';end if;
 return jsonb_build_object('updatedFrom',p_scope->'updatedFrom','updatedBefore',p_scope->'updatedBefore');
end $$;
revoke all on function public.learn_commusoft_update_window(jsonb) from public,anon,authenticated,service_role;

-- Fail on source drift, and retain the existing function owners and grants.
do $patch$ declare d text;r record;begin
 for r in select * from (values
  ('public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text)',
   $old$p_definition-array['kind','reason','connection_id','revision','resource','contact_type','max_pages','page_size','expires_at']$old$,
   $new$p_definition-array['kind','reason','connection_id','revision','resource','contact_type','max_pages','page_size','expires_at','updatedFrom','updatedBefore']$new$),
  ('public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text)',
   $old$  connection_id:=(p_definition->>'connection_id')::uuid;$old$,
   $new$  perform public.learn_commusoft_update_window(p_definition);
  if p_definition ? 'updatedBefore' and (p_definition->>'updatedBefore')::timestamptz>clock_timestamp() then
   raise exception 'commusoft_update_window_future' using errcode='22023';end if;
  connection_id:=(p_definition->>'connection_id')::uuid;$new$),
  ('public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text)',
   $old$||case when resource='propertyContacts' then jsonb_build_object('contactType',contact_type) else '{}'::jsonb end;$old$,
   $new$||case when resource='propertyContacts' then jsonb_build_object('contactType',contact_type) else '{}'::jsonb end
   ||public.learn_commusoft_update_window(p_definition);$new$),
  ('public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text)',
   $old$and p.provider='commusoft' and p.collection='properties' and p.checkpoint_after->'complete'='true'::jsonb$old$,
   $new$and p.provider='commusoft' and p.collection='properties' and p.checkpoint_after->'complete'='true'::jsonb
     and exists(select 1 from public.learn_business_input_request_permits permit where permit.id=p.permit_id
      and permit.binding->'request'->>'resource'='properties'
      and not (permit.binding->'request') ?| array['updatedFrom','updatedBefore'])$new$),
  ('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)',
   $old$  if req is distinct from p_expected->'request'$old$,
   $new$  req:=req||public.learn_commusoft_update_window(cfg);
  if req is distinct from p_expected->'request'$new$),
  ('public.learn_commusoft_commit_page(uuid,uuid,text,integer,uuid,jsonb)',
   $old$  b:=permit.binding; cfg:=b->'approval'; cp:=b->'checkpoint';$old$,
   $new$  b:=permit.binding; cfg:=b->'approval'; cp:=b->'checkpoint';
  if ((b->'request')-array['region','resource','after','limit','contactType','propertyId'])
    is distinct from public.learn_commusoft_update_window(cfg) then
   raise exception 'commusoft_update_window_changed' using errcode='PT409';end if;$new$),
  ('public.learn_commusoft_finish_job(uuid,uuid,text,integer,jsonb)',
   $old$'coverage','one_collection_traversal','ingestion_complete',false$old$,
   $new$'coverage',case when cfg ? 'updatedFrom' then 'one_update_window' else 'one_collection_traversal' end,
       'ingestion_complete',false$new$),
  ('public.learn_operator_inputs(uuid)',
   $old$'contact_target_count',a.settings->'commusoft_import'->'contactTargetCount',$old$,
   $new$'updated_window',case when a.settings->'commusoft_import' ? 'updatedFrom' then
    jsonb_build_object('updatedFrom',a.settings->'commusoft_import'->'updatedFrom',
     'updatedBefore',a.settings->'commusoft_import'->'updatedBefore') else null end,
   'contact_target_count',a.settings->'commusoft_import'->'contactTargetCount',$new$)
 ) as patches(signature,old_source,new_source) loop
  d:=pg_get_functiondef(r.signature::regprocedure);
  if (length(d)-length(replace(d,r.old_source,'')))<>length(r.old_source) then
   raise exception 'commusoft_update_window_source_changed: %',r.signature;end if;
  execute replace(d,r.old_source,r.new_source);
 end loop;
end $patch$;
commit;
