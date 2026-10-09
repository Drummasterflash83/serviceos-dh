-- ServiceOS — Phase 11N: corrected person contact-point projection (Defect B).
--
-- Phase 11M's controlled pilot failed 262 of 264 otherwise-valid customer rows
-- with "duplicate key value violates unique constraint contact_points_primary_uk".
--
-- CAUSE. import_customer_row (migration 20260912120000, immutable and NOT edited
-- here) inserted its endpoint candidates in ONE statement whose is_primary was a
-- `not exists` subquery over contact_points. A subquery in a multi-row INSERT ...
-- SELECT sees the PRE-STATEMENT snapshot, so for a person carrying two distinct
-- normalising phone numbers BOTH candidates evaluated is_primary = true, and the
-- partial unique index (tenant_id, person_id, channel) where is_primary — which
-- is CORRECT and is deliberately left in place — rejected the statement. The
-- whole row RPC then errored, so an entirely ordinary customer (two phone
-- numbers) could never be imported.
--
-- FIX. One helper, import_person_contact_points, decides primacy WITHIN the
-- statement over a deterministically ranked candidate set:
--   rank 1  primary_email   (channel email)
--   rank 1  primary_phone   (channel phone)
--   rank 2  secondary_phone (channel phone)
-- Candidates are deduplicated by (channel, normalized_value) keeping the BEST
-- rank, so two source fields normalising to one endpoint converge to one row at
-- the stronger rank. Exactly one candidate per channel — the best-ranked one —
-- may be primary, and only when that channel has NO existing primary for the
-- person. An existing primary is never demoted, and the ON CONFLICT path
-- deliberately touches last_observed_at ONLY, so a rerun can never flip primacy.
--
-- A secondary phone therefore becomes primary only when it is the sole surviving
-- phone endpoint for a person with no existing primary — never alongside one.
--
-- Marketing safety is unchanged: endpoints only, always verification_state
-- 'unverified' and source 'import'. No permission, preference or suppression row
-- is created here or anywhere in the customer import path, so eligibility stays
-- 'unknown'.

-- ───────────────────────────────────────────────────────────────────────────
-- import_person_contact_points — the ONLY writer of import-sourced endpoints.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_person_contact_points(
  p_tenant uuid, p_person uuid, p_record jsonb
) returns void
language sql
as $fn$
  with candidate as (
    -- deterministic rank: the explicitly primary source field always wins
    select * from (values
      ('email'::text, p_record ->> 'primary_email', 1),
      ('phone'::text, p_record ->> 'primary_phone', 1),
      ('phone'::text, p_record ->> 'secondary_phone', 2)
    ) as c (channel, raw, rank)
  ),
  normalised as (
    select c.channel, c.raw, c.rank,
           marketing_normalize_endpoint(c.channel, c.raw) as norm
      from candidate c
     where marketing_normalize_endpoint(c.channel, c.raw) is not null
  ),
  -- two source fields normalising to ONE endpoint converge to a single row,
  -- keeping the stronger rank (and, at equal rank, a stable raw ordering)
  deduped as (
    select distinct on (channel, norm) channel, raw, norm, rank
      from normalised
     order by channel, norm, rank, raw
  ),
  -- an existing primary for this person+channel is authoritative and is NEVER
  -- demoted by an import
  ranked as (
    select d.*,
           row_number() over (partition by d.channel order by d.rank, d.norm) as chan_rank,
           exists (select 1 from contact_points cpp
                    where cpp.tenant_id = p_tenant
                      and cpp.person_id = p_person
                      and cpp.channel = d.channel
                      and cpp.is_primary) as channel_has_primary
      from deduped d
  )
  insert into contact_points
    (tenant_id, person_id, channel, value, normalized_value, is_primary,
     verification_state, source, last_observed_at)
  select p_tenant, p_person, r.channel, r.raw, r.norm,
         (r.chan_rank = 1 and not r.channel_has_primary),
         'unverified', 'import', now()
    from ranked r
  on conflict (tenant_id, person_id, channel, normalized_value) do update
    set last_observed_at = now();
