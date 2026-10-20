-- A source-user traversal may need more than its first ten-record page. Each
-- continuation is a separately reasoned operator request and can add exactly
-- one page. The users feature flag is required again before queuing work; the
-- credential-acquire and page-commit checks from 20261105180000 also remain.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare body text; old_list text; new_list text; occurrences integer;
begin
 body:=pg_get_functiondef('public.learn_operator_resume_commusoft(uuid,uuid,uuid,jsonb,text)'::regprocedure);
 old_list:=$old$or coalesce(cfg->>'resource','') not in ('properties','jobs','propertyContacts')$old$;
 new_list:=$new$or coalesce(cfg->>'resource','') not in ('properties','jobs','propertyContacts','users')$new$;
 occurrences:=(length(body)-length(replace(body,old_list,'')))/length(old_list);
 if occurrences<>1 or position(new_list in body)>0 then
  raise exception 'commusoft_users_resume_resource_contract_changed';
 end if;
 body:=replace(body,old_list,new_list);
 old_list:=$old$ if pages<=retained or pages::bigint-retained>10000 or pages<(cfg->>'maxPages')::integer or expiry<(cfg->>'expiresAt')::timestamptz then$old$;
 new_list:=$new$ if cfg->>'resource'='users' then
  perform 1 from public.feature_flags where tenant_id=p_tenant
   and flag='learn.inputs.commusoft.users.enabled' and value='true'::jsonb for share;
  if not found then raise exception 'learn_operator_module_disabled' using errcode='55000';end if;
  if coalesce(cfg->>'pageSize','') !~ '^[0-9]{1,3}$'
   or (cfg->>'pageSize')::integer not between 1 and 10
   or pages<>retained+1 or pages>10000 then
   raise exception 'learn_operator_resume_limits' using errcode='22023';end if;
 end if;
 if pages<=retained or pages::bigint-retained>10000 or pages<(cfg->>'maxPages')::integer or expiry<(cfg->>'expiresAt')::timestamptz then$new$;
 occurrences:=(length(body)-length(replace(body,old_list,'')))/length(old_list);
 if occurrences<>1 or position(new_list in body)>0 then
  raise exception 'commusoft_users_resume_budget_contract_changed';
 end if;
 execute replace(body,old_list,new_list);

 -- Credential release must enforce the same one-page cumulative bound as the
 -- operator continuation. The worker independently rechecks it before GET.
 body:=pg_get_functiondef('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)'::regprocedure);
 old_list:=$old$or (cfg->>'resource'='users' and ((cfg->>'maxPages')::integer<>1 or (cfg->>'pageSize')::integer>10))$old$;
 new_list:=$new$or (cfg->>'resource'='users' and ((cfg->>'maxPages')::integer>10000 or (cfg->>'pageSize')::integer>10))$new$;
 occurrences:=(length(body)-length(replace(body,old_list,'')))/length(old_list);
 if occurrences<>1 or position(new_list in body)>0 then
  raise exception 'commusoft_users_resume_acquire_scope_changed';
 end if;
 body:=replace(body,old_list,new_list);
 old_list:=$old$if pages<0 or pages>=(cfg->>'maxPages')::integer then return null; end if;$old$;
 new_list:=$new$if pages<0 or pages>=(cfg->>'maxPages')::integer
   or (cfg->>'resource'='users' and (cfg->>'maxPages')::integer<>pages+1)
  then return null; end if;$new$;
 occurrences:=(length(body)-length(replace(body,old_list,'')))/length(old_list);
 if occurrences<>1 or position(new_list in body)>0 then
  raise exception 'commusoft_users_resume_acquire_budget_changed';
 end if;
 execute replace(body,old_list,new_list);
end $migration$;
commit;
