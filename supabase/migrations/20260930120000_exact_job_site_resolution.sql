-- ServiceOS — Phase 11P: EXACT Job→Site resolution (Defect D).
--
-- Phase 11O imported package v4 into the controlled pilot and only afterwards
-- was it noticed that import_job_row never passed the record's site_external_id
-- to the resolver: import_resolve_job_site takes (tenant, source, customer,
-- postcode, address) and nothing else. So the package's 228 exact work-address
-- references — reconstructed in 11K only where every corroborating source agreed,
-- and proven in-package by the contract — were discarded in favour of
-- postcode/address matching. Of those 228, 89 linked by weaker evidence, 99
-- became `site_ambiguous` review conflicts and 40 linked to nothing.
--
-- This migration makes the exact reference the FIRST and STRONGEST path, and —
-- critically — the ONLY path when it is present. Silently degrading a
-- contradictory exact reference to address matching would be a guess dressed as
-- evidence, which is precisely what the whole importer refuses to do.
--
-- Behaviour:
--   EMPTY site_external_id  → the existing postcode/address fallback, unchanged.
--   NON-EMPTY               → resolve through the tenant- and source-scoped
--                             immutable site import link; the site must exist and
--                             must belong to the Job's own resolved customer;
--                             returns strategy `exact_external_id`. A missing,
--                             cross-customer or otherwise contradictory reference
--                             returns `error` and NEVER falls back.
--
-- Preview and apply share the resolver, so an exact reference is visible in the
-- preview rather than discovered at apply. An exact reference can never produce
-- `site_ambiguous`: it either resolves exactly or fails closed.
--
-- Migrations 20260912120000 and 20260929120000 are NOT edited. import_match_job
-- and import_job_row are replaced with identical bodies except for the site
-- resolution block.

-- ───────────────────────────────────────────────────────────────────────────
-- A contradictory EXACT reference is a NEW, BLOCKING conflict type. The check
-- constraint is widened rather than dropped, so every existing type stays
-- enumerated and an unknown type is still rejected.
-- ───────────────────────────────────────────────────────────────────────────
alter table import_conflicts drop constraint if exists import_conflicts_conflict_type_check;
alter table import_conflicts add constraint import_conflicts_conflict_type_check
  check (conflict_type = any (array[
    'ambiguous_channel',
    'channel_disagreement',
    'multiple_candidates',
    'company_person_overlap',
    'site_ambiguous',
    'site_exact_unresolvable'
  ]));

-- ───────────────────────────────────────────────────────────────────────────
-- import_resolve_job_site_exact — the exact path. Fail-closed by construction.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_resolve_job_site_exact(
  p_tenant uuid, p_source text, p_cust_table text, p_cust_id uuid,
  p_site_external_id text
) returns jsonb
language plpgsql
stable
as $fn$
declare
  v_ref text := nullif(trim(coalesce(p_site_external_id, '')), '');
  v_link import_entity_links%rowtype;
  v_site sites%rowtype;
  v_owner uuid;
begin
  if v_ref is null then
    return jsonb_build_object('outcome', 'absent');
  end if;
  if p_cust_table is null or p_cust_id is null then
    return jsonb_build_object('outcome', 'error', 'reason', 'customer_unresolved');
  end if;

  -- The immutable identity map is the ONLY way an external id becomes an entity.
  select * into v_link from import_entity_links l
   where l.tenant_id = p_tenant and l.source_system = p_source
     and l.entity_kind = 'site' and l.external_id = v_ref;
  if not found then
    return jsonb_build_object('outcome', 'error',
      'reason', 'exact_site_reference_not_imported');
  end if;
  if v_link.entity_table <> 'sites' then
    return jsonb_build_object('outcome', 'error',
      'reason', 'exact_site_reference_points_at_unexpected_table');
  end if;

  select * into v_site from sites s
   where s.id = v_link.entity_id and s.tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('outcome', 'error',
      'reason', 'exact_site_missing_in_tenant');
  end if;

  -- An exact link may NEVER cross customers: that would attach one customer's
  -- job to another customer's address.
  v_owner := case when p_cust_table = 'people' then v_site.person_id
                  when p_cust_table = 'companies' then v_site.company_id
                  else null end;
  if v_owner is null or v_owner <> p_cust_id then
    return jsonb_build_object('outcome', 'error',
      'reason', 'exact_site_belongs_to_a_different_customer');
  end if;

  return jsonb_build_object('outcome', 'resolved', 'site_id', v_site.id,
    'strategy', 'exact_external_id');
