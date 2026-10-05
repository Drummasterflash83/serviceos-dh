-- ServiceOS — Marketing Phase 3: Settings, access administration, lifecycle
-- configuration, tag governance, versioned dynamic segments, canonical contact
-- imports and audit history.
--
-- Everything stays tenant-scoped, provider-neutral and canonical (People +
-- Companies remain the identity model; the governed `data-import` engine is
-- extended, never duplicated). All mutation paths are service-role-only SQL
-- RPCs behind purpose-specific Edge Functions; browsers get tenant-scoped
-- reads only. This migration is a normal RUN-ONCE release migration: no
-- destructive drops, no draft self-upgrades.
--
-- Contracts (docs/product/marketing-crm/IMPLEMENTATION_LEDGER.md §12; this is
-- the CORRECTION-PASSED draft — the original Phase 3 draft's defects and their
-- fixes are recorded in the ledger):
--  - SETTINGS: one governed update RPC with mandatory expected_version (stale →
--    MK409), STRICT JSON scalar types (explicit null rejected; string "true"
--    is never a boolean), quiet_hours restricted to exactly {start,end} whole
--    hours, IANA-validated timezone, active tenant-stage default, HTML-free
--    bounded footer/notification fields, WHOLE-OPERATION NO-OPS rejected
--    before any history/audit/event, and REAL history — every change snapshots
--    the previous row into marketing_settings_history, which is STRUCTURALLY
--    BOUND to the same tenant's settings row (composite FK) with one history
--    row per superseded version; updates raise and no client role can delete
--    (tenant cascade cleanup stays possible).
--  - ACCESS ADMIN: per-tenant advisory-lock serialisation BEFORE grant-state
--    reads (two managers can never concurrently deny each other past the
--    lockout check); restricted permissions (campaigns.launch/senders.manage/
--    access.manage) owner/admin-only in the RESOLVER; a VIEWER READ CEILING in
--    the resolver AND the grant RPC (a viewer can effectively hold only
--    marketing.view / marketing.reporting.view — hostile raw write-grant rows
--    are inert); exact no-op changes return idempotently without duplicate
--    audits; lockout protection MK423.
--  - LIFECYCLE ADMIN: per-op argument allowlists; stable keys immutable; no
--    hard deletes; template rows untouched; the default stage is ONE ATOMIC
--    INVARIANT across marketing_lifecycle_stages.is_default AND
--    marketing_settings.default_lifecycle_stage_key (both governed paths move
--    both representations in one transaction, with settings history + a
--    partial unique default index); set_default/reorder carry concurrency
--    evidence; retirement counts + remaps CURRENT ACTIVE relationships ONLY
--    (locked, per-row version transitions + canonical lifecycle events + card
--    refresh + bounded durable mapping evidence) while inactive/archived
--    historical rows keep the retired key forever; retire_preview reports
--    active vs historical honestly; no-ops rejected.
--  - TAGS: EVERY mutation path (the redefined Phase-2 create/assign/remove in
--    marketing_tag_mutate, admin ops, bulk) enforces the canonical permission
--    boundary — real same-tenant actor + effective marketing.tags.manage from
--    the resolver — with EXACT per-operation argument allowlists and strict
--    JSON types; governed admin no-ops rejected; BOUNDED bulk assignment where
--    duplicates collapse into `unique` (never counted rejected), foreign ids
--    are counted never echoed, preflight issues a checked CONTRACT hash that
--    apply must present (same tag/op/selection), apply locks the tag row
--    (inactive-tag races fail safely) and stamps actor/source/bulk_ref on
--    every assignment. Single-contact assign takes the SAME tag lock and
--    rejects an inactive tag; remove stays legal on an inactive tag so
--    historical assignments can be cleaned up.
--  - SEGMENTS: one validator for stored AND ad-hoc definitions enforcing depth
--    BEFORE descending and the node budget DURING traversal; unknown keys at
--    every node level, mixed op+field objects, non-strict scalar types,
--    reversed ranges and duplicate tag ids all rejected; vocabularies
--    validated; unsupported filters keep explicit Preview errors. Mutations:
--    authoritative tags.manage check; archive/reactivate use the observable
--    updated_at token; exact-repeat updates rejected. Evaluation: version
--    captured at read, stored ONLY if the definition is still that version
--    (optional expected_version pins it — stale → MK409), returns the ACTUAL
--    stored timestamp, strict typed cursor + next_cursor.
--  - IMPORTS: preview resolves the ACTUAL profile row DETERMINISTICALLY
--    (explicit ids must be active + source/entity-matching; auto-resolution
--    only when unambiguous, tenant preferred, else explicit selection) and
--    SEALS profile id + version + immutable definition snapshot + sha256 +
--    reviewed mapping + options INCLUDING the EXPLICIT resolved lifecycle/
--    relationship defaults + provenance source with the stored preview
--    (provenance source stays separate from profile resolution); apply uses
--    ONLY the sealed contract — the row RPC NEVER falls back to live
--    marketing_settings, and an unhonourable sealed stage/tag demands a new
--    preview (409 invalid_preview at the Edge BEFORE any status change, row
--    processing or failed-outcome write). The per-row RPC validates import
--    lineage/status/row-range/sealed options/actor authority structurally;
--    identity is EVIDENCE-CONVERGED across source+external id and primary/
--    secondary email/phone with a deterministic identity lock per identifier
--    INCLUDING the source+external-id namespace (invalid endpoints are never
--    usable evidence; any ambiguity or identifier disagreement is ONE bounded
--    tenant-safe conflict with correctly-labelled per-identifier evidence and
--    ZERO canonical mutations; a NAME-ONLY row NEVER merges — colliding with
--    existing People routes to bounded review, only genuinely-new evidence
--    creates); invalid row values are honest durable outcomes — never silent
--    defaults; companies are resolved safely (no orphans, no name-only
--    merges); EVERY source row leaves a durable, STRUCTURALLY TENANT-BOUND
--    marketing_import_row_results outcome (composite FKs to this tenant's
--    import/conflict/person; terminal created/updated/conflict/invalid vs
--    retryable failed; a STRUCTURAL trigger pins id/tenant/import/row/
--    created_at on every update, restricts failed rows to outcome-column
--    transitions with attempt advancing by exactly one, keeps terminal rows
--    immutable except a genuine single-reference FK set-null, and — honestly —
--    constrains the SHAPE of every update without claiming to know its
--    caller; delete/truncate revoked from client roles). A matched Person
--    vanishing before its row lock raises RETRYABLE 40001 (never a successful
--    unrecorded 'invalid'), so the Edge failure path records a durable
--    'failed' row and a later retry re-resolves identity. The
--    Edge records invalid/failed ONLY through marketing_import_row_outcome
--    (same per-row lock, never downgrades a terminal outcome, returns the
--    authoritative existing result); provenance with a missing ledger row is
--    repaired deterministically; marketing_import_finalize computes cumulative
--    totals + completion from durable outcomes under the locked import row and
--    EVERY successful invocation returns the same complete totals/import shape
--    ('completed' means NO retryable failures; retries process only failed
--    rows).
--  - AUDIT: TRUE keyset pagination — typed (created_at,id) tuple cursor with
--    the matching tuple predicate + next_cursor (equal timestamps never skip
--    rows), and a bounded allowlisted detail projection (no raw imported rows,
--    destinations or unnecessary PII).
--
-- Rollback:
--   drop function if exists marketing_import_row_outcome(uuid, uuid, int, text, text, text[]);
--   drop function if exists marketing_import_row_results_guard() cascade;
--   drop function if exists marketing_import_finalize(uuid, uuid);
--   drop function if exists marketing_import_contact_row(uuid, uuid, uuid, int, jsonb, jsonb);
--   drop function if exists marketing_import_match_contact(uuid, jsonb);
--   drop function if exists marketing_import_resolve_contact(uuid, jsonb, text);
--   drop function if exists marketing_import_validate_contact_row(uuid, jsonb);
--   drop function if exists marketing_import_resolve_stage(uuid, text);
--   drop function if exists marketing_audit_list(uuid, jsonb);
--   drop function if exists marketing_segment_evaluate(uuid, uuid, jsonb);
--   drop function if exists marketing_segment_mutate(uuid, uuid, text, jsonb);
--   drop function if exists marketing_segment_match_person(uuid, uuid, jsonb, int);
--   drop function if exists marketing_segment_validate(uuid, jsonb, int, int);
--   drop function if exists marketing_tag_bulk(uuid, uuid, text, uuid, uuid[], text, text);
--   drop function if exists marketing_tags_admin_list(uuid);
--   drop function if exists marketing_access_set(uuid, uuid, uuid, text, text, text);
--   drop function if exists marketing_access_overview(uuid);
--   drop function if exists marketing_lifecycle_admin(uuid, uuid, text, jsonb);
--   drop function if exists marketing_update_settings(uuid, uuid, jsonb, int);
--   drop table if exists marketing_import_row_results;
--   drop table if exists marketing_segment_versions;
--   drop table if exists marketing_settings_history;
--   drop index if exists marketing_lifecycle_default_uk;
--   drop index if exists marketing_settings_tenant_id_uk;
--   (marketing_effective_permissions / marketing_tag_mutate revert to their
--    20260828/20260829 definitions.)

-- ===========================================================================
-- marketing_settings_history — APPEND-ONLY snapshots. Real history: the full
-- previous row is preserved before every versioned overwrite, sufficient to
-- reconstruct any prior configuration. Immutable (raising trigger).
-- ===========================================================================
-- Composite key on the parent so history can be STRUCTURALLY bound to the same
-- tenant's settings row (not just any settings id).
create unique index marketing_settings_tenant_id_uk
  on marketing_settings (tenant_id, id);

-- STRUCTURAL default-stage invariant: at most one default stage per tenant
-- (and one on the platform template). "Exactly one" is maintained by the
-- governed set_default/settings paths, which also keep
-- marketing_settings.default_lifecycle_stage_key in lockstep.
create unique index marketing_lifecycle_default_uk
  on marketing_lifecycle_stages (tenant_id) where is_default and tenant_id is not null;
create table marketing_settings_history (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  settings_id uuid not null,
  version     int not null,                    -- the version being superseded
  snapshot    jsonb not null,                  -- full previous row
  changed     text[] not null default '{}',    -- keys changed by the superseding write
  changed_by  uuid,
  created_at  timestamptz not null default now(),
  -- (tenant_id, settings_id) must name THIS tenant's settings row — a corrupt or
  -- cross-tenant settings_id is structurally impossible, and duplicate history
  -- for the same superseded version is rejected.
  constraint marketing_settings_history_settings_fk
    foreign key (tenant_id, settings_id)
    references marketing_settings (tenant_id, id) on delete cascade,
  constraint marketing_settings_history_version_uk
    unique (tenant_id, settings_id, version)
);
create index marketing_settings_history_idx
  on marketing_settings_history (tenant_id, version desc);
-- APPEND-ONLY protection (Phase-2 identity-conflicts precedent): rows are
-- never UPDATED (raising trigger) and no client role holds DELETE privilege —
-- while tenant/segment CASCADE cleanup (which runs as the table owner) stays
-- possible, so removing a tenant is never blocked by its own audit trail.
create or replace function marketing_history_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'marketing history is append-only';
end $$;
create trigger marketing_settings_history_append_only
  before update on marketing_settings_history
  for each row execute function marketing_history_append_only();
create trigger marketing_settings_history_tenant_guard
  before insert on marketing_settings_history
  for each row execute function marketing_tenant_guard();
alter table marketing_settings_history enable row level security;
create policy marketing_settings_history_select on marketing_settings_history
  for select to authenticated
  using (tenant_id = current_tenant_id()
         and marketing_has_permission('marketing.access.manage'));
grant select on marketing_settings_history to authenticated;
grant select, insert on marketing_settings_history to service_role;
-- default privileges in supabase-managed databases can grant service_role ALL
-- on new public tables — revoke explicitly so append-only is deterministic in
-- EVERY environment (tenant cascade cleanup runs as the owner and still works)
revoke update, delete, truncate on marketing_settings_history
  from anon, authenticated, service_role;

-- ===========================================================================
-- marketing_segment_versions — IMMUTABLE definition history: one row per
-- accepted definition version with actor, timestamp and the exact validated
-- definition.
-- ===========================================================================
create table marketing_segment_versions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants (id) on delete cascade,
  segment_id uuid not null references marketing_segments (id) on delete cascade,
  version    int not null,
  name       text not null,
  definition jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, segment_id, version)
);
create index marketing_segment_versions_idx
  on marketing_segment_versions (tenant_id, segment_id, version desc);
create trigger marketing_segment_versions_append_only
  before update on marketing_segment_versions
  for each row execute function marketing_history_append_only();
create trigger marketing_segment_versions_tenant_guard
  before insert on marketing_segment_versions
  for each row execute function marketing_tenant_guard();
alter table marketing_segment_versions enable row level security;
create policy marketing_segment_versions_select on marketing_segment_versions
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_segment_versions to authenticated;
grant select, insert on marketing_segment_versions to service_role;
revoke update, delete, truncate on marketing_segment_versions
  from anon, authenticated, service_role;

