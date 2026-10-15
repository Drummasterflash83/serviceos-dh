-- Keep Gmail draft exclusion unchanged while counting large customer histories
-- without one security-definer draft lookup per interaction. The former count
-- timed out for a contact with 8,712 linked emails, preventing one otherwise
-- eligible identity delivery and stopping unattended batch continuation.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $patch$
declare definition text;
 needle text:='from public.interactions x where tenant_id=p_tenant and related_person_id=person_id and not public.learn_interaction_is_draft(x.tenant_id,x.source_table,x.source_id);';
 replacement text:='from public.interactions x left join public.email_messages m on x.source_table=''email_messages'' and m.tenant_id=x.tenant_id and m.id=x.source_id where x.tenant_id=p_tenant and x.related_person_id=person_id and not coalesce(m.provider=''gmail'' and m.raw_payload->''label_ids'' @> ''["DRAFT"]''::jsonb,false);';
begin
 select pg_get_functiondef(p.oid) into definition from pg_catalog.pg_proc p
 where p.oid='public.learn_identity_deliver_internal(uuid,uuid,uuid,text,text,uuid)'::regprocedure
  and md5(pg_get_functiondef(p.oid))='60adf2eca5be0f1c0aaa97765364eeca'
  and pg_get_userbyid(p.proowner)='postgres'
  and p.proacl::text='{postgres=X/postgres}' and p.prosecdef;
 if definition is null then raise exception 'Reviewed identity function or authority changed';end if;
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then
  raise exception 'Identity draft count differs';end if;
 execute replace(definition,needle,replacement);
 if not exists(select 1 from pg_catalog.pg_proc p
  where p.oid='public.learn_identity_deliver_internal(uuid,uuid,uuid,text,text,uuid)'::regprocedure
   and pg_get_userbyid(p.proowner)='postgres'
   and p.proacl::text='{postgres=X/postgres}' and p.prosecdef
   and length(p.prosrc)-length(replace(p.prosrc,replacement,''))=length(replacement)) then
  raise exception 'Identity draft count or authority not preserved';end if;
end $patch$;
commit;
