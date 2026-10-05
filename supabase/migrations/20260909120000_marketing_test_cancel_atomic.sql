-- ServiceOS Marketing — ATOMIC governed test cancellation (launch correction).
--
-- WHY THIS EXISTS. The first governed-cancel shipped as Edge orchestration:
-- a conditional UPDATE on automation_intents, then an audit insert, then a
-- marketing_delivery_reconcile call — three separate transactions whose audit
-- and reconciliation errors were not checked. A failure between operations
-- could leave a cancelled intent with NO audit record, or a cancelled intent
-- whose delivery projection stayed 'queued'. This migration moves the ENTIRE
-- governed act into ONE service-role SQL function so it commits completely or
-- not at all.
--
-- marketing_test_cancel(p_tenant, p_actor, p_args{delivery_id}) — in a single
-- database transaction:
--   1. binds the actor to the exact tenant (same-tenant profile, operational
--      role, canonical marketing.campaigns.test through the AUTHORITATIVE
--      resolver — a hostile raw grant row can never widen this);
--   2. locks the exact (tenant, delivery) row FOR UPDATE;
--   3. proves purpose = 'test' (a broadcast/sequence delivery is refused —
--      those have their own governed lifecycles);
--   4. proves the delivery is still 'queued' (executing/submitted/failed/
--      unknown are refused — nothing that MIGHT have reached the provider is
--      ever touched);
--   5. performs the conditional pending→cancelled intent transition WITH the
--      zero-attempts proof (status = 'pending' AND attempts = 0). This is the
--      worker-race boundary: whichever side commits first wins, the loser
--      sees the truth (MK411);
--   6. reconciles the delivery projection to its truthful terminal state
--      IN-TRANSACTION: queued→failed with failure_class 'cancelled'. The
--      untouched marketing_delivery_guard revalidates the transition against
--      the (now cancelled) intent, so a fictional state remains structurally
--      impossible. failure_class 'cancelled' is MORE truthful than the lazy
--      reconciler's 'unclassified' and is what the customer UI keys on. A
--      later marketing_delivery_reconcile run sees the terminal state and
--      no-ops (changed: false) — full idempotent compatibility;
--   7. appends the delivery event (guard-sequenced, unbroken from-status
--      chain) and the append-only audit record and the platform event;
--   8. returns the authoritative final state.
-- ANY failure in 5–7 (guard refusal, audit failure, event failure) aborts the
-- whole transaction: no unaudited cancellation, no stale projection, ever.
--
-- Error contract (Edge maps to the stable public codes):
--   22023  invalid arguments (bad uuid, unknown key, non-object, non-test)
--   42501  role/permission denied
--   integrity_constraint_violation  actor not a profile of the target tenant
--   P0002  delivery not found for THIS tenant (non-enumerating cross-tenant)
--   MK410  the delivery is no longer waiting (already processed or finished)
--   MK411  the engine already claimed the intent (race lost — cannot withdraw)
--
-- Additive only. No existing object is modified or dropped; the Edge function
-- becomes a thin authenticated wrapper around this RPC.

