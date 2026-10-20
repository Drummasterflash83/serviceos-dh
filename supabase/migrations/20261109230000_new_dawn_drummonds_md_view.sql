-- Chris's explicit, read-only Drummonds MD presentation entry. The returned
-- receipt is not a staff identity or a reusable access token: every underlying
-- job and LEARN read still checks and audits OpenFolk operator authority.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.new_dawn_drummonds_md_view_open(
 p_tenant uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid(); started timestamptz:=clock_timestamp();
 audit_id uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'authenticated' or actor is null or p_tenant is null
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'md_view_invalid' using errcode='22023';end if;
 perform 1 from auth.users u where u.id=actor and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=started)
  and lower(u.email)='chris@openfolk.ai' for share;
 if not found then raise exception 'md_view_forbidden' using errcode='42501';end if;
 perform 1 from public.tenants t where t.id=p_tenant and t.slug='drummonds'
  and t.status='active' for share;
 if not found then raise exception 'md_view_forbidden' using errcode='42501';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform 1 from public.feature_flags f where f.tenant_id=p_tenant
  and f.flag='new_dawn.md_view' and f.value='true'::jsonb for share;
 if not found then raise exception 'md_view_disabled' using errcode='42501';end if;
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit_id,p_tenant,actor::text,'client.md_view_open','client_presentation',
  p_tenant::text,jsonb_build_object('read_only',true,'presentation','drummonds_md',
   'expires_at',started+interval '15 minutes'),
  btrim(p_reason),audit_id::text,false,'new-dawn-drummonds-md-view');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-drummonds-md-view/1',
  'tenant_id',p_tenant,'actor_id',actor,'audit_id',audit_id,
  'opened_at',started,'expires_at',started+interval '15 minutes',
  'read_only',true);
end $$;
revoke all on function public.new_dawn_drummonds_md_view_open(uuid,text)
 from public,anon,service_role;
grant execute on function public.new_dawn_drummonds_md_view_open(uuid,text)
 to authenticated;
commit;
