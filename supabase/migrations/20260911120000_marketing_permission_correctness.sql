-- ServiceOS Marketing — permission-capture correctness (independent-review pass).
--
-- Additive correction over the APPLIED migration 20260910120000 (its bytes are
-- immutable — staging has already recorded them). Four confirmed findings are
-- corrected here, each with a regression lock in the suites:
--
--   1. IDEMPOTENT REPLAY WAS COUPLED TO MUTABLE CONTACT STATE. The receipt
--      check ran only AFTER people/contact points were re-resolved, so a
--      byte-equivalent replay stopped converging whenever the underlying
--      state moved (email edited/invalidated/removed, default selection
--      changed, a bulk member became eligible/refused). Now the request
--      fingerprint is computed from the CALLER REQUEST ONLY (canonicalised
--      inputs — never database resolution), the per-tenant advisory lock is
--      taken, and the (tenant, request_id) receipt is consulted FIRST:
--      a matching fingerprint returns the stored authoritative result
--      (idempotent:true) untouched by later state changes; a differing one is
--      MK412; only a genuinely NEW request proceeds to current-state
--      resolution and writes. (Fingerprints are versioned; a request id first
--      used under the pre-correction format can no longer replay-converge —
--      it fails safe as MK412 rather than ever writing twice.)
--
--   2. THE BULK CONTRACT DID NOT BIND THE COMPLETE PREFLIGHT TRUTH. The old
--      md5 covered only tenant|decision|eligible pairs, so a selection could
--      drift WITHIN its refused members (added/removed refused people,
--      changed refusal reasons) while the stale contract still applied.
--      The contract is now a VERSIONED SHA-256 ('v2:' || hex) over the whole
--      canonical preflight truth: contract version, tenant, decision, the
--      sorted unique selected-person set, the exact eligible
--      (person, contact point) pairs, the exact refused person ids WITH
--      reasons, the requested/unique counts and the server cap. APPLY
--      recomputes it from current state and requires byte-equivalence —
--      ANY drift (eligible or refused) is MK409 before anything is written.
--      md5 is not accepted as a contract format: every pre-correction
--      contract string mismatches by construction and re-preflights.
--
--   3. THE ACTOR GATE COULD PASS ON MALFORMED RESOLVER OUTPUT. `if not
--      ((v ->> 'enabled')::boolean)` and `if not ((v -> 'permissions') ? …)`
--      are three-valued: a NULL/missing/malformed resolver field made the
--      predicate NULL, which `if not …` silently treats as "do not raise".
--      The gate now fails CLOSED: the resolver output must be a jsonb object,
--      `enabled` must extract cleanly to exactly true, `permissions` must be
--      a jsonb array whose membership test is exactly true — anything else
--      denies with 42501. The canonical resolver itself is untouched.
--
--   4. PREFERENCE PRECEDENCE HAD NO DETERMINISTIC TIE. Same-scope facts with
--      identical effective_at AND created_at had no defined winner, so
--      different surfaces could disagree at the exact-tie boundary. The ONE
--      rule everywhere current preference state is derived is now:
--      most specific scope → latest effective_at → latest created_at →
--      on an exact timestamp tie 'unsubscribed' WINS → stable id order.
--      Applied to the canonical eligibility engine (which segments,
--      broadcasts and sequences all call), the contact-detail projection and
--      the permission-history read — no screen or sending gate can disagree.
--      A genuinely newer resubscription with evidence still wins.
--
-- Everything here is CREATE OR REPLACE / additive; no table, row or applied
-- migration is rewritten. Grants are re-asserted for every replaced function.

-- ── (1) actor gate: fail closed at the SQL authority boundary ───────────────
create or replace function marketing_permission_require_actor(p_tenant uuid, p_actor uuid)
returns text  -- actor label for audit rows
language plpgsql
stable
as $$
declare
  v_role text;
  v_actor_tenant uuid;
  v_resolved jsonb;
  v_enabled boolean;
  v_has_permission boolean;
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
  -- FAIL-CLOSED predicates: null, missing or malformed resolver output can
  -- never satisfy these — three-valued logic is not allowed to grant.
  if v_resolved is null or jsonb_typeof(v_resolved) <> 'object' then
    raise exception 'marketing permissions could not be resolved' using errcode = '42501';
  end if;
  begin
    v_enabled := (v_resolved ->> 'enabled')::boolean;
  exception when others then
    v_enabled := null;  -- malformed value ⇒ deny below
  end;
  if v_enabled is distinct from true then
    raise exception 'marketing is not enabled for this tenant' using errcode = '42501';
  end if;
  if jsonb_typeof(v_resolved -> 'permissions') is distinct from 'array' then
    raise exception 'marketing permissions could not be resolved' using errcode = '42501';
  end if;
  v_has_permission := (v_resolved -> 'permissions') ? 'marketing.contacts.manage';
  if v_has_permission is distinct from true then
    raise exception 'actor lacks marketing.contacts.manage' using errcode = '42501';
  end if;
  return coalesce((select email from profiles where id = p_actor), p_actor::text);
