-- Fixed historical ranges use the existing paginated channel/reply protocol.
-- The calendar span is not a request budget: each approval still expires in
-- 24 hours and allows at most ten pages of fifteen observations. An unfinished
-- range retains its cursor and requires the existing reviewed recovery action.
-- No credential, scope, job, schedule, source row or permission changes on apply.
begin;
do $patch$
declare item record;definition text;
begin
 for item in select * from (values
  ('public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text)',
   ' or p_end-p_start>interval ''24 hours''',''),
  ('public.learn_slack_start_thread_import(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz,integer,text)',
   ' or p_end-p_start>interval ''24 hours''',''),
  ('public.learn_slack_commit_page_private(uuid,uuid,uuid,jsonb,jsonb,jsonb)',
   '  or (cfg->>''latest'')::numeric-(cfg->>''oldest'')::numeric>86400',''),
  ('public.learn_slack_history_state(uuid,uuid)',
   ' and (cfg->>''latest'')::numeric-(cfg->>''oldest'')::numeric<=86400',''),
  ('public.learn_slack_thread_recovery_state(uuid,uuid)',
   ' and (cfg->>''latest'')::numeric-(cfg->>''oldest'')::numeric<=86400','')
 ) as edits(signature,needle,replacement) loop
  definition:=pg_get_functiondef(item.signature::regprocedure);
  if length(definition)-length(replace(definition,item.needle,''))<>length(item.needle) then
   raise exception 'Reviewed Slack historical range predicate differs: %',item.signature;
  end if;
  definition:=replace(definition,item.needle,item.replacement);
  definition:=replace(definition,'Choose a past window up to 24 hours, a public channel and a reason',
   'Choose a fixed past period, a public channel and a reason');
  execute definition;
 end loop;
end $patch$;
commit;
