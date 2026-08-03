-- ============================================================================
-- Marketing — Resend activation hardening (additive; adversarial correction)
-- ----------------------------------------------------------------------------
-- Corrects security/honesty defects found in the Resend activation review. The
-- three already-deployed migrations (20260908120000/120100/120200) are
-- immutable; this migration redefines their functions additively and tightens
-- the tracking table.
--
-- A. SENDER IDENTITY (sandbox-only, honest readiness):
--    * marketing_sender_create_resend now accepts ONLY the resend.dev sandbox
--      from-address until a real domain is verified — a tenant admin can no
--      longer self-assert an arbitrary sender identity on the shared key.
--    * a resend sender records send_scope_state='unknown' (NOT 'authorized'):
--      a syntactically valid address is not provider authorisation.
--    * readiness reports the honest distinct state 'sandbox_ready' (test-only),
--      never the production 'ready' — the adapter additionally fails campaigns
--      closed for the sandbox sender.
--    Capability note (audited): email.send_marketing is a PROVIDER-NEUTRAL
--    ability registered (in the deployed Phase-4 migration) under the legacy
--    connector id 'google-gmail'; the adapter routes to the real transport by
--    sender.source_kind. Reusing that canonical capability is the smallest
--    correct enablement — no second sending engine is created. It does NOT
--    imply a live Google connection.
--
-- B. TRACKING (tenant-safe + honest metrics):
--    * a composite (tenant_id, delivery_id) FK binds a tracking row to a
--      delivery OF THE SAME TENANT — a service-role insert cannot cross tenants.
--    * counters saturate (cannot overflow under public request floods) and the
--      rolling *_at values only move forward; first_* is set once.
--    * the campaign summary counts SENT as submitted/sent deliveries only, and
--      labels unique-delivery opens/clicks separately from total events; opens/
--      clicks are indicative email events, not verified human behaviour.
-- ============================================================================

-- ── A1 · sandbox-only, honest resend sender creation ────────────────────────
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
  -- SANDBOX ONLY: until a domain is verified against the provider, the only
  -- permitted sender identity is the resend.dev sandbox address. A tenant admin
  -- cannot assert an arbitrary from-address on the shared platform key.
  if v_addr <> 'onboarding@resend.dev' then
    raise exception 'only the resend.dev sandbox sender (onboarding@resend.dev) is permitted until a domain is verified'
      using errcode = '22023';
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

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|sender|resend|' || v_addr, 42));

  select * into v_existing from marketing_sender_profiles
   where tenant_id = p_tenant and source_kind = 'resend' and mailbox_address = v_addr;
  if v_existing.id is not null then
    perform marketing_sender_capability_sync(p_tenant);
    return jsonb_build_object('id', v_existing.id, 'created', false,
      'mailbox_address', v_existing.mailbox_address,
      'send_scope_state', v_existing.send_scope_state,
      'enabled', v_existing.enabled, 'sandbox', true, 'mode', 'sandbox_test',
      'updated_at', v_existing.updated_at);
  end if;

  insert into marketing_sender_profiles
    (tenant_id, source_kind, email_account_id, workspace_mailbox_id, mailbox_address,
     label, from_name, reply_to, signature_text,
     enabled, send_scope_state, scope_checked_at, last_verified_at, created_by, updated_by)
  values
    (p_tenant, 'resend', null, null, v_addr,
     left(coalesce(marketing_sender_text_guard('label', p_args ->> 'label'),
                   'Resend sandbox (test only)'), 80),
     v_from_name, v_reply_to,
     marketing_sender_text_guard('signature_text', p_args ->> 'signature_text', true),
     true, 'unknown', now(), null, p_actor, p_actor)  -- 'unknown': NOT provider-verified
  returning * into v_row;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_actor_label, 'marketing.sender.created', 'marketing_sender',
          v_row.id::text, 'ok',
          jsonb_build_object('source_kind', 'resend', 'mailbox', v_addr, 'mode', 'sandbox_test'));
  perform marketing_event_append(p_tenant, 'marketing.sender.updated', 'marketing_sender',
    v_row.id, 'marketing-senders',
    jsonb_build_object('k', 'created:' || v_row.id, 'op', 'created',
                       'actor', v_actor_label, 'at', now()));

  -- enable the canonical (provider-neutral) marketing send capability so the
  -- engine can dispatch; the adapter routes by source_kind. Not a Google
  -- connection claim.
  perform marketing_sender_capability_sync(p_tenant);

  return jsonb_build_object('id', v_row.id, 'created', true,
    'mailbox_address', v_row.mailbox_address,
    'send_scope_state', v_row.send_scope_state,
    'enabled', v_row.enabled, 'sandbox', true, 'mode', 'sandbox_test',
    'updated_at', v_row.updated_at);
end $$;

