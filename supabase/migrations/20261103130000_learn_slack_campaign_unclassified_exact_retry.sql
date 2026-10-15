-- A generic worker failure has no structural diagnostic. Permit one operator
-- reviewed exact-page retry only when the existing campaign, import, checkpoint,
-- failed job and no later attempt still match. The recovery function already
-- rejects committed page metadata, active jobs, changed scope and reused failures.
begin;
do $$
declare
  definition text;
  old_errors text := '''slack_history_message_subtype_unsupported'',''slack_history_message_shape_unsupported'',''slack_history_diagnostic_unconfirmed'')';
  new_errors text := '''slack_history_message_subtype_unsupported'',''slack_history_message_shape_unsupported'',''slack_history_diagnostic_unconfirmed'',''slack_history_failed'')';
begin
  definition := pg_get_functiondef('public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text)'::regprocedure);
  if length(definition)-length(replace(definition,old_errors,''))<>length(old_errors)
     or position(new_errors in definition)>0
     or position('or h.expires_at<=clock_timestamp()' in definition)=0
  then raise exception 'Slack recovery failure allowlist baseline differs'; end if;
  execute replace(definition,old_errors,new_errors);
end$$;
commit;
