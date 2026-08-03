-- ============================================================================
-- Marketing — Resend sandbox activation CLOSURE (additive; no applied migration
-- is edited: 20260908120000 / 120100 / 120200 / 120300 stay byte-identical)
-- ----------------------------------------------------------------------------
-- Closes the gaps left by the hardening pass (20260908120300):
--
-- A. LEGACY SENDER STATE. A sender created BEFORE the hardening still records
--    send_scope_state = 'authorized' with a last_verified_at stamp. That is a
--    lie under the corrected truth model: a syntactically valid from-address is
--    not provider authorisation, and nothing has ever been verified against
--    Resend. This migration converges every EXISTING resend sender, once and
--    deterministically:
--      * onboarding@resend.dev  → send_scope_state 'unknown', last_verified_at
--        NULL, and a canonical verification_note marking it sandbox/test-only.
--        It stays enabled: readiness derives 'sandbox_ready' (test-to-self only,
--        campaigns/sequences refused by the adapter).
--      * any OTHER resend from-address → disabled and marked never
--        production-ready. Readiness already derives 'unavailable' for it
--        (20260908120300 §A2). The ROW IS NOT DELETED — history is preserved
--        and the change is audited.
--    The pass is tenant-safe (each row converges inside its own tenant), fully
--    idempotent (a converged row is skipped, so re-application writes nothing)
--    and harmless when no resend sender exists.
--
-- B. BOUNDED PUBLIC TRACKING WRITES. A leaked-but-valid tracking token could
--    previously drive one UPDATE per request, for ever. Saturating counters
--    stopped integer overflow but not unbounded public database WORK. The scope
--    of this activation is basic delivery evidence, not behavioural analytics,
--    so the recorder is now WRITE-ONCE PER EVENT KIND:
--      * first open recorded once, first click recorded once;
--      * a duplicate event performs ZERO writes (it is a pure read path — the
--        row is probed by SELECT first, so no speculative INSERT tuple is even
--        attempted);
--      * first-event timestamps are truthful and immutable once set;
--      * the lifetime write budget for ANY delivery is structurally bounded to
--        at most 1 INSERT + 1 open UPDATE + 1 click UPDATE, and a CHECK
--        constraint makes over-counting unrepresentable.
--    Concurrent duplicate events converge: the losing statement re-evaluates
--    its `first_*_at is null` predicate after the winner commits and matches
--    zero rows.
--
--    TOKEN LIFETIME (explicit decision): tracking tokens remain valid for the
--    lifetime of the delivery and carry NO expiry. A sent email lives in the
--    recipient's mailbox indefinitely, so an expiring token would silently
--    discard legitimate later evidence while adding a clock-skew failure mode.
--    The safety property an expiry would have bought — that a leaked token
--    cannot be replayed into unbounded database work — is instead provided
--    structurally by the write-once bound above and proven under concurrency
--    and under a valid-token request flood.
--
--    Raw total-event analytics are therefore NOT collected and are no longer
--    claimed anywhere: there is no governed, rate-controlled evidence that
--    would make such a number honest. No per-request ledger and no recipient
--    behavioural profile is created.
-- ============================================================================

-- ── B0 · additive: the bounded, write-once first-click destination ───────────
-- `last_click_url` was a rolling value written on every click. It is FROZEN by
-- this migration (never written again) and superseded by `first_click_url`,
-- which is written exactly once with the destination of the FIRST recorded
-- click. Backfill is honest: a row that already recorded more than one click
-- cannot know which destination was first, so it backfills NULL.
--
-- STRICTLY ONE-SHOT: the backfill runs ONLY on the apply that actually adds the
-- column. It must never run again — §B1 below converges every inflated
-- click_count down to 1, so an unguarded `click_count = 1` backfill would, on a
-- re-application, copy the LAST recorded destination into first_click_url and
-- assert it was the first. That would be exactly the dishonest value this
-- column exists to avoid.
do $$
declare v_is_new boolean;
begin
  v_is_new := not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'marketing_email_tracking'
       and column_name = 'first_click_url');

  alter table marketing_email_tracking
    add column if not exists first_click_url text
      check (first_click_url is null or length(first_click_url) <= 2048);

  if v_is_new then
    update marketing_email_tracking
       set first_click_url = last_click_url
     where first_click_url is null
       and last_click_url is not null
       and click_count = 1;   -- exactly one click recorded ⇒ it WAS the first
  end if;
end $$;