-- ===========================================================================
-- CANONICAL RESOLVER (replaced): two structural ceilings, enforced in the
-- authority layer (a hostile/raw grant row is inert data here):
--   1. RESTRICTED permissions (campaigns.launch / senders.manage /
--      access.manage) never flow from a grant to a non-owner/admin profile.
--   2. VIEWER CEILING: a viewer role is read-only by definition — the only
--      permissions a grant can ever add to a viewer are the read capabilities
--      (marketing.view, marketing.reporting.view). Any other grant row for a
--      viewer is ignored.
-- Explicit denies still apply to everyone. Role defaults (owner/admin full,
-- ops working subset, viewer none) are unchanged.
-- ===========================================================================
create or replace function marketing_effective_permissions(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_role text;
  v_enabled boolean;
  v_settings_exists boolean := false;
  v_perms text[];
  v_restricted text[] := array['marketing.campaigns.launch',
                               'marketing.senders.manage',
                               'marketing.access.manage'];
  v_viewer_readable text[] := array['marketing.view', 'marketing.reporting.view'];
begin
  if p_profile_id is null then
    return jsonb_build_object('found', false, 'enabled', false,
                              'settings_exists', false, 'permissions', '[]'::jsonb);
  end if;

  select tenant_id, role into v_tenant, v_role from profiles where id = p_profile_id;
  if v_tenant is null then
    return jsonb_build_object('found', false, 'enabled', false,
                              'settings_exists', false, 'permissions', '[]'::jsonb);
  end if;

  select marketing_enabled into v_enabled from marketing_settings where tenant_id = v_tenant;
  v_settings_exists := found;
  if not v_settings_exists then
    v_enabled := true; -- declared schema default: enabled until configured otherwise
  end if;

  if not coalesce(v_enabled, false) then
    return jsonb_build_object('found', true, 'enabled', false,
                              'settings_exists', v_settings_exists, 'permissions', '[]'::jsonb);
  end if;

  select coalesce(array_agg(p order by p), '{}') into v_perms from (
    select rd.permission as p
      from marketing_role_defaults rd
     where rd.role = v_role
    union
    select g.permission
      from marketing_access_grants g
     where g.tenant_id = v_tenant and g.profile_id = p_profile_id and g.granted
       -- RESTRICTED permissions never flow from a grant to a non-owner/admin
       and not (g.permission = any (v_restricted) and v_role not in ('owner', 'admin'))
       -- VIEWER CEILING: only read capabilities can ever flow to a viewer
       and not (v_role = 'viewer' and not (g.permission = any (v_viewer_readable)))
    except
    select g.permission
      from marketing_access_grants g
     where g.tenant_id = v_tenant and g.profile_id = p_profile_id and not g.granted
  ) s(p);

  return jsonb_build_object('found', true, 'enabled', true,
                            'settings_exists', v_settings_exists,
                            'permissions', to_jsonb(v_perms));
end $$;
revoke all on function marketing_effective_permissions(uuid) from public, anon, authenticated;
grant execute on function marketing_effective_permissions(uuid) to service_role;

-- ===========================================================================
-- Shared actor guard for Phase-3 admin RPCs: the actor must be a REAL
-- owner/admin profile of the tenant, and (when marketing is enabled) must hold
-- effective marketing.access.manage. When marketing is DISABLED the role alone
-- suffices — that is the governed re-enable path; anything stricter would make
-- disabling the module an unrecoverable lockout.
-- ===========================================================================
create or replace function marketing_require_admin_actor(p_tenant uuid, p_actor uuid)
returns text  -- actor label for audit rows
language plpgsql
stable
as $$
declare
  v_role text;
  v_actor_tenant uuid;
  v_resolved jsonb;
begin
  if p_tenant is null or p_actor is null then
    raise exception 'tenant and actor required' using errcode = '22023';
  end if;
  select tenant_id, role into v_actor_tenant, v_role from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  if v_role not in ('owner', 'admin') then
    raise exception 'marketing administration requires an owner/admin actor'
      using errcode = '42501';
  end if;
  v_resolved := marketing_effective_permissions(p_actor);
  if (v_resolved ->> 'enabled')::boolean
     and not ((v_resolved -> 'permissions') ? 'marketing.access.manage') then
    raise exception 'actor lacks marketing.access.manage' using errcode = '42501';
  end if;
  return coalesce((select email from profiles where id = p_actor), p_actor::text);
end $$;

-- ===========================================================================
-- SETTINGS — governed versioned update with real append-only history.
-- ===========================================================================
create or replace function marketing_update_settings(
  p_tenant uuid, p_actor uuid, p_changes jsonb, p_expected_version int
) returns jsonb
language plpgsql
as $$
declare
  v_actor_label text;
  v_cur marketing_settings%rowtype;
  v_key text;
  v_allowed text[] := array['marketing_enabled','include_all_discovered',
    'default_relationship_type','default_lifecycle_stage_key','timezone',
    'quiet_hours','tracking_enabled','reply_handling','unsubscribe_footer',
    'notification_routing','guardrails'];
  v_changed text[] := array[]::text[];
  v_qh jsonb;
  v_qs int; v_qe int;
  v_footer jsonb;
  v_routing jsonb;
  v_guard jsonb;
  v_txt text;
  v_new_settings jsonb;
begin
  v_actor_label := marketing_require_admin_actor(p_tenant, p_actor);
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'changes must be an object' using errcode = '22023';
  end if;
  if p_expected_version is null then
    raise exception 'expected_version is required' using errcode = '22023';
  end if;
  -- unknown keys are rejected, never ignored
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'unknown settings key %', v_key using errcode = '22023';
    end if;
  end loop;

  select * into v_cur from marketing_settings
   where tenant_id = p_tenant for update;
  if not found then
    raise exception 'marketing settings are not initialised for this tenant'
      using errcode = 'P0002';
  end if;
  if v_cur.version <> p_expected_version then
    raise exception 'settings were changed elsewhere (expected %, found %)',
      p_expected_version, v_cur.version using errcode = 'MK409';
  end if;

  -- ── validate each supplied field (strict JSON types, bounded, honest) ──
  -- Explicit JSON null is REJECTED for every non-nullable field (never treated
  -- as "keep current"), and a key only counts as changed when the validated
  -- value actually differs from the current row (whole-operation no-ops are
  -- rejected below, before any history/audit/event is written).
  if p_changes ? 'marketing_enabled' then
    if jsonb_typeof(p_changes -> 'marketing_enabled') <> 'boolean' then
      raise exception 'marketing_enabled must be a boolean' using errcode = '22023';
    end if;
    if (p_changes ->> 'marketing_enabled')::boolean is distinct from v_cur.marketing_enabled then
      v_changed := array_append(v_changed, 'marketing_enabled');
    end if;
  end if;
  if p_changes ? 'include_all_discovered' then
    if jsonb_typeof(p_changes -> 'include_all_discovered') <> 'boolean' then
      raise exception 'include_all_discovered must be a boolean' using errcode = '22023';
    end if;
    if (p_changes ->> 'include_all_discovered')::boolean
       is distinct from v_cur.include_all_discovered then
      v_changed := array_append(v_changed, 'include_all_discovered');
    end if;
  end if;
  if p_changes ? 'tracking_enabled' then
    if jsonb_typeof(p_changes -> 'tracking_enabled') <> 'boolean' then
      raise exception 'tracking_enabled must be a boolean' using errcode = '22023';
    end if;
    if (p_changes ->> 'tracking_enabled')::boolean is distinct from v_cur.tracking_enabled then
      v_changed := array_append(v_changed, 'tracking_enabled');
    end if;
  end if;
  if p_changes ? 'default_relationship_type' then
    if jsonb_typeof(p_changes -> 'default_relationship_type') <> 'string'
       or (p_changes ->> 'default_relationship_type') not in
       ('lead','prospect','customer','former_customer','supplier','partner','commercial','other') then
      raise exception 'invalid default_relationship_type' using errcode = '22023';
    end if;
    if (p_changes ->> 'default_relationship_type')
       is distinct from v_cur.default_relationship_type then
      v_changed := array_append(v_changed, 'default_relationship_type');
    end if;
  end if;
  if p_changes ? 'default_lifecycle_stage_key' then
    if jsonb_typeof(p_changes -> 'default_lifecycle_stage_key') <> 'string'
       or not exists (select 1 from marketing_lifecycle_stages s
                    where s.tenant_id = p_tenant
                      and s.stage_key = p_changes ->> 'default_lifecycle_stage_key'
                      and s.active) then
      raise exception 'default lifecycle stage must be an active stage of this tenant'
        using errcode = '22023';
    end if;
    if (p_changes ->> 'default_lifecycle_stage_key')
       is distinct from v_cur.default_lifecycle_stage_key then
      v_changed := array_append(v_changed, 'default_lifecycle_stage_key');
    end if;
  end if;
  if p_changes ? 'timezone' then
    if jsonb_typeof(p_changes -> 'timezone') <> 'string' then
      raise exception 'timezone must be a string' using errcode = '22023';
    end if;
    v_txt := p_changes ->> 'timezone';
    if v_txt is null or length(v_txt) > 64
       or not exists (select 1 from pg_timezone_names where name = v_txt) then
      raise exception 'timezone must be a real IANA timezone' using errcode = '22023';
    end if;
    if v_txt is distinct from v_cur.timezone then
      v_changed := array_append(v_changed, 'timezone');
    end if;
  end if;
  if p_changes ? 'reply_handling' then
    if jsonb_typeof(p_changes -> 'reply_handling') <> 'string'
       or (p_changes ->> 'reply_handling') not in ('workspace', 'none') then
      raise exception 'invalid reply_handling' using errcode = '22023';
    end if;
    if (p_changes ->> 'reply_handling') is distinct from v_cur.reply_handling then
      v_changed := array_append(v_changed, 'reply_handling');
    end if;
  end if;
  if p_changes ? 'quiet_hours' then
    v_qh := p_changes -> 'quiet_hours';
    if jsonb_typeof(v_qh) = 'null' then
      v_qs := null; v_qe := null;
    elsif jsonb_typeof(v_qh) = 'object' then
      -- quiet_hours permits EXACTLY {start, end} — unknown keys rejected
      for v_key in select jsonb_object_keys(v_qh) loop
        if v_key not in ('start', 'end') then
          raise exception 'unknown quiet_hours key %', v_key using errcode = '22023';
        end if;
      end loop;
      if jsonb_typeof(v_qh -> 'start') is distinct from 'number'
         or jsonb_typeof(v_qh -> 'end') is distinct from 'number' then
        raise exception 'quiet_hours must be null or {start,end}' using errcode = '22023';
      end if;
      -- whole hours only: a fractional JSON number is rejected, never truncated
      if (v_qh ->> 'start')::numeric <> floor((v_qh ->> 'start')::numeric)
         or (v_qh ->> 'end')::numeric <> floor((v_qh ->> 'end')::numeric) then
        raise exception 'quiet hours must be whole hours 0-23' using errcode = '22023';
      end if;
      v_qs := (v_qh ->> 'start')::numeric::int;
      v_qe := (v_qh ->> 'end')::numeric::int;
      if v_qs < 0 or v_qs > 23 or v_qe < 0 or v_qe > 23 then
        raise exception 'quiet hours must be whole hours 0-23' using errcode = '22023';
      end if;
      if v_qs = v_qe then
        raise exception 'quiet hours cannot cover the whole day (start equals end)'
          using errcode = '22023';
      end if;
    else
      raise exception 'quiet_hours must be null or {start,end}' using errcode = '22023';
    end if;
    if v_qs is distinct from v_cur.quiet_hours_start
       or v_qe is distinct from v_cur.quiet_hours_end then
      v_changed := array_append(v_changed, 'quiet_hours');
    end if;
  end if;
  if p_changes ? 'unsubscribe_footer' then
    v_footer := p_changes -> 'unsubscribe_footer';
    if jsonb_typeof(v_footer) <> 'object' then
      raise exception 'unsubscribe_footer must be an object' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_footer) loop
      if v_key not in ('company_name','address_text','contact_email','footer_text') then
        raise exception 'unknown unsubscribe_footer key %', v_key using errcode = '22023';
      end if;
      if jsonb_typeof(v_footer -> v_key) not in ('string', 'null') then
        raise exception 'unsubscribe_footer values must be text' using errcode = '22023';
      end if;
      v_txt := v_footer ->> v_key;
      -- plain text only: no markup, bounded (rendered safely as text client-side)
      if v_txt is not null and (length(v_txt) > 500 or v_txt ~ '[<>]') then
        raise exception 'unsubscribe_footer values are bounded plain text (no markup)'
          using errcode = '22023';
      end if;
      if v_key = 'contact_email' and v_txt is not null
         and marketing_normalize_endpoint('email', v_txt) is null then
        raise exception 'unsubscribe_footer contact_email must be a valid email'
          using errcode = '22023';
      end if;
    end loop;
    if v_footer is distinct from v_cur.unsubscribe_footer then
      v_changed := array_append(v_changed, 'unsubscribe_footer');
    end if;
  end if;
  if p_changes ? 'notification_routing' then
    v_routing := p_changes -> 'notification_routing';
    if jsonb_typeof(v_routing) <> 'object' then
      raise exception 'notification_routing must be an object' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_routing) loop
      -- only destinations that genuinely exist today: none, or the tenant's
      -- owner/admin profile emails.
      if v_key not in ('import_failures') then
        raise exception 'unknown notification_routing key %', v_key using errcode = '22023';
      end if;
      if jsonb_typeof(v_routing -> v_key) <> 'string'
         or (v_routing ->> v_key) not in ('none', 'admins') then
        raise exception 'notification_routing values must be none|admins' using errcode = '22023';
      end if;
    end loop;
    if v_routing is distinct from v_cur.notification_routing then
      v_changed := array_append(v_changed, 'notification_routing');
    end if;
  end if;
  if p_changes ? 'guardrails' then
    v_guard := p_changes -> 'guardrails';
    if jsonb_typeof(v_guard) <> 'object' then
      raise exception 'guardrails must be an object' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_guard) loop
      if v_key not in ('max_bulk_recipients','require_unsubscribe_footer') then
        raise exception 'unknown guardrails key %', v_key using errcode = '22023';
      end if;
    end loop;
    if v_guard ? 'max_bulk_recipients' then
      if jsonb_typeof(v_guard -> 'max_bulk_recipients') <> 'number'
         or (v_guard ->> 'max_bulk_recipients')::numeric not between 1 and 50000
         or (v_guard ->> 'max_bulk_recipients')::numeric
            <> floor((v_guard ->> 'max_bulk_recipients')::numeric) then
        raise exception 'max_bulk_recipients must be an integer 1-50000' using errcode = '22023';
      end if;
    end if;
    if v_guard ? 'require_unsubscribe_footer'
       and jsonb_typeof(v_guard -> 'require_unsubscribe_footer') <> 'boolean' then
      raise exception 'require_unsubscribe_footer must be a boolean' using errcode = '22023';
    end if;
    if v_guard is distinct from (v_cur.settings -> 'guardrails') then
      v_changed := array_append(v_changed, 'guardrails');
    end if;
  end if;

  -- Whole-operation no-op (nothing supplied, or every supplied value equals the
  -- current one) → rejected BEFORE any history/audit/event is written.
  if array_length(v_changed, 1) is null then
    raise exception 'no effective changes supplied' using errcode = '22023';
  end if;

  -- ── REAL history first: snapshot the full previous row (append-only) ──
  insert into marketing_settings_history
    (tenant_id, settings_id, version, snapshot, changed, changed_by)
  values (p_tenant, v_cur.id, v_cur.version, to_jsonb(v_cur), v_changed, p_actor);

  update marketing_settings s set
    marketing_enabled = case when p_changes ? 'marketing_enabled'
      then (p_changes ->> 'marketing_enabled')::boolean else s.marketing_enabled end,
    include_all_discovered = case when p_changes ? 'include_all_discovered'
      then (p_changes ->> 'include_all_discovered')::boolean else s.include_all_discovered end,
    default_relationship_type = coalesce(p_changes ->> 'default_relationship_type',
                                         s.default_relationship_type),
    default_lifecycle_stage_key = coalesce(p_changes ->> 'default_lifecycle_stage_key',
                                           s.default_lifecycle_stage_key),
    timezone = coalesce(p_changes ->> 'timezone', s.timezone),
    quiet_hours_start = case when p_changes ? 'quiet_hours' then v_qs else s.quiet_hours_start end,
    quiet_hours_end = case when p_changes ? 'quiet_hours' then v_qe else s.quiet_hours_end end,
    tracking_enabled = case when p_changes ? 'tracking_enabled'
      then (p_changes ->> 'tracking_enabled')::boolean else s.tracking_enabled end,
    reply_handling = coalesce(p_changes ->> 'reply_handling', s.reply_handling),
    unsubscribe_footer = case when p_changes ? 'unsubscribe_footer'
      then v_footer else s.unsubscribe_footer end,
    notification_routing = case when p_changes ? 'notification_routing'
      then v_routing else s.notification_routing end,
    settings = case when p_changes ? 'guardrails'
      then jsonb_set(s.settings, '{guardrails}', v_guard) else s.settings end,
    version = s.version + 1,
    updated_by = p_actor
  where s.tenant_id = p_tenant
  returning * into v_cur;

  -- ONE ATOMIC INVARIANT (default stage): when the settings default key changes
  -- through this governed path, the stage rows' is_default flags follow in the
  -- SAME transaction — the two representations can never drift.
  if 'default_lifecycle_stage_key' = any (v_changed) then
    -- order-safe under the partial unique default index: clear, then set
    update marketing_lifecycle_stages s set is_default = false
     where s.tenant_id = p_tenant and s.is_default
       and s.stage_key <> v_cur.default_lifecycle_stage_key;
    update marketing_lifecycle_stages s set is_default = true
     where s.tenant_id = p_tenant
       and s.stage_key = v_cur.default_lifecycle_stage_key and not s.is_default;
  end if;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_actor_label, 'marketing.settings.updated', 'marketing_settings',
          v_cur.id::text, 'ok',
          jsonb_build_object('changed', to_jsonb(v_changed), 'version', v_cur.version));
  perform marketing_event_append(p_tenant, 'marketing.settings.updated', 'marketing_settings',
    v_cur.id, 'marketing-admin',
    jsonb_build_object('k', 'v' || v_cur.version, 'changed', to_jsonb(v_changed),
                       'version', v_cur.version, 'actor', v_actor_label, 'at', now()));

  select to_jsonb(v_cur) into v_new_settings;
  return jsonb_build_object('version', v_cur.version, 'settings', v_new_settings,
                            'changed', to_jsonb(v_changed));
end $$;