end $fn$;

comment on function import_resolve_job_site_exact(uuid, text, text, uuid, text) is
  'Phase 11P: resolves a Job site from an EXACT site_external_id through the '
  'immutable import identity map. Fails closed on a missing, cross-tenant, '
  'cross-customer or otherwise contradictory reference; never guesses.';

-- ───────────────────────────────────────────────────────────────────────────
-- import_resolve_job_site_v2 — exact first; the ORIGINAL fallback otherwise.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_resolve_job_site_v2(
  p_tenant uuid, p_source text, p_cust_table text, p_cust_id uuid,
  p_site_external_id text, p_postcode text, p_address text
) returns jsonb
language plpgsql
stable
as $fn$
declare
  v_exact jsonb;
begin
  v_exact := import_resolve_job_site_exact(p_tenant, p_source, p_cust_table,
                                           p_cust_id, p_site_external_id);
  -- Present but contradictory → error, and NO fallback. Present and good →
  -- exact wins over any weaker postcode/address agreement.
  if v_exact ->> 'outcome' <> 'absent' then
    return v_exact;
  end if;
  return import_resolve_job_site(p_tenant, p_source, p_cust_table, p_cust_id,
                                 p_postcode, p_address);
end $fn$;

comment on function import_resolve_job_site_v2(uuid, text, text, uuid, text, text, text) is
  'Phase 11P: exact site_external_id first and, when present, exclusively; '
  'otherwise the unchanged deterministic postcode/address fallback.';

-- ───────────────────────────────────────────────────────────────────────────
-- import_match_job (PREVIEW) — identical except that it resolves through v2.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_match_job(
  p_tenant uuid, p_source text, p_record jsonb
) returns jsonb
language plpgsql
stable
as $$
declare
  v_invalid jsonb;
  v_ext text := nullif(trim(coalesce(p_record ->> 'external_id', '')), '');
  v_cust text := nullif(trim(coalesce(p_record ->> 'customer_external_id', '')), '');
  v_link import_entity_links%rowtype;
  v_site jsonb;
