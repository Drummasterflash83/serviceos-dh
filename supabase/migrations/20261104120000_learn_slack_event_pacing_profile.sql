-- Reuse the already reviewed connection-bound Slack rate profile for event
-- reconciliation. Unknown, expired or rotated connections retain 60 seconds.
-- This does not activate Events, change a roster, or request Slack data.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$declare definition text;needle text;replacement text;begin
 definition:=pg_get_functiondef(
  'public.learn_slack_finish_event_job(uuid,uuid,text,integer,jsonb)'::regprocedure);
 needle:='next_allowed_at=greatest(clock_timestamp()+interval ''60 seconds'',blocked_until)';
 replacement:='next_allowed_at=greatest(clock_timestamp()+make_interval(secs=>case when public.learn_slack_page_limit(p_tenant_id,h.connection_id,h.team_id)=100 then 30 else 60 end),blocked_until)';
 if md5(definition)<>'e66e8f5651d7465c3d12e8bac2d569ba'
  or length(definition)-length(replace(definition,needle,''))<>length(needle)
 then raise exception 'slack_event_settlement_baseline_changed';end if;
 execute replace(definition,needle,replacement);
end$patch$;
commit;
