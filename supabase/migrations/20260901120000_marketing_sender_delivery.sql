-- ============================================================================
-- MARKETING PHASE 4 — Workspace sender configuration + governed delivery
-- (test-send vertical slice). ADDITIVE, RUN-ONCE. Nothing here modifies the
-- committed Phase 0-3 marketing migrations or the frozen Automation Engine.
--
-- What this migration adds:
--  - SENDER PROFILES (marketing_sender_profiles): a tenant-scoped, structurally
--    tenant-bound authorisation of ONE existing source mailbox (a Gmail OAuth
--    email_accounts row OR a Google Workspace DWD google_workspace_mailboxes
--    row) as a Marketing sender. Source identity + mailbox address are
--    IMMUTABLE once created (FK set-null on source removal is the only
--    exception); display configuration (label/from name/reply-to/signature)
--    is validated at WRITE time (no control characters, no CR/LF header
--    material, plausible reply-to) and editable under an exact
--    optimistic-concurrency token; enable/disable never deletes history; hard
--    delete is not an operational action (DELETE/TRUNCATE revoked from every
--    client role — tenant CASCADE cleanup still works because it runs as the
--    table owner). EVERY profile reference (created_by/updated_by) is
--    composite-FK tenant-bound.
--  - READINESS (marketing_sender_readiness / _all): ONE canonical derivation
--    of send-readiness from CURRENT AUTHORITATIVE SOURCE STATE — for OAuth:
--    the actual gmail account row (provider, status='active', auth_state
--    EXACTLY 'ok' — 'unknown'/null/anything unrecognised is NOT authorised),
--    a same-tenant stored token and the EXACT whitespace-token gmail.send
--    scope in the STORED GRANT (marketing_scope_has — never a substring
--    match); for DWD: the actual mailbox row, ITS OWN Workspace connection
--    (by connection_id — correct under multiple connections) and recorded
--    send-scope mint evidence. Used consistently by sender enablement,
--    capability sync, test-send request creation and the overview; the
--    adapter re-checks the same derivation at execution time via this RPC.
--    Capability truth is additionally SELF-REFRESHING: narrowly scoped
--    triggers on the authoritative source tables re-run capability sync in
--    the same transaction as any relevant change (tenants with no Marketing
--    sender are untouched). Cached sender columns are display evidence,
--    never the authority.
--  - DEFAULT SENDER: marketing_settings.default_sender_profile_id gains a
--    composite tenant-bound FK. The default must be an ENABLED sender
--    (trigger-enforced for every caller); disabling a sender that is the
--    default clears the default FIRST in the same transaction (RPC) and a
--    trigger structurally rejects disabling a sender that is still the
--    default. Default changes are atomic, versioned into
--    marketing_settings_history and audited.
--  - DELIVERIES (marketing_deliveries + marketing_delivery_events): the
--    bounded Marketing DOMAIN PROJECTION of a governed send. The Automation
--    Engine's automation_execution_attempts remain the authoritative
--    execution record — a delivery references the immutable intent and
--    carries the exact submitted content (bounded), content hash/version,
--    request fingerprint, correlation + request idempotency, provider
--    message/thread ids and a factual status vocabulary
--    (queued|executing|submitted|failed|unknown). "submitted" means GMAIL
--    ACCEPTED THE REQUEST — never "delivered". Status history is an
--    append-only event stream, each event composite-bound to its delivery's
--    EXACT intent and (when cited) to a SAME-TENANT SAME-INTENT attempt, with
--    an insert guard that rejects fictional history (wrong current status,
--    foreign attempt, broken from-status chain, duplicate initial event).
--    The delivery guard is FACTUAL on INSERT AND UPDATE, for EVERY caller
--    including the service role: a delivery is BORN queued with no
--    execution/provider/failure facts and must agree with its PENDING test
--    intent's frozen envelope; each transition must agree with the CURRENT
--    engine state (intent status); 'submitted' additionally requires a
--    same-tenant SAME-INTENT succeeded attempt whose external reference
--    equals the recorded provider message id (thread id agreeing where
--    present) — fabricated submission is structurally impossible, by insert
--    or by update. Provider facts are write-once and may only be set by the
--    transition into submitted; the cited attempt and failure classification
--    can only move WITH a factual transition, so terminal facts are pinned.
--    Every reference (actor/recipient/person/intent/attempt) is composite-FK
--    tenant-bound; the attempt FKs additionally bind THE SAME INTENT.
--  - AUTOMATION REGISTRATION (the documented onboarding path — the engine
--    itself is untouched): capability `email.send_marketing`
--    (external_side_effect = TRUE, risk_category 'high'), operational outcome
--    type `marketing_email_submitted`, capability contract row (adapter v1),
--    and the TEST-ONLY intent type `send_marketing_test_email`
--    (requires_approval = FALSE — see the authority note below;
--    supports_status_lookup = FALSE — Gmail exposes no reliable send-status
--    lookup, so unknown results FREEZE for review). NO tenant enablement is
--    seeded: tenant_connector_capabilities rows are managed only by
--    marketing_sender_capability_sync from VERIFIED READY senders.
--  - TEST-SEND AUTHORITY MODEL (honest): a Phase-4 test send is an
--    EXPLICITLY AUTHORISED, DELEGATED TEST ACTION by an actor holding
--    canonical `marketing.campaigns.test`. It is NOT a tenant-senior
--    approval, and NO automation_approvals row is created — fabricating one
--    would misattribute authority. The immutable DecisionPackage therefore
--    records decision AUTOMATION_AUTHORISED with all review routing flags
--    false and automationIntent.requiresApproval false, while preserving the
--    requesting actor, tenant, permission basis, recipient, sender, request
--    and the irreversible external classification in the package, intent
--    envelope, Action, event and audit history. The Operational Mode re-check
--    still applies unchanged: reversibility is honestly IRREVERSIBLE, so
--    execution proceeds only in a mode permitting irreversible external work.
--    THIS PRE-AUTHORISES NOTHING BEYOND ONE BOUNDED TEST: Phase 5 broadcasts
--    MUST use a separate bulk-send intent type and/or an explicit
--    approval-requiring Decision Package — the engine's approval guard is
--    untouched and still enforces approval wherever a package or intent type
--    demands it.
--  - REQUEST IDEMPOTENCY bound to the EXACT request: a canonical fingerprint
--    (actor + sender + recipient + full frozen content hash + request id) is
--    stored on the delivery and compared transactionally under the request
--    lock. The same request id with a byte-equivalent request converges on
--    the same intent/delivery; the same request id with ANY differing frozen
--    input raises a stable MK412 conflict and creates nothing.
--  - RECONCILER (marketing_delivery_reconcile): projects the engine's
--    immutable attempt facts into the delivery record; on CONFIRMED
--    submission upserts the canonical outbound email_messages source row
--    (converging on (tenant, provider, provider_message_id) so later Gmail
--    ingestion cannot duplicate it; origin provenance composite-FK bound) and
--    ENQUEUES the standard `interactions.sync` job under its existing
--    deterministic key — the EXISTING canonical projector remains the single
--    source of Interaction creation (no Marketing-only interaction writer).
--    A failed or unknown attempt writes NO email_messages row, so no
--    successful outbound Interaction can exist for it.
--  - OBSERVABILITY (marketing_sender_health): sender/scope/capability truth,
--    delivery status counts, last submitted/failed/unknown, unknowns needing
--    review, oldest queued age — real evidence, not toasts.
--
-- Honest limitations recorded here deliberately:
--  * A trigger/RPC cannot identify its caller — the guarantees are
--    STRUCTURAL (shapes, composite FKs, factual transition anchoring,
--    grants) plus service-role-only execution.
--  * Gmail provides NO provider-side idempotency key for messages.send. The
--    engine's machinery (idempotency key + single-success unique index +
--    unknown-freeze) prevents KNOWN duplicate submissions; an unknown
--    provider result is parked for human review, never blindly resent. We do
--    NOT claim provider exactly-once semantics.
--
-- Rollback (dev only):
--   drop function if exists marketing_sender_health(uuid);
--   drop function if exists marketing_test_send_status(uuid, jsonb);
--   drop function if exists marketing_delivery_reconcile(uuid, uuid);
--   drop function if exists marketing_test_send_request(uuid, uuid, jsonb);
--   drop function if exists marketing_source_capability_sync() cascade;
--   drop function if exists marketing_delivery_event_guard() cascade;
--   drop function if exists marketing_request_fingerprint(text, uuid, uuid, uuid, text);
--   drop function if exists marketing_scope_has(text, text);
--   alter table email_oauth_tokens
--     drop constraint if exists email_oauth_tokens_account_tenant_fk;
--   drop function if exists marketing_sender_capability_sync(uuid);
--   drop function if exists marketing_sender_record_verification(uuid, uuid, text, text, timestamptz);
--   drop function if exists marketing_sender_set_default(uuid, uuid, uuid, timestamptz);
--   drop function if exists marketing_sender_set_enabled(uuid, uuid, uuid, boolean, timestamptz);
--   drop function if exists marketing_sender_update(uuid, uuid, uuid, jsonb, timestamptz);
--   drop function if exists marketing_sender_create(uuid, uuid, jsonb);
--   drop function if exists marketing_sender_readiness_all(uuid);
--   drop function if exists marketing_sender_readiness(uuid, uuid);
--   drop function if exists marketing_sender_sources(uuid);
--   drop function if exists marketing_require_senders_actor(uuid, uuid);
--   drop function if exists marketing_sender_text_guard(text, text, boolean);
--   drop function if exists marketing_delivery_guard() cascade;
--   drop function if exists marketing_sender_guard() cascade;
--   drop function if exists marketing_settings_default_sender_guard() cascade;
--   drop table if exists marketing_delivery_events;
--   drop table if exists marketing_deliveries;
--   alter table marketing_settings drop constraint if exists marketing_settings_default_sender_fk;
--   drop table if exists marketing_sender_profiles;
--   alter table email_messages
--     drop constraint if exists email_messages_origin_delivery_fk,
--     drop constraint if exists email_messages_origin_intent_fk,
--     drop column if exists origin,
--     drop column if exists origin_delivery_id, drop column if exists origin_automation_intent_id;
--   delete from automation_intent_types where intent_type = 'send_marketing_test_email';
--   delete from automation_capability_contracts where capability_key = 'email.send_marketing';
--   delete from outcome_types where outcome_type = 'marketing_email_submitted';
--   delete from automation_connector_capabilities where capability_key = 'email.send_marketing';
--   drop index if exists automation_execution_attempts_tenant_intent_id_uk;
--   drop index if exists automation_execution_attempts_tenant_id_uk;
--   drop index if exists automation_intents_tenant_id_uk;
--   drop index if exists profiles_tenant_id_uk;
--   drop index if exists google_workspace_mailboxes_tenant_id_uk;
--   drop index if exists email_accounts_tenant_id_uk;
-- ============================================================================

-- ── Composite keys so every Phase-4 reference is STRUCTURALLY tenant-bound ──
-- (additive unique indexes only; no behaviour change to the source tables)
create unique index if not exists email_accounts_tenant_id_uk
  on email_accounts (tenant_id, id);
create unique index if not exists google_workspace_mailboxes_tenant_id_uk
  on google_workspace_mailboxes (tenant_id, id);
create unique index if not exists automation_intents_tenant_id_uk
  on automation_intents (tenant_id, id);
create unique index if not exists profiles_tenant_id_uk
  on profiles (tenant_id, id);
create unique index if not exists automation_execution_attempts_tenant_id_uk
  on automation_execution_attempts (tenant_id, id);
-- binds an attempt reference to ITS OWN intent, not just its tenant
create unique index if not exists automation_execution_attempts_tenant_intent_id_uk
  on automation_execution_attempts (tenant_id, automation_intent_id, id);