-- ===========================================================================
-- LIFECYCLE ADMIN — one governed RPC for every stage operation.
-- ===========================================================================
create or replace function marketing_lifecycle_admin(
  p_tenant uuid, p_actor uuid, p_op text, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_actor_label text;
  v_stage marketing_lifecycle_stages%rowtype;
  v_repl marketing_lifecycle_stages%rowtype;
  v_settings marketing_settings%rowtype;
  v_id uuid;
  v_expected timestamptz;
  v_key text;
  v_label text;
  v_tone text;
  v_terminal text;
  v_in_use int;
  v_historical int;
  v_ids uuid[];
  v_tokens timestamptz[];
  v_cur_order uuid[];
  v_allowed text[];
  v_n int := 0;
  v_i int;
  v_rel record;
  v_rel_ids uuid[] := array[]::uuid[];
  v_person_ids uuid[] := array[]::uuid[];
  v_person uuid;
  v_disp contact_relationships%rowtype;
  v_detail jsonb;
begin
  v_actor_label := marketing_require_admin_actor(p_tenant, p_actor);
  if p_op is null or p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'op and args object required' using errcode = '22023';
  end if;

  -- each op accepts ONLY its declared argument shape — unknown keys rejected
  v_allowed := case p_op
    when 'add' then array['stage_key','label','tone','terminal_outcome']
    when 'rename' then array['stage_id','expected_updated_at','label']
    when 'set_tone' then array['stage_id','expected_updated_at','tone']
    when 'set_terminal' then array['stage_id','expected_updated_at','terminal_outcome']
    when 'retire' then array['stage_id','expected_updated_at','replacement_stage_id']
    when 'reactivate' then array['stage_id','expected_updated_at']
    when 'set_default' then array['stage_id','expected_updated_at']
    when 'reorder' then array['stage_ids','expected_updated_ats']
    when 'retire_preview' then array['stage_id']
    else null end;
  if v_allowed is null then
    raise exception 'unknown lifecycle op %', p_op using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'unknown % argument %', p_op, v_key using errcode = '22023';
    end if;
  end loop;

  if p_op = 'add' then
    if jsonb_typeof(p_args -> 'stage_key') is distinct from 'string'
       or jsonb_typeof(p_args -> 'label') is distinct from 'string'
       or (p_args ? 'tone' and jsonb_typeof(p_args -> 'tone') <> 'string')
       or (p_args ? 'terminal_outcome'
           and jsonb_typeof(p_args -> 'terminal_outcome') not in ('string', 'null')) then
      raise exception 'invalid add argument types' using errcode = '22023';
    end if;
    v_key := p_args ->> 'stage_key';
    v_label := nullif(trim(coalesce(p_args ->> 'label', '')), '');
    v_tone := coalesce(nullif(p_args ->> 'tone', ''), 'neutral');
    v_terminal := nullif(p_args ->> 'terminal_outcome', '');
    if v_key is null or v_key !~ '^[a-z0-9_]{2,40}$' then
      raise exception 'stage_key must be a stable lowercase slug (immutable after creation)'
        using errcode = '22023';
    end if;
    if v_label is null or length(v_label) > 60 then
      raise exception 'label required (max 60 chars)' using errcode = '22023';
    end if;
    if v_tone not in ('neutral','info','positive','attention','negative') then
      raise exception 'invalid tone' using errcode = '22023';
    end if;
    if v_terminal is not null and v_terminal not in ('won','lost','nurture') then
      raise exception 'invalid terminal_outcome' using errcode = '22023';
    end if;
    insert into marketing_lifecycle_stages
      (tenant_id, stage_key, label, tone, sort_order, active, terminal_outcome,
       is_default, source)
    select p_tenant, v_key, v_label, v_tone,
           coalesce(max(s.sort_order), 0) + 10, true, v_terminal, false, 'tenant'
      from marketing_lifecycle_stages s where s.tenant_id = p_tenant
    returning * into v_stage;

  elsif p_op in ('rename', 'set_tone', 'set_terminal', 'retire', 'reactivate') then
    begin
      v_id := (p_args ->> 'stage_id')::uuid;
      v_expected := (p_args ->> 'expected_updated_at')::timestamptz;
    exception when others then
      raise exception 'invalid stage_id or expected_updated_at' using errcode = '22023';
    end;
    if v_id is null or v_expected is null then
      raise exception 'stage_id and expected_updated_at required' using errcode = '22023';
    end if;
    -- tenant rows ONLY — template rows are structurally unreachable from here
    select * into v_stage from marketing_lifecycle_stages
     where id = v_id and tenant_id = p_tenant for update;
    if not found then
      raise exception 'stage not found for tenant' using errcode = 'P0002';
    end if;
    if v_stage.updated_at is distinct from v_expected then
      raise exception 'stage was changed elsewhere' using errcode = 'MK409';
    end if;

    if p_op = 'rename' then
      if jsonb_typeof(p_args -> 'label') is distinct from 'string' then
        raise exception 'label must be a string' using errcode = '22023';
      end if;
      v_label := nullif(trim(coalesce(p_args ->> 'label', '')), '');
      if v_label is null or length(v_label) > 60 then
        raise exception 'label required (max 60 chars)' using errcode = '22023';
      end if;
      if v_label = v_stage.label then
        raise exception 'rename is a no-op' using errcode = '22023';
      end if;
      update marketing_lifecycle_stages set label = v_label where id = v_id
      returning * into v_stage;
    elsif p_op = 'set_tone' then
      if jsonb_typeof(p_args -> 'tone') is distinct from 'string' then
        raise exception 'tone must be a string' using errcode = '22023';
      end if;
      v_tone := p_args ->> 'tone';
      if v_tone not in ('neutral','info','positive','attention','negative') then
        raise exception 'invalid tone' using errcode = '22023';
      end if;
      if v_tone = v_stage.tone then
        raise exception 'set_tone is a no-op' using errcode = '22023';
      end if;
      update marketing_lifecycle_stages set tone = v_tone where id = v_id
      returning * into v_stage;
    elsif p_op = 'set_terminal' then
      if p_args ? 'terminal_outcome'
         and jsonb_typeof(p_args -> 'terminal_outcome') not in ('string', 'null') then
        raise exception 'terminal_outcome must be a string or null' using errcode = '22023';
      end if;
      v_terminal := nullif(p_args ->> 'terminal_outcome', '');
      if v_terminal is not null and v_terminal not in ('won','lost','nurture') then
        raise exception 'invalid terminal_outcome' using errcode = '22023';
      end if;
      if v_terminal is not distinct from v_stage.terminal_outcome then
        raise exception 'set_terminal is a no-op' using errcode = '22023';
      end if;
      update marketing_lifecycle_stages set terminal_outcome = v_terminal where id = v_id
      returning * into v_stage;
    elsif p_op = 'reactivate' then
      if v_stage.active then
        raise exception 'stage is already active' using errcode = '22023';
      end if;
      update marketing_lifecycle_stages set active = true where id = v_id
      returning * into v_stage;
    else -- retire
      -- the EFFECTIVE default cannot be retired — BOTH representations checked
      select * into v_settings from marketing_settings
       where tenant_id = p_tenant for update;
      if v_stage.is_default
         or (found and v_settings.default_lifecycle_stage_key = v_stage.stage_key) then
        raise exception 'the default stage cannot be retired — set another default first'
          using errcode = '22023';
      end if;
      if not v_stage.active then
        raise exception 'stage is already retired' using errcode = '22023';
      end if;
      -- CURRENT ACTIVE relationships only. Inactive/archived historical rows
      -- keep the retired stage key forever, and the retired stage row remains
      -- permanently available for their labels — retirement never rewrites
      -- history.
      select count(*) into v_in_use from contact_relationships r
       where r.tenant_id = p_tenant and r.lifecycle_stage_key = v_stage.stage_key
         and r.status = 'active';
      if v_in_use > 0 then
        begin
          v_id := (p_args ->> 'replacement_stage_id')::uuid;
        exception when others then
          raise exception 'invalid replacement_stage_id' using errcode = '22023';
        end;
        if v_id is null then
          raise exception 'stage is in use by % active relationships — an explicit active replacement stage is required',
            v_in_use using errcode = '22023';
        end if;
        select * into v_repl from marketing_lifecycle_stages
         where id = v_id and tenant_id = p_tenant and active and id <> v_stage.id;
        if not found then
          raise exception 'replacement must be a different ACTIVE stage of this tenant'
            using errcode = '22023';
        end if;
        -- LOCK the affected ACTIVE rows, then remap each with a proper version
        -- transition and a per-relationship canonical lifecycle event. Every
        -- UPDATE re-checks stage key AND active status under the lock, so a
        -- concurrently reclassified relationship is never overwritten.
        for v_rel in
          select r.id, r.person_id, r.version from contact_relationships r
           where r.tenant_id = p_tenant and r.lifecycle_stage_key = v_stage.stage_key
             and r.status = 'active'
           order by r.id
             for update
        loop
          update contact_relationships r set
            lifecycle_stage_key = v_repl.stage_key,
            version = r.version + 1,
            updated_by = p_actor
          where r.id = v_rel.id and r.tenant_id = p_tenant
            and r.lifecycle_stage_key = v_stage.stage_key and r.status = 'active';
          if found then
            v_n := v_n + 1;
            v_rel_ids := array_append(v_rel_ids, v_rel.id);
            v_person_ids := array_append(v_person_ids, v_rel.person_id);
            perform marketing_event_append(p_tenant, 'marketing.contact.lifecycle_changed',
              'person', v_rel.person_id, 'marketing-admin',
              jsonb_build_object(
                'k', 'retire:' || v_stage.stage_key || ':' || v_rel.id,
                'relationship_id', v_rel.id,
                'from', v_stage.stage_key, 'to', v_repl.stage_key,
                'from_version', v_rel.version, 'to_version', v_rel.version + 1,
                'reason', 'stage_retired',
                'actor', v_actor_label, 'at', now()));
          end if;
        end loop;
        -- refresh affected Customer Cards (same CURRENT/display-relationship
        -- projection as classify) so current lifecycle context is never stale
        for v_person in select distinct u from unnest(v_person_ids) t(u) loop
          select * into v_disp from contact_relationships cr
           where cr.tenant_id = p_tenant and cr.person_id = v_person
           order by case cr.status when 'active' then 0 when 'inactive' then 1 else 2 end,
                    cr.created_at asc
           limit 1;
          update customer_cards c set
            context = jsonb_set(coalesce(c.context, '{}'::jsonb), '{marketing}',
              coalesce(c.context -> 'marketing', '{}'::jsonb) || jsonb_build_object(
                'relationship_id', v_disp.id,
                'lifecycle_stage_key', v_disp.lifecycle_stage_key,
                'relationship_type', v_disp.relationship_type,
                'relationship_status', v_disp.status,
                'owner_id', v_disp.owner_id,
                'updated_at', now()))
          where c.tenant_id = p_tenant and c.person_id = v_person
            and not (c.locked_fields @> array['context']);
        end loop;
      else
        v_n := 0;
      end if;
      update marketing_lifecycle_stages set active = false where id = v_stage.id
      returning * into v_stage;
    end if;

  elsif p_op = 'set_default' then
    begin
      v_id := (p_args ->> 'stage_id')::uuid;
      v_expected := (p_args ->> 'expected_updated_at')::timestamptz;
    exception when others then
      raise exception 'invalid stage_id or expected_updated_at' using errcode = '22023';
    end;
    if v_id is null or v_expected is null then
      raise exception 'stage_id and expected_updated_at required' using errcode = '22023';
    end if;
    select * into v_stage from marketing_lifecycle_stages
     where id = v_id and tenant_id = p_tenant for update;
    if not found then
      raise exception 'stage not found for tenant' using errcode = 'P0002';
    end if;
    if v_stage.updated_at is distinct from v_expected then
      raise exception 'stage was changed elsewhere' using errcode = 'MK409';
    end if;
    if not v_stage.active then
      raise exception 'the default stage must be active' using errcode = '22023';
    end if;
    select * into v_settings from marketing_settings
     where tenant_id = p_tenant for update;
    if not found then
      raise exception 'marketing settings are not initialised for this tenant'
        using errcode = 'P0002';
    end if;
    if v_stage.is_default
       and v_settings.default_lifecycle_stage_key = v_stage.stage_key then
      raise exception 'stage is already the default' using errcode = '22023';
    end if;
    -- ONE ATOMIC INVARIANT: the flag flip (order-safe under the partial unique
    -- default index: clear, then set) + the settings default key + settings
    -- history all move in the SAME transaction — the two representations can
    -- never drift.
    update marketing_lifecycle_stages set is_default = false
     where tenant_id = p_tenant and is_default and id <> v_id;
    update marketing_lifecycle_stages set is_default = true
     where id = v_id and not is_default;
    insert into marketing_settings_history
      (tenant_id, settings_id, version, snapshot, changed, changed_by)
    values (p_tenant, v_settings.id, v_settings.version, to_jsonb(v_settings),
            array['default_lifecycle_stage_key'], p_actor);
    update marketing_settings s set
      default_lifecycle_stage_key = v_stage.stage_key,
      version = s.version + 1,
      updated_by = p_actor
    where s.tenant_id = p_tenant;
    select * into v_stage from marketing_lifecycle_stages where id = v_id;

  elsif p_op = 'reorder' then
    if jsonb_typeof(p_args -> 'stage_ids') is distinct from 'array'
       or jsonb_array_length(p_args -> 'stage_ids') > 50
       or jsonb_typeof(p_args -> 'expected_updated_ats') is distinct from 'array'
       or jsonb_array_length(p_args -> 'expected_updated_ats')
          <> jsonb_array_length(p_args -> 'stage_ids') then
      raise exception 'reorder needs bounded parallel stage_ids and expected_updated_ats'
        using errcode = '22023';
    end if;
    begin
      select array_agg(value::uuid) into v_ids
        from jsonb_array_elements_text(p_args -> 'stage_ids');
      select array_agg(value::timestamptz) into v_tokens
        from jsonb_array_elements_text(p_args -> 'expected_updated_ats');
    exception when others then
      raise exception 'invalid reorder value' using errcode = '22023';
    end;
    -- must be exactly the tenant's stages (no omissions, foreign ids or dups)
    if (select count(*) from marketing_lifecycle_stages s
         where s.tenant_id = p_tenant) <> coalesce(array_length(v_ids, 1), 0)
       or exists (select 1 from unnest(v_ids) u(id)
                   left join marketing_lifecycle_stages s
                     on s.id = u.id and s.tenant_id = p_tenant
                  where s.id is null)
       or (select count(distinct u.id) from unnest(v_ids) u(id))
          <> coalesce(array_length(v_ids, 1), 0) then
      raise exception 'reorder must list every stage of this tenant exactly once'
        using errcode = '22023';
    end if;
    -- CONCURRENCY EVIDENCE: every listed stage's updated_at must match
    for v_i in 1..coalesce(array_length(v_ids, 1), 0) loop
      if not exists (select 1 from marketing_lifecycle_stages s
                      where s.id = v_ids[v_i] and s.tenant_id = p_tenant
                        and s.updated_at = v_tokens[v_i]) then
        raise exception 'stage order changed elsewhere' using errcode = 'MK409';
      end if;
    end loop;
    -- an exact no-op ordering is rejected before any write/audit/event
    select array_agg(s.id order by s.sort_order, s.created_at, s.id) into v_cur_order
      from marketing_lifecycle_stages s where s.tenant_id = p_tenant;
    if v_ids = v_cur_order then
      raise exception 'reorder is a no-op' using errcode = '22023';
    end if;
    -- one statement: no transient duplicate sort orders
    update marketing_lifecycle_stages s
       set sort_order = o.ord * 10
      from (select u.id, u.ord from unnest(v_ids) with ordinality u(id, ord)) o
     where s.id = o.id and s.tenant_id = p_tenant;
    v_stage := null;

  elsif p_op = 'retire_preview' then
    begin
      v_id := (p_args ->> 'stage_id')::uuid;
    exception when others then
      raise exception 'invalid stage_id' using errcode = '22023';
    end;
    select * into v_stage from marketing_lifecycle_stages
     where id = v_id and tenant_id = p_tenant;
    if not found then
      raise exception 'stage not found for tenant' using errcode = 'P0002';
    end if;
    -- HONEST counts: only CURRENT ACTIVE relationships would be remapped;
    -- historical (inactive/archived) rows keep the retired key and are
    -- reported separately, never remapped.
    select count(*) into v_in_use from contact_relationships r
     where r.tenant_id = p_tenant and r.lifecycle_stage_key = v_stage.stage_key
       and r.status = 'active';
    select count(*) into v_historical from contact_relationships r
     where r.tenant_id = p_tenant and r.lifecycle_stage_key = v_stage.stage_key
       and r.status <> 'active';
    return jsonb_build_object('stage_id', v_stage.id, 'stage_key', v_stage.stage_key,
                              'active_in_use', v_in_use,
                              'historical_relationships', v_historical,
                              'is_default', v_stage.is_default
                                or exists (select 1 from marketing_settings ms
                                            where ms.tenant_id = p_tenant
                                              and ms.default_lifecycle_stage_key
                                                  = v_stage.stage_key));
  else
    raise exception 'unknown lifecycle op %', p_op using errcode = '22023';
  end if;

  -- durable evidence: which relationships were remapped (bounded id list) is
  -- recorded so the change can be explained later.
  v_detail := jsonb_build_object('op', p_op, 'stage_key', v_stage.stage_key,
                'args', p_args - 'expected_updated_at' - 'expected_updated_ats',
                'remapped_active_relationships', v_n);
  if v_n > 0 then
    v_detail := v_detail || jsonb_build_object('remap', jsonb_build_object(
      'from', v_stage.stage_key, 'to', v_repl.stage_key,
      'relationship_ids', to_jsonb(v_rel_ids[1:100]),
      'truncated', coalesce(array_length(v_rel_ids, 1), 0) > 100));
  end if;
  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_actor_label, 'marketing.lifecycle.' || p_op,
          'marketing_lifecycle_stage',
          coalesce(v_stage.id::text, 'reorder'), 'ok', v_detail);
  perform marketing_event_append(p_tenant, 'marketing.lifecycle.changed',
    'marketing_lifecycle', coalesce(v_stage.id, p_tenant), 'marketing-admin',
    jsonb_build_object('k', p_op || ':' || coalesce(v_stage.id::text, 'reorder')
                            || ':' || clock_timestamp()::text,
                       'op', p_op, 'stage_key', v_stage.stage_key,
                       'remapped_active_relationships', v_n,
                       'actor', v_actor_label, 'at', now()));

  return jsonb_build_object('op', p_op,
    'stage', case when v_stage.id is null then null else jsonb_build_object(
      'id', v_stage.id, 'stage_key', v_stage.stage_key, 'label', v_stage.label,
      'tone', v_stage.tone, 'sort_order', v_stage.sort_order,
      'active', v_stage.active, 'terminal_outcome', v_stage.terminal_outcome,
      'is_default', v_stage.is_default, 'updated_at', v_stage.updated_at) end,
    'remapped_active_relationships', v_n);
end $$;

-- ===========================================================================
-- ACCESS ADMIN — overview + one governed set RPC.
-- ===========================================================================
create or replace function marketing_access_overview(p_tenant uuid)
returns jsonb
language plpgsql
stable
as $$
declare v_out jsonb;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pr.id, 'full_name', pr.full_name, 'email', pr.email,
               'role', pr.role,
               'effective', marketing_effective_permissions(pr.id) -> 'permissions',
               'grants', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'permission', g.permission, 'granted', g.granted,
                          'updated_at', g.updated_at))
                   from marketing_access_grants g
                  where g.tenant_id = p_tenant and g.profile_id = pr.id), '[]'::jsonb))
             order by pr.role, coalesce(pr.full_name, pr.email))
        from (select * from profiles where tenant_id = p_tenant
               order by role, coalesce(full_name, email) limit 200) pr), '[]'::jsonb),
    'role_defaults', coalesce((
      select jsonb_object_agg(r.role, r.perms) from (
        select rd.role, jsonb_agg(rd.permission order by rd.permission) as perms
          from marketing_role_defaults rd group by rd.role) r), '{}'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'permission', p.permission, 'category', p.category,
               'description', p.description,
               'restricted', p.permission in ('marketing.campaigns.launch',
                                              'marketing.senders.manage',
                                              'marketing.access.manage'))
             order by p.category, p.permission)
        from marketing_permissions p), '[]'::jsonb))
  into v_out;
  return v_out;
end $$;

create or replace function marketing_access_set(
  p_tenant uuid, p_actor uuid, p_profile uuid, p_permission text,
  p_mode text, p_expected text
) returns jsonb
language plpgsql
as $$
declare
  v_actor_label text;
  v_target_role text;
  v_target_tenant uuid;
  v_cur boolean;              -- null = no grant row
  v_cur_state text;
  v_new_state text;
  v_restricted boolean;
  v_managers int;
begin
  v_actor_label := marketing_require_admin_actor(p_tenant, p_actor);
  if p_mode not in ('grant', 'deny', 'clear') then
    raise exception 'mode must be grant|deny|clear' using errcode = '22023';
  end if;
  if p_expected is null or p_expected not in ('granted', 'denied', 'none') then
    raise exception 'expected state (granted|denied|none) is required' using errcode = '22023';
  end if;
  if not exists (select 1 from marketing_permissions mp where mp.permission = p_permission) then
    raise exception 'unknown permission' using errcode = '22023';
  end if;
  select tenant_id, role into v_target_tenant, v_target_role
    from profiles where id = p_profile;
  if not found or v_target_tenant is distinct from p_tenant then
    -- cross-tenant/unknown target: rejected with no evidence of foreign identities
    raise exception 'unknown profile for this tenant' using errcode = '22023';
  end if;

  v_restricted := p_permission in ('marketing.campaigns.launch',
                                   'marketing.senders.manage',
                                   'marketing.access.manage');
  if v_restricted and p_mode = 'grant' and v_target_role not in ('owner', 'admin') then
    raise exception '% is owner/admin-only and cannot be granted to a % profile',
      p_permission, v_target_role using errcode = '22023';
  end if;
  -- VIEWER CEILING: a viewer is read-only by definition — the grant RPC refuses
  -- to create any write grant for a viewer (and the resolver ignores hostile
  -- raw rows regardless).
  if p_mode = 'grant' and v_target_role = 'viewer'
     and p_permission not in ('marketing.view', 'marketing.reporting.view') then
    raise exception 'a viewer profile can only be granted read permissions'
      using errcode = '22023';
  end if;

  -- SERIALISE access-management per tenant BEFORE reading grant state: two
  -- concurrent mutations (e.g. two managers denying themselves) can never both
  -- observe the pre-change state — the lockout count below is race-free.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|mkaccess', 42));

  -- optimistic concurrency: the caller must know the current state
  select granted into v_cur from marketing_access_grants
   where tenant_id = p_tenant and profile_id = p_profile and permission = p_permission
   for update;
  v_cur_state := case when v_cur is null then 'none'
                      when v_cur then 'granted' else 'denied' end;
  if v_cur_state <> p_expected then
    raise exception 'grant state changed elsewhere (expected %, found %)',
      p_expected, v_cur_state using errcode = 'MK409';
  end if;

  -- an EXACT no-op (target state equals current state) returns idempotently
  -- without writing a duplicate grant/audit/event
  v_new_state := case p_mode when 'grant' then 'granted'
                             when 'deny' then 'denied' else 'none' end;
  if v_new_state = v_cur_state then
    return jsonb_build_object(
      'profile_id', p_profile, 'permission', p_permission,
      'state', v_cur_state, 'no_op', true,
      'effective', marketing_effective_permissions(p_profile) -> 'permissions');
  end if;

  -- LOCKOUT protection: after this operation at least one profile must retain
  -- effective marketing.access.manage (owner/admin role without an explicit
  -- deny — restricted grants never extend the set beyond owner/admin).
  if p_permission = 'marketing.access.manage' and p_mode in ('deny', 'clear') then
    select count(*) into v_managers
      from profiles pr
     where pr.tenant_id = p_tenant and pr.role in ('owner', 'admin')
       and not exists (
         select 1 from marketing_access_grants g
          where g.tenant_id = p_tenant and g.profile_id = pr.id
            and g.permission = 'marketing.access.manage' and not g.granted
            and g.profile_id <> p_profile)          -- existing denies stand…
       and not (p_mode = 'deny' and pr.id = p_profile); -- …plus the one being made
    if v_managers = 0 then
      raise exception 'this change would remove the last Marketing access manager'
        using errcode = 'MK423';
    end if;
  end if;

  if p_mode = 'clear' then
    delete from marketing_access_grants
     where tenant_id = p_tenant and profile_id = p_profile and permission = p_permission;
  else
    insert into marketing_access_grants (tenant_id, profile_id, permission, granted, granted_by)
    values (p_tenant, p_profile, p_permission, p_mode = 'grant', p_actor)
    on conflict (tenant_id, profile_id, permission)
    do update set granted = excluded.granted, granted_by = excluded.granted_by;
  end if;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_actor_label, 'marketing.access.changed', 'marketing_access_grant',
          p_profile::text, 'ok',
          jsonb_build_object('permission', p_permission, 'mode', p_mode,
                             'before', v_cur_state,
                             'after', case p_mode when 'grant' then 'granted'
                                                  when 'deny' then 'denied'
                                                  else 'none' end));
  perform marketing_event_append(p_tenant, 'marketing.access.changed', 'profile',
    p_profile, 'marketing-admin',
    jsonb_build_object('k', p_permission || ':' || p_mode || ':' || clock_timestamp()::text,
                       'permission', p_permission, 'mode', p_mode,
                       'before', v_cur_state, 'actor', v_actor_label, 'at', now()));

  return jsonb_build_object(
    'profile_id', p_profile, 'permission', p_permission,
    'state', case p_mode when 'grant' then 'granted'
                         when 'deny' then 'denied' else 'none' end,
    'effective', marketing_effective_permissions(p_profile) -> 'permissions');
end $$;

