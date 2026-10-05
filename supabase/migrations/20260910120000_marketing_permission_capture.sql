-- ServiceOS Marketing — governed marketing-permission capture (launch gap).
--
-- WHY THIS EXISTS. Imports correctly never subscribe anyone, and every surface
-- says "record real consent" — but no customer-facing action existed to record
-- it. This migration adds the ONE governed way to record a genuine
-- email-marketing permission decision, individually and for a bounded,
-- explicitly selected group, over the EXISTING append-only
-- communication_preferences model. Nothing here invents consent:
--
--   * ServiceOS records the ORGANISATION'S decision and evidence. It does not
--     assume permission and does not decide whether contacting someone is
--     lawful. A 'subscribed' decision REQUIRES a controlled evidence basis,
--     a stated method/source, a reference or meaningful note, an effective
--     date and an explicit operator attestation.
--   * 'unsubscribed' is deliberately easy: recording an opt-out is always
--     safe. It appends the latest preference fact at the SAME endpoint scope,
--     so it takes precedence; a later resubscription needs NEW evidence.
--   * History is append-only (the existing trigger blocks update/delete for
--     every role including service_role). Hard suppressions are NOT touched
--     here: a suppressed endpoint stays excluded whatever is recorded, and the
--     return value says so.
--   * Imported contacts remain unsubscribed-by-default: the import path is
--     untouched and a regression lock proves importing alone never yields an
--     eligible recipient.
--
-- Authority: service-role-only RPCs; the actor must be a same-tenant
-- operational profile holding canonical marketing.contacts.manage through the
-- AUTHORITATIVE resolver (a hostile raw grant row cannot widen this). Every
-- write (preference + audit + platform event + idempotency receipt) commits in
-- ONE transaction or not at all; bulk apply is all-or-nothing over the exact
-- preflight-confirmed set, so the operator is never unsure which contacts
-- changed.
--
-- Error contract (Edge maps to stable public codes):
--   22023  invalid arguments / evidence / contact point not this person's
--   42501  role or permission denied
--   integrity_constraint_violation  actor not a profile of the target tenant
--   P0002  person not found for THIS tenant (non-enumerating)
--   MK412  request_id reused with a DIFFERENT request
--   MK409  bulk apply no longer matches its preflight contract
--
-- Additive only: one new idempotency-receipt table + three new functions.

