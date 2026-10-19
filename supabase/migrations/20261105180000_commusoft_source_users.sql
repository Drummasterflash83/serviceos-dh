-- Add the provider's documented GET /users as a separate, opt-in retained source
-- collection. Existing contact/job runs and permissions remain unchanged. The
-- absent-by-default learn.inputs.commusoft.users.enabled flag must be explicitly
-- true at approval, credential release and source-page commit. Source users are
-- not OpenFolk staff, logins, assigned engineers or canonical people.
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
   ('public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text)',
    $old$if not found then raise exception 'learn_operator_tenant_inactive' using errcode='55000';end if;$old$,
    $new$if not found then raise exception 'learn_operator_tenant_inactive' using errcode='55000';end if;
  if resource='users' then
   perform 1 from public.feature_flags where tenant_id=p_tenant
    and flag='learn.inputs.commusoft.users.enabled' and value='true'::jsonb for share;
   if not found then raise exception 'learn_operator_module_disabled' using errcode='55000';end if;
  end if;$new$),
   ('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)',
    $old$or coalesce(cfg->>'resource','') not in ('properties','propertyContacts','jobs')$old$,
    $new$or coalesce(cfg->>'resource','') not in ('properties','propertyContacts','jobs','users')
     or (cfg->>'resource'='users' and ((cfg->>'maxPages')::integer<>1 or (cfg->>'pageSize')::integer>10))$new$),
   ('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)',
    $old$if cfg->>'resource'='propertyContacts' then
    if coalesce(cfg->>'contactType','')$old$,
    $new$if cfg->>'resource'='users' then
    perform 1 from public.feature_flags where tenant_id=p_tenant_id
     and flag='learn.inputs.commusoft.users.enabled' and value='true'::jsonb for share;
    if not found then return null;end if;
  end if;
  if cfg->>'resource'='propertyContacts' then
    if coalesce(cfg->>'contactType','')$new$),
   ('public.learn_commusoft_commit_page(uuid,uuid,text,integer,uuid,jsonb)',
    $old$b:=permit.binding; cfg:=b->'approval'; cp:=b->'checkpoint';$old$,
    $new$b:=permit.binding; cfg:=b->'approval'; cp:=b->'checkpoint';
  if cfg->>'resource'='users' then
   perform 1 from public.feature_flags where tenant_id=p_tenant_id
    and flag='learn.inputs.commusoft.users.enabled' and value='true'::jsonb for share;
   if not found then raise exception 'commusoft_module_unavailable' using errcode='42501';end if;
  end if;$new$)
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