-- ===========================================================================
-- AUDIT — bounded keyset reads over marketing audit rows.
-- ===========================================================================
-- TRUE keyset pagination: the cursor is the exact (created_at, id) tuple of the
-- last row and the predicate is the matching tuple comparison — rows sharing a
-- boundary timestamp are never skipped. Detail is a BOUNDED SAFE projection
-- (allowlisted keys only): audit reads never expose raw imported rows, contact
-- destinations or other unnecessary PII that a future writer might place in
-- detail.
create or replace function marketing_audit_list(p_tenant uuid, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_limit int;
  v_prefix text := nullif(p_args ->> 'action_prefix', '');
  v_cur jsonb;
  v_cur_t timestamptz;
  v_cur_id uuid;
  v_rows jsonb;
  v_next jsonb;
  v_safe_keys text[] := array[
    'changed','version','op','stage_key','key','name','mode','permission',
    'before','after','reason','status','rows','valid','invalid','will_create',
    'will_update','will_conflict','duplicate_upload','created','updated',
    'conflicts','skipped','failed','requested','unique','applicable',
    'already_assigned','rejected','applied','remapped_active_relationships',
    'remapped_relationships','candidates','truncated','bulk_ref','source',
    'profile_id','profile_version','code','args','remap','no_op','idempotency_key'];
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  begin
    v_limit := least(greatest(coalesce((p_args ->> 'limit')::int, 25), 1), 50);
  exception when others then
    raise exception 'invalid audit filter' using errcode = '22023';
  end;
  if p_args ? 'cursor' then
    v_cur := p_args -> 'cursor';
    if jsonb_typeof(v_cur) <> 'object'
       or jsonb_typeof(v_cur -> 't') <> 'string'
       or jsonb_typeof(v_cur -> 'id') <> 'string'
       or (select count(*) from jsonb_object_keys(v_cur)) <> 2 then
      raise exception 'invalid audit cursor' using errcode = '22023';
    end if;
    begin
      v_cur_t := (v_cur ->> 't')::timestamptz;
      v_cur_id := (v_cur ->> 'id')::uuid;
    exception when others then
      raise exception 'invalid audit cursor' using errcode = '22023';
    end;
  end if;
  if v_prefix is not null and (length(v_prefix) > 60 or v_prefix !~ '^[a-z0-9._]+$') then
    raise exception 'invalid action prefix' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_rows from (
    select al.id, al.actor, al.action, al.resource_type, al.resource_id,
           al.status,
           coalesce((select jsonb_object_agg(e.key, e.value)
                       from jsonb_each(al.detail) e
                      where e.key = any (v_safe_keys)), '{}'::jsonb) as detail,
           al.created_at
      from audit_logs al
     where al.tenant_id = p_tenant
       and al.action like 'marketing.%'
       and (v_cur_id is null or (al.created_at, al.id) < (v_cur_t, v_cur_id))
       and (v_prefix is null or al.action like v_prefix || '%')
     order by al.created_at desc, al.id desc
     limit v_limit
  ) a;
  -- next_cursor: the exact tuple of the last returned row (null when the page
  -- is not full — there is nothing more to fetch)
  if jsonb_array_length(v_rows) = v_limit then
    v_next := jsonb_build_object(
      't', v_rows -> (v_limit - 1) ->> 'created_at',
      'id', v_rows -> (v_limit - 1) ->> 'id');
  end if;
  return jsonb_build_object('items', v_rows, 'next_cursor', v_next);
end $$;

-- ===========================================================================
-- TAGS — governed administration (keys immutable, never hard-deleted) + list
-- with real assignment counts + BOUNDED bulk assignment with preflight.
--
-- marketing_tag_mutate (Phase-2 create/assign/remove) is REDEFINED here so
-- EVERY tag mutation path enforces the canonical permission boundary: a real
-- same-tenant actor holding effective marketing.tags.manage from the
-- resolver, exact per-operation argument shapes, strict JSON types and no
-- unknown keys. Assign additionally LOCKS the tag row and rejects an INACTIVE
-- tag (consistent with marketing_tag_bulk and imports); remove stays legal on
-- an inactive tag so historical assignments can be cleaned up. Remaining
-- behaviour (slug keys, idempotent assign, audited remove, k-keyed events) is
-- unchanged.
-- ===========================================================================
create or replace function marketing_tag_mutate(
  p_tenant uuid, p_actor uuid, p_op text, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_actor_tenant uuid;
  v_actor_label text;
  v_key text;
  v_label text;
  v_tone text;
  v_tag uuid;
  v_person uuid;
  v_tag_row marketing_tags%rowtype;
  v_deleted int;
begin
  if p_tenant is null or p_actor is null then
    raise exception 'tenant and actor required' using errcode = '22023';
  end if;
  if p_op not in ('create', 'assign', 'remove') then
    raise exception 'invalid tag operation' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  select tenant_id into v_actor_tenant from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  -- AUTHORITATIVE permission check (canonical resolver): a viewer — even one
  -- holding a hostile raw write-grant row — can never mutate tags here.
  if not ((marketing_effective_permissions(p_actor) -> 'permissions')
          ? 'marketing.tags.manage') then
    raise exception 'actor lacks marketing.tags.manage' using errcode = '42501';
  end if;
  v_actor_label := coalesce((select email from profiles where id = p_actor), p_actor::text);

  -- exact per-operation argument shapes — unknown keys rejected, never ignored
  for v_key in select jsonb_object_keys(p_args) loop
    if (p_op = 'create' and v_key not in ('label', 'tone'))
       or (p_op in ('assign', 'remove') and v_key not in ('tag_id', 'person_id')) then
      raise exception 'unknown % argument %', p_op, v_key using errcode = '22023';
    end if;
  end loop;

  if p_op = 'create' then
    if jsonb_typeof(p_args -> 'label') is distinct from 'string'
       or (p_args ? 'tone' and jsonb_typeof(p_args -> 'tone') <> 'string') then
      raise exception 'invalid create argument types' using errcode = '22023';
    end if;
    v_label := nullif(trim(coalesce(p_args ->> 'label', '')), '');
    v_tone := coalesce(nullif(p_args ->> 'tone', ''), 'neutral');
    if v_label is null or length(v_label) > 60 then
      raise exception 'label required (max 60 chars)' using errcode = '22023';
    end if;
    if v_tone not in ('neutral', 'info', 'positive', 'attention', 'negative') then
      raise exception 'invalid tone' using errcode = '22023';
    end if;
    v_key := left(regexp_replace(regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g'),
                                 '^_+|_+$', '', 'g'), 40);
    if v_key = '' then
      raise exception 'label must contain letters or digits' using errcode = '22023';
    end if;
    insert into marketing_tags (tenant_id, key, label, tone, created_by)
    values (p_tenant, v_key, v_label, v_tone, p_actor)
    returning * into v_tag_row;
    insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
    values (p_tenant, v_actor_label, 'marketing.tag.created', 'marketing_tag',
            v_tag_row.id::text, 'ok', jsonb_build_object('key', v_key));
    perform marketing_event_append(p_tenant, 'marketing.tag.created', 'marketing_tag',
      v_tag_row.id, 'marketing-contacts',
      jsonb_build_object('k', 'created:' || v_tag_row.id, 'key', v_key,
                         'actor', v_actor_label, 'at', now()));
    return jsonb_build_object('id', v_tag_row.id, 'key', v_tag_row.key,
                              'label', v_tag_row.label, 'tone', v_tag_row.tone);
  end if;

  if jsonb_typeof(p_args -> 'tag_id') is distinct from 'string'
     or jsonb_typeof(p_args -> 'person_id') is distinct from 'string' then
    raise exception 'tag_id and person_id required' using errcode = '22023';
  end if;
  begin
    v_tag := (p_args ->> 'tag_id')::uuid;
    v_person := (p_args ->> 'person_id')::uuid;
  exception when others then
    raise exception 'invalid tag or person id' using errcode = '22023';
  end;
  if p_op = 'assign' then
    -- LOCK the tag row (same discipline as marketing_tag_bulk apply): a
    -- concurrent deactivate serialises here, and assigning an INACTIVE tag is
    -- rejected — single-contact assignment can never resurrect retired
    -- vocabulary. Removal stays legal on an inactive tag so historical
    -- assignments can be cleaned up.
    select * into v_tag_row from marketing_tags
     where id = v_tag and tenant_id = p_tenant for update;
    if not found then
      raise exception 'tag not found in tenant' using errcode = 'P0002';
    end if;
    if not v_tag_row.active then
      raise exception 'an inactive tag cannot be assigned' using errcode = '22023';
    end if;
  elsif not exists (select 1 from marketing_tags where id = v_tag and tenant_id = p_tenant) then
    raise exception 'tag not found in tenant' using errcode = 'P0002';
  end if;
  if not exists (select 1 from people where id = v_person and tenant_id = p_tenant) then
    raise exception 'person not found in tenant' using errcode = 'P0002';
  end if;

  if p_op = 'assign' then
    begin
      insert into contact_tag_assignments (tenant_id, person_id, tag_id, source, assigned_by)
      values (p_tenant, v_person, v_tag, 'manual', p_actor);
    exception when unique_violation then
      return jsonb_build_object('assigned', true, 'idempotent', true);
    end;
    insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
    values (p_tenant, v_actor_label, 'marketing.tag.assigned', 'person', v_person::text,
            'ok', jsonb_build_object('tag_id', v_tag));
    perform marketing_event_append(p_tenant, 'marketing.contact.tag_changed', 'person',
      v_person, 'marketing-contacts',
      jsonb_build_object('k', 'assign:' || v_tag || ':' ||
                              clock_timestamp()::text,
                         'op', 'assigned', 'tag_id', v_tag, 'actor', v_actor_label, 'at', now()));
    return jsonb_build_object('assigned', true);
  else
    delete from contact_tag_assignments
     where tenant_id = p_tenant and person_id = v_person and tag_id = v_tag;
    get diagnostics v_deleted = row_count;
    if v_deleted > 0 then
      insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
      values (p_tenant, v_actor_label, 'marketing.tag.removed', 'person', v_person::text,
              'ok', jsonb_build_object('tag_id', v_tag));
      perform marketing_event_append(p_tenant, 'marketing.contact.tag_changed', 'person',
        v_person, 'marketing-contacts',
        jsonb_build_object('k', 'remove:' || v_tag || ':' ||
                                clock_timestamp()::text,
                           'op', 'removed', 'tag_id', v_tag, 'actor', v_actor_label, 'at', now()));
    end if;
    return jsonb_build_object('removed', v_deleted > 0);
  end if;
end $$;

create or replace function marketing_tags_admin_list(p_tenant uuid)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'key', t.key, 'label', t.label, 'tone', t.tone,
           'description', t.description, 'active', t.active,
           'updated_at', t.updated_at,
           'assignment_count', (
             select count(*) from contact_tag_assignments a
              where a.tenant_id = p_tenant and a.tag_id = t.id))
           order by t.active desc, t.label), '[]'::jsonb)
    from (select * from marketing_tags
           where tenant_id = p_tenant
           order by active desc, label limit 200) t;
$$;

create or replace function marketing_tag_admin(
  p_tenant uuid, p_actor uuid, p_op text, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_actor_tenant uuid;
  v_actor_label text;
  v_tag marketing_tags%rowtype;
  v_id uuid;
  v_expected timestamptz;
  v_key text;
  v_label text;
  v_tone text;
  v_desc text;
begin
  if p_tenant is null or p_actor is null then
    raise exception 'tenant and actor required' using errcode = '22023';
  end if;
  select tenant_id into v_actor_tenant from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  -- AUTHORITATIVE permission check at the mutation boundary (canonical
  -- resolver): a viewer — even one holding a hostile raw grant row — can never
  -- mutate here.
  if not ((marketing_effective_permissions(p_actor) -> 'permissions')
          ? 'marketing.tags.manage') then
    raise exception 'actor lacks marketing.tags.manage' using errcode = '42501';
  end if;
  v_actor_label := coalesce((select email from profiles where id = p_actor), p_actor::text);
  if p_op not in ('rename','set_tone','set_description','deactivate','reactivate')
     or p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'unknown tag admin op' using errcode = '22023';
  end if;
  -- each op accepts ONLY its declared argument shape — unknown keys rejected
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('tag_id', 'expected_updated_at')
       and not (p_op = 'rename' and v_key = 'label')
       and not (p_op = 'set_tone' and v_key = 'tone')
       and not (p_op = 'set_description' and v_key = 'description') then
      raise exception 'unknown % argument %', p_op, v_key using errcode = '22023';
    end if;
  end loop;
  begin
    v_id := (p_args ->> 'tag_id')::uuid;
    v_expected := (p_args ->> 'expected_updated_at')::timestamptz;
  exception when others then
    raise exception 'invalid tag_id or expected_updated_at' using errcode = '22023';
  end;
  if v_id is null or v_expected is null then
    raise exception 'tag_id and expected_updated_at required' using errcode = '22023';
  end if;
  select * into v_tag from marketing_tags
   where id = v_id and tenant_id = p_tenant for update;
  if not found then
    raise exception 'tag not found for tenant' using errcode = 'P0002';
  end if;
  if v_tag.updated_at is distinct from v_expected then
    raise exception 'tag was changed elsewhere' using errcode = 'MK409';
  end if;

  if p_op = 'rename' then
    v_label := nullif(trim(coalesce(p_args ->> 'label', '')), '');
    if v_label is null or length(v_label) > 60 then
      raise exception 'label required (max 60 chars)' using errcode = '22023';
    end if;
    if v_label = v_tag.label then
      raise exception 'rename is a no-op' using errcode = '22023';
    end if;
    update marketing_tags set label = v_label where id = v_id returning * into v_tag;
  elsif p_op = 'set_tone' then
    v_tone := p_args ->> 'tone';
    if v_tone not in ('neutral','info','positive','attention','negative') then
      raise exception 'invalid tone' using errcode = '22023';
    end if;
    if v_tone = v_tag.tone then
      raise exception 'set_tone is a no-op' using errcode = '22023';
    end if;
    update marketing_tags set tone = v_tone where id = v_id returning * into v_tag;
  elsif p_op = 'set_description' then
    v_desc := nullif(trim(coalesce(p_args ->> 'description', '')), '');
    if v_desc is not null and length(v_desc) > 300 then
      raise exception 'description too long (max 300 chars)' using errcode = '22023';
    end if;
    if v_desc is not distinct from v_tag.description then
      raise exception 'set_description is a no-op' using errcode = '22023';
    end if;
    update marketing_tags set description = v_desc where id = v_id returning * into v_tag;
  elsif p_op = 'deactivate' then
    if not v_tag.active then
      raise exception 'tag is already inactive' using errcode = '22023';
    end if;
    update marketing_tags set active = false where id = v_id returning * into v_tag;
  else
    if v_tag.active then
      raise exception 'tag is already active' using errcode = '22023';
    end if;
    update marketing_tags set active = true where id = v_id returning * into v_tag;
  end if;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_actor_label, 'marketing.tag.updated', 'marketing_tag',
          v_tag.id::text, 'ok', jsonb_build_object('op', p_op, 'key', v_tag.key));
  perform marketing_event_append(p_tenant, 'marketing.tag.updated', 'marketing_tag',
    v_tag.id, 'marketing-contacts',
    jsonb_build_object('k', p_op || ':' || clock_timestamp()::text,
                       'op', p_op, 'key', v_tag.key,
                       'actor', v_actor_label, 'at', now()));
  return jsonb_build_object('id', v_tag.id, 'key', v_tag.key, 'label', v_tag.label,
                            'tone', v_tag.tone, 'description', v_tag.description,
                            'active', v_tag.active, 'updated_at', v_tag.updated_at);
end $$;

-- Bulk tag assignment/removal. BOUNDED (≤200 People per call). Counting is
-- UNAMBIGUOUS: requested = ids supplied (with duplicates), unique = distinct
-- ids, rejected = unique ids that are not this tenant's People (duplicates are
-- NEVER counted as rejected), already_assigned / applicable over the unique
-- tenant-valid set. Preflight returns a server-issued CONTRACT hash over
-- (tenant, tag, op, sorted unique ids); apply requires the same hash, so
-- preflight and apply provably refer to the same tag/op/selection. Apply LOCKS
-- the tag row (an inactive-tag race fails safely), is idempotent, and stamps
-- every assignment with actor, source and a stable bulk-operation reference.
-- Foreign ids are counted, never echoed.
create or replace function marketing_tag_bulk(
  p_tenant uuid, p_actor uuid, p_op text, p_tag uuid, p_person_ids uuid[], p_mode text,
  p_contract text default null
) returns jsonb
language plpgsql
as $$
declare
  v_actor_tenant uuid;
  v_actor_label text;
  v_tag marketing_tags%rowtype;
  v_requested int;
  v_unique uuid[];
  v_valid uuid[];
  v_rejected int;
  v_already int;
  v_applicable int;
  v_contract text;
  v_bulk_ref uuid;
  v_n int := 0;
begin
  if p_tenant is null or p_actor is null then
    raise exception 'tenant and actor required' using errcode = '22023';
  end if;
  select tenant_id into v_actor_tenant from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  -- AUTHORITATIVE permission check: viewer mutation (even via a hostile raw
  -- grant row) is impossible here.
  if not ((marketing_effective_permissions(p_actor) -> 'permissions')
          ? 'marketing.tags.manage') then
    raise exception 'actor lacks marketing.tags.manage' using errcode = '42501';
  end if;
  v_actor_label := coalesce((select email from profiles where id = p_actor), p_actor::text);
  if p_op not in ('assign', 'remove') or p_mode not in ('preflight', 'apply') then
    raise exception 'invalid bulk op/mode' using errcode = '22023';
  end if;
  v_requested := coalesce(array_length(p_person_ids, 1), 0);
  if v_requested < 1 or v_requested > 200 then
    raise exception 'bulk operations are bounded to 1-200 People' using errcode = '22023';
  end if;
  -- apply LOCKS the tag row: a concurrent deactivate serialises here and an
  -- assign against a just-deactivated tag fails safely below
  if p_mode = 'apply' then
    select * into v_tag from marketing_tags
     where id = p_tag and tenant_id = p_tenant for update;
  else
    select * into v_tag from marketing_tags where id = p_tag and tenant_id = p_tenant;
  end if;
  if not found then
    raise exception 'tag not found for tenant' using errcode = 'P0002';
  end if;
  if p_op = 'assign' and not v_tag.active then
    raise exception 'an inactive tag cannot be assigned' using errcode = '22023';
  end if;

  -- duplicates collapse into the unique set — they are NOT "rejected"
  select array_agg(u.id order by u.id) into v_unique
    from (select distinct id from unnest(p_person_ids) t(id)) u;
  -- tenant-safe candidate set (foreign ids fall out here and are only counted)
  select array_agg(p.id order by p.id) into v_valid
    from unnest(v_unique) u(id)
    join people p on p.id = u.id and p.tenant_id = p_tenant;
  v_rejected := coalesce(array_length(v_unique, 1), 0)
                - coalesce(array_length(v_valid, 1), 0);

  select count(*) into v_already
    from contact_tag_assignments a
   where a.tenant_id = p_tenant and a.tag_id = p_tag
     and a.person_id = any (coalesce(v_valid, '{}'::uuid[]));

  v_applicable := case when p_op = 'assign'
    then coalesce(array_length(v_valid, 1), 0) - v_already
    else v_already end;

  -- one checked contract binds preflight → apply: same tenant, tag, op and
  -- EXACT unique selection, or the apply is rejected
  v_contract := md5(p_tenant::text || '|' || p_tag::text || '|' || p_op || '|'
                    || array_to_string(coalesce(v_unique, '{}'::uuid[]), ','));

  if p_mode = 'preflight' then
    return jsonb_build_object('requested', v_requested,
      'unique', coalesce(array_length(v_unique, 1), 0),
      'applicable', v_applicable, 'already_assigned', v_already,
      'rejected', v_rejected, 'op', p_op, 'contract', v_contract);
  end if;

  if p_contract is null or p_contract <> v_contract then
    raise exception 'bulk apply does not match its preflight contract'
      using errcode = 'MK409';
  end if;

  v_bulk_ref := gen_random_uuid();
  if p_op = 'assign' then
    insert into contact_tag_assignments
      (tenant_id, person_id, tag_id, source, trigger_ref, assigned_by)
    select p_tenant, u.id, p_tag, 'manual', 'bulk:' || v_bulk_ref,  p_actor
      from unnest(coalesce(v_valid, '{}'::uuid[])) u(id)
    on conflict (tenant_id, person_id, tag_id) do nothing;
    get diagnostics v_n = row_count;
  else
    delete from contact_tag_assignments a
     where a.tenant_id = p_tenant and a.tag_id = p_tag
       and a.person_id = any (coalesce(v_valid, '{}'::uuid[]));
    get diagnostics v_n = row_count;
  end if;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_actor_label, 'marketing.tag.bulk_' || p_op, 'marketing_tag',
          p_tag::text, 'ok',
          jsonb_build_object('requested', v_requested,
                             'unique', coalesce(array_length(v_unique, 1), 0),
                             'applied', v_n,
                             'already_assigned', v_already, 'rejected', v_rejected,
                             'bulk_ref', 'bulk:' || v_bulk_ref,
                             'source', 'manual_bulk'));
  perform marketing_event_append(p_tenant, 'marketing.contact.tags_bulk_changed',
    'marketing_tag', p_tag, 'marketing-contacts',
    jsonb_build_object('k', p_op || ':' || v_bulk_ref,
                       'op', p_op, 'applied', v_n, 'rejected', v_rejected,
                       'bulk_ref', 'bulk:' || v_bulk_ref,
                       'actor', v_actor_label, 'at', now()));
  return jsonb_build_object('requested', v_requested,
                            'unique', coalesce(array_length(v_unique, 1), 0),
                            'applied', v_n,
                            'already_assigned', v_already, 'rejected', v_rejected,
                            'op', p_op, 'bulk_ref', 'bulk:' || v_bulk_ref);
end $$;

-- ===========================================================================
-- SEGMENTS — constrained validated AST, immutable versions, server evaluation.
--
-- AST grammar (strict; anything else → 22023):
--   group: {"op":"and"|"or", "children":[node…]}   (1–10 children)
--   not:   {"op":"not", "child":node}
--   leaf:  {"field":"search","value":text}
--          {"field":"relationship","match":{lifecycle?,type?,status?,source?,owner_id?}}
--            — SINGLE-ROW semantics: one relationship row satisfies EVERY
--              supplied predicate (owner_id may be 'unassigned').
--          {"field":"company","value":uuid|null}
--          {"field":"created","from"?:ts,"to"?:ts}
--          {"field":"last_contact","from"?:ts,"to"?:ts,"never"?:bool}
--          {"field":"tag","mode":"any"|"all"|"none","tag_ids":[uuid…]}
--          {"field":"eligibility","channel":"email"|"phone","value":state}
-- Bounds: depth ≤ 4, nodes ≤ 32, arrays ≤ 20, strings ≤ 120.
-- Unsupported concepts (campaign_engagement, ad_attribution, card_state, …)
-- return a CLEAR error and stay Preview in the builder.
-- ===========================================================================
-- Depth is enforced BEFORE descending and the total node budget DURING
-- traversal (p_count carries the running total), so a hostile deep or wide
-- tree is rejected at the first excess node — never after exhausting the
-- stack. Both stored and ad-hoc definitions go through this one entry point
-- with identical limits. Every node level rejects unknown keys, mixed
-- op+field objects and non-strict JSON scalar types.
create or replace function marketing_segment_validate(
  p_tenant uuid, p_node jsonb, p_depth int default 0, p_count int default 0
) returns int  -- total node count so far (recursion accumulator)
language plpgsql
stable
as $$
declare
  v_child jsonb;
  v_count int;
  v_key text;
  v_match jsonb;
  v_txt text;
  v_ids uuid[];
  v_from timestamptz;
  v_to timestamptz;