end $$;

-- ── (2) canonical eligibility: deterministic, opt-out-safe tie ──────────────
-- Verbatim re-issue of the authoritative engine (20260829120000) with ONE
-- change: the preference ORDER BY gains the exact-tie rule
-- (unsubscribed wins, then stable id order). Segments, broadcast preflight
-- and sequence enrolment/pre-send all call this function — one rule for all.
create or replace function marketing_endpoint_eligibility(
  p_tenant uuid,
  p_person uuid,
  p_channel text default 'email',
  p_contact_point uuid default null,
  p_destination text default null,
  p_topic text default null
) returns text
language plpgsql
stable
as $$
declare
  v_cp contact_points%rowtype;
  v_dest text;
  v_scalar text;
  v_state text;
  v_has_points boolean;
begin
  if p_tenant is null or p_person is null then
    raise exception 'tenant and person required' using errcode = '22023';
  end if;
  if p_channel not in ('email', 'phone', 'sms', 'whatsapp', 'social', 'other') then
    raise exception 'invalid channel' using errcode = '22023';
  end if;
  if not exists (select 1 from people p where p.id = p_person and p.tenant_id = p_tenant) then
    raise exception 'person not found in tenant' using errcode = 'P0002';
  end if;

  select case when p_channel = 'email' then marketing_normalize_endpoint('email', p.primary_email)
              when p_channel in ('phone', 'sms', 'whatsapp')
                then marketing_normalize_endpoint(p_channel, p.primary_phone)
              else null end
    into v_scalar
    from people p where p.id = p_person and p.tenant_id = p_tenant;

  -- ── Resolve the endpoint under decision ──
  if p_contact_point is not null then
    select * into v_cp from contact_points cp
     where cp.id = p_contact_point and cp.tenant_id = p_tenant
       and cp.person_id = p_person and cp.channel = p_channel;
    if not found then
      raise exception 'contact point does not belong to this person/channel'
        using errcode = '22023';
    end if;
    if p_destination is not null
       and marketing_normalize_endpoint(p_channel, p_destination)
           is distinct from v_cp.normalized_value then
      raise exception 'destination does not match the supplied contact point'
        using errcode = '22023';
    end if;
    if v_cp.verification_state = 'invalid' then return 'invalid'; end if;
    v_dest := v_cp.normalized_value;
  elsif p_destination is not null then
    v_dest := marketing_normalize_endpoint(p_channel, p_destination);
    if v_dest is null then return 'invalid'; end if;   -- malformed destination
    select * into v_cp from contact_points cp
     where cp.tenant_id = p_tenant and cp.person_id = p_person
       and cp.channel = p_channel and cp.normalized_value = v_dest
     limit 1;
    if found and v_cp.verification_state = 'invalid' then return 'invalid'; end if;
  else
    -- Default endpoint: primary USABLE point, else most recent USABLE point
    -- (invalid points are never selected); else the canonical scalar; else none.
    select * into v_cp from contact_points cp
     where cp.tenant_id = p_tenant and cp.person_id = p_person and cp.channel = p_channel
       and cp.verification_state <> 'invalid'
     order by cp.is_primary desc, cp.last_observed_at desc nulls last, cp.created_at desc
     limit 1;
    if found then
      v_dest := v_cp.normalized_value;
    else
      select exists (select 1 from contact_points cp
                      where cp.tenant_id = p_tenant and cp.person_id = p_person
                        and cp.channel = p_channel)
        into v_has_points;
      -- Invalid EVIDENCE wins over the scalar: when a contact point marked
      -- invalid carries the same normalised value as the scalar, the scalar IS
      -- that known-bad endpoint — it never silently becomes the fallback and
      -- never inherits a generic subscription.
      if v_scalar is not null and exists (
           select 1 from contact_points cp
            where cp.tenant_id = p_tenant and cp.person_id = p_person
              and cp.channel = p_channel and cp.verification_state = 'invalid'
              and cp.normalized_value = v_scalar) then
        return 'invalid';
      elsif v_scalar is not null then
        v_dest := v_scalar;
      elsif v_has_points then
        return 'invalid';        -- only invalid endpoints exist on this channel
      else
        return 'no_contact_point';
      end if;
    end if;
  end if;

  -- ── Suppression (fail-closed, checked before anything can grant) ──
  if exists (
    select 1 from contact_suppressions s
    where s.tenant_id = p_tenant and s.active and s.channel = p_channel
      and (
        s.person_id = p_person
        or (v_cp.id is not null and s.contact_point_id = v_cp.id)
        or (s.contact_point_id is not null and s.contact_point_id in (
              select cp2.id from contact_points cp2
               where cp2.tenant_id = p_tenant and cp2.person_id = p_person
                 and cp2.channel = p_channel and cp2.normalized_value = v_dest))
        or (v_dest is not null and s.normalized_value = v_dest)
      )
  ) then
    return 'suppressed';
  end if;

  -- ── Linkage: an explicit destination that is neither a contact point of this
  --    Person nor their canonical scalar is not a usable endpoint — it NEVER
  --    inherits a generic Person-level subscription. ──
  if p_contact_point is null and p_destination is not null
     and v_cp.id is null and (v_scalar is null or v_dest <> v_scalar) then
    return 'invalid';
  end if;

  -- ── Preference: SCOPE-RANKED precedence — most specific applicable scope
  --    first ((endpoint+topic) > endpoint > topic > generic), LATEST within
  --    it; on an EXACT timestamp tie 'unsubscribed' wins; final order is
  --    stabilised by id so the outcome is fully deterministic. ──
  select pref.state into v_state
    from communication_preferences pref
   where pref.tenant_id = p_tenant and pref.person_id = p_person
     and pref.channel = p_channel
     and (pref.contact_point_id is null
          or (v_cp.id is not null and pref.contact_point_id = v_cp.id))
     and (pref.topic is null or (p_topic is not null and pref.topic = p_topic))
   order by
     (case when pref.contact_point_id is not null then 2 else 0 end
      + case when pref.topic is not null then 1 else 0 end) desc,
     pref.effective_at desc,
     pref.created_at desc,
     (pref.state = 'unsubscribed') desc,
     pref.id desc
   limit 1;

  return case v_state
    when 'unsubscribed' then 'unsubscribed'
    when 'subscribed' then 'subscribed'
    else 'unknown'
  end;
