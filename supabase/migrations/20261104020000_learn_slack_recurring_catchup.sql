-- Reduce catch-up work for already-approved recurring Slack channels. The same
-- durable page budget, source checkpoint, reply gate and consent checks remain.
-- A busy channel that exhausts its page budget stays incomplete for recovery;
-- no source boundary is advanced without a verified successful page sequence.
begin;
do $patch$
declare definition text; old_window text; new_window text;
begin
 definition:=pg_get_functiondef('public.learn_slack_schedule_recurring(integer)'::regprocedure);
 old_window:='ending:=least(boundary+interval ''15 minutes'',clock_timestamp()-interval ''2 minutes'');';
 new_window:='ending:=least(boundary+case when boundary<clock_timestamp()-interval ''1 day'' then interval ''72 hours'' else interval ''15 minutes'' end,clock_timestamp()-interval ''2 minutes'');';
 if length(definition)-length(replace(definition,old_window,''))<>length(old_window)
   or position('learn_slack_queue_recurring_threads' in definition)=0
   or position('learn_slack_credential_field' in definition)=0
   or position('a.sync_cursor->''complete'' is distinct from ''true''::jsonb' in definition)=0
   or position('metadata->''slack_page_v1''->''next''=a.sync_cursor' in definition)=0 then
   raise exception 'slack_recurring_catchup_reviewed_scheduler_changed';
 end if;
 execute replace(definition,old_window,new_window);
end $patch$;
commit;
