-- Complete legacy roster columns where absent; production already has these.
-- The count broker exposes only totals, retaining the raw input-table lockdown.
begin;
alter table public.team_members add column if not exists formal_role_status text not null default 'proposed' check(formal_role_status in ('proposed','confirmed'));
alter table public.team_members add column if not exists target_role text;
create function public.learn_learning_retained_counts(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if p_tenant is null or not exists(select 1 from public.tenants where id=p_tenant) then
  raise exception 'learning_tenant_unavailable' using errcode='42501';end if;
 return jsonb_build_object('version','learn-learning-counts/1','tenant_id',p_tenant,
  'commusoft_versions',(select count(*) from public.learn_business_input_versions where tenant_id=p_tenant and provider='commusoft'),
  'slack_messages',(select count(*) from public.slack_messages where tenant_id=p_tenant));
end$$;
revoke all on function public.learn_learning_retained_counts(uuid) from public,anon,authenticated;
grant execute on function public.learn_learning_retained_counts(uuid) to service_role;
commit;
