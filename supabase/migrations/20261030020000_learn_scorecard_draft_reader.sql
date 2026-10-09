-- Read by saved revision, not created_at: transaction clocks can tie or arrive out of order.
create function public.learn_scorecard_read_draft(p_tenant uuid,p_kind text,p_group uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare selected_value jsonb; selected_revision int; selected_status text; scope_key text;
begin
 if auth.uid() is null or p_tenant is distinct from current_tenant_id()
   or coalesce(current_user_role(),'') not in ('owner','admin') then
   raise exception 'Owner/admin access required' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('member','team','job','customer')
   or (p_group is not null and (p_kind not in ('member','team') or not exists(select 1 from org_units where id=p_group and tenant_id=p_tenant))) then
   raise exception 'Invalid scorecard scope' using errcode='22023';end if;
 scope_key:=p_kind||':'||coalesce(p_group::text,'all');
 select e.value,c.version,c.status into selected_value,selected_revision,selected_status
 from operating_profile_entries e join config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
 where e.tenant_id=p_tenant and e.scope_kind='tenant' and e.scope_ref=scope_key
  and e.namespace='learn_scorecards' and e.key like 'definition.%' and c.artifact_kind='learn_scorecard'
 order by c.version desc,e.id limit 1;
 if not found then return null;end if;
 if selected_status is distinct from 'draft' or selected_value->>'status' is distinct from 'draft'
  or selected_value->>'tenantId' is distinct from p_tenant::text
  or selected_value->>'subjectKind' is distinct from p_kind
  or nullif(selected_value->>'groupId','') is distinct from p_group::text
  or selected_value->>'version' is distinct from selected_revision::text then
  raise exception 'Saved scorecard revision is inconsistent' using errcode='22023';end if;
 return selected_value;
end $$;
revoke all on function public.learn_scorecard_read_draft(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_scorecard_read_draft(uuid,text,uuid) to authenticated;
