-- ============================================================================
-- Drummond Heating — Customer Health (callback) tenant configuration
-- ============================================================================
-- This is TENANT configuration, deliberately separate from the universal engine
-- (20260820120000). It specialises the universal Customer Health engine for
-- Drummond Heating without any tenant literal leaking into universal code.
--
-- Two mechanisms are used, both already in the platform:
--   • config_versions  — a versioned 'policy' artifact ('customer_health'). It is
--     seeded as DRAFT (status='draft'), i.e. the source boundary is DISABLED until
--     an operator explicitly reviews and publishes it. Shadow processing of live
--     candidates must refuse to run until a PUBLISHED policy version exists.
--   • operating_profile_entries — the layered key/value config the pure evaluator
--     reads (namespace 'customer_health'), version-pinned to that config_versions row.
--
-- PRIVACY / DATA SAFETY: no real customer PII, and no real DDIs, extensions or staff
-- names are committed here. The ownership map below is an EXAMPLE STRUCTURE using
-- placeholder values; an operator replaces these with the tenant's real values
-- out-of-band and then publishes. Because the allowlist ships disabled and the policy
-- ships draft, nothing processes live data from this migration alone.
--
-- Tenant: Drummond Heating — canonical seeded slug 'drummonds' (see the tenants seed
-- in 20260716120000_intelligence_backbone.sql); 'drummond' is accepted as a legacy
-- alias for environments where the slug was adjusted out-of-band. Resolved by slug to
-- avoid hardcoding the UUID in SQL logic. This seed FAILS LOUDLY (raises) when no
-- tenant — or more than one — matches: a silent no-op here would leave the entire
-- Track A slice inert with only a NOTICE as evidence.
-- ============================================================================

do $$
declare
  v_tenant   uuid;
  v_count    int;
  v_version  uuid;
  v_ref      text;
