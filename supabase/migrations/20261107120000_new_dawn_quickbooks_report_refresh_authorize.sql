begin;

-- A credential refresh is requested only by an authenticated OpenFolk operator
-- who has selected the exact tenant and confirmed accounting connection. The
-- existing service-only refresh lease performs the exchange; this function
-- returns no credential and does not grant a client any accounting access.
create function public.learn_quickbooks_report_refresh_authorize(
 p_tenant uuid,p_connection uuid,p_request uuid,p_realm text,p_environment text,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.learn_quickbooks_connections%rowtype;begin
 if auth.role() is distinct from 'authenticated' or p_request is null or p_connection is null
  or p_realm is null or p_realm !~ '^[1-9][0-9]{0,29}$'
  or p_environment is null or p_environment not in ('sandbox','production')
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'refresh_request_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 select * into c from public.learn_quickbooks_connections
  where id=p_connection and tenant_id=p_tenant and realm_id=p_realm
   and environment=p_environment and status in ('active','paused')
   and confirmed_at is not null and realm_id is not null for share;
 if not found then raise exception 'refresh_connection_unavailable' using errcode='42501';end if;
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'report.refresh_requested',jsonb_build_object(
  'request_id',p_request,'connection_id',c.id,'realm_id',c.realm_id,
  'environment',c.environment,'revision',c.revision,'token_generation',c.token_generation),btrim(p_reason));
 return jsonb_build_object('requestId',p_request,'tenantId',p_tenant,
  'connectionId',c.id,'realmId',c.realm_id,'environment',c.environment);
end $$;

revoke all on function public.learn_quickbooks_report_refresh_authorize(uuid,uuid,uuid,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_report_refresh_authorize(uuid,uuid,uuid,text,text,text)
 to authenticated;
commit;