-- ── A2 · readiness reports honest, distinct states for resend ───────────────
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
    -- distinct honest states: only the resend.dev sandbox is send-usable now,
    -- and only for test sends (a verified domain would be 'production_send_ready')
    if v_p.mailbox_address = 'onboarding@resend.dev' then
      v_state := 'sandbox_ready';
    else
      v_state := 'unavailable';
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

  -- 'sandbox_ready' is send-usable (for governed test sends only); the adapter
  -- enforces the test-only restriction. 'ready' remains the production state.
  return jsonb_build_object('sender_id', v_p.id,
                            'ready', v_state in ('ready', 'sandbox_ready'),
                            'sandbox', v_state = 'sandbox_ready',
                            'state', v_state, 'enabled', v_p.enabled);
end $$;

-- ── B1 · tenant-safe tracking binding (composite FK) ────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'marketing_email_tracking_delivery_tenant_fk'
  ) then
    alter table marketing_email_tracking
      add constraint marketing_email_tracking_delivery_tenant_fk
      foreign key (tenant_id, delivery_id)
      references marketing_deliveries (tenant_id, id) on delete cascade;
  end if;
end $$;

-- ── B2 · saturating, monotonic recorder ─────────────────────────────────────
create or replace function marketing_track_record(p_delivery uuid, p_kind text, p_url text)
returns boolean
language plpgsql
as $$
declare
  v_tenant uuid;
begin
  if p_delivery is null or p_kind not in ('open', 'click') then
    return false;
  end if;
  select tenant_id into v_tenant from marketing_deliveries where id = p_delivery;
  if v_tenant is null then
    return false;
  end if;

  insert into marketing_email_tracking (tenant_id, delivery_id)
  values (v_tenant, p_delivery)
  on conflict (delivery_id) do nothing;

  if p_kind = 'open' then
    update marketing_email_tracking
       set opened_at = greatest(coalesce(opened_at, now()), now()),  -- only moves forward
           first_open_at = coalesce(first_open_at, now()),           -- set once
           open_count = least(open_count + 1, 1000000000)            -- saturates
     where delivery_id = p_delivery;
  else
    update marketing_email_tracking
       set clicked_at = greatest(coalesce(clicked_at, now()), now()),
           first_click_at = coalesce(first_click_at, now()),
           click_count = least(click_count + 1, 1000000000),
           last_click_url = left(coalesce(p_url, ''), 2048)
     where delivery_id = p_delivery;
  end if;
  return true;
end $$;

-- ── B3 · honest campaign metrics ────────────────────────────────────────────
create or replace function marketing_campaign_tracking_summary(p_tenant uuid, p_campaign uuid)
returns jsonb
language plpgsql
stable
as $$
declare v jsonb;
begin
  if p_tenant is null or p_campaign is null then
    raise exception 'tenant and campaign required' using errcode = '22023';
  end if;
  -- SENT counts only deliveries the provider accepted (submitted/sent), never
  -- every dispatch that merely has a delivery id. opened/clicked are UNIQUE
  -- deliveries; total_* are raw events (a privacy scanner / link prefetcher can
  -- inflate these — they are indicative email events, not verified people).
  select jsonb_build_object(
    'sent', count(*) filter (where del.status in ('submitted', 'sent')),
    'opened_deliveries', count(*) filter (where t.opened_at is not null
                                            and del.status in ('submitted', 'sent')),
    'clicked_deliveries', count(*) filter (where t.clicked_at is not null
                                             and del.status in ('submitted', 'sent')),
    'total_open_events', coalesce(sum(t.open_count) filter (
                            where del.status in ('submitted', 'sent')), 0),
    'total_click_events', coalesce(sum(t.click_count) filter (
                            where del.status in ('submitted', 'sent')), 0),
    'metric_note', 'opens/clicks are indicative email events (bots/prefetchers can inflate them), not verified human behaviour')
  into v
  from marketing_broadcast_dispatches d
  join marketing_deliveries del on del.id = d.delivery_id and del.tenant_id = p_tenant
  left join marketing_email_tracking t
         on t.delivery_id = d.delivery_id and t.tenant_id = p_tenant
  where d.tenant_id = p_tenant
    and d.campaign_id = p_campaign
    and d.delivery_id is not null;
  return coalesce(v, jsonb_build_object('sent', 0, 'opened_deliveries', 0,
    'clicked_deliveries', 0, 'total_open_events', 0, 'total_click_events', 0,
    'metric_note', 'no sent deliveries'));
end $$;

revoke all on function marketing_sender_create_resend(uuid, uuid, jsonb) from public;
revoke all on function marketing_sender_readiness(uuid, uuid) from public;
revoke all on function marketing_track_record(uuid, text, text) from public;
revoke all on function marketing_campaign_tracking_summary(uuid, uuid) from public;
grant execute on function marketing_sender_create_resend(uuid, uuid, jsonb) to service_role;
grant execute on function marketing_sender_readiness(uuid, uuid) to service_role;
grant execute on function marketing_track_record(uuid, text, text) to service_role;
grant execute on function marketing_campaign_tracking_summary(uuid, uuid) to service_role;