-- ── STRUCTURAL tenant binding of OAuth tokens to their account ──────────────
-- email_oauth_tokens carries its own tenant_id but was only FK-bound to the
-- account by id. Bind (tenant_id, email_account_id) → email_accounts
-- (tenant_id, id) so a token row can never disagree with its account's
-- tenant. This invariant is MANDATORY: the migration NEVER completes without
-- the validated constraint. If inconsistent legacy rows exist, the migration
-- FAILS LOUDLY with the exact row count and an operator-verifiable repair —
-- it never warns-and-continues, because everything above this file claims
-- the binding is structural. (Every Phase-4 query ALSO filters tokens by
-- tenant explicitly — defence in depth, not a substitute for the FK.)
do $$
declare v_bad bigint;
begin
  -- scoped to THIS schema+table, never a mere global constraint-name match
  if not exists (select 1 from pg_constraint
                  where conname = 'email_oauth_tokens_account_tenant_fk'
                    and conrelid = 'public.email_oauth_tokens'::regclass) then
    select count(*) into v_bad
      from email_oauth_tokens t
      join email_accounts a on a.id = t.email_account_id
     where t.tenant_id is distinct from a.tenant_id;
    if v_bad > 0 then
      raise exception 'email_oauth_tokens: % row(s) carry a tenant_id disagreeing with their account''s tenant — the mandatory tenant FK cannot be added. Repair the redundant token tenant from the canonical account tenant AFTER operator verification, then re-run this migration.', v_bad
        using errcode = '23514',
              hint = 'verified repair: update email_oauth_tokens t set tenant_id = a.tenant_id from email_accounts a where a.id = t.email_account_id and t.tenant_id is distinct from a.tenant_id;';
    end if;
    -- plain ADD CONSTRAINT (never NOT VALID): existing rows are validated here
    alter table email_oauth_tokens
      add constraint email_oauth_tokens_account_tenant_fk
      foreign key (tenant_id, email_account_id)
      references email_accounts (tenant_id, id) on delete cascade;
  end if;
end $$;

-- ── EXACT OAuth scope membership (whitespace-token, NEVER substring) ────────
-- Mirrors the TypeScript evaluateGmailSendScope contract exactly: a granted
-- scope string authorises a scope only when it contains it as a COMPLETE
-- whitespace-delimited token. 'https://…/gmail.send.extra' or
-- 'https://…/gmail.sendfoo' can never satisfy 'https://…/gmail.send'.
-- Used by EVERY SQL readiness/capability/discovery decision in this phase.
create or replace function marketing_scope_has(p_scope text, p_required text)
returns boolean
language sql
immutable
as $$
  select p_required is not null
     and p_required = any(regexp_split_to_array(coalesce(p_scope, ''), '\s+'));
$$;

-- ── THE ONE canonical request-fingerprint formula ───────────────────────────
-- Binds request idempotency to the EXACT request (request id + actor +
-- sender + recipient + full frozen content hash). Defined ONCE so the
-- request RPC (which stores it) and the delivery insert guard (which
-- RECOMPUTES and verifies it — a caller-supplied 64-hex value is never
-- trusted for its shape) can never drift apart.
create or replace function marketing_request_fingerprint(
  p_request_id text, p_actor uuid, p_sender uuid, p_recipient uuid, p_content_hash text
) returns text
language sql
immutable
as $$
  select encode(extensions.digest(jsonb_build_object(
    'request_id', p_request_id, 'actor', p_actor, 'sender', p_sender,
    'recipient_profile', p_recipient, 'content_hash', p_content_hash)::text,
    'sha256'), 'hex');
$$;

-- ── shared bounded-text guard for header-bound sender fields ────────────────
-- Rejects CR/LF and every other control character (a plain \n is permitted
-- only where p_allow_newlines — the signature body). Raises 22023 with the
-- field name; returns the trimmed value (nullified when empty).
create or replace function marketing_sender_text_guard(
  p_field text, p_value text, p_allow_newlines boolean default false
) returns text
language plpgsql
immutable
as $$
declare v text;
begin
  if p_value is null then return null; end if;
  v := trim(p_value);
  if v = '' then return null; end if;
  if p_allow_newlines then
    if replace(replace(v, e'\n', ''), e'\t', '') ~ '[[:cntrl:]]' then
      raise exception '% contains a prohibited control character', p_field
        using errcode = '22023';
    end if;
  elsif v ~ '[[:cntrl:]]' then
    raise exception '% contains a prohibited control character', p_field
      using errcode = '22023';
  end if;
  return v;
end $$;

-- ============================================================================
-- SENDER PROFILES
-- ============================================================================
create table marketing_sender_profiles (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id) on delete cascade,
  source_kind          text not null check (source_kind in ('gmail_oauth', 'workspace_dwd')),
  -- EXACTLY ONE source at creation (RPC-enforced presence; the CHECK tolerates
  -- a later FK set-null when the source row is removed — the sender then reads
  -- as source-disconnected and can never execute, but its history survives).
  email_account_id     uuid,
  workspace_mailbox_id uuid,
  -- immutable snapshot of the source mailbox identity (never re-pointable)
  mailbox_address      text not null check (mailbox_address = lower(mailbox_address)
                                            and length(mailbox_address) between 3 and 320),
  label                text not null default '' check (length(label) <= 80),
  from_name            text check (from_name is null or length(from_name) <= 120),
  reply_to             text check (reply_to is null or length(reply_to) <= 320),
  signature_text       text check (signature_text is null or length(signature_text) <= 2000),
  enabled              boolean not null default false,
  -- recorded verification EVIDENCE (display + DWD mint proof), written ONLY by
  -- the server verification path — authoritative readiness is derived LIVE by
  -- marketing_sender_readiness from the source rows themselves
  send_scope_state     text not null default 'unknown'
                         check (send_scope_state in ('authorized', 'missing', 'unknown')),
  scope_checked_at     timestamptz,
  last_verified_at     timestamptz,
  verification_note    text check (verification_note is null or length(verification_note) <= 300),
  created_by           uuid,
  updated_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  constraint msp_source_kind_shape check (
    (email_account_id is null or source_kind = 'gmail_oauth')
    and (workspace_mailbox_id is null or source_kind = 'workspace_dwd')
    and not (email_account_id is not null and workspace_mailbox_id is not null)),
  -- every reference is STRUCTURALLY tenant-bound
  constraint msp_account_fk foreign key (tenant_id, email_account_id)
    references email_accounts (tenant_id, id) on delete set null (email_account_id),
  constraint msp_mailbox_fk foreign key (tenant_id, workspace_mailbox_id)
    references google_workspace_mailboxes (tenant_id, id) on delete set null (workspace_mailbox_id),
  constraint msp_created_by_fk foreign key (tenant_id, created_by)
    references profiles (tenant_id, id) on delete set null (created_by),
  constraint msp_updated_by_fk foreign key (tenant_id, updated_by)
    references profiles (tenant_id, id) on delete set null (updated_by)
);
-- one sender per source mailbox (duplicates are deterministically idempotent
-- in the create RPC — the existing profile is returned)
create unique index marketing_sender_profiles_account_uk
  on marketing_sender_profiles (tenant_id, email_account_id)
  where email_account_id is not null;
create unique index marketing_sender_profiles_mailbox_uk
  on marketing_sender_profiles (tenant_id, workspace_mailbox_id)
  where workspace_mailbox_id is not null;
create index marketing_sender_profiles_idx
  on marketing_sender_profiles (tenant_id, enabled, created_at);
create trigger marketing_sender_profiles_set_updated_at
  before update on marketing_sender_profiles
  for each row execute function set_updated_at();

-- STRUCTURAL sender guard: identity + source lineage are immutable on every
-- update (the only legal source change is the genuine FK set-null of the one
-- existing source reference); a sender that is the tenant's CURRENT default
-- cannot be disabled (the disable RPC clears the default first in the same
-- transaction, so callers cannot leave a disabled default behind).
create or replace function marketing_sender_guard()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.source_kind is distinct from old.source_kind
     or new.mailbox_address is distinct from old.mailbox_address
     or new.created_at is distinct from old.created_at
     -- created_by is pinned EXCEPT for the genuine FK set-null when the
     -- creating profile is removed (profiles FK is on delete set null)
     or (new.created_by is distinct from old.created_by
         and not (new.created_by is null and old.created_by is not null)) then
    raise exception 'sender identity and source lineage are immutable';
  end if;
  -- source references: unchanged, or a genuine set-null of the existing ref
  if new.email_account_id is distinct from old.email_account_id
     and not (new.email_account_id is null and old.email_account_id is not null) then
    raise exception 'a sender can never be re-pointed at another source mailbox';
  end if;
  if new.workspace_mailbox_id is distinct from old.workspace_mailbox_id
     and not (new.workspace_mailbox_id is null and old.workspace_mailbox_id is not null) then
    raise exception 'a sender can never be re-pointed at another source mailbox';
  end if;
  if old.enabled and not new.enabled then
    if exists (select 1 from marketing_settings s
                where s.tenant_id = old.tenant_id
                  and s.default_sender_profile_id = old.id) then
      raise exception 'the default sender cannot be disabled — clear or replace the default first'
        using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger marketing_sender_profiles_guard
  before update on marketing_sender_profiles
  for each row execute function marketing_sender_guard();

alter table marketing_sender_profiles enable row level security;
create policy marketing_sender_profiles_select on marketing_sender_profiles
  for select using (tenant_id = current_tenant_id()
                    and marketing_has_permission('marketing.view'));
grant select on marketing_sender_profiles to authenticated;
grant select, insert, update on marketing_sender_profiles to service_role;
-- hard deletion is NOT an operational action; tenant cascade (owner) still works
revoke delete, truncate on marketing_sender_profiles from anon, authenticated, service_role;

-- ── default sender: structurally tenant-bound + must be enabled ─────────────
alter table marketing_settings
  add constraint marketing_settings_default_sender_fk
  foreign key (tenant_id, default_sender_profile_id)
  references marketing_sender_profiles (tenant_id, id)
  on delete set null (default_sender_profile_id);

create or replace function marketing_settings_default_sender_guard()
returns trigger language plpgsql as $$
begin
  if new.default_sender_profile_id is not null
     and (tg_op = 'INSERT'
          or new.default_sender_profile_id is distinct from old.default_sender_profile_id) then
    if not exists (select 1 from marketing_sender_profiles p
                    where p.id = new.default_sender_profile_id
                      and p.tenant_id = new.tenant_id and p.enabled) then
      raise exception 'the default sender must be an enabled sender of this tenant'
        using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger marketing_settings_default_sender_guard
  before insert or update on marketing_settings
  for each row execute function marketing_settings_default_sender_guard();

-- ============================================================================
-- CANONICAL READINESS — derived LIVE from authoritative source state.
-- ONE derivation used by enablement, capability sync, test-send creation, the
-- overview and (via RPC) the adapter's execution-time validation. Cached
-- sender columns are never the authority.
-- ============================================================================
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

  if v_p.source_kind = 'gmail_oauth' then
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
        -- ONLY the authoritative successful state is ready. 'unknown', null
        -- and every unrecognised vocabulary value are NOT authorisation.
        v_state := 'auth_invalid';
      else
        -- the token row must belong to THIS tenant, not merely this account id
        select t.access_token is not null, t.scope
          into v_has_token, v_scope
          from email_oauth_tokens t
         where t.email_account_id = v_acc.id and t.tenant_id = p_tenant;
        if not found or not coalesce(v_has_token, false) then
          v_state := 'token_missing';
        elsif not marketing_scope_has(v_scope,
                    'https://www.googleapis.com/auth/gmail.send') then
          -- EXACT whitespace-token membership — a superstring scope never counts
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
        -- the mailbox's OWN connection — correct with multiple connections
        select * into v_conn from google_workspace_connections
         where id = v_mbx.connection_id and tenant_id = p_tenant;
        if not found or v_conn.status <> 'active' then
          v_state := 'connection_inactive';
        elsif v_p.send_scope_state <> 'authorized' then
          -- the DWD grant is provable only by a real gmail.send token mint;
          -- recorded evidence is required, never assumed
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

create or replace function marketing_sender_readiness_all(p_tenant uuid)
returns jsonb
language plpgsql
stable
as $$
declare v jsonb := '[]'::jsonb; r record;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  for r in select id from marketing_sender_profiles
            where tenant_id = p_tenant order by created_at loop
    v := v || marketing_sender_readiness(p_tenant, r.id);
  end loop;
  return v;
end $$;

