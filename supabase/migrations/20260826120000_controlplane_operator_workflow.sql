-- ============================================================================
-- ServiceOS / OpenFolk — Control Plane: complete the operator workflow.
--
-- Additive to migration 20260825120000. Three governed changes, all preserving the
-- STRICT identity↔ownership separation and the append-only / no-hard-delete model:
--   1. `team` becomes a valid identity-review decision (Mark team/group) — an operational
--      classification, still NOT an ownership assignment.
--   2. cp_end_ownership gains an explicit effective-end date AND optimistic concurrency
--      (a stale end request fails safely; an already-ended assignment is a safe no-op).
--   3. cp_restore_endpoint reactivates an archived MANUAL endpoint (provider evidence is
--      never restorable here), mirroring cp_archive_endpoint.
-- SECURITY DEFINER, service_role-only (same lockdown as the other cp_* RPCs).
-- ============================================================================

-- ── (1) `team` is a valid review decision (operational classification only). ──
alter table endpoint_identity_reviews
  drop constraint if exists endpoint_identity_reviews_decision_check;
alter table endpoint_identity_reviews
  add constraint endpoint_identity_reviews_decision_check
  check (decision in ('confirmed_person','shared','team','system','rejected','unresolved'));

create or replace function cp_review_identity(
  p_tenant uuid, p_endpoint uuid, p_decision text, p_member uuid, p_confidence text,
  p_evidence jsonb, p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ep communication_endpoints; v_identity_id uuid; v_review_id uuid;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then raise exception 'cp_review_identity: actor is required'; end if;
  if p_decision not in ('confirmed_person','shared','team','system','rejected','unresolved') then
    raise exception 'cp_review_identity: invalid decision %', p_decision; end if;
  select * into v_ep from communication_endpoints where id = p_endpoint and tenant_id = p_tenant;
  if not found then raise exception 'cp_review_identity: endpoint not found in tenant'; end if;
  if p_decision = 'confirmed_person' and p_member is null then
    raise exception 'cp_review_identity: confirmed_person requires a team member'; end if;

  insert into endpoint_identity_reviews
    (tenant_id, endpoint_id, decision, team_member_id, confidence, evidence, reason, actor, correlation_id)
  values (p_tenant, p_endpoint, p_decision, p_member, p_confidence, coalesce(p_evidence,'{}'::jsonb), p_reason, p_actor, p_correlation)
  returning id into v_review_id;

  -- ONLY an explicit person confirmation creates a governed identity LINK (never ownership).
  -- shared / team / system / rejected / unresolved record an operational classification only.
  if p_decision = 'confirmed_person' then
    insert into member_integration_identities
      (tenant_id, team_member_id, provider, identity_kind, external_ref, primary_login, verification_state, source)
    values (p_tenant, p_member, coalesce(v_ep.provider, v_ep.channel, 'directory'), 'user',
       v_ep.normalized_value, v_ep.normalized_value, 'verified', 'openfolk-review')
    returning id into v_identity_id;
  end if;

  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.identity.review', 'communication_endpoint', p_endpoint::text,
     jsonb_build_object('endpoint', v_ep.normalized_value),
     jsonb_build_object('decision', p_decision, 'team_member_id', p_member, 'identity_link', v_identity_id),
     p_reason, p_correlation, coalesce(p_view_as,false), 'controlplane');

  return jsonb_build_object('review_id', v_review_id, 'identity_id', v_identity_id, 'decision', p_decision);
end $$;

-- ── (2) cp_end_ownership: explicit end date + optimistic concurrency (no hard-delete). ──
drop function if exists cp_end_ownership(uuid,uuid,text,text,text,boolean);
create or replace function cp_end_ownership(
  p_tenant uuid, p_assignment uuid, p_effective_to timestamptz, p_expected_updated_at timestamptz,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row endpoint_ownership_assignments; v_before jsonb; v_end timestamptz;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then raise exception 'cp_end_ownership: actor is required'; end if;
  select * into v_row from endpoint_ownership_assignments where id = p_assignment and tenant_id = p_tenant;
  if not found then raise exception 'cp_end_ownership: assignment not found in tenant'; end if;
  -- Optimistic concurrency: reject a stale end request (assignment moved since it was read).
  if p_expected_updated_at is not null
     and date_trunc('milliseconds', v_row.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'stale_write: assignment was modified since you loaded it (expected % got %)', p_expected_updated_at, v_row.updated_at; end if;
  -- Already-ended is a safe no-op (idempotent), not an error.
  if v_row.effective_to is not null then
    return jsonb_build_object('id', v_row.id, 'outcome', 'already_ended', 'effective_to', v_row.effective_to); end if;
  v_end := coalesce(p_effective_to, now());
  if v_end < v_row.effective_from then
    raise exception 'cp_end_ownership: effective_to % precedes effective_from %', v_end, v_row.effective_from; end if;
  v_before := to_jsonb(v_row);
  update endpoint_ownership_assignments set effective_to = v_end where id = p_assignment;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.ownership.end', 'endpoint_ownership_assignment', p_assignment::text,
     v_before, (select to_jsonb(a) from endpoint_ownership_assignments a where a.id = p_assignment),
     p_reason, p_correlation, coalesce(p_view_as,false), 'controlplane');
  return jsonb_build_object('id', p_assignment, 'outcome', 'ended', 'effective_to', v_end);
end $$;

-- ── (3) cp_restore_endpoint: reactivate an archived MANUAL endpoint. ──
create or replace function cp_restore_endpoint(
  p_tenant uuid, p_endpoint_id uuid, p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row communication_endpoints; v_before jsonb; v_after jsonb;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then raise exception 'cp_restore_endpoint: actor is required'; end if;
  select * into v_row from communication_endpoints where id = p_endpoint_id and tenant_id = p_tenant;
  if not found then raise exception 'cp_restore_endpoint: endpoint not found in tenant'; end if;
  if v_row.source <> 'manual' then
    raise exception 'cp_restore_endpoint: only manual endpoints can be restored (this is %; provider evidence is not restorable here)', v_row.source; end if;
  if v_row.status = 'active' then
    return jsonb_build_object('id', v_row.id, 'outcome', 'unchanged'); end if;
  v_before := to_jsonb(v_row);
  update communication_endpoints set status = 'active', effective_to = null where id = p_endpoint_id;
  select to_jsonb(c) into v_after from communication_endpoints c where c.id = p_endpoint_id;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.endpoint.restore', 'communication_endpoint', p_endpoint_id::text,
     v_before, v_after, p_reason, p_correlation, coalesce(p_view_as,false), 'controlplane');
  return jsonb_build_object('id', p_endpoint_id, 'outcome', 'restored');
end $$;

-- Execute lockdown (service_role only) for the changed/added SECURITY DEFINER RPCs.
do $$
declare fn text;
begin
  foreach fn in array array[
    'cp_review_identity(uuid,uuid,text,uuid,text,jsonb,text,text,text,boolean)',
    'cp_end_ownership(uuid,uuid,timestamptz,timestamptz,text,text,text,boolean)',
    'cp_restore_endpoint(uuid,uuid,text,text,text,boolean)']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
