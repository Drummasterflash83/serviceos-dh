-- ============================================================================
-- OpenFolk Control Plane v1 — universal, additive schema
-- ============================================================================
-- The OpenFolk-operated managed-service layer: a canonical, EFFECTIVE-DATED map
-- between a tenant's staff (team_members), their external-system identities, their
-- communication endpoints (phone/email/Slack/…), and effective-dated operational
-- OWNERSHIP of those endpoints — plus an append-only handoff log and an immutable
-- config-change ledger. The Command Centre consumes a pure resolver over this, rather
-- than hardcoded config or classifier guesses.
--
-- DESIGN DECISIONS (approved):
--   • Staff anchor = team_members (profile_id nullable ⇒ a member needs no login). No
--     second user/employee model. No team_members↔graph_nodes bridge in this increment
--     (keys designed so it can be added later without rework).
--   • Discovery layer (telephony_inventory/directory, google_workspace_mailboxes, …)
--     stays the source of DISCOVERED endpoints; canonical OWNERSHIP lives here. An
--     idempotent adapter upserts discovered endpoints into communication_endpoints.
--     Nothing here deletes or destructively migrates existing telephony/email data.
--   • Access is OPENFOLK-OPERATOR ONLY. Tenant users / admins / superadmins CANNOT read
--     raw Control Plane tables (RLS gates on current_user_is_openfolk_operator(), NOT
--     on tenant membership). Writes are service-role only, via an OpenFolk-gated fn.
--   • Static endpoint ownership roles are accountable | primary_handler | cover |
--     escalation ONLY. waiting_on / dynamic contributor / final-resolver are DYNAMIC
--     (interactions / commitments / handoffs), never endpoint config.
--   • Everything additive & idempotent. Reuses set_updated_at(), the decision_log
--     append-only trigger pattern, and audit_logs conventions.
-- ============================================================================

-- Preflight: exclusive-ownership overlap protection REQUIRES btree_gist. Fail loudly
-- (before any DDL) on a database that cannot provide it, rather than half-applying.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'btree_gist') then
    raise exception 'btree_gist is required (exclusive-ownership overlap protection) but is not available on this database';
  end if;
end $$;
create extension if not exists btree_gist with schema extensions;

-- ── Tenant-safe composite keys on existing anchors (additive; id already unique). ─
-- These let Control Plane FKs enforce "owner belongs to the same tenant" declaratively.
create unique index if not exists team_members_id_tenant_uk on team_members (id, tenant_id);
create unique index if not exists org_units_id_tenant_uk on org_units (id, tenant_id);

-- ── Platform (OpenFolk) operator authority — DISTINCT from tenant authority. ──
-- A coarse profiles.role='openfolk' is NOT sufficient; an explicit, effective-dated
-- platform grant is also required. Vocabulary lives in the existing authority_permissions
-- registry under category 'platform'.
insert into authority_permissions (permission, category, description) values
  ('platform.controlplane.view','platform','OpenFolk operator: read the Control Plane'),
  ('platform.controlplane.admin','platform','OpenFolk operator: administer the Control Plane')
on conflict (permission) do nothing;

create table if not exists platform_authority_grants (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references profiles(id) on delete cascade,
  permission     text not null references authority_permissions(permission),
  effective_from timestamptz not null default now(),
  effective_to   timestamptz,                       -- null = active; revoke = set this
  granted_by     text not null,                     -- real actor who granted (email/id)
  reason         text,
  source         text not null default 'openfolk',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- At most one ACTIVE grant of a permission per operator.
create unique index if not exists pag_active_uk
  on platform_authority_grants (profile_id, permission)
  where effective_to is null;
create index if not exists pag_profile on platform_authority_grants (profile_id);
drop trigger if exists pag_set_updated_at on platform_authority_grants;
create trigger pag_set_updated_at before update on platform_authority_grants
  for each row execute function set_updated_at();

-- OpenFolk-operator resolver (RLS + edge gate). Requires role='openfolk' AND an ACTIVE
-- grant. admin implies view. SECURITY DEFINER, fixed search_path, answers only about
-- the calling user (auth.uid()).
create or replace function current_user_is_openfolk_operator(required_permission text default 'platform.controlplane.view')
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join public.platform_authority_grants g on g.profile_id = p.id
    where p.id = auth.uid()
      and p.role = 'openfolk'
      and (
        g.permission = required_permission
        or (required_permission = 'platform.controlplane.view'
            and g.permission = 'platform.controlplane.admin')
      )
      and coalesce(g.effective_from, '-infinity'::timestamptz) <= now()
      and coalesce(g.effective_to,   'infinity'::timestamptz)  >  now()
  );