create or replace function marketing_test_cancel(p_tenant uuid, p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_actor profiles%rowtype;
  v_actor_label text;
  v_resolved jsonb;
  v_key text;
  v_delivery_id uuid;
  v_d marketing_deliveries%rowtype;
  v_cancelled int;
  v_final marketing_deliveries%rowtype;
  v_event_seq int;
  v_event_at timestamptz;
  v_audit_id uuid;
begin
  -- ── actor: same-tenant profile, operational role, canonical permission ──
  if p_tenant is null or p_actor is null then
    raise exception 'tenant and actor required' using errcode = '22023';
  end if;
  select * into v_actor from profiles where id = p_actor;
  if not found or v_actor.tenant_id is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  v_actor_label := coalesce(v_actor.email, p_actor::text);
  if v_actor.role not in ('owner', 'admin', 'ops') then
    raise exception 'cancelling a test requires an operational role' using errcode = '42501';
  end if;
  v_resolved := marketing_effective_permissions(p_actor);
  if not ((v_resolved ->> 'enabled')::boolean) then
    raise exception 'marketing is not enabled for this tenant' using errcode = '42501';
  end if;
  if not ((v_resolved -> 'permissions') ? 'marketing.campaigns.test') then
    raise exception 'actor lacks marketing.campaigns.test' using errcode = '42501';
  end if;

  -- ── strict args: delivery_id is the ONLY key, and must be a real uuid ──
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key <> 'delivery_id' then
      raise exception 'unknown cancel argument %', v_key using errcode = '22023';
    end if;
  end loop;
  begin
    v_delivery_id := (p_args ->> 'delivery_id')::uuid;
  exception when others then
    raise exception 'invalid delivery id' using errcode = '22023';
  end;
  if v_delivery_id is null then
    raise exception 'delivery_id required' using errcode = '22023';
  end if;

  -- ── exact tenant + delivery binding, locked for the whole governed act.
  --    Lock order (delivery → intent) matches marketing_delivery_reconcile;
  --    the engine's claim transaction touches only the intent row. ──
  select * into v_d from marketing_deliveries
   where id = v_delivery_id and tenant_id = p_tenant
   for update;
  if not found then
    -- non-enumerating: a cross-tenant caller learns nothing beyond "not yours"
    raise exception 'test not found for tenant' using errcode = 'P0002';
  end if;
  if v_d.purpose <> 'test' then
    raise exception 'only a test delivery can be cancelled here (this is a % delivery)',
      v_d.purpose using errcode = '22023';
  end if;
  if v_d.status <> 'queued' then
    raise exception 'this test is no longer waiting (delivery is %)', v_d.status
      using errcode = 'MK410';
  end if;

  -- ── the worker-race boundary: ONLY a still-pending, never-attempted intent
  --    can be withdrawn. The conditional UPDATE takes the row lock; whichever
  --    side (this cancel / a claiming worker) commits first wins. ──
  update automation_intents
     set status = 'cancelled'
   where id = v_d.automation_intent_id and tenant_id = p_tenant
     and status = 'pending' and attempts = 0;
  get diagnostics v_cancelled = row_count;
  if v_cancelled = 0 then
    raise exception 'the engine already started processing this test — it can no longer be withdrawn'
      using errcode = 'MK411';
  end if;

  -- ── reconcile the projection to the truthful terminal state, in-transaction.
  --    The delivery guard revalidates: queued→failed demands a terminally
  --    cancelled intent + a failure classification. 'cancelled' is the honest
  --    class (nothing was attempted; the requester withdrew it). ──
  update marketing_deliveries
     set status = 'failed', failure_class = 'cancelled'
   where id = v_d.id and tenant_id = p_tenant;

  -- ── append the delivery event (guard-sequenced truthful history) ──
  insert into marketing_delivery_events
    (tenant_id, delivery_id, automation_intent_id, from_status, to_status, detail)
  values (p_tenant, v_d.id, v_d.automation_intent_id, 'queued', 'failed',
          'cancelled by the requester before provider execution')
  returning seq, created_at into v_event_seq, v_event_at;

  -- ── append the audit record (REQUIRED — a failure rolls back everything) ──
  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_actor_label, 'marketing.test_send.cancelled', 'automation_intent',
          v_d.automation_intent_id::text, 'ok',
          jsonb_build_object(
            'delivery_id', v_d.id,
            'recipient_email', v_d.recipient_email,
            'subject', v_d.subject,
            'reason', 'cancelled by the requester before provider execution',
            'authority_basis', 'marketing.campaigns.test'))
  returning id into v_audit_id;

  perform marketing_event_append(p_tenant, 'marketing.test_send.cancelled',
    'marketing_delivery', v_d.id, 'marketing-senders',
    jsonb_build_object('k', 'cancelled:' || v_d.id, 'intent', v_d.automation_intent_id,
                       'actor', v_actor_label, 'at', now()));

  -- ── authoritative final state (read back after the transition) ──
  select * into v_final from marketing_deliveries
   where id = v_d.id and tenant_id = p_tenant;
  return jsonb_build_object(
    'delivery_id', v_final.id,
    'cancelled', true,
    'delivery_status', v_final.status,
    'failure_class', v_final.failure_class,
    'intent_id', v_final.automation_intent_id,
    'intent_status', 'cancelled',
    'event_seq', v_event_seq,
    'audit_id', v_audit_id,
    'cancelled_at', v_event_at);
end $$;

-- service-role-only: the Edge wrapper is the sole caller
revoke all on function marketing_test_cancel(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function marketing_test_cancel(uuid, uuid, jsonb) to service_role;