-- ── request-id idempotency receipts (per tenant; append-only in practice) ───
create table marketing_permission_requests (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  request_id          text not null check (request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  kind                text not null check (kind in ('single', 'bulk')),
  result              jsonb not null,
  actor               uuid,
  created_at          timestamptz not null default now(),
  unique (tenant_id, request_id)
);
alter table marketing_permission_requests enable row level security;
-- service-role only; receipts are never edited (idempotent replay reads them)
revoke all on marketing_permission_requests from public, anon, authenticated;
grant select, insert on marketing_permission_requests to service_role;
revoke update, delete, truncate on marketing_permission_requests
  from anon, authenticated, service_role;

-- ── shared internals ────────────────────────────────────────────────────────

-- actor gate: same-tenant OPERATIONAL profile + canonical contacts.manage
create or replace function marketing_permission_require_actor(p_tenant uuid, p_actor uuid)
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
  if v_role not in ('owner', 'admin', 'ops') then
    raise exception 'recording marketing permission requires an operational role'
      using errcode = '42501';
  end if;
  v_resolved := marketing_effective_permissions(p_actor);
  if not ((v_resolved ->> 'enabled')::boolean) then
    raise exception 'marketing is not enabled for this tenant' using errcode = '42501';
  end if;
  if not ((v_resolved -> 'permissions') ? 'marketing.contacts.manage') then
    raise exception 'actor lacks marketing.contacts.manage' using errcode = '42501';
  end if;
  return coalesce((select email from profiles where id = p_actor), p_actor::text);
end $$;

-- ── record ONE permission decision (subscribed | unsubscribed) ──────────────
create or replace function marketing_permission_record(p_tenant uuid, p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_actor_label text;
  v_key text;
  v_person uuid;
  v_point contact_points%rowtype;
  v_decision text;
  v_basis text;
  v_method text;
  v_reference text;
  v_note text;
  v_attested boolean;
  v_effective timestamptz;
  v_request_id text;
  v_fp text;
  v_existing marketing_permission_requests%rowtype;
  v_evidence jsonb;
  v_pref_id uuid;
  v_eligibility text;
  v_suppressed boolean;
  v_result jsonb;
begin
  v_actor_label := marketing_permission_require_actor(p_tenant, p_actor);

  -- strict argument shape: documented keys only
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('person_id', 'contact_point_id', 'decision', 'basis',
                     'evidence_method', 'evidence_reference', 'note',
                     'effective_at', 'attestation', 'request_id') then
      raise exception 'unknown permission argument %', v_key using errcode = '22023';
    end if;
  end loop;

  v_request_id := p_args ->> 'request_id';
  if v_request_id is null or v_request_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'request_id must match ^[A-Za-z0-9_-]{8,64}$' using errcode = '22023';
  end if;
  v_decision := p_args ->> 'decision';
  if v_decision not in ('subscribed', 'unsubscribed') then
    raise exception 'decision must be subscribed or unsubscribed' using errcode = '22023';
  end if;

  -- person: exact tenant binding, non-enumerating
  begin
    v_person := (p_args ->> 'person_id')::uuid;
  exception when others then
    raise exception 'invalid person id' using errcode = '22023';
  end;
  if v_person is null
     or not exists (select 1 from people p where p.id = v_person and p.tenant_id = p_tenant) then
    raise exception 'contact not found for tenant' using errcode = 'P0002';
  end if;

  -- email contact point: explicitly selected, or the person's default USABLE
  -- email point (primary first, then most recent; invalid never selected) —
  -- the SAME choice the eligibility engine makes. It must belong to the person.
  if p_args ? 'contact_point_id' then
    begin
      select * into v_point from contact_points cp
       where cp.id = (p_args ->> 'contact_point_id')::uuid
         and cp.tenant_id = p_tenant and cp.person_id = v_person
         and cp.channel = 'email';
    exception when others then
      raise exception 'invalid contact point id' using errcode = '22023';
    end;
    if v_point.id is null then
      raise exception 'contact point does not belong to this person'
        using errcode = '22023';
    end if;
    if v_point.verification_state = 'invalid' then
      raise exception 'this email address is marked invalid — correct it first'
        using errcode = '22023';
    end if;
  else
    select * into v_point from contact_points cp
     where cp.tenant_id = p_tenant and cp.person_id = v_person and cp.channel = 'email'
       and cp.verification_state <> 'invalid'
     order by cp.is_primary desc, cp.last_observed_at desc nulls last, cp.created_at desc
     limit 1;
    if v_point.id is null then
      raise exception 'this contact has no usable email address on record'
        using errcode = '22023';
    end if;
  end if;

  -- effective date: optional (defaults now), never in the future
  if p_args ? 'effective_at' then
    begin
      v_effective := (p_args ->> 'effective_at')::timestamptz;
    exception when others then
      raise exception 'effective_at must be a valid date/time' using errcode = '22023';
    end;
    if v_effective > now() + interval '5 minutes' then
      raise exception 'effective_at cannot be in the future' using errcode = '22023';
    end if;
  else
    v_effective := now();
  end if;

  v_basis := nullif(trim(coalesce(p_args ->> 'basis', '')), '');
  v_method := nullif(trim(coalesce(p_args ->> 'evidence_method', '')), '');
  v_reference := nullif(trim(coalesce(p_args ->> 'evidence_reference', '')), '');
  v_note := nullif(trim(coalesce(p_args ->> 'note', '')), '');
  v_attested := (p_args ->> 'attestation')::boolean;

  if v_decision = 'subscribed' then
    -- a subscribed decision REQUIRES real evidence: controlled basis, stated
    -- method, a reference or meaningful note, and an explicit attestation
    if v_basis is null or v_basis not in
       ('explicit_opt_in', 'existing_customer_documented', 'other_documented_basis') then
      raise exception 'basis must be explicit_opt_in, existing_customer_documented or other_documented_basis'
        using errcode = '22023';
    end if;
    if v_method is null or length(v_method) < 2 or length(v_method) > 200 then
      raise exception 'evidence_method required (2-200 characters)' using errcode = '22023';
    end if;
    if coalesce(v_reference, v_note) is null
       or length(coalesce(v_reference, v_note)) < 2 then
      raise exception 'an evidence reference or a meaningful note is required'
        using errcode = '22023';
    end if;
    if v_attested is distinct from true then
      raise exception 'the operator attestation is required for a subscribed decision'
        using errcode = '22023';
    end if;
  end if;
  if v_reference is not null and length(v_reference) > 500 then
    raise exception 'evidence_reference must be at most 500 characters' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'note must be at most 500 characters' using errcode = '22023';
  end if;

  -- request-id idempotency under a per-tenant lock: byte-equivalent replay
  -- converges on the stored receipt; changed reuse is refused
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|mkt_permission', 42));
  -- fingerprint the CALLER-SUPPLIED effective_at (null when defaulted): a
  -- byte-equivalent replay must converge even though the default now() moves
  v_fp := encode(extensions.digest(jsonb_build_object(
    'kind', 'single', 'request_id', v_request_id, 'actor', p_actor,
    'person', v_person, 'contact_point', v_point.id, 'decision', v_decision,
    'basis', v_basis, 'method', v_method, 'reference', v_reference,
    'note', v_note, 'effective_at', p_args ->> 'effective_at')::text, 'sha256'), 'hex');
  select * into v_existing from marketing_permission_requests
   where tenant_id = p_tenant and request_id = v_request_id;
  if found then
    if v_existing.request_fingerprint = v_fp then
      return v_existing.result || jsonb_build_object('idempotent', true);
    end if;
    raise exception 'request_id was already used for a DIFFERENT request'
      using errcode = 'MK412';
  end if;

  v_evidence := jsonb_strip_nulls(jsonb_build_object(
    'basis', v_basis,
    'method', v_method,
    'reference', v_reference,
    'note', v_note,
    'attestation', v_attested,
    'recorded_via', 'marketing_permission_record',
    'request_id', v_request_id));

  -- ── the governed act: preference + audit + event + receipt, atomically ──
  insert into communication_preferences
    (tenant_id, person_id, contact_point_id, channel, state, source,
     lawful_basis, evidence, effective_at, recorded_by)
  values
    (p_tenant, v_person, v_point.id, 'email', v_decision, 'manual',
     case when v_decision = 'subscribed' then v_basis end,
     v_evidence, v_effective, p_actor)
  returning id into v_pref_id;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_actor_label, 'marketing.permission.recorded', 'communication_preference',
          v_pref_id::text, 'ok',
          jsonb_build_object('person_id', v_person, 'contact_point_id', v_point.id,
                             'email', v_point.normalized_value, 'decision', v_decision,
                             'basis', v_basis, 'effective_at', v_effective,
                             'request_id', v_request_id,
                             'authority_basis', 'marketing.contacts.manage'));

  perform marketing_event_append(p_tenant, 'marketing.permission.recorded',
    'communication_preference', v_pref_id, 'marketing-contacts',
    jsonb_build_object('k', 'permission:' || v_request_id, 'person', v_person,
                       'decision', v_decision, 'actor', v_actor_label, 'at', now()));

  v_eligibility := marketing_contact_eligibility(p_tenant, v_person, 'email');
  v_suppressed := v_eligibility = 'suppressed';
  v_result := jsonb_build_object(
    'person_id', v_person,
    'contact_point_id', v_point.id,
    'email', v_point.normalized_value,
    'decision', v_decision,
    'preference_id', v_pref_id,
    'effective_at', v_effective,
    'eligibility', v_eligibility,
    'suppressed', v_suppressed,
    'idempotent', false);

  insert into marketing_permission_requests
    (tenant_id, request_id, request_fingerprint, kind, result, actor)
  values (p_tenant, v_request_id, v_fp, 'single', v_result, p_actor);

  return v_result;
end $$;

-- ── record ONE evidenced decision for a bounded, explicitly selected group ──
-- p_mode = 'preflight' resolves the selection and returns the exact eligible /
-- refused breakdown plus a contract; 'apply' re-proves the SAME resolution and
-- appends one preference row per confirmed member — ALL-OR-NOTHING: any drift
-- from the contract, or any failed write, aborts the whole act.
create or replace function marketing_permission_record_bulk(
  p_tenant uuid, p_actor uuid, p_mode text, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_actor_label text;
  v_key text;
  v_ids uuid[];
  v_requested int;
  v_unique uuid[];
  v_decision text;
  v_basis text;
  v_method text;
  v_reference text;
  v_note text;
  v_attested boolean;
  v_effective timestamptz;
  v_request_id text;
  v_contract text;
  v_expected text;
  v_fp text;
  v_existing marketing_permission_requests%rowtype;
  v_eligible jsonb;
  v_refused jsonb;
  v_pairs text;
  v_evidence jsonb;
  v_bulk_ref uuid;
  v_n int := 0;
  v_result jsonb;
begin
  v_actor_label := marketing_permission_require_actor(p_tenant, p_actor);
  if p_mode not in ('preflight', 'apply') then
    raise exception 'invalid bulk mode' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('person_ids', 'decision', 'basis', 'evidence_method',
                     'evidence_reference', 'note', 'effective_at', 'attestation',
                     'request_id', 'contract') then
      raise exception 'unknown bulk permission argument %', v_key using errcode = '22023';
    end if;
  end loop;

  -- selection: explicit, deduplicated, strictly capped
  if jsonb_typeof(p_args -> 'person_ids') <> 'array' then
    raise exception 'person_ids must be an array' using errcode = '22023';
  end if;
  begin
    select array_agg(value::uuid) into v_ids
      from jsonb_array_elements_text(p_args -> 'person_ids');
  exception when others then
    raise exception 'person_ids must contain only UUIDs' using errcode = '22023';
  end;
  v_requested := coalesce(array_length(v_ids, 1), 0);
  if v_requested < 1 or v_requested > 100 then
    raise exception 'bulk permission recording is bounded to 1-100 selected contacts'
      using errcode = '22023';
  end if;
  select array_agg(u.id order by u.id) into v_unique
    from (select distinct id from unnest(v_ids) t(id)) u;

  v_decision := p_args ->> 'decision';
  if v_decision not in ('subscribed', 'unsubscribed') then
    raise exception 'decision must be subscribed or unsubscribed' using errcode = '22023';
  end if;
  if p_args ? 'effective_at' then
    begin
      v_effective := (p_args ->> 'effective_at')::timestamptz;
    exception when others then
      raise exception 'effective_at must be a valid date/time' using errcode = '22023';
    end;
    if v_effective > now() + interval '5 minutes' then
      raise exception 'effective_at cannot be in the future' using errcode = '22023';
    end if;
  else
    v_effective := now();
  end if;
  v_basis := nullif(trim(coalesce(p_args ->> 'basis', '')), '');
  v_method := nullif(trim(coalesce(p_args ->> 'evidence_method', '')), '');
  v_reference := nullif(trim(coalesce(p_args ->> 'evidence_reference', '')), '');
  v_note := nullif(trim(coalesce(p_args ->> 'note', '')), '');
  v_attested := (p_args ->> 'attestation')::boolean;
  -- shape bounds always; the REQUIRED-evidence gate belongs to APPLY —
  -- preflight is about the selection and runs before the evidence is written
  if v_reference is not null and length(v_reference) > 500 then
    raise exception 'evidence_reference must be at most 500 characters' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'note must be at most 500 characters' using errcode = '22023';
  end if;
  if p_mode = 'apply' and v_decision = 'subscribed' then
    if v_basis is null or v_basis not in
       ('explicit_opt_in', 'existing_customer_documented', 'other_documented_basis') then
      raise exception 'basis must be explicit_opt_in, existing_customer_documented or other_documented_basis'
        using errcode = '22023';
    end if;
    if v_method is null or length(v_method) < 2 or length(v_method) > 200 then
      raise exception 'evidence_method required (2-200 characters)' using errcode = '22023';
    end if;
    if coalesce(v_reference, v_note) is null
       or length(coalesce(v_reference, v_note)) < 2 then
      raise exception 'an evidence reference or a meaningful note is required'
        using errcode = '22023';
    end if;
    if v_attested is distinct from true then
      raise exception 'the operator attestation is required for a subscribed decision'
        using errcode = '22023';
    end if;
  end if;

  -- resolve every selected person to their default USABLE email point (the
  -- same choice the single action and the eligibility engine make); refusals
  -- are named per person, never silently dropped
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'person_id', r.person_id, 'contact_point_id', r.point_id,
      'email', r.email, 'display_name', r.display_name)
      order by r.person_id) filter (where r.point_id is not null), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'person_id', r.person_id, 'reason', r.reason)
      order by r.person_id) filter (where r.point_id is null), '[]'::jsonb)
    into v_eligible, v_refused
    from (
      select u.id as person_id,
             p.display_name,
             cp.id as point_id,
             cp.normalized_value as email,
             case when p.id is null then 'not_found'
                  when cp.id is null then 'no_usable_email' end as reason
        from unnest(v_unique) u(id)
        left join people p on p.id = u.id and p.tenant_id = p_tenant
        left join lateral (
          select cp1.id, cp1.normalized_value
            from contact_points cp1
           where cp1.tenant_id = p_tenant and cp1.person_id = p.id
             and cp1.channel = 'email' and cp1.verification_state <> 'invalid'
           order by cp1.is_primary desc, cp1.last_observed_at desc nulls last,
                    cp1.created_at desc
           limit 1
        ) cp on p.id is not null
    ) r;

  -- one checked contract binds preflight → apply: tenant, decision and the
  -- EXACT (person, contact point) pairs that will receive the row
  select string_agg(e ->> 'person_id' || ':' || (e ->> 'contact_point_id'), ','
                    order by e ->> 'person_id')
    into v_pairs
    from jsonb_array_elements(v_eligible) e;
  v_expected := md5(p_tenant::text || '|' || v_decision || '|' || coalesce(v_pairs, ''));

  if p_mode = 'preflight' then
    return jsonb_build_object(
      'requested', v_requested,
      'unique', coalesce(array_length(v_unique, 1), 0),
      'eligible', v_eligible,
      'eligible_count', jsonb_array_length(v_eligible),
      'refused', v_refused,
      'refused_count', jsonb_array_length(v_refused),
      'decision', v_decision,
      'cap', 100,
      'contract', v_expected);
  end if;

  -- ── apply ──
  v_request_id := p_args ->> 'request_id';
  if v_request_id is null or v_request_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'request_id must match ^[A-Za-z0-9_-]{8,64}$' using errcode = '22023';
  end if;
  v_contract := p_args ->> 'contract';
  if v_contract is null or v_contract <> v_expected then
    raise exception 'the selection changed since it was checked — review it again'
      using errcode = 'MK409';
  end if;
  if jsonb_array_length(v_eligible) = 0 then
    raise exception 'none of the selected contacts has a usable email address'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|mkt_permission', 42));
  v_fp := encode(extensions.digest(jsonb_build_object(
    'kind', 'bulk', 'request_id', v_request_id, 'actor', p_actor,
    'contract', v_contract, 'decision', v_decision, 'basis', v_basis,
    'method', v_method, 'reference', v_reference, 'note', v_note,
    'effective_at', p_args ->> 'effective_at')::text, 'sha256'), 'hex');
  select * into v_existing from marketing_permission_requests
   where tenant_id = p_tenant and request_id = v_request_id;
  if found then
    if v_existing.request_fingerprint = v_fp then
      return v_existing.result || jsonb_build_object('idempotent', true);
    end if;
    raise exception 'request_id was already used for a DIFFERENT request'
      using errcode = 'MK412';
  end if;

  v_bulk_ref := gen_random_uuid();
  v_evidence := jsonb_strip_nulls(jsonb_build_object(
    'basis', v_basis,
    'method', v_method,
    'reference', v_reference,
    'note', v_note,
    'attestation', v_attested,
    'recorded_via', 'marketing_permission_record_bulk',
    'bulk_ref', v_bulk_ref,
    'request_id', v_request_id));

  -- ONE statement appends every row; the transaction makes it all-or-nothing
  insert into communication_preferences
    (tenant_id, person_id, contact_point_id, channel, state, source,
     lawful_basis, evidence, effective_at, recorded_by)
  select p_tenant, (e ->> 'person_id')::uuid, (e ->> 'contact_point_id')::uuid,
         'email', v_decision, 'manual',
         case when v_decision = 'subscribed' then v_basis end,
         v_evidence, v_effective, p_actor
    from jsonb_array_elements(v_eligible) e;
  get diagnostics v_n = row_count;
  if v_n <> jsonb_array_length(v_eligible) then
    -- structurally unreachable; belt-and-braces so a partial write can never commit
    raise exception 'bulk permission write did not cover the confirmed selection';
  end if;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_actor_label, 'marketing.permission.bulk_recorded',
          'communication_preference', 'bulk:' || v_bulk_ref, 'ok',
          jsonb_build_object('requested', v_requested,
                             'unique', coalesce(array_length(v_unique, 1), 0),
                             'applied', v_n,
                             'refused', v_refused,
                             'decision', v_decision, 'basis', v_basis,
                             'effective_at', v_effective,
                             'request_id', v_request_id,
                             'authority_basis', 'marketing.contacts.manage'));

  perform marketing_event_append(p_tenant, 'marketing.permission.bulk_recorded',
    'communication_preference', v_bulk_ref, 'marketing-contacts',
    jsonb_build_object('k', 'permission-bulk:' || v_request_id,
                       'decision', v_decision, 'applied', v_n,
                       'refused', jsonb_array_length(v_refused),
                       'actor', v_actor_label, 'at', now()));

  v_result := jsonb_build_object(
    'requested', v_requested,
    'unique', coalesce(array_length(v_unique, 1), 0),
    'applied', v_n,
    'refused', v_refused,
    'refused_count', jsonb_array_length(v_refused),
    'decision', v_decision,
    'bulk_ref', v_bulk_ref,
    'effective_at', v_effective,
    'idempotent', false);

  insert into marketing_permission_requests
    (tenant_id, request_id, request_fingerprint, kind, result, actor)
  values (p_tenant, v_request_id, v_fp, 'bulk', v_result, p_actor);

  return v_result;
