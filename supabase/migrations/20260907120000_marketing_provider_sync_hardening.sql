-- ============================================================================
-- Marketing Phase 10A — Provider sync hardening: adapter-aware connection
-- lifecycle, external-account selection, canonical provider facts, honest
-- account reporting, and the scheduled-enqueue seam. Additive, run-once.
-- Builds on the committed Phase 0–9 chain (through
-- 20260906120000_marketing_provider_connections.sql).
--
-- STILL A SEAM FOR REAL PROVIDERS. Zero reviewed production adapters exist.
-- What Phase 10A adds is the DETERMINISTIC TEST PROVIDER
-- ('serviceos_test_provider') — a simulator identity that:
--   • is NEVER present in the production connection catalogue (the UI cannot
--     offer it, and it can never be presented as Meta / Google Ads /
--     LinkedIn / Sheet);
--   • is accepted at the API boundary ONLY when the Edge environment
--     explicitly enables it (MARKETING_TEST_PROVIDER=enabled — local serve
--     and CI only, never production);
--   • exercises the REAL lifecycle end to end: connect_start → queued
--     validation job → worker adapter validation → connect_result with
--     evidence → external-account discovery/selection → sync runs →
--     canonical facts → honest reporting.
--
-- Lifecycle evolution (marketing_provider_account_connect_start): when the
-- caller layer HOLDS an adapter it says so (adapter_implemented=true) and the
-- account enters 'connecting' with a queued 'marketing.provider_connect'
-- platform job; the WORKER (service-role, the same trust domain as a future
-- reviewed adapter) performs genuine validation and reports through the
-- Phase-9 adapter seam. Without an adapter the Phase-9 truth is unchanged:
-- the attempt is recorded and lands in error/'no_adapter'. The user-facing
-- API still cannot reach the seam and still cannot fabricate 'connected'.
--
-- Canonical facts (marketing_provider_facts): append-only, digest-deduped,
-- revision-superseded provider facts (campaign / ad_group / ad / metric /
-- conversion) recorded ONLY by a RUNNING sync run through the governed
-- recorder. Reporting mirrors the audited Phase-8 honesty rules: mixed
-- currencies ⇒ totals.spend null + 'mixed_currencies'; missing facts are
-- null with their reason, never zero; CPL only when genuinely derivable.
--
-- Security posture unchanged: RLS everywhere, zero browser writes, INVOKER
-- functions, service_role-only EXECUTE, marketing_provider_% namespace
-- (Phase-8 catalog lock untouched; the Phase-9 lock list is extended
-- additively in its suite — both-directions strictness preserved).
-- ============================================================================

-- ── PART A · VOCABULARY + COLUMNS ───────────────────────────────────────────

-- provider vocabulary gains ONLY the deterministic test identity
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'marketing_provider_accounts'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%meta%';
  if c is null then
    raise exception 'provider vocabulary constraint not found';
  end if;
  execute 'alter table marketing_provider_accounts drop constraint ' || quote_ident(c);
  alter table marketing_provider_accounts
    add constraint mpa_provider_vocab check
      (provider in ('meta', 'google_ads', 'linkedin', 'sheet',
                    'serviceos_test_provider'));
end $$;

alter table marketing_provider_accounts
  add column external_account_ref text
    check (external_account_ref is null or length(external_account_ref) <= 120),
  add column external_account_name text
    check (external_account_name is null or length(external_account_name) <= 120),
  -- discovery results: bounded [{ref,name}] written ONLY by the adapter seam
  add column discovered_accounts jsonb not null default '[]'::jsonb;

-- version history gains the selection fact
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'marketing_provider_account_versions'::regclass
     and contype = 'c' and pg_get_constraintdef(oid) like '%change_kind%';
  execute 'alter table marketing_provider_account_versions drop constraint '
          || quote_ident(c);
  alter table marketing_provider_account_versions
    add constraint mpav_change_kind check (change_kind in
      ('create', 'connect_attempt', 'connect_result', 'rotate_credential',
       'revoke', 'external_select'));
end $$;

