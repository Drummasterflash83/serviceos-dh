-- Keep source eligibility unchanged while making large customer histories usable.
-- The former scalar draft lookup ran a security-definer query for every row;
-- one live card has over 19,000 interactions and exceeded the request timeout.
begin;

create or replace function public.learn_identity_review_count(p_tenant uuid) returns integer
 language sql stable security definer set search_path=pg_catalog as $$
 select count(*)::integer
 from public.interactions i
 left join public.email_messages m
  on i.source_table='email_messages' and m.tenant_id=i.tenant_id and m.id=i.source_id
 where i.tenant_id=p_tenant and i.processing_status='identity_review'
  and not coalesce(m.provider='gmail' and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
$$;

-- TEST does not yet have the LIVE Slack withholding addition to this function.
-- Patch only the four draft-read expressions in the installed definition so
-- both environments retain their own current source-visibility checks.
do $$
declare d text; needle text; replacement text;
begin
 d:=pg_get_functiondef('public.learn_card_projection_inputs(uuid,uuid)'::regprocedure);
 needle:='public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id) as draft';
 replacement:='coalesce(m.provider=''gmail'' and m.raw_payload->''label_ids'' @> ''["DRAFT"]''::jsonb,false) as draft';
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'Card interaction draft expression differs';
 end if;
 d:=replace(d,needle,replacement);

 needle:='from public.interactions i where i.tenant_id=p_tenant';
 replacement:='from public.interactions i left join public.email_messages m on i.source_table=''email_messages'' and m.tenant_id=i.tenant_id and m.id=i.source_id where i.tenant_id=p_tenant';
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'Card interaction source read differs';
 end if;
 d:=replace(d,needle,replacement);

 needle:='coalesce(public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id),false) as draft';
 replacement:='coalesce(m.provider=''gmail'' and m.raw_payload->''label_ids'' @> ''["DRAFT"]''::jsonb,false) as draft';
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'Card recommendation draft expression differs';
 end if;
 d:=replace(d,needle,replacement);

 needle:='from public.recommendations r left join public.interactions i on i.tenant_id=r.tenant_id and i.id=r.interaction_id';
 replacement:='from public.recommendations r left join public.interactions i on i.tenant_id=r.tenant_id and i.id=r.interaction_id left join public.email_messages m on i.source_table=''email_messages'' and m.tenant_id=i.tenant_id and m.id=i.source_id';
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'Card recommendation source read differs';
 end if;
 d:=replace(d,needle,replacement);
 execute d;
end$$;

-- CREATE OR REPLACE retains the existing service-only execute grants.
commit;
