-- An OpenFolk operator can review the source-linked queue without publishing it
-- to clients. The original client flag remains separate and default-OFF.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.new_dawn_source_job_home(uuid,text)'::regprocedure);
 needle:=$old$perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.source_job_home' and value='true'::jsonb for share;$old$;
 replacement:=$new$perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag=(case when operator_read then 'new_dawn.source_job_home.operator_preview'
   else 'new_dawn.source_job_home' end) and value='true'::jsonb for share;$new$;
 if length(definition)-length(replace(definition,needle,''))<>length(needle)
  or position('new_dawn.source_job_home.operator_preview' in definition)>0 then
  raise exception 'source_home_operator_gate_contract_changed';end if;
 execute replace(definition,needle,replacement);
end $migration$;
commit;