end $$;

-- ── (3) contact-detail projection: the SAME tie rule for the displayed
--        current preference per scope (previously effective_at only — no
--        created_at and no tie rule, so the screen could disagree with the
--        sending gates). Verbatim re-issue with only that ORDER BY changed. ──
create or replace function marketing_contact_detail(p_tenant uuid, p_person uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_person jsonb;
  v_out jsonb;
begin
  select to_jsonb(x) into v_person
  from (
    select p.id as person_id, p.display_name, p.first_name, p.last_name,
           p.primary_email, p.primary_phone, p.address_text, p.postcode,
           p.created_at, p.created_source, p.verified,
           c.id as company_id, c.name as company_name, c.domain as company_domain
      from people p
      left join companies c on c.id = p.company_id and c.tenant_id = p_tenant
     where p.tenant_id = p_tenant and p.id = p_person
  ) x;
  if v_person is null then
    raise exception 'person not found in tenant' using errcode = 'P0002';
  end if;

  select v_person
    || jsonb_build_object(
      'relationships', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', r.id, 'relationship_type', r.relationship_type,
                 'lifecycle_stage_key', r.lifecycle_stage_key, 'status', r.status,
                 'owner_id', r.owner_id, 'owner_name', pr.full_name,
                 'source', r.source, 'version', r.version,
                 'created_at', r.created_at, 'updated_at', r.updated_at)
                 order by case r.status when 'active' then 0 when 'inactive' then 1 else 2 end,
                          r.created_at)
          from contact_relationships r
          left join profiles pr on pr.id = r.owner_id and pr.tenant_id = p_tenant
         where r.tenant_id = p_tenant and r.person_id = p_person), '[]'::jsonb),
      'contact_points', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', cp.id, 'channel', cp.channel, 'value', cp.value,
                 'normalized_value', cp.normalized_value, 'label', cp.label,
                 'is_primary', cp.is_primary, 'verification_state', cp.verification_state,
                 'source', cp.source, 'last_observed_at', cp.last_observed_at,
                 'updated_at', cp.updated_at,
                 'protected', (cp.verification_state = 'verified' or cp.source <> 'manual'),
                 'eligibility', marketing_endpoint_eligibility(
                   p_tenant, p_person, cp.channel, cp.id, null, null))
                 order by cp.channel, cp.is_primary desc)
          from contact_points cp
         where cp.tenant_id = p_tenant and cp.person_id = p_person), '[]'::jsonb),
      'eligibility', jsonb_build_object(
        'email', marketing_contact_eligibility(p_tenant, p_person, 'email'),
        'phone', marketing_contact_eligibility(p_tenant, p_person, 'phone')),
      'suppressions', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', s.id, 'channel', s.channel, 'reason', s.reason,
                 'scope', case when s.person_id = p_person then 'person'
                               when s.contact_point_id is not null then 'contact_point'
                               else 'destination' end,
                 'destination', s.normalized_value,
                 'suppressed_at', s.suppressed_at) order by s.suppressed_at desc)
          from contact_suppressions s
         where s.tenant_id = p_tenant and s.active
           and (s.person_id = p_person
                or s.contact_point_id in (
                     select cp2.id from contact_points cp2
                      where cp2.tenant_id = p_tenant and cp2.person_id = p_person)
                or (s.normalized_value is not null and s.normalized_value in (
                     select cp3.normalized_value from contact_points cp3
                      where cp3.tenant_id = p_tenant and cp3.person_id = p_person
                     union
                     select marketing_normalize_endpoint('email', p2.primary_email)
                       from people p2
                      where p2.id = p_person and p2.tenant_id = p_tenant
                        and p2.primary_email is not null
                     union
                     select marketing_normalize_endpoint('phone', p3.primary_phone)
                       from people p3
                      where p3.id = p_person and p3.tenant_id = p_tenant
                        and p3.primary_phone is not null)))),
        '[]'::jsonb),
      'preferences', coalesce((
        select jsonb_agg(to_jsonb(lp)) from (
          select distinct on (pref.channel, coalesce(pref.topic, ''), coalesce(pref.contact_point_id::text, ''))
                 pref.channel, pref.topic, pref.contact_point_id, pref.state,
                 pref.source, pref.effective_at
            from communication_preferences pref
           where pref.tenant_id = p_tenant and pref.person_id = p_person
           order by pref.channel, coalesce(pref.topic, ''),
                    coalesce(pref.contact_point_id::text, ''), pref.effective_at desc,
                    pref.created_at desc, (pref.state = 'unsubscribed') desc, pref.id desc
        ) lp), '[]'::jsonb),
      'tags', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', mt.id, 'key', mt.key, 'label', mt.label, 'tone', mt.tone,
                 'assigned_at', ta.created_at, 'source', ta.source))
          from contact_tag_assignments ta
          join marketing_tags mt on mt.id = ta.tag_id and mt.tenant_id = p_tenant
         where ta.tenant_id = p_tenant and ta.person_id = p_person), '[]'::jsonb),
      'interactions', coalesce((
        select jsonb_agg(to_jsonb(ix)) from (
          select i.id, i.occurred_at, i.interaction_type, i.direction,
                 i.source_type, i.subject, i.summary, i.processing_status
            from interactions i
           where i.tenant_id = p_tenant and i.related_person_id = p_person
           order by i.occurred_at desc limit 50
        ) ix), '[]'::jsonb),
      'customer_card', (
        select to_jsonb(cc) from (
          select c2.id, c2.status, c2.priority, c2.recommended_action,
                 c2.latest_activity_at,
                 c2.context -> 'marketing' as marketing_context
            from customer_cards c2
           where c2.tenant_id = p_tenant and c2.person_id = p_person
           order by c2.updated_at desc limit 1
        ) cc))
  into v_out;
  return v_out;
