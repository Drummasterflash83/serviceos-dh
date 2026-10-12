-- OpenFolk uses the existing reviewed source-to-card writers with its real actor.
-- Ordinary tenant review/import authority is unchanged. No data projection on install.
begin;
create function public.learn_business_review_authority(p_tenant uuid,p_actor uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare context jsonb;begin
 context:=nullif(current_setting('openfolk.business_review',true),'')::jsonb;
 if auth.role()='authenticated' and auth.uid()=p_actor
  and context->>'tenant'=p_tenant::text and context->>'actor'=p_actor::text
  and length(btrim(context->>'reason')) between 3 and 1000 then
  perform public.learn_operator_input_access(p_tenant,p_actor,true);
  perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
  perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
  -- Audit inside the authority check as well as the outer receipt: a context
  -- setting never provides an unaudited alternative to the ordinary authority.
  insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,reason,view_as_active,source)
  values(p_tenant,p_actor::text,'business_review.authorise','commusoft',p_tenant::text,
   btrim(context->>'reason'),false,'openfolk-business-review');
 else
  perform public.learn_import_batch_authority(p_tenant,p_actor);
 end if;
end$$;
revoke all on function public.learn_business_review_authority(uuid,uuid) from public,anon,authenticated,service_role;

-- Only the retained Commusoft review path changes; generic imports do not.
do $$declare signature text;d text;needle text:='public.learn_import_batch_authority(';begin
 foreach signature in array array[
  'public.learn_business_input_review_access(uuid,uuid)',
  'public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text)',
  'public.learn_commusoft_work_batch(uuid,uuid,uuid,text,jsonb,text,boolean,uuid)',
  'public.learn_commusoft_work_batch_result(uuid,uuid)'
 ] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if (length(d)-length(replace(d,needle,'')))<>length(needle) then
   raise exception 'business_review_authority_contract_changed';end if;
  execute replace(d,needle,'public.learn_business_review_authority(');
 end loop;
end$$;