begin
  if p_node is null or jsonb_typeof(p_node) <> 'object' then
    raise exception 'segment nodes must be objects' using errcode = '22023';
  end if;
  if p_depth > 4 then
    raise exception 'segment definition too deep (max depth 4)' using errcode = '22023';
  end if;
  v_count := p_count + 1;
  if v_count > 32 then
    raise exception 'segment definition too large (max 32 nodes)' using errcode = '22023';
  end if;
  if p_node ? 'op' and p_node ? 'field' then
    raise exception 'a segment node cannot be both a group and a leaf'
      using errcode = '22023';
  end if;

  if p_node ? 'op' then
    if jsonb_typeof(p_node -> 'op') <> 'string' then
      raise exception 'segment operator must be a string' using errcode = '22023';
    end if;
    if p_node ->> 'op' in ('and', 'or') then
      for v_key in select jsonb_object_keys(p_node) loop
        if v_key not in ('op', 'children') then
          raise exception 'unknown group key %', v_key using errcode = '22023';
        end if;
      end loop;
      if jsonb_typeof(p_node -> 'children') is distinct from 'array'
         or jsonb_array_length(p_node -> 'children') not between 1 and 10 then
        raise exception 'and/or groups need 1-10 children' using errcode = '22023';
      end if;
      for v_child in select * from jsonb_array_elements(p_node -> 'children') loop
        v_count := marketing_segment_validate(p_tenant, v_child, p_depth + 1, v_count);
      end loop;
      return v_count;
    elsif p_node ->> 'op' = 'not' then
      for v_key in select jsonb_object_keys(p_node) loop
        if v_key not in ('op', 'child') then
          raise exception 'unknown group key %', v_key using errcode = '22023';
        end if;
      end loop;
      return marketing_segment_validate(p_tenant, p_node -> 'child', p_depth + 1, v_count);
    else
      raise exception 'unknown segment operator %', p_node ->> 'op' using errcode = '22023';
    end if;
  end if;

  -- leaf: exact declared shape per field — unknown keys rejected
  if jsonb_typeof(p_node -> 'field') is distinct from 'string' then
    raise exception 'unknown segment field (missing)' using errcode = '22023';
  end if;
  -- unsupported Preview concepts keep their EXPLICIT error (checked before the
  -- per-field key allowlist, which knows nothing about their shapes)
  if p_node ->> 'field' in ('campaign_engagement', 'ad_attribution', 'card_state') then
    raise exception 'unsupported segment filter: % (Preview — arrives with a later phase)',
      p_node ->> 'field' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_node) loop
    if v_key <> 'field' and not (
         (p_node ->> 'field' = 'search' and v_key = 'value')
      or (p_node ->> 'field' = 'relationship' and v_key = 'match')
      or (p_node ->> 'field' = 'company' and v_key = 'value')
      or (p_node ->> 'field' = 'created' and v_key in ('from', 'to'))
      or (p_node ->> 'field' = 'last_contact' and v_key in ('from', 'to', 'never'))
      or (p_node ->> 'field' = 'tag' and v_key in ('mode', 'tag_ids'))
      or (p_node ->> 'field' = 'eligibility' and v_key in ('channel', 'value'))) then
      raise exception 'unknown % key %', p_node ->> 'field', v_key using errcode = '22023';
    end if;
  end loop;

  case p_node ->> 'field'
  when 'search' then
    if jsonb_typeof(p_node -> 'value') <> 'string' then
      raise exception 'search value must be a string' using errcode = '22023';
    end if;
    v_txt := p_node ->> 'value';
    if v_txt is null or length(trim(v_txt)) = 0 or length(v_txt) > 120 then
      raise exception 'search value must be 1-120 chars' using errcode = '22023';
    end if;
  when 'relationship' then
    v_match := p_node -> 'match';
    if v_match is null or jsonb_typeof(v_match) <> 'object'
       or (select count(*) from jsonb_object_keys(v_match)) = 0 then
      raise exception 'relationship leaf needs a match object' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_match) loop
      if v_key not in ('lifecycle','type','status','source','owner_id') then
        raise exception 'unknown relationship predicate %', v_key using errcode = '22023';
      end if;
      if jsonb_typeof(v_match -> v_key) <> 'string' then
        raise exception 'relationship predicate % must be a string', v_key
          using errcode = '22023';
      end if;
    end loop;
    if v_match ? 'status'
       and (v_match ->> 'status') not in ('active','inactive','archived') then
      raise exception 'invalid relationship status' using errcode = '22023';
    end if;
    if v_match ? 'source'
       and (v_match ->> 'source') not in ('discovery','import','manual','ad_lead','system') then
      raise exception 'invalid relationship source' using errcode = '22023';
    end if;
    if v_match ? 'lifecycle' and not exists (
         select 1 from marketing_lifecycle_stages s
          where s.tenant_id = p_tenant and s.stage_key = v_match ->> 'lifecycle') then
      raise exception 'unknown lifecycle stage' using errcode = '22023';
    end if;
    if v_match ? 'type' and (v_match ->> 'type') not in
       ('lead','prospect','customer','former_customer','supplier','partner','commercial','other') then
      raise exception 'invalid relationship type' using errcode = '22023';
    end if;
    if v_match ? 'owner_id' and (v_match ->> 'owner_id') <> 'unassigned' then
      begin
        if not exists (select 1 from profiles pr
                        where pr.id = (v_match ->> 'owner_id')::uuid
                          and pr.tenant_id = p_tenant) then
          raise exception 'unknown owner' using errcode = '22023';
        end if;
      exception when invalid_text_representation then
        raise exception 'invalid owner id' using errcode = '22023';
      end;
    end if;
  when 'company' then
    if jsonb_typeof(p_node -> 'value') = 'null' then null;
    elsif jsonb_typeof(p_node -> 'value') <> 'string' then
      raise exception 'company value must be a company id or null' using errcode = '22023';
    else
      begin
        if not exists (select 1 from companies c
                        where c.id = (p_node ->> 'value')::uuid
                          and c.tenant_id = p_tenant) then
          raise exception 'unknown company' using errcode = '22023';
        end if;
      exception when invalid_text_representation then
        raise exception 'invalid company id' using errcode = '22023';
      end;
    end if;
  when 'created' then
    if (p_node ? 'from' and jsonb_typeof(p_node -> 'from') <> 'string')
       or (p_node ? 'to' and jsonb_typeof(p_node -> 'to') <> 'string') then
      raise exception 'invalid created range' using errcode = '22023';
    end if;
    begin
      if (p_node ->> 'from') is null and (p_node ->> 'to') is null then
        raise exception 'created range needs from and/or to' using errcode = '22023';
      end if;
      v_from := (p_node ->> 'from')::timestamptz;
      v_to := (p_node ->> 'to')::timestamptz;
    exception when others then
      raise exception 'invalid created range' using errcode = '22023';
    end;
    if v_from is not null and v_to is not null and v_from > v_to then
      raise exception 'created range is reversed (from must be <= to)'
        using errcode = '22023';
    end if;
  when 'last_contact' then
    if (p_node ? 'from' and jsonb_typeof(p_node -> 'from') <> 'string')
       or (p_node ? 'to' and jsonb_typeof(p_node -> 'to') <> 'string')
       or (p_node ? 'never' and jsonb_typeof(p_node -> 'never') <> 'boolean') then
      raise exception 'invalid last_contact filter' using errcode = '22023';
    end if;
    begin
      if coalesce((p_node ->> 'never')::boolean, false) then
        if (p_node ->> 'from') is not null or (p_node ->> 'to') is not null then
          raise exception 'last_contact never excludes from/to' using errcode = '22023';
        end if;
      elsif (p_node ->> 'from') is null and (p_node ->> 'to') is null then
        raise exception 'last_contact needs from/to or never' using errcode = '22023';
      end if;
      v_from := (p_node ->> 'from')::timestamptz;
      v_to := (p_node ->> 'to')::timestamptz;
    exception when others then
      raise exception 'invalid last_contact filter' using errcode = '22023';
    end;
    if v_from is not null and v_to is not null and v_from > v_to then
      raise exception 'last_contact range is reversed (from must be <= to)'
        using errcode = '22023';
    end if;
  when 'tag' then
    if jsonb_typeof(p_node -> 'mode') is distinct from 'string'
       or (p_node ->> 'mode') not in ('any', 'all', 'none')
       or jsonb_typeof(p_node -> 'tag_ids') is distinct from 'array'
       or jsonb_array_length(p_node -> 'tag_ids') not between 1 and 20 then
      raise exception 'tag leaf needs mode any|all|none and 1-20 tag_ids'
        using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(p_node -> 'tag_ids') e
                where jsonb_typeof(e.value) <> 'string') then
      raise exception 'invalid tag id' using errcode = '22023';
    end if;
    begin
      select array_agg(value::uuid) into v_ids
        from jsonb_array_elements_text(p_node -> 'tag_ids');
    exception when others then
      raise exception 'invalid tag id' using errcode = '22023';
    end;
    -- duplicates would silently break "all" semantics — rejected, never guessed
    if (select count(distinct u.id) from unnest(v_ids) u(id))
       <> coalesce(array_length(v_ids, 1), 0) then
      raise exception 'duplicate tag ids in tag leaf' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_ids) u(id)
                left join marketing_tags t on t.id = u.id and t.tenant_id = p_tenant
               where t.id is null) then
      raise exception 'unknown tag' using errcode = '22023';
    end if;
  when 'eligibility' then
    if jsonb_typeof(p_node -> 'channel') is distinct from 'string'
       or jsonb_typeof(p_node -> 'value') is distinct from 'string'
       or (p_node ->> 'channel') not in ('email', 'phone')
       or (p_node ->> 'value') not in
          ('subscribed','unsubscribed','suppressed','unknown','invalid','no_contact_point') then
      raise exception 'invalid eligibility leaf' using errcode = '22023';
    end if;
  when 'campaign_engagement', 'ad_attribution', 'card_state' then
    raise exception 'unsupported segment filter: % (Preview — arrives with a later phase)',
      p_node ->> 'field' using errcode = '22023';
  else
    raise exception 'unknown segment field %', coalesce(p_node ->> 'field', '(missing)')
      using errcode = '22023';
  end case;
  return v_count;
end $$;

create or replace function marketing_segment_match_person(
  p_tenant uuid, p_person uuid, p_node jsonb, p_depth int default 0
) returns boolean
language plpgsql
stable
as $$
declare
  v_child jsonb;
  v_match jsonb;
  v_txt text;
  v_ids uuid[];
  v_res boolean;
begin
  if p_depth > 4 then
    raise exception 'segment depth exceeded' using errcode = '22023';
  end if;

  if p_node ? 'op' then
    if p_node ->> 'op' = 'and' then
      for v_child in select * from jsonb_array_elements(p_node -> 'children') loop
        if not marketing_segment_match_person(p_tenant, p_person, v_child, p_depth + 1) then
          return false;
        end if;
      end loop;
      return true;
    elsif p_node ->> 'op' = 'or' then
      for v_child in select * from jsonb_array_elements(p_node -> 'children') loop
        if marketing_segment_match_person(p_tenant, p_person, v_child, p_depth + 1) then
          return true;
        end if;
      end loop;
      return false;
    else
      return not marketing_segment_match_person(p_tenant, p_person, p_node -> 'child', p_depth + 1);
    end if;
  end if;

  case p_node ->> 'field'
  when 'search' then
    v_txt := p_node ->> 'value';
    select exists (select 1 from people p
                    where p.id = p_person and p.tenant_id = p_tenant
                      and (p.display_name ilike '%' || v_txt || '%'
                           or p.primary_email ilike v_txt || '%'
                           or p.primary_phone like v_txt || '%')) into v_res;
  when 'relationship' then
    v_match := p_node -> 'match';
    -- SINGLE-ROW semantics: one row satisfies every supplied predicate
    select exists (
      select 1 from contact_relationships r
       where r.tenant_id = p_tenant and r.person_id = p_person
         and (not (v_match ? 'lifecycle') or r.lifecycle_stage_key = v_match ->> 'lifecycle')
         and (not (v_match ? 'type') or r.relationship_type = v_match ->> 'type')
         and (not (v_match ? 'status') or r.status = v_match ->> 'status')
         and (not (v_match ? 'source') or r.source = v_match ->> 'source')
         and (not (v_match ? 'owner_id')
              or (v_match ->> 'owner_id' = 'unassigned' and r.owner_id is null)
              or (v_match ->> 'owner_id' <> 'unassigned'
                  and r.owner_id = (v_match ->> 'owner_id')::uuid))) into v_res;
  when 'company' then
    if jsonb_typeof(p_node -> 'value') = 'null' then
      select exists (select 1 from people p
                      where p.id = p_person and p.tenant_id = p_tenant
                        and p.company_id is null) into v_res;
    else
      select exists (select 1 from people p
                      join companies c on c.id = p.company_id and c.tenant_id = p_tenant
                      where p.id = p_person and p.tenant_id = p_tenant
                        and p.company_id = (p_node ->> 'value')::uuid) into v_res;
    end if;
  when 'created' then
    select exists (select 1 from people p
                    where p.id = p_person and p.tenant_id = p_tenant
                      and ((p_node ->> 'from') is null
                           or p.created_at >= (p_node ->> 'from')::timestamptz)
                      and ((p_node ->> 'to') is null
                           or p.created_at <= (p_node ->> 'to')::timestamptz)) into v_res;
  when 'last_contact' then
    if coalesce((p_node ->> 'never')::boolean, false) then
      select not exists (select 1 from interactions i
                          where i.tenant_id = p_tenant
                            and i.related_person_id = p_person) into v_res;
    else
      select exists (
        select 1 from (
          select max(i.occurred_at) as last_at from interactions i
           where i.tenant_id = p_tenant and i.related_person_id = p_person) x
         where x.last_at is not null
           and ((p_node ->> 'from') is null or x.last_at >= (p_node ->> 'from')::timestamptz)
           and ((p_node ->> 'to') is null or x.last_at <= (p_node ->> 'to')::timestamptz))
        into v_res;
    end if;
  when 'tag' then
    select array_agg(value::uuid) into v_ids
      from jsonb_array_elements_text(p_node -> 'tag_ids');
    if p_node ->> 'mode' = 'any' then
      select exists (select 1 from contact_tag_assignments a
                      where a.tenant_id = p_tenant and a.person_id = p_person
                        and a.tag_id = any (v_ids)) into v_res;
    elsif p_node ->> 'mode' = 'all' then
      select (select count(distinct a.tag_id) from contact_tag_assignments a
               where a.tenant_id = p_tenant and a.person_id = p_person
                 and a.tag_id = any (v_ids)) = array_length(v_ids, 1) into v_res;
    else
      select not exists (select 1 from contact_tag_assignments a
                          where a.tenant_id = p_tenant and a.person_id = p_person
                            and a.tag_id = any (v_ids)) into v_res;
    end if;
  when 'eligibility' then
    select marketing_contact_eligibility(p_tenant, p_person, p_node ->> 'channel')
           = p_node ->> 'value' into v_res;
  else
    raise exception 'unknown segment field at evaluation' using errcode = '22023';
  end case;
  return coalesce(v_res, false);
end $$;

create or replace function marketing_segment_mutate(
  p_tenant uuid, p_actor uuid, p_op text, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_actor_tenant uuid;
  v_actor_label text;
  v_seg marketing_segments%rowtype;
  v_id uuid;
  v_expected int;
  v_expected_at timestamptz;
  v_name text;
  v_desc text;
  v_def jsonb;
begin
  if p_tenant is null or p_actor is null then
    raise exception 'tenant and actor required' using errcode = '22023';
  end if;
  select tenant_id into v_actor_tenant from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  -- AUTHORITATIVE permission check at the mutation boundary (canonical
  -- resolver) — a viewer can never mutate segments, hostile grant rows or not.
  if not ((marketing_effective_permissions(p_actor) -> 'permissions')
          ? 'marketing.tags.manage') then
    raise exception 'actor lacks marketing.tags.manage' using errcode = '42501';
  end if;
  v_actor_label := coalesce((select email from profiles where id = p_actor), p_actor::text);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;

  if p_op = 'create' then
    v_name := nullif(trim(coalesce(p_args ->> 'name', '')), '');
    v_desc := nullif(trim(coalesce(p_args ->> 'description', '')), '');
    v_def := p_args -> 'definition';
    if v_name is null or length(v_name) > 80
       or (v_desc is not null and length(v_desc) > 300) then
      raise exception 'segment name required (max 80); description max 300'
        using errcode = '22023';
    end if;
    perform marketing_segment_validate(p_tenant, v_def);
    insert into marketing_segments
      (tenant_id, name, description, definition, definition_version, created_by, updated_by)
    values (p_tenant, v_name, v_desc, v_def, 1, p_actor, p_actor)
    returning * into v_seg;
    insert into marketing_segment_versions
      (tenant_id, segment_id, version, name, definition, created_by)
    values (p_tenant, v_seg.id, 1, v_name, v_def, p_actor);

  elsif p_op in ('archive', 'reactivate') then
    -- status changes participate in optimistic concurrency through the
    -- OBSERVABLE record token (updated_at — bumped by every mutation); exact
    -- repeats are rejected before any write/audit/event.
    begin
      v_id := (p_args ->> 'segment_id')::uuid;
      v_expected_at := (p_args ->> 'expected_updated_at')::timestamptz;
    exception when others then
      raise exception 'invalid segment_id or expected_updated_at' using errcode = '22023';
    end;
    if v_id is null or v_expected_at is null then
      raise exception 'segment_id and expected_updated_at required' using errcode = '22023';
    end if;
    select * into v_seg from marketing_segments
     where id = v_id and tenant_id = p_tenant for update;
    if not found then
      raise exception 'segment not found for tenant' using errcode = 'P0002';
    end if;
    if v_seg.updated_at is distinct from v_expected_at then
      raise exception 'segment was changed elsewhere' using errcode = 'MK409';
    end if;
    if p_op = 'archive' then
      if v_seg.status = 'archived' then
        raise exception 'segment is already archived' using errcode = '22023';
      end if;
      update marketing_segments set status = 'archived', updated_by = p_actor
       where id = v_id returning * into v_seg;
    else
      if v_seg.status = 'active' then
        raise exception 'segment is already active' using errcode = '22023';
      end if;
      update marketing_segments set status = 'active', updated_by = p_actor
       where id = v_id returning * into v_seg;
    end if;

  elsif p_op = 'update' then
    begin
      v_id := (p_args ->> 'segment_id')::uuid;
      v_expected := (p_args ->> 'expected_version')::int;
    exception when others then
      raise exception 'invalid segment_id or expected_version' using errcode = '22023';
    end;
    if v_id is null or v_expected is null then
      raise exception 'segment_id and expected_version required' using errcode = '22023';
    end if;
    select * into v_seg from marketing_segments
     where id = v_id and tenant_id = p_tenant for update;
    if not found then
      raise exception 'segment not found for tenant' using errcode = 'P0002';
    end if;
    if v_seg.definition_version <> v_expected then
      raise exception 'segment was changed elsewhere (expected %, found %)',
        v_expected, v_seg.definition_version using errcode = 'MK409';
    end if;

    v_name := coalesce(nullif(trim(coalesce(p_args ->> 'name', '')), ''), v_seg.name);
    v_desc := case when p_args ? 'description'
      then nullif(trim(coalesce(p_args ->> 'description', '')), '')
      else v_seg.description end;
    if length(v_name) > 80 or (v_desc is not null and length(v_desc) > 300) then
      raise exception 'segment name max 80; description max 300' using errcode = '22023';
    end if;
    v_def := coalesce(p_args -> 'definition', v_seg.definition);
    perform marketing_segment_validate(p_tenant, v_def);
    -- an EXACT repeat (identical name, description and definition) must not
    -- mint a misleading new version/audit/event
    if v_name = v_seg.name and v_desc is not distinct from v_seg.description
       and v_def = v_seg.definition then
      raise exception 'update is a no-op' using errcode = '22023';
    end if;
    -- IMMUTABLE VERSION RECORD for every accepted definition change
    update marketing_segments set
      name = v_name, description = v_desc, definition = v_def,
      definition_version = definition_version + 1,
      estimated_count = null, evaluated_at = null,
      updated_by = p_actor
    where id = v_id returning * into v_seg;
    insert into marketing_segment_versions
      (tenant_id, segment_id, version, name, definition, created_by)
    values (p_tenant, v_seg.id, v_seg.definition_version, v_name, v_def, p_actor);
  else
    raise exception 'unknown segment op %', p_op using errcode = '22023';
  end if;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_actor_label, 'marketing.segment.' || p_op, 'marketing_segment',
          v_seg.id::text, 'ok',
          jsonb_build_object('name', v_seg.name, 'version', v_seg.definition_version,
                             'status', v_seg.status));
  perform marketing_event_append(p_tenant, 'marketing.segment.changed', 'marketing_segment',
    v_seg.id, 'marketing-segments',
    jsonb_build_object('k', p_op || ':v' || v_seg.definition_version
                            || ':' || clock_timestamp()::text,
                       'op', p_op, 'version', v_seg.definition_version,
                       'actor', v_actor_label, 'at', now()));
  return jsonb_build_object('id', v_seg.id, 'name', v_seg.name,
    'description', v_seg.description, 'definition', v_seg.definition,
    'definition_version', v_seg.definition_version, 'status', v_seg.status,
    'estimated_count', v_seg.estimated_count, 'evaluated_at', v_seg.evaluated_at,
    'updated_at', v_seg.updated_at);
