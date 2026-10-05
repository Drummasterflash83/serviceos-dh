-- Reliability Phase 1: fail-closed webhook tenancy, quarantine, and replay safety.

create table if not exists inbound_webhook_quarantine (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null,
  delivery_key        text not null,
  provider_call_id    text,
  provider_customer_id text,
  reason_code         text not null,
  occurred_at         timestamptz,
  received_at         timestamptz not null default now(),
  payload             jsonb not null default '{}'::jsonb,
  payload_sha256      text not null,
  replay_count        int not null default 0,
  last_received_at    timestamptz not null default now(),
  unique (provider, delivery_key)
);

-- Quarantine is platform-security data: no tenant or browser may read/write it.
alter table inbound_webhook_quarantine enable row level security;
revoke all on inbound_webhook_quarantine from anon, authenticated;

alter table live_call_events add column if not exists delivery_key text;
create unique index if not exists live_call_events_delivery_uk
  on live_call_events (provider, delivery_key) where delivery_key is not null;

create or replace function quarantine_inbound_webhook(
  p_provider text,
  p_delivery_key text,
  p_provider_call_id text,
  p_provider_customer_id text,
  p_reason_code text,
  p_occurred_at timestamptz,
  p_payload jsonb,
  p_payload_sha256 text
) returns table (quarantine_id uuid, duplicate boolean)
language plpgsql security invoker as $$
declare v_id uuid; v_inserted boolean := true;
begin
  insert into inbound_webhook_quarantine
    (provider, delivery_key, provider_call_id, provider_customer_id, reason_code,
     occurred_at, payload, payload_sha256)
  values
    (p_provider, p_delivery_key, p_provider_call_id, p_provider_customer_id, p_reason_code,
     p_occurred_at, p_payload, p_payload_sha256)
  on conflict (provider, delivery_key) do update set
    replay_count = inbound_webhook_quarantine.replay_count + 1,
    last_received_at = now()
  returning id, (xmax <> 0) into v_id, duplicate;
  quarantine_id := v_id;
  return next;
end $$;

revoke all on function quarantine_inbound_webhook(text,text,text,text,text,timestamptz,jsonb,text) from public, anon, authenticated;
grant execute on function quarantine_inbound_webhook(text,text,text,text,text,timestamptz,jsonb,text) to service_role;

create or replace function ingest_live_call_webhook(
  p_tenant_id uuid,
  p_provider text,
  p_delivery_key text,
  p_provider_call_id text,
  p_event_type text,
  p_caller_number text,
  p_callee_number text,
  p_extension text,
  p_direction text,
  p_occurred_at timestamptz,
  p_raw_payload jsonb,
  p_assigned_user_id uuid,
  p_match_status text,
  p_matched_person_id uuid,
  p_confidence numeric,
  p_evidence jsonb
) returns table (event_id uuid, duplicate boolean, session_updated boolean)
language plpgsql security invoker as $$
declare v_event_id uuid; v_status text; v_rows int;
begin
  -- The tenant must have this connector enabled at commit time; caller resolution alone
  -- is not sufficient authority for a service-role write.
  if not exists (
    select 1 from tenant_connectors
    where tenant_id = p_tenant_id and connector_id = p_provider and enabled = true
  ) then
    raise exception 'tenant connector is not enabled' using errcode = 'insufficient_privilege';
  end if;

  insert into live_call_events
    (tenant_id, provider, delivery_key, provider_call_id, event_type, caller_number,
     callee_number, extension, direction, occurred_at, raw_payload)
  values
    (p_tenant_id, p_provider, p_delivery_key, p_provider_call_id, p_event_type,
     p_caller_number, p_callee_number, p_extension, p_direction, p_occurred_at, p_raw_payload)
  on conflict (provider, delivery_key) where delivery_key is not null do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select id into v_event_id from live_call_events
      where provider = p_provider and delivery_key = p_delivery_key;
    event_id := v_event_id; duplicate := true; session_updated := false; return next; return;
  end if;

  v_status := case p_event_type
    when 'answered' then 'answered' when 'completed' then 'completed'
    when 'missed' then 'missed' when 'failed' then 'failed' else 'ringing' end;

  insert into live_call_sessions
    (tenant_id, provider, provider_call_id, caller_number, callee_number, extension,
     direction, status, latest_event_at, assigned_user_id, match_status,
     matched_person_id, confidence, evidence, answered_at, completed_at)
  values
    (p_tenant_id, p_provider, p_provider_call_id, p_caller_number, p_callee_number,
     p_extension, coalesce(p_direction,'inbound'), v_status, p_occurred_at,
     p_assigned_user_id, p_match_status, p_matched_person_id, p_confidence, p_evidence,
     case when p_event_type='answered' then p_occurred_at end,
     case when p_event_type in ('completed','missed','failed') then p_occurred_at end)
  on conflict (tenant_id, provider, provider_call_id) do update set
    caller_number = excluded.caller_number, callee_number = excluded.callee_number,
    extension = excluded.extension, direction = excluded.direction, status = excluded.status,
    latest_event_at = excluded.latest_event_at,
    assigned_user_id = coalesce(excluded.assigned_user_id, live_call_sessions.assigned_user_id),
    match_status = excluded.match_status, matched_person_id = excluded.matched_person_id,
    confidence = excluded.confidence, evidence = excluded.evidence,
    answered_at = coalesce(excluded.answered_at, live_call_sessions.answered_at),
    completed_at = coalesce(excluded.completed_at, live_call_sessions.completed_at)
  where live_call_sessions.latest_event_at <= excluded.latest_event_at;
  get diagnostics v_rows = row_count;
  event_id := v_event_id; duplicate := false; session_updated := v_rows > 0; return next;
end $$;

revoke all on function ingest_live_call_webhook(uuid,text,text,text,text,text,text,text,text,timestamptz,jsonb,uuid,text,uuid,numeric,jsonb) from public, anon, authenticated;
grant execute on function ingest_live_call_webhook(uuid,text,text,text,text,text,text,text,text,timestamptz,jsonb,uuid,text,uuid,numeric,jsonb) to service_role;