create function public.openfolk_business_review(p_tenant uuid,p_action text,p_reason text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();result jsonb;old_context text;allowed text[];audit uuid:=gen_random_uuid();begin
 perform public.learn_operator_input_access(p_tenant,actor,true);
 if p_reason is null or length(btrim(p_reason)) not between 3 and 1000
  or jsonb_typeof(p_args) is distinct from 'object' or octet_length(p_args::text)>65536
  or p_args->>'p_tenant' is distinct from p_tenant::text then
  raise exception 'operator_business_review_invalid' using errcode='22023';end if;
 allowed:=case p_action
  when 'learn_commusoft_review_connections' then array['p_tenant']
  when 'learn_commusoft_review_page' then array['p_tenant','p_connection','p_after','p_limit']
  when 'learn_commusoft_review_search' then array['p_tenant','p_connection','p_after','p_limit','p_search']
  when 'learn_commusoft_customer_candidates' then array['p_tenant','p_version','p_kind','p_search','p_after','p_limit']
  when 'learn_commusoft_contact_candidates' then array['p_tenant','p_version','p_kind','p_search','p_after','p_limit']
  when 'learn_commusoft_confirm_customer' then array['p_tenant','p_version','p_kind','p_target','p_reason']
  when 'learn_commusoft_work_review_page' then array['p_tenant','p_connection','p_kind','p_after','p_limit']
  when 'learn_commusoft_work_review_search' then array['p_tenant','p_connection','p_kind','p_after','p_limit','p_search']
  when 'learn_commusoft_work_batch_result' then array['p_tenant','p_request']
  when 'learn_commusoft_work_batch' then array['p_tenant','p_request','p_connection','p_kind','p_items','p_reason','p_cancel','p_expected_actor']
  when 'learn_commusoft_job_details' then array['p_tenant','p_connection','p_version']
 end;
 if allowed is null or not p_args ?& allowed
  or exists(select 1 from jsonb_object_keys(p_args)k where not k=any(allowed))
  or (p_args ? 'p_expected_actor' and p_args->>'p_expected_actor' is distinct from actor::text) then
  raise exception 'operator_business_review_action_invalid' using errcode='22023';end if;
 old_context:=current_setting('openfolk.business_review',true);
 perform set_config('openfolk.business_review',jsonb_build_object('tenant',p_tenant,'actor',actor,'reason',btrim(p_reason))::text,true);
 case p_action
  when 'learn_commusoft_review_connections' then result:=public.learn_commusoft_review_connections(p_tenant);
  when 'learn_commusoft_review_page' then result:=public.learn_commusoft_review_page(p_tenant,(p_args->>'p_connection')::uuid,p_args->>'p_after',(p_args->>'p_limit')::integer);
  when 'learn_commusoft_review_search' then result:=public.learn_commusoft_review_search(p_tenant,(p_args->>'p_connection')::uuid,p_args->>'p_search',p_args->>'p_after',(p_args->>'p_limit')::integer);
  when 'learn_commusoft_customer_candidates' then result:=public.learn_commusoft_customer_candidates(p_tenant,(p_args->>'p_version')::uuid,p_args->>'p_kind',p_args->>'p_search',(p_args->>'p_after')::uuid,(p_args->>'p_limit')::integer);
  when 'learn_commusoft_contact_candidates' then result:=public.learn_commusoft_contact_candidates(p_tenant,(p_args->>'p_version')::uuid,p_args->>'p_kind',p_args->>'p_search',(p_args->>'p_after')::uuid,(p_args->>'p_limit')::integer);
  when 'learn_commusoft_confirm_customer' then result:=public.learn_commusoft_confirm_customer(p_tenant,(p_args->>'p_version')::uuid,p_args->>'p_kind',(p_args->>'p_target')::uuid,p_args->>'p_reason');
  when 'learn_commusoft_work_review_page' then result:=public.learn_commusoft_work_review_page(p_tenant,(p_args->>'p_connection')::uuid,p_args->>'p_kind',p_args->>'p_after',(p_args->>'p_limit')::integer);
  when 'learn_commusoft_work_review_search' then result:=public.learn_commusoft_work_review_search(p_tenant,(p_args->>'p_connection')::uuid,p_args->>'p_kind',p_args->>'p_search',p_args->>'p_after',(p_args->>'p_limit')::integer);
  when 'learn_commusoft_work_batch_result' then result:=public.learn_commusoft_work_batch_result(p_tenant,(p_args->>'p_request')::uuid);
  when 'learn_commusoft_work_batch' then result:=public.learn_commusoft_work_batch(p_tenant,(p_args->>'p_request')::uuid,(p_args->>'p_connection')::uuid,p_args->>'p_kind',p_args->'p_items',p_args->>'p_reason',(p_args->>'p_cancel')::boolean,(p_args->>'p_expected_actor')::uuid);
  when 'learn_commusoft_job_details' then result:=public.learn_commusoft_job_details(p_tenant,(p_args->>'p_connection')::uuid,(p_args->>'p_version')::uuid);
 end case;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'business_review.result',p_action,p_tenant::text,
  jsonb_build_object('version_id',p_args->'p_version','request_id',p_args->'p_request',
   'entity_id',result->'entity_id','card_id',result->'card_id','batch_id',result->'batch_id',
   'row_count',case when jsonb_typeof(result->'rows')='array' then jsonb_array_length(result->'rows') end),
  btrim(p_reason),audit::text,false,'openfolk-business-review');
 perform set_config('openfolk.business_review',coalesce(old_context,''),true);
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','openfolk-business-review/1','tenant_id',p_tenant,'actor_id',actor,
  'action',p_action,'audit_id',audit,'observed_at',clock_timestamp(),'result',result);
end$$;
revoke all on function public.openfolk_business_review(uuid,text,text,jsonb) from public,anon,service_role;
grant execute on function public.openfolk_business_review(uuid,text,text,jsonb) to authenticated;
commit;
