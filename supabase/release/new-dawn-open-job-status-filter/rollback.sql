-- Revert only the job reader predicate. Keep migration and read-audit ledgers.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $rollback$
declare
  signature regprocedure := 'public.new_dawn_open_job_page_base(uuid,text,text,text,integer)'::regprocedure;
  prior text := pg_get_functiondef(signature);
  marker text := $old$and v.payload->>'id'=u.external_id
    and v.payload->>'status' in ('Open','ongoing','pending','on_hold')
  ), created_source$old$;
  replacement text := $new$and v.payload->>'id'=u.external_id
  ), created_source$new$;
begin
  if encode(sha256(convert_to(prior,'UTF8')),'hex') <>
     '408a51b873f52f48ee5acad60d932b8d2c7ee4d1ba20fb0c8e698a6cb26307f8'
     or length(prior)-length(replace(prior,marker,'')) <> length(marker)
  then raise exception 'open_job_page_rollback_state_changed'; end if;
  execute replace(prior,marker,replacement);
  if encode(sha256(convert_to(pg_get_functiondef(signature),'UTF8')),'hex') <>
     '6c60217cc018c32a334a26b8851631ac4a56e19b272b5a7dba4ee3b6182a743e'
  then raise exception 'open_job_page_rollback_changed'; end if;
end $rollback$;

commit;