end $$;

-- Evaluate a SAVED segment (stores count + timestamp) or an AD-HOC definition
-- (validated identically, evaluated, never stored). Fully server-side; bounded
-- STRICT-typed keyset page with next_cursor.
--   VERSION CAPTURE: the definition version in force is captured at read and
--   returned; the count is stored ONLY if the segment still holds that exact
--   version at store time — a definition changed mid-evaluation leaves the
--   stored count untouched (stored=false). An optional expected_version lets a
--   caller pin the version it believes it is evaluating (mismatch → MK409).
--   Actor and permission are validated HERE (the authoritative boundary).
create or replace function marketing_segment_evaluate(
  p_tenant uuid, p_actor uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_actor_tenant uuid;
  v_seg marketing_segments%rowtype;
  v_def jsonb;
  v_id uuid;
  v_version int;
  v_expected int;
  v_limit int;
  v_cur jsonb;
  v_cur_name text;
  v_cur_id uuid;
  v_include_all boolean;
  v_count int;
  v_rows jsonb;
  v_next jsonb;
  v_stored boolean := false;
begin
  if p_tenant is null or p_actor is null then
    raise exception 'tenant and actor required' using errcode = '22023';
  end if;
  select tenant_id into v_actor_tenant from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  if not ((marketing_effective_permissions(p_actor) -> 'permissions')
          ? 'marketing.tags.manage') then
    raise exception 'actor lacks marketing.tags.manage' using errcode = '42501';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  begin
    v_id := (p_args ->> 'segment_id')::uuid;
    v_limit := least(greatest(coalesce((p_args ->> 'limit')::int, 25), 1), 50);
    v_expected := (p_args ->> 'expected_version')::int;
  exception when others then
    raise exception 'invalid evaluate args' using errcode = '22023';
  end;
  -- STRICT typed cursor: exactly {v: string, id: uuid-string} or absent
  if p_args ? 'cursor' and jsonb_typeof(p_args -> 'cursor') <> 'null' then
    v_cur := p_args -> 'cursor';
    if jsonb_typeof(v_cur) <> 'object'
       or jsonb_typeof(v_cur -> 'v') <> 'string'
       or jsonb_typeof(v_cur -> 'id') <> 'string'
       or (select count(*) from jsonb_object_keys(v_cur)) <> 2 then
      raise exception 'invalid cursor' using errcode = '22023';
    end if;
    begin
      v_cur_id := (v_cur ->> 'id')::uuid;
    exception when others then
      raise exception 'invalid cursor' using errcode = '22023';
    end;
    v_cur_name := v_cur ->> 'v';
  end if;
  if v_id is not null then
    select * into v_seg from marketing_segments
     where id = v_id and tenant_id = p_tenant;
    if not found then
      raise exception 'segment not found for tenant' using errcode = 'P0002';
    end if;
    v_def := v_seg.definition;
    v_version := v_seg.definition_version;
    if v_expected is not null and v_expected <> v_version then
      raise exception 'segment was changed elsewhere (expected %, found %)',
        v_expected, v_version using errcode = 'MK409';
    end if;
  elsif p_args ? 'definition' then
    if v_expected is not null then
      raise exception 'expected_version applies to saved segments only'
        using errcode = '22023';
    end if;
    v_def := p_args -> 'definition';
  else
    raise exception 'segment_id or definition required' using errcode = '22023';
  end if;
  -- identical limits for stored and ad-hoc definitions — one validator
  perform marketing_segment_validate(p_tenant, v_def);

  select coalesce(ms.include_all_discovered, true) into v_include_all
    from marketing_settings ms where ms.tenant_id = p_tenant;
  if not found then v_include_all := true; end if;

  select count(*) into v_count
    from people p
   where p.tenant_id = p_tenant
     and (v_include_all or exists (
            select 1 from contact_relationships ce
             where ce.tenant_id = p_tenant and ce.person_id = p.id
               and ce.status = 'active'))
     and marketing_segment_match_person(p_tenant, p.id, v_def);

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows from (
    select p.id as person_id, p.display_name, p.primary_email, p.primary_phone,
           p.created_at
      from people p
     where p.tenant_id = p_tenant
       and (v_include_all or exists (
              select 1 from contact_relationships ce
               where ce.tenant_id = p_tenant and ce.person_id = p.id
                 and ce.status = 'active'))
       and (v_cur_id is null
            or (coalesce(p.display_name, ''), p.id) > (coalesce(v_cur_name, ''), v_cur_id))
       and marketing_segment_match_person(p_tenant, p.id, v_def)
     order by coalesce(p.display_name, ''), p.id
     limit v_limit
  ) t;
  if jsonb_array_length(v_rows) = v_limit then
    v_next := jsonb_build_object(
      'v', coalesce(v_rows -> (v_limit - 1) ->> 'display_name', ''),
      'id', v_rows -> (v_limit - 1) ->> 'person_id');
  end if;

  if v_id is not null then
    -- store ONLY against the captured version: a concurrent definition change
    -- makes this a no-op and the stored count stays untouched
    update marketing_segments
       set estimated_count = v_count, evaluated_at = now()
     where id = v_id and definition_version = v_version;
    v_stored := found;
  end if;

  return jsonb_build_object('count', v_count, 'items', v_rows,
    'next_cursor', v_next,
    'evaluated_at', case when v_stored then now() else null end,
    'segment_version', v_version, 'stored', v_stored);
end $$;

-- ===========================================================================
-- CONTACT IMPORTS — canonical, preview-first, per-row atomic + idempotent.
-- ===========================================================================
-- Platform contact profile (data, not code) — platform unique index exists
-- on (source_system, entity_type, name) where tenant_id is null.
insert into import_profiles (tenant_id, source_system, entity_type, name, definition)
values
(null, 'generic', 'contacts', 'Generic Contacts CSV', jsonb_build_object(
  'columns', jsonb_build_array(
    jsonb_build_object('canonical','external_id','aliases',jsonb_build_array('id','contact id','ref','reference','record id'),'type','text'),
    jsonb_build_object('canonical','display_name','aliases',jsonb_build_array('name','full name','contact','contact name'),'type','text'),
    jsonb_build_object('canonical','first_name','aliases',jsonb_build_array('first name','forename','given name'),'type','text'),
    jsonb_build_object('canonical','last_name','aliases',jsonb_build_array('surname','last name','family name'),'type','text'),
    jsonb_build_object('canonical','company_name','aliases',jsonb_build_array('company','company name','organisation','organization','account'),'type','text'),
    jsonb_build_object('canonical','primary_email','aliases',jsonb_build_array('email','e-mail','email address','work email'),'type','email'),
    jsonb_build_object('canonical','secondary_email','aliases',jsonb_build_array('secondary email','other email','personal email'),'type','email'),
    jsonb_build_object('canonical','primary_phone','aliases',jsonb_build_array('phone','telephone','mobile','tel','phone number'),'type','phone'),
    jsonb_build_object('canonical','secondary_phone','aliases',jsonb_build_array('secondary phone','other phone','landline','home phone'),'type','phone'),
    jsonb_build_object('canonical','relationship_type','aliases',jsonb_build_array('relationship','relationship type','contact type'),'type','text'),
    jsonb_build_object('canonical','lifecycle_stage','aliases',jsonb_build_array('lifecycle','stage','lifecycle stage','pipeline stage'),'type','text'),
    jsonb_build_object('canonical','owner_email','aliases',jsonb_build_array('owner','owner email','assigned to'),'type','email'),
    jsonb_build_object('canonical','source_ref','aliases',jsonb_build_array('source','source ref','origin','lead source'),'type','text'),
    jsonb_build_object('canonical','address_text','aliases',jsonb_build_array('address','street address','billing address'),'type','text'),
    jsonb_build_object('canonical','postcode','aliases',jsonb_build_array('post code','postcode','zip','zip code'),'type','postcode')
  )))
on conflict do nothing;

-- ===========================================================================
-- marketing_import_row_results — a DURABLE outcome for EVERY source row of a
-- contacts import (created / updated / conflict / invalid are TERMINAL
-- reviewed outcomes; failed is RETRYABLE). This is the state-machine ledger:
-- final aggregate counts and completion are computed from these rows — never
-- from a single process invocation — so a partial retry can never lose
-- previously recorded counts. `import_row_provenance` (which requires an
-- entity id) remains the mutation-lineage record; this table carries the
-- source-neutral per-row result including rows that produced NO entity.
-- Bounded, PII-light: reason + field names only, never raw row values.
-- Service-role only (downloads go through the permission-gated Edge action).
-- ===========================================================================
-- Composite keys on the referenced parents so every reference below is
-- STRUCTURALLY tenant-bound (a cross-tenant import/conflict/person id is
-- impossible even under a service-role mistake).
create unique index data_imports_tenant_id_uk
  on data_imports (tenant_id, id);
create unique index marketing_identity_conflicts_tenant_id_uk
  on marketing_identity_conflicts (tenant_id, id);
create unique index people_tenant_id_uk
  on people (tenant_id, id);
create table marketing_import_row_results (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  import_id   uuid not null,
  row_number  int not null check (row_number > 0),
  outcome     text not null check (outcome in
                ('created', 'updated', 'conflict', 'invalid', 'failed')),
  reason      text,
  fields      text[] not null default '{}',
  entity_id   uuid,
  conflict_id uuid,
  attempt     int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, import_id, row_number),
  -- (tenant_id, import_id) must name THIS tenant's import
  constraint mirr_import_fk foreign key (tenant_id, import_id)
    references data_imports (tenant_id, id) on delete cascade,
  -- conflict evidence, when present, must belong to the same tenant
  constraint mirr_conflict_fk foreign key (tenant_id, conflict_id)
    references marketing_identity_conflicts (tenant_id, id)
    on delete set null (conflict_id),
  -- the resulting entity, when present, must be a Person of the same tenant
  constraint mirr_entity_fk foreign key (tenant_id, entity_id)
    references people (tenant_id, id) on delete set null (entity_id)
);
create index marketing_import_row_results_idx
  on marketing_import_row_results (tenant_id, import_id, outcome);
create trigger marketing_import_row_results_set_updated_at
  before update on marketing_import_row_results
  for each row execute function set_updated_at();
create trigger marketing_import_row_results_tenant_guard
  before insert or update on marketing_import_row_results
  for each row execute function marketing_tenant_guard();
-- STRUCTURAL transition guard. Honest guarantee: a trigger cannot identify
-- its caller — it cannot distinguish a governed RPC from a direct
-- service-role UPDATE. What it CAN do is constrain the SHAPE of every update,
-- whoever issues it:
--   * identity + lineage (id, tenant_id, import_id, row_number, created_at)
--     are immutable on EVERY update — a row can never be moved to another
--     tenant/import/row or have its identity or creation time rewritten;
--   * a retryable 'failed' row may transition only to an allowed ledger
--     outcome (the table CHECK bounds the vocabulary) with the attempt
--     counter advancing by EXACTLY one, and only the outcome columns
--     (outcome, reason, fields, entity_id, conflict_id — plus the trigger-
--     maintained updated_at) may change;
--   * terminal rows (created/updated/conflict/invalid) are immutable;
--   * the ONLY other legal shape is a genuine FK-driven set-null of exactly
--     one existing entity/conflict reference with every business and lineage
--     column identical (parent-delete cascades must still work).
-- Tenant/import cascade cleanup is a DELETE (cascade), which this
-- before-UPDATE trigger never blocks.
create or replace function marketing_import_row_results_guard()
returns trigger language plpgsql as $$
begin
  -- identity + lineage are pinned on EVERY update, failed or terminal
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.import_id is distinct from old.import_id
     or new.row_number is distinct from old.row_number
     or new.created_at is distinct from old.created_at then
    raise exception 'import row result identity/lineage is immutable (id, tenant, import, row, created_at)';
  end if;
  -- genuine FK-driven set-null: EXACTLY one existing reference nulled with
  -- every other business column identical (legal for failed and terminal
  -- rows alike — it can never smuggle an outcome or attempt change)
  if new.outcome = old.outcome
     and new.reason is not distinct from old.reason
     and new.fields = old.fields
     and new.attempt = old.attempt
     and ((new.entity_id is null and old.entity_id is not null
           and new.conflict_id is not distinct from old.conflict_id)
       or (new.conflict_id is null and old.conflict_id is not null
           and new.entity_id is not distinct from old.entity_id)) then
    return new;
  end if;
  if old.outcome = 'failed' then
    -- the governed retryable transition failed → failed|terminal: outcome
    -- stays inside the table-CHECK vocabulary and the attempt counter must
    -- advance by exactly one (a retry that does not count itself is rejected)
    if new.attempt is distinct from old.attempt + 1 then
      raise exception 'a failed-row retry must increment attempt by exactly one';
    end if;
    return new;
  end if;
  raise exception 'terminal import row outcomes are immutable (only failed rows may transition)';
end $$;
create trigger marketing_import_row_results_transition_guard
  before update on marketing_import_row_results
  for each row execute function marketing_import_row_results_guard();
alter table marketing_import_row_results enable row level security;  -- deny-all for clients
grant select, insert, update on marketing_import_row_results to service_role;
-- deterministic in every environment: no client role can delete/truncate
-- (tenant/import cascade cleanup runs as the owner and still works)
revoke delete, truncate on marketing_import_row_results
  from anon, authenticated, service_role;

-- ===========================================================================
-- Shared row-field validation: PREVIEW and APPLY make the SAME decision. A
-- row-supplied lifecycle stage or relationship type that does not resolve is
-- an HONEST invalid outcome — never silently replaced with a default.
-- Contract breaches (unknown keys, non-string values) raise 22023; honest
-- per-row invalidity returns {reason, fields}. NULL = the row is valid.
-- ===========================================================================
create or replace function marketing_import_resolve_stage(p_tenant uuid, p_value text)
returns text  -- resolved ACTIVE tenant stage_key, or null
language sql
stable
as $$
  select s.stage_key from marketing_lifecycle_stages s
   where s.tenant_id = p_tenant and s.active
     and (s.stage_key = trim(p_value) or lower(s.label) = lower(trim(p_value)))
   order by (s.stage_key = trim(p_value)) desc, s.sort_order, s.id
   limit 1;
$$;

