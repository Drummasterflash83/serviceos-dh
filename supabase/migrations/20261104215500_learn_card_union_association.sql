-- Read a customer's company and person interactions through their separate
-- indexes. A dual-linked interaction is included once, and a person-only card
-- retains interactions whose company link is null.
do $$
declare d text; old_fragment text; new_fragment text;
begin
 d:=pg_get_functiondef('public.learn_card_projection_inputs(uuid,uuid)'::regprocedure);
 old_fragment:=$old$from public.interactions i left join drafts draft_message
   on i.source_table='email_messages' and draft_message.id=i.source_id
  where i.tenant_id=p_tenant
   and (i.related_person_id=c.person_id or i.related_company_id=c.company_id)
   and coalesce(i.status,'') not in('deleted','removed')$old$;
 new_fragment:=$new$from (
   select i.id,i.interaction_type,i.direction,i.occurred_at,i.sentiment,
     i.source_type,i.source_table,i.source_id
   from public.interactions i
   where i.tenant_id=p_tenant and i.related_company_id=c.company_id
     and coalesce(i.status,'') not in('deleted','removed')
   union all
   select i.id,i.interaction_type,i.direction,i.occurred_at,i.sentiment,
     i.source_type,i.source_table,i.source_id
   from public.interactions i
   where i.tenant_id=p_tenant and i.related_person_id=c.person_id
     and (c.company_id is null or i.related_company_id is distinct from c.company_id)
     and coalesce(i.status,'') not in('deleted','removed')
  ) i left join drafts draft_message
   on i.source_table='email_messages' and draft_message.id=i.source_id$new$;
 if position(new_fragment in d)>0 then
  if position(old_fragment in d)>0 then raise exception 'Card association ambiguous';end if;
  return;
 end if;
 if length(d)-length(replace(d,old_fragment,''))<>length(old_fragment) then
  raise exception 'Card association baseline changed';
 end if;
 execute replace(d,old_fragment,new_fragment);
end$$;
