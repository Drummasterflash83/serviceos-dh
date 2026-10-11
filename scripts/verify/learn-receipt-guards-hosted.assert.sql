-- Rolled back to the release savepoint. No users, grants or source writes.
do $probe$declare role_name text; signature text; denied boolean; r record;begin
 foreach signature in array array['learn_work_measurement_receipt_check(uuid,uuid)',
 'learn_measurement_receipt_constraint()','learn_review_receipt_constraint()','learn_assessment_receipt_constraint()'] loop
  if not exists(select 1 from pg_proc where oid=('public.'||signature)::regprocedure and prosecdef and proconfig=array['search_path=pg_catalog']) then
   raise exception 'Private receipt function definition differs';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_function_privilege(role_name,'public.'||signature,'execute') then raise exception 'Receipt helper exposed';end if;
  end loop;
 end loop;
 for r in select * from (values ('measurements','learn_measurement_receipt_guard'),
 ('learn_performance_reviews','learn_review_receipt_guard'),('learn_assessments','learn_assessment_receipt_guard')) v(tbl,name) loop
  if not exists(select 1 from pg_trigger t where t.tgrelid=('public.'||r.tbl)::regclass and t.tgname=r.name
    and t.tgdeferrable and t.tginitdeferred and t.tgenabled='O' and t.tgtype=5 and not t.tgisinternal) then
   raise exception 'Deferred insert receipt constraint missing';end if;
 end loop;
 if (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and t.tgname in ('learn_measurement_receipt_guard','learn_review_receipt_guard','learn_assessment_receipt_guard'))<>3 then
  raise exception 'Unexpected receipt constraint scope';end if;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  execute 'set local role '||quote_ident(role_name);denied:=false;
  begin perform public.learn_work_measurement_receipt_check(gen_random_uuid(),gen_random_uuid());exception when insufficient_privilege then denied:=true;end;
  execute 'reset role';
  if not denied then raise exception 'Receipt helper admitted a public caller';end if;
 end loop;
end $probe$;
