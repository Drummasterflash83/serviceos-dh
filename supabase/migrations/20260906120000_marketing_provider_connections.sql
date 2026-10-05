-- ============================================================================
-- Marketing Phase 9 — Platform Seams: provider connections, credentials,
-- sync engine and freshness. Additive, run-once. Builds on the committed
-- Phase 0–8 chain (through 20260905120000_marketing_ads.sql).
--
-- THIS IS A SEAM LAYER, NOT AN INTEGRATION. Zero provider adapters exist in
-- this build. Every structure below is proven with synthetic fixtures only,
-- and the public API can NEVER produce a 'connected' account, a succeeded
-- sync or a 'fresh' badge without a genuine adapter reporting real facts:
--
--   • marketing_provider_accounts — one row per tenant/provider connection
--     with a REAL status lifecycle (preview → connecting → connected → error
--     → revoked). The ONLY door to 'connected' is the adapter seam
--     (marketing_provider_account_connect_result); the public connect action
--     truthfully lands in error/'no_adapter' because no adapter is
--     implemented.
--   • credentials — Vault-broker references ONLY (provider key
--     'mkt-conn-<account id>'); the mark RPC commits idempotency + the
--     rotation clock BEFORE any Vault write (the Phase-8 F3/F4 contract:
--     a replayed request id never rotates twice, and a rotated-away secret
--     is honoured only inside a bounded 86400 s overlap).
--   • marketing_provider_sync_runs — the lease-safe sync engine seam:
--     manual requests refuse truthfully unless the account is genuinely
--     connected; single-flight per account; claim/complete mirror the
--     Phase-8 worker contract including the attempts >= 10 poison ceiling.
--     The scheduled path is ONLY the due-computation function — no cron is
--     registered anywhere in this build; nothing polls.
--   • freshness — COMPUTED, never stored: never_run / error / stale / fresh,
--     each with its reason.
--
-- Reused authorities (nothing duplicated): marketing_require_ads_actor
-- (owner/admin + marketing.ads.manage), marketing_template_request_gate +
-- marketing_request_keys (request-id idempotency), the tenant Vault broker
-- (provider_secret_store/read — called by the Edge layer only),
-- marketing_event_append, audit_logs, current_tenant_id,
-- marketing_has_permission, marketing_history_append_only, set_updated_at.
--
-- Function namespace: marketing_provider_% — DELIBERATELY disjoint from the
-- committed Phase-8 catalog lock (marketing_ad_% / marketing_ads_%), which
-- this migration must not and does not disturb.
--
-- Security posture (identical to Phase 8): RLS on every table; browser roles
-- hold ZERO write privileges (explicit revokes below neutralise Supabase
-- default-privilege drift); every function is INVOKER (no SECURITY DEFINER)
-- and executable by service_role only; no secret is ever stored or logged
-- here — the Vault broker is the only credential store.
-- ============================================================================

-- ── PART A · PROVIDER ACCOUNTS ──────────────────────────────────────────────

create table marketing_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  -- the connectable provider vocabulary. 'webhook' is deliberately absent:
  -- the Phase-8 signed webhook is push-only and needs no provider account.
  provider text not null check (provider in ('meta', 'google_ads', 'linkedin', 'sheet')),
  display_name text not null check (length(display_name) between 1 and 120),
  status text not null default 'preview'
    check (status in ('preview', 'connecting', 'connected', 'error', 'revoked')),
  status_reason text check (status_reason is null or length(status_reason) <= 120),
  -- presence flags only — credentials live in the tenant Vault broker under
  -- provider key 'mkt-conn-<id>', fields credential_key(+_previous)
  credential_state text not null default 'unconfigured'
    check (credential_state in ('unconfigured', 'configured')),
  -- when the CURRENT credential was last rotated (a previous credential was
  -- retained). Bounds the rotation overlap exactly like Phase 8: a consumer
  -- may honour the previous credential ONLY inside the 86400 s window after
  -- this instant. Null on first configuration (nothing to overlap).
  credential_rotated_at timestamptz,
  connected_at timestamptz,
  revoked_at timestamptz,
  -- freshness inputs — facts, only ever written by the sync engine
  last_synced_at timestamptz,
  stale_after_seconds int not null default 86400
    check (stale_after_seconds between 300 and 2592000),
  sync_cadence_minutes int check (sync_cadence_minutes is null
                                  or sync_cadence_minutes between 5 and 1440),
  adapter_version text check (adapter_version is null or length(adapter_version) <= 40),
  current_version_id uuid,
  version int not null default 1 check (version >= 1),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
