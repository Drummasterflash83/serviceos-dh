-- LIVE's email_messages has a nullable UUID origin_campaign_id with a tenant
-- foreign key. Read that one field directly on the hot projection path instead
-- of serialising the full retained email row through to_jsonb. TEST lacks the
-- marketing schema/column, so this guarded patch is released to LIVE only.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare definition text;
 old_expr text := 'to_jsonb(m)->>''origin_campaign_id''';
 new_expr text := 'm.origin_campaign_id::text';
begin
 if not exists(select 1 from pg_attribute a where a.attrelid='public.email_messages'::regclass
  and a.attname='origin_campaign_id' and not a.attisdropped and a.atttypid='uuid'::regtype)
  or not exists(select 1 from pg_constraint c where c.conrelid='public.email_messages'::regclass
   and c.conname='email_messages_origin_campaign_fk')
 then raise exception 'live_typed_origin_schema_missing';end if;
 definition:=pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure);
 if md5(definition)<>'d482f49bab554565a1df744372ed4aa5'
  or length(definition)-length(replace(definition,old_expr,''))<>length(old_expr)
 then raise exception 'live_typed_origin_selector_baseline_changed';end if;
 execute replace(definition,old_expr,new_expr);
end$$;
commit;