-- sync runs gain the 'initial' kind (queued automatically on first connect)
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'marketing_provider_sync_runs'::regclass
     and contype = 'c' and pg_get_constraintdef(oid) like '%kind%manual%';
  execute 'alter table marketing_provider_sync_runs drop constraint '
          || quote_ident(c);
  alter table marketing_provider_sync_runs
    add constraint mpsr_kind check (kind in ('manual', 'scheduled', 'initial'));
end $$;

-- ── PART B · CANONICAL PROVIDER FACTS — append-only, digest-deduped ─────────

create table marketing_provider_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  account_id uuid not null,
  run_id uuid not null,
  fact_kind text not null
    check (fact_kind in ('campaign', 'ad_group', 'ad', 'metric', 'conversion')),
  -- provider-scoped identity; NEVER globally trusted — uniqueness is always
  -- (tenant, account, kind, ref, window)
  external_ref text not null check (length(external_ref) between 1 and 200),
  parent_ref text check (parent_ref is null or length(parent_ref) <= 200),
  name text check (name is null or length(name) <= 200),
  window_start date,
  window_end date,
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  spend numeric(14, 4) check (spend is null or spend >= 0),
  impressions bigint check (impressions is null or impressions >= 0),
  clicks bigint check (clicks is null or clicks >= 0),
  leads int check (leads is null or leads >= 0),
  conversions int check (conversions is null or conversions >= 0),
  payload jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  -- byte-level identity of the canonical value fields — identical re-records
  -- converge silently; a CHANGED value appends a new revision
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
  revision int not null check (revision >= 1),
  supersedes_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint mpf_window check (window_end is null or window_start is null
                               or window_end >= window_start),
  constraint mpf_spend_currency check (spend is null or currency is not null)
);
alter table marketing_provider_facts
  add constraint mpf_account_fk foreign key (tenant_id, account_id)
    references marketing_provider_accounts (tenant_id, id) on delete cascade,
  add constraint mpf_run_fk foreign key (tenant_id, run_id)
    references marketing_provider_sync_runs (tenant_id, id) on delete cascade,
  add constraint mpf_supersedes_fk foreign key (tenant_id, supersedes_id)
    references marketing_provider_facts (tenant_id, id);
-- one revision counter per natural key — deterministic latest, no clock races
create unique index marketing_provider_facts_revision_uq
  on marketing_provider_facts
     (tenant_id, account_id, fact_kind, external_ref,
      (coalesce(window_start, '0001-01-01'::date)), revision);
create index marketing_provider_facts_idx
  on marketing_provider_facts (tenant_id, account_id, fact_kind, created_at desc);
create trigger marketing_provider_facts_append_only_update
  before update on marketing_provider_facts
  for each row execute function marketing_history_append_only();
create trigger marketing_provider_facts_append_only_delete
  before delete on marketing_provider_facts
  for each row execute function marketing_history_append_only();
alter table marketing_provider_facts enable row level security;
create policy marketing_provider_facts_select on marketing_provider_facts
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_provider_facts to authenticated;
grant select, insert on marketing_provider_facts to service_role;
revoke update, delete, truncate on marketing_provider_facts
  from anon, authenticated, service_role;
revoke insert, update, delete, truncate on marketing_provider_facts
  from public, anon, authenticated;

-- ── PART C · LIFECYCLE REVISIONS ────────────────────────────────────────────

-- create: vocabulary now includes the test identity. The PUBLIC API layer
-- additionally refuses it unless the environment explicitly enables the test
-- provider — production keeps exactly the four real (unconnectable) choices.
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
     or v_provider not in ('meta', 'google_ads', 'linkedin', 'sheet',
                           'serviceos_test_provider') then
    raise exception 'provider must be one of meta/google_ads/linkedin/sheet (or the explicit test identity)'
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

