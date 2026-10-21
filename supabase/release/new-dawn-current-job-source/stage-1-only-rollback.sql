-- Use only if Stage 1 committed and Stage 2 is absent. The old Home readers
-- still use retained history, so removing this unused derived cache is safe.
-- The applied migration ledger remains as audit history; do not replay it.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $guard$ begin
 if (select count(*) from supabase_migrations.schema_migrations
     where version::text='20261113000000')<>1
  or exists(select 1 from supabase_migrations.schema_migrations
     where version::text='20261113010000')
  or encode(sha256(convert_to(pg_get_functiondef(
     'public.new_dawn_open_job_status_summary(uuid,text)'::regprocedure),'UTF8')),'hex')<>
     '1a373342368cc703a09860bc6162c0a98a8116cebd104719d212449fb9603f9a'
  or encode(sha256(convert_to(pg_get_functiondef(
     'public.new_dawn_customer_blockers(uuid,text)'::regprocedure),'UTF8')),'hex')<>
     'edc63a68703186905bbd7a61a791629c843b14a4ebdefe3b9660260f51e17e55'
  or to_regclass('public.new_dawn_commusoft_current_job_source') is null
 then raise exception 'current_job_source_stage_1_rollback_state_changed'; end if;
end $guard$;
drop trigger new_dawn_commusoft_current_job_source_observe
 on public.learn_business_input_observations;
drop function public.new_dawn_commusoft_current_job_source_observe();
drop table public.new_dawn_commusoft_current_job_source;
commit;