alter table marketing_provider_accounts
  add constraint mpa_created_by_fk foreign key (tenant_id, created_by)
    references profiles (tenant_id, id) on delete set null,
  add constraint mpa_updated_by_fk foreign key (tenant_id, updated_by)
    references profiles (tenant_id, id) on delete set null,
  -- state/timestamp coherence: the facts move only with their states
  add constraint mpa_connected_fact check
    (status <> 'connected' or connected_at is not null),
  add constraint mpa_revoked_fact check
    ((status = 'revoked') = (revoked_at is not null));
create index marketing_provider_accounts_tenant_idx
  on marketing_provider_accounts (tenant_id, status, created_at desc, id);
create trigger marketing_provider_accounts_set_updated_at
  before update on marketing_provider_accounts
  for each row execute function set_updated_at();

-- lifecycle guard: identity + provider are immutable; the version never moves
-- backwards; transitions follow the lifecycle map exactly; revoked is terminal
create or replace function marketing_provider_account_guard()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id or new.tenant_id <> old.tenant_id
     or new.provider <> old.provider or new.created_at <> old.created_at then
    raise exception 'provider account identity is immutable'
      using errcode = 'restrict_violation';
  end if;
  if new.version < old.version then
    raise exception 'provider account version cannot move backwards'
      using errcode = 'restrict_violation';
  end if;
  if new.status <> old.status then
    if not ((old.status = 'preview'    and new.status = 'connecting')
         or (old.status = 'connecting' and new.status in ('connected', 'error'))
         or (old.status = 'connected'  and new.status in ('error', 'revoked'))
         or (old.status = 'error'      and new.status in ('connecting', 'revoked'))) then
      raise exception 'illegal provider account transition % -> %',
        old.status, new.status using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger marketing_provider_accounts_guard
  before update on marketing_provider_accounts
  for each row execute function marketing_provider_account_guard();

alter table marketing_provider_accounts enable row level security;
create policy marketing_provider_accounts_select on marketing_provider_accounts
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_provider_accounts to authenticated;
grant select, insert, update on marketing_provider_accounts to service_role;
revoke delete, truncate on marketing_provider_accounts
  from anon, authenticated, service_role;

-- ── PART B · APPEND-ONLY ACCOUNT VERSION HISTORY ────────────────────────────

create table marketing_provider_account_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  account_id uuid not null,
  version_number int not null check (version_number >= 1),
  change_kind text not null check (change_kind in
    ('create', 'connect_attempt', 'connect_result', 'rotate_credential',
     'revoke')),
  config jsonb not null,
  changed_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, account_id, version_number)
);
alter table marketing_provider_account_versions
  add constraint mpav_account_fk foreign key (tenant_id, account_id)
    references marketing_provider_accounts (tenant_id, id) on delete cascade,
  add constraint mpav_actor_fk foreign key (tenant_id, changed_by)
    references profiles (tenant_id, id) on delete set null;
create index marketing_provider_account_versions_idx
  on marketing_provider_account_versions (tenant_id, account_id, version_number desc);
create trigger marketing_provider_account_versions_append_only_update
  before update on marketing_provider_account_versions
  for each row execute function marketing_history_append_only();
create trigger marketing_provider_account_versions_append_only_delete
  before delete on marketing_provider_account_versions
  for each row execute function marketing_history_append_only();
alter table marketing_provider_account_versions enable row level security;
create policy marketing_provider_account_versions_select
  on marketing_provider_account_versions
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_provider_account_versions to authenticated;
grant select, insert on marketing_provider_account_versions to service_role;
revoke update, delete, truncate on marketing_provider_account_versions
  from anon, authenticated, service_role;

-- ── PART C · SYNC RUNS (the engine seam) ────────────────────────────────────

