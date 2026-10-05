-- ============================================================================
-- ServiceOS / OpenFolk — Control Plane: identity reviews, ownership ending,
-- manual-endpoint editing with optimistic concurrency.
--
-- STRICT SEPARATION preserved end-to-end:
--   • cp_review_identity records an IDENTITY decision (and, only on explicit confirmation,
--     creates a member_integration_identities link). It NEVER creates ownership.
--   • cp_end_ownership ends an OWNERSHIP assignment. It NEVER touches identity.
-- Nothing here auto-confirms or auto-approves — suggestions are computed elsewhere and are
-- review-only; these RPCs run only on an explicit operator decision. Governed + audited;
-- append-only history (no hard-delete). SECURITY DEFINER, service_role-only.
-- ============================================================================

-- ── Identity review decisions (append-only; rejections preserved for audit). ──
create table if not exists endpoint_identity_reviews (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  endpoint_id    uuid not null,
  decision       text not null
                   check (decision in ('confirmed_person','shared','system','rejected','unresolved')),
  team_member_id uuid,                              -- set for confirmed_person / rejected(of a person)
  confidence     text,                              -- high|medium|low|unresolved (from the suggestion)
  evidence       jsonb not null default '{}',
  reason         text,
  actor          text not null,
  correlation_id text,
  created_at     timestamptz not null default now(),
  constraint eir_endpoint_same_tenant
    foreign key (endpoint_id, tenant_id) references communication_endpoints (id, tenant_id) on delete cascade
);
create index if not exists eir_endpoint on endpoint_identity_reviews (endpoint_id, created_at desc);

-- RLS + append-only + execute lockdown, mirroring the base migration.
alter table endpoint_identity_reviews enable row level security;
grant select, insert on endpoint_identity_reviews to service_role;
grant select on endpoint_identity_reviews to authenticated;
drop policy if exists endpoint_identity_reviews_select on endpoint_identity_reviews;
create policy endpoint_identity_reviews_select on endpoint_identity_reviews
  for select to authenticated using (current_user_is_openfolk_operator());
revoke update, delete on endpoint_identity_reviews from anon, authenticated;
create or replace function eir_append_only() returns trigger language plpgsql as $$
begin raise exception 'endpoint_identity_reviews is append-only (identity review history is never edited or deleted)'; end $$;
drop trigger if exists eir_no_mutate on endpoint_identity_reviews;
create trigger eir_no_mutate before update or delete on endpoint_identity_reviews
  for each row execute function eir_append_only();

-- ── cp_review_identity: record a decision; confirm also creates the identity link. ──
create or replace function cp_review_identity(
  p_tenant uuid, p_endpoint uuid, p_decision text, p_member uuid, p_confidence text,
  p_evidence jsonb, p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ep communication_endpoints; v_identity_id uuid; v_review_id uuid;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then raise exception 'cp_review_identity: actor is required'; end if;
  if p_decision not in ('confirmed_person','shared','system','rejected','unresolved') then
    raise exception 'cp_review_identity: invalid decision %', p_decision; end if;
  select * into v_ep from communication_endpoints where id = p_endpoint and tenant_id = p_tenant;
  if not found then raise exception 'cp_review_identity: endpoint not found in tenant'; end if;
  if p_decision = 'confirmed_person' and p_member is null then
    raise exception 'cp_review_identity: confirmed_person requires a team member'; end if;

  insert into endpoint_identity_reviews
    (tenant_id, endpoint_id, decision, team_member_id, confidence, evidence, reason, actor, correlation_id)
  values (p_tenant, p_endpoint, p_decision, p_member, p_confidence, coalesce(p_evidence,'{}'::jsonb), p_reason, p_actor, p_correlation)
  returning id into v_review_id;

  -- ONLY an explicit confirmation creates a governed identity LINK (never ownership).
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

-- ── cp_end_ownership: end an ownership assignment (no hard-delete). ──
create or replace function cp_end_ownership(
  p_tenant uuid, p_assignment uuid, p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row endpoint_ownership_assignments; v_before jsonb;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then raise exception 'cp_end_ownership: actor is required'; end if;
  select * into v_row from endpoint_ownership_assignments where id = p_assignment and tenant_id = p_tenant;
  if not found then raise exception 'cp_end_ownership: assignment not found in tenant'; end if;
  if v_row.effective_to is not null then
    return jsonb_build_object('id', v_row.id, 'outcome', 'already_ended'); end if;
  v_before := to_jsonb(v_row);
  update endpoint_ownership_assignments set effective_to = now() where id = p_assignment;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.ownership.end', 'endpoint_ownership_assignment', p_assignment::text,
     v_before, (select to_jsonb(a) from endpoint_ownership_assignments a where a.id = p_assignment),
     p_reason, p_correlation, coalesce(p_view_as,false), 'controlplane');
  return jsonb_build_object('id', p_assignment, 'outcome', 'ended');
end $$;

-- ── cp_update_manual_endpoint: edit a MANUAL endpoint with optimistic concurrency. ──
-- Rejects a stale write (updated_at moved since the client read it); a no-op makes no
-- material change + no audit; provider-discovered endpoints cannot be edited here.
create or replace function cp_update_manual_endpoint(
  p_tenant uuid, p_endpoint uuid, p_display text, p_provider_context text, p_metadata jsonb,
  p_expected_updated_at timestamptz, p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row communication_endpoints; v_before jsonb; v_after jsonb;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then raise exception 'cp_update_manual_endpoint: actor is required'; end if;
  select * into v_row from communication_endpoints where id = p_endpoint and tenant_id = p_tenant;
  if not found then raise exception 'cp_update_manual_endpoint: endpoint not found in tenant'; end if;
  if v_row.source <> 'manual' then
    raise exception 'cp_update_manual_endpoint: only manual endpoints are editable (this is %; provider evidence is not editable)', v_row.source; end if;
  -- Optimistic concurrency: reject a stale write.
  if p_expected_updated_at is not null and date_trunc('milliseconds', v_row.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'stale_write: endpoint was modified since you loaded it (expected % got %)', p_expected_updated_at, v_row.updated_at; end if;
  v_before := to_jsonb(v_row);
  if v_row.display_value is distinct from coalesce(p_display, v_row.display_value)
     or v_row.provider is distinct from coalesce(p_provider_context, v_row.provider)
     or v_row.metadata is distinct from coalesce(p_metadata, v_row.metadata)
  then
    update communication_endpoints set
      display_value = coalesce(p_display, display_value),
      provider      = coalesce(p_provider_context, provider),
      metadata      = coalesce(p_metadata, metadata)
     where id = p_endpoint;
    select to_jsonb(c) into v_after from communication_endpoints c where c.id = p_endpoint;
    insert into controlplane_change_log
      (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
    values (p_tenant, p_actor, 'controlplane.endpoint.update', 'communication_endpoint', p_endpoint::text,
       v_before, v_after, p_reason, p_correlation, coalesce(p_view_as,false), 'controlplane');
    return jsonb_build_object('id', p_endpoint, 'outcome', 'updated');
  end if;
  return jsonb_build_object('id', p_endpoint, 'outcome', 'unchanged');
end $$;

-- Execute lockdown (service_role only) for the new SECURITY DEFINER RPCs.
do $$
declare fn text;
begin
  foreach fn in array array[
    'cp_review_identity(uuid,uuid,text,uuid,text,jsonb,text,text,text,boolean)',
    'cp_end_ownership(uuid,uuid,text,text,text,boolean)',
    'cp_update_manual_endpoint(uuid,uuid,text,text,jsonb,timestamptz,text,text,text,boolean)']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