-- ============================================================================
-- DELIVERIES — bounded domain projection of governed sends (factual truth)
-- ============================================================================
create table marketing_deliveries (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id) on delete cascade,
  sender_profile_id    uuid not null,
  purpose              text not null check (purpose in ('test')),
  actor_profile_id     uuid,
  recipient_profile_id uuid,
  recipient_email      text not null check (length(recipient_email) between 3 and 320),
  person_id            uuid,          -- future canonical recipient; null for test sends
  automation_intent_id uuid not null,
  execution_attempt_id uuid,
  request_id           text not null check (request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  request_fingerprint  text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  correlation_id       uuid not null,
  subject              text not null check (length(subject) between 1 and 300),
  body_text            text not null check (length(body_text) between 1 and 10000),
  from_name            text,
  reply_to             text,
  signature_text       text,
  content_version      text not null default '1',
  content_hash         text not null,
  status               text not null default 'queued'
                         check (status in ('queued', 'executing', 'submitted', 'failed', 'unknown')),
  failure_class        text check (failure_class is null or length(failure_class) <= 120),
  provider_message_id  text,
  provider_thread_id   text,
  submitted_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, request_id),
  unique (tenant_id, id),
  constraint md_sender_fk foreign key (tenant_id, sender_profile_id)
    references marketing_sender_profiles (tenant_id, id) on delete cascade,
  constraint md_intent_fk foreign key (tenant_id, automation_intent_id)
    references automation_intents (tenant_id, id) on delete cascade,
  constraint md_actor_fk foreign key (tenant_id, actor_profile_id)
    references profiles (tenant_id, id) on delete set null (actor_profile_id),
  constraint md_recipient_fk foreign key (tenant_id, recipient_profile_id)
    references profiles (tenant_id, id) on delete set null (recipient_profile_id),
  constraint md_person_fk foreign key (tenant_id, person_id)
    references people (tenant_id, id) on delete set null (person_id),
  -- the attempt must belong to the SAME tenant AND the SAME intent
  constraint md_attempt_fk foreign key (tenant_id, automation_intent_id, execution_attempt_id)
    references automation_execution_attempts (tenant_id, automation_intent_id, id)
    on delete set null (execution_attempt_id)
);
create index marketing_deliveries_idx
  on marketing_deliveries (tenant_id, purpose, created_at desc);
create index marketing_deliveries_status_idx
  on marketing_deliveries (tenant_id, status);
-- lets a delivery EVENT composite-bind to its delivery's EXACT intent (the
-- three columns together are the reference target of mde_delivery_fk below)
create unique index marketing_deliveries_tenant_id_intent_uk
  on marketing_deliveries (tenant_id, id, automation_intent_id);
create trigger marketing_deliveries_set_updated_at
  before update on marketing_deliveries
  for each row execute function set_updated_at();

-- FACTUAL delivery guard (shape + evidence, honestly stated: it cannot know
-- its caller — it makes UNTRUE states impossible for every caller, including
-- the service role, on INSERT as well as UPDATE):
--  * INSERT: a delivery is BORN 'queued' with NO execution attempt, NO
--    provider facts, NO submission time and NO failure classification; it
--    must reference a same-tenant PENDING intent of the Phase-4 test type and
--    Marketing capability, and must AGREE with EVERY corresponding frozen
--    envelope value (delivery id, sender, recipient profile + email, actor,
--    request id, purpose, subject, body, from name / reply-to / signature
--    with null semantics, content version, content hash) plus the intent
--    row's correlation id; the request fingerprint is RECOMPUTED through the
--    canonical marketing_request_fingerprint formula, never trusted for its
--    shape. The service role's INSERT privilege can therefore never
--    fabricate a submitted/failed/executing/unknown delivery, import foreign
--    facts, or pair a legitimate content hash with different content;
--  * identity/lineage/content/fingerprint are pinned on every update;
--  * execution_attempt_id and failure_class may only CHANGE together with a
--    factual status transition — never on a status-preserving update — so a
--    terminal delivery's cited attempt and failure facts are pinned forever
--    (submitted/failed have no legal outgoing transition);
--  * every status transition must agree with the CURRENT engine state of the
--    delivery's own intent:
--      queued    ⇐ intent pending|failed        (awaiting/retrying)
--      executing ⇐ intent claimed|executing
--      submitted ⇐ intent succeeded  + a same-tenant SAME-INTENT attempt with
--                  status 'succeeded' whose external_reference equals the
--                  recorded provider_message_id (thread id agreeing where the
--                  attempt recorded one) + submitted_at present + NO failure
--                  classification
--      failed    ⇐ intent failed|expired|cancelled|rejected + a failure
--                  classification (an attached attempt must itself be a
--                  failure record OF THIS INTENT)
--      unknown   ⇐ intent unknown
--  * provider_message_id / provider_thread_id / submitted_at are WRITE-ONCE
--    and may only be SET by the transition INTO submitted itself (an
--    already-submitted row can never grow new provider facts);
--  * submitted and failed are terminal (unknown resolves only through the
--    engine's appended reconciliation, which moves the intent first).
create or replace function marketing_delivery_guard()
returns trigger language plpgsql as $$
declare
  v_intent automation_intents%rowtype;
  v_intent_status text;
  v_att automation_execution_attempts%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'queued' then
      raise exception 'a delivery must be created queued — % is not a creatable state',
        new.status;
    end if;
    if new.execution_attempt_id is not null
       or new.provider_message_id is not null
       or new.provider_thread_id is not null
       or new.submitted_at is not null
       or new.failure_class is not null then
      raise exception 'a new delivery cannot carry execution, provider or failure facts';
    end if;
    select * into v_intent from automation_intents
     where id = new.automation_intent_id and tenant_id = new.tenant_id;
    if not found then
      raise exception 'a delivery requires its same-tenant automation intent';
    end if;
    if v_intent.status <> 'pending' then
      raise exception 'a new delivery requires a PENDING intent (intent is %)',
        v_intent.status;
    end if;
    if v_intent.intent_type is distinct from 'send_marketing_test_email'
       or v_intent.capability_key is distinct from 'email.send_marketing' then
      raise exception 'a delivery requires the Phase-4 test intent and Marketing capability';
    end if;
    -- the intent's FROZEN envelope is the authority — EVERY persisted field
    -- must agree exactly (null semantics included). A copied legitimate
    -- content_hash can never smuggle in different persisted content: what
    -- the adapter will send and what this row records are the same bytes.
    if v_intent.parameters ->> 'delivery_id' is distinct from new.id::text
       or v_intent.parameters ->> 'sender_profile_id' is distinct from new.sender_profile_id::text
       or v_intent.parameters ->> 'recipient_profile_id' is distinct from new.recipient_profile_id::text
       or v_intent.parameters ->> 'recipient_email' is distinct from new.recipient_email
       or v_intent.parameters ->> 'actor_profile_id' is distinct from new.actor_profile_id::text
       or v_intent.parameters ->> 'request_id' is distinct from new.request_id
       or v_intent.parameters ->> 'purpose' is distinct from new.purpose
       or v_intent.parameters ->> 'subject' is distinct from new.subject
       or v_intent.parameters ->> 'body_text' is distinct from new.body_text
       or v_intent.parameters ->> 'from_name' is distinct from new.from_name
       or v_intent.parameters ->> 'reply_to' is distinct from new.reply_to
       or v_intent.parameters ->> 'signature_text' is distinct from new.signature_text
       or v_intent.parameters ->> 'content_version' is distinct from new.content_version
       or v_intent.parameters ->> 'content_hash' is distinct from new.content_hash then
      raise exception 'a delivery must agree with its intent''s frozen envelope';
    end if;
    -- correlation binds to the INTENT ROW's correlation, not a caller value
    if v_intent.correlation_id is distinct from new.correlation_id then
      raise exception 'a delivery must carry its intent''s correlation id';
    end if;
    -- the request fingerprint is RECOMPUTED through the one canonical
    -- formula — a shape-valid 64-hex caller value is never trusted
    if new.request_fingerprint is distinct from marketing_request_fingerprint(
         new.request_id, new.actor_profile_id, new.sender_profile_id,
         new.recipient_profile_id, new.content_hash) then
      raise exception 'the request fingerprint must equal its canonical recomputation';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.sender_profile_id is distinct from old.sender_profile_id
     or new.purpose is distinct from old.purpose
     -- actor/recipient/person refs are pinned EXCEPT their genuine FK set-null
     or (new.actor_profile_id is distinct from old.actor_profile_id
         and not (new.actor_profile_id is null and old.actor_profile_id is not null))
     or (new.recipient_profile_id is distinct from old.recipient_profile_id
         and not (new.recipient_profile_id is null and old.recipient_profile_id is not null))
     or (new.person_id is distinct from old.person_id
         and not (new.person_id is null and old.person_id is not null))
     or new.recipient_email is distinct from old.recipient_email
     or new.automation_intent_id is distinct from old.automation_intent_id
     or new.request_id is distinct from old.request_id
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.correlation_id is distinct from old.correlation_id
     or new.subject is distinct from old.subject
     or new.body_text is distinct from old.body_text
     or new.from_name is distinct from old.from_name
     or new.reply_to is distinct from old.reply_to
     or new.signature_text is distinct from old.signature_text
     or new.content_version is distinct from old.content_version
     or new.content_hash is distinct from old.content_hash
     or new.created_at is distinct from old.created_at then
    raise exception 'delivery identity, lineage and submitted content are immutable';
  end if;
  if old.provider_message_id is not null
     and new.provider_message_id is distinct from old.provider_message_id then
    raise exception 'a recorded provider message id is immutable';
  end if;
  if old.provider_thread_id is not null
     and new.provider_thread_id is distinct from old.provider_thread_id then
    raise exception 'a recorded provider thread id is immutable';
  end if;
  if old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at then
    raise exception 'a recorded submission time is immutable';
  end if;
  -- provider facts may only be SET by the transition INTO submitted itself —
  -- an already-submitted delivery can never grow a new provider fact either
  if (old.provider_message_id is null and new.provider_message_id is not null
      or old.provider_thread_id is null and new.provider_thread_id is not null
      or old.submitted_at is null and new.submitted_at is not null)
     and not (new.status = 'submitted' and old.status is distinct from new.status) then
    raise exception 'provider facts may only be recorded by a confirmed submission';
  end if;
  -- the cited attempt and the failure classification are FACTS of a
  -- transition: on a status-preserving update they are pinned — which also
  -- pins them FOREVER once the delivery is terminal (submitted/failed have no
  -- legal outgoing transition below)
  if new.status is not distinct from old.status then
    if new.execution_attempt_id is distinct from old.execution_attempt_id then
      raise exception 'the cited execution attempt may only change through a factual status transition';
    end if;
    if new.failure_class is distinct from old.failure_class then
      raise exception 'a failure classification may only change through a factual status transition';
    end if;
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'queued' and new.status in ('executing', 'submitted', 'failed', 'unknown'))
         or (old.status = 'executing' and new.status in ('queued', 'submitted', 'failed', 'unknown'))
         or (old.status = 'unknown' and new.status in ('submitted', 'failed'))) then
      raise exception 'illegal delivery status transition % -> %', old.status, new.status;
    end if;
    -- FACTUAL anchoring: the transition must agree with the engine's state
    select status into v_intent_status from automation_intents
     where id = new.automation_intent_id and tenant_id = new.tenant_id;
    if v_intent_status is null then
      raise exception 'delivery transition requires its automation intent';
    end if;
    if new.status = 'queued' and v_intent_status not in ('pending', 'failed') then
      raise exception 'a queued delivery requires a pending/retrying intent (intent is %)',
        v_intent_status;
    end if;
    if new.status = 'executing' and v_intent_status not in ('claimed', 'executing') then
      raise exception 'an executing delivery requires a claimed/executing intent (intent is %)',
        v_intent_status;
    end if;
    if new.status = 'unknown' and v_intent_status <> 'unknown' then
      raise exception 'an unknown delivery requires an unknown intent (intent is %)',
        v_intent_status;
    end if;
    if new.status = 'failed' then
      if v_intent_status not in ('failed', 'expired', 'cancelled', 'rejected') then
        raise exception 'a failed delivery requires a terminally failed intent (intent is %)',
          v_intent_status;
      end if;
      if new.failure_class is null then
        raise exception 'a failed delivery requires its failure classification';
      end if;
      if new.execution_attempt_id is not null then
        -- the cited failure evidence must be an attempt of THIS delivery's
        -- OWN intent (the composite FK enforces the same structurally)
        select * into v_att from automation_execution_attempts
         where id = new.execution_attempt_id and tenant_id = new.tenant_id
           and automation_intent_id = new.automation_intent_id;
        if v_att.id is null
           or v_att.status not in ('failed_permanent', 'failed_transient', 'unknown') then
          raise exception 'a failed delivery cannot cite a non-failure attempt as evidence';
        end if;
      end if;
    end if;
    if new.status = 'submitted' then
      if new.failure_class is not null then
        raise exception 'a submitted delivery cannot carry a failure classification';
      end if;
      if v_intent_status <> 'succeeded' then
        raise exception 'a submitted delivery requires a succeeded intent (intent is %)',
          v_intent_status;
      end if;
      if new.execution_attempt_id is null then
        raise exception 'a submitted delivery requires its succeeded execution attempt';
      end if;
      select * into v_att from automation_execution_attempts
       where id = new.execution_attempt_id and tenant_id = new.tenant_id
         and automation_intent_id = new.automation_intent_id;
      if v_att.id is null then
        raise exception 'the cited execution attempt does not belong to this delivery''s intent';
      end if;
      if v_att.status <> 'succeeded' then
        raise exception 'a submitted delivery requires a SUCCEEDED attempt (attempt is %)',
          v_att.status;
      end if;
      if new.provider_message_id is null or new.submitted_at is null then
        raise exception 'a submitted delivery requires provider message id + submission time';
      end if;
      if v_att.external_reference is distinct from new.provider_message_id then
        raise exception 'provider message id must equal the attempt''s external reference';
      end if;
      if nullif(v_att.result ->> 'thread_id', '') is not null
         and new.provider_thread_id is distinct from nullif(v_att.result ->> 'thread_id', '') then
        raise exception 'provider thread id must agree with the attempt''s recorded thread';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger marketing_deliveries_guard
  before insert or update on marketing_deliveries
  for each row execute function marketing_delivery_guard();