create table marketing_provider_sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  account_id uuid not null,
  kind text not null check (kind in ('manual', 'scheduled')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  lease_worker text check (lease_worker is null or length(lease_worker) <= 80),
  lease_expires_at timestamptz,
  error_class text check (error_class is null or length(error_class) <= 60),
  stats jsonb not null default '{}'::jsonb,
  requested_by uuid,
  correlation_id uuid not null default gen_random_uuid(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
alter table marketing_provider_sync_runs
  add constraint mpsr_account_fk foreign key (tenant_id, account_id)
    references marketing_provider_accounts (tenant_id, id) on delete cascade,
  add constraint mpsr_actor_fk foreign key (tenant_id, requested_by)
    references profiles (tenant_id, id) on delete set null;
-- SINGLE FLIGHT: at most one queued-or-running run per account, ever
create unique index marketing_provider_sync_runs_single_flight
  on marketing_provider_sync_runs (tenant_id, account_id)
  where status in ('queued', 'running');
create index marketing_provider_sync_runs_idx
  on marketing_provider_sync_runs (tenant_id, account_id, created_at desc);

create or replace function marketing_provider_sync_run_guard()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id or new.tenant_id <> old.tenant_id
     or new.account_id <> old.account_id or new.kind <> old.kind
     or new.created_at <> old.created_at
     or new.correlation_id <> old.correlation_id then
    raise exception 'sync run identity is immutable' using errcode = 'restrict_violation';
  end if;
  if new.status <> old.status
     and not ((old.status = 'queued'  and new.status in ('running', 'failed'))
           or (old.status = 'running' and new.status in ('succeeded', 'failed'))) then
    raise exception 'illegal sync run transition % -> %', old.status, new.status
      using errcode = '22023';
  end if;
  return new;
end $$;
create trigger marketing_provider_sync_runs_guard
  before update on marketing_provider_sync_runs
  for each row execute function marketing_provider_sync_run_guard();
create trigger marketing_provider_sync_runs_append_only_delete
  before delete on marketing_provider_sync_runs
  for each row execute function marketing_history_append_only();
alter table marketing_provider_sync_runs enable row level security;
create policy marketing_provider_sync_runs_select on marketing_provider_sync_runs
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_provider_sync_runs to authenticated;
grant select, insert, update on marketing_provider_sync_runs to service_role;
revoke delete, truncate on marketing_provider_sync_runs
  from anon, authenticated, service_role;

-- ── PART D · HELPERS ────────────────────────────────────────────────────────

-- snapshot the CURRENT semantic configuration of an account (for versions)
create or replace function marketing_provider_account_snapshot(
  p_row marketing_provider_accounts
) returns jsonb
language sql
immutable
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'provider', p_row.provider, 'display_name', p_row.display_name,
    'status', p_row.status, 'status_reason', p_row.status_reason,
    'credential_state', p_row.credential_state,
    'stale_after_seconds', p_row.stale_after_seconds,
    'sync_cadence_minutes', p_row.sync_cadence_minutes,
    'adapter_version', p_row.adapter_version));
$$;

-- ── PART E · ACCOUNT LIFECYCLE RPCs — request-id idempotent through the
--    canonical marketing_template_request_gate + marketing_request_keys ──────

create or replace function marketing_provider_account_create(
  p_tenant uuid, p_actor uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_provider text;
  v_name text;
  v_stale int;
  v_cadence int;
  v_request_id text;
  v_fp text;
  v_stored jsonb;
  v_row marketing_provider_accounts%rowtype;
  v_version uuid := gen_random_uuid();
  v_result jsonb;
begin
  v_label := marketing_require_ads_actor(p_tenant, p_actor);
  for v_key in select jsonb_object_keys(coalesce(p_args, '{}'::jsonb)) loop
    if v_key not in ('request_id', 'provider', 'display_name',
                     'stale_after_seconds', 'sync_cadence_minutes') then
      raise exception 'unknown connection argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_provider := p_args ->> 'provider';
  v_name := p_args ->> 'display_name';
  v_stale := coalesce((p_args ->> 'stale_after_seconds')::int, 86400);
  v_cadence := (p_args ->> 'sync_cadence_minutes')::int;
  if v_provider is null
     or v_provider not in ('meta', 'google_ads', 'linkedin', 'sheet') then
    raise exception 'provider must be one of meta/google_ads/linkedin/sheet'
      using errcode = '22023';
  end if;
  if v_name is null or length(v_name) not between 1 and 120 then
    raise exception 'display_name must be 1..120 characters' using errcode = '22023';
  end if;
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'provider_account_create',
    'provider', v_provider, 'name', v_name, 'stale', v_stale,
    'cadence', v_cadence)::text, 'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'provider_account_create',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored || jsonb_build_object('replayed', true);
  end if;

  insert into marketing_provider_accounts
    (tenant_id, provider, display_name, stale_after_seconds,
     sync_cadence_minutes, created_by, updated_by)
  values (p_tenant, v_provider, v_name, v_stale, v_cadence, p_actor, p_actor)
  returning * into v_row;
  insert into marketing_provider_account_versions
    (id, tenant_id, account_id, version_number, change_kind, config, changed_by)
  values (v_version, p_tenant, v_row.id, 1, 'create',
          marketing_provider_account_snapshot(v_row), p_actor);
  update marketing_provider_accounts
     set current_version_id = v_version where id = v_row.id;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.connections.account_created',
          'marketing_provider_account', v_row.id::text, 'ok',
          jsonb_build_object('provider', v_provider));
  perform marketing_event_append(p_tenant, 'marketing.connections.account_created',
    'marketing_provider_account', v_row.id, 'marketing-provider-connections',
    jsonb_build_object('k', 'created:' || v_row.id, 'actor', v_label, 'at', now()));

  v_result := jsonb_build_object('id', v_row.id, 'provider', v_provider,
                                 'status', v_row.status, 'version', v_row.version,
                                 'replayed', false);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('provider_account_create:' || v_request_id)::uuid, p_actor,
          'provider_account_create', v_fp, v_result);
  return v_result;