begin
  v_invalid := import_validate_job_row(p_tenant, p_source, p_record);
  if v_invalid is not null then
    return jsonb_build_object('action', 'invalid', 'strategy', 'invalid',
      'confidence', 0, 'reason', v_invalid ->> 'reason', 'candidates', 0);
  end if;
  if exists (select 1 from import_entity_links l
              where l.tenant_id = p_tenant and l.source_system = p_source
                and l.entity_kind = 'job' and l.external_id = v_ext) then
    return jsonb_build_object('action', 'matched', 'strategy', 'external_id',
      'confidence', 1.0, 'candidates', 1);
  end if;
  select * into v_link from import_entity_links l
   where l.tenant_id = p_tenant and l.source_system = p_source
     and l.entity_kind = 'customer' and l.external_id = v_cust;
  if not found then
    return jsonb_build_object('action', 'held', 'strategy', 'customer_not_imported',
      'confidence', 0, 'candidates', 0);
  end if;
  -- 11P: EXACT site evidence first. A contradictory exact reference is a
  -- conflict the preview must SHOW, not a create the operator discovers later.
  v_site := import_resolve_job_site_v2(p_tenant, p_source,
    v_link.entity_table, v_link.entity_id,
    p_record ->> 'site_external_id',
    p_record ->> 'site_postcode', p_record ->> 'site_address_text');
  if v_site ->> 'outcome' = 'error' then
    return jsonb_build_object('action', 'probable', 'strategy', 'site_exact_unresolvable',
      'confidence', 0, 'candidates', 0,
      'site_outcome', 'error', 'site_reason', v_site ->> 'reason');
  end if;
  return jsonb_build_object('action', 'new', 'strategy', 'created',
    'confidence', 1.0, 'candidates', 0,
    'site_outcome', v_site ->> 'outcome',
    'site_strategy', v_site ->> 'strategy');
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- import_job_row (APPLY) — identical except for the site resolution block.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_job_row(
  p_tenant uuid, p_import uuid, p_actor uuid, p_row_number int,
  p_record jsonb, p_options jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_imp data_imports%rowtype;
  v_source text;
  v_short jsonb;
  v_attempt int;
  v_invalid jsonb;
  v_ext text := nullif(trim(coalesce(p_record ->> 'external_id', '')), '');
  v_cust_ext text := nullif(trim(coalesce(p_record ->> 'customer_external_id', '')), '');
  v_link import_entity_links%rowtype;
  v_job jobs%rowtype;
  v_job_id uuid;
  v_outcome text;
  v_status text := trim(coalesce(p_record ->> 'status', ''));
  v_active boolean := coalesce((p_record ->> 'active')::boolean, true);
  v_site jsonb;
  v_site_id uuid;
  v_conflict_id uuid;
  v_meta jsonb;
  v_hold_reason text;
  v_jn text;
begin
  v_imp := import_row_preamble(p_tenant, p_import, p_actor, p_row_number,
                               p_record, p_options, 'jobs');
  v_source := v_imp.preview -> 'sealed' ->> 'provenance_source';
  select o_short, o_attempt into v_short, v_attempt
    from import_row_prior(p_tenant, p_import, p_row_number);
  if v_short is not null then return v_short; end if;

  v_invalid := import_validate_job_row(p_tenant, v_source, p_record);
  if v_invalid is not null then
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason, fields, attempt)
    values (p_tenant, p_import, p_row_number, 'invalid',
            v_invalid ->> 'reason',
            coalesce((select array_agg(e) from jsonb_array_elements_text(
                        v_invalid -> 'fields') e), '{}'::text[]),
            v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          fields = excluded.fields, attempt = excluded.attempt;
    return jsonb_build_object('action', 'invalid', 'reason', v_invalid ->> 'reason');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|ext|' || v_source || '|job|' || v_ext, 42));

  -- the customer relationship is REQUIRED — an orphan job is held, never
  -- created against nothing and never cross-tenant
  select * into v_link from import_entity_links l
   where l.tenant_id = p_tenant and l.source_system = v_source
     and l.entity_kind = 'customer' and l.external_id = v_cust_ext;
  if not found then
    if exists (select 1 from import_conflicts c
                where c.tenant_id = p_tenant and c.source_system = v_source
                  and c.entity_kind = 'customer' and c.external_id = v_cust_ext
                  and c.blocking and c.status = 'open') then
      v_hold_reason := 'customer_conflict_open';
    else
      v_hold_reason := 'customer_not_imported';
    end if;
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason, fields, attempt)
    values (p_tenant, p_import, p_row_number, 'held', v_hold_reason,
            array['customer_external_id'], v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          fields = excluded.fields, attempt = excluded.attempt;
    return jsonb_build_object('action', 'held', 'reason', v_hold_reason);
  end if;

  -- deterministic site resolution (never a guess). 11P: an EXACT
  -- site_external_id is tried FIRST and, if present, is the ONLY path — a
  -- contradictory exact reference never silently degrades to address matching.
  v_site := import_resolve_job_site_v2(p_tenant, v_source,
    v_link.entity_table, v_link.entity_id,
    p_record ->> 'site_external_id',
    p_record ->> 'site_postcode', p_record ->> 'site_address_text');
  if v_site ->> 'outcome' = 'error' then
    -- FAIL CLOSED: a BLOCKING durable conflict and NO canonical Job. The package
    -- contract refuses such a package outright, so reaching here means the
    -- package was not contract-verified — that is a person's decision, never a
    -- guess, and certainly never an address fallback.
    insert into import_conflicts
      (tenant_id, import_id, source_system, entity_kind, external_id,
       conflict_type, blocking, identifiers, candidates, truncated, detail)
    values (p_tenant, p_import, v_source, 'job', v_ext,
            'site_exact_unresolvable', true,
            jsonb_build_array(jsonb_build_object(
              'channel', 'external_id', 'label', 'site_external_id')),
            '[]'::jsonb, false,
            jsonb_build_object('row_number', p_row_number,
                               'reason', v_site ->> 'reason'))
    on conflict (tenant_id, source_system, entity_kind, external_id, conflict_type)
      where status = 'open'
    do update set import_id = excluded.import_id, detail = excluded.detail
    returning id into v_conflict_id;
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason, fields, conflict_id, attempt)
    values (p_tenant, p_import, p_row_number, 'conflict', v_site ->> 'reason',
            array['site_external_id'], v_conflict_id, v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          fields = excluded.fields, conflict_id = excluded.conflict_id,
          attempt = excluded.attempt;
    return jsonb_build_object('action', 'conflict', 'conflict_id', v_conflict_id,
      'reason', v_site ->> 'reason');
  end if;
  if v_site ->> 'outcome' = 'resolved' then
    v_site_id := (v_site ->> 'site_id')::uuid;
  elsif v_site ->> 'outcome' = 'ambiguous' then
    insert into import_conflicts
      (tenant_id, import_id, source_system, entity_kind, external_id,
       conflict_type, blocking, identifiers, candidates, truncated, detail)
    values (p_tenant, p_import, v_source, 'job', v_ext,
            'site_ambiguous', false,
            jsonb_build_array(jsonb_build_object(
              'channel', 'address',
              'label', 'site_address',
              'value', import_normalize_address(p_record ->> 'site_address_text'),
              'postcode', import_normalize_postcode(p_record ->> 'site_postcode'))),
            coalesce((select jsonb_agg(jsonb_build_object(
                        'entity_table', 'sites', 'entity_id', c))
                      from jsonb_array_elements_text(v_site -> 'candidate_site_ids') c),
                     '[]'::jsonb),
            coalesce((v_site ->> 'truncated')::boolean, false),
            jsonb_build_object('row_number', p_row_number,
                               'reason', v_site ->> 'reason'))
    on conflict (tenant_id, source_system, entity_kind, external_id, conflict_type)
      where status = 'open'
    do update set identifiers = excluded.identifiers,
                  candidates = excluded.candidates,
                  truncated = excluded.truncated,
                  import_id = excluded.import_id,
                  detail = excluded.detail
    returning id into v_conflict_id;
  end if;

  v_meta := jsonb_build_object('import', jsonb_strip_nulls(jsonb_build_object(
    'source', v_source, 'external_id', v_ext,
    'customer_external_id', v_cust_ext, 'active', v_active,
    'engineer_name', nullif(trim(coalesce(p_record ->> 'engineer', '')), ''),
    'quoted_value_pennies', (p_record -> 'quoted_value_pennies'),
    'site_resolution', jsonb_build_object(
      'outcome', v_site ->> 'outcome',
      'strategy', v_site ->> 'strategy',
      'reason', v_site ->> 'reason'),
    'site_address_text', nullif(trim(coalesce(p_record ->> 'site_address_text', '')), ''),
    'site_postcode', p_record ->> 'site_postcode')));
  if p_record ->> 'metadata_json' is not null then
    v_meta := v_meta || jsonb_build_object('source_payload',
      (p_record ->> 'metadata_json')::jsonb);
  end if;

  select * into v_job from jobs j
   where j.tenant_id = p_tenant and j.source_system = v_source
     and j.external_id = v_ext;
  if found then
    update jobs set
      site_id = coalesce(jobs.site_id, v_site_id),
      metadata = coalesce(jobs.metadata, '{}'::jsonb) || v_meta
    where id = v_job.id;
    v_job_id := v_job.id;
    v_outcome := 'linked';
  else
    insert into jobs (tenant_id, source_system, external_id, job_number,
                      customer_person_id, customer_company_id, site_id,
                      title, description, status, active,
                      value_pennies, created_date, completed_date,
                      created_source, verified, metadata)
    values (p_tenant, v_source, v_ext,
            nullif(trim(coalesce(p_record ->> 'job_number', '')), ''),
            case when v_link.entity_table = 'people' then v_link.entity_id end,
            case when v_link.entity_table = 'companies' then v_link.entity_id end,
            v_site_id,
            nullif(trim(coalesce(p_record ->> 'title', '')), ''),
            nullif(trim(coalesce(p_record ->> 'description', '')), ''),
            v_status, v_active,
            (p_record ->> 'value_pennies')::bigint,
            (nullif(trim(coalesce(p_record ->> 'created_date', '')), ''))::timestamptz,
            (nullif(trim(coalesce(p_record ->> 'completed_date', '')), ''))::timestamptz,
            'import:' || v_source, false, v_meta)
    returning id into v_job_id;
    v_outcome := 'created';
  end if;

  v_jn := regexp_replace(coalesce(p_record ->> 'job_number', ''), '[^0-9]', '', 'g');
  if v_jn <> '' then
    insert into job_number_aliases (tenant_id, job_id, alias, normalized, source)
    values (p_tenant, v_job_id, p_record ->> 'job_number', v_jn, 'import')
    on conflict (tenant_id, normalized) do nothing;
  end if;

  insert into import_entity_links
    (tenant_id, source_system, entity_kind, external_id, entity_table,
     entity_id, link_strategy, confidence, evidence, import_id)
  values (p_tenant, v_source, 'job', v_ext, 'jobs', v_job_id,
          case when v_outcome = 'created' then 'created' else 'external_id' end,
          1.0, jsonb_build_object('customer_external_id', v_cust_ext), p_import)
  on conflict (tenant_id, source_system, entity_kind, external_id) do nothing;

  insert into import_row_provenance
    (tenant_id, import_id, entity_table, entity_id, source_system,
     source_row_number, external_id, imported_fields, match_strategy,
     confidence, action, conflicts)
  values (p_tenant, p_import, 'jobs', v_job_id, v_source, p_row_number, v_ext,
          array(select jsonb_object_keys(p_record)),
          case when v_outcome = 'created' then 'created' else 'external_id' end,
          1.0,
          case when v_outcome = 'created' then 'created' else 'linked' end,
          jsonb_build_array(jsonb_build_object('site_resolution', v_site))
    );
  insert into import_row_results
    (tenant_id, import_id, row_number, outcome, reason, fields,
     entity_table, entity_id, conflict_id, attempt)
  values (p_tenant, p_import, p_row_number, v_outcome,
          'site: ' || coalesce(v_site ->> 'strategy', v_site ->> 'reason',
                               v_site ->> 'outcome'),
          case when v_site_id is not null then array['site_linked']
               when v_site ->> 'outcome' = 'ambiguous' then array['site_ambiguous']
               else array['site_unlinked'] end,
          'jobs', v_job_id, v_conflict_id, v_attempt)
  on conflict (tenant_id, import_id, row_number) do update
    set outcome = excluded.outcome, reason = excluded.reason,
        fields = excluded.fields, entity_table = excluded.entity_table,
        entity_id = excluded.entity_id, conflict_id = excluded.conflict_id,
        attempt = excluded.attempt;
  return jsonb_build_object('action', v_outcome, 'entity_table', 'jobs',
    'entity_id', v_job_id, 'site_outcome', v_site ->> 'outcome');
end $$;