-- connect: ADAPTER-AWARE. The caller layer asserts adapter_implemented only
-- when it genuinely holds an adapter for this provider (the Edge registry is
-- env-gated; real providers have none). true → the account enters
-- 'connecting' and a validation job is queued for the worker; the worker —
-- not the user-facing API — performs adapter validation and reports through
-- the Phase-9 seam. false/absent → the Phase-9 recorded-facts truth,
-- unchanged: error/'no_adapter'. Either way this function can NEVER produce
-- 'connected'.
create or replace function marketing_provider_account_connect_start(
  p_tenant uuid, p_actor uuid, p_account uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_request_id text;
  v_adapter boolean;
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
    if v_key not in ('request_id', 'expected_version', 'adapter_implemented') then
      raise exception 'unknown connect argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request_id := p_args ->> 'request_id';
  v_adapter := coalesce((p_args ->> 'adapter_implemented')::boolean, false);
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

  if v_adapter then
    -- adapter path: genuine validation happens in the worker. Queue it
    -- idempotently; the account stays honestly 'connecting' until the
    -- adapter's real outcome arrives through the seam.
    insert into platform_jobs
      (tenant_id, module_id, job_type, job_key, status, priority, max_attempts, payload)
    values
      (p_tenant, 'marketing.connections', 'marketing.provider_connect',
       'mkconn:' || p_account, 'queued', 100, 5,
       jsonb_build_object('account_id', p_account))
    on conflict (tenant_id, job_key)
      where job_key is not null and status in ('queued', 'running', 'retrying')
      do nothing;
    update marketing_provider_accounts
       set current_version_id = (
         select id from marketing_provider_account_versions
          where tenant_id = p_tenant and account_id = p_account
          order by version_number desc limit 1)
     where id = p_account;
    insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
    values (p_tenant, v_label, 'marketing.connections.connect_attempted',
            'marketing_provider_account', p_account::text, 'ok',
            jsonb_build_object('note', 'adapter validation queued'));
    perform marketing_event_append(p_tenant, 'marketing.connections.connect_attempted',
      'marketing_provider_account', p_account, 'marketing-provider-connections',
      jsonb_build_object('k', 'connect:' || v_row.version || ':' || p_account,
                         'actor', v_label, 'at', now()));
    v_result := jsonb_build_object('id', p_account, 'status', 'connecting',
                                   'version', v_row.version,
                                   'validation', 'queued',
                                   'adapter_implemented', true, 'replayed', false);
  else
    -- fact 2: the truthful no-adapter outcome (Phase-9 behaviour, unchanged)
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
  end if;

  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('provider_account_connect:' || v_request_id)::uuid, p_actor,
          'provider_account_connect', v_fp, v_result);
  return v_result;
end $$;

-- connect result: unchanged contract (service-role seam, evidence required)
-- PLUS: a verified result stores the bounded discovered-account list, and —
-- ONLY when the seam caller asks (queue_initial_sync=true, the worker's
-- post-validation step) — queues the initial sync exactly once. The default
-- is the exact Phase-9 behaviour: verify, store, queue nothing.
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
  v_accounts jsonb;
  v_entry jsonb;
  v_key text;
  v_queue boolean;
  v_version uuid := gen_random_uuid();