end $$;

-- ── (4) single record: caller-request fingerprint BEFORE any resolution ─────
create or replace function marketing_permission_record(p_tenant uuid, p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_actor_label text;
  v_key text;
  v_person uuid;
  v_point_arg uuid;
  v_point_supplied boolean;
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
  -- 1) request envelope + actor: strict validation of CALLER INPUT only
  v_actor_label := marketing_permission_require_actor(p_tenant, p_actor);

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

  -- 2) canonicalise caller-supplied inputs (syntax only — NO database reads)
  begin
    v_person := (p_args ->> 'person_id')::uuid;
  exception when others then
    raise exception 'invalid person id' using errcode = '22023';
  end;
  if v_person is null then
    raise exception 'invalid person id' using errcode = '22023';
  end if;

  v_point_supplied := p_args ? 'contact_point_id';
  if v_point_supplied then
    begin
      v_point_arg := (p_args ->> 'contact_point_id')::uuid;
    exception when others then
      raise exception 'invalid contact point id' using errcode = '22023';
    end;
    if v_point_arg is null then  -- explicit JSON null is a malformed envelope
      raise exception 'invalid contact point id' using errcode = '22023';
    end if;
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

  if v_decision = 'subscribed' then
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

  -- 3) fingerprint the CALLER REQUEST — never mutable database resolution.
  --    A byte-equivalent replay therefore converges on the stored receipt even
  --    after the person's contact points, defaults or eligibility change.
  v_fp := encode(extensions.digest(jsonb_build_object(
    'v', 2, 'kind', 'single', 'request_id', v_request_id, 'actor', p_actor,
    'person', v_person,
    'contact_point_supplied', v_point_supplied,
    'contact_point', v_point_arg,
    'decision', v_decision, 'basis', v_basis, 'method', v_method,
    'reference', v_reference, 'note', v_note,
    'effective_at', p_args ->> 'effective_at',
    'attestation', v_attested)::text, 'sha256'), 'hex');

  -- 4-7) lock → receipt lookup → converge or refuse, BEFORE any resolution
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|mkt_permission', 42));
  select * into v_existing from marketing_permission_requests
   where tenant_id = p_tenant and request_id = v_request_id;
  if found then
    if v_existing.request_fingerprint = v_fp then
      return v_existing.result || jsonb_build_object('idempotent', true);
    end if;
    raise exception 'request_id was already used for a DIFFERENT request'
      using errcode = 'MK412';
  end if;

  -- 8) only a genuinely NEW request reaches current-state resolution
  if not exists (select 1 from people p where p.id = v_person and p.tenant_id = p_tenant) then
    raise exception 'contact not found for tenant' using errcode = 'P0002';
  end if;

  -- email contact point: explicitly selected, or the person's default USABLE
  -- email point (primary first, then most recent; invalid never selected) —
  -- the SAME choice the eligibility engine makes. It must belong to the person.
  if v_point_supplied then
    select * into v_point from contact_points cp
     where cp.id = v_point_arg
       and cp.tenant_id = p_tenant and cp.person_id = v_person
       and cp.channel = 'email';
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