begin
  select count(*) into v_count from public.tenants where slug in ('drummonds', 'drummond');
  if v_count = 0 then
    raise exception 'Drummond Customer Health config: no tenant with slug drummonds/drummond — the tenant seed migration (20260716120000) must run first';
  elsif v_count > 1 then
    raise exception 'Drummond Customer Health config: % tenants match slugs drummonds/drummond — ambiguous, refusing to seed', v_count;
  end if;
  select id into v_tenant from public.tenants where slug in ('drummonds', 'drummond');
  v_ref := v_tenant::text;

  -- ── Policy version (DRAFT = disabled/boundary not yet selected). ───────────
  -- Idempotent: reuse an existing customer_health draft/version for this tenant.
  select id into v_version from public.config_versions
   where tenant_id = v_tenant and artifact_kind = 'policy' and artifact_key = 'customer_health'
   order by version desc limit 1;

  if v_version is null then
    insert into public.config_versions
      (tenant_id, artifact_kind, artifact_key, version, status, author, note)
    values
      (v_tenant, 'policy', 'customer_health', 1, 'draft', 'operator',
       'Drummond Customer Health (callback) — DRAFT. Publish to enable shadow processing of live candidates.')
    returning id into v_version;
  end if;

  -- ── Layered config the pure evaluator + classifier read. ──────────────────
  -- All under namespace 'customer_health', version-pinned to v_version. Idempotent by
  -- delete-then-insert of this tenant's namespace: re-applying resets the namespace to
  -- this baseline (placeholder ownership maps included) — operator-replaced values are
  -- expected to be re-applied out-of-band after any re-seed, per the note above.
  delete from public.operating_profile_entries
   where tenant_id = v_tenant and namespace = 'customer_health' and scope_kind = 'tenant';

  insert into public.operating_profile_entries
    (tenant_id, scope_kind, scope_ref, domain, namespace, key, value, version_id)
  values
  -- Callback definition — what the classifier counts as an explicit callback request.
  (v_tenant,'tenant',v_ref,'serviceos','customer_health','callback.definition', jsonb_build_object(
     'requires_explicit_request', true,
     'telephone_based', true,
     'include_intents', jsonb_build_array(
        'asks_to_be_called_back','requests_contact_from_team','leaves_message_needing_return_call',
        'asks_for_unavailable_person_to_make_contact','requests_telephone_followup'),
     'exclude_intents', jsonb_build_array(
        'generic_unanswered_no_request','spam','internal','supplier','accidental_empty',
        'resolved_on_transfer','email_only_request','intent_unclear')
   ), v_version),

  -- Due expectation — window before a callback is "due soon" vs "overdue".
  (v_tenant,'tenant',v_ref,'serviceos','customer_health','callback.due_expectation', jsonb_build_object(
     'default_due_hours', 4,          -- proposed due = candidate_time + 4h
     'due_soon_within_hours', 4,      -- watch while within this window
     'priority_due_hours', 2          -- higher-priority callbacks: tighter window
   ), v_version),

  -- Escalation thresholds — when at_risk becomes critical.
  (v_tenant,'tenant',v_ref,'serviceos','customer_health','callback.escalation', jsonb_build_object(
     'overdue_grace_hours', 0,
     'critical_on_repeat_count', 2    -- overdue + >=2 contacts on same obligation ⇒ critical
   ), v_version),

  -- Ownership resolution order (deterministic; universal engine reads this).
  (v_tenant,'tenant',v_ref,'serviceos','customer_health','ownership.resolution_order', jsonb_build_array(
     'ddi','extension','queue','named_recipient','shared_responsibility','fallback_role'
   ), v_version),

  -- Ownership maps — EXAMPLE STRUCTURE with placeholder values (no real DDIs/staff).
  -- An operator replaces these with the tenant's real mappings before publishing.
  (v_tenant,'tenant',v_ref,'serviceos','customer_health','ownership.maps', jsonb_build_object(
     'ddi', jsonb_build_object(
        -- '+44XXXXXXXXXX', example only:
        'EXAMPLE_FINANCE_DDI', jsonb_build_object('label','Finance line','responsibility','team:finance')),
     'extension', jsonb_build_object(),
     'queue', jsonb_build_object(
        'scheduling', jsonb_build_object('label','Scheduling queue','responsibility','team:scheduling')),
     'named_recipient', jsonb_build_object(
        -- lower-cased requested name ⇒ responsibility ref (placeholder):
        'EXAMPLE_NAME', jsonb_build_object('responsibility','member:EXAMPLE_MEMBER_REF')),
     'shared_responsibility', jsonb_build_object(),
     'fallback_role', jsonb_build_object('responsibility','role:coordinator','label','Coordinator (fallback)')
   ), v_version),

  -- Source boundary — DISABLED until an operator explicitly selects sources.
  (v_tenant,'tenant',v_ref,'serviceos','customer_health','source.allowlist', jsonb_build_object(
     'enabled', false,               -- << the first source boundary, disabled by default
     'sources', jsonb_build_array(), -- e.g. ['phone_call'] once selected
     'note','Disabled until explicitly selected by an operator.'
   ), v_version),

  -- Privacy — bound and redact any excerpt surfaced; never expose transcripts.
  (v_tenant,'tenant',v_ref,'serviceos','customer_health','privacy', jsonb_build_object(
     'redact_excerpts', true,
     'max_excerpt_chars', 120,
     'expose_transcript', false
   ), v_version),

  -- Terminology — tenant-facing labels for the internal states (labels only).
  (v_tenant,'tenant',v_ref,'serviceos','customer_health','terminology', jsonb_build_object(
     'healthy','No callback owed',
     'watch','Callback owed (in time)',
     'at_risk','Callback overdue',
     'critical','Callback overdue — repeated contact',
     'recovering','Callback made (verifying)'
   ), v_version);

  raise notice 'Drummond Customer Health config seeded (policy version % — DRAFT, allowlist DISABLED)', v_version;
end $$;