-- ── B1 · converge existing rows to unique-delivery evidence ─────────────────
-- Counters become bounded unique-delivery evidence (0 or 1), never a raw event
-- total. Rows recorded before this bound are corrected downward — an inflated
-- count was never governed evidence of anything.
update marketing_email_tracking set open_count = 1 where open_count > 1;
update marketing_email_tracking set click_count = 1 where click_count > 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'marketing_email_tracking_unique_evidence_ck'
  ) then
    alter table marketing_email_tracking
      add constraint marketing_email_tracking_unique_evidence_ck
      check (open_count between 0 and 1 and click_count between 0 and 1);
  end if;
end $$;

-- ── B1c · explicit service-role table privileges (portability defect) ───────
-- 20260908120100 created the table and revoked the browser roles, but never
-- granted the service role explicitly — it relied on whatever default
-- privileges the target database happened to carry. On a database without those
-- defaults the deployed recorder fails with "permission denied for table
-- marketing_email_tracking". Granted explicitly here, matching the discipline
-- marketing_deliveries already uses (no DELETE: rows leave only by tenant/
-- delivery cascade), and the browser-role revoke is restated so the grant can
-- never widen the public surface.
grant select, insert, update on marketing_email_tracking to service_role;
revoke all on marketing_email_tracking from anon, authenticated;

-- ── B2 · write-once recorder (bounded public write amplification) ────────────
create or replace function marketing_track_record(p_delivery uuid, p_kind text, p_url text)
returns boolean
language plpgsql
as $$
declare
  v_tenant uuid;
  v_open   timestamptz;
  v_click  timestamptz;
  v_found  boolean := false;
  v_rows   integer;
begin
  if p_delivery is null or p_kind not in ('open', 'click') then
    return false;
  end if;
  select tenant_id into v_tenant from marketing_deliveries where id = p_delivery;
  if v_tenant is null then
    -- unknown/alien delivery: nothing is written and nothing is disclosed
    return false;
  end if;

  -- READ FIRST: a repeat event on an already-recorded delivery must not write.
  -- (An unconditional `insert ... on conflict do nothing` would still attempt a
  -- speculative tuple on every request — real write work under a token flood.)
  select first_open_at, first_click_at
    into v_open, v_click
    from marketing_email_tracking
   where delivery_id = p_delivery;
  v_found := found;   -- NOT a SELECT-INTO target: a miss must be FALSE, not NULL

  if p_kind = 'open' and v_found and v_open is not null then
    return false;  -- duplicate open: ZERO writes
  end if;
  if p_kind = 'click' and v_found and v_click is not null then
    return false;  -- duplicate click: ZERO writes
  end if;

  if not v_found then
    insert into marketing_email_tracking (tenant_id, delivery_id)
    values (v_tenant, p_delivery)
    on conflict (delivery_id) do nothing;
  end if;

  -- WRITE-ONCE: the predicate is re-evaluated under READ COMMITTED, so a
  -- concurrent duplicate that lost the race matches zero rows and converges.
  if p_kind = 'open' then
    update marketing_email_tracking
       set opened_at     = now(),
           first_open_at = now(),
           open_count    = 1
     where delivery_id = p_delivery
       and first_open_at is null;
  else
    update marketing_email_tracking
       set clicked_at       = now(),
           first_click_at   = now(),
           click_count      = 1,
           first_click_url  = left(coalesce(p_url, ''), 2048)
     where delivery_id = p_delivery
       and first_click_at is null;
  end if;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

-- ── B3 · summary reports unique-delivery evidence only ──────────────────────
-- The previous shape still exposed total_open_events / total_click_events. With
-- write-once evidence there IS no honest raw total, so the fields are replaced
-- by an explicit statement that total-event analytics are not collected.
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
  -- SENT counts only deliveries the provider accepted (submitted/sent).
  -- opened/clicked are UNIQUE DELIVERIES that recorded a first event; opens and
  -- clicks are indicative email events (privacy scanners and link prefetchers
  -- fire them without a human), not verified human behaviour.
  select jsonb_build_object(
    'sent', count(*) filter (where del.status in ('submitted', 'sent')),
    'opened_deliveries', count(*) filter (where t.first_open_at is not null
                                            and del.status in ('submitted', 'sent')),
    'clicked_deliveries', count(*) filter (where t.first_click_at is not null
                                             and del.status in ('submitted', 'sent')),
    'total_event_analytics', 'not_collected',
    'metric_note', 'unique-delivery first-open/first-click evidence only; opens/clicks are indicative email events (bots and prefetchers can fire them), not verified human behaviour; raw total-event counts are not collected')
  into v
  from marketing_broadcast_dispatches d
  join marketing_deliveries del on del.id = d.delivery_id and del.tenant_id = p_tenant
  left join marketing_email_tracking t
         on t.delivery_id = d.delivery_id and t.tenant_id = p_tenant
  where d.tenant_id = p_tenant
    and d.campaign_id = p_campaign
    and d.delivery_id is not null;
  return coalesce(v, jsonb_build_object('sent', 0, 'opened_deliveries', 0,
    'clicked_deliveries', 0, 'total_event_analytics', 'not_collected',
    'metric_note', 'no sent deliveries'));