end $$;

-- ── bounded read: current state + append-only history for the contact card ──
create or replace function marketing_permission_history(p_tenant uuid, p_person uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_history jsonb;
  v_eligibility text;
begin
  if p_tenant is null or p_person is null then
    raise exception 'tenant and person required' using errcode = '22023';
  end if;
  if not exists (select 1 from people p where p.id = p_person and p.tenant_id = p_tenant) then
    raise exception 'contact not found for tenant' using errcode = 'P0002';
  end if;
  v_eligibility := marketing_contact_eligibility(p_tenant, p_person, 'email');
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pr.id,
           'state', pr.state,
           'source', pr.source,
           'lawful_basis', pr.lawful_basis,
           'evidence', pr.evidence,
           'effective_at', pr.effective_at,
           'recorded_at', pr.created_at,
           'recorded_by', pr.recorded_by,
           'email', cp.normalized_value)
           order by pr.effective_at desc, pr.created_at desc), '[]'::jsonb)
    into v_history
    from (select * from communication_preferences p0
           where p0.tenant_id = p_tenant and p0.person_id = p_person
             and p0.channel = 'email'
           order by p0.effective_at desc, p0.created_at desc
           limit 20) pr
    left join contact_points cp on cp.id = pr.contact_point_id;
  return jsonb_build_object(
    'eligibility', v_eligibility,
    'suppressed', v_eligibility = 'suppressed',
    'history', v_history);
end $$;

-- ── service-role-only boundary ──────────────────────────────────────────────
do $$
declare sig text;
begin
  foreach sig in array array[
    'marketing_permission_require_actor(uuid, uuid)',
    'marketing_permission_record(uuid, uuid, jsonb)',
    'marketing_permission_record_bulk(uuid, uuid, text, jsonb)',
    'marketing_permission_history(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated;', sig);
    execute format('grant execute on function %s to service_role;', sig);
  end loop;
end $$;
