-- Drain the indexed Email update lane before the historical unlinked audit.
-- The current Email lane remains separate. When this bounded update window
-- empties, the original unlinked query still runs; use a hash anti join for
-- its large, almost entirely linked source set and allow a 45s audit budget.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$declare definition text;old text;replacement text;hits integer;
begin
 definition:=pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure);
 if md5(definition) not in('678c4167f2240d2c50f4b4610deceebb',
                           'fc08674aa8b078a028902d1e51906620')
 then raise exception 'email_update_first_baseline_changed';end if;
 if to_regprocedure('public.learn_projection_pending_email_updates(uuid,integer)') is null
 then raise exception 'email_update_selector_missing';end if;
 old:=E'end if;\n return query with unlinked as materialized (\n  select m.id';
 replacement:=E'end if;\n if p_source=''email'' then\n  return query select * from public.learn_projection_pending_email_updates(p_tenant,bound);\n  get diagnostics selected=row_count;\n  if selected>0 then return;end if;\n  perform set_config(''enable_nestloop'',''off'',true);\n end if;\n return query with unlinked as materialized (\n  select m.id';
 hits:=(length(definition)-length(replace(definition,old,'')))/length(old);
 if hits<>1 or position('SET statement_timeout TO ''25s''' in definition)=0
 then raise exception 'email_update_first_anchor_changed';end if;
 definition:=replace(definition,old,replacement);
 definition:=replace(definition,'SET statement_timeout TO ''25s''',
  'SET statement_timeout TO ''45s''');
 execute definition;
end$$;
notify pgrst, 'reload schema';
commit;