begin
  if p_tenant is null or p_account is null then
    raise exception 'tenant and account required' using errcode = '22023';
  end if;
  v_verified := (p_args ->> 'verified')::boolean;
  v_queue := coalesce((p_args ->> 'queue_initial_sync')::boolean, false);
  v_reason := left(coalesce(p_args ->> 'reason', ''), 120);
  v_adapter := p_args ->> 'adapter_version';
  v_evidence := p_args -> 'evidence';
  v_accounts := coalesce(p_args -> 'accounts', '[]'::jsonb);
  if v_verified is null then
    raise exception 'verified true/false is required' using errcode = '22023';
  end if;
  if v_verified and (v_evidence is null or v_evidence = '{}'::jsonb
                     or v_adapter is null) then
    raise exception 'a connected result requires adapter_version and non-empty verification evidence'
      using errcode = '22023';
  end if;
  -- discovered accounts: bounded, shape-checked, no secrets
  if jsonb_typeof(v_accounts) <> 'array' or jsonb_array_length(v_accounts) > 20 then
    raise exception 'discovered accounts must be an array of at most 20 entries'
      using errcode = '22023';
  end if;
  for v_entry in select * from jsonb_array_elements(v_accounts) loop
    if jsonb_typeof(v_entry) <> 'object' then
      raise exception 'each discovered account must be an object' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_entry) loop
      if v_key not in ('ref', 'name') then
        raise exception 'unknown discovered-account key %', v_key using errcode = '22023';
      end if;
    end loop;
    if coalesce(length(v_entry ->> 'ref'), 0) not between 1 and 120
       or coalesce(length(v_entry ->> 'name'), 0) not between 1 and 120 then
      raise exception 'discovered account ref/name must be 1..120 characters'
        using errcode = '22023';
    end if;
  end loop;
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
         discovered_accounts = case when v_verified then v_accounts
                                    else discovered_accounts end,
         version = version + 1
   where id = p_account
  returning * into v_row;
  insert into marketing_provider_account_versions
    (id, tenant_id, account_id, version_number, change_kind, config, changed_by)
  values (v_version, p_tenant, p_account, v_row.version, 'connect_result',
          marketing_provider_account_snapshot(v_row)
            || jsonb_build_object('evidence', coalesce(v_evidence, '{}'::jsonb),
                                  'discovered', jsonb_array_length(v_accounts)),
          null);
  update marketing_provider_accounts
     set current_version_id = v_version where id = p_account;

  if v_verified and v_queue then
    -- initial sync: queued exactly once (single-flight index) + drain job
    insert into marketing_provider_sync_runs (tenant_id, account_id, kind)
    values (p_tenant, p_account, 'initial')
    on conflict (tenant_id, account_id)
      where status in ('queued', 'running') do nothing;
    insert into platform_jobs
      (tenant_id, module_id, job_type, job_key, status, priority, max_attempts, payload)
    values
      (p_tenant, 'marketing.connections', 'marketing.provider_sync',
       'mkpsync:' || p_tenant, 'queued', 100, 5, '{}'::jsonb)
    on conflict (tenant_id, job_key)
      where job_key is not null and status in ('queued', 'running', 'retrying')
      do nothing;
  end if;
  return jsonb_build_object('id', p_account, 'status', v_row.status,
                            'status_reason', v_row.status_reason,
                            'version', v_row.version);
end $$;

-- external account selection — governed, versioned, and only from the
-- adapter-discovered list of a genuinely connected account.
create or replace function marketing_provider_account_external_select(
  p_tenant uuid, p_actor uuid, p_account uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_request_id text;
  v_ref text;
  v_name text;
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
    if v_key not in ('request_id', 'expected_version', 'external_ref') then
      raise exception 'unknown selection argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request_id := p_args ->> 'request_id';
  v_ref := p_args ->> 'external_ref';
  if v_ref is null or length(v_ref) not between 1 and 120 then
    raise exception 'external_ref must be 1..120 characters' using errcode = '22023';
  end if;
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'provider_external_select',
    'account', p_account, 'ref', v_ref,
    'expected_version', (p_args ->> 'expected_version')::int)::text,
    'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'provider_external_select',
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
  if v_row.status <> 'connected' then
    raise exception 'external account selection requires a genuinely connected account (current: %)',
      v_row.status using errcode = '22023';
  end if;
  select value ->> 'name' into v_name
    from jsonb_array_elements(v_row.discovered_accounts)
   where value ->> 'ref' = v_ref;
  if v_name is null then
    raise exception 'external_ref is not one of the adapter-discovered accounts'
      using errcode = '22023';
  end if;

  update marketing_provider_accounts
     set external_account_ref = v_ref, external_account_name = v_name,
         updated_by = p_actor, version = version + 1
   where id = p_account
  returning * into v_row;
  insert into marketing_provider_account_versions
    (id, tenant_id, account_id, version_number, change_kind, config, changed_by)
  values (v_version, p_tenant, p_account, v_row.version, 'external_select',
          marketing_provider_account_snapshot(v_row)
            || jsonb_build_object('external_ref', v_ref), p_actor);
  update marketing_provider_accounts
     set current_version_id = v_version where id = p_account;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.connections.external_selected',
          'marketing_provider_account', p_account::text, 'ok',
          jsonb_build_object('external_ref', v_ref));
  perform marketing_event_append(p_tenant, 'marketing.connections.external_selected',
    'marketing_provider_account', p_account, 'marketing-provider-connections',
    jsonb_build_object('k', 'extsel:' || v_version, 'actor', v_label, 'at', now()));

  v_result := jsonb_build_object('id', p_account, 'external_account_ref', v_ref,
                                 'external_account_name', v_name,
                                 'version', v_row.version, 'replayed', false);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('provider_external_select:' || v_request_id)::uuid, p_actor,
          'provider_external_select', v_fp, v_result);
  return v_result;
