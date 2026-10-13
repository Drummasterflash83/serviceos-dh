-- Logged, paginated controller read and actor-bound request dispatch. No capture.
begin;
create function public.learn_slack_campaign_list(p_tenant uuid,p_after uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb;last_id uuid;more boolean;begin
 perform public.learn_slack_control_access(p_tenant,false,'history');
 select coalesce(jsonb_agg(jsonb_build_object('campaignId',h.id,'start',h.starts_at,'end',h.ends_at,'enabled',h.enabled,
  'lifecycle',coalesce(x.outcome,'open'),'channelCount',(select count(*) from public.slack_history_campaign_channels m where m.campaign_id=h.id)) order by h.id),'[]')
 into rows from (select * from public.slack_history_campaigns where tenant_id=p_tenant and (p_after is null or id>p_after) order by id limit 20) h
 left join public.slack_history_campaign_closures x on x.campaign_id=h.id and x.tenant_id=h.tenant_id;
 last_id:=(rows->-1->>'campaignId')::uuid;
 select exists(select 1 from public.slack_history_campaigns where tenant_id=p_tenant and id>last_id) into more;
 return jsonb_build_object('version','learn-slack-campaign-list/1','tenantId',p_tenant,'canWrite',public.learn_slack_recurring_access(p_tenant,true),
 'campaigns',rows,'next',case when more then last_id else null end);
end$$;
revoke all on function public.learn_slack_campaign_list(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_list(uuid,uuid) to authenticated;
create function public.learn_slack_campaign_dispatch(p_tenant uuid,p_actor uuid,p_request uuid,p_operation text,p_input jsonb,p_mode text default 'apply') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null or p_actor is distinct from auth.uid() then
  raise exception 'slack_campaign_actor_changed' using errcode='42501';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or p_mode is null or p_mode not in ('apply','check','cancel') then
  raise exception 'slack_campaign_request_invalid' using errcode='22023';end if;
 if p_operation='start' then return public.learn_slack_campaign_start(p_tenant,p_request,p_input,p_mode);
 elsif p_operation='control' and p_input ?& array['campaignId','revision','enabled','reason']
  and p_input-array['campaignId','revision','enabled','reason']='{}' and jsonb_typeof(p_input->'enabled')='boolean'
  and jsonb_typeof(p_input->'revision')='number' and p_input->>'revision' ~ '^[0-9]+$' and jsonb_typeof(p_input->'reason')='string' then
  return public.learn_slack_campaign_control(p_tenant,p_request,(p_input->>'campaignId')::uuid,(p_input->>'revision')::bigint,(p_input->>'enabled')::boolean,p_input->>'reason',p_mode);
 elsif p_operation='close' and p_input ?& array['campaignId','revision','action','reason']
  and p_input-array['campaignId','revision','action','reason']='{}' and jsonb_typeof(p_input->'revision')='number'
  and p_input->>'revision' ~ '^[0-9]+$' and jsonb_typeof(p_input->'reason')='string' then
  return public.learn_slack_campaign_close(p_tenant,p_request,(p_input->>'campaignId')::uuid,(p_input->>'revision')::bigint,p_input->>'action',p_input->>'reason',p_mode);
 end if;
 raise exception 'slack_campaign_request_invalid' using errcode='22023';
end$$;
revoke all on function public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text) to authenticated;
commit;