-- Delivery events: the APPEND-ONLY factual history of one delivery. Every
-- event is structurally bound to its delivery's EXACT intent (composite FK
-- through the delivery's (tenant, id, intent) key) and any cited attempt is
-- structurally bound to that SAME tenant AND SAME intent — an attempt from
-- another intent (even same-tenant) is impossible by shape. The insert guard
-- additionally makes FICTIONAL history impossible for every caller: to_status
-- must equal the delivery's ACTUAL current status, a cited attempt must be
-- the delivery's own recorded attempt, the first event is the single
-- null→queued record, and every later event must continue the recorded chain
-- (from_status = the previous event's to_status; seq is guard-assigned).
create table marketing_delivery_events (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id) on delete cascade,
  delivery_id          uuid not null,
  automation_intent_id uuid not null,
  seq                  int not null check (seq >= 1),
  from_status          text,
  to_status            text not null,
  detail               text check (detail is null or length(detail) <= 300),
  execution_attempt_id uuid,
  created_at           timestamptz not null default now(),
  unique (tenant_id, delivery_id, seq),
  constraint mde_delivery_fk foreign key (tenant_id, delivery_id, automation_intent_id)
    references marketing_deliveries (tenant_id, id, automation_intent_id) on delete cascade,
  -- the attempt must belong to the SAME tenant AND the SAME intent as the
  -- delivery this event describes
  constraint mde_attempt_fk foreign key (tenant_id, automation_intent_id, execution_attempt_id)
    references automation_execution_attempts (tenant_id, automation_intent_id, id)
    on delete set null (execution_attempt_id)
);
create index marketing_delivery_events_idx
  on marketing_delivery_events (tenant_id, delivery_id, created_at);
-- exactly ONE initial (null-origin) event per delivery, structurally
create unique index marketing_delivery_events_initial_uk
  on marketing_delivery_events (tenant_id, delivery_id)
  where from_status is null;

create or replace function marketing_delivery_event_guard()
returns trigger language plpgsql as $$
declare
  v_d marketing_deliveries%rowtype;
  v_prev marketing_delivery_events%rowtype;
begin
  select * into v_d from marketing_deliveries
   where id = new.delivery_id and tenant_id = new.tenant_id;
  if not found then
    raise exception 'a delivery event requires its same-tenant delivery';
  end if;
  if new.automation_intent_id is distinct from v_d.automation_intent_id then
    raise exception 'a delivery event must cite its delivery''s exact intent';
  end if;
  -- an event records the delivery's ACTUAL state, never a claimed one
  if new.to_status is distinct from v_d.status then
    raise exception 'a delivery event must record the delivery''s actual status (delivery is %, event claims %)',
      v_d.status, new.to_status;
  end if;
  if new.execution_attempt_id is not null
     and new.execution_attempt_id is distinct from v_d.execution_attempt_id then
    raise exception 'a delivery event may only cite its delivery''s own recorded attempt';
  end if;
  -- the chain: first event is null → queued; every later event continues the
  -- previously recorded state; seq is guard-assigned, never caller-chosen
  select * into v_prev from marketing_delivery_events
   where tenant_id = new.tenant_id and delivery_id = new.delivery_id
   order by seq desc limit 1;
  if not found then
    if new.from_status is not null or new.to_status <> 'queued' then
      raise exception 'the first delivery event must be the initial null -> queued record';
    end if;
    new.seq := 1;
  else
    if new.from_status is distinct from v_prev.to_status then
      raise exception 'a delivery event must continue the recorded history (last recorded %, event claims %)',
        v_prev.to_status, coalesce(new.from_status, '<null>');
    end if;
    new.seq := v_prev.seq + 1;
  end if;
  return new;
end $$;
create trigger marketing_delivery_events_guard
  before insert on marketing_delivery_events
  for each row execute function marketing_delivery_event_guard();
create trigger marketing_delivery_events_append_only_update
  before update on marketing_delivery_events
  for each row execute function marketing_history_append_only();
create trigger marketing_delivery_events_append_only_delete
  before delete on marketing_delivery_events
  for each row execute function marketing_history_append_only();

alter table marketing_deliveries enable row level security;
create policy marketing_deliveries_select on marketing_deliveries
  for select using (tenant_id = current_tenant_id()
                    and marketing_has_permission('marketing.view'));
alter table marketing_delivery_events enable row level security;
create policy marketing_delivery_events_select on marketing_delivery_events
  for select using (tenant_id = current_tenant_id()
                    and marketing_has_permission('marketing.view'));
grant select on marketing_deliveries, marketing_delivery_events to authenticated;
grant select, insert, update on marketing_deliveries to service_role;
grant select, insert on marketing_delivery_events to service_role;
revoke delete, truncate on marketing_deliveries from anon, authenticated, service_role;
revoke update, delete, truncate on marketing_delivery_events from anon, authenticated, service_role;

-- ── canonical outbound provenance (additive; written by the reconciler only;
--    STRUCTURALLY tenant-bound like every other Phase-4 reference) ──────────
alter table email_messages add column if not exists origin text
  check (origin is null or origin in ('marketing_delivery'));
alter table email_messages add column if not exists origin_delivery_id uuid;
alter table email_messages add column if not exists origin_automation_intent_id uuid;
alter table email_messages
  add constraint email_messages_origin_delivery_fk
  foreign key (tenant_id, origin_delivery_id)
  references marketing_deliveries (tenant_id, id) on delete set null (origin_delivery_id);
alter table email_messages
  add constraint email_messages_origin_intent_fk
  foreign key (tenant_id, origin_automation_intent_id)
  references automation_intents (tenant_id, id) on delete set null (origin_automation_intent_id);

-- ============================================================================
-- AUTOMATION ENGINE REGISTRATION (documented onboarding path; engine untouched)
-- ============================================================================
insert into automation_connector_capabilities
  (capability_key, description, external_side_effect, risk_category)
values
  ('email.send_marketing',
   'Send ONE governed marketing email through an authorised tenant sender (Gmail OAuth or Workspace DWD). External side effect: real mail leaves the building.',
   true, 'high')
on conflict (capability_key) do nothing;

insert into outcome_types (outcome_type, layer, description) values
  ('marketing_email_submitted', 'operational',
   'Gmail accepted a governed marketing email submission (submitted, NOT delivered)')
on conflict (outcome_type) do nothing;

insert into automation_capability_contracts
  (capability_key, outcome_type, outcome_layer, adapter_version)
values ('email.send_marketing', 'marketing_email_submitted', 'operational', '1')
on conflict (capability_key) do nothing;

-- TEST-ONLY intent type. requires_approval = FALSE is the HONEST model: the
-- explicit request of an actor holding marketing.campaigns.test IS the
-- delegated authority for one bounded test email to a tenant user — no
-- tenant-senior approval exists and none is fabricated. supports_status_lookup
-- = FALSE, honestly: Gmail has no reliable "did my send happen" lookup we are
-- prepared to register — a deterministic Message-ID search cannot prove
-- non-submission, so unknown results FREEZE for human review via the engine's
-- existing unknown-resolution path. Phase 5 bulk sends MUST register a
-- SEPARATE intent type whose package/approval model carries real review.
insert into automation_intent_types
  (intent_type, connector_capability, risk_category, external_side_effect,
   supports_idempotency, supports_status_lookup, requires_approval,
   default_expiry_seconds, schema_version, enabled)
values
  ('send_marketing_test_email', 'email.send_marketing', 'high', true,
   true, false, false, 3600, '1', true)
on conflict (intent_type) do nothing;

-- NO tenant_connector_capabilities rows are seeded here. Enablement is ONLY
-- via marketing_sender_capability_sync (an explicit, verified sender action).

-- ============================================================================
-- ACTOR GATE — owner/admin + canonical marketing.senders.manage
-- ============================================================================
create or replace function marketing_require_senders_actor(p_tenant uuid, p_actor uuid)
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
    raise exception 'sender administration requires an owner/admin actor'
      using errcode = '42501';
  end if;
  -- AUTHORITATIVE canonical resolver: a hostile raw grant can never bypass
  -- the owner/admin ceiling (the resolver itself enforces the restricted set).
  v_resolved := marketing_effective_permissions(p_actor);
  if not ((v_resolved -> 'permissions') ? 'marketing.senders.manage') then
    raise exception 'actor lacks marketing.senders.manage' using errcode = '42501';
  end if;
  return coalesce((select email from profiles where id = p_actor), p_actor::text);
end $$;

-- ============================================================================
-- DISCOVERED SOURCES — bounded, evidence-led (no tokens ever returned)
-- ============================================================================
create or replace function marketing_sender_sources(p_tenant uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_gmail jsonb;
  v_ws jsonb;
  v_conns jsonb;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  -- Gmail OAuth accounts: send-scope truth comes from the STORED GRANTED
  -- scopes (email_oauth_tokens.scope) — never inferred from account status.
  select coalesce(jsonb_agg(jsonb_build_object(
           'source_kind', 'gmail_oauth',
           'source_id', a.id,
           'email_address', a.email_address,
           'display_name', a.display_name,
           'status', a.status,
           'auth_state', a.auth_state,
           'has_send_scope',
             marketing_scope_has(t.scope, 'https://www.googleapis.com/auth/gmail.send'),
           'scope_known', t.scope is not null,
           'sender_profile_id', sp.id
         ) order by a.email_address), '[]'::jsonb)
    into v_gmail
    from email_accounts a
    left join email_oauth_tokens t
           on t.email_account_id = a.id and t.tenant_id = a.tenant_id
    left join marketing_sender_profiles sp
           on sp.tenant_id = a.tenant_id and sp.email_account_id = a.id
   where a.tenant_id = p_tenant and a.provider = 'gmail'
     and a.status not in ('pending_tokenless_dwd', 'active_dwd');

  -- Workspace DWD mailboxes: each mailbox reports ITS OWN connection (a
  -- tenant may hold several connections in different states). Send scope is
  -- UNKNOWN until a real delegated token mint verifies it.
  select coalesce(jsonb_agg(jsonb_build_object(
           'source_kind', 'workspace_dwd',
           'source_id', m.id,
           'email_address', m.email_address,
           'display_name', m.display_name,
           'status', m.status,
           'sync_enabled', m.sync_enabled,
           'connection_id', c.id,
           'connection_domain', c.domain,
           'connection_status', c.status,
           'sender_profile_id', sp.id
         ) order by m.email_address), '[]'::jsonb)
    into v_ws
    from google_workspace_mailboxes m
    join google_workspace_connections c on c.id = m.connection_id
    left join marketing_sender_profiles sp
           on sp.tenant_id = m.tenant_id and sp.workspace_mailbox_id = m.id
   where m.tenant_id = p_tenant and c.tenant_id = p_tenant
     and c.status = 'active' and m.status = 'active';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'status', c.status, 'domain', c.domain,
           'last_verified_at', c.last_verified_at,
           'requested_scopes', to_jsonb(c.authorised_scopes),
           'error_message', c.error_message) order by c.created_at), '[]'::jsonb)
    into v_conns
    from google_workspace_connections c
   where c.tenant_id = p_tenant;

  return jsonb_build_object(
    'gmail_accounts', v_gmail,
    'workspace_mailboxes', v_ws,
    'workspace_connections', v_conns);