end $$;

-- revoke: unchanged contract PLUS queued work is blocked immediately — every
-- queued run of the account is retired to failed/'account_revoked'.
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
  -- queued work is blocked NOW — never left for a worker to trip over
  update marketing_provider_sync_runs
     set status = 'failed', error_class = 'account_revoked',
         finished_at = clock_timestamp()
   where tenant_id = p_tenant and account_id = p_account and status = 'queued';
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

-- manual sync: revised to ALSO prime the idempotent drain job — without it a
-- manually queued run had nothing to execute it until an unrelated trigger
-- fired (found by the served-HTTP journey; the request itself already
-- queued correctly). Contract otherwise unchanged.
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
  insert into platform_jobs
    (tenant_id, module_id, job_type, job_key, status, priority, max_attempts, payload)
  values
    (p_tenant, 'marketing.connections', 'marketing.provider_sync',
     'mkpsync:' || p_tenant, 'queued', 100, 5, '{}'::jsonb)
  on conflict (tenant_id, job_key)
    where job_key is not null and status in ('queued', 'running', 'retrying')
    do nothing;

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

-- claim/complete: revised ONLY to stamp real wall-clock lease/terminal times
-- (clock_timestamp — monotone even inside one transaction, so "the latest
-- terminal run" is total-ordered everywhere; transaction-frozen now() made
-- same-transaction terminal ordering ambiguous). Contract unchanged.
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
         finished_at = clock_timestamp()
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
         started_at = coalesce(r.started_at, clock_timestamp())
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
         finished_at = clock_timestamp()
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

-- ── PART D · CANONICAL FACT RECORDER — governed, digest-deduped, bounded ────