$$;

-- ── Staff integration identities (member ↔ external-system account). ─────────
-- No raw credentials — secrets remain in the existing Vault/integration system.
create table if not exists member_integration_identities (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  team_member_id     uuid not null,
  provider           text not null,   -- google_workspace|microsoft365|slack|voip|commusoft|other
  identity_kind      text not null default 'user' check (identity_kind in ('user','service','shared')),
  external_ref       text not null,   -- provider account id
  display            text,
  primary_login      text,            -- email/username (NEVER a secret)
  provider_metadata  jsonb not null default '{}',
  verification_state text not null default 'unverified'
                       check (verification_state in ('unverified','verified','rejected','conflicted')),
  confidence         numeric check (confidence is null or (confidence between 0 and 1)),
  source             text not null default 'openfolk',
  effective_from     timestamptz not null default now(),
  effective_to       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Identity's tenant must match its team member's tenant (declarative).
  constraint mii_member_same_tenant
    foreign key (team_member_id, tenant_id) references team_members (id, tenant_id) on delete cascade
);
create index if not exists mii_member on member_integration_identities (tenant_id, team_member_id);
create index if not exists mii_lookup on member_integration_identities (tenant_id, provider, external_ref);
-- One ACTIVE user-identity per (tenant, provider, external_ref): a person account can't
-- be exclusively assigned to two members. Shared/service identities are exempt.
create unique index if not exists mii_active_user_uk
  on member_integration_identities (tenant_id, provider, external_ref)
  where effective_to is null and identity_kind = 'user';
drop trigger if exists mii_set_updated_at on member_integration_identities;
create trigger mii_set_updated_at before update on member_integration_identities
  for each row execute function set_updated_at();

-- ── Canonical cross-channel communication endpoints. ────────────────────────
create table if not exists communication_endpoints (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  channel               text not null,   -- phone|email|slack|other
  endpoint_kind         text not null,   -- email|email_alias|shared_mailbox|group_address|
                                         -- slack_user|slack_channel|ddi|extension|queue|
                                         -- ring_group|voicemail|sip|other
  normalized_value      text not null,   -- E.164 | lower-case email | provider id | norm. ext
  display_value         text,
  provider              text,
  provider_external_ref text,            -- e.g. telephony_inventory.provider_object_id / mailbox id
  is_shared             boolean not null default false,
  status                text not null default 'active' check (status in ('active','inactive')),
  source                text not null default 'openfolk',
  source_object_ref     text,            -- telephony_inventory.id / google_workspace_mailboxes.id
  metadata              jsonb not null default '{}',
  effective_from        timestamptz not null default now(),
  effective_to          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Tenant-safe composite key so ownership can FK (endpoint_id, tenant_id).
  unique (id, tenant_id)
);
create index if not exists ce_tenant on communication_endpoints (tenant_id, channel, endpoint_kind);
-- Dedup: one ACTIVE endpoint per provider external id, and per normalized value/kind.
create unique index if not exists ce_active_provider_uk
  on communication_endpoints (tenant_id, provider, provider_external_ref)
  where status = 'active' and provider_external_ref is not null;
create unique index if not exists ce_active_value_uk
  on communication_endpoints (tenant_id, channel, endpoint_kind, normalized_value)
  where status = 'active';
drop trigger if exists ce_set_updated_at on communication_endpoints;
create trigger ce_set_updated_at before update on communication_endpoints
  for each row execute function set_updated_at();

