-- ============================================================================
-- ServiceOS / OpenFolk — Control Plane: governed endpoint archive (no hard-delete).
--
-- Manual typed telephony inventory is created/edited through the existing atomic,
-- idempotent cp_upsert_endpoint (source='manual'); deactivation needs its own governed,
-- audited operation that NEVER hard-deletes operational history. cp_archive_endpoint sets
-- status='inactive' + effective_to and appends one change-log row; archiving an already
-- inactive endpoint is a no-op (no audit noise), consistent with the idempotency model.
-- Additive & idempotent; SECURITY DEFINER, service_role-only (same lockdown as cp_*).
-- ============================================================================

create or replace function cp_archive_endpoint(
  p_tenant uuid, p_endpoint_id uuid, p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_after jsonb; v_row communication_endpoints;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_archive_endpoint: actor is required';
  end if;
  select * into v_row from communication_endpoints where id = p_endpoint_id and tenant_id = p_tenant;
  if not found then raise exception 'cp_archive_endpoint: endpoint not found in tenant'; end if;
  if v_row.status = 'inactive' then
    return jsonb_build_object('id', v_row.id, 'outcome', 'unchanged');
  end if;
  v_before := to_jsonb(v_row);
  update communication_endpoints
     set status = 'inactive', effective_to = coalesce(effective_to, now())
   where id = p_endpoint_id;
  select to_jsonb(c) into v_after from communication_endpoints c where c.id = p_endpoint_id;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.endpoint.archive', 'communication_endpoint', p_endpoint_id::text,
     v_before, v_after, p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return jsonb_build_object('id', p_endpoint_id, 'outcome', 'archived');
end $$;

revoke execute on function cp_archive_endpoint(uuid,uuid,text,text,text,boolean) from public, anon, authenticated;
grant  execute on function cp_archive_endpoint(uuid,uuid,text,text,text,boolean) to service_role;
