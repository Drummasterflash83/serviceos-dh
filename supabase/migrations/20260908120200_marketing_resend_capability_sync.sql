-- ============================================================================
-- Marketing — Resend sender capability sync fix (additive)
-- ----------------------------------------------------------------------------
-- Defect found in staging activation: marketing_sender_create_resend inserted a
-- ready+enabled resend sender but did NOT enable the tenant's marketing send
-- capability, so the Automation Engine's pre-adapter connector check blocked
-- execution with `connector_missing`. The Gmail/Workspace path enables the
-- capability at VERIFICATION time via marketing_sender_capability_sync; a resend
-- sender is born ready, so it must sync at CREATION. This redefines the create
-- RPC to call marketing_sender_capability_sync(p_tenant) before returning — the
-- same self-refreshing derivation, no new logic. Idempotent and additive.
-- ============================================================================

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

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|sender|resend|' || v_addr, 42));

  select * into v_existing from marketing_sender_profiles
   where tenant_id = p_tenant and source_kind = 'resend' and mailbox_address = v_addr;
  if v_existing.id is not null then
    -- ensure the capability reflects the (already existing) ready sender too
    perform marketing_sender_capability_sync(p_tenant);
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

  -- a resend sender is ready on creation → enable the tenant's marketing send
  -- capability now (the Gmail path does this at verification time). This is the
  -- SAME derivation, so it is safe, idempotent and self-correcting.
  perform marketing_sender_capability_sync(p_tenant);

  return jsonb_build_object('id', v_row.id, 'created', true,
    'mailbox_address', v_row.mailbox_address,
    'send_scope_state', v_row.send_scope_state,
    'enabled', v_row.enabled, 'updated_at', v_row.updated_at);
end $$;

revoke all on function marketing_sender_create_resend(uuid, uuid, jsonb) from public;
grant execute on function marketing_sender_create_resend(uuid, uuid, jsonb) to service_role;