end $$;

-- ============================================================================
-- SENDER LIFECYCLE RPCs
-- ============================================================================
create or replace function marketing_sender_create(p_tenant uuid, p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_label_actor text;
  v_kind text;
  v_source uuid;
  v_addr text;
  v_key text;
  v_existing marketing_sender_profiles%rowtype;
  v_row marketing_sender_profiles%rowtype;
  v_scope_state text := 'unknown';
  v_scope text;
  v_reply_to text;
begin
  v_label_actor := marketing_require_senders_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('source_kind', 'source_id', 'label', 'from_name', 'reply_to',
                     'signature_text') then
      raise exception 'unknown create argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_kind := p_args ->> 'source_kind';
  if v_kind is null or v_kind not in ('gmail_oauth', 'workspace_dwd') then
    raise exception 'source_kind must be gmail_oauth|workspace_dwd' using errcode = '22023';
  end if;
  begin
    v_source := (p_args ->> 'source_id')::uuid;
  exception when others then
    raise exception 'invalid source id' using errcode = '22023';
  end;
  if v_source is null then
    raise exception 'source_id required' using errcode = '22023';
  end if;
  if (p_args ? 'label') and jsonb_typeof(p_args -> 'label') <> 'string'
     or (p_args ? 'from_name') and jsonb_typeof(p_args -> 'from_name') <> 'string'
     or (p_args ? 'reply_to') and jsonb_typeof(p_args -> 'reply_to') <> 'string'
     or (p_args ? 'signature_text') and jsonb_typeof(p_args -> 'signature_text') <> 'string' then
    raise exception 'invalid create argument types' using errcode = '22023';
  end if;
  -- header-bound fields are validated at WRITE time, not just before sending
  v_reply_to := marketing_sender_text_guard('reply_to', p_args ->> 'reply_to');
  if v_reply_to is not null
     and v_reply_to !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'reply_to must be a plausible email address' using errcode = '22023';
  end if;

  -- serialise per (tenant, source) so a duplicate create is deterministic
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|sender|' || v_kind || '|' || v_source::text, 42));

  if v_kind = 'gmail_oauth' then
    select lower(a.email_address), t.scope into v_addr, v_scope
      from email_accounts a
      left join email_oauth_tokens t
             on t.email_account_id = a.id and t.tenant_id = a.tenant_id
     where a.id = v_source and a.tenant_id = p_tenant and a.provider = 'gmail'
       and a.status not in ('pending_tokenless_dwd', 'active_dwd');
    if not found or v_addr is null then
      raise exception 'gmail account not found for tenant' using errcode = 'P0002';
    end if;
    v_scope_state := case
      when v_scope is null then 'unknown'
      when marketing_scope_has(v_scope, 'https://www.googleapis.com/auth/gmail.send')
        then 'authorized'
      else 'missing' end;
    select * into v_existing from marketing_sender_profiles
     where tenant_id = p_tenant and email_account_id = v_source;
  else
    select lower(m.email_address) into v_addr
      from google_workspace_mailboxes m
      join google_workspace_connections c on c.id = m.connection_id
     where m.id = v_source and m.tenant_id = p_tenant and c.tenant_id = p_tenant
       and c.status = 'active' and m.status = 'active';
    if not found or v_addr is null then
      raise exception 'workspace mailbox not found or not active for tenant'
        using errcode = 'P0002';
    end if;
    -- DWD send scope is verifiable only by a real delegated mint — stays unknown
    select * into v_existing from marketing_sender_profiles
     where tenant_id = p_tenant and workspace_mailbox_id = v_source;
  end if;

  if v_existing.id is not null then
    -- deterministic idempotency: the same source mailbox returns its profile
    return jsonb_build_object('id', v_existing.id, 'created', false,
      'mailbox_address', v_existing.mailbox_address,
      'send_scope_state', v_existing.send_scope_state,
      'enabled', v_existing.enabled, 'updated_at', v_existing.updated_at);
  end if;

  insert into marketing_sender_profiles
    (tenant_id, source_kind, email_account_id, workspace_mailbox_id, mailbox_address,
     label, from_name, reply_to, signature_text,
     send_scope_state, scope_checked_at, created_by, updated_by)
  values
    (p_tenant, v_kind,
     case when v_kind = 'gmail_oauth' then v_source end,
     case when v_kind = 'workspace_dwd' then v_source end,
     v_addr,
     left(coalesce(marketing_sender_text_guard('label', p_args ->> 'label'), v_addr), 80),
     marketing_sender_text_guard('from_name', p_args ->> 'from_name'),
     v_reply_to,
     marketing_sender_text_guard('signature_text', p_args ->> 'signature_text', true),
     v_scope_state, case when v_scope_state <> 'unknown' then now() end,
     p_actor, p_actor)
  returning * into v_row;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label_actor, 'marketing.sender.created', 'marketing_sender',
          v_row.id::text, 'ok',
          jsonb_build_object('source_kind', v_kind, 'mailbox', v_addr));
  perform marketing_event_append(p_tenant, 'marketing.sender.updated', 'marketing_sender',
    v_row.id, 'marketing-senders',
    jsonb_build_object('k', 'created:' || v_row.id, 'op', 'created',
                       'actor', v_label_actor, 'at', now()));

  return jsonb_build_object('id', v_row.id, 'created', true,
    'mailbox_address', v_row.mailbox_address,
    'send_scope_state', v_row.send_scope_state,
    'enabled', v_row.enabled, 'updated_at', v_row.updated_at);
end $$;

create or replace function marketing_sender_update(
  p_tenant uuid, p_actor uuid, p_sender uuid, p_changes jsonb, p_expected timestamptz
) returns jsonb
language plpgsql
as $$
declare
  v_label_actor text;
  v_row marketing_sender_profiles%rowtype;
  v_key text;
  v_changed text[] := '{}';
  v_reply_to text;
begin
  v_label_actor := marketing_require_senders_actor(p_tenant, p_actor);
  if p_sender is null or p_expected is null then
    raise exception 'sender and expected_updated_at required' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'changes must be a non-empty object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('label', 'from_name', 'reply_to', 'signature_text') then
      raise exception 'unknown sender change %', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(p_changes -> v_key) not in ('string', 'null') then
      raise exception 'sender change % must be a string or null', v_key using errcode = '22023';
    end if;
  end loop;
  select * into v_row from marketing_sender_profiles
   where id = p_sender and tenant_id = p_tenant for update;
  if not found then
    raise exception 'sender not found for tenant' using errcode = 'P0002';
  end if;
  if v_row.updated_at is distinct from p_expected then
    raise exception 'sender changed since it was read' using errcode = 'MK409';
  end if;
  -- header-bound fields validated at WRITE time (control chars, CR/LF, format)
  v_reply_to := marketing_sender_text_guard('reply_to', p_changes ->> 'reply_to');
  if p_changes ? 'reply_to' and v_reply_to is not null
     and v_reply_to !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'reply_to must be a plausible email address' using errcode = '22023';
  end if;

  update marketing_sender_profiles p set
    label = case when p_changes ? 'label'
      then left(coalesce(marketing_sender_text_guard('label', p_changes ->> 'label'),
                         p.mailbox_address), 80)
      else p.label end,
    from_name = case when p_changes ? 'from_name'
      then marketing_sender_text_guard('from_name', p_changes ->> 'from_name')
      else p.from_name end,
    reply_to = case when p_changes ? 'reply_to' then v_reply_to else p.reply_to end,
    signature_text = case when p_changes ? 'signature_text'
      then marketing_sender_text_guard('signature_text', p_changes ->> 'signature_text', true)
      else p.signature_text end,
    updated_by = p_actor
  where p.id = p_sender
  returning * into v_row;

  select array_agg(k) into v_changed from jsonb_object_keys(p_changes) k;
  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label_actor, 'marketing.sender.updated', 'marketing_sender',
          p_sender::text, 'ok', jsonb_build_object('changed', to_jsonb(v_changed)));

  return jsonb_build_object('id', v_row.id, 'label', v_row.label,
    'from_name', v_row.from_name, 'reply_to', v_row.reply_to,
    'signature_text', v_row.signature_text, 'updated_at', v_row.updated_at);
end $$;

-- capability enablement derived ONLY from AUTHORITATIVE readiness of enabled
-- senders (never merely from an enabled sender row). Health is reported only
-- where the source state supports it; otherwise the bounded 'unknown'.
create or replace function marketing_sender_capability_sync(p_tenant uuid)
returns jsonb
language plpgsql
as $$
declare
  v_ready int;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  select count(*) into v_ready from marketing_sender_profiles p
   where p.tenant_id = p_tenant and p.enabled
     and (marketing_sender_readiness(p_tenant, p.id) ->> 'ready')::boolean;
  if v_ready > 0 then
    insert into tenant_connectors
      (tenant_id, connector_id, provider, category, status, health_status, enabled)
    values (p_tenant, 'google-gmail', 'google', 'communications', 'active', 'healthy', true)
    on conflict (tenant_id, connector_id) do update
      set enabled = true, status = 'active', health_status = 'healthy';
  else
    update tenant_connector_capabilities set enabled = false
     where tenant_id = p_tenant and connector_id = 'google-gmail'
       and capability_key = 'email.send_marketing';
    update tenant_connectors set enabled = false, health_status = 'unknown'
     where tenant_id = p_tenant and connector_id = 'google-gmail'
       and not exists (select 1 from tenant_connector_capabilities c
                        where c.tenant_id = p_tenant and c.connector_id = 'google-gmail'
                          and c.enabled);
    return jsonb_build_object('ready_senders', 0, 'capability_enabled', false);
  end if;
  insert into tenant_connector_capabilities (tenant_id, connector_id, capability_key, enabled)
  values (p_tenant, 'google-gmail', 'email.send_marketing', true)
  on conflict (tenant_id, connector_id, capability_key) do update set enabled = true;
  return jsonb_build_object('ready_senders', v_ready, 'capability_enabled', true);
end $$;

-- ── SELF-REFRESHING capability truth ─────────────────────────────────────────
-- Capability state must never depend on someone remembering to call the sync
-- RPC: any relevant change to AUTHORITATIVE SOURCE STATE re-derives it in the
-- same transaction. Narrowly scoped: the trigger body exits immediately for
-- tenants with NO Marketing sender profile (one indexed existence probe), so
-- ordinary ingestion token refreshes on non-Marketing tenants are untouched.
-- Covered changes: Gmail account status/auth-state/address; OAuth token
-- insert/update/delete (scope + token state); Workspace mailbox
-- status/address/connection; Workspace connection status; and the FK set-null
-- a sender suffers when its source row is deleted. The overview additionally
-- re-syncs before reading, and the request RPC + adapter still re-derive
-- readiness independently — the trigger is a floor, not the only check.
create or replace function marketing_source_capability_sync()
returns trigger language plpgsql as $$
declare
  v_tenant uuid;