end $$;

-- the PUBLIC connect action. TRUTHFUL v1 semantics: no connection adapter is
-- implemented in this build, so the attempt is RECORDED as facts — the
-- account passes through 'connecting' and lands in error/'no_adapter', both
-- transitions appended to the version history. When a reviewed adapter
-- ships, a follow-up migration revises this function to leave the account in
-- 'connecting' for the adapter's verification (which reports through
-- marketing_provider_account_connect_result below). A fabricated 'connected'
-- is impossible on this path.
create or replace function marketing_provider_account_connect_start(
  p_tenant uuid, p_actor uuid, p_account uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_request_id text;
  v_fp text;
  v_stored jsonb;
  v_row marketing_provider_accounts%rowtype;
  v_version uuid := gen_random_uuid();
  v_result jsonb;
begin
  v_label := marketing_require_ads_actor(p_tenant, p_actor);
  if p_account is null then
    raise exception 'account required' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_args, '{}'::jsonb)) loop
    if v_key not in ('request_id', 'expected_version') then
      raise exception 'unknown connect argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'provider_account_connect',
    'account', p_account,
    'expected_version', (p_args ->> 'expected_version')::int)::text,
    'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'provider_account_connect',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored || jsonb_build_object('replayed', true);
  end if;
  select * into v_row from marketing_provider_accounts
   where id = p_account and tenant_id = p_tenant for update;
  if not found then
    raise exception 'provider connection not found for tenant' using errcode = 'P0002';
  end if;
  if v_row.version <> (p_args ->> 'expected_version')::int then
    raise exception 'provider connection changed since it was read' using errcode = 'MK409';
  end if;
  if v_row.status = 'revoked' then
    raise exception 'a revoked connection cannot be reconnected — create a new one'
      using errcode = '22023';
  end if;
  if v_row.status not in ('preview', 'error') then
    raise exception 'connect is only valid from preview or error (current: %)',
      v_row.status using errcode = '22023';
  end if;

  -- fact 1: the attempt
  update marketing_provider_accounts
     set status = 'connecting', status_reason = null,
         updated_by = p_actor, version = version + 1
   where id = p_account
  returning * into v_row;
  insert into marketing_provider_account_versions
    (id, tenant_id, account_id, version_number, change_kind, config, changed_by)
  values (gen_random_uuid(), p_tenant, p_account, v_row.version, 'connect_attempt',
          marketing_provider_account_snapshot(v_row), p_actor);
  -- fact 2: the truthful v1 outcome — NO adapter is implemented
  update marketing_provider_accounts
     set status = 'error', status_reason = 'no_adapter',
         updated_by = p_actor, version = version + 1
   where id = p_account
  returning * into v_row;
  insert into marketing_provider_account_versions
    (id, tenant_id, account_id, version_number, change_kind, config, changed_by)
  values (v_version, p_tenant, p_account, v_row.version, 'connect_result',
          marketing_provider_account_snapshot(v_row), p_actor);
  update marketing_provider_accounts
     set current_version_id = v_version where id = p_account;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.connections.connect_attempted',
          'marketing_provider_account', p_account::text, 'error',
          jsonb_build_object('reason', 'no_adapter',
            'note', 'no provider adapter is implemented in this build'));
  perform marketing_event_append(p_tenant, 'marketing.connections.connect_attempted',
    'marketing_provider_account', p_account, 'marketing-provider-connections',
    jsonb_build_object('k', 'connect:' || v_version, 'actor', v_label, 'at', now()));

  v_result := jsonb_build_object('id', p_account, 'status', v_row.status,
                                 'status_reason', v_row.status_reason,
                                 'version', v_row.version,
                                 'adapter_implemented', false, 'replayed', false);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('provider_account_connect:' || v_request_id)::uuid, p_actor,
          'provider_account_connect', v_fp, v_result);
  return v_result;
end $$;