create or replace function marketing_provider_fact_record(
  p_tenant uuid, p_run uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_run marketing_provider_sync_runs%rowtype;
  v_facts jsonb;
  v_f jsonb;
  v_key text;
  v_kind text;
  v_ref text;
  v_ws date;
  v_we date;
  v_digest text;
  v_prev marketing_provider_facts%rowtype;
  v_inserted int := 0;
  v_converged int := 0;
  v_superseded int := 0;
begin
  if p_tenant is null or p_run is null then
    raise exception 'tenant and run required' using errcode = '22023';
  end if;
  v_facts := p_args -> 'facts';
  if v_facts is null or jsonb_typeof(v_facts) <> 'array' then
    raise exception 'facts array required' using errcode = '22023';
  end if;
  if jsonb_array_length(v_facts) > 500 then
    raise exception 'at most 500 facts per batch' using errcode = '22023';
  end if;
  select * into v_run from marketing_provider_sync_runs
   where id = p_run and tenant_id = p_tenant for update;
  if not found then
    raise exception 'sync run not found for tenant' using errcode = 'P0002';
  end if;
  if v_run.status <> 'running' then
    raise exception 'facts are recorded only by a RUNNING sync run (current: %)',
      v_run.status using errcode = '22023';
  end if;

  for v_f in select * from jsonb_array_elements(v_facts) loop
    if jsonb_typeof(v_f) <> 'object' then
      raise exception 'each fact must be an object' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_f) loop
      if v_key not in ('fact_kind', 'external_ref', 'parent_ref', 'name',
                       'window_start', 'window_end', 'currency', 'spend',
                       'impressions', 'clicks', 'leads', 'conversions',
                       'payload') then
        raise exception 'unknown fact key %', v_key using errcode = '22023';
      end if;
    end loop;
    v_kind := v_f ->> 'fact_kind';
    v_ref := v_f ->> 'external_ref';
    if v_kind is null
       or v_kind not in ('campaign', 'ad_group', 'ad', 'metric', 'conversion') then
      raise exception 'fact_kind must be campaign/ad_group/ad/metric/conversion'
        using errcode = '22023';
    end if;
    if v_ref is null or length(v_ref) not between 1 and 200 then
      raise exception 'external_ref must be 1..200 characters' using errcode = '22023';
    end if;
    v_ws := (v_f ->> 'window_start')::date;
    v_we := (v_f ->> 'window_end')::date;
    if v_kind in ('metric', 'conversion') then
      if v_ws is null or v_we is null then
        raise exception 'a % fact requires window_start and window_end', v_kind
          using errcode = '22023';
      end if;
      -- honest time bounds: nothing from the future, nothing beyond the
      -- accepted history horizon
      if v_we > current_date + 1 then
        raise exception 'fact window ends in the future (%)', v_we
          using errcode = '22023';
      end if;
      if v_ws < current_date - 400 then
        raise exception 'fact window predates the accepted 400-day horizon (%)', v_ws
          using errcode = '22023';
      end if;
    end if;

    v_digest := encode(extensions.digest(jsonb_build_object(
      'parent', v_f ->> 'parent_ref', 'name', v_f ->> 'name',
      'we', v_we, 'currency', v_f ->> 'currency',
      'spend', v_f ->> 'spend', 'impressions', v_f ->> 'impressions',
      'clicks', v_f ->> 'clicks', 'leads', v_f ->> 'leads',
      'conversions', v_f ->> 'conversions',
      'payload', coalesce(v_f -> 'payload', '{}'::jsonb))::text,
      'sha256'), 'hex');

    select f.* into v_prev from marketing_provider_facts f
     where f.tenant_id = p_tenant and f.account_id = v_run.account_id
       and f.fact_kind = v_kind and f.external_ref = v_ref
       and f.window_start is not distinct from v_ws
     order by f.revision desc limit 1;

    if found and v_prev.content_digest = v_digest then
      v_converged := v_converged + 1;  -- identical replay: no new row, ever
    else
      insert into marketing_provider_facts
        (tenant_id, account_id, run_id, fact_kind, external_ref, parent_ref,
         name, window_start, window_end, currency, spend, impressions, clicks,
         leads, conversions, payload, content_digest, revision, supersedes_id)
      values
        (p_tenant, v_run.account_id, p_run, v_kind, v_ref, v_f ->> 'parent_ref',
         v_f ->> 'name', v_ws, v_we, v_f ->> 'currency',
         (v_f ->> 'spend')::numeric, (v_f ->> 'impressions')::bigint,
         (v_f ->> 'clicks')::bigint, (v_f ->> 'leads')::int,
         (v_f ->> 'conversions')::int, coalesce(v_f -> 'payload', '{}'::jsonb),
         v_digest, coalesce(v_prev.revision, 0) + 1,
         case when v_prev.id is not null then v_prev.id end);
      if v_prev.id is not null then
        v_superseded := v_superseded + 1;
      else
        v_inserted := v_inserted + 1;
      end if;
    end if;
    v_prev := null;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'converged', v_converged,
                            'superseded', v_superseded);
end $$;

-- ── PART E · HONEST ACCOUNT REPORT — every number reconcilable to facts ─────

create or replace function marketing_provider_account_report(
  p_tenant uuid, p_account uuid
) returns jsonb
language plpgsql
stable
as $$
declare
  v_row marketing_provider_accounts%rowtype;
  v_last marketing_provider_sync_runs%rowtype;
  v_currencies text[];
  v_spend numeric;
  v_leads bigint;
  v_has_lead_fact boolean;
  v_has_spend_fact boolean;
  v_campaigns jsonb;
  v_metrics jsonb;
  v_cpl numeric;
  v_cpl_reason text;
  v_spend_reason text;
  v_health text;
  v_feed_count int;
