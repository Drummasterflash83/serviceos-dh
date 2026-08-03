-- ============================================================================
-- Marketing — GOVERNED VERIFIED-DOMAIN Resend senders (additive)
-- ----------------------------------------------------------------------------
-- Until now the only permitted Resend identity was the resend.dev SANDBOX
-- address, because a tenant admin must never be able to self-assert an
-- arbitrary sending identity on the shared platform Resend key. That restriction
-- stays exactly as it is. This migration adds the ONE safe way past it:
--
--   a PLATFORM-GOVERNED authority record, granted by an OpenFolk operator, that
--   names the EXACT tenant, the EXACT normalised sender address, its domain and
--   the transport — and nothing wider.
--
-- SECURITY MODEL
--   * DEFAULT DENY. A resend sender that is neither the sandbox address nor an
--     exactly-matching ACTIVE authority is `unavailable`. There is no
--     tenant-wide, domain-wide or global wildcard: matching is exact string
--     equality on (tenant_id, transport, sender_address).
--   * The grant/revoke seam is SERVICE-ROLE ONLY *and* requires the acting
--     profile to hold an ACTIVE `platform.controlplane.admin` grant in the
--     existing effective-dated platform_authority_grants ledger. A tenant
--     owner/admin — including the tenant's own admin — cannot approve their own
--     production sender.
--   * Caller-supplied verification/readiness/provider flags do not exist: the
--     grant RPC accepts an exact allowlist of arguments and derives state
--     itself. `verified_at` is server time, never a caller value.
--   * Addresses are NORMALISED and validated to printable ASCII before storage
--     and before every lookup, so case, whitespace, control-character and
--     Unicode/homoglyph variants cannot reach a different row than they appear
--     to. Subdomain and lookalike domains simply do not match — there is no
--     suffix logic anywhere.
--   * Cross-tenant use is structurally impossible: every read and write is
--     keyed by tenant_id, and the sandbox address may never hold an authority.
--   * REVOCATION is immediate: readiness derives from the authority, and
--     capability truth is re-synchronised in the same transaction.
--   * The Resend API key is never referenced here. Nothing in this migration
--     stores, logs or returns any credential.
--
-- The sandbox sender and every restriction proven for it (test-to-self only,
-- campaigns and sequences refused, unverified state) are untouched.
-- ============================================================================

-- ── 1 · strict address normalisation (the anti-lookalike boundary) ──────────
-- Returns the canonical form, or NULL if the input could not be trusted to mean
-- exactly one address. Deliberately conservative: printable ASCII only.
create or replace function marketing_normalise_email(p_raw text)
returns text
language plpgsql
immutable
as $$
declare v text;
begin
  if p_raw is null then return null; end if;
  v := lower(btrim(p_raw));
  if v = '' or length(v) > 320 then return null; end if;
  -- printable ASCII only: rejects control characters, embedded whitespace and
  -- every non-ASCII homoglyph (Cyrillic 'о', full-width characters, RTL marks…)
  if v ~ '[^\x21-\x7E]' then return null; end if;
  -- exactly one @, a plausible local part, and a dotted ASCII domain
  if v !~ '^[a-z0-9!#$%&''*+/=?^_`{|}~.-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  then
    return null;
  end if;
  return v;
end $$;

-- ── 2 · the platform-governed authority record ─────────────────────────────
create table if not exists marketing_sender_authorities (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id) on delete cascade,
  transport      text not null check (transport in ('resend')),
  sender_address text not null,
  domain         text not null,
  -- optional pinned presentation the operator approved alongside the identity
  from_name      text check (from_name is null or length(from_name) <= 120),
  reply_to       text check (reply_to is null or length(reply_to) <= 320),
  state          text not null default 'verified' check (state in ('verified', 'revoked')),
  verified_at    timestamptz not null,
  revoked_at     timestamptz,
  revoke_reason  text check (revoke_reason is null or length(revoke_reason) <= 300),
  granted_by     text not null,
  reason         text check (reason is null or length(reason) <= 300),
  request_id     text not null check (request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- the stored address is already normalised …
  constraint msa_address_normalised
    check (sender_address = lower(sender_address) and sender_address !~ '[^\x21-\x7E]'),
  -- … and its domain is exactly the address's own domain, never a parent
  constraint msa_domain_is_the_address_domain
    check (domain = split_part(sender_address, '@', 2)),
  -- the sandbox identity is governed by its own rules and can never be granted
  constraint msa_never_the_sandbox
    check (sender_address <> 'onboarding@resend.dev'),
  constraint msa_revocation_shape
    check ((state = 'revoked') = (revoked_at is not null)),
  -- ONE authority per exact (tenant, transport, address). No wildcards exist.
  unique (tenant_id, transport, sender_address)
);
create index if not exists msa_tenant_idx on marketing_sender_authorities (tenant_id);

