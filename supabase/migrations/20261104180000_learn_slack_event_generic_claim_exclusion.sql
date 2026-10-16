-- Reserve signed Slack Events jobs for learn-slack-worker. The generic worker
-- has no event handler and must never claim or dead-letter these jobs.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$ declare d text; needle text :=
  'and c.job_type not in (''slack.history_sync'',''slack.thread_sync'')';
begin
 d := pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure);
 if length(d)-length(replace(d,needle,'')) <> length(needle)
    or position('''slack.event_sync''' in d) > 0 then
  raise exception 'slack_event_generic_claim_shape_changed';
 end if;
 execute replace(d,needle,
  'and c.job_type not in (''slack.history_sync'',''slack.thread_sync'',''slack.event_sync'')');
end $patch$;
commit;