begin
  select * into v_row from marketing_provider_accounts
   where id = p_account and tenant_id = p_tenant;
  if not found then
    raise exception 'provider connection not found for tenant' using errcode = 'P0002';
  end if;
  select r.* into v_last from marketing_provider_sync_runs r
   where r.tenant_id = p_tenant and r.account_id = p_account
     and r.status in ('succeeded', 'failed')
   order by r.finished_at desc nulls last, r.created_at desc, r.id desc limit 1;

  -- LATEST facts only (max revision per natural key, never superseded rows)
  with latest as (
    select f.* from marketing_provider_facts f
     where f.tenant_id = p_tenant and f.account_id = p_account
       and not exists (select 1 from marketing_provider_facts n
                        where n.tenant_id = f.tenant_id and n.supersedes_id = f.id)
  )
  select
    coalesce(array_agg(distinct currency) filter
      (where fact_kind = 'metric' and spend is not null), array[]::text[]),
    sum(spend) filter (where fact_kind = 'metric'),
    sum(leads) filter (where fact_kind = 'metric'),
    bool_or(fact_kind = 'metric' and leads is not null),
    bool_or(fact_kind = 'metric' and spend is not null),
    count(*) filter (where fact_kind = 'campaign')
  into v_currencies, v_spend, v_leads, v_has_lead_fact, v_has_spend_fact,
       v_feed_count
  from latest;

  if not coalesce(v_has_spend_fact, false) then
    v_spend := null; v_spend_reason := 'no_spend_facts';
  elsif coalesce(array_length(v_currencies, 1), 0) > 1 then
    -- mixed currencies are NEVER added; per-currency truth stays available
    v_spend := null; v_spend_reason := 'mixed_currencies';
  end if;

  if v_spend is null then
    v_cpl := null; v_cpl_reason := coalesce(v_spend_reason, 'no_spend_facts');
  elsif not coalesce(v_has_lead_fact, false) then
    v_cpl := null; v_cpl_reason := 'no_lead_facts';
  elsif coalesce(v_leads, 0) = 0 then
    v_cpl := null; v_cpl_reason := 'zero_leads';
  else
    v_cpl := round(v_spend / v_leads, 2);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'external_ref', f.external_ref, 'name', f.name,
           'parent_ref', f.parent_ref, 'revision', f.revision)
           order by f.external_ref), '[]'::jsonb)
    into v_campaigns
    from marketing_provider_facts f
   where f.tenant_id = p_tenant and f.account_id = p_account
     and f.fact_kind = 'campaign'
     and not exists (select 1 from marketing_provider_facts n
                      where n.tenant_id = f.tenant_id and n.supersedes_id = f.id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'external_ref', f.external_ref, 'window_start', f.window_start,
           'window_end', f.window_end, 'currency', f.currency,
           'spend', f.spend, 'impressions', f.impressions, 'clicks', f.clicks,
           'leads', f.leads, 'conversions', f.conversions,
           'revision', f.revision)
           order by f.window_start, f.external_ref), '[]'::jsonb)
    into v_metrics
    from marketing_provider_facts f
   where f.tenant_id = p_tenant and f.account_id = p_account
     and f.fact_kind = 'metric'
     and not exists (select 1 from marketing_provider_facts n
                      where n.tenant_id = f.tenant_id and n.supersedes_id = f.id);

  -- health: computed, never stored. degraded = the feed is genuinely usable
  -- but the latest terminal run failed on a partial class (metrics).
  v_health := case
    when v_row.status = 'revoked' then 'revoked'
    when v_row.status <> 'connected' then v_row.status
    when v_last.status = 'failed' and v_last.error_class = 'metrics_unavailable'
         and coalesce(v_feed_count, 0) > 0 then 'degraded'
    when v_last.status = 'failed' then 'error'
    when v_last.id is null then 'never_run'
    else 'healthy' end;

  return jsonb_build_object(
    'account_id', p_account,
    'health', v_health,
    'totals', jsonb_build_object(
      'spend', v_spend,
      'spend_unavailable_reason', v_spend_reason,
      'currencies', to_jsonb(coalesce(v_currencies, array[]::text[])),
      'leads', case when coalesce(v_has_lead_fact, false) then v_leads end,
      'leads_unavailable_reason',
        case when not coalesce(v_has_lead_fact, false) then 'no_lead_facts' end),
    'cpl', jsonb_build_object('value', v_cpl, 'unavailable_reason', v_cpl_reason),
    'campaigns', v_campaigns,
    'metrics', v_metrics,
    'metrics_status', case
      when v_last.status = 'failed' and v_last.error_class = 'metrics_unavailable'
        then jsonb_build_object('state', 'unavailable',
                                'reason', 'metrics_unavailable')
      when v_metrics = '[]'::jsonb
        then jsonb_build_object('state', 'unavailable', 'reason', 'no_metric_facts')
      else jsonb_build_object('state', 'available') end,
    'latest_run', case when v_last.id is null then null else jsonb_build_object(
      'id', v_last.id, 'kind', v_last.kind, 'status', v_last.status,
      'attempts', v_last.attempts, 'error_class', v_last.error_class,
      'finished_at', v_last.finished_at) end);
