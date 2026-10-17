-- Let an explicitly selected, audited OpenFolk operator create the same
-- unassigned source-version review task as an authorised client reviewer.
-- Staff assignment and acceptance remain separate guarded transitions.
begin;
do $migration$
declare d text; needle text; replacement text;
begin
 d:=pg_get_functiondef('public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure);
 needle:=$old$  when 'learn_commusoft_source_job_cards' then array['p_tenant','p_connection','p_query','p_open_only','p_after']$old$;
 replacement:=needle||E'\n'||$new$  when 'learn_commusoft_create_job_review_action' then array['p_tenant','p_connection','p_external_id','p_version','p_reason']$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'operator_job_review_actions_changed';
 end if;
 d:=replace(d,needle,replacement);
 needle:=$old$  when 'learn_commusoft_source_job_cards' then result:=public.learn_commusoft_source_job_cards(p_tenant,(p_args->>'p_connection')::uuid,p_args->>'p_query',(p_args->>'p_open_only')::boolean,p_args->>'p_after');$old$;
 replacement:=needle||E'\n'||$new$  when 'learn_commusoft_create_job_review_action' then result:=public.learn_commusoft_create_job_review_action(p_tenant,(p_args->>'p_connection')::uuid,p_args->>'p_external_id',(p_args->>'p_version')::uuid,p_args->>'p_reason');$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'operator_job_review_dispatch_changed';
 end if;
 execute replace(d,needle,replacement);
end $migration$;
commit;
