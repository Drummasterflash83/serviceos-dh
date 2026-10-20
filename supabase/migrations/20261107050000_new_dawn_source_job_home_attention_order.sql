-- Order retained, reviewed job cards by recorded work state before saved age.
-- This is a review order, not a current Commusoft priority or assignment.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare definition text;candidate_old text;candidate_new text;rows_old text;rows_new text;
begin
 definition:=pg_get_functiondef('public.new_dawn_source_job_home(uuid,text)'::regprocedure);
 candidate_old:=$old$select * from valid order by source_observed_at desc,updated_at desc nulls last,id limit 24$old$;
 candidate_new:=$new$select * from valid order by
   case status when 'on_hold' then 0 when 'pending' then 1 when 'open' then 2
    when 'completed' then 4 when 'closed' then 5 else 3 end,
   source_observed_at desc,updated_at desc nulls last,id limit 24$new$;
 rows_old:=$old$order by case source_state when 'source_changed' then 0
    when 'source_ambiguous' then 1 else 2 end,
    source_observed_at desc,updated_at desc nulls last,id) from rows$old$;
 rows_new:=$new$order by case fields->>'status' when 'on_hold' then 0
    when 'pending' then 1 when 'open' then 2 when 'completed' then 4
    when 'closed' then 5 else 3 end,
    case source_state when 'source_changed' then 0
    when 'source_ambiguous' then 1 else 2 end,
    source_observed_at desc,updated_at desc nulls last,id) from rows$new$;
 if position('new_dawn.source_job_home.operator_preview' in definition)=0
  or length(definition)-length(replace(definition,candidate_old,''))<>length(candidate_old)
  or length(definition)-length(replace(definition,rows_old,''))<>length(rows_old) then
  raise exception 'm1_attention_order_contract_changed';end if;
 execute replace(replace(definition,candidate_old,candidate_new),rows_old,rows_new);
end $migration$;
commit;