end $$;

-- connection list: extended to project the Phase-10 columns (selection +
-- bounded discovery — names and refs only, never a credential). Freshness
-- semantics unchanged.
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
    'external_account_ref', a.external_account_ref,
    'external_account_name', a.external_account_name,
    'discovered_accounts', a.discovered_accounts,
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
    -- deterministic latest run: real wall-clock terminal time, then identity
    select * from marketing_provider_sync_runs r
     where r.tenant_id = a.tenant_id and r.account_id = a.id
     order by r.finished_at desc nulls first, r.created_at desc, r.id desc limit 1
  ) lr on true
  where a.tenant_id = p_tenant;
  return jsonb_build_object('accounts', v_accounts);
end $$;

-- ── PART F · SCHEDULED-ENQUEUE SEAM — idempotent, still nothing polls ───────

-- A future installed scheduler calls this per tenant. Two overlapping
-- invocations can never double-queue (single-flight index + ON CONFLICT);
-- revoked/disconnected accounts are structurally excluded by _sync_due.
-- NO cron is registered in this build.
create or replace function marketing_provider_sync_enqueue_due(p_tenant uuid)
returns jsonb
language plpgsql
as $$
declare
  v_due record;
  v_queued int := 0;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  for v_due in select * from marketing_provider_sync_due(p_tenant) loop
    insert into marketing_provider_sync_runs (tenant_id, account_id, kind)
    values (p_tenant, v_due.account_id, 'scheduled')
    on conflict (tenant_id, account_id)
      where status in ('queued', 'running') do nothing;
    if found then
      v_queued := v_queued + 1;
    end if;
  end loop;
  if v_queued > 0 then
    insert into platform_jobs
      (tenant_id, module_id, job_type, job_key, status, priority, max_attempts, payload)
    values
      (p_tenant, 'marketing.connections', 'marketing.provider_sync',
       'mkpsync:' || p_tenant, 'queued', 100, 5, '{}'::jsonb)
    on conflict (tenant_id, job_key)
      where job_key is not null and status in ('queued', 'running', 'retrying')
      do nothing;
  end if;
  return jsonb_build_object('queued', v_queued);
end $$;

-- ── PART G · FUNCTION PRIVILEGES — service_role only, INVOKER ───────────────

do $$
declare fn text;
begin
  foreach fn in array array[
    'marketing_provider_account_external_select(uuid, uuid, uuid, jsonb)',
    'marketing_provider_fact_record(uuid, uuid, jsonb)',
    'marketing_provider_account_report(uuid, uuid)',
    'marketing_provider_sync_enqueue_due(uuid)'
  ] loop
    execute 'revoke all on function public.' || fn || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || fn || ' to service_role';
  end loop;
end $$;
