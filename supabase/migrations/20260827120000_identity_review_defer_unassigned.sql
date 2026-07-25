-- ============================================================================
-- Identity Resolution V1 — add governed 'deferred' and 'unassigned' review decisions.
-- ============================================================================
-- Part of CONFIRMATION MODE (disabled by default in the edge function). Additive and safe:
-- widens the append-only endpoint_identity_reviews decision vocabulary and the cp_review_identity
-- whitelist so an operator can DEFER (pending more evidence) or mark INTENTIONALLY UNASSIGNED.
-- Both are classification-only outcomes — like 'unresolved', they NEVER create an identity link
-- and NEVER touch ownership. Only 'confirmed_person' creates a member_integration_identities link.
-- NOT deployed until confirmation mode is separately approved.
-- ============================================================================

alter table endpoint_identity_reviews
  drop constraint if exists endpoint_identity_reviews_decision_check;
alter table endpoint_identity_reviews
  add constraint endpoint_identity_reviews_decision_check
  check (decision in (
    'confirmed_person','shared','team','system','rejected','unresolved','deferred','unassigned'
  ));

create or replace function cp_review_identity(
  p_tenant uuid, p_endpoint uuid, p_decision text, p_member uuid, p_confidence text,
  p_evidence jsonb, p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ep communication_endpoints; v_identity_id uuid; v_review_id uuid;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then raise exception 'cp_review_identity: actor is required'; end if;
  if p_decision not in ('confirmed_person','shared','team','system','rejected','unresolved','deferred','unassigned') then
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
  -- shared / team / system / rejected / unresolved / deferred / unassigned record an
  -- operational classification only.
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

-- Re-apply execute lockdown (service_role only) for the redefined SECURITY DEFINER RPC.
revoke execute on function cp_review_identity(uuid,uuid,text,uuid,text,jsonb,text,text,text,boolean)
  from public, anon, authenticated;
grant execute on function cp_review_identity(uuid,uuid,text,uuid,text,jsonb,text,text,text,boolean)
  to service_role;
