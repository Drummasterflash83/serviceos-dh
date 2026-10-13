-- Advertise installed optional operator controls without enabling capture or access.
-- The existing authenticated, audited list reader remains the only entry point.
begin;
do $migration$
declare definition text;needle text:= $needle$'campaigns',rows,'next',case when more then last_id else null end)$needle$;
replacement text:= $replacement$'capabilities',jsonb_build_object(
 'sourceReplay',to_regprocedure('public.learn_slack_campaign_source_replay(uuid,uuid,jsonb,text)') is not null,
 'pageRecovery',to_regprocedure('public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text)') is not null
   and to_regprocedure('public.learn_slack_campaign_recovery_read(uuid,uuid,uuid,uuid)') is not null),
 'campaigns',rows,'next',case when more then last_id else null end)$replacement$;
begin
 definition:=pg_get_functiondef('public.learn_slack_campaign_list(uuid,uuid)'::regprocedure);
 if length(definition)-length(replace(definition,needle,''))<>length(needle)
 or position('''capabilities''' in definition)>0 then
  raise exception 'Slack control capability reader baseline differs';
 end if;
 execute replace(definition,needle,replacement);
end $migration$;
commit;