drop trigger if exists msa_set_updated_at on marketing_sender_authorities;
create trigger msa_set_updated_at before update on marketing_sender_authorities
  for each row execute function set_updated_at();

-- identity is immutable: an authority is granted or revoked, never re-pointed
create or replace function marketing_sender_authority_guard()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.transport is distinct from old.transport
     or new.sender_address is distinct from old.sender_address
     or new.domain is distinct from old.domain
     or new.verified_at is distinct from old.verified_at
     or new.created_at is distinct from old.created_at then
    raise exception 'a sender authority identity is immutable — revoke it and grant a new one'
      using errcode = 'restrict_violation';
  end if;
  if old.state = 'revoked' and new.state <> 'revoked' then
    raise exception 'a revoked sender authority can never be reinstated — grant a new one'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;
drop trigger if exists msa_guard on marketing_sender_authorities;
create trigger msa_guard before update on marketing_sender_authorities
  for each row execute function marketing_sender_authority_guard();

alter table marketing_sender_authorities enable row level security;
-- no browser policy: this is platform-operator territory, read through the
-- governed sender surfaces only.
revoke all on marketing_sender_authorities from anon, authenticated;
grant select, insert, update on marketing_sender_authorities to service_role;

-- ── 3 · platform-operator gate (uses the EXISTING authority ledger) ────────
-- Raises unless p_actor holds an ACTIVE platform.controlplane.admin grant. This
-- is deliberately NOT a tenant permission: no tenant role, grant or marketing
-- permission can satisfy it.
create or replace function marketing_require_platform_operator(p_actor uuid)
returns text
language plpgsql
stable
as $$
declare v_label text;
begin
  if p_actor is null then
    raise exception 'a platform operator actor is required' using errcode = '42501';
  end if;
  select coalesce(p.email, p.id::text) into v_label
    from profiles p
    join platform_authority_grants g on g.profile_id = p.id
   where p.id = p_actor
     and g.permission = 'platform.controlplane.admin'
     and coalesce(g.effective_from, '-infinity'::timestamptz) <= now()
     and coalesce(g.effective_to, 'infinity'::timestamptz) > now()
   limit 1;
  if v_label is null then
    raise exception 'actor does not hold an active platform.controlplane.admin grant'
      using errcode = '42501';
  end if;
  return v_label;
end $$;

-- ── 4 · the ONE canonical authority lookup (exact, tenant-keyed) ───────────
-- 'verified' | 'revoked' | 'none'. Every surface derives from this; nothing
-- re-implements matching.
create or replace function marketing_sender_authority_state(
  p_tenant uuid, p_transport text, p_address text)
returns text
language plpgsql
stable
as $$
declare v_addr text; v_state text;
begin
  if p_tenant is null or p_transport is null then return 'none'; end if;
  v_addr := marketing_normalise_email(p_address);
  if v_addr is null then return 'none'; end if;          -- untrustworthy input
  select a.state into v_state from marketing_sender_authorities a
   where a.tenant_id = p_tenant
     and a.transport = p_transport
     and a.sender_address = v_addr;                       -- EXACT equality only
  return coalesce(v_state, 'none');
end $$;

