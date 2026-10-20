-- Operator-only saved ID/freshness read for one isolated Commusoft /users page.
-- Raw source payloads, staff identities and appointment claims are excluded.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.new_dawn_commusoft_users_page_saved(
 p_tenant uuid,p_connection uuid,p_request uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();r public.new_dawn_commusoft_users_page_reads%rowtype;
 versions jsonb:='[]'::jsonb;audit uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'authenticated' or actor is null or
  p_tenant is null or p_connection is null or p_request is null then
  raise exception 'users_page_saved_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform public.new_dawn_commusoft_job_actor_access(p_tenant,actor);
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='learn.enabled' and value='true'::jsonb for share;
 if not found then raise exception 'users_page_saved_off' using errcode='42501';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='learn.inputs.commusoft.enabled' and value='true'::jsonb for share;
 if not found then raise exception 'users_page_saved_off' using errcode='42501';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='learn.inputs.commusoft.users.enabled' and value='true'::jsonb for share;
 if not found then raise exception 'users_page_saved_off' using errcode='42501';end if;
 select * into r from public.new_dawn_commusoft_users_page_reads
  where id=p_request and tenant_id=p_tenant and connection_id=p_connection
   and actor_id=actor;
 if not found then raise exception 'users_page_saved_unavailable' using errcode='42501';end if;
 if r.state='complete' then
  select coalesce(jsonb_agg(jsonb_build_object('source_user_id',v.external_id,
   'observed_at',v.observed_at) order by v.ordinal),'[]'::jsonb) into versions
   from public.new_dawn_commusoft_users_page_versions v
   where v.request_id=r.id and v.tenant_id=p_tenant and v.connection_id=p_connection;
  if jsonb_array_length(versions) is distinct from r.record_count or
   r.record_count not between 0 and 10 or r.checked_at is null then
   raise exception 'users_page_saved_changed' using errcode='22023';end if;
 end if;
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'commusoft.users_page_saved_read',
  'provider_connections',p_connection::text,
  jsonb_build_object('request_id',r.id,'state',r.state,'record_count',r.record_count),
  r.reason,audit::text,false,'new-dawn-commusoft-users-page-saved');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','commusoft-isolated-users-page-saved/1',
  'scope','source_identity_only','tenant_id',p_tenant,'connection_id',p_connection,
  'request_id',r.id,'state',r.state,'checked_at',r.checked_at,
  'record_count',r.record_count,'has_more',r.has_more,
  'source_users',versions,'audit_id',audit);
end $$;
revoke all on function public.new_dawn_commusoft_users_page_saved(uuid,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_commusoft_users_page_saved(uuid,uuid,uuid)
 to authenticated;
commit;
