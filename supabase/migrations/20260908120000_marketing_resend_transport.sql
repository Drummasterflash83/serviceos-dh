-- ============================================================================
-- Marketing — Resend transport sender source (ACTIVATION, additive)
-- ----------------------------------------------------------------------------
-- The Phase-4/5/6 sender→delivery→broadcast→sequence machinery is fully built
-- and provider-agnostic up to the ONE adapter transport call. Until now the
-- only sender source kinds were Gmail-OAuth and Workspace-DWD, both of which
-- require a connected Google mailbox. This migration adds a THIRD source kind,
-- `resend`, so a tenant can authorise a verified from-address backed by the
-- platform Resend API and drive the EXISTING test-send / campaign / sequence
-- flows unchanged — the adapter picks the Resend transport for `resend`
-- senders. No new send pipeline, no new governance path: this only teaches the
-- sender profile + its live readiness derivation + a create RPC about a source
-- whose readiness is intrinsic (a configured from-address) rather than a
-- Google mailbox attachment. The immutable sender guard, delivery guard,
-- append-only events ledger, request-fingerprint idempotency and the frozen
-- envelope are all untouched.
--
-- Rollback: disable the resend sender(s) and revert the Edge deployment; the
-- additive column/constraint/RPC are inert without a resend sender.
-- ============================================================================

-- ── 1 · widen the sender source vocabulary (additive) ──────────────────────
-- The original CHECK is an inline, system-named constraint. Drop it by
-- discovery (never by a guessed name) and re-add a named superset. The
-- msp_source_kind_shape constraint already tolerates `resend` (both source FKs
-- are null for a resend sender), so it is left unchanged.
do $$
declare
  v_name text;
begin
  select con.conname into v_name
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
   where c.relname = 'marketing_sender_profiles'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%source_kind%'
     and pg_get_constraintdef(con.oid) ilike '%gmail_oauth%'
     and pg_get_constraintdef(con.oid) not ilike '%email_account_id%'
   limit 1;
  if v_name is not null then
    execute format('alter table marketing_sender_profiles drop constraint %I', v_name);
  end if;
end $$;

alter table marketing_sender_profiles
  add constraint msp_source_kind_v2
  check (source_kind in ('gmail_oauth', 'workspace_dwd', 'resend'));

-- ── 2 · readiness derivation: teach it the `resend` source ──────────────────
-- Faithful re-statement of the Phase-4 derivation with ONE additional branch:
-- a resend sender's readiness is intrinsic — a configured, immutable
-- from-address (mailbox_address, NOT NULL) is the whole enforceable contract
-- at the DB layer. Absence of the platform RESEND_API_KEY is an ENV concern
-- surfaced as a config error by the adapter at send time (exactly as missing
-- Google OAuth secrets are), never silently reported as "ready=false" here.
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
    -- intrinsic readiness: a configured from-address is the contract
    if v_p.mailbox_address is null or length(trim(v_p.mailbox_address)) < 3 then
      v_state := 'source_disconnected';
    else
      v_state := 'ready';
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

  return jsonb_build_object('sender_id', v_p.id, 'ready', v_state = 'ready',
                            'state', v_state, 'enabled', v_p.enabled);
end $$;

-- ── 3 · create a resend sender (governed, service-role) ─────────────────────
-- Mirrors marketing_sender_create's actor gate + audit + event, but the source
-- is a from-address (no Google source_id lookup). Idempotent per
-- (tenant, from-address). Born ENABLED (a resend sender is immediately usable;
-- there is no external verification handshake — the from-address is the
-- verified-in-Resend identity the operator asserts). send_scope_state is
-- recorded 'authorized' as the intrinsic-readiness marker.
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
  v_existing marketing_sender_profiles%rowtype;
  v_row marketing_sender_profiles%rowtype;
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

  v_addr := lower(trim(coalesce(p_args ->> 'from_address', '')));
  if v_addr = '' or v_addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or length(v_addr) not between 3 and 320 then
    raise exception 'from_address must be a plausible email address' using errcode = '22023';
  end if;

  if (p_args ? 'label') and jsonb_typeof(p_args -> 'label') <> 'string'
     or (p_args ? 'from_name') and jsonb_typeof(p_args -> 'from_name') <> 'string'
     or (p_args ? 'reply_to') and jsonb_typeof(p_args -> 'reply_to') <> 'string'
     or (p_args ? 'signature_text') and jsonb_typeof(p_args -> 'signature_text') <> 'string' then
    raise exception 'invalid create argument types' using errcode = '22023';
  end if;
  v_from_name := marketing_sender_text_guard('from_name', p_args ->> 'from_name');
  v_reply_to := marketing_sender_text_guard('reply_to', p_args ->> 'reply_to');
  if v_reply_to is not null
     and v_reply_to !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'reply_to must be a plausible email address' using errcode = '22023';
  end if;

  -- serialise per (tenant, from-address) so a duplicate create is deterministic
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|sender|resend|' || v_addr, 42));

  select * into v_existing from marketing_sender_profiles
   where tenant_id = p_tenant and source_kind = 'resend' and mailbox_address = v_addr;
  if v_existing.id is not null then
    return jsonb_build_object('id', v_existing.id, 'created', false,
      'mailbox_address', v_existing.mailbox_address,
      'send_scope_state', v_existing.send_scope_state,
      'enabled', v_existing.enabled, 'updated_at', v_existing.updated_at);
  end if;

  insert into marketing_sender_profiles
    (tenant_id, source_kind, email_account_id, workspace_mailbox_id, mailbox_address,
     label, from_name, reply_to, signature_text,
     enabled, send_scope_state, scope_checked_at, last_verified_at, created_by, updated_by)
  values
    (p_tenant, 'resend', null, null, v_addr,
     left(coalesce(marketing_sender_text_guard('label', p_args ->> 'label'), v_addr), 80),
     v_from_name, v_reply_to,
     marketing_sender_text_guard('signature_text', p_args ->> 'signature_text', true),
     true, 'authorized', now(), now(), p_actor, p_actor)
  returning * into v_row;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_actor_label, 'marketing.sender.created', 'marketing_sender',
          v_row.id::text, 'ok',
          jsonb_build_object('source_kind', 'resend', 'mailbox', v_addr));
  perform marketing_event_append(p_tenant, 'marketing.sender.updated', 'marketing_sender',
    v_row.id, 'marketing-senders',
    jsonb_build_object('k', 'created:' || v_row.id, 'op', 'created',
                       'actor', v_actor_label, 'at', now()));

  return jsonb_build_object('id', v_row.id, 'created', true,
    'mailbox_address', v_row.mailbox_address,
    'send_scope_state', v_row.send_scope_state,
    'enabled', v_row.enabled, 'updated_at', v_row.updated_at);
end $$;

-- ── 4 · grants — service-role only, mirroring every marketing RPC ───────────
revoke all on function marketing_sender_create_resend(uuid, uuid, jsonb) from public;
revoke all on function marketing_sender_readiness(uuid, uuid) from public;
grant execute on function marketing_sender_create_resend(uuid, uuid, jsonb) to service_role;
grant execute on function marketing_sender_readiness(uuid, uuid) to service_role;