-- ── Effective-dated endpoint ownership. ─────────────────────────────────────
create table if not exists endpoint_ownership_assignments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  endpoint_id       uuid not null,
  owner_kind        text not null check (owner_kind in ('person','team','role','shared')),
  owner_member_id   uuid,
  owner_org_unit_id uuid,
  owner_role        text,
  assignment_role   text not null check (assignment_role in ('accountable','primary_handler','cover','escalation')),
  exclusive         boolean not null default true,
  effective_from    timestamptz not null default now(),
  effective_to      timestamptz,
  confidence        numeric check (confidence is null or (confidence between 0 and 1)),
  provenance        text not null default 'openfolk',
  review_state      text not null default 'proposed' check (review_state in ('proposed','confirmed','conflicted','rejected')),
  reason            text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Endpoint + all owner refs must be in the SAME tenant (declarative).
  constraint eoa_endpoint_same_tenant
    foreign key (endpoint_id, tenant_id) references communication_endpoints (id, tenant_id) on delete cascade,
  constraint eoa_member_same_tenant
    foreign key (owner_member_id, tenant_id) references team_members (id, tenant_id) on delete set null,
  constraint eoa_org_same_tenant
    foreign key (owner_org_unit_id, tenant_id) references org_units (id, tenant_id) on delete set null,
  -- EXACTLY the applicable owner reference must be set for the kind — no missing owner,
  -- no incompatible/multiple owners. (Cross-tenant owners are rejected by the FKs above.)
  constraint eoa_owner_ref_matches_kind check (
    (owner_kind = 'person' and owner_member_id is not null and owner_org_unit_id is null and owner_role is null) or
    (owner_kind = 'team'   and owner_org_unit_id is not null and owner_member_id is null and owner_role is null) or
    (owner_kind = 'role'   and owner_role is not null       and owner_member_id is null and owner_org_unit_id is null) or
    (owner_kind = 'shared' and owner_member_id is null and owner_org_unit_id is null and owner_role is null)
  )
);
create index if not exists eoa_endpoint on endpoint_ownership_assignments (tenant_id, endpoint_id, assignment_role);
create index if not exists eoa_member on endpoint_ownership_assignments (tenant_id, owner_member_id);
-- TRUE temporal non-overlap for the EXCLUSIVE accountable owner of an endpoint: no two
-- exclusive-accountable assignments may have overlapping effective windows. (Non-exclusive
-- / non-accountable roles — cover, escalation, shared — may coexist.) Uses btree_gist.
alter table endpoint_ownership_assignments drop constraint if exists eoa_no_overlap_accountable;
alter table endpoint_ownership_assignments add constraint eoa_no_overlap_accountable
  exclude using gist (
    endpoint_id with =,
    tstzrange(effective_from, coalesce(effective_to, 'infinity'::timestamptz)) with &&
  ) where (assignment_role = 'accountable' and exclusive and review_state <> 'rejected');
drop trigger if exists eoa_set_updated_at on endpoint_ownership_assignments;
create trigger eoa_set_updated_at before update on endpoint_ownership_assignments
  for each row execute function set_updated_at();

-- ── Responsibility handoffs (append-only evidence of movement). ─────────────
create table if not exists responsibility_handoffs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  subject_type       text,             -- interaction|commitment|endpoint
  subject_ref        text,
  source_endpoint_id uuid references communication_endpoints(id) on delete set null,
  from_party         jsonb,            -- {kind:'person|team|role|external', ref}
  to_party           jsonb,
  from_endpoint_id   uuid references communication_endpoints(id) on delete set null,
  to_endpoint_id     uuid references communication_endpoints(id) on delete set null,
  handoff_type       text not null check (handoff_type in (
                        'phone_transfer','call_pickup','queue_route','voicemail_route',
                        'email_forward','mailbox_delegation','slack_handoff','commitment_delegation')),
  occurred_at        timestamptz,
  observed_state     text not null default 'observed' check (observed_state in ('observed','confirmed','rejected')),
  reason             text,
  evidence           jsonb not null default '{}',
  provider_event_ref text,
  confidence         numeric check (confidence is null or (confidence between 0 and 1)),
  provenance         text not null default 'observed',
  actor              text,             -- set when human-confirmed
  created_at         timestamptz not null default now()
);
create index if not exists rh_tenant on responsibility_handoffs (tenant_id, occurred_at desc);
create index if not exists rh_subject on responsibility_handoffs (tenant_id, subject_type, subject_ref);

