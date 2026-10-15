-- The ordered unlinked-email scan must use the existing source-identity index.
-- LEFT JOIN ... IS NULL led the LIVE planner to hash and sort the entire tenant;
-- an equivalent NOT EXISTS retains the ordered source scan and indexed anti-probe.
-- Exact draft, revision, review and Phone selection logic remains unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare definition text;
 old_join text := $old$from public.email_messages m left join public.interactions i
   on i.tenant_id=m.tenant_id and i.source_table='email_messages' and i.source_id=m.id
  where m.tenant_id=p_tenant and i.id is null$old$;
 new_join text := $new$from public.email_messages m
  where m.tenant_id=p_tenant
   and not exists(select 1 from public.interactions i where i.tenant_id=m.tenant_id and i.source_table='email_messages' and i.source_id=m.id)$new$;
begin
 definition:=pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure);
 if md5(definition) not in ('d482f49bab554565a1df744372ed4aa5','741255fbc0315b86f8a70926e73c9b1e')
  or length(definition)-length(replace(definition,old_join,''))<>length(old_join)
 then raise exception 'projection_ordered_anti_join_baseline_changed';end if;
 execute replace(definition,old_join,new_join);
end$$;
commit;