create or replace function marketing_import_validate_contact_row(p_tenant uuid, p_record jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_key text;
  v_display text;
  v_fields text[] := array[]::text[];
  v_reason text;
  v_val text;
begin
  if p_tenant is null or p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'record must be an object' using errcode = '22023';
  end if;
  -- STRICT bounded shape: only the canonical contact columns, string values
  for v_key in select jsonb_object_keys(p_record) loop
    if v_key not in ('external_id','display_name','first_name','last_name',
                     'company_name','primary_email','secondary_email',
                     'primary_phone','secondary_phone','relationship_type',
                     'lifecycle_stage','owner_email','source_ref',
                     'address_text','postcode') then
      raise exception 'unknown record key %', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(p_record -> v_key) <> 'string' then
      raise exception 'record value % must be a string', v_key using errcode = '22023';
    end if;
    if length(p_record ->> v_key) > 500 then
      raise exception 'record value % too long', v_key using errcode = '22023';
    end if;
  end loop;

  v_display := nullif(trim(coalesce(p_record ->> 'display_name', '')), '');
  if v_display is null then
    v_display := nullif(trim(concat_ws(' ',
      nullif(trim(coalesce(p_record ->> 'first_name', '')), ''),
      nullif(trim(coalesce(p_record ->> 'last_name', '')), ''))), '');
  end if;
  if v_display is null
     and marketing_normalize_endpoint('email', p_record ->> 'primary_email') is null
     and marketing_normalize_endpoint('phone', p_record ->> 'primary_phone') is null
     and nullif(trim(coalesce(p_record ->> 'external_id', '')), '') is null then
    return jsonb_build_object('reason', 'row has no name and no usable identifier',
                              'fields', '[]'::jsonb);
  end if;

  v_val := nullif(trim(coalesce(p_record ->> 'relationship_type', '')), '');
  if v_val is not null and lower(v_val) not in
     ('lead','prospect','customer','former_customer','supplier','partner','commercial','other') then
    v_fields := array_append(v_fields, 'relationship_type');
    v_reason := 'unknown relationship type';
  end if;
  v_val := nullif(trim(coalesce(p_record ->> 'lifecycle_stage', '')), '');
  if v_val is not null and marketing_import_resolve_stage(p_tenant, v_val) is null then
    v_fields := array_append(v_fields, 'lifecycle_stage');
    v_reason := coalesce(v_reason || '; ', '') || 'unknown lifecycle stage';
  end if;
  if array_length(v_fields, 1) is not null then
    return jsonb_build_object('reason', v_reason, 'fields', to_jsonb(v_fields));
  end if;
  return null;
end $$;

-- ===========================================================================
-- EVIDENCE-CONVERGED identity resolution (the hardened Phase-2 create contract
-- applied to imports). Every supplied strong identifier — source+external id,
-- primary AND secondary email, primary AND secondary phone — is resolved
-- INDEPENDENTLY into a tenant-joined candidate set. Contact points explicitly
-- marked invalid are ignored, and a scalar match whose matching endpoint is
-- marked invalid is not usable evidence. An automatic match happens ONLY when
-- every identifier with candidates agrees on exactly one Person; one ambiguous
-- identifier, or two identifiers naming different People, is a conflict.
-- Name-only evidence NEVER matches. Evidence entries carry their own correct
-- channel/label/value (never mislabelled) with bounded, deterministic,
-- tenant-joined candidate arrays.
-- ===========================================================================
create or replace function marketing_import_resolve_contact(
  p_tenant uuid, p_record jsonb, p_source text
) returns jsonb
language plpgsql
stable
as $$
declare
  v_ext text := nullif(trim(coalesce(p_record ->> 'external_id', '')), '');
  v_display text;
  v_vals text[];
  v_channels text[];
  v_labels text[];
  v_ids uuid[];
  v_i int;
  v_evidence jsonb := '[]'::jsonb;
  v_ambiguous boolean := false;
  v_matched uuid[] := array[]::uuid[];   -- distinct single-candidate persons
  v_matched_channels text[] := array[]::text[];
  v_union uuid[] := array[]::uuid[];
  v_supplied int := 0;
  v_person uuid;
  v_strategy text;
  v_confidence numeric;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;

  -- external id (provenance lineage in the SAME source namespace)
  if v_ext is not null and p_source is not null then
    v_supplied := v_supplied + 1;
    select array_agg(x.pid order by x.pid) into v_ids from (
      select distinct pr.entity_id as pid
        from import_row_provenance pr
        join people pp on pp.id = pr.entity_id and pp.tenant_id = p_tenant
       where pr.tenant_id = p_tenant and pr.entity_table = 'people'
         and pr.source_system = p_source and pr.external_id = v_ext) x;
    v_evidence := v_evidence || jsonb_build_array(jsonb_build_object(
      'channel', 'external_id', 'label', 'external_id', 'value', v_ext,
      'candidate_person_ids', to_jsonb(coalesce(v_ids[1:25], '{}'::uuid[])),
      'truncated', coalesce(array_length(v_ids, 1), 0) > 25));
    if coalesce(array_length(v_ids, 1), 0) > 1 then
      v_ambiguous := true;
      v_union := v_union || v_ids[1:25];
    elsif coalesce(array_length(v_ids, 1), 0) = 1 then
      if not (v_ids[1] = any (v_matched)) then
        v_matched := array_append(v_matched, v_ids[1]);
      end if;
      v_matched_channels := array_append(v_matched_channels, 'external_id');
      v_union := v_union || v_ids;
    end if;
  end if;

  -- endpoint identifiers: each resolved independently; invalid endpoints are
  -- never usable evidence (neither as contact points nor behind a scalar)
  v_channels := array['email', 'email', 'phone', 'phone'];
  v_labels := array['primary_email', 'secondary_email', 'primary_phone', 'secondary_phone'];
  v_vals := array[
    marketing_normalize_endpoint('email', p_record ->> 'primary_email'),
    marketing_normalize_endpoint('email', p_record ->> 'secondary_email'),
    marketing_normalize_endpoint('phone', p_record ->> 'primary_phone'),
    marketing_normalize_endpoint('phone', p_record ->> 'secondary_phone')];
  for v_i in 1..4 loop
    continue when v_vals[v_i] is null;
    v_supplied := v_supplied + 1;
    select array_agg(x.pid order by x.pid) into v_ids from (
      select pp.id as pid from people pp
       where pp.tenant_id = p_tenant
         and marketing_normalize_endpoint(v_channels[v_i],
               case when v_channels[v_i] = 'email' then pp.primary_email
                    else pp.primary_phone end) = v_vals[v_i]
         and not exists (select 1 from contact_points cpx
                          where cpx.tenant_id = p_tenant and cpx.person_id = pp.id
                            and cpx.channel = v_channels[v_i]
                            and cpx.normalized_value = v_vals[v_i]
                            and cpx.verification_state = 'invalid')
      union
      select cp.person_id from contact_points cp
        join people pj on pj.id = cp.person_id and pj.tenant_id = p_tenant
       where cp.tenant_id = p_tenant and cp.channel = v_channels[v_i]
         and cp.normalized_value = v_vals[v_i]
         and cp.verification_state <> 'invalid') x;
    v_evidence := v_evidence || jsonb_build_array(jsonb_build_object(
      'channel', v_channels[v_i], 'label', v_labels[v_i], 'value', v_vals[v_i],
      'candidate_person_ids', to_jsonb(coalesce(v_ids[1:25], '{}'::uuid[])),
      'truncated', coalesce(array_length(v_ids, 1), 0) > 25));
    if coalesce(array_length(v_ids, 1), 0) > 1 then
      v_ambiguous := true;
      v_union := v_union || v_ids[1:25];
    elsif coalesce(array_length(v_ids, 1), 0) = 1 then
      if not (v_ids[1] = any (v_matched)) then
        v_matched := array_append(v_matched, v_ids[1]);
      end if;
      v_matched_channels := array_append(v_matched_channels, v_labels[v_i]);
      v_union := v_union || v_ids;
    end if;
  end loop;

  -- deterministic bounded union for conflict records
  select array_agg(u order by u) into v_union
    from (select distinct unnest(v_union) as u) s;

  if v_ambiguous or coalesce(array_length(v_matched, 1), 0) > 1 then
    return jsonb_build_object(
      'decision', case when coalesce(array_length(v_matched, 1), 0) > 1
                       then 'conflicting' else 'ambiguous' end,
      'evidence', v_evidence,
      'candidate_union', to_jsonb(coalesce(v_union[1:25], '{}'::uuid[])),
      'truncated', coalesce(array_length(v_union, 1), 0) > 25,
      'supplied_identifiers', v_supplied);
  end if;
  if coalesce(array_length(v_matched, 1), 0) = 1 then
    v_person := v_matched[1];
    if 'external_id' = any (v_matched_channels) then
      v_strategy := 'external_id'; v_confidence := 1.0;
    elsif exists (select 1 from unnest(v_matched_channels) c
                   where c in ('primary_email', 'secondary_email')) then
      v_strategy := 'email'; v_confidence := 0.95;
    else
      v_strategy := 'phone'; v_confidence := 0.92;
    end if;
    return jsonb_build_object('decision', 'matched', 'person_id', v_person,
      'strategy', v_strategy, 'confidence', v_confidence,
      'matched_on', to_jsonb(v_matched_channels),
      'evidence', v_evidence, 'supplied_identifiers', v_supplied);
  end if;
  -- NAME-ONLY rows: a name alone NEVER auto-merges — but when the normalised
  -- name collides with existing tenant People, the row is routed to bounded
  -- identity review (a conflict) with ZERO automatic merge. Only a row with
  -- genuinely no candidate evidence creates a new Person.
  if v_supplied = 0 then
    v_display := nullif(trim(coalesce(p_record ->> 'display_name', '')), '');
    if v_display is null then
      v_display := nullif(trim(concat_ws(' ',
        nullif(trim(coalesce(p_record ->> 'first_name', '')), ''),
        nullif(trim(coalesce(p_record ->> 'last_name', '')), ''))), '');
    end if;
    if v_display is not null then
      select array_agg(x.pid order by x.pid) into v_ids from (
        select pp.id as pid from people pp
         where pp.tenant_id = p_tenant
           and lower(trim(pp.display_name)) = lower(v_display)
         order by pp.id limit 26) x;
      if coalesce(array_length(v_ids, 1), 0) > 0 then
        v_evidence := v_evidence || jsonb_build_array(jsonb_build_object(
          'channel', 'name', 'label', 'display_name', 'value', v_display,
          'candidate_person_ids', to_jsonb(v_ids[1:25]),
          'truncated', coalesce(array_length(v_ids, 1), 0) > 25));
        return jsonb_build_object('decision', 'name_collision',
          'evidence', v_evidence,
          'candidate_union', to_jsonb(v_ids[1:25]),
          'truncated', coalesce(array_length(v_ids, 1), 0) > 25,
          'supplied_identifiers', 0);
      end if;
    end if;
  end if;
  -- no candidate evidence anywhere: a new Person is the safe outcome
  return jsonb_build_object('decision', 'new', 'strategy', 'new', 'confidence', 1.0,
    'evidence', v_evidence, 'supplied_identifiers', v_supplied);
end $$;

-- Read-only preview matcher: the SAME validation + convergence decision the
-- apply path uses — action + strategy + candidate COUNT only (no ids leave the
-- database for a preview row).
create or replace function marketing_import_match_contact(p_tenant uuid, p_record jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_source text := nullif(trim(coalesce(p_record ->> '__source', '')), '');
  v_invalid jsonb;
  v_res jsonb;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  v_invalid := marketing_import_validate_contact_row(p_tenant, p_record - '__source');
  if v_invalid is not null then
    return jsonb_build_object('action', 'invalid', 'strategy', 'invalid',
                              'confidence', 0,
                              'reason', v_invalid ->> 'reason', 'candidates', 0);
  end if;
  v_res := marketing_import_resolve_contact(p_tenant, p_record - '__source', v_source);
  if v_res ->> 'decision' = 'matched' then
    return jsonb_build_object('action', 'matched',
      'strategy', v_res ->> 'strategy', 'confidence', (v_res ->> 'confidence')::numeric,
      'candidates', 1);
  elsif v_res ->> 'decision' in ('ambiguous', 'conflicting', 'name_collision') then
    return jsonb_build_object('action', 'probable', 'strategy', v_res ->> 'decision',
      'confidence', 0.5,
      'candidates', jsonb_array_length(v_res -> 'candidate_union'));
  end if;
  return jsonb_build_object('action', 'new', 'strategy', 'new',
                            'confidence', 1.0, 'candidates', 0);
end $$;

-- Atomic per-row apply. IDEMPOTENT per (import, row): a TERMINAL durable
-- outcome (created/updated/conflict/invalid) is never re-applied; a FAILED
-- outcome is retryable and reprocesses ONLY that row. STRUCTURALLY VALIDATED:
-- the import must be this tenant's contacts import in a legal status, the row
-- number must belong to the sealed file, the options must EXACTLY match the
-- sealed preview contract, and the actor must be a real same-tenant profile
-- holding effective marketing.contacts.import. Identity uses the
-- evidence-converged resolver above (name-only NEVER merges; any ambiguity or
-- identifier disagreement is ONE actionable conflict with correct per-
-- identifier evidence and ZERO canonical mutations).
create or replace function marketing_import_contact_row(
  p_tenant uuid, p_import uuid, p_actor uuid, p_row_number int,
  p_record jsonb, p_options jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_imp data_imports%rowtype;
  v_sealed jsonb;
  v_email text := marketing_normalize_endpoint('email', p_record ->> 'primary_email');
  v_phone text := marketing_normalize_endpoint('phone', p_record ->> 'primary_phone');
  v_email2 text := marketing_normalize_endpoint('email', p_record ->> 'secondary_email');
  v_phone2 text := marketing_normalize_endpoint('phone', p_record ->> 'secondary_phone');
  v_ext text := nullif(trim(coalesce(p_record ->> 'external_id', '')), '');
  v_source text := nullif(trim(coalesce(p_options ->> 'source', '')), '');
  v_actor_tenant uuid;
  v_display text;
  v_invalid jsonb;
  v_res jsonb;
  v_person uuid;
  v_p people%rowtype;
  v_company uuid;
  v_company_name text;
  v_company_n int;
  v_lock_keys text[] := array[]::text[];
  v_lk text;
  v_strategy text := 'new';
  v_confidence numeric := 1.0;
  v_conflicts text[] := array[]::text[];
  v_conflict_id uuid;
  v_prior marketing_import_row_results%rowtype;
  v_prov import_row_provenance%rowtype;
  v_attempt int := 1;
  v_tag uuid;
  v_owner uuid;
  v_rel_type text;
  v_stage text;
  v_writable jsonb := '{}'::jsonb;
  v_k text;
  v_action text;
begin
  -- ── structural validation ──
  if p_tenant is null or p_import is null or p_actor is null or p_row_number is null then
    raise exception 'tenant, import, actor and row number required' using errcode = '22023';
  end if;
  if p_record is null or jsonb_typeof(p_record) <> 'object'
     or p_options is null or jsonb_typeof(p_options) <> 'object' then
    raise exception 'record and options must be objects' using errcode = '22023';
  end if;
  select tenant_id into v_actor_tenant from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  if not ((marketing_effective_permissions(p_actor) -> 'permissions')
          ? 'marketing.contacts.import') then
    raise exception 'actor lacks marketing.contacts.import' using errcode = '42501';
  end if;
  select * into v_imp from data_imports
   where id = p_import and tenant_id = p_tenant;
  if not found then
    raise exception 'import not found for tenant' using errcode = 'P0002';
  end if;
  if v_imp.entity_type <> 'contacts' then
    raise exception 'import is not a contacts import' using errcode = '22023';
  end if;
  if v_imp.status not in ('previewed', 'importing', 'failed') then
    raise exception 'import status % does not allow row apply', v_imp.status
      using errcode = '22023';
  end if;
  if p_row_number < 2 or p_row_number > v_imp.row_count + 1 then
    raise exception 'row number is outside the sealed import' using errcode = '22023';
  end if;
  -- options must EXACTLY match the sealed preview contract
  v_sealed := v_imp.preview -> 'sealed';
  if v_sealed is null or jsonb_typeof(v_sealed) is distinct from 'object'
     or jsonb_typeof(v_sealed -> 'contact_options') is distinct from 'object' then
    raise exception 'import has no sealed contract — a new preview is required'
      using errcode = '22023';
  end if;
  if p_options is distinct from v_sealed -> 'contact_options' then
    raise exception 'options do not match the sealed import contract'
      using errcode = '22023';
  end if;
  if v_source is null or v_source !~ '^[a-z0-9_-]{2,40}$' then
    raise exception 'import source required' using errcode = '22023';
  end if;
  -- SEALED DEFAULTS ARE MANDATORY AND MUST STILL BE HONOURABLE. Preview
  -- resolves the EFFECTIVE lifecycle stage and relationship type (even when
  -- the operator left "Default" selected) and seals them explicitly — this
  -- RPC never falls back to live marketing_settings, so changing tenant
  -- defaults after preview can never alter what apply does. A sealed
  -- reference that can no longer be honoured (retired stage, deactivated
  -- tag) requires a NEW preview.
  if not (p_options ? 'lifecycle_stage_key') or not (p_options ? 'relationship_type') then
    raise exception 'sealed defaults missing — a new preview is required'
      using errcode = '22023';
  end if;
  if not exists (
       select 1 from marketing_lifecycle_stages s
        where s.tenant_id = p_tenant and s.active
          and s.stage_key = p_options ->> 'lifecycle_stage_key') then
    raise exception 'sealed lifecycle stage is no longer an active tenant stage — a new preview is required'
      using errcode = '22023';
  end if;
  if (p_options ->> 'relationship_type') not in
     ('lead','prospect','customer','former_customer','supplier','partner','commercial','other') then
    raise exception 'sealed relationship type is invalid' using errcode = '22023';
  end if;
  if p_options ? 'tag_id' then
    begin
      v_tag := (p_options ->> 'tag_id')::uuid;
    exception when others then
      raise exception 'invalid sealed tag' using errcode = '22023';
    end;
    -- the sealed tag must still be an ACTIVE tag of this tenant: assigning a
    -- deactivated tag would silently resurrect retired vocabulary
    if not exists (select 1 from marketing_tags t
                    where t.id = v_tag and t.tenant_id = p_tenant and t.active) then
      raise exception 'sealed tag is no longer an active tag of this tenant — a new preview is required'
        using errcode = '22023';
    end if;
  end if;

  -- ── PER-ROW IDEMPOTENCY under a per-(import,row) advisory lock: concurrent
  -- applies of the SAME row serialise here; a TERMINAL outcome is never
  -- re-applied; a FAILED outcome is retried. ──
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|import|' || p_import::text || '|' || p_row_number, 42));
  select * into v_prior from marketing_import_row_results r
   where r.tenant_id = p_tenant and r.import_id = p_import
     and r.row_number = p_row_number;
  if found then
    if v_prior.outcome in ('created', 'updated', 'conflict', 'invalid') then
      return jsonb_build_object('action', 'already_applied',
                                'prior_outcome', v_prior.outcome);
    end if;
    v_attempt := v_prior.attempt + 1;
  end if;
  -- defence in depth: a provenance row for this (import,row) also means
  -- applied. If its durable row-result is unexpectedly absent (or stuck at
  -- 'failed'), REPAIR the ledger deterministically from provenance — never
  -- return already_applied while leaving the import permanently unprocessed.
  select pr.* into v_prov from import_row_provenance pr
   where pr.tenant_id = p_tenant and pr.import_id = p_import
     and pr.source_row_number = p_row_number
   order by pr.imported_at limit 1;
  if found then
    insert into marketing_import_row_results
      (tenant_id, import_id, row_number, outcome, reason, entity_id, conflict_id, attempt)
    values (p_tenant, p_import, p_row_number,
            case v_prov.action when 'created' then 'created'
                               when 'updated' then 'updated'
                               else 'conflict' end,
            'ledger reconstructed from provenance',
            case when v_prov.entity_table = 'people' then v_prov.entity_id end,
            case when v_prov.entity_table = 'marketing_identity_conflicts'
                 then v_prov.entity_id end,
            coalesce(v_attempt, 1))
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          entity_id = excluded.entity_id, conflict_id = excluded.conflict_id,
          -- repairing OVER a stuck 'failed' row is itself a retry: the guard
          -- requires attempt to advance by exactly one, and v_attempt already
          -- carries prior.attempt + 1 in that case
          attempt = excluded.attempt;
    return jsonb_build_object('action', 'already_applied',
      'prior_outcome', case v_prov.action when 'created' then 'created'
                                          when 'updated' then 'updated'
                                          else 'conflict' end,
      'repaired', v_prior.id is null);
  end if;

  -- ── honest row validation: SAME decision as preview; invalid is a durable
  --    reviewed outcome, never a silent default ──
  v_invalid := marketing_import_validate_contact_row(p_tenant, p_record);
  if v_invalid is not null then
    insert into marketing_import_row_results
      (tenant_id, import_id, row_number, outcome, reason, fields, attempt)
    values (p_tenant, p_import, p_row_number, 'invalid',
            v_invalid ->> 'reason',
            coalesce((select array_agg(e) from jsonb_array_elements_text(
                        v_invalid -> 'fields') e), '{}'::text[]),
            v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          fields = excluded.fields, attempt = excluded.attempt;
    return jsonb_build_object('action', 'invalid', 'reason', v_invalid ->> 'reason');
  end if;

  v_display := nullif(trim(coalesce(p_record ->> 'display_name', '')), '');
  if v_display is null then
    v_display := nullif(trim(concat_ws(' ',
      nullif(trim(coalesce(p_record ->> 'first_name', '')), ''),
      nullif(trim(coalesce(p_record ->> 'last_name', '')), ''))), '');
  end if;

  -- serialise on the same identity locks the manual-create path uses — one
  -- lock per supplied strong identifier INCLUDING the exact source namespace +
  -- external id (two concurrent rows carrying only the same external id can
  -- never both resolve as new), DETERMINISTIC (sorted) order to avoid
  -- deadlocks; name-only rows take no identity lock (the per-row lock above
  -- still serialises same-row retries).
  if v_email is not null then v_lock_keys := array_append(v_lock_keys, 'email|' || v_email); end if;
  if v_email2 is not null then v_lock_keys := array_append(v_lock_keys, 'email|' || v_email2); end if;
  if v_phone is not null then v_lock_keys := array_append(v_lock_keys, 'phone|' || v_phone); end if;
  if v_phone2 is not null then v_lock_keys := array_append(v_lock_keys, 'phone|' || v_phone2); end if;
  if v_ext is not null then
    v_lock_keys := array_append(v_lock_keys, 'ext|' || v_source || '|' || v_ext);
  end if;
  for v_lk in select distinct u from unnest(v_lock_keys) t(u) order by u loop
    perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|' || v_lk, 42));
  end loop;

  -- ── EVIDENCE-CONVERGED resolution (locked re-check) ──
  v_res := marketing_import_resolve_contact(p_tenant, p_record, v_source);

  if v_res ->> 'decision' in ('ambiguous', 'conflicting', 'name_collision') then
    -- ONE actionable conflict; NO Person/contact-point/company/relationship/
    -- tag mutation of any kind. Evidence entries keep their own correct
    -- channel/label/value; candidates are bounded, deterministic and
    -- tenant-joined (never a foreign Person id). name_collision = a name-only
    -- row whose normalised name matches existing People (bounded review, zero
    -- automatic merge — brief acceptance scenario 6).
    insert into marketing_identity_conflicts
      (tenant_id, identifiers, candidate_person_ids, truncated, requested, created_by)
    values (p_tenant,
            v_res -> 'evidence',
            coalesce((select array_agg(e::uuid)
                        from jsonb_array_elements_text(v_res -> 'candidate_union') e),
                     '{}'::uuid[]),
            coalesce((v_res ->> 'truncated')::boolean, false),
            jsonb_build_object('import_id', p_import, 'row', p_row_number,
                               'kind', v_res ->> 'decision'),
            p_actor)
    returning id into v_conflict_id;
    insert into import_row_provenance
      (tenant_id, import_id, entity_table, entity_id, source_system,
       source_row_number, external_id, imported_fields, match_strategy,
       confidence, action, conflicts)
    values (p_tenant, p_import, 'marketing_identity_conflicts', v_conflict_id,
            v_source, p_row_number, v_ext,
            (select coalesce(array_agg(k), '{}') from jsonb_object_keys(p_record) k),
            v_res ->> 'decision', 0.5, 'conflict',
            jsonb_build_array(jsonb_build_object('conflict_id', v_conflict_id)));
    insert into marketing_import_row_results
      (tenant_id, import_id, row_number, outcome, reason, conflict_id, attempt)
    values (p_tenant, p_import, p_row_number, 'conflict',
            case v_res ->> 'decision'
              when 'conflicting' then 'identifiers name different People'
              when 'name_collision'
                then 'a name-only row matches existing People — review required'
              else 'an identifier matches several People' end,
            v_conflict_id, v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          conflict_id = excluded.conflict_id, attempt = excluded.attempt;
    perform marketing_event_append(p_tenant, 'marketing.identity_conflict.created',
      'marketing_identity_conflict', v_conflict_id, 'data-import',
      jsonb_build_object('k', 'created:' || v_conflict_id,
        'reason', 'import_' || (v_res ->> 'decision') || '_match', 'at', now()));
    return jsonb_build_object('action', 'conflict', 'conflict_id', v_conflict_id);
  end if;

  if v_res ->> 'decision' = 'matched' then
    v_person := (v_res ->> 'person_id')::uuid;
    v_strategy := v_res ->> 'strategy';
    v_confidence := (v_res ->> 'confidence')::numeric;
  end if;

  -- resolve owner from owner_email ONLY when it maps to a real operational
  -- same-tenant profile (a safe best-effort mapping; otherwise no owner)
  if marketing_normalize_endpoint('email', p_record ->> 'owner_email') is not null then
    select id into v_owner from profiles
     where tenant_id = p_tenant
       and lower(email) = marketing_normalize_endpoint('email', p_record ->> 'owner_email')
       and role in ('owner', 'admin', 'ops')
     limit 1;
  end if;

  v_company_name := nullif(trim(coalesce(p_record ->> 'company_name', '')), '');

  if v_person is not null then
    -- ── matched: fill blanks only; verified/locked identity is never overwritten ──
    select * into v_p from people where id = v_person and tenant_id = p_tenant for update;
    if not found then
      -- the matched Person was deleted between resolution and this lock: a
      -- RETRYABLE transactional race, never a successful 'invalid' (which
      -- would leave the source row with NO durable outcome — finalisation
      -- would see an unprocessed row forever). Raising 40001 rolls this row
      -- back atomically; the Edge error path records the durable 'failed'
      -- outcome via marketing_import_row_outcome, and a later retry
      -- re-resolves identity from live data and completes normally.
      raise exception 'matched person vanished before lock — retry re-resolves identity'
        using errcode = '40001';
    end if;
    for v_k in select unnest(array['display_name','first_name','last_name',
                                   'primary_email','primary_phone',
                                   'address_text','postcode']) loop
      declare v_new text; v_cur text;
      begin
        v_new := case v_k
          when 'display_name' then v_display
          when 'primary_email' then p_record ->> 'primary_email'
          when 'primary_phone' then p_record ->> 'primary_phone'
          else nullif(trim(coalesce(p_record ->> v_k, '')), '') end;
        v_cur := case v_k
          when 'display_name' then v_p.display_name
          when 'first_name' then v_p.first_name
          when 'last_name' then v_p.last_name
          when 'primary_email' then v_p.primary_email
          when 'primary_phone' then v_p.primary_phone
          when 'address_text' then v_p.address_text
          else v_p.postcode end;
        if v_new is null or v_new = '' then null;
        elsif v_cur is null or v_cur = '' then
          v_writable := v_writable || jsonb_build_object(v_k, v_new);  -- fill a blank
        elsif v_cur = v_new then null;                                  -- same → no-op
        else
          v_conflicts := array_append(v_conflicts, v_k);                -- differs → conflict, never clobber
        end if;
      end;
    end loop;
    if v_writable <> '{}'::jsonb then
      update people p set
        display_name = coalesce(v_writable ->> 'display_name', p.display_name),
        first_name = coalesce(v_writable ->> 'first_name', p.first_name),
        last_name = coalesce(v_writable ->> 'last_name', p.last_name),
        primary_email = coalesce(v_writable ->> 'primary_email', p.primary_email),
        primary_phone = coalesce(v_writable ->> 'primary_phone', p.primary_phone),
        address_text = coalesce(v_writable ->> 'address_text', p.address_text),
        postcode = coalesce(v_writable ->> 'postcode', p.postcode)
      where p.id = v_person;
    end if;
    -- ── company: NEVER an orphan, NEVER a silent overwrite. If the matched
    -- Person already has a company, a DIFFERENT imported name is recorded as
    -- field-conflict evidence (no create, no relink). Only a Person with no
    -- company gets one resolved: exactly one exact-name match links; zero
    -- creates; several is ambiguous evidence (no name-only guessing). ──
    if v_company_name is not null then
      if v_p.company_id is not null then
        if not exists (select 1 from companies c
                        where c.id = v_p.company_id and c.tenant_id = p_tenant
                          and c.name = v_company_name) then
          v_conflicts := array_append(v_conflicts, 'company_name');
        end if;
      else
        select count(*), min(id::text)::uuid into v_company_n, v_company
          from companies c
         where c.tenant_id = p_tenant and c.name = v_company_name;
        if v_company_n = 0 then
          insert into companies (tenant_id, name, postcode, address_text, created_source)
          values (p_tenant, v_company_name,
                  nullif(p_record ->> 'postcode', ''), nullif(p_record ->> 'address_text', ''),
                  'import:' || v_source)
          returning id into v_company;
        elsif v_company_n > 1 then
          v_company := null;
          v_conflicts := array_append(v_conflicts, 'company_name_ambiguous');
        end if;
        if v_company is not null then
          update people set company_id = v_company where id = v_person;
        end if;
      end if;
    end if;
    v_action := case when array_length(v_conflicts, 1) is not null
                     then 'conflict' else 'updated' end;
  else
    -- ── new canonical Person (company resolved FIRST, so it is created only
    -- when it will actually be linked) ──
    if v_company_name is not null then
      select count(*), min(id::text)::uuid into v_company_n, v_company
        from companies c
       where c.tenant_id = p_tenant and c.name = v_company_name;
      if v_company_n = 0 then
        insert into companies (tenant_id, name, postcode, address_text, created_source)
        values (p_tenant, v_company_name,
                nullif(p_record ->> 'postcode', ''), nullif(p_record ->> 'address_text', ''),
                'import:' || v_source)
        returning id into v_company;
      elsif v_company_n > 1 then
        v_company := null;
        v_conflicts := array_append(v_conflicts, 'company_name_ambiguous');
      end if;
    end if;
    insert into people (tenant_id, company_id, display_name, first_name, last_name,
                        primary_email, primary_phone, address_text, postcode,
                        created_source, verified)
    values (p_tenant, v_company, v_display,
            nullif(trim(coalesce(p_record ->> 'first_name', '')), ''),
            nullif(trim(coalesce(p_record ->> 'last_name', '')), ''),
            v_email, nullif(trim(coalesce(p_record ->> 'primary_phone', '')), ''),
            nullif(trim(coalesce(p_record ->> 'address_text', '')), ''),
            nullif(trim(coalesce(p_record ->> 'postcode', '')), ''),
            'import:contacts:' || v_source, false)
    returning id into v_person;
    v_action := 'created';
  end if;

  -- ── canonical contact points (idempotent; primary only when none exists; an
  -- endpoint whose scalar produced a FIELD CONFLICT is NOT attached — the
  -- conflicting identifier lives in evidence only; an endpoint marked invalid
  -- is never promoted to primary) ──
  declare
    v_ch text; v_raw text; v_norm text; v_scalar_field text;
  begin
    for v_ch, v_raw, v_norm, v_scalar_field in
      select * from (values
        ('email', p_record ->> 'primary_email', v_email, 'primary_email'),
        ('email', p_record ->> 'secondary_email', v_email2, null),
        ('phone', p_record ->> 'primary_phone', v_phone, 'primary_phone'),
        ('phone', p_record ->> 'secondary_phone', v_phone2, null)) t(ch, raw, norm, sf)
    loop
      if v_norm is not null
         and (v_scalar_field is null or not (v_scalar_field = any (v_conflicts))) then
        insert into contact_points (tenant_id, person_id, channel, value,
                                    normalized_value, source, source_record_ref)
        values (p_tenant, v_person, v_ch, v_raw, v_norm, 'import', p_import::text)
        on conflict (tenant_id, person_id, channel, normalized_value) do nothing;
        update contact_points cp set is_primary = true
         where cp.tenant_id = p_tenant and cp.person_id = v_person
           and cp.channel = v_ch and cp.normalized_value = v_norm
           and cp.verification_state <> 'invalid'
           and not exists (select 1 from contact_points cp2
                            where cp2.tenant_id = p_tenant and cp2.person_id = v_person
                              and cp2.channel = v_ch and cp2.is_primary);
      end if;
    end loop;
  end;

  -- ── relationship: only when the Person has NO active relationship — an
  --    import default never overwrites an established classification. Values
  --    were VALIDATED above (an unknown row value is an invalid outcome, never
  --    silently defaulted). When the row supplies nothing, ONLY the SEALED
  --    defaults apply — never live marketing_settings.
  if not exists (select 1 from contact_relationships r
                  where r.tenant_id = p_tenant and r.person_id = v_person
                    and r.status = 'active') then
    v_rel_type := coalesce(
      lower(nullif(trim(coalesce(p_record ->> 'relationship_type', '')), '')),
      p_options ->> 'relationship_type');
    v_stage := coalesce(
      marketing_import_resolve_stage(p_tenant, p_record ->> 'lifecycle_stage'),
      p_options ->> 'lifecycle_stage_key');
    insert into contact_relationships
      (tenant_id, person_id, company_id, relationship_type, lifecycle_stage_key,
       owner_id, source, source_record_ref, created_by, updated_by)
    values (p_tenant, v_person, v_company, v_rel_type, v_stage,
            v_owner, 'import', p_import::text, p_actor, p_actor);
  end if;

  -- ── optional sealed import tag through the CANONICAL assignment table ──
  if v_tag is not null then
    insert into contact_tag_assignments
      (tenant_id, person_id, tag_id, source, trigger_ref, assigned_by)
    values (p_tenant, v_person, v_tag, 'import', p_import::text, p_actor)
    on conflict (tenant_id, person_id, tag_id) do nothing;
  end if;

  -- ── provenance (mutation lineage) + the DURABLE terminal row outcome ──
  insert into import_row_provenance
    (tenant_id, import_id, entity_table, entity_id, source_system,
     source_row_number, external_id, imported_fields, match_strategy,
     confidence, action, conflicts)
  values (p_tenant, p_import, 'people', v_person, v_source, p_row_number, v_ext,
          (select coalesce(array_agg(k), '{}') from jsonb_object_keys(p_record) k),
          v_strategy, v_confidence, v_action,
          coalesce((select jsonb_agg(jsonb_build_object('field', c))
                      from unnest(v_conflicts) c), '[]'::jsonb));
  insert into marketing_import_row_results
    (tenant_id, import_id, row_number, outcome, reason, fields, entity_id, attempt)
  values (p_tenant, p_import, p_row_number, v_action,
          case when v_action = 'conflict' then 'field values differ from canonical data' end,
          coalesce(v_conflicts, '{}'::text[]), v_person, v_attempt)
  on conflict (tenant_id, import_id, row_number) do update
    set outcome = excluded.outcome, reason = excluded.reason,
        fields = excluded.fields, entity_id = excluded.entity_id,
        attempt = excluded.attempt;

  return jsonb_build_object('action', v_action, 'person_id', v_person,
                            'strategy', v_strategy,
                            'field_conflicts', coalesce(array_length(v_conflicts, 1), 0));
end $$;

-- ===========================================================================
-- GOVERNED row-outcome recorder — the ONLY way the Edge layer marks a row
-- `invalid` (deterministic mapping failure — terminal) or `failed`
-- (retryable). Takes the SAME per-(import,row) advisory lock as the apply RPC,
-- validates lineage/status/row-range, NEVER downgrades a terminal outcome
-- (created/updated/conflict/invalid), never overwrites one terminal outcome
-- with another, increments attempts safely, permits failed → terminal on
-- retry, and returns the AUTHORITATIVE existing outcome when another worker
-- already completed the row. Replaces raw upserts that could race a
-- successful apply.
-- ===========================================================================
create or replace function marketing_import_row_outcome(
  p_tenant uuid, p_import uuid, p_row_number int,
  p_outcome text, p_reason text, p_fields text[] default '{}'::text[]
) returns jsonb
language plpgsql
as $$
declare
  v_imp data_imports%rowtype;
  v_prior marketing_import_row_results%rowtype;
begin
  if p_tenant is null or p_import is null or p_row_number is null then
    raise exception 'tenant, import and row number required' using errcode = '22023';
  end if;
  if p_outcome not in ('invalid', 'failed') then
    -- terminal apply outcomes are recorded ONLY by marketing_import_contact_row
    raise exception 'outcome must be invalid|failed' using errcode = '22023';
  end if;
  if p_reason is null or length(p_reason) > 300 then
    raise exception 'a bounded reason is required' using errcode = '22023';
  end if;
  if coalesce(array_length(p_fields, 1), 0) > 20 then
    raise exception 'fields list is bounded' using errcode = '22023';
  end if;
  select * into v_imp from data_imports
   where id = p_import and tenant_id = p_tenant;
  if not found then
    raise exception 'import not found for tenant' using errcode = 'P0002';
  end if;
  if v_imp.entity_type <> 'contacts' then
    raise exception 'row outcomes apply to contacts imports only' using errcode = '22023';
  end if;
  if v_imp.status not in ('previewed', 'importing', 'failed') then
    raise exception 'import status % does not allow row outcomes', v_imp.status
      using errcode = '22023';
  end if;
  if p_row_number < 2 or p_row_number > v_imp.row_count + 1 then
    raise exception 'row number is outside the sealed import' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|import|' || p_import::text || '|' || p_row_number, 42));
  select * into v_prior from marketing_import_row_results r
   where r.tenant_id = p_tenant and r.import_id = p_import
     and r.row_number = p_row_number;
  if found and v_prior.outcome <> 'failed' then
    -- another worker already completed this row: the TERMINAL outcome is
    -- authoritative and is never downgraded or replaced
    return jsonb_build_object('outcome', v_prior.outcome, 'already', true);
  end if;
  if found then
    update marketing_import_row_results set
      outcome = p_outcome, reason = p_reason, fields = coalesce(p_fields, '{}'::text[]),
      attempt = v_prior.attempt + 1
    where id = v_prior.id;
    return jsonb_build_object('outcome', p_outcome, 'attempt', v_prior.attempt + 1);
  end if;
  insert into marketing_import_row_results
    (tenant_id, import_id, row_number, outcome, reason, fields, attempt)
  values (p_tenant, p_import, p_row_number, p_outcome, p_reason,
          coalesce(p_fields, '{}'::text[]), 1);
  return jsonb_build_object('outcome', p_outcome, 'attempt', 1);
end $$;

-- ===========================================================================
-- Concurrency-safe import finalisation: aggregates are recomputed from the
-- DURABLE per-row outcomes under the locked import row, so a partial retry can
-- never lose previously recorded counts and two concurrent apply attempts can
-- never finalise contradictory totals. `completed` means EVERY source row has
-- a terminal outcome and NO retryable failure remains. EVERY successful
-- invocation — first, concurrent or already-completed — returns the SAME
-- complete shape (status + cumulative totals + the full import row).
-- ===========================================================================
create or replace function marketing_import_finalize(p_tenant uuid, p_import uuid)
returns jsonb
language plpgsql
as $$
declare
  v_imp data_imports%rowtype;
  v_created int; v_updated int; v_conflict int; v_invalid int; v_failed int;
  v_processed int;
  v_status text;
  v_done data_imports%rowtype;
begin
  if p_tenant is null or p_import is null then
    raise exception 'tenant and import required' using errcode = '22023';
  end if;
  select * into v_imp from data_imports
   where id = p_import and tenant_id = p_tenant for update;
  if not found then
    raise exception 'import not found for tenant' using errcode = 'P0002';
  end if;
  if v_imp.entity_type <> 'contacts' then
    raise exception 'finalize applies to contacts imports only' using errcode = '22023';
  end if;
  if v_imp.status = 'completed' then
    -- SAME COMPLETE SHAPE as every other successful invocation: the durable
    -- cumulative totals + the full import row, never a bare status
    select count(*) filter (where outcome = 'created'),
           count(*) filter (where outcome = 'updated'),
           count(*) filter (where outcome = 'conflict'),
           count(*) filter (where outcome = 'invalid'),
           count(*) filter (where outcome = 'failed')
      into v_created, v_updated, v_conflict, v_invalid, v_failed
      from marketing_import_row_results r
     where r.tenant_id = p_tenant and r.import_id = p_import;
    return jsonb_build_object('status', 'completed', 'already', true,
      'created', v_created, 'updated', v_updated, 'conflicts', v_conflict,
      'invalid', v_invalid, 'failed', v_failed,
      'unprocessed', greatest(v_imp.row_count
        - (v_created + v_updated + v_conflict + v_invalid + v_failed), 0),
      'import', to_jsonb(v_imp));
  end if;
  if v_imp.status not in ('previewed', 'importing', 'failed') then
    raise exception 'import status % cannot be finalised', v_imp.status
      using errcode = '22023';
  end if;

  select count(*) filter (where outcome = 'created'),
         count(*) filter (where outcome = 'updated'),
         count(*) filter (where outcome = 'conflict'),
         count(*) filter (where outcome = 'invalid'),
         count(*) filter (where outcome = 'failed')
    into v_created, v_updated, v_conflict, v_invalid, v_failed
    from marketing_import_row_results r
   where r.tenant_id = p_tenant and r.import_id = p_import;
  v_processed := v_created + v_updated + v_conflict + v_invalid + v_failed;

  v_status := case when v_failed > 0 or v_processed < v_imp.row_count
                   then 'failed' else 'completed' end;
  update data_imports set
    status = v_status,
    created_records = v_created,
    updated_records = v_updated,
    conflict_records = v_conflict,
    invalid_rows = v_invalid,
    skipped_records = greatest(v_imp.row_count - v_processed, 0),
    failure = case
      when v_failed > 0
        then v_failed || ' row(s) failed to apply — retrying processes only those rows'
      when v_processed < v_imp.row_count
        then 'apply did not process every row — retry to continue'
      else null end,
    completed_at = case when v_status = 'completed' then now() else null end
  where id = p_import
  returning * into v_done;

  return jsonb_build_object('status', v_status, 'already', false,
    'created', v_created, 'updated', v_updated, 'conflicts', v_conflict,
    'invalid', v_invalid, 'failed', v_failed,
    'unprocessed', greatest(v_imp.row_count - v_processed, 0),
    'import', to_jsonb(v_done));
end $$;

-- ===========================================================================
-- Grants — every Phase-3 RPC is SERVICE-ROLE ONLY.
-- ===========================================================================
do $$
declare sig text;
begin
  foreach sig in array array[
    'marketing_require_admin_actor(uuid, uuid)',
    'marketing_update_settings(uuid, uuid, jsonb, int)',
    'marketing_lifecycle_admin(uuid, uuid, text, jsonb)',
    'marketing_access_overview(uuid)',
    'marketing_access_set(uuid, uuid, uuid, text, text, text)',
    'marketing_audit_list(uuid, jsonb)',
    'marketing_tags_admin_list(uuid)',
    'marketing_tag_mutate(uuid, uuid, text, jsonb)',
    'marketing_tag_admin(uuid, uuid, text, jsonb)',
    'marketing_tag_bulk(uuid, uuid, text, uuid, uuid[], text, text)',
    'marketing_segment_validate(uuid, jsonb, int, int)',
    'marketing_segment_match_person(uuid, uuid, jsonb, int)',
    'marketing_segment_mutate(uuid, uuid, text, jsonb)',
    'marketing_segment_evaluate(uuid, uuid, jsonb)',
    'marketing_import_resolve_stage(uuid, text)',
    'marketing_import_validate_contact_row(uuid, jsonb)',
    'marketing_import_resolve_contact(uuid, jsonb, text)',
    'marketing_import_match_contact(uuid, jsonb)',
    'marketing_import_contact_row(uuid, uuid, uuid, int, jsonb, jsonb)',
    'marketing_import_row_outcome(uuid, uuid, int, text, text, text[])',
    'marketing_import_finalize(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated;', sig);
    execute format('grant execute on function %s to service_role;', sig);
  end loop;
end $$;