-- ── Immutable Control Plane config-change ledger. ───────────────────────────
create table if not exists controlplane_change_log (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid references tenants(id) on delete cascade,  -- null = platform-level change
  actor          text not null,        -- REAL authenticated operator (never a View-As subject)
  action         text not null,        -- controlplane.endpoint.map | controlplane.member.upsert | ...
  resource_type  text not null,
  resource_id    text,
  before         jsonb not null default '{}',
  after          jsonb not null default '{}',
  reason         text,
  effective_at   timestamptz,
  correlation_id text,
  view_as_active boolean not null default false,
  source         text not null default 'controlplane',
  created_at     timestamptz not null default now()
);
create index if not exists cpcl_tenant on controlplane_change_log (tenant_id, created_at desc);
create index if not exists cpcl_resource on controlplane_change_log (resource_type, resource_id);

-- ── Append-only enforcement for the change log + handoffs (decision_log pattern). ─
create or replace function controlplane_append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only (Control Plane history is never edited or deleted)', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['controlplane_change_log','responsibility_handoffs']
  loop
    execute format('drop trigger if exists %I on %I', t||'_no_update', t);
    execute format('create trigger %I before update on %I for each row execute function controlplane_append_only()', t||'_no_update', t);
    execute format('drop trigger if exists %I on %I', t||'_no_delete', t);
    execute format('create trigger %I before delete on %I for each row execute function controlplane_append_only()', t||'_no_delete', t);
  end loop;
end $$;

