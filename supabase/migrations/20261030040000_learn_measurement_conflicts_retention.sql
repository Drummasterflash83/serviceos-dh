-- Manual business conflicts must not request database serialization retries.
-- Preserve whichever retained append implementation is installed (the work
-- collector later extends its evidence allowlist without changing this contract).
do $$ declare signature text; definition text; expected_count int; begin
 foreach signature in array array[
  'public.learn_performance_append(uuid,jsonb,text)',
  'public.learn_performance_review(uuid,uuid,uuid,integer,text,text)'
 ] loop
  if to_regprocedure(signature) is null then raise exception 'Measurement writer prerequisite missing';end if;
  select pg_get_functiondef(to_regprocedure(signature)) into definition;
  expected_count:=(length(definition)-length(replace(definition,'errcode=''40001''','')))/length('errcode=''40001''');
  if expected_count<>3 then raise exception 'Unexpected measurement conflict contract';end if;
  execute replace(definition,'errcode=''40001''','errcode=''PT409''');
 end loop;
end $$;
-- Row-level guards do not fire for TRUNCATE. Retain all evidence ledgers even
-- when a privileged maintenance caller attempts to truncate the whole table.
create trigger learn_measurements_no_truncate before truncate on public.measurements
 for each statement execute function public.objectives_append_only();
create trigger learn_performance_reviews_no_truncate before truncate on public.learn_performance_reviews
 for each statement execute function public.objectives_append_only();
create trigger learn_objective_health_no_truncate before truncate on public.objective_health
 for each statement execute function public.objectives_append_only();
-- Existing service writers may still insert company-wide objective measurements.
-- Staff performance observations must pass the validated SECURITY DEFINER adapter;
-- the service role cannot bypass it and insert a self-confirmed performance fact.
create function public.learn_performance_insert_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if new.subject_kind<>'tenant' and current_user is distinct from
   (select r.rolname from pg_class c join pg_roles r on r.oid=c.relowner where c.oid=tg_relid) then
  raise exception 'Use the validated performance append adapter' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.learn_performance_insert_guard() from public,anon,authenticated,service_role;
create trigger learn_performance_insert_guard before insert on public.measurements
 for each row execute function public.learn_performance_insert_guard();