-- THE ADAPTER SEAM — the ONLY door to 'connected'. Service-role only, called
-- by a future reviewed adapter after genuine provider verification (and by
-- test fixtures, which is exactly what the seam is for). Requires the account
-- to be mid-handshake ('connecting') and requires verification evidence; a
-- bare "trust me" cannot connect an account.
create or replace function marketing_provider_account_connect_result(
  p_tenant uuid, p_account uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_row marketing_provider_accounts%rowtype;
  v_verified boolean;
  v_reason text;
  v_adapter text;
  v_evidence jsonb;
  v_version uuid := gen_random_uuid();
begin
  if p_tenant is null or p_account is null then
    raise exception 'tenant and account required' using errcode = '22023';
  end if;
  v_verified := (p_args ->> 'verified')::boolean;
  v_reason := left(coalesce(p_args ->> 'reason', ''), 120);
  v_adapter := p_args ->> 'adapter_version';
  v_evidence := p_args -> 'evidence';
  if v_verified is null then
    raise exception 'verified true/false is required' using errcode = '22023';
  end if;
  if v_verified and (v_evidence is null or v_evidence = '{}'::jsonb
                     or v_adapter is null) then
    raise exception 'a connected result requires adapter_version and non-empty verification evidence'
      using errcode = '22023';
  end if;
  select * into v_row from marketing_provider_accounts
   where id = p_account and tenant_id = p_tenant for update;
  if not found then
    raise exception 'provider connection not found for tenant' using errcode = 'P0002';
  end if;
  if v_row.status <> 'connecting' then
    raise exception 'a connect result is only valid while connecting (current: %)',
      v_row.status using errcode = '22023';
  end if;

  update marketing_provider_accounts
     set status = case when v_verified then 'connected' else 'error' end,
         status_reason = case when v_verified then null
                              else nullif(v_reason, '') end,
         connected_at = case when v_verified then now() else connected_at end,
         adapter_version = case when v_verified then left(v_adapter, 40)
                                else adapter_version end,
         version = version + 1
   where id = p_account
  returning * into v_row;
  insert into marketing_provider_account_versions
    (id, tenant_id, account_id, version_number, change_kind, config, changed_by)
  values (v_version, p_tenant, p_account, v_row.version, 'connect_result',
          marketing_provider_account_snapshot(v_row)
            || jsonb_build_object('evidence', coalesce(v_evidence, '{}'::jsonb)),
          null);
  update marketing_provider_accounts
     set current_version_id = v_version where id = p_account;
  return jsonb_build_object('id', p_account, 'status', v_row.status,
                            'status_reason', v_row.status_reason,
                            'version', v_row.version);
end $$;

-- credential mark — IDEMPOTENCY AND THE ROTATION CLOCK COMMIT BEFORE ANY
-- VAULT WRITE (the Phase-8 F3 contract). The Edge function stores the secret
-- into the tenant Vault broker only after this returns replayed:false; a
-- replayed request id returns the stored result, rotates nothing and never
-- re-reveals anything.
create or replace function marketing_provider_account_credential_mark(
  p_tenant uuid, p_actor uuid, p_account uuid, p_args jsonb, p_expected_version int
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_request_id text;
  v_fp text;
  v_stored jsonb;
  v_row marketing_provider_accounts%rowtype;
  v_rotated boolean;
  v_version uuid := gen_random_uuid();
  v_result jsonb;
begin
  v_label := marketing_require_ads_actor(p_tenant, p_actor);
  if p_account is null or p_expected_version is null then
    raise exception 'account and expected_version required' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_args, '{}'::jsonb)) loop
    if v_key not in ('request_id') then
      raise exception 'unknown credential argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'provider_account_credential',
    'account', p_account, 'expected_version', p_expected_version)::text,
    'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'provider_account_credential',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored || jsonb_build_object('replayed', true);
  end if;
  select * into v_row from marketing_provider_accounts
   where id = p_account and tenant_id = p_tenant for update;
  if not found then
    raise exception 'provider connection not found for tenant' using errcode = 'P0002';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'provider connection changed since it was read' using errcode = 'MK409';
  end if;
  if v_row.status = 'revoked' then
    raise exception 'a revoked connection cannot hold credentials' using errcode = '22023';
  end if;
  -- a rotation (there WAS a configured credential) starts the bounded 86400 s
  -- overlap clock; a first configuration has no previous credential to honour
  v_rotated := (v_row.credential_state = 'configured');

  update marketing_provider_accounts set
    credential_state = 'configured',
    credential_rotated_at = case when v_rotated then now() else null end,
    updated_by = p_actor, version = version + 1
  where id = p_account
  returning * into v_row;
  insert into marketing_provider_account_versions
    (id, tenant_id, account_id, version_number, change_kind, config, changed_by)
  values (v_version, p_tenant, p_account, v_row.version, 'rotate_credential',
          marketing_provider_account_snapshot(v_row), p_actor);
  update marketing_provider_accounts
     set current_version_id = v_version where id = p_account;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.connections.credential_rotated',
          'marketing_provider_account', p_account::text, 'ok',
          jsonb_build_object('note', 'credential stored in the tenant Vault broker — never here'));
  perform marketing_event_append(p_tenant, 'marketing.connections.credential_rotated',
    'marketing_provider_account', p_account, 'marketing-provider-connections',
    jsonb_build_object('k', 'rotated:' || v_version, 'actor', v_label, 'at', now()));

  v_result := jsonb_build_object('id', p_account, 'credential_state', 'configured',
                                 'version', v_row.version, 'rotated', v_rotated,
                                 'replayed', false);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('provider_account_credential:' || v_request_id)::uuid, p_actor,
          'provider_account_credential', v_fp, v_result);
  return v_result;