-- ── (5) bulk: complete versioned contract + caller-request idempotency ──────
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
  v_pairs jsonb;
  v_evidence jsonb;
  v_bulk_ref uuid;
  v_n int := 0;
  v_result jsonb;
begin
  -- 1) envelope + actor: strict validation of CALLER INPUT only
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

  -- 2) canonicalise the selection: explicit, deduplicated, strictly capped
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

  -- ── APPLY idempotency gate: fingerprint the CALLER REQUEST (canonical
  --    selection + decision + evidence + contract), take the tenant lock and
  --    consult the receipt BEFORE any current-state resolution — a
  --    byte-equivalent replay returns the stored result no matter how the
  --    underlying people/contact points/eligibility have moved since. ──
  if p_mode = 'apply' then
    v_request_id := p_args ->> 'request_id';
    if v_request_id is null or v_request_id !~ '^[A-Za-z0-9_-]{8,64}$' then
      raise exception 'request_id must match ^[A-Za-z0-9_-]{8,64}$' using errcode = '22023';
    end if;
    v_contract := nullif(p_args ->> 'contract', '');
    if v_contract is null then
      raise exception 'the preflight contract is required for apply' using errcode = '22023';
    end if;

    v_fp := encode(extensions.digest(jsonb_build_object(
      'v', 2, 'kind', 'bulk', 'request_id', v_request_id, 'actor', p_actor,
      'selected', to_jsonb(v_unique), 'decision', v_decision,
      'basis', v_basis, 'method', v_method, 'reference', v_reference,
      'note', v_note, 'effective_at', p_args ->> 'effective_at',
      'attestation', v_attested, 'contract', v_contract)::text, 'sha256'), 'hex');

    perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|mkt_permission', 42));
    select * into v_existing from marketing_permission_requests
     where tenant_id = p_tenant and request_id = v_request_id;
    if found then
      if v_existing.request_fingerprint = v_fp then
        return v_existing.result || jsonb_build_object('idempotent', true);
      end if;
      raise exception 'request_id was already used for a DIFFERENT request'
        using errcode = 'MK412';
    end if;
  end if;

  -- ── current-state resolution (genuinely new work only): every selected
  --    person to their default USABLE email point (the same choice the single
  --    action and the eligibility engine make); refusals are named per
  --    person, never silently dropped ──
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'person_id', r.person_id, 'contact_point_id', r.point_id,
      'email', r.email, 'display_name', r.display_name)
      order by r.person_id) filter (where r.point_id is not null), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'person_id', r.person_id, 'reason', r.reason)
      order by r.person_id) filter (where r.point_id is null), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'person_id', r.person_id, 'contact_point_id', r.point_id)
      order by r.person_id) filter (where r.point_id is not null), '[]'::jsonb)
    into v_eligible, v_refused, v_pairs
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

  -- ── the versioned contract binds preflight → apply over the COMPLETE
  --    canonical preflight truth: version, tenant, decision, the sorted
  --    unique selected-person set, the exact eligible (person, contact point)
  --    pairs, the exact refused person ids WITH reasons, the requested/unique
  --    counts and the server cap. jsonb text serialisation is canonical
  --    (deduplicated, deterministically ordered keys), so equal truth ⇒ equal
  --    bytes ⇒ equal hash — and ANY drift, eligible or refused, breaks it. ──
  v_expected := 'v2:' || encode(extensions.digest(jsonb_build_object(
    'contract_version', 2,
    'tenant', p_tenant,
    'decision', v_decision,
    'selected', to_jsonb(v_unique),
    'eligible', v_pairs,
    'refused', v_refused,
    'requested', v_requested,
    'unique_count', coalesce(array_length(v_unique, 1), 0),
    'cap', 100)::text, 'sha256'), 'hex');

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

  -- ── apply: the caller's contract must equal the recomputed CURRENT truth
  --    byte-for-byte (md5-era contracts mismatch by construction) ──
  if v_contract <> v_expected then
    raise exception 'the selection changed since it was checked — review it again'
      using errcode = 'MK409';
  end if;
  if jsonb_array_length(v_eligible) = 0 then
    raise exception 'none of the selected contacts has a usable email address'
      using errcode = '22023';
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