-- ── 5 · operator-only activation (idempotent, concurrency-safe, audited) ───
create or replace function marketing_sender_authority_grant(p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_operator text;
  v_key text;
  v_tenant uuid;
  v_addr text;
  v_domain text;
  v_from_name text;
  v_reply_to text;
  v_request text;
  v_row marketing_sender_authorities%rowtype;
begin
  v_operator := marketing_require_platform_operator(p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  -- EXACT allowlist: there is no `verified`, `ready`, `state` or provider flag a
  -- caller could assert. Every such value is derived here.
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('tenant_id', 'transport', 'sender_address', 'domain',
                     'from_name', 'reply_to', 'reason', 'request_id') then
      raise exception 'unknown grant argument %', v_key using errcode = '22023';
    end if;
  end loop;

  v_tenant := nullif(p_args ->> 'tenant_id', '')::uuid;
  if v_tenant is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;
  if not exists (select 1 from tenants t where t.id = v_tenant) then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;
  if coalesce(p_args ->> 'transport', 'resend') <> 'resend' then
    raise exception 'unsupported transport' using errcode = '22023';
  end if;

  v_addr := marketing_normalise_email(p_args ->> 'sender_address');
  if v_addr is null then
    raise exception 'sender_address is not a normalisable ASCII email address'
      using errcode = '22023';
  end if;
  if v_addr = 'onboarding@resend.dev' then
    raise exception 'the resend.dev sandbox identity is governed separately and can never be granted'
      using errcode = '22023';
  end if;
  -- the operator must name the domain, and it must be the address's OWN domain
  v_domain := lower(btrim(coalesce(p_args ->> 'domain', '')));
  if v_domain = '' then
    raise exception 'domain is required' using errcode = '22023';
  end if;
  if v_domain <> split_part(v_addr, '@', 2) then
    raise exception 'domain % is not the domain of %', v_domain, v_addr using errcode = '22023';
  end if;

  v_from_name := marketing_sender_text_guard('from_name', p_args ->> 'from_name');
  v_reply_to := marketing_normalise_email(p_args ->> 'reply_to');
  if (p_args ? 'reply_to') and (p_args ->> 'reply_to') is not null and v_reply_to is null then
    raise exception 'reply_to is not a normalisable ASCII email address' using errcode = '22023';
  end if;
  v_request := p_args ->> 'request_id';
  if v_request is null or v_request !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'request_id is required' using errcode = '22023';
  end if;

  -- concurrency: two simultaneous grants for the same identity converge
  perform pg_advisory_xact_lock(hashtextextended(
    v_tenant::text || '|sender_authority|resend|' || v_addr, 42));

  select * into v_row from marketing_sender_authorities
   where tenant_id = v_tenant and transport = 'resend' and sender_address = v_addr;

  if v_row.id is not null then
    -- idempotent replay. A REVOKED authority is never silently reinstated.
    if v_row.state = 'revoked' then
      raise exception 'this identity was revoked — its history is preserved; grant a new authority only after re-verifying the domain'
        using errcode = '22023';
    end if;
    return jsonb_build_object('id', v_row.id, 'created', false, 'state', v_row.state,
      'tenant_id', v_row.tenant_id, 'sender_address', v_row.sender_address,
      'domain', v_row.domain, 'verified_at', v_row.verified_at);
  end if;

  insert into marketing_sender_authorities
    (tenant_id, transport, sender_address, domain, from_name, reply_to,
     state, verified_at, granted_by, reason, request_id)
  values
    (v_tenant, 'resend', v_addr, v_domain, v_from_name, v_reply_to,
     'verified', now(), v_operator,                        -- server time only
     marketing_sender_text_guard('reason', p_args ->> 'reason'), v_request)
  returning * into v_row;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (v_tenant, v_operator, 'marketing.sender_authority.granted', 'marketing_sender_authority',
          v_row.id::text, 'ok',
          jsonb_build_object('transport', 'resend', 'sender_address', v_addr,
                             'domain', v_domain, 'request_id', v_request,
                             'granted_by', v_operator));
  perform marketing_event_append(v_tenant, 'marketing.sender_authority.granted',
    'marketing_sender_authority', v_row.id, 'platform-operator',
    jsonb_build_object('k', 'granted:' || v_row.id, 'op', 'granted',
                       'actor', v_operator, 'at', now()));
  -- readiness of any already-created sender for this identity changes now
  perform marketing_sender_capability_sync(v_tenant);

  return jsonb_build_object('id', v_row.id, 'created', true, 'state', v_row.state,
    'tenant_id', v_row.tenant_id, 'sender_address', v_row.sender_address,
    'domain', v_row.domain, 'verified_at', v_row.verified_at);
end $$;

-- ── 6 · operator-only revocation (immediate, audited, capability-syncing) ──
create or replace function marketing_sender_authority_revoke(p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_operator text;
  v_key text;
  v_tenant uuid;
  v_addr text;
  v_row marketing_sender_authorities%rowtype;
begin
  v_operator := marketing_require_platform_operator(p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('tenant_id', 'transport', 'sender_address', 'reason') then
      raise exception 'unknown revoke argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_tenant := nullif(p_args ->> 'tenant_id', '')::uuid;
  v_addr := marketing_normalise_email(p_args ->> 'sender_address');
  if v_tenant is null or v_addr is null then
    raise exception 'tenant_id and a normalisable sender_address are required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_tenant::text || '|sender_authority|resend|' || v_addr, 42));

  select * into v_row from marketing_sender_authorities
   where tenant_id = v_tenant and transport = 'resend' and sender_address = v_addr;
  if v_row.id is null then
    raise exception 'no sender authority for this tenant and address' using errcode = 'P0002';
  end if;
  if v_row.state = 'revoked' then
    -- idempotent
    return jsonb_build_object('id', v_row.id, 'revoked', false, 'state', 'revoked',
      'revoked_at', v_row.revoked_at);
  end if;

  update marketing_sender_authorities
     set state = 'revoked', revoked_at = now(),
         revoke_reason = marketing_sender_text_guard('reason', p_args ->> 'reason')
   where id = v_row.id
  returning * into v_row;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (v_tenant, v_operator, 'marketing.sender_authority.revoked', 'marketing_sender_authority',
          v_row.id::text, 'ok',
          jsonb_build_object('transport', 'resend', 'sender_address', v_addr,
                             'domain', v_row.domain, 'revoked_by', v_operator));
  perform marketing_event_append(v_tenant, 'marketing.sender_authority.revoked',
    'marketing_sender_authority', v_row.id, 'platform-operator',
    jsonb_build_object('k', 'revoked:' || v_row.id, 'op', 'revoked',
                       'actor', v_operator, 'at', now()));
  -- IMMEDIATE: readiness derives from the authority, so capability truth flips
  -- in this same transaction.
  perform marketing_sender_capability_sync(v_tenant);

  return jsonb_build_object('id', v_row.id, 'revoked', true, 'state', 'revoked',
    'revoked_at', v_row.revoked_at);
end $$;

-- ── 7 · readiness now distinguishes the four honest Resend states ──────────
-- sandbox_ready | ready (production verified) | revoked | unavailable
create or replace function marketing_sender_readiness(p_tenant uuid, p_sender uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_p marketing_sender_profiles%rowtype;
  v_acc email_accounts%rowtype;
  v_scope text;
  v_has_token boolean;
  v_mbx google_workspace_mailboxes%rowtype;
  v_conn google_workspace_connections%rowtype;
  v_state text;
  v_auth text;
begin
  if p_tenant is null or p_sender is null then
    raise exception 'tenant and sender required' using errcode = '22023';
  end if;
  select * into v_p from marketing_sender_profiles
   where id = p_sender and tenant_id = p_tenant;
  if not found then
    raise exception 'sender not found for tenant' using errcode = 'P0002';
  end if;

  if v_p.source_kind = 'resend' then
    if v_p.mailbox_address = 'onboarding@resend.dev' then
      v_state := 'sandbox_ready';
    else
      -- DEFAULT DENY: only an exactly-matching ACTIVE authority is usable
      v_auth := marketing_sender_authority_state(p_tenant, 'resend', v_p.mailbox_address);
      v_state := case v_auth
                   when 'verified' then 'ready'
                   when 'revoked'  then 'revoked'
                   else 'unavailable'
                 end;
    end if;
  elsif v_p.source_kind = 'gmail_oauth' then
    if v_p.email_account_id is null then
      v_state := 'source_disconnected';
    else
      select * into v_acc from email_accounts
       where id = v_p.email_account_id and tenant_id = p_tenant and provider = 'gmail';
      if not found then
        v_state := 'source_disconnected';
      elsif lower(coalesce(v_acc.email_address, '')) <> v_p.mailbox_address then
        v_state := 'source_changed';
      elsif v_acc.status <> 'active' then
        v_state := 'source_inactive';
      elsif v_acc.auth_state is distinct from 'ok' then
        v_state := 'auth_invalid';
      else
        select t.access_token is not null, t.scope
          into v_has_token, v_scope
          from email_oauth_tokens t
         where t.email_account_id = v_acc.id and t.tenant_id = p_tenant;
        if not found or not coalesce(v_has_token, false) then
          v_state := 'token_missing';
        elsif not marketing_scope_has(v_scope,
                    'https://www.googleapis.com/auth/gmail.send') then
          v_state := 'send_scope_missing';
        else
          v_state := 'ready';
        end if;
      end if;
    end if;
  else
    if v_p.workspace_mailbox_id is null then
      v_state := 'source_disconnected';
    else
      select * into v_mbx from google_workspace_mailboxes
       where id = v_p.workspace_mailbox_id and tenant_id = p_tenant;
      if not found then
        v_state := 'source_disconnected';
      elsif lower(coalesce(v_mbx.email_address, '')) <> v_p.mailbox_address then
        v_state := 'source_changed';
      elsif v_mbx.status <> 'active' then
        v_state := 'source_inactive';
      else
        select * into v_conn from google_workspace_connections
         where id = v_mbx.connection_id and tenant_id = p_tenant;
        if not found or v_conn.status <> 'active' then
          v_state := 'connection_inactive';
        elsif v_p.send_scope_state <> 'authorized' then
          v_state := 'send_scope_unverified';
        else
          v_state := 'ready';
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'sender_id', v_p.id,
    'ready', v_state in ('ready', 'sandbox_ready'),
    'sandbox', v_state = 'sandbox_ready',
    'state', v_state,
    'enabled', v_p.enabled,
    'test_to_self_only', v_state = 'sandbox_ready',
    -- only a genuinely production-ready sender may carry bulk work
    'campaigns_blocked', v_state <> 'ready',
    'sequences_blocked', v_state <> 'ready',
    -- true once a real provider submission has been proven for this class
    'provider_submission_verified', v_state = 'ready',
    'authority_state', case when v_p.source_kind = 'resend'
                              and v_p.mailbox_address <> 'onboarding@resend.dev'
                            then coalesce(v_auth, 'none') else null end,
    'transport', case when v_p.source_kind = 'resend' then 'resend' else 'gmail' end);
end $$;

-- ── 8 · sender creation: sandbox OR an exactly-authorised identity ─────────
create or replace function marketing_sender_create_resend(p_tenant uuid, p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_actor_label text;
  v_key text;
  v_addr text;
  v_from_name text;
  v_reply_to text;
  v_sandbox boolean;
  v_auth marketing_sender_authorities%rowtype;
  v_existing marketing_sender_profiles%rowtype;
  v_row marketing_sender_profiles%rowtype;
  v_note text;
  v_scope text;
  v_verified timestamptz;
begin
  v_actor_label := marketing_require_senders_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('from_address', 'label', 'from_name', 'reply_to', 'signature_text') then
      raise exception 'unknown create argument %', v_key using errcode = '22023';
    end if;
  end loop;

  -- normalise FIRST: case/whitespace/Unicode variants can never reach a
  -- different authority row than the one they appear to name
  v_addr := marketing_normalise_email(p_args ->> 'from_address');
  if v_addr is null then
    raise exception 'from_address is not a normalisable ASCII email address' using errcode = '22023';
  end if;
  v_sandbox := v_addr = 'onboarding@resend.dev';

  if not v_sandbox then
    -- DEFAULT DENY: a platform-granted, ACTIVE, exactly-matching authority or
    -- nothing. A tenant admin cannot self-assert an identity.
    select * into v_auth from marketing_sender_authorities
     where tenant_id = p_tenant and transport = 'resend' and sender_address = v_addr;
    if v_auth.id is null then
      raise exception 'no platform sender authority exists for % in this tenant — only the resend.dev sandbox sender is permitted until an operator verifies the domain', v_addr
        using errcode = '42501';
    end if;
    if v_auth.state <> 'verified' then
      raise exception 'the sender authority for % is %', v_addr, v_auth.state
        using errcode = '42501';
    end if;
  end if;

  if (p_args ? 'label') and jsonb_typeof(p_args -> 'label') <> 'string'
     or (p_args ? 'from_name') and jsonb_typeof(p_args -> 'from_name') <> 'string'
     or (p_args ? 'reply_to') and jsonb_typeof(p_args -> 'reply_to') <> 'string'
     or (p_args ? 'signature_text') and jsonb_typeof(p_args -> 'signature_text') <> 'string' then
    raise exception 'invalid create argument types' using errcode = '22023';
  end if;
  v_from_name := coalesce(marketing_sender_text_guard('from_name', p_args ->> 'from_name'),
                          v_auth.from_name);
  v_reply_to := marketing_sender_text_guard('reply_to', p_args ->> 'reply_to');
  if v_reply_to is null then v_reply_to := v_auth.reply_to; end if;
  if v_reply_to is not null
     and v_reply_to !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'reply_to must be a plausible email address' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|sender|resend|' || v_addr, 42));

  select * into v_existing from marketing_sender_profiles
   where tenant_id = p_tenant and source_kind = 'resend' and mailbox_address = v_addr;
  if v_existing.id is not null then
    perform marketing_sender_capability_sync(p_tenant);
    return jsonb_build_object('id', v_existing.id, 'created', false,
      'mailbox_address', v_existing.mailbox_address,
      'send_scope_state', v_existing.send_scope_state,
      'enabled', v_existing.enabled, 'sandbox', v_sandbox,
      'mode', case when v_sandbox then 'sandbox_test' else 'production_verified' end,
      'test_to_self_only', v_sandbox,
      'provider_submission_verified', not v_sandbox,
      'updated_at', v_existing.updated_at);
  end if;

  if v_sandbox then
    v_note := 'Resend sandbox (onboarding@resend.dev) — test-to-self only. Never verified against Resend; real provider submission NOT RUN. Campaigns and sequences are refused.';
    v_scope := 'unknown';                       -- a from-address is not authorisation
    v_verified := null;
  else
    v_note := 'Resend production sender on the platform-verified domain ' || v_auth.domain ||
              ' — authorised by OpenFolk operator ' || v_auth.granted_by || '.';
    v_scope := 'authorized';                    -- backed by the platform authority
    v_verified := v_auth.verified_at;
  end if;

  insert into marketing_sender_profiles
    (tenant_id, source_kind, email_account_id, workspace_mailbox_id, mailbox_address,
     label, from_name, reply_to, signature_text,
     enabled, send_scope_state, scope_checked_at, last_verified_at,
     verification_note, created_by, updated_by)
  values
    (p_tenant, 'resend', null, null, v_addr,
     left(coalesce(marketing_sender_text_guard('label', p_args ->> 'label'),
                   case when v_sandbox then 'Resend sandbox (test only)' else v_addr end), 80),
     v_from_name, v_reply_to,
     marketing_sender_text_guard('signature_text', p_args ->> 'signature_text', true),
     true, v_scope, now(), v_verified, v_note, p_actor, p_actor)
  returning * into v_row;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_actor_label, 'marketing.sender.created', 'marketing_sender',
          v_row.id::text, 'ok',
          jsonb_build_object('source_kind', 'resend', 'mailbox', v_addr,
                             'mode', case when v_sandbox then 'sandbox_test' else 'production_verified' end,
                             'authority_id', v_auth.id));
  perform marketing_event_append(p_tenant, 'marketing.sender.updated', 'marketing_sender',
    v_row.id, 'marketing-senders',
    jsonb_build_object('k', 'created:' || v_row.id, 'op', 'created',
                       'actor', v_actor_label, 'at', now()));

  perform marketing_sender_capability_sync(p_tenant);

  return jsonb_build_object('id', v_row.id, 'created', true,
    'mailbox_address', v_row.mailbox_address,
    'send_scope_state', v_row.send_scope_state,
    'enabled', v_row.enabled, 'sandbox', v_sandbox,
    'mode', case when v_sandbox then 'sandbox_test' else 'production_verified' end,
    'test_to_self_only', v_sandbox,
    'provider_submission_verified', not v_sandbox,
    'updated_at', v_row.updated_at);
end $$;

-- ── 9 · grants: every new RPC is SERVICE-ROLE ONLY ────────────────────────
do $$
declare sig text;
begin
  foreach sig in array array[
    'marketing_normalise_email(text)',
    'marketing_require_platform_operator(uuid)',
    'marketing_sender_authority_state(uuid, text, text)',
    'marketing_sender_authority_grant(uuid, jsonb)',
    'marketing_sender_authority_revoke(uuid, jsonb)',
    'marketing_sender_readiness(uuid, uuid)',
    'marketing_sender_create_resend(uuid, uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated;', sig);
    execute format('grant execute on function %s to service_role;', sig);
  end loop;
end $$;