end $$;

create or replace function marketing_provider_account_revoke(
  p_tenant uuid, p_actor uuid, p_account uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_request_id text;
  v_fp text;
  v_stored jsonb;
  v_row marketing_provider_accounts%rowtype;
  v_version uuid := gen_random_uuid();
  v_result jsonb;
begin
  v_label := marketing_require_ads_actor(p_tenant, p_actor);
  if p_account is null then
    raise exception 'account required' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_args, '{}'::jsonb)) loop
    if v_key not in ('request_id', 'expected_version') then
      raise exception 'unknown revoke argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'provider_account_revoke',
    'account', p_account,
    'expected_version', (p_args ->> 'expected_version')::int)::text,
    'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'provider_account_revoke',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored || jsonb_build_object('replayed', true);
  end if;
  select * into v_row from marketing_provider_accounts
   where id = p_account and tenant_id = p_tenant for update;
  if not found then
    raise exception 'provider connection not found for tenant' using errcode = 'P0002';
  end if;
  if v_row.version <> (p_args ->> 'expected_version')::int then
    raise exception 'provider connection changed since it was read' using errcode = 'MK409';
  end if;
  if v_row.status = 'revoked' then
    raise exception 'connection is already revoked' using errcode = '22023';
  end if;
  if v_row.status in ('preview', 'connecting') then
    -- the lifecycle map has no preview/connecting -> revoked edge; walk the
    -- honest path: record the failed state first, then revoke it
    update marketing_provider_accounts
       set status = case when v_row.status = 'preview' then 'connecting'
                         else status end
     where id = p_account and v_row.status = 'preview';
    update marketing_provider_accounts
       set status = 'error', status_reason = 'revoked_before_connection'
     where id = p_account;
  end if;
  update marketing_provider_accounts
     set status = 'revoked', status_reason = coalesce(status_reason, 'revoked'),
         revoked_at = now(),
         credential_state = 'unconfigured',
         updated_by = p_actor, version = version + 1
   where id = p_account
  returning * into v_row;
  insert into marketing_provider_account_versions
    (id, tenant_id, account_id, version_number, change_kind, config, changed_by)
  values (v_version, p_tenant, p_account, v_row.version, 'revoke',
          marketing_provider_account_snapshot(v_row), p_actor);
  update marketing_provider_accounts
     set current_version_id = v_version where id = p_account;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.connections.account_revoked',
          'marketing_provider_account', p_account::text, 'ok',
          jsonb_build_object('note',
            'Vault credential reference is orphaned by revocation; no consumer reads it'));
  perform marketing_event_append(p_tenant, 'marketing.connections.account_revoked',
    'marketing_provider_account', p_account, 'marketing-provider-connections',
    jsonb_build_object('k', 'revoked:' || v_version, 'actor', v_label, 'at', now()));

  v_result := jsonb_build_object('id', p_account, 'status', 'revoked',
                                 'version', v_row.version, 'replayed', false);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('provider_account_revoke:' || v_request_id)::uuid, p_actor,
          'provider_account_revoke', v_fp, v_result);
  return v_result;
end $$;

-- ── PART F · SYNC ENGINE RPCs ───────────────────────────────────────────────

-- manual sync request: TRUTHFUL gating — only a genuinely connected account
-- may queue a run. In this build nothing can be connected through the public
-- API, so every real request refuses; the fixture-connected path proves the
-- machinery. Single flight is structural (partial unique index).
create or replace function marketing_provider_sync_request(
  p_tenant uuid, p_actor uuid, p_account uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_request_id text;
  v_fp text;
  v_stored jsonb;
  v_row marketing_provider_accounts%rowtype;
  v_run marketing_provider_sync_runs%rowtype;
  v_result jsonb;
begin
  v_label := marketing_require_ads_actor(p_tenant, p_actor);
  if p_account is null then
    raise exception 'account required' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_args, '{}'::jsonb)) loop
    if v_key not in ('request_id') then
      raise exception 'unknown sync argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'provider_sync_request',
    'account', p_account)::text, 'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'provider_sync_request',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored || jsonb_build_object('replayed', true);
  end if;
  select * into v_row from marketing_provider_accounts
   where id = p_account and tenant_id = p_tenant for update;
  if not found then
    raise exception 'provider connection not found for tenant' using errcode = 'P0002';
  end if;
  if v_row.status <> 'connected' then
    raise exception 'provider % is not connected — sync requires a genuinely connected account (current: %)',
      v_row.provider, v_row.status using errcode = 'MK430';
  end if;

  insert into marketing_provider_sync_runs
    (tenant_id, account_id, kind, requested_by)
  values (p_tenant, p_account, 'manual', p_actor)
  returning * into v_run;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.connections.sync_requested',
          'marketing_provider_sync_run', v_run.id::text, 'ok',
          jsonb_build_object('account', p_account, 'kind', 'manual'));
  perform marketing_event_append(p_tenant, 'marketing.connections.sync_requested',
    'marketing_provider_account', p_account, 'marketing-provider-connections',
    jsonb_build_object('k', 'sync:' || v_run.id, 'actor', v_label, 'at', now()));

  v_result := jsonb_build_object('run_id', v_run.id, 'status', 'queued',
                                 'replayed', false);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('provider_sync_request:' || v_request_id)::uuid, p_actor,
          'provider_sync_request', v_fp, v_result);
  return v_result;