$fn$;

comment on function import_person_contact_points(uuid, uuid, jsonb) is
  'Phase 11N: writes import-sourced contact points for a person. At most one '
  'primary per (person, channel), decided within the statement over a ranked '
  'candidate set; never demotes an existing primary; idempotent on rerun.';

-- ───────────────────────────────────────────────────────────────────────────
-- import_customer_row — byte-identical to 20260912120000 except that the
-- contact-point block now delegates to the helper above. Nothing else changes.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_customer_row(
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
  v_res jsonb;
  v_ext text := nullif(trim(coalesce(p_record ->> 'external_id', '')), '');
  v_kind text := nullif(trim(coalesce(p_record ->> 'record_kind', '')), '');
  v_email text := marketing_normalize_endpoint('email', p_record ->> 'primary_email');
  v_phone text := import_normalize_phone_uk(p_record ->> 'primary_phone');
  v_phone2 text := import_normalize_phone_uk(p_record ->> 'secondary_phone');
  v_lock_keys text[] := array[]::text[];
  v_lk text;
  v_display text;
  v_active boolean := coalesce((p_record ->> 'active')::boolean, true);
  v_meta jsonb;
  v_import_meta jsonb;
  v_conflict_id uuid;
  v_person uuid;
  v_company uuid;
  v_p people%rowtype;
  v_writable jsonb := '{}'::jsonb;
  v_field_conflicts text[] := array[]::text[];
  v_entity_table text;
  v_entity_id uuid;
  v_outcome text;
  v_strategy text;
  v_confidence numeric;
begin
  v_imp := import_row_preamble(p_tenant, p_import, p_actor, p_row_number,
                               p_record, p_options, 'customers');
  v_source := v_imp.preview -> 'sealed' ->> 'provenance_source';
  select o_short, o_attempt into v_short, v_attempt
    from import_row_prior(p_tenant, p_import, p_row_number);
  if v_short is not null then return v_short; end if;

  v_invalid := import_validate_customer_row(p_tenant, v_source, p_record);
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

  -- identity locks: SAME key format as the marketing manual-create/import
  -- paths (customers share the People identity space), deterministic order
  if v_email is not null then v_lock_keys := array_append(v_lock_keys, 'email|' || v_email); end if;
  if v_phone is not null then v_lock_keys := array_append(v_lock_keys, 'phone|' || v_phone); end if;
  if v_phone2 is not null then v_lock_keys := array_append(v_lock_keys, 'phone|' || v_phone2); end if;
  v_lock_keys := array_append(v_lock_keys, 'ext|' || v_source || '|' || v_ext);
  for v_lk in select distinct u from unnest(v_lock_keys) t(u) order by u loop
    perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|' || v_lk, 42));
  end loop;

  v_res := import_resolve_customer(p_tenant, v_source, p_record);

  v_display := nullif(trim(coalesce(p_record ->> 'display_name', '')), '');
  if v_display is null then
    v_display := nullif(trim(concat_ws(' ',
      nullif(trim(coalesce(p_record ->> 'first_name', '')), ''),
      nullif(trim(coalesce(p_record ->> 'last_name', '')), ''))), '');
  end if;
  v_import_meta := jsonb_strip_nulls(jsonb_build_object(
    'source', v_source,
    'external_id', v_ext,
    'record_kind', v_kind,
    'active', v_active,
    'title', nullif(trim(coalesce(p_record ->> 'title', '')), ''),
    'company_name', nullif(trim(coalesce(p_record ->> 'company_name', '')), '')));
  v_meta := jsonb_build_object('import', v_import_meta);
  if p_record ->> 'metadata_json' is not null then
    v_meta := v_meta || jsonb_build_object('source_payload',
      (p_record ->> 'metadata_json')::jsonb);
  end if;

  -- ── ambiguous / conflicting channel evidence: ONE durable blocking
  --    conflict, ZERO canonical mutation ──
  if v_res ->> 'decision' in ('ambiguous', 'conflicting') then
    insert into import_conflicts
      (tenant_id, import_id, source_system, entity_kind, external_id,
       conflict_type, blocking, identifiers, candidates, truncated, detail)
    values (p_tenant, p_import, v_source, 'customer', v_ext,
            case when v_res ->> 'decision' = 'ambiguous'
                 then 'ambiguous_channel' else 'channel_disagreement' end,
            true,
            coalesce(v_res -> 'evidence', '[]'::jsonb),
            coalesce((select jsonb_agg(jsonb_build_object(
                        'entity_table', 'people', 'entity_id', c))
                      from jsonb_array_elements_text(v_res -> 'candidate_union') c),
                     '[]'::jsonb),
            coalesce((v_res ->> 'truncated')::boolean, false),
            jsonb_build_object('row_number', p_row_number))
    on conflict (tenant_id, source_system, entity_kind, external_id, conflict_type)
      where status = 'open'
    do update set identifiers = excluded.identifiers,
                  candidates = excluded.candidates,
                  truncated = excluded.truncated,
                  import_id = excluded.import_id
    returning id into v_conflict_id;
    insert into import_row_provenance
      (tenant_id, import_id, entity_table, entity_id, source_system,
       source_row_number, external_id, imported_fields, match_strategy,
       confidence, action, conflicts)
    values (p_tenant, p_import, 'import_conflicts', v_conflict_id, v_source,
            p_row_number, v_ext,
            array(select jsonb_object_keys(p_record)),
            v_res ->> 'decision', 0.5, 'conflict',
            coalesce(v_res -> 'evidence', '[]'::jsonb));
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason, conflict_id, attempt)
    values (p_tenant, p_import, p_row_number, 'conflict',
            case when v_res ->> 'decision' = 'ambiguous'
              then 'a contact channel matches several existing people'
              else 'email and phone point to different existing people' end,
            v_conflict_id, v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          conflict_id = excluded.conflict_id, attempt = excluded.attempt;
    return jsonb_build_object('action', 'conflict', 'conflict_id', v_conflict_id);
  end if;

  -- ── already linked (idempotent rerun of the same source row) ──
  if v_res ->> 'decision' = 'linked' then
    v_entity_table := v_res ->> 'entity_table';
    v_entity_id := (v_res ->> 'entity_id')::uuid;
    v_outcome := 'linked';
    v_strategy := 'external_id';
    v_confidence := 1.0;

  -- ── exactly ONE existing person on strong channel evidence: link, fill
  --    blanks only, never overwrite, never touch verified/created_source ──
  elsif v_res ->> 'decision' = 'matched' then
    v_person := (v_res ->> 'entity_id')::uuid;
    select * into v_p from people where id = v_person and tenant_id = p_tenant
      for update;
    if not found then
      raise exception 'matched person vanished — retry' using errcode = '40001';
    end if;
    v_writable := '{}'::jsonb;
    if v_p.display_name is null and v_display is not null then
      v_writable := v_writable || jsonb_build_object('display_name', v_display); end if;
    if v_p.first_name is null and nullif(trim(coalesce(p_record ->> 'first_name', '')), '') is not null then
      v_writable := v_writable || jsonb_build_object('first_name', trim(p_record ->> 'first_name')); end if;
    if v_p.last_name is null and nullif(trim(coalesce(p_record ->> 'last_name', '')), '') is not null then
      v_writable := v_writable || jsonb_build_object('last_name', trim(p_record ->> 'last_name')); end if;
    if v_p.primary_email is null and p_record ->> 'primary_email' is not null then
      v_writable := v_writable || jsonb_build_object('primary_email', p_record ->> 'primary_email'); end if;
    if v_p.primary_phone is null and p_record ->> 'primary_phone' is not null then
      v_writable := v_writable || jsonb_build_object('primary_phone', p_record ->> 'primary_phone'); end if;
    if v_p.address_text is null and nullif(trim(coalesce(p_record ->> 'address_text', '')), '') is not null then
      v_writable := v_writable || jsonb_build_object('address_text', trim(p_record ->> 'address_text')); end if;
    if v_p.postcode is null and p_record ->> 'postcode' is not null then
      v_writable := v_writable || jsonb_build_object('postcode', p_record ->> 'postcode'); end if;
    -- differing non-blank values are recorded, never overwritten
    if v_p.display_name is not null and v_display is not null
       and v_p.display_name <> v_display then
      v_field_conflicts := array_append(v_field_conflicts, 'display_name'); end if;
    if v_p.primary_email is not null and p_record ->> 'primary_email' is not null
       and marketing_normalize_endpoint('email', v_p.primary_email) is distinct from v_email then
      v_field_conflicts := array_append(v_field_conflicts, 'primary_email'); end if;
    if v_p.primary_phone is not null and p_record ->> 'primary_phone' is not null
       and import_normalize_phone_uk(v_p.primary_phone) is distinct from v_phone then
      v_field_conflicts := array_append(v_field_conflicts, 'primary_phone'); end if;
    if v_p.postcode is not null and p_record ->> 'postcode' is not null
       and import_normalize_postcode(v_p.postcode) is distinct from import_normalize_postcode(p_record ->> 'postcode') then
      v_field_conflicts := array_append(v_field_conflicts, 'postcode'); end if;
    update people set
      display_name = coalesce(v_writable ->> 'display_name', display_name),
      first_name = coalesce(v_writable ->> 'first_name', first_name),
      last_name = coalesce(v_writable ->> 'last_name', last_name),
      primary_email = coalesce(v_writable ->> 'primary_email', primary_email),
      primary_phone = coalesce(v_writable ->> 'primary_phone', primary_phone),
      address_text = coalesce(v_writable ->> 'address_text', address_text),
      postcode = coalesce(v_writable ->> 'postcode', postcode),
      metadata = coalesce(metadata, '{}'::jsonb) || v_meta
    where id = v_person;
    v_entity_table := 'people';
    v_entity_id := v_person;
    v_outcome := 'linked';
    v_strategy := v_res ->> 'strategy';
    v_confidence := (v_res ->> 'confidence')::numeric;

  -- ── new company customer: canonical company, NEVER a named individual ──
  elsif v_res ->> 'decision' = 'new_company' then
    insert into companies (tenant_id, name, phone, address_text, postcode,
                           verified, created_source, metadata)
    values (p_tenant, trim(p_record ->> 'company_name'),
            p_record ->> 'primary_phone',
            nullif(trim(coalesce(p_record ->> 'address_text', '')), ''),
            p_record ->> 'postcode',
            false, 'import:' || v_source,
            v_meta || jsonb_build_object('import',
              v_import_meta || jsonb_strip_nulls(jsonb_build_object(
                'primary_email', p_record ->> 'primary_email'))))
    returning id into v_company;
    -- channels matching existing interaction-created PEOPLE are review
    -- evidence beside the applied row — never an automatic association
    if jsonb_array_length(coalesce(v_res -> 'person_overlap', '[]'::jsonb)) > 0 then
      insert into import_conflicts
        (tenant_id, import_id, source_system, entity_kind, external_id,
         conflict_type, blocking, identifiers, candidates, truncated, detail)
      values (p_tenant, p_import, v_source, 'customer', v_ext,
              'company_person_overlap', false,
              coalesce(v_res -> 'evidence', '[]'::jsonb),
              coalesce((select jsonb_agg(jsonb_build_object(
                          'entity_table', 'people', 'entity_id', c))
                        from jsonb_array_elements_text(v_res -> 'person_overlap') c),
                       '[]'::jsonb),
              coalesce((v_res ->> 'truncated')::boolean, false),
              jsonb_build_object('row_number', p_row_number,
                                 'company_id', v_company))
      on conflict (tenant_id, source_system, entity_kind, external_id, conflict_type)
        where status = 'open'
      do update set identifiers = excluded.identifiers,
                    candidates = excluded.candidates,
                    truncated = excluded.truncated,
                    import_id = excluded.import_id,
                    detail = excluded.detail
      returning id into v_conflict_id;
    end if;
    v_entity_table := 'companies';
    v_entity_id := v_company;
    v_outcome := 'created';
    v_strategy := 'created';
    v_confidence := 1.0;

  -- ── new person customer ──
  else
    insert into people (tenant_id, display_name, first_name, last_name,
                        primary_email, primary_phone, address_text, postcode,
                        verified, created_source, metadata)
    values (p_tenant, v_display,
            nullif(trim(coalesce(p_record ->> 'first_name', '')), ''),
            nullif(trim(coalesce(p_record ->> 'last_name', '')), ''),
            p_record ->> 'primary_email',
            p_record ->> 'primary_phone',
            nullif(trim(coalesce(p_record ->> 'address_text', '')), ''),
            p_record ->> 'postcode',
            false, 'import:customers:' || v_source, v_meta)
    returning id into v_person;
    v_entity_table := 'people';
    v_entity_id := v_person;
    v_outcome := 'created';
    v_strategy := 'created';
    v_confidence := 1.0;
  end if;

  -- contact points for PERSON customers: unverified import endpoints, written
  -- through the corrected helper (11N Defect B). This remains the ONLY
  -- marketing-adjacent write — no preference, no suppression, no permission
  -- record: eligibility stays 'unknown'.
  if v_entity_table = 'people' then
    perform import_person_contact_points(p_tenant, v_entity_id, p_record);
  end if;

  -- authoritative external-identity link (idempotent for ever after)
  if v_res ->> 'decision' <> 'linked' then
    insert into import_entity_links
      (tenant_id, source_system, entity_kind, external_id, entity_table,
       entity_id, link_strategy, confidence, evidence, import_id)
    values (p_tenant, v_source, 'customer', v_ext, v_entity_table, v_entity_id,
            case when v_outcome = 'created' then 'created' else v_strategy end,
            v_confidence,
            jsonb_build_object('matched_on', coalesce(v_res -> 'matched_on', '[]'::jsonb)),
            p_import)
    on conflict (tenant_id, source_system, entity_kind, external_id) do nothing;
  end if;

  insert into import_row_provenance
    (tenant_id, import_id, entity_table, entity_id, source_system,
     source_row_number, external_id, imported_fields, match_strategy,
     confidence, action, conflicts)
  values (p_tenant, p_import, v_entity_table, v_entity_id, v_source,
          p_row_number, v_ext,
          array(select jsonb_object_keys(p_record)),
          v_strategy, v_confidence,
          case when v_outcome = 'created' then 'created' else 'linked' end,
          coalesce((select jsonb_agg(jsonb_build_object('field', f))
                    from unnest(v_field_conflicts) f), '[]'::jsonb));
  insert into import_row_results
    (tenant_id, import_id, row_number, outcome, reason, fields,
     entity_table, entity_id, conflict_id, attempt)
  values (p_tenant, p_import, p_row_number, v_outcome,
          case when array_length(v_field_conflicts, 1) > 0
            then 'linked with differing fields recorded (never overwritten)'
            else null end,
          coalesce(v_field_conflicts, '{}'::text[]),
          v_entity_table, v_entity_id, v_conflict_id, v_attempt)
  on conflict (tenant_id, import_id, row_number) do update
    set outcome = excluded.outcome, reason = excluded.reason,
        fields = excluded.fields, entity_table = excluded.entity_table,
        entity_id = excluded.entity_id, conflict_id = excluded.conflict_id,
        attempt = excluded.attempt;
  return jsonb_build_object('action', v_outcome,
    'entity_table', v_entity_table, 'entity_id', v_entity_id,
    'strategy', v_strategy, 'field_conflicts', to_jsonb(v_field_conflicts));
end $$;