-- ── Grants (hosted-parity): service_role writes; authenticated SELECT gated by RLS to
-- OpenFolk operators only; anon nothing. Append-only tables also revoke update/delete. ─
do $$
declare t text;
begin
  foreach t in array array[
    'platform_authority_grants','member_integration_identities','communication_endpoints',
    'endpoint_ownership_assignments','responsibility_handoffs','controlplane_change_log']
  loop
    execute format('grant select, insert, update, delete on %I to service_role', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
  -- Defense in depth: history tables are immutable even to the service role (trigger),
  -- and no role may UPDATE/DELETE them via the API.
  foreach t in array array['controlplane_change_log','responsibility_handoffs']
  loop
    execute format('revoke update, delete on %I from anon, authenticated', t);
  end loop;
end $$;

-- ── RLS: OPENFOLK-OPERATOR read only. NOT tenant users/admins/superadmins. ──
-- Writes are service-role only (no write policies). This is the §3 access refinement:
-- tenant Superadmins must NOT browse raw Control Plane configuration.
do $$
declare t text;
begin
  foreach t in array array[
    'platform_authority_grants','member_integration_identities','communication_endpoints',
    'endpoint_ownership_assignments','responsibility_handoffs','controlplane_change_log']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_select', t);
    execute format('create policy %I on %I for select to authenticated using (current_user_is_openfolk_operator())', t||'_select', t);
  end loop;
end $$;

-- ── Atomic write RPCs (mutation + immutable change-log in ONE transaction). ──
-- A Control Plane write MUST NOT commit the configuration change without its change-log
-- record (and vice versa). PostgREST performs each JS-client call in its own
-- transaction, so multi-statement atomicity requires these SECURITY DEFINER functions —
-- one DB call = one transaction. The OpenFolk edge function authorises (real actor +
-- active platform.controlplane.admin grant + no active View-As) BEFORE calling these
-- with the service role. EXECUTE is revoked from anon/authenticated so they are not a
-- back door around the edge gate.

create or replace function cp_upsert_endpoint(
  p_tenant uuid, p_channel text, p_endpoint_kind text, p_normalized text,
  p_display text, p_provider text, p_provider_ref text, p_is_shared boolean,
  p_source text, p_source_object_ref text, p_metadata jsonb,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_before jsonb := '{}'::jsonb; v_row communication_endpoints;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_upsert_endpoint: actor is required';
  end if;
  select * into v_row from communication_endpoints
   where tenant_id = p_tenant and status = 'active'
     and ( (p_provider_ref is not null and provider is not distinct from p_provider and provider_external_ref = p_provider_ref)
        or (channel = p_channel and endpoint_kind = p_endpoint_kind and normalized_value = p_normalized) )
   limit 1;
  if found then
    v_id := v_row.id; v_before := to_jsonb(v_row);
    update communication_endpoints set
      display_value         = coalesce(p_display, display_value),
      provider              = coalesce(p_provider, provider),
      provider_external_ref = coalesce(p_provider_ref, provider_external_ref),
      is_shared             = coalesce(p_is_shared, is_shared),
      source_object_ref     = coalesce(p_source_object_ref, source_object_ref),
      metadata              = coalesce(p_metadata, metadata)
     where id = v_id;
  else
    insert into communication_endpoints
      (tenant_id, channel, endpoint_kind, normalized_value, display_value, provider,
       provider_external_ref, is_shared, source, source_object_ref, metadata)
    values (p_tenant, p_channel, p_endpoint_kind, p_normalized, p_display, p_provider,
       p_provider_ref, coalesce(p_is_shared, false), coalesce(p_source, 'openfolk'),
       p_source_object_ref, coalesce(p_metadata, '{}'::jsonb))
    returning id into v_id;
  end if;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.endpoint.upsert', 'communication_endpoint', v_id::text,
     v_before, (select to_jsonb(c) from communication_endpoints c where c.id = v_id),
     p_reason, p_correlation, coalesce(p_view_as, false), coalesce(p_source, 'controlplane'));
  return v_id;
end $$;

create or replace function cp_upsert_member(
  p_tenant uuid, p_member_id uuid, p_display_name text, p_org_unit uuid,
  p_formal_role text, p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_before jsonb := '{}'::jsonb; v_row team_members;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then raise exception 'cp_upsert_member: actor is required'; end if;
  if p_member_id is not null then
    select * into v_row from team_members where id = p_member_id and tenant_id = p_tenant;
    if not found then raise exception 'cp_upsert_member: member not found in tenant'; end if;
    v_id := v_row.id; v_before := to_jsonb(v_row);
    update team_members set
      display_name = coalesce(p_display_name, display_name),
      org_unit_id  = coalesce(p_org_unit, org_unit_id),
      formal_role  = coalesce(p_formal_role, formal_role)
     where id = v_id;
  else
    insert into team_members (tenant_id, display_name, org_unit_id, formal_role, source)
    values (p_tenant, p_display_name, p_org_unit, p_formal_role, 'openfolk')
    returning id into v_id;
  end if;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.member.upsert', 'team_member', v_id::text,
     v_before, (select to_jsonb(m) from team_members m where m.id = v_id),
     p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return v_id;
end $$;

create or replace function cp_upsert_identity(
  p_tenant uuid, p_member uuid, p_provider text, p_identity_kind text, p_external_ref text,
  p_display text, p_primary_login text, p_verification text,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then raise exception 'cp_upsert_identity: actor is required'; end if;
  insert into member_integration_identities
    (tenant_id, team_member_id, provider, identity_kind, external_ref, display, primary_login, verification_state, source)
  values (p_tenant, p_member, p_provider, coalesce(p_identity_kind,'user'), p_external_ref, p_display, p_primary_login,
     coalesce(p_verification,'unverified'), 'openfolk')
  returning id into v_id;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.identity.upsert', 'member_integration_identity', v_id::text,
     '{}'::jsonb, (select to_jsonb(i) from member_integration_identities i where i.id = v_id),
     p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return v_id;
end $$;

create or replace function cp_assign_ownership(
  p_tenant uuid, p_endpoint uuid, p_owner_kind text, p_member uuid, p_org_unit uuid, p_role text,
  p_assignment_role text, p_exclusive boolean, p_effective_from timestamptz, p_confidence numeric,
  p_review_state text, p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_from timestamptz := coalesce(p_effective_from, now()); v_ended jsonb := '{}'::jsonb;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then raise exception 'cp_assign_ownership: actor is required'; end if;
  -- Exclusive accountable: end the currently-active one first (history preserved),
  -- so the new assignment does not trip the temporal-overlap exclusion constraint.
  if p_assignment_role = 'accountable' and coalesce(p_exclusive, true) then
    with ended as (
      update endpoint_ownership_assignments
         set effective_to = v_from
       where tenant_id = p_tenant and endpoint_id = p_endpoint
         and assignment_role = 'accountable' and exclusive
         and effective_to is null and review_state <> 'rejected'
      returning id
    ) select coalesce(jsonb_agg(id), '[]'::jsonb) into v_ended from ended;
  end if;
  insert into endpoint_ownership_assignments
    (tenant_id, endpoint_id, owner_kind, owner_member_id, owner_org_unit_id, owner_role,
     assignment_role, exclusive, effective_from, confidence, provenance, review_state, reason)
  values (p_tenant, p_endpoint, p_owner_kind, p_member, p_org_unit, p_role,
     p_assignment_role, coalesce(p_exclusive, true), v_from, p_confidence, 'openfolk',
     coalesce(p_review_state, 'confirmed'), p_reason)
  returning id into v_id;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.ownership.assign', 'endpoint_ownership_assignment', v_id::text,
     jsonb_build_object('ended_prior', v_ended),
     (select to_jsonb(o) from endpoint_ownership_assignments o where o.id = v_id),
     p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return v_id;
end $$;

-- EXECUTE only for the service role (the edge function authorises first). No direct
-- tenant/anon access — these bypass RLS by design (SECURITY DEFINER).
do $$
declare fn text;
begin
  foreach fn in array array[
    'cp_upsert_endpoint(uuid,text,text,text,text,text,text,boolean,text,text,jsonb,text,text,text,boolean)',
    'cp_upsert_member(uuid,uuid,text,uuid,text,text,text,text,boolean)',
    'cp_upsert_identity(uuid,uuid,text,text,text,text,text,text,text,text,text,boolean)',
    'cp_assign_ownership(uuid,uuid,text,uuid,uuid,text,text,boolean,timestamptz,numeric,text,text,text,text,boolean)']
  loop
    -- Postgres grants EXECUTE to PUBLIC by default — revoke that too, or authenticated
    -- (a PUBLIC member) could call these SECURITY DEFINER writers directly and bypass
    -- the OpenFolk edge gate.
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- ── Single authoritative ownership source + compatibility view. ─────────────
-- DECLARED: communication_endpoints + endpoint_ownership_assignments is THE authoritative
-- ownership source going forward. telephony_directory / user_voice_endpoints remain their
-- existing live-call-routing consumers' DISCOVERY inputs only and are NOT dual-maintained
-- for Control Plane ownership. This read-only view exposes current canonical ownership in a
-- simple shape for any reader; security_invoker=true keeps it OpenFolk-operator-gated.
create or replace view controlplane_current_ownership_v
  with (security_invoker = true) as
  select o.tenant_id, o.endpoint_id, e.channel, e.endpoint_kind, e.normalized_value,
         e.display_value, e.provider, e.provider_external_ref, e.is_shared,
         o.assignment_role, o.owner_kind, o.owner_member_id, o.owner_org_unit_id, o.owner_role,
         o.effective_from, o.confidence, o.review_state
    from endpoint_ownership_assignments o
    join communication_endpoints e on e.id = o.endpoint_id
   where o.effective_to is null and o.review_state <> 'rejected' and e.status = 'active';
grant select on controlplane_current_ownership_v to authenticated, service_role;

-- No tenant Health policy, staff record, endpoint or grant is seeded here. Real tenant
-- configuration (Drummonds staff/endpoints/ownership) is performed by an OpenFolk
-- operator through the Control Plane UI; local tests seed synthetic fixtures. Platform
-- authority is granted out-of-band by an operator (scripts/openfolk-grant-operator.sh),
-- never seeded with a personal identity in this universal migration.