end $$;

-- worker claim — mirrors the Phase-8 lease contract exactly, including the
-- POISON GUARD: a run stuck at running with an expired lease and a burned
-- attempt budget is retired to failed/'max_attempts_exhausted' and excluded
-- from reclaim, so the automatic loop can never spin on it.
create or replace function marketing_provider_sync_claim(
  p_tenant uuid, p_worker text, p_batch int default 5, p_lease_seconds int default 300
) returns setof marketing_provider_sync_runs
language plpgsql
as $$
begin
  update marketing_provider_sync_runs r
     set status = 'failed',
         error_class = 'max_attempts_exhausted',
         lease_worker = null,
         lease_expires_at = null,
         finished_at = now()
   where r.tenant_id = p_tenant
     and r.status = 'running'
     and r.lease_expires_at < now()
     and r.attempts >= 10;
  return query
  update marketing_provider_sync_runs r
     set status = 'running',
         attempts = r.attempts + 1,
         lease_worker = left(coalesce(p_worker, 'worker'), 80),
         lease_expires_at = now() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 300))),
         started_at = coalesce(r.started_at, now())
   where r.id in (
     select r2.id from marketing_provider_sync_runs r2
      where r2.tenant_id = p_tenant
        and (r2.status = 'queued'
             or (r2.status = 'running' and r2.lease_expires_at < now()))
        and r2.attempts < 10
      order by r2.created_at
      limit least(greatest(coalesce(p_batch, 5), 1), 20)
      for update skip locked)
   returning r.*;
end $$;