end $$;

-- ── A1 · converge every EXISTING resend sender (tenant-safe, deterministic) ──
-- The two canonical notes are literals (no new catalog functions are
-- introduced, so the Phase-4 grant/catalog surface is unchanged); the same
-- literals are written by the create RPC in §A2 below.
do $$
declare
  r          record;
  v_tid      uuid;
  v_sandbox  text := 'Resend sandbox (onboarding@resend.dev) — test-to-self only. Never verified against Resend; real provider submission NOT RUN. Campaigns and sequences are refused.';
  v_legacy   text := 'Legacy Resend from-address — unavailable and never production-ready. Only the resend.dev sandbox sender is permitted until a domain is verified in Resend.';
  v_tenants  uuid[] := '{}';
begin
  for r in
    select p.id, p.tenant_id, p.mailbox_address, p.enabled,
           p.send_scope_state, p.last_verified_at, p.verification_note
      from marketing_sender_profiles p
     where p.source_kind = 'resend'
     order by p.tenant_id, p.id            -- deterministic
  loop
    if r.mailbox_address = 'onboarding@resend.dev' then
      -- SANDBOX: honest unverified state; stays usable for governed test sends
      continue when r.send_scope_state = 'unknown'
                and r.last_verified_at is null
                and r.verification_note is not distinct from v_sandbox;  -- idempotent

      update marketing_sender_profiles
         set send_scope_state  = 'unknown',
             last_verified_at  = null,
             scope_checked_at  = now(),
             verification_note = v_sandbox
       where id = r.id and tenant_id = r.tenant_id;

      insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
      values (r.tenant_id, 'service', 'marketing.sender.state_corrected', 'marketing_sender',
              r.id::text, 'ok',
              jsonb_build_object('source_kind', 'resend', 'mailbox', r.mailbox_address,
                                 'mode', 'sandbox_test',
                                 'from_send_scope_state', r.send_scope_state,
                                 'to_send_scope_state', 'unknown',
                                 'reason', 'a syntactically valid from-address is not provider authorisation'));
      perform marketing_event_append(r.tenant_id, 'marketing.sender.updated', 'marketing_sender',
        r.id, 'migration-20260908120400',
        jsonb_build_object('k', 'state_corrected:' || r.id, 'op', 'state_corrected',
                           'actor', 'service', 'at', now()));
    else
      -- LEGACY ARBITRARY ADDRESS: never production-ready; disabled, history kept
      continue when r.enabled = false
                and r.send_scope_state = 'unknown'
                and r.last_verified_at is null
                and r.verification_note is not distinct from v_legacy;    -- idempotent

      -- the structural sender guard refuses to disable a tenant's CURRENT
      -- default, so clear the default first, in this same transaction
      update marketing_settings
         set default_sender_profile_id = null
       where tenant_id = r.tenant_id
         and default_sender_profile_id = r.id;

      update marketing_sender_profiles
         set enabled           = false,
             send_scope_state  = 'unknown',
             last_verified_at  = null,
             scope_checked_at  = now(),
             verification_note = v_legacy
       where id = r.id and tenant_id = r.tenant_id;

      insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
      values (r.tenant_id, 'service', 'marketing.sender.disabled', 'marketing_sender',
              r.id::text, 'ok',
              jsonb_build_object('source_kind', 'resend', 'mailbox', r.mailbox_address,
                                 'from_enabled', r.enabled,
                                 'from_send_scope_state', r.send_scope_state,
                                 'reason', 'only the resend.dev sandbox sender is permitted until a domain is verified'));
      perform marketing_event_append(r.tenant_id, 'marketing.sender.updated', 'marketing_sender',
        r.id, 'migration-20260908120400',
        jsonb_build_object('k', 'disabled:' || r.id, 'op', 'disabled',
                           'actor', 'service', 'at', now()));
    end if;

    if not (r.tenant_id = any (v_tenants)) then
      v_tenants := v_tenants || r.tenant_id;
    end if;
  end loop;

  -- capability truth follows the corrected sender state
  foreach v_tid in array v_tenants loop
    perform marketing_sender_capability_sync(v_tid);
  end loop;