begin
  if tg_op = 'DELETE' then
    v_tenant := old.tenant_id;
  else
    v_tenant := new.tenant_id;
  end if;
  if v_tenant is not null
     and exists (select 1 from marketing_sender_profiles p
                  where p.tenant_id = v_tenant) then
    perform marketing_sender_capability_sync(v_tenant);
  end if;
  return null;
end $$;

create trigger marketing_capability_sync_email_accounts
  after update of status, auth_state, email_address on email_accounts
  for each row
  when (old.status is distinct from new.status
        or old.auth_state is distinct from new.auth_state
        or old.email_address is distinct from new.email_address)
  execute function marketing_source_capability_sync();
create trigger marketing_capability_sync_tokens_ins
  after insert on email_oauth_tokens
  for each row execute function marketing_source_capability_sync();
create trigger marketing_capability_sync_tokens_upd
  after update on email_oauth_tokens
  for each row
  when (old.scope is distinct from new.scope
        or (old.access_token is null) is distinct from (new.access_token is null))
  execute function marketing_source_capability_sync();
create trigger marketing_capability_sync_tokens_del
  after delete on email_oauth_tokens
  for each row execute function marketing_source_capability_sync();
create trigger marketing_capability_sync_ws_mailboxes
  after update of status, email_address, connection_id on google_workspace_mailboxes
  for each row
  when (old.status is distinct from new.status
        or old.email_address is distinct from new.email_address
        or old.connection_id is distinct from new.connection_id)
  execute function marketing_source_capability_sync();
create trigger marketing_capability_sync_ws_connections
  after update of status on google_workspace_connections
  for each row
  when (old.status is distinct from new.status)
  execute function marketing_source_capability_sync();
-- source deletion reaches the sender as the FK set-null of its source ref
create trigger marketing_capability_sync_sender_source_lost
  after update on marketing_sender_profiles
  for each row
  when ((old.email_account_id is not null and new.email_account_id is null)
        or (old.workspace_mailbox_id is not null and new.workspace_mailbox_id is null))
  execute function marketing_source_capability_sync();

create or replace function marketing_sender_set_enabled(
  p_tenant uuid, p_actor uuid, p_sender uuid, p_enabled boolean, p_expected timestamptz
) returns jsonb
language plpgsql
as $$
declare
  v_label_actor text;
  v_row marketing_sender_profiles%rowtype;
  v_settings marketing_settings%rowtype;
  v_default_cleared boolean := false;
  v_sync jsonb;
  v_rd jsonb;
begin
  v_label_actor := marketing_require_senders_actor(p_tenant, p_actor);
  if p_sender is null or p_enabled is null or p_expected is null then
    raise exception 'sender, enabled and expected_updated_at required' using errcode = '22023';
  end if;
  select * into v_row from marketing_sender_profiles
   where id = p_sender and tenant_id = p_tenant for update;
  if not found then
    raise exception 'sender not found for tenant' using errcode = 'P0002';
  end if;
  if v_row.updated_at is distinct from p_expected then
    raise exception 'sender changed since it was read' using errcode = 'MK409';
  end if;
  if v_row.enabled = p_enabled then
    raise exception 'sender is already %', case when p_enabled then 'enabled' else 'disabled' end
      using errcode = '22023';
  end if;

  if p_enabled then
    -- enabling an EXTERNAL sender demands CURRENT authoritative readiness
    -- (live source facts + scope evidence) — never a cached sender column
    v_rd := marketing_sender_readiness(p_tenant, p_sender);
    if not (v_rd ->> 'ready')::boolean then
      raise exception 'sender is not ready to send (%) — resolve that before enabling',
        v_rd ->> 'state' using errcode = '22023';
    end if;
  else
    -- disabling: if this sender is the tenant default, clear the default FIRST
    -- (atomic, versioned, audited) so a disabled default can never linger
    select * into v_settings from marketing_settings
     where tenant_id = p_tenant for update;
    if found and v_settings.default_sender_profile_id = p_sender then
      insert into marketing_settings_history
        (tenant_id, settings_id, version, snapshot, changed, changed_by)
      values (p_tenant, v_settings.id, v_settings.version, to_jsonb(v_settings),
              array['default_sender_profile_id'], p_actor);
      update marketing_settings s
         set default_sender_profile_id = null, version = s.version + 1, updated_by = p_actor
       where s.tenant_id = p_tenant;
      v_default_cleared := true;
    end if;
  end if;

  update marketing_sender_profiles p
     set enabled = p_enabled, updated_by = p_actor
   where p.id = p_sender
  returning * into v_row;

  v_sync := marketing_sender_capability_sync(p_tenant);

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label_actor,
          case when p_enabled then 'marketing.sender.enabled' else 'marketing.sender.disabled' end,
          'marketing_sender', p_sender::text, 'ok',
          jsonb_build_object('default_cleared', v_default_cleared,
                             'capability', v_sync));
  perform marketing_event_append(p_tenant, 'marketing.sender.updated', 'marketing_sender',
    p_sender, 'marketing-senders',
    jsonb_build_object('k', (case when p_enabled then 'enabled:' else 'disabled:' end)
                            || p_sender || ':' || clock_timestamp()::text,
                       'op', case when p_enabled then 'enabled' else 'disabled' end,
                       'actor', v_label_actor, 'at', now()));

  return jsonb_build_object('id', v_row.id, 'enabled', v_row.enabled,
    'default_cleared', v_default_cleared, 'capability', v_sync,
    'updated_at', v_row.updated_at);
end $$;

create or replace function marketing_sender_set_default(
  p_tenant uuid, p_actor uuid, p_sender uuid, p_expected timestamptz
) returns jsonb
language plpgsql
as $$
declare
  v_label_actor text;
  v_row marketing_sender_profiles%rowtype;
  v_settings marketing_settings%rowtype;
begin
  v_label_actor := marketing_require_senders_actor(p_tenant, p_actor);
  if p_sender is null or p_expected is null then
    raise exception 'sender and expected_updated_at required' using errcode = '22023';
  end if;
  select * into v_row from marketing_sender_profiles
   where id = p_sender and tenant_id = p_tenant for update;
  if not found then
    raise exception 'sender not found for tenant' using errcode = 'P0002';
  end if;
  if v_row.updated_at is distinct from p_expected then
    raise exception 'sender changed since it was read' using errcode = 'MK409';
  end if;
  if not v_row.enabled then
    raise exception 'only an enabled sender can be the default' using errcode = '22023';
  end if;
  select * into v_settings from marketing_settings
   where tenant_id = p_tenant for update;
  if not found then
    raise exception 'marketing settings are not materialised for this tenant'
      using errcode = 'P0002';
  end if;
  if v_settings.default_sender_profile_id = p_sender then
    raise exception 'this sender is already the default' using errcode = '22023';
  end if;

  insert into marketing_settings_history
    (tenant_id, settings_id, version, snapshot, changed, changed_by)
  values (p_tenant, v_settings.id, v_settings.version, to_jsonb(v_settings),
          array['default_sender_profile_id'], p_actor);
  update marketing_settings s
     set default_sender_profile_id = p_sender, version = s.version + 1, updated_by = p_actor
   where s.tenant_id = p_tenant;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label_actor, 'marketing.sender.default_set', 'marketing_sender',
          p_sender::text, 'ok',
          jsonb_build_object('previous', v_settings.default_sender_profile_id));
  perform marketing_event_append(p_tenant, 'marketing.sender.updated', 'marketing_sender',
    p_sender, 'marketing-senders',
    jsonb_build_object('k', 'default:' || p_sender || ':' || (v_settings.version + 1),
                       'op', 'default_set', 'actor', v_label_actor, 'at', now()));

  return jsonb_build_object('id', p_sender, 'default', true,
    'settings_version', v_settings.version + 1);
end $$;

-- server-side verification recorder: the EDGE performs the real provider
-- check (token scope inspection / an actual DWD send-scope token mint) and
-- records ONLY the derived evidence here. Browsers never call this. For DWD
-- this recorded evidence is a READINESS INPUT (a mint is the only proof);
-- for OAuth the live stored grant remains the authority.
create or replace function marketing_sender_record_verification(
  p_tenant uuid, p_sender uuid, p_state text, p_note text, p_verified_at timestamptz
) returns jsonb
language plpgsql
as $$
declare
  v_row marketing_sender_profiles%rowtype;
  v_sync jsonb;
begin
  if p_tenant is null or p_sender is null then
    raise exception 'tenant and sender required' using errcode = '22023';
  end if;
  if p_state is null or p_state not in ('authorized', 'missing', 'unknown') then
    raise exception 'state must be authorized|missing|unknown' using errcode = '22023';
  end if;
  if p_note is not null and length(p_note) > 300 then
    raise exception 'verification note is bounded to 300 chars' using errcode = '22023';
  end if;
  select * into v_row from marketing_sender_profiles
   where id = p_sender and tenant_id = p_tenant for update;
  if not found then
    raise exception 'sender not found for tenant' using errcode = 'P0002';
  end if;

  update marketing_sender_profiles p set
    send_scope_state = p_state,
    scope_checked_at = now(),
    last_verified_at = coalesce(p_verified_at, case when p_state = 'authorized' then now()
                                                    else p.last_verified_at end),
    verification_note = p_note
  where p.id = p_sender
  returning * into v_row;

  -- losing send authorisation while enabled makes the sender un-executable at
  -- the capability layer too (the adapter also rechecks at execution time)
  v_sync := marketing_sender_capability_sync(p_tenant);

  return jsonb_build_object('id', v_row.id, 'send_scope_state', v_row.send_scope_state,
    'scope_checked_at', v_row.scope_checked_at, 'last_verified_at', v_row.last_verified_at,
    'readiness', marketing_sender_readiness(p_tenant, p_sender),
    'capability', v_sync, 'updated_at', v_row.updated_at);
end $$;