-- terminal completion — CONVERGES on repeats: completing an already-terminal
-- run returns its current state and never bumps last_synced_at twice.
create or replace function marketing_provider_sync_complete(
  p_tenant uuid, p_run uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_run marketing_provider_sync_runs%rowtype;
  v_outcome text;
  v_error text;
begin
  if p_tenant is null or p_run is null then
    raise exception 'tenant and run required' using errcode = '22023';
  end if;
  v_outcome := p_args ->> 'outcome';
  v_error := left(coalesce(p_args ->> 'error_class', ''), 60);
  if v_outcome not in ('succeeded', 'failed') then
    raise exception 'outcome must be succeeded or failed' using errcode = '22023';
  end if;
  if v_outcome = 'failed' and v_error = '' then
    raise exception 'a failed run requires an error_class' using errcode = '22023';
  end if;
  select * into v_run from marketing_provider_sync_runs
   where id = p_run and tenant_id = p_tenant for update;
  if not found then
    raise exception 'sync run not found for tenant' using errcode = 'P0002';
  end if;
  if v_run.status in ('succeeded', 'failed') then
    return jsonb_build_object('run_id', v_run.id, 'status', v_run.status,
                              'error_class', v_run.error_class,
                              'converged', true);
  end if;
  if v_run.status <> 'running' then
    raise exception 'only a running run can complete (current: %)', v_run.status
      using errcode = '22023';
  end if;

  update marketing_provider_sync_runs
     set status = v_outcome,
         error_class = case when v_outcome = 'failed' then v_error else null end,
         stats = coalesce(p_args -> 'stats', '{}'::jsonb),
         lease_worker = null, lease_expires_at = null,
         finished_at = now()
   where id = p_run
  returning * into v_run;

  if v_outcome = 'succeeded' then
    update marketing_provider_accounts
       set last_synced_at = greatest(coalesce(last_synced_at, '-infinity'), now())
     where id = v_run.account_id and tenant_id = p_tenant;
  end if;
  return jsonb_build_object('run_id', v_run.id, 'status', v_run.status,
                            'error_class', v_run.error_class,
                            'converged', false);
end $$;

-- the SCHEDULED seam — pure due-computation. NOTHING in this build calls it
-- on a timer (no cron/scheduler is registered; nothing polls). A future
-- scheduler enumerates due accounts here and enqueues through the same
-- single-flight insert the manual path uses.
create or replace function marketing_provider_sync_due(p_tenant uuid)
returns table (account_id uuid, provider text, last_synced_at timestamptz,
               sync_cadence_minutes int)
language sql
stable
as $$
  select a.id, a.provider, a.last_synced_at, a.sync_cadence_minutes
    from marketing_provider_accounts a
   where a.tenant_id = p_tenant
     and a.status = 'connected'
     and a.sync_cadence_minutes is not null
     and (a.last_synced_at is null
          or a.last_synced_at < now() - make_interval(mins => a.sync_cadence_minutes))
     and not exists (
       select 1 from marketing_provider_sync_runs r
        where r.tenant_id = a.tenant_id and r.account_id = a.id
          and r.status in ('queued', 'running'));
$$;

-- ── PART G · READ PROJECTION + COMPUTED FRESHNESS ───────────────────────────

-- freshness is DERIVED at read time, never stored:
--   error     — the latest terminal run failed (reason = its error_class)
--   never_run — no successful sync has ever recorded facts
--   stale     — the last facts are older than the account's stale_after window
--   fresh     — facts exist inside the window
create or replace function marketing_provider_connection_list(
  p_tenant uuid, p_args jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
stable
as $$
declare
  v_accounts jsonb;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'provider', a.provider,
    'display_name', a.display_name,
    'status', a.status,
    'status_reason', a.status_reason,
    'credential_state', a.credential_state,
    'connected_at', a.connected_at,
    'revoked_at', a.revoked_at,
    'last_synced_at', a.last_synced_at,
    'stale_after_seconds', a.stale_after_seconds,
    'sync_cadence_minutes', a.sync_cadence_minutes,
    'adapter_version', a.adapter_version,
    'version', a.version,
    'created_at', a.created_at,
    'freshness', case
      when lr.status = 'failed' then jsonb_build_object(
        'state', 'error', 'reason', coalesce(lr.error_class, 'sync_failed'))
      when a.last_synced_at is null then jsonb_build_object(
        'state', 'never_run', 'reason', 'no successful sync has ever run')
      when a.last_synced_at < now() - make_interval(secs => a.stale_after_seconds)
        then jsonb_build_object(
          'state', 'stale',
          'reason', 'last facts predate the stale_after window',
          'age_seconds', floor(extract(epoch from (now() - a.last_synced_at))))
      else jsonb_build_object(
        'state', 'fresh',
        'age_seconds', floor(extract(epoch from (now() - a.last_synced_at))))
    end,
    'latest_run', case when lr.id is null then null else jsonb_build_object(
      'id', lr.id, 'kind', lr.kind, 'status', lr.status,
      'attempts', lr.attempts, 'error_class', lr.error_class,
      'created_at', lr.created_at, 'finished_at', lr.finished_at) end
  ) order by a.created_at desc), '[]'::jsonb)
  into v_accounts
  from marketing_provider_accounts a
  left join lateral (
    -- deterministic latest run: id breaks created_at ties totally
    select * from marketing_provider_sync_runs r
     where r.tenant_id = a.tenant_id and r.account_id = a.id
     order by r.created_at desc, r.id desc limit 1
  ) lr on true
  where a.tenant_id = p_tenant;
  return jsonb_build_object('accounts', v_accounts);
end $$;

-- ── PART H · FUNCTION PRIVILEGES — service_role only, INVOKER, deterministic ─

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'marketing_provider_account_guard()',
    'marketing_provider_sync_run_guard()',
    'marketing_provider_account_snapshot(marketing_provider_accounts)',
    'marketing_provider_account_create(uuid, uuid, jsonb)',
    'marketing_provider_account_connect_start(uuid, uuid, uuid, jsonb)',
    'marketing_provider_account_connect_result(uuid, uuid, jsonb)',
    'marketing_provider_account_credential_mark(uuid, uuid, uuid, jsonb, int)',
    'marketing_provider_account_revoke(uuid, uuid, uuid, jsonb)',
    'marketing_provider_sync_request(uuid, uuid, uuid, jsonb)',
    'marketing_provider_sync_claim(uuid, text, int, int)',
    'marketing_provider_sync_complete(uuid, uuid, jsonb)',
    'marketing_provider_sync_due(uuid)',
    'marketing_provider_connection_list(uuid, jsonb)'
  ] loop
    execute 'revoke all on function public.' || fn || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || fn || ' to service_role';
  end loop;
end $$;

-- ── PART I · TABLE-PRIVILEGE DETERMINISM — Supabase-managed databases carry
-- ALTER DEFAULT PRIVILEGES that grant browser roles table privileges on new
-- tables. RLS (enabled, no write policy) already denies every browser write,
-- but the PRIVILEGE boundary must be deterministic in EVERY environment too
-- (the same reasoning as Phase 8 Part K). ───────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'marketing_provider_accounts',
    'marketing_provider_account_versions',
    'marketing_provider_sync_runs'
  ] loop
    execute 'revoke insert, update, delete, truncate on ' || t
         || ' from public, anon, authenticated';
  end loop;
end $$;