end $$;

-- ── A2 · new sandbox senders record the canonical note from creation ────────
-- Redefines 20260908120300 §A1 additively: identical behaviour plus the
-- canonical sandbox verification_note, so a freshly created sandbox sender and
-- a converged legacy one are indistinguishable in state.
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
  -- permitted sender identity is the resend.dev sandbox address.
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
      'test_to_self_only', true,
      'provider_submission_verified', false,
      'updated_at', v_existing.updated_at);
  end if;

  insert into marketing_sender_profiles
    (tenant_id, source_kind, email_account_id, workspace_mailbox_id, mailbox_address,
     label, from_name, reply_to, signature_text,
     enabled, send_scope_state, scope_checked_at, last_verified_at,
     verification_note, created_by, updated_by)
  values
    (p_tenant, 'resend', null, null, v_addr,
     left(coalesce(marketing_sender_text_guard('label', p_args ->> 'label'),
                   'Resend sandbox (test only)'), 80),
     v_from_name, v_reply_to,
     marketing_sender_text_guard('signature_text', p_args ->> 'signature_text', true),
     true, 'unknown', now(), null,                 -- 'unknown': NOT provider-verified
     'Resend sandbox (onboarding@resend.dev) — test-to-self only. Never verified against Resend; real provider submission NOT RUN. Campaigns and sequences are refused.',
     p_actor, p_actor)
  returning * into v_row;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_actor_label, 'marketing.sender.created', 'marketing_sender',
          v_row.id::text, 'ok',
          jsonb_build_object('source_kind', 'resend', 'mailbox', v_addr, 'mode', 'sandbox_test'));
  perform marketing_event_append(p_tenant, 'marketing.sender.updated', 'marketing_sender',
    v_row.id, 'marketing-senders',
    jsonb_build_object('k', 'created:' || v_row.id, 'op', 'created',
                       'actor', v_actor_label, 'at', now()));

  perform marketing_sender_capability_sync(p_tenant);

  return jsonb_build_object('id', v_row.id, 'created', true,
    'mailbox_address', v_row.mailbox_address,
    'send_scope_state', v_row.send_scope_state,
    'enabled', v_row.enabled, 'sandbox', true, 'mode', 'sandbox_test',
    'test_to_self_only', true,
    'provider_submission_verified', false,
    'updated_at', v_row.updated_at);
end $$;

-- ── A3 · readiness carries the sandbox restrictions in its derived answer ────
-- Same states as 20260908120300 §A2 plus explicit, machine-readable sandbox
-- limits, so no surface has to re-derive (or mis-state) them.
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

  return jsonb_build_object(
    'sender_id', v_p.id,
    'ready', v_state in ('ready', 'sandbox_ready'),
    'sandbox', v_state = 'sandbox_ready',
    'state', v_state,
    'enabled', v_p.enabled,
    -- explicit derived limits (no surface re-derives these). Only a fully
    -- production-'ready' sender may carry a campaign or a sequence; the
    -- sandbox is additionally restricted to a test send addressed to the
    -- requesting actor themselves.
    'test_to_self_only', v_state = 'sandbox_ready',
    'campaigns_blocked', v_state <> 'ready',
    'sequences_blocked', v_state <> 'ready',
    'provider_submission_verified', false,
    'transport', case when v_p.source_kind = 'resend' then 'resend' else 'gmail' end);
end $$;

revoke all on function marketing_sender_create_resend(uuid, uuid, jsonb) from public;
revoke all on function marketing_sender_readiness(uuid, uuid) from public;
revoke all on function marketing_track_record(uuid, text, text) from public;
revoke all on function marketing_campaign_tracking_summary(uuid, uuid) from public;
revoke all on function marketing_sender_create_resend(uuid, uuid, jsonb) from anon, authenticated;
revoke all on function marketing_sender_readiness(uuid, uuid) from anon, authenticated;
revoke all on function marketing_track_record(uuid, text, text) from anon, authenticated;
revoke all on function marketing_campaign_tracking_summary(uuid, uuid) from anon, authenticated;
grant execute on function marketing_sender_create_resend(uuid, uuid, jsonb) to service_role;
grant execute on function marketing_sender_readiness(uuid, uuid) to service_role;
grant execute on function marketing_track_record(uuid, text, text) to service_role;
grant execute on function marketing_campaign_tracking_summary(uuid, uuid) to service_role;