-- ============================================================================
-- TEST SEND — canonical immutable lineage through the UNTOUCHED engine.
-- Authority: the actor's canonical marketing.campaigns.test permission — a
-- delegated, bounded test action. NO approval row exists or is fabricated.
-- ============================================================================
create or replace function marketing_test_send_request(p_tenant uuid, p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_resolved jsonb;
  v_actor_label text;
  v_key text;
  v_sender marketing_sender_profiles%rowtype;
  v_recipient profiles%rowtype;
  v_settings marketing_settings%rowtype;
  v_request_id text;
  v_subject text;
  v_body text;
  v_existing marketing_deliveries%rowtype;
  v_minute int;
  v_hour int;
  v_action uuid := gen_random_uuid();
  v_decision uuid := gen_random_uuid();
  v_intent uuid := gen_random_uuid();
  v_delivery uuid := gen_random_uuid();
  v_correlation uuid := gen_random_uuid();
  v_hash text;
  v_fp text;
  v_rd jsonb;
  v_mode text;
  v_pkg jsonb;
  v_params jsonb;
begin
  -- actor: same-tenant profile holding CANONICAL marketing.campaigns.test
  if p_tenant is null or p_actor is null then
    raise exception 'tenant and actor required' using errcode = '22023';
  end if;
  select * into v_recipient from profiles where id = p_actor;  -- reuse var briefly
  if not found or v_recipient.tenant_id is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  v_actor_label := coalesce(v_recipient.email, p_actor::text);
  v_resolved := marketing_effective_permissions(p_actor);
  if not ((v_resolved ->> 'enabled')::boolean) then
    raise exception 'marketing is not enabled for this tenant' using errcode = '42501';
  end if;
  if not ((v_resolved -> 'permissions') ? 'marketing.campaigns.test') then
    raise exception 'actor lacks marketing.campaigns.test' using errcode = '42501';
  end if;

  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('sender_id', 'recipient_profile_id', 'subject', 'body_text',
                     'request_id') then
      raise exception 'unknown test-send argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request_id := p_args ->> 'request_id';
  if v_request_id is null or v_request_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'request_id must match ^[A-Za-z0-9_-]{8,64}$' using errcode = '22023';
  end if;
  v_subject := nullif(trim(coalesce(p_args ->> 'subject', '')), '');
  v_body := nullif(coalesce(p_args ->> 'body_text', ''), '');
  if v_subject is null or length(v_subject) > 300 then
    raise exception 'subject required (max 300 chars)' using errcode = '22023';
  end if;
  if v_body is null or length(v_body) > 10000 then
    raise exception 'body_text required (max 10000 chars)' using errcode = '22023';
  end if;
  if v_subject ~ '[[:cntrl:]]' then
    raise exception 'subject must not contain control characters' using errcode = '22023';
  end if;

  -- sender: of THIS tenant, enabled, CURRENTLY READY (authoritative derivation)
  begin
    select * into v_sender from marketing_sender_profiles
     where id = (p_args ->> 'sender_id')::uuid and tenant_id = p_tenant for update;
  exception when others then
    raise exception 'invalid sender id' using errcode = '22023';
  end;
  if v_sender.id is null then
    raise exception 'sender not found for tenant' using errcode = 'P0002';
  end if;
  if not v_sender.enabled then
    raise exception 'sender is disabled' using errcode = '22023';
  end if;
  v_rd := marketing_sender_readiness(p_tenant, v_sender.id);
  if not (v_rd ->> 'ready')::boolean then
    raise exception 'sender is not ready to send (%)', v_rd ->> 'state'
      using errcode = '22023';
  end if;

  -- STRICT recipient policy: a same-tenant profile with an email — resolved
  -- SERVER-SIDE (never an arbitrary browser-supplied address). Profiles carry
  -- no active/inactive state, so none is claimed: existence in THIS tenant +
  -- an email address is the whole enforceable contract.
  begin
    select * into v_recipient from profiles
     where id = (p_args ->> 'recipient_profile_id')::uuid and tenant_id = p_tenant;
  exception when others then
    raise exception 'invalid recipient profile id' using errcode = '22023';
  end;
  if v_recipient.id is null then
    raise exception 'recipient must be a profile of this tenant' using errcode = 'P0002';
  end if;
  if v_recipient.email is null or length(trim(v_recipient.email)) < 3 then
    raise exception 'recipient profile has no email address' using errcode = '22023';
  end if;

  select * into v_settings from marketing_settings where tenant_id = p_tenant;
  if found and not v_settings.marketing_enabled then
    raise exception 'marketing is disabled for this tenant' using errcode = '42501';
  end if;

  -- exact content hash over the canonical frozen envelope fields
  v_hash := encode(extensions.digest(jsonb_build_object(
    'sender', v_sender.id, 'mailbox', v_sender.mailbox_address,
    'recipient', lower(v_recipient.email), 'subject', v_subject, 'body', v_body,
    'from_name', v_sender.from_name, 'reply_to', v_sender.reply_to,
    'signature', v_sender.signature_text, 'purpose', 'test',
    'content_version', '1')::text, 'sha256'), 'hex');
  -- canonical REQUEST fingerprint: idempotency is bound to the EXACT request
  -- (actor + sender + recipient + full frozen content + request id) — the
  -- ONE formula the delivery insert guard also recomputes and verifies
  v_fp := marketing_request_fingerprint(v_request_id, p_actor, v_sender.id,
                                        v_recipient.id, v_hash);

  -- REQUEST-ID IDEMPOTENCY under a per-tenant lock (double-clicks converge;
  -- a REUSED id with ANY differing frozen input is a stable conflict and
  -- creates nothing)
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|mkt_test_send', 42));
  select * into v_existing from marketing_deliveries
   where tenant_id = p_tenant and request_id = v_request_id;
  if found then
    if v_existing.request_fingerprint = v_fp then
      return jsonb_build_object('delivery_id', v_existing.id,
        'intent_id', v_existing.automation_intent_id,
        'correlation_id', v_existing.correlation_id,
        'status', v_existing.status, 'idempotent', true);
    end if;
    raise exception 'request_id was already used for a DIFFERENT request'
      using errcode = 'MK412';
  end if;

  -- DB-BACKED RATE LIMIT (test sends are bounded, never a spam endpoint)
  select count(*) filter (where created_at > now() - interval '1 minute'),
         count(*) filter (where created_at > now() - interval '1 hour')
    into v_minute, v_hour
    from marketing_deliveries
   where tenant_id = p_tenant and purpose = 'test';
  if v_minute >= 3 or v_hour >= 10 then
    raise exception 'test-send rate limit reached (3/minute, 10/hour per tenant)'
      using errcode = 'MK429';
  end if;

  -- current operational mode (audit column only; the engine re-resolves live)
  select coalesce(
    (select e.value #>> '{}' from operating_profile_entries e
      where e.tenant_id = p_tenant and e.namespace = 'operational_mode' and e.key = 'current'
      limit 1),
    (select e.value #>> '{}' from operating_profile_entries e
      where e.tenant_id is null and e.namespace = 'operational_mode' and e.key = 'current'
      limit 1)) into v_mode;

  -- ── canonical Action (the engine requires a same-tenant Action object) ──
  insert into intelligence_objects (id, tenant_id, domain, object_type, object_class,
                                    subject, status)
  values (v_action, p_tenant, 'core', 'Action', 'action',
          'Marketing test email via sender ' || v_sender.mailbox_address, 'ready');

  -- ── immutable Decision Package — HONEST: an explicitly authorised,
  --    DELEGATED test action (marketing.campaigns.test). No review routing,
  --    no approval — and none fabricated. Risk low (one bounded email to a
  --    tenant user), reversibility IRREVERSIBLE (a sent email cannot be
  --    recalled), external capability high-risk — the Operational Mode
  --    re-check therefore still withholds execution in modes that require
  --    reversibility. This authorises ONE test send and nothing beyond it. ──
  v_pkg := jsonb_build_object(
    'id', v_decision,
    'tenantId', p_tenant,
    'supersedes', null,
    'intelligenceObjectId', v_action,
    'intelligenceObjectType', 'Action',
    'objectClass', 'action',
    'domainPackKeys', jsonb_build_array(),
    'decision', 'AUTOMATION_AUTHORISED',
    'nextDecisionOwner', jsonb_build_object('kind', 'automation'),
    'rationale', jsonb_build_object(
      'summary', 'Explicit delegated test-send request by a tenant actor holding marketing.campaigns.test',
      'reasonCodes', jsonb_build_array('human_explicit_request'),
      'policyMatches', jsonb_build_array('marketing.campaigns.test'),
      'rejectedAlternatives', jsonb_build_array(),
      'missingConfiguration', jsonb_build_array()),
    'confidence', jsonb_build_object('score', 1, 'threshold', 0,
                                     'ambiguityScore', 0, 'evidenceQuality', 1),
    'authority', jsonb_build_object(
      'requiredAuthority', 'operational',
      'resolvedAuthorityHolder', p_actor::text,
      'delegatedLimit', null, 'requestedValue', null,
      'withinDelegatedAuthority', true),
    'risk', jsonb_build_object('level', 'low', 'score', 0.2,
                               'categories', jsonb_build_array('customer')),
    'reversibility', jsonb_build_object('level', 'irreversible',
                                        'compensationAvailable', false),
    'impact', jsonb_build_object('level', 'low', 'categories', jsonb_build_array('customer')),
    'ownership', jsonb_build_object('responsible', null, 'accountable', null,
      'approver', null, 'waitingOn', null,
      'consulted', jsonb_build_array(), 'informed', jsonb_build_array()),
    'proposedAction', null,
    'automationIntent', jsonb_build_object('intentType', 'send_marketing_test_email',
      'payload', jsonb_build_object('content_hash', v_hash), 'requiresApproval', false),
    'routing', jsonb_build_object('reviewRequired', false, 'openfolkRequired', false,
      'tenantReviewRequired', false, 'customerApprovalRequired', false,
      'waitCondition', null),
    'versions', jsonb_build_object('engineVersion', 'marketing-sender.v1',
      'operatingProfileVersion', null,
      'policyVersionIds', jsonb_build_array(),
      'learningVersionIds', jsonb_build_array()),
    'audit', jsonb_build_object('correlationId', v_correlation,
      'inputHash', v_hash, 'outputHash', v_hash));

  insert into decision_log
    (id, tenant_id, object_id, object_snapshot, effective_profile_hash,
     policy_version_ids, matched_rules, outputs, input_hash,
     decision, operational_mode, next_owner_kind, engine_version,
     operating_profile_version, learning_version_ids, reason_codes,
     correlation_id, output_hash, supersedes, decision_package)
  values
    (v_decision, p_tenant, v_action,
     jsonb_build_object('kind', 'marketing_test_send', 'sender', v_sender.id,
                        'recipient_profile', v_recipient.id, 'content_hash', v_hash,
                        'requested_by', p_actor,
                        'authority_basis', 'marketing.campaigns.test'),
     v_hash, '{}', '[]'::jsonb,
     jsonb_build_object('decision', 'AUTOMATION_AUTHORISED',
                        'reason_codes', jsonb_build_array('human_explicit_request')),
     v_hash, 'AUTOMATION_AUTHORISED', v_mode, 'automation',
     'marketing-sender.v1', null, '{}', array['human_explicit_request'],
     v_correlation, v_hash, null, v_pkg);

  -- ── pending Automation Intent with the FROZEN envelope ──
  v_params := jsonb_build_object(
    'sender_profile_id', v_sender.id,
    'source_kind', v_sender.source_kind,
    'mailbox_address', v_sender.mailbox_address,
    'recipient_profile_id', v_recipient.id,
    'recipient_email', lower(v_recipient.email),
    'subject', v_subject,
    'body_text', v_body,
    'from_name', v_sender.from_name,
    'reply_to', v_sender.reply_to,
    'signature_text', v_sender.signature_text,
    'purpose', 'test',
    'content_version', '1',
    'content_hash', v_hash,
    'actor_profile_id', p_actor,
    'request_id', v_request_id,
    'delivery_id', v_delivery);

  insert into automation_intents
    (id, tenant_id, action_object_id, intent_type, parameters, status,
     connector_id, capability_key, decision_id, correlation_id,
     expires_at, max_attempts, schema_version)
  values
    (v_intent, p_tenant, v_action, 'send_marketing_test_email', v_params, 'pending',
     'google-gmail', 'email.send_marketing', v_decision, v_correlation,
     now() + interval '1 hour', 3, '1');

  -- pin the authorised envelope hash the claim RPC re-verifies (P1-5). NOTE:
  -- deliberately NO automation_approvals row — see the authority model above.
  update automation_intents
     set approved_payload_hash = automation_intent_envelope_hash(p_tenant, v_intent)
   where id = v_intent;

  -- ── bounded domain projection ──
  insert into marketing_deliveries
    (id, tenant_id, sender_profile_id, purpose, actor_profile_id,
     recipient_profile_id, recipient_email, automation_intent_id,
     request_id, request_fingerprint, correlation_id, subject, body_text,
     from_name, reply_to, signature_text, content_version, content_hash, status)
  values
    (v_delivery, p_tenant, v_sender.id, 'test', p_actor,
     v_recipient.id, lower(v_recipient.email), v_intent,
     v_request_id, v_fp, v_correlation, v_subject, v_body, v_sender.from_name,
     v_sender.reply_to, v_sender.signature_text, '1', v_hash, 'queued');
  insert into marketing_delivery_events
    (tenant_id, delivery_id, automation_intent_id, from_status, to_status, detail)
  values (p_tenant, v_delivery, v_intent, null, 'queued', 'test send requested');

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_actor_label, 'marketing.test_send.requested', 'marketing_delivery',
          v_delivery::text, 'ok',
          jsonb_build_object('sender', v_sender.id, 'recipient_profile', v_recipient.id,
                             'request_id', v_request_id, 'content_hash', v_hash,
                             'authority_basis', 'marketing.campaigns.test'));
  perform marketing_event_append(p_tenant, 'marketing.test_send.requested',
    'marketing_delivery', v_delivery, 'marketing-senders',
    jsonb_build_object('k', 'requested:' || v_request_id, 'sender', v_sender.id,
                       'actor', v_actor_label, 'at', now()));

  return jsonb_build_object('delivery_id', v_delivery, 'intent_id', v_intent,
    'correlation_id', v_correlation, 'status', 'queued', 'idempotent', false);
end $$;

