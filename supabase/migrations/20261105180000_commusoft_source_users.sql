-- Add the provider's documented GET /users as a separate, opt-in retained source
-- collection. Existing contact/job runs and permissions remain unchanged. Source
-- users are not OpenFolk staff, logins, assigned engineers or canonical people.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare signature text; body text; old_list text; new_list text; occurrences integer;
begin
 for signature,old_list,new_list in
  select * from (values
   ('public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text)',
    $old$or resource not in ('properties','propertyContacts','jobs')$old$,
    $new$or resource not in ('properties','propertyContacts','jobs','users')
   or (resource='users' and (pages<>1 or page_size>10))$new$),
   ('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)',
    $old$or coalesce(cfg->>'resource','') not in ('properties','propertyContacts','jobs')$old$,
    $new$or coalesce(cfg->>'resource','') not in ('properties','propertyContacts','jobs','users')
     or (cfg->>'resource'='users' and ((cfg->>'maxPages')::integer<>1 or (cfg->>'pageSize')::integer>10))$new$)
  ) as choices(signature,old_list,new_list)
 loop
  body:=pg_get_functiondef(signature::regprocedure);
  occurrences:=(length(body)-length(replace(body,old_list,'')))/length(old_list);
  if occurrences<>1 or position(new_list in body)>0 then
   raise exception 'commusoft_users_authority_contract_changed:%',signature;
  end if;
  execute replace(body,old_list,new_list);
 end loop;
end $migration$;
commit;