-- ── (6) history read: the SAME deterministic order for the displayed trail ──
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
           order by pr.effective_at desc, pr.created_at desc,
                    (pr.state = 'unsubscribed') desc, pr.id desc), '[]'::jsonb)
    into v_history
    from (select * from communication_preferences p0
           where p0.tenant_id = p_tenant and p0.person_id = p_person
             and p0.channel = 'email'
           order by p0.effective_at desc, p0.created_at desc,
                    (p0.state = 'unsubscribed') desc, p0.id desc
           limit 20) pr
    left join contact_points cp on cp.id = pr.contact_point_id;
  return jsonb_build_object(
    'eligibility', v_eligibility,
    'suppressed', v_eligibility = 'suppressed',
    'history', v_history);
end $$;

-- ── service-role-only boundary re-asserted for every replaced function ──────
do $$
declare sig text;
begin
  foreach sig in array array[
    'marketing_permission_require_actor(uuid, uuid)',
    'marketing_permission_record(uuid, uuid, jsonb)',
    'marketing_permission_record_bulk(uuid, uuid, text, jsonb)',
    'marketing_permission_history(uuid, uuid)',
    'marketing_endpoint_eligibility(uuid, uuid, text, uuid, text, text)',
    'marketing_contact_detail(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated;', sig);
    execute format('grant execute on function %s to service_role;', sig);
  end loop;
end $$;
