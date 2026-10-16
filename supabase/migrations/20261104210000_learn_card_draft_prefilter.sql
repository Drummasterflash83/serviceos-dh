-- Preserve complete card communication counts while avoiding one Email row
-- lookup per interaction for customers with very large company histories.
-- Hosted TEST/LIVE release builds this partial index concurrently first.
create index if not exists learn_card_email_draft_idx
 on public.email_messages (tenant_id,id)
 where provider='gmail' and raw_payload->'label_ids' @> '["DRAFT"]'::jsonb;

do $$
declare d text; old_fragment text; new_fragment text;
begin
 d:=pg_get_functiondef('public.learn_card_projection_inputs(uuid,uuid)'::regprocedure);
 old_fragment:=$old$with associated as materialized (
  select i.id,i.interaction_type,i.direction,i.occurred_at,i.sentiment,i.source_type,
   coalesce(m.provider='gmail' and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false) as draft
  from public.interactions i left join public.email_messages m on i.source_table='email_messages' and m.tenant_id=i.tenant_id and m.id=i.source_id where i.tenant_id=p_tenant$old$;
 new_fragment:=$new$with drafts as materialized (
  select id from public.email_messages where tenant_id=p_tenant and provider='gmail'
   and raw_payload->'label_ids' @> '["DRAFT"]'::jsonb
 ), associated as materialized (
  select i.id,i.interaction_type,i.direction,i.occurred_at,i.sentiment,i.source_type,
   (i.source_table='email_messages' and draft_message.id is not null) as draft
  from public.interactions i left join drafts draft_message
   on i.source_table='email_messages' and draft_message.id=i.source_id
  where i.tenant_id=p_tenant$new$;
 if position(new_fragment in d)>0 then
  if position(old_fragment in d)>0 then raise exception 'Card draft source is ambiguous';end if;
  return;
 end if;
 if length(d)-length(replace(d,old_fragment,''))<>length(old_fragment) then
  raise exception 'Card draft source baseline changed';
 end if;
 execute replace(d,old_fragment,new_fragment);
end$$;