-- ============================================================================
-- RECONCILER — project the engine's immutable facts into the delivery record;
-- on CONFIRMED submission, upsert the canonical outbound email_messages row
-- and enqueue the EXISTING canonical Interaction projector (interactions.sync,
-- its own deterministic job key — idempotent against the active-key index).
-- Idempotent; appends events only on real transitions; NEVER rewrites a
-- provider fact; a failed/unknown attempt writes NO canonical email row.
-- ============================================================================
create or replace function marketing_delivery_reconcile(p_tenant uuid, p_delivery uuid)
returns jsonb
language plpgsql
as $$
declare
  v_d marketing_deliveries%rowtype;
  v_intent automation_intents%rowtype;
  v_attempt automation_execution_attempts%rowtype;
  v_new_status text;
  v_failure text;
  v_msg_id text;
  v_thread_id text;
  v_submitted timestamptz;
begin
  if p_tenant is null or p_delivery is null then
    raise exception 'tenant and delivery required' using errcode = '22023';
  end if;
  select * into v_d from marketing_deliveries
   where id = p_delivery and tenant_id = p_tenant for update;
  if not found then
    raise exception 'delivery not found for tenant' using errcode = 'P0002';
  end if;
  if v_d.status in ('submitted', 'failed') then
    return jsonb_build_object('delivery_id', v_d.id, 'status', v_d.status,
                              'changed', false);
  end if;

  select * into v_intent from automation_intents
   where id = v_d.automation_intent_id and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('delivery_id', v_d.id, 'status', v_d.status,
                              'changed', false, 'note', 'intent missing');
  end if;
  -- latest FACT first: a completed (terminal) attempt always beats the
  -- append-only in-flight row it superseded, even inside one transaction
  -- where both share started_at/created_at
  select * into v_attempt from automation_execution_attempts a
   where a.tenant_id = p_tenant and a.automation_intent_id = v_intent.id
   order by a.completed_at desc nulls last, a.started_at desc nulls last,
            a.created_at desc, a.id desc limit 1;

  v_new_status := case v_intent.status
    when 'succeeded' then 'submitted'
    when 'executing' then 'executing'
    when 'claimed'   then 'executing'
    when 'unknown'   then 'unknown'
    when 'expired'   then 'failed'
    when 'cancelled' then 'failed'
    when 'rejected'  then 'failed'
    when 'failed'    then case
      when v_intent.attempts >= v_intent.max_attempts then 'failed'
      when v_attempt.id is not null and v_attempt.status = 'failed_permanent' then 'failed'
      else 'queued' end
    else 'queued' end;

  if v_new_status = v_d.status then
    return jsonb_build_object('delivery_id', v_d.id, 'status', v_d.status,
                              'changed', false);
  end if;
  -- the trigger enforces the legal matrix; unknown may only move via the
  -- engine's explicit reconciliation (a superseding attempt exists)
  if v_d.status = 'unknown' and v_new_status not in ('submitted', 'failed') then
    return jsonb_build_object('delivery_id', v_d.id, 'status', v_d.status,
                              'changed', false, 'note', 'unknown awaits reconciliation');
  end if;

  if v_new_status = 'submitted' then
    v_msg_id := v_attempt.external_reference;
    v_thread_id := nullif(v_attempt.result ->> 'thread_id', '');
    v_submitted := coalesce(v_attempt.completed_at, now());
    if v_msg_id is null then
      -- a success with no provider reference is a projection fault, not a fact
      -- to invent — leave the delivery where it is for human review
      return jsonb_build_object('delivery_id', v_d.id, 'status', v_d.status,
        'changed', false, 'note', 'succeeded attempt has no provider reference');
    end if;
    update marketing_deliveries set
      status = 'submitted',
      provider_message_id = coalesce(provider_message_id, v_msg_id),
      provider_thread_id = coalesce(provider_thread_id, v_thread_id),
      submitted_at = coalesce(submitted_at, v_submitted),
      execution_attempt_id = v_attempt.id,
      failure_class = null
    where id = v_d.id;

    -- canonical outbound source row — CONVERGES with later Gmail ingestion on
    -- (tenant, provider, provider_message_id); ingestion enrichment may later
    -- update sync fields, origin provenance survives (columns it never sets).
    -- body composition (body + plain-text signature delimiter) MUST mirror the
    -- pure MIME builder exactly — proven by the paired pure + SQL tests.
    insert into email_messages
      (tenant_id, provider, provider_message_id, provider_thread_id,
       from_email, from_name, to_emails, subject, body_text, sent_at,
       direction, origin, origin_delivery_id, origin_automation_intent_id)
    values
      (p_tenant, 'gmail', v_msg_id, v_thread_id,
       coalesce(v_intent.parameters ->> 'mailbox_address', ''),
       v_d.from_name,
       jsonb_build_array(v_d.recipient_email),
       v_d.subject,
       v_d.body_text || case when v_d.signature_text is not null
                             then e'\n\n--\n' || v_d.signature_text else '' end,
       v_submitted,
       'outbound', 'marketing_delivery', v_d.id, v_intent.id)
    on conflict (tenant_id, provider, provider_message_id) do update
      set origin = coalesce(email_messages.origin, excluded.origin),
          origin_delivery_id = coalesce(email_messages.origin_delivery_id,
                                        excluded.origin_delivery_id),
          origin_automation_intent_id = coalesce(email_messages.origin_automation_intent_id,
                                                 excluded.origin_automation_intent_id);

    -- hand the new outbound source row to the EXISTING canonical projector:
    -- the standard interactions.sync job under its own deterministic key
    -- (idempotent against platform_jobs' active-key index; the scheduled
    -- cron uses the SAME key, so both paths converge on one active job)
    insert into platform_jobs
      (tenant_id, module_id, job_type, job_key, status, priority, max_attempts, payload)
    values
      (p_tenant, 'core.interactions', 'interactions.sync',
       'interactions.sync:' || p_tenant || ':all', 'queued', 100, 5, '{}'::jsonb)
    on conflict (tenant_id, job_key)
      where job_key is not null and status in ('queued', 'running', 'retrying')
      do nothing;
  elsif v_new_status in ('failed', 'unknown') then
    v_failure := left(coalesce(v_attempt.error_class, v_attempt.error_code,
                               case when v_intent.status = 'expired' then 'expired' end,
                               'unclassified'), 120);
    update marketing_deliveries set
      status = v_new_status,
      failure_class = v_failure,
      execution_attempt_id = coalesce(v_attempt.id, execution_attempt_id)
    where id = v_d.id;
  else
    update marketing_deliveries set
      status = v_new_status,
      execution_attempt_id = coalesce(v_attempt.id, execution_attempt_id)
    where id = v_d.id;
  end if;

  insert into marketing_delivery_events
    (tenant_id, delivery_id, automation_intent_id, from_status, to_status, detail,
     execution_attempt_id)
  values (p_tenant, v_d.id, v_d.automation_intent_id, v_d.status, v_new_status,
          left(coalesce(v_failure, 'reconciled from execution attempt'), 300),
          v_attempt.id);

  return jsonb_build_object('delivery_id', v_d.id, 'status', v_new_status,
    'changed', true, 'provider_message_id', v_msg_id);
end $$;

-- ============================================================================
-- BOUNDED STATUS READS + OBSERVABILITY
-- ============================================================================
create or replace function marketing_test_send_status(p_tenant uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_limit int := 20;
  v_key text;
  v_rows jsonb;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  -- STRICT public contract at the DATABASE boundary (the Edge also validates):
  -- p_args must be an object; 'limit' is the only key; limit is an integer
  -- between 1 and 50. Fractions, strings, arrays, nulls, extra keys → 22023.
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key <> 'limit' then
      raise exception 'unknown status argument %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_args ? 'limit' then
    if jsonb_typeof(p_args -> 'limit') <> 'number'
       or (p_args ->> 'limit') ~ '[.eE]' then
      raise exception 'limit must be an integer' using errcode = '22023';
    end if;
    v_limit := (p_args ->> 'limit')::int;
    if v_limit < 1 or v_limit > 50 then
      raise exception 'limit must be between 1 and 50' using errcode = '22023';
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'status', d.status, 'purpose', d.purpose,
           'sender_profile_id', d.sender_profile_id,
           'recipient_email', d.recipient_email,
           'subject', d.subject,
           'request_id', d.request_id,
           'correlation_id', d.correlation_id,
           'content_hash', d.content_hash,
           'failure_class', d.failure_class,
           'provider_message_id', d.provider_message_id,
           'provider_thread_id', d.provider_thread_id,
           'submitted_at', d.submitted_at,
           'created_at', d.created_at,
           'intent_status', i.status,
           'intent_attempts', i.attempts,
           'events', (select coalesce(jsonb_agg(jsonb_build_object(
                        'from', e.from_status, 'to', e.to_status,
                        'detail', e.detail, 'at', e.created_at)
                        order by e.seq), '[]'::jsonb)
                       from marketing_delivery_events e
                      where e.tenant_id = p_tenant and e.delivery_id = d.id)
         ) order by d.created_at desc), '[]'::jsonb)
    into v_rows
    from (select * from marketing_deliveries
           where tenant_id = p_tenant and purpose = 'test'
           order by created_at desc limit v_limit) d
    left join automation_intents i on i.id = d.automation_intent_id;
  return jsonb_build_object('deliveries', v_rows);
end $$;

create or replace function marketing_sender_health(p_tenant uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v jsonb;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'senders_configured', (select count(*) from marketing_sender_profiles
                            where tenant_id = p_tenant),
    'senders_enabled', (select count(*) from marketing_sender_profiles
                         where tenant_id = p_tenant and enabled),
    -- READY = the live authoritative derivation, not a cached column
    'senders_ready', (select count(*) from marketing_sender_profiles p
                       where p.tenant_id = p_tenant
                         and (marketing_sender_readiness(p_tenant, p.id) ->> 'ready')::boolean),
    'default_sender_id', (select default_sender_profile_id from marketing_settings
                           where tenant_id = p_tenant),
    'capability_enabled', coalesce((select c.enabled from tenant_connector_capabilities c
                                     where c.tenant_id = p_tenant
                                       and c.connector_id = 'google-gmail'
                                       and c.capability_key = 'email.send_marketing'), false),
    'deliveries', (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
                    from (select status, count(*) n from marketing_deliveries
                           where tenant_id = p_tenant group by status) s),
    'last_submitted_at', (select max(submitted_at) from marketing_deliveries
                           where tenant_id = p_tenant and status = 'submitted'),
    'last_failed_at', (select max(updated_at) from marketing_deliveries
                        where tenant_id = p_tenant and status = 'failed'),
    'unknown_needing_review', (select count(*) from marketing_deliveries
                                where tenant_id = p_tenant and status = 'unknown'),
    'oldest_queued_seconds', (select extract(epoch from (now() - min(created_at)))::int
                               from marketing_deliveries
                              where tenant_id = p_tenant and status in ('queued', 'executing'))
  ) into v;
  return v;
end $$;

-- ============================================================================
-- Grants — every Phase-4 RPC is SERVICE-ROLE ONLY.
-- ============================================================================
do $$
declare sig text;
begin
  foreach sig in array array[
    'marketing_scope_has(text, text)',
    'marketing_request_fingerprint(text, uuid, uuid, uuid, text)',
    'marketing_sender_text_guard(text, text, boolean)',
    'marketing_require_senders_actor(uuid, uuid)',
    'marketing_sender_sources(uuid)',
    'marketing_sender_readiness(uuid, uuid)',
    'marketing_sender_readiness_all(uuid)',
    'marketing_sender_create(uuid, uuid, jsonb)',
    'marketing_sender_update(uuid, uuid, uuid, jsonb, timestamptz)',
    'marketing_sender_set_enabled(uuid, uuid, uuid, boolean, timestamptz)',
    'marketing_sender_set_default(uuid, uuid, uuid, timestamptz)',
    'marketing_sender_record_verification(uuid, uuid, text, text, timestamptz)',
    'marketing_sender_capability_sync(uuid)',
    'marketing_test_send_request(uuid, uuid, jsonb)',
    'marketing_delivery_reconcile(uuid, uuid)',
    'marketing_test_send_status(uuid, jsonb)',
    'marketing_sender_health(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated;', sig);
    execute format('grant execute on function %s to service_role;', sig);
  end loop;
end $$;
