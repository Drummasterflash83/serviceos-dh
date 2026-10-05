-- ServiceOS — Marketing Phase 2: the Contacts projection (server-side, canonical, corrected).
--
-- The Contact list/detail is a SERVER-SIDE PROJECTION over canonical `people` +
-- `contact_relationships` + `contact_points` + `communication_preferences` +
-- `contact_suppressions` + canonical `interactions` — never a table of its own
-- and never a browser-side join. All logic lives in service-role-only SQL
-- functions so the REAL production code is testable at the database boundary;
-- the `marketing-contacts` Edge Function is a thin authz shell.
--
-- Contracts honoured (docs/product/marketing-crm/IMPLEMENTATION_LEDGER.md §11):
--  - NORMALISATION: `marketing_normalize_endpoint(channel, value)` is the ONE
--    channel-aware normaliser (emails lower/format-validated; phone/sms/whatsapp
--    reduced to +digits with a minimum length) used by create-matching,
--    contact-point writes, eligibility, and suppression visibility alike.
--    Malformed values normalise to NULL and read as 'invalid'.
--  - IDENTITY: create NEVER silently merges and NEVER picks an arbitrary match.
--    0 matches → create; exactly 1 Person → 'existing'; >1 People → 'ambiguous'
--    with bounded candidates AND a durable `marketing_identity_conflicts` record
--    whose `identifiers` field records, PER supplied identifier, exactly which
--    People matched it (a phone match is never mislabelled as an email match),
--    plus truncation, actor and idempotency correlation. (A manual create has no
--    interaction, so interaction_match_suggestions would be a misuse — this is
--    the smallest governed record; ledger decision.)
--  - CONCURRENCY: create serialises on the tenant+idempotency-key advisory
--    lock FIRST (taken before the ledger read, so two same-key requests can
--    never both see an empty ledger and each commit a Person — including
--    name-only creates), then takes ONE advisory lock PER supplied normalised
--    identifier (deterministic order: email then phone) so any overlap of
--    strong identifiers serialises. Name-only creates take no identity lock.
--  - IDEMPOTENCY: the key and a real same-tenant actor are REQUIRED (null key
--    → 22023 before any write). `marketing_request_keys` binds tenant + actor
--    + action + a canonical stored-JSON FINGERPRINT over EVERY material field
--    (display/first/last name, normalised email/phone, company, owner, type,
--    stage) to the stored result. The same actor/key/fingerprint returns the
--    stored result; the same key with different material input (or another
--    actor/action) raises IDEMPOTENCY_CONFLICT (55000).
--  - ELIGIBILITY (fail-closed): `marketing_endpoint_eligibility` is the ONE
--    pre-send decision. Suppression (person/contact-point/destination scope,
--    normalised) always wins. Preference precedence is SCOPE-RANKED:
--    (endpoint+topic) > endpoint > topic > person/channel — the most specific
--    applicable scope is resolved first and the LATEST record within that scope
--    decides (so a later same-scope resubscribe works, but a newer generic
--    subscribe can never override an endpoint- or topic-specific unsubscribe).
--    A destination that is not a usable endpoint of the Person is 'invalid'
--    (never inherits a generic subscription); invalid contact points are never
--    selected as usable defaults; contact-point + destination inputs must agree.
--    `marketing_contact_eligibility` is only the Person-level LIST SUMMARY
--    (default-endpoint verdict) delegating to the endpoint function; audiences
--    and sends MUST call the endpoint function with the real destination.
--  - RELATIONSHIPS: mutations of an EXISTING relationship target an explicit
--    relationship_id, REQUIRE expected_version (stale → MK409 VERSION_CONFLICT;
--    40001 is unusable — PostgREST auto-retries it), reject no-op changes (no
--    false version bumps or phantom transitions), and emit PER-FIELD events.
--    "CLASSIFIED" MEANS: has an ACTIVE relationship. Creating a classification
--    (no relationship_id) requires no active relationship; when only historical
--    (inactive/archived) rows exist it additionally requires allow_new=true so
--    history is never silently shadowed — reactivation is an explicit status
--    update by id. The list shows ONE deterministic display relationship
--    (active > inactive > archived, then oldest) while type/status FILTERS
--    consider all of a Person's relationships.
--  - CUSTOMER CARD: classify merges INTO context->'marketing' (nested merge) —
--    existing marketing subkeys and all non-marketing context survive;
--    human-locked context is never touched.
--  - EVENTS: `marketing_event_append` preserves every real transition on the
--    pending bus row (dedup by entry key; retries no-op). Emitted facts are
--    precise: marketing.contact.created / classified (creation) /
--    lifecycle_changed / owner_changed / relationship_type_changed /
--    relationship_status_changed / updated · marketing.contact_point.created /
--    updated · marketing.tag.created · marketing.contact.tag_changed ·
--    marketing.identity_conflict.created — audited in the same transaction.
--  - TENANT DEFENCE IN DEPTH: every join carries an explicit tenant predicate
--    (companies, profiles, tags, cards, interactions, points, preferences,
--    suppressions) — corrupt legacy cross-tenant references can never leak.
--  - ERROR CONTRACT: controlled SQLSTATEs only — MK409 VERSION_CONFLICT,
--    MK403 PROTECTED_FIELD, 22023 INVALID_REQUEST, P0002 NOT_FOUND,
--    55000 IDEMPOTENCY_CONFLICT, 23505 DUPLICATE. No raw schema details reach
--    the browser.
--
-- Rollback:
--   drop function if exists marketing_owners_list(uuid);
--   drop function if exists marketing_tag_mutate(uuid, uuid, text, jsonb);
--   drop function if exists marketing_update_contact(uuid, uuid, uuid, jsonb);
--   drop function if exists marketing_create_contact(uuid, uuid, jsonb, uuid);
--   drop function if exists marketing_classify_contact(uuid, uuid, uuid, jsonb);
--   drop function if exists marketing_contact_detail(uuid, uuid);
--   drop function if exists marketing_contacts_counts(uuid);
--   drop function if exists marketing_contacts_list(uuid, jsonb);
--   drop function if exists marketing_contact_eligibility(uuid, uuid, text);
--   drop function if exists marketing_endpoint_eligibility(uuid, uuid, text, uuid, text, text);
--   drop function if exists marketing_event_append(uuid, text, text, uuid, text, jsonb);
--   drop function if exists marketing_validate_owner(uuid, uuid);
--   drop function if exists marketing_normalize_endpoint(text, text);
--   drop table if exists marketing_request_keys;
--   drop table if exists marketing_identity_conflicts;
--   drop index if exists people_tenant_name_idx;

-- Name-sorted list pages need a tenant+name path (email/phone/person indexes exist).
create index if not exists people_tenant_name_idx on people (tenant_id, display_name);

-- ===========================================================================
-- Canonical channel-aware endpoint normalisation. NULL = unusable/malformed.
-- ===========================================================================
create or replace function marketing_normalize_endpoint(p_channel text, p_value text)
returns text
language plpgsql
immutable
as $$
declare
  v text := trim(coalesce(p_value, ''));
begin
  if v = '' then return null; end if;
  if p_channel = 'email' then
    v := lower(v);
    if v !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return null; end if;
    return v;
  elsif p_channel in ('phone', 'sms', 'whatsapp') then
    v := regexp_replace(v, '[^0-9+]', '', 'g');
    -- keep only a single LEADING plus
    v := left(v, 1) || regexp_replace(substr(v, 2), '\+', '', 'g');
    if v !~ '^\+?[0-9]{7,15}$' then return null; end if;
    return v;
  else
    return lower(v);
  end if;
end $$;

-- ===========================================================================
-- marketing_identity_conflicts — durable evidence when a create (or an endpoint
-- edit) matches other People. `identifiers` records, PER supplied identifier,
-- exactly which People matched: [{channel, value, candidate_person_ids[]}]
-- (stored arrays bounded at 25 ids with a per-identifier truncated flag).
-- Status-governed, never hard-deleted. This migration runs ONCE via the
-- migration runner (the committed head has neither table) — no destructive
-- drops; drifted local draft databases are reset, never patched from here.
-- ===========================================================================
create table marketing_identity_conflicts (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id) on delete cascade,
  identifiers          jsonb not null,          -- [{channel, value, candidate_person_ids[]}]
  candidate_person_ids uuid[] not null,         -- union, for review/indexing
  truncated            boolean not null default false,
  requested            jsonb not null default '{}'::jsonb,   -- safe subset only
  idempotency_key      uuid,
  status               text not null default 'open'
                         check (status in ('open', 'resolved', 'dismissed')),
  resolution           text,
  created_by           uuid,
  resolved_by          uuid,
  resolved_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index mic_tenant_status_idx on marketing_identity_conflicts (tenant_id, status);
create trigger mic_set_updated_at
  before update on marketing_identity_conflicts for each row execute function set_updated_at();
create trigger marketing_identity_conflicts_tenant_guard
  before insert or update on marketing_identity_conflicts
  for each row execute function marketing_tenant_guard();
alter table marketing_identity_conflicts enable row level security;
create policy marketing_identity_conflicts_select on marketing_identity_conflicts
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_identity_conflicts to authenticated;
grant select, insert, update on marketing_identity_conflicts to service_role;  -- no delete

-- ===========================================================================
-- marketing_request_keys — the idempotency ledger (tenant + actor + action +
-- request fingerprint → stored result). Service-role only.
-- ===========================================================================
create table marketing_request_keys (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants (id) on delete cascade,
  idempotency_key uuid not null,
  actor           uuid,
  action          text not null,
  fingerprint     text not null,
  result          jsonb not null,
  created_at      timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);
alter table marketing_request_keys enable row level security;  -- deny-all for clients
grant select, insert on marketing_request_keys to service_role;

-- ===========================================================================
-- AUTHORITATIVE endpoint eligibility — the ONE pre-send consent decision.
-- ===========================================================================
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
  --    first ((endpoint+topic) > endpoint > topic > generic), LATEST within it. ──
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
     pref.created_at desc
   limit 1;

  return case v_state
    when 'unsubscribed' then 'unsubscribed'
    when 'subscribed' then 'subscribed'
    else 'unknown'
  end;
end $$;

-- Person-level LIST SUMMARY only — the default-endpoint verdict.
create or replace function marketing_contact_eligibility(
  p_tenant uuid, p_person uuid, p_channel text default 'email'
) returns text
language sql
stable
as $$
  select marketing_endpoint_eligibility(p_tenant, p_person, p_channel, null, null, null);
$$;

-- ===========================================================================
-- Transition-preserving event publisher. Dedup is KEY-BASED: every entry must
-- carry a non-empty stable `k`; a pending transition with the same `k` blocks
-- the append entirely (`current` only changes when a genuinely NEW key is
-- accepted — identical k with a different timestamp adds nothing); different
-- keys append independently. jsonb_path_exists is used because ON CONFLICT
-- SET/WHERE cannot contain sub-selects.
-- ===========================================================================
create or replace function marketing_event_append(
  p_tenant uuid, p_type text, p_subject_type text, p_subject uuid,
  p_source text, p_entry jsonb
) returns void
language plpgsql
as $$
begin
  if coalesce(p_entry ->> 'k', '') = '' then
    raise exception 'event entry requires a non-empty stable k' using errcode = '22023';
  end if;
  insert into platform_events (tenant_id, event_type, subject_type, subject_id, source, status, payload)
  values (p_tenant, p_type, p_subject_type, p_subject, p_source, 'pending',
          jsonb_build_object('current', p_entry, 'transitions', jsonb_build_array(p_entry)))
  on conflict (tenant_id, event_type, subject_id) where status = 'pending'
  do update set
    payload = jsonb_set(
      jsonb_set(platform_events.payload, '{current}', excluded.payload -> 'current'),
      '{transitions}',
      (platform_events.payload -> 'transitions') || (excluded.payload -> 'transitions'))
  where not jsonb_path_exists(platform_events.payload,
          '$.transitions[*] ? (@.k == $k)', jsonb_build_object('k', p_entry ->> 'k'));
end $$;

-- Owner assignees must be real same-tenant users with an operational role.
create or replace function marketing_validate_owner(p_tenant uuid, p_owner uuid)
returns void
language plpgsql
stable
as $$
begin
  if not exists (
    select 1 from profiles pr
     where pr.id = p_owner and pr.tenant_id = p_tenant
       and pr.role in ('owner', 'admin', 'ops')
  ) then
    raise exception 'owner must be an operational user of this tenant'
      using errcode = '22023';
  end if;
end $$;

-- ===========================================================================
-- List — Person-based projection with bounded keyset pagination.
-- DISPLAY relationship: active > inactive > archived, oldest first (one,
-- deterministic). FILTERS for relationship type/status consider ALL of a
-- Person's relationships via EXISTS (both must match the SAME row when both are
-- supplied; rows are never duplicated). classified = has an ACTIVE relationship.
-- Cursor contract: {v: string|null, id: uuid} — v is null for null sort values.
-- ===========================================================================
create or replace function marketing_contacts_list(p_tenant uuid, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_include_all boolean;
  v_limit int;
  v_sort text := coalesce(p_args ->> 'sort', 'name');
  v_dir text;
  v_search text := nullif(trim(coalesce(p_args ->> 'search', '')), '');
  v_lifecycle text := nullif(p_args ->> 'lifecycle', '');
  v_rel_type text := nullif(p_args ->> 'relationship_type', '');
  v_rel_status text := nullif(p_args ->> 'relationship_status', '');
  v_owner uuid;
  v_company uuid;
  v_source text := nullif(p_args ->> 'source', '');
  v_has_rel_filters boolean;
  v_eligibility text := nullif(p_args ->> 'eligibility', '');
  v_classified boolean;
  v_tags_inc uuid[];
  v_tags_exc uuid[];
  v_created_from timestamptz;
  v_created_to timestamptz;
  v_contact_from timestamptz;
  v_contact_to timestamptz;
  v_has_cursor boolean := false;
  v_cur_txt text;
  v_cur_ts timestamptz;
  v_cur_id uuid;
  v_rows jsonb;
  v_count int;
  v_last jsonb;
  v_next jsonb := null;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;

  begin
    v_limit := least(greatest(coalesce((p_args ->> 'limit')::int, 25), 1), 100);
    v_owner := (p_args ->> 'owner_id')::uuid;
    v_company := (p_args ->> 'company_id')::uuid;
    v_classified := (p_args ->> 'classified')::boolean;
    v_created_from := (p_args ->> 'created_from')::timestamptz;
    v_created_to := (p_args ->> 'created_to')::timestamptz;
    v_contact_from := (p_args ->> 'last_contact_from')::timestamptz;
    v_contact_to := (p_args ->> 'last_contact_to')::timestamptz;
    if p_args ? 'tags_include' and jsonb_typeof(p_args -> 'tags_include') = 'array' then
      select array_agg(x::uuid) into v_tags_inc from jsonb_array_elements_text(p_args -> 'tags_include') x;
    end if;
    if p_args ? 'tags_exclude' and jsonb_typeof(p_args -> 'tags_exclude') = 'array' then
      select array_agg(x::uuid) into v_tags_exc from jsonb_array_elements_text(p_args -> 'tags_exclude') x;
    end if;
  exception when others then
    raise exception 'invalid filter value' using errcode = '22023';
  end;
  if v_sort not in ('name', 'created', 'last_contact') then
    raise exception 'invalid sort' using errcode = '22023';
  end if;
  v_dir := coalesce(nullif(p_args ->> 'dir', ''), case when v_sort = 'name' then 'asc' else 'desc' end);
  if v_dir not in ('asc', 'desc') then
    raise exception 'invalid sort direction' using errcode = '22023';
  end if;
  if v_eligibility is not null
     and v_eligibility not in ('subscribed', 'unsubscribed', 'suppressed', 'unknown', 'invalid', 'no_contact_point') then
    raise exception 'invalid eligibility filter' using errcode = '22023';
  end if;
  if v_rel_status is not null and v_rel_status not in ('active', 'inactive', 'archived') then
    raise exception 'invalid relationship status' using errcode = '22023';
  end if;
  -- Relationship predicates form ONE contract: when any is supplied, a single
  -- relationship row must satisfy all of them together.
  v_has_rel_filters := v_lifecycle is not null or v_rel_type is not null
                    or v_rel_status is not null or v_owner is not null
                    or v_source is not null;
  if p_args ? 'cursor' and jsonb_typeof(p_args -> 'cursor') <> 'null' then
    -- Strict typed cursor contract: {v, id} object; v is a string for
    -- name/created, and string OR NULL for last_contact (the explicit
    -- null-last-contact sentinel). Anything else is 22023, never ignored.
    if jsonb_typeof(p_args -> 'cursor') <> 'object'
       or not (p_args -> 'cursor') ? 'id' or not (p_args -> 'cursor') ? 'v' then
      raise exception 'invalid cursor' using errcode = '22023';
    end if;
    begin
      v_cur_id := ((p_args -> 'cursor') ->> 'id')::uuid;
      if v_cur_id is null then raise exception 'cursor missing id'; end if;
      if v_sort = 'last_contact' then
        if jsonb_typeof((p_args -> 'cursor') -> 'v') not in ('string', 'null') then
          raise exception 'cursor v must be a string or null';
        end if;
        v_cur_ts := ((p_args -> 'cursor') ->> 'v')::timestamptz;
      elsif jsonb_typeof((p_args -> 'cursor') -> 'v') <> 'string' then
        raise exception 'cursor v must be a string';
      elsif v_sort = 'name' then
        v_cur_txt := (p_args -> 'cursor') ->> 'v';
      else
        v_cur_ts := ((p_args -> 'cursor') ->> 'v')::timestamptz;
      end if;
      v_has_cursor := true;
    exception when others then
      raise exception 'invalid cursor' using errcode = '22023';
    end;
  end if;

  select coalesce(ms.include_all_discovered, true) into v_include_all
    from marketing_settings ms where ms.tenant_id = p_tenant;
  if not found then v_include_all := true; end if;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb), count(*)
    into v_rows, v_count
  from (
    select b.* from (
      select p.id as person_id,
             p.display_name,
             p.primary_email,
             p.primary_phone,
             p.created_at,
             p.created_source,
             p.verified,
             c.id as company_id,
             c.name as company_name,
             r.id as relationship_id,
             r.relationship_type,
             r.status as relationship_status,
             r.lifecycle_stage_key,
             r.owner_id,
             pr.full_name as owner_name,
             coalesce(r.source, p.created_source) as source,
             r.version as relationship_version,
             exists (select 1 from contact_relationships ca
                      where ca.tenant_id = p_tenant and ca.person_id = p.id
                        and ca.status = 'active') as is_classified,
             marketing_contact_eligibility(p_tenant, p.id, 'email') as eligibility,
             li.occurred_at as last_interaction_at,
             li.interaction_type as last_interaction_type,
             li.direction as last_interaction_direction,
             card.status as card_status,
             card.recommended_action as next_action,
             (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', mt.id, 'key', mt.key, 'label', mt.label, 'tone', mt.tone)), '[]'::jsonb)
                from contact_tag_assignments ta
                join marketing_tags mt on mt.id = ta.tag_id
                 and mt.tenant_id = p_tenant and mt.active
               where ta.tenant_id = p_tenant and ta.person_id = p.id) as tags
      from people p
      left join companies c on c.id = p.company_id and c.tenant_id = p_tenant
      left join lateral (
        -- ONE relationship row per Person, deterministic (active > inactive >
        -- archived, then oldest). With relationship filters supplied, this row
        -- must satisfy ALL supplied relationship predicates (lifecycle, type,
        -- status, owner, relationship source) TOGETHER — the filters can never
        -- be satisfied by different rows — and it IS the projected relationship.
        -- Without relationship filters it is the documented display relationship.
        select cr.* from contact_relationships cr
         where cr.tenant_id = p_tenant and cr.person_id = p.id
           and (not v_has_rel_filters or (
                    (v_lifecycle is null or cr.lifecycle_stage_key = v_lifecycle)
                and (v_rel_type is null or cr.relationship_type = v_rel_type)
                and (v_rel_status is null or cr.status = v_rel_status)
                and (v_owner is null or cr.owner_id = v_owner)
                and (v_source is null or cr.source = v_source)))
         order by case cr.status when 'active' then 0 when 'inactive' then 1 else 2 end,
                  cr.created_at asc
         limit 1
      ) r on true
      left join profiles pr on pr.id = r.owner_id and pr.tenant_id = p_tenant
      left join lateral (
        select i.occurred_at, i.interaction_type, i.direction
          from interactions i
         where i.tenant_id = p_tenant and i.related_person_id = p.id
         order by i.occurred_at desc limit 1
      ) li on true
      left join lateral (
        select c2.status, c2.recommended_action
          from customer_cards c2
         where c2.tenant_id = p_tenant and c2.person_id = p.id
         order by c2.updated_at desc limit 1
      ) card on true
      where p.tenant_id = p_tenant
        and (v_include_all or exists (select 1 from contact_relationships ce
                                       where ce.tenant_id = p_tenant and ce.person_id = p.id
                                         and ce.status = 'active'))
        and (v_search is null
             or p.display_name ilike '%' || v_search || '%'
             or p.primary_email ilike v_search || '%'
             or p.primary_phone like v_search || '%')
        -- With relationship filters, the single lateral row above already
        -- carries every supplied relationship predicate — require it to exist.
        and (not v_has_rel_filters or r.id is not null)
        and (v_company is null or (p.company_id = v_company and c.id is not null))
        and (v_created_from is null or p.created_at >= v_created_from)
        and (v_created_to is null or p.created_at <= v_created_to)
        and (v_tags_inc is null or exists (
              select 1 from contact_tag_assignments ti
               where ti.tenant_id = p_tenant and ti.person_id = p.id
                 and ti.tag_id = any (v_tags_inc)))
        and (v_tags_exc is null or not exists (
              select 1 from contact_tag_assignments te
               where te.tenant_id = p_tenant and te.person_id = p.id
                 and te.tag_id = any (v_tags_exc)))
    ) b
    where (v_classified is null or v_classified = b.is_classified)
      and (v_eligibility is null or b.eligibility = v_eligibility)
      and (v_contact_from is null or b.last_interaction_at >= v_contact_from)
      and (v_contact_to is null or b.last_interaction_at <= v_contact_to)
      and case
            when not v_has_cursor then true
            when v_sort = 'name' and v_dir = 'asc' then
              (coalesce(b.display_name, ''), b.person_id) > (v_cur_txt, v_cur_id)
            when v_sort = 'name' and v_dir = 'desc' then
              (coalesce(b.display_name, ''), b.person_id) < (v_cur_txt, v_cur_id)
            when v_sort = 'created' and v_dir = 'asc' then
              (b.created_at, b.person_id) > (v_cur_ts, v_cur_id)
            when v_sort = 'created' and v_dir = 'desc' then
              (b.created_at, b.person_id) < (v_cur_ts, v_cur_id)
            when v_sort = 'last_contact' and v_dir = 'asc' then
              (coalesce(b.last_interaction_at, '-infinity'::timestamptz), b.person_id)
                > (coalesce(v_cur_ts, '-infinity'::timestamptz), v_cur_id)
            else
              (coalesce(b.last_interaction_at, '-infinity'::timestamptz), b.person_id)
                < (coalesce(v_cur_ts, '-infinity'::timestamptz), v_cur_id)
          end
    order by
      case when v_sort = 'name' and v_dir = 'asc' then coalesce(b.display_name, '') end asc,
      case when v_sort = 'name' and v_dir = 'desc' then coalesce(b.display_name, '') end desc,
      case when v_sort = 'created' and v_dir = 'asc' then b.created_at end asc,
      case when v_sort = 'created' and v_dir = 'desc' then b.created_at end desc,
      case when v_sort = 'last_contact' and v_dir = 'asc'
           then coalesce(b.last_interaction_at, '-infinity'::timestamptz) end asc,
      case when v_sort = 'last_contact' and v_dir = 'desc'
           then coalesce(b.last_interaction_at, '-infinity'::timestamptz) end desc,
      case when v_dir = 'asc' then b.person_id end asc,
      case when v_dir = 'desc' then b.person_id end desc
    limit v_limit + 1
  ) t;

  if v_count > v_limit then
    v_rows := (select jsonb_agg(e) from (
                 select e from jsonb_array_elements(v_rows) with ordinality as x(e, i)
                  where x.i <= v_limit) s);
    v_last := v_rows -> (v_limit - 1);
    -- v may be jsonb null (null sort value): the cursor contract is explicitly
    -- {v: string|null, id} end-to-end.
    v_next := jsonb_build_object(
      'v', case v_sort
             when 'name' then to_jsonb(coalesce(v_last ->> 'display_name', ''))
             when 'created' then v_last -> 'created_at'
             else v_last -> 'last_interaction_at' end,
      'id', v_last -> 'person_id');
  end if;

  return jsonb_build_object(
    'items', coalesce(v_rows, '[]'::jsonb),
    'next_cursor', v_next,
    'include_all_discovered', v_include_all,
    'sort', v_sort,
    'dir', v_dir);
end $$;

-- ===========================================================================
-- Counts — bounded aggregates. classified = has an ACTIVE relationship.
-- ===========================================================================
create or replace function marketing_contacts_counts(p_tenant uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_include_all boolean;
  v_total int;
  v_classified int;
  v_suppressed int;
  v_by_lifecycle jsonb;
begin
  select coalesce(ms.include_all_discovered, true) into v_include_all
    from marketing_settings ms where ms.tenant_id = p_tenant;
  if not found then v_include_all := true; end if;

  select count(*),
         count(*) filter (where r.person_id is not null),
         count(*) filter (where marketing_contact_eligibility(p_tenant, p.id, 'email') = 'suppressed')
    into v_total, v_classified, v_suppressed
  from people p
  left join lateral (
    select cr.person_id from contact_relationships cr
     where cr.tenant_id = p_tenant and cr.person_id = p.id and cr.status = 'active'
     limit 1
  ) r on true
  where p.tenant_id = p_tenant
    and (v_include_all or r.person_id is not null);

  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into v_by_lifecycle
  from (
    select cr.lifecycle_stage_key as k, count(*) as n
      from contact_relationships cr
      join people p on p.id = cr.person_id and p.tenant_id = p_tenant
     where cr.tenant_id = p_tenant and cr.status = 'active'
     group by cr.lifecycle_stage_key
  ) s;

  return jsonb_build_object(
    'total', v_total,
    'classified', v_classified,
    'unclassified', v_total - v_classified,
    'suppressed', v_suppressed,
    'by_lifecycle', v_by_lifecycle,
    'include_all_discovered', v_include_all);
end $$;

-- ===========================================================================
-- Detail — ALL relationships (status-ordered); destination suppressions matched
-- against the Person's NORMALISED endpoints (points AND scalars via the
-- canonical normaliser); per-endpoint eligibility; protected flag per point.
-- ===========================================================================
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
                    coalesce(pref.contact_point_id::text, ''), pref.effective_at desc
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

-- ===========================================================================
-- Classify — explicit-target, versioned, per-field-evented (see header).
-- ===========================================================================
create or replace function marketing_classify_contact(
  p_tenant uuid, p_person uuid, p_actor uuid, p_changes jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_actor_tenant uuid;
  v_rel contact_relationships%rowtype;
  v_disp contact_relationships%rowtype;
  v_rel_id uuid;
  v_before jsonb;
  v_default_type text;
  v_default_stage text;
  v_new_stage text;
  v_new_type text;
  v_new_status text;
  v_new_owner uuid;
  v_clear_owner boolean;
  v_allow_new boolean;
  v_expected int;
  v_actor_label text;
  v_changed boolean := false;
  v_eff_owner uuid;
begin
  if p_tenant is null or p_person is null then
    raise exception 'tenant and person required' using errcode = '22023';
  end if;
  -- STRICT SHAPE: arrays and scalars are rejected, never coerced or ignored.
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'changes must be an object' using errcode = '22023';
  end if;
  -- Booleans must be REAL JSON booleans ("yes"/"1" would satisfy a ::boolean
  -- cast — that is coercion, not validation).
  if (p_changes ? 'allow_new' and jsonb_typeof(p_changes -> 'allow_new') <> 'boolean')
     or (p_changes ? 'clear_owner' and jsonb_typeof(p_changes -> 'clear_owner') <> 'boolean') then
    raise exception 'allow_new and clear_owner must be booleans' using errcode = '22023';
  end if;
  begin
    v_new_stage := nullif(p_changes ->> 'lifecycle_stage_key', '');
    v_new_type := nullif(p_changes ->> 'relationship_type', '');
    v_new_status := nullif(p_changes ->> 'status', '');
    v_rel_id := (p_changes ->> 'relationship_id')::uuid;
    v_new_owner := (p_changes ->> 'owner_id')::uuid;
    v_expected := (p_changes ->> 'expected_version')::int;
    v_clear_owner := coalesce((p_changes ->> 'clear_owner')::boolean, false);
    v_allow_new := coalesce((p_changes ->> 'allow_new')::boolean, false);
  exception when others then
    raise exception 'invalid change value' using errcode = '22023';
  end;
  -- Relationship contract combinations are explicit, never silently ignored:
  if v_expected is not null and v_rel_id is null then
    raise exception 'expected_version requires relationship_id' using errcode = '22023';
  end if;
  if v_allow_new and v_rel_id is not null then
    raise exception 'allow_new applies only to a new classification' using errcode = '22023';
  end if;
  if (v_new_stage is not null and length(v_new_stage) > 80)
     or (v_new_type is not null and length(v_new_type) > 80) then
    raise exception 'invalid lifecycle or relationship value' using errcode = '22023';
  end if;
  if v_new_status is not null and v_new_status not in ('active', 'inactive', 'archived') then
    raise exception 'invalid relationship status' using errcode = '22023';
  end if;
  if p_actor is not null then
    select tenant_id into v_actor_tenant from profiles where id = p_actor;
    if not found or v_actor_tenant is distinct from p_tenant then
      raise exception 'actor must be a profile of the target tenant'
        using errcode = 'integrity_constraint_violation';
    end if;
  end if;
  if not exists (select 1 from people where id = p_person and tenant_id = p_tenant) then
    raise exception 'person not found in tenant' using errcode = 'P0002';
  end if;
  if v_new_owner is not null then
    perform marketing_validate_owner(p_tenant, v_new_owner);
  end if;
  v_actor_label := coalesce((select email from profiles where id = p_actor),
                            p_actor::text, 'service');

  if v_rel_id is not null then
    -- ── UPDATE an explicit relationship ──
    select * into v_rel from contact_relationships r
     where r.id = v_rel_id and r.tenant_id = p_tenant and r.person_id = p_person
     for update;
    if not found then
      raise exception 'relationship not found for person' using errcode = 'P0002';
    end if;
    if v_expected is null then
      raise exception 'expected_version is required for relationship updates'
        using errcode = '22023';
    end if;
    if v_expected <> v_rel.version then
      raise exception 'relationship was changed elsewhere (expected version %, found %)',
        v_expected, v_rel.version using errcode = 'MK409';
    end if;
    v_eff_owner := case when v_clear_owner then null else coalesce(v_new_owner, v_rel.owner_id) end;
    v_changed := (v_new_stage is not null and v_new_stage <> v_rel.lifecycle_stage_key)
              or (v_new_type is not null and v_new_type <> v_rel.relationship_type)
              or (v_new_status is not null and v_new_status <> v_rel.status)
              or (v_eff_owner is distinct from v_rel.owner_id);
    if not v_changed then
      raise exception 'no effective changes supplied' using errcode = '22023';
    end if;
    v_before := jsonb_build_object(
      'lifecycle_stage_key', v_rel.lifecycle_stage_key,
      'relationship_type', v_rel.relationship_type,
      'status', v_rel.status,
      'owner_id', v_rel.owner_id,
      'version', v_rel.version);
    update contact_relationships r set
      lifecycle_stage_key = coalesce(v_new_stage, r.lifecycle_stage_key),
      relationship_type = coalesce(v_new_type, r.relationship_type),
      status = coalesce(v_new_status, r.status),
      owner_id = v_eff_owner,
      updated_by = p_actor,
      version = r.version + 1,
      last_activity_at = now()
    where r.id = v_rel.id
    returning * into v_rel;

    -- precise per-field business facts (only for fields that actually changed)
    if (v_before ->> 'lifecycle_stage_key') <> v_rel.lifecycle_stage_key then
      perform marketing_event_append(p_tenant, 'marketing.contact.lifecycle_changed', 'person',
        p_person, 'marketing-contacts',
        jsonb_build_object('k', v_rel.version || ':lifecycle',
          'relationship_id', v_rel.id, 'from', v_before ->> 'lifecycle_stage_key',
          'to', v_rel.lifecycle_stage_key, 'version', v_rel.version,
          'actor', v_actor_label, 'at', now()));
    end if;
    if (v_before ->> 'relationship_type') <> v_rel.relationship_type then
      perform marketing_event_append(p_tenant, 'marketing.contact.relationship_type_changed',
        'person', p_person, 'marketing-contacts',
        jsonb_build_object('k', v_rel.version || ':type',
          'relationship_id', v_rel.id, 'from', v_before ->> 'relationship_type',
          'to', v_rel.relationship_type, 'version', v_rel.version,
          'actor', v_actor_label, 'at', now()));
    end if;
    if (v_before ->> 'status') <> v_rel.status then
      perform marketing_event_append(p_tenant, 'marketing.contact.relationship_status_changed',
        'person', p_person, 'marketing-contacts',
        jsonb_build_object('k', v_rel.version || ':status',
          'relationship_id', v_rel.id, 'from', v_before ->> 'status',
          'to', v_rel.status, 'version', v_rel.version,
          'actor', v_actor_label, 'at', now()));
    end if;
    if (v_before -> 'owner_id') is distinct from to_jsonb(v_rel.owner_id) then
      perform marketing_event_append(p_tenant, 'marketing.contact.owner_changed', 'person',
        p_person, 'marketing-contacts',
        jsonb_build_object('k', v_rel.version || ':owner',
          'relationship_id', v_rel.id, 'from', v_before -> 'owner_id',
          'to', v_rel.owner_id, 'version', v_rel.version,
          'actor', v_actor_label, 'at', now()));
    end if;
  else
    -- ── CREATE a classification (classified = has an ACTIVE relationship) ──
    if v_new_status is not null and v_new_status <> 'active' then
      raise exception 'a new classification is always active — reactivate or archive an explicit relationship_id'
        using errcode = '22023';
    end if;
    if v_new_stage is null and v_new_type is null and v_new_owner is null
       and v_new_status is null and not v_clear_owner and not v_allow_new then
      raise exception 'no effective changes supplied' using errcode = '22023';
    end if;
    if exists (select 1 from contact_relationships r
                where r.tenant_id = p_tenant and r.person_id = p_person
                  and r.status = 'active') then
      raise exception 'person already has an active relationship; supply relationship_id'
        using errcode = '22023';
    end if;
    if not v_allow_new and exists (select 1 from contact_relationships r
                where r.tenant_id = p_tenant and r.person_id = p_person) then
      raise exception 'historical relationships exist; supply relationship_id to reactivate or allow_new to create'
        using errcode = '22023';
    end if;
    select coalesce(ms.default_relationship_type, 'lead'),
           coalesce(ms.default_lifecycle_stage_key, 'new_lead')
      into v_default_type, v_default_stage
      from marketing_settings ms where ms.tenant_id = p_tenant;
    if not found then
      v_default_type := 'lead'; v_default_stage := 'new_lead';
    end if;
    insert into contact_relationships
      (tenant_id, person_id, relationship_type, lifecycle_stage_key, status,
       owner_id, source, created_by, updated_by)
    values
      (p_tenant, p_person, coalesce(v_new_type, v_default_type),
       coalesce(v_new_stage, v_default_stage), 'active',
       case when v_clear_owner then null else v_new_owner end,
       'manual', p_actor, p_actor)
    returning * into v_rel;
    v_before := null;
    perform marketing_event_append(p_tenant, 'marketing.contact.classified', 'person',
      p_person, 'marketing-contacts',
      jsonb_build_object('k', 'created:' || v_rel.id,
        'relationship_id', v_rel.id,
        'lifecycle_stage_key', v_rel.lifecycle_stage_key,
        'relationship_type', v_rel.relationship_type,
        'owner_id', v_rel.owner_id, 'version', v_rel.version,
        'actor', v_actor_label, 'at', now()));
  end if;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_actor_label, 'marketing.contact.classified',
          'contact_relationship', v_rel.id::text, 'ok',
          jsonb_build_object('person_id', p_person, 'before', v_before,
                             'after', jsonb_build_object(
                               'lifecycle_stage_key', v_rel.lifecycle_stage_key,
                               'relationship_type', v_rel.relationship_type,
                               'status', v_rel.status,
                               'owner_id', v_rel.owner_id),
                             'version', v_rel.version));

  -- The card's marketing projection ALWAYS reflects the CURRENT/display
  -- relationship (active > inactive > archived, then oldest), recomputed after
  -- the mutation — editing a historical row never overwrites the card with
  -- non-current state. relationship_id says exactly which row is projected.
  select * into v_disp from contact_relationships cr
   where cr.tenant_id = p_tenant and cr.person_id = p_person
   order by case cr.status when 'active' then 0 when 'inactive' then 1 else 2 end,
            cr.created_at asc
   limit 1;
  update customer_cards c set
    context = jsonb_set(coalesce(c.context, '{}'::jsonb), '{marketing}',
      coalesce(c.context -> 'marketing', '{}'::jsonb) || jsonb_build_object(
        'relationship_id', v_disp.id,
        'lifecycle_stage_key', v_disp.lifecycle_stage_key,
        'relationship_type', v_disp.relationship_type,
        'relationship_status', v_disp.status,
        'owner_id', v_disp.owner_id,
        'updated_at', now()))
  where c.tenant_id = p_tenant and c.person_id = p_person
    and not (c.locked_fields @> array['context']);

  return jsonb_build_object(
    'relationship_id', v_rel.id,
    'lifecycle_stage_key', v_rel.lifecycle_stage_key,
    'relationship_type', v_rel.relationship_type,
    'status', v_rel.status,
    'owner_id', v_rel.owner_id,
    'version', v_rel.version,
    'created', v_before is null);
end $$;

-- ===========================================================================
-- Create — identity-safe and concurrency-safe (see header).
-- Result statuses: created | existing | ambiguous.
-- ===========================================================================
create or replace function marketing_create_contact(
  p_tenant uuid, p_actor uuid, p_details jsonb, p_idempotency_key uuid
) returns jsonb
language plpgsql
as $$
declare
  v_actor_tenant uuid;
  v_name text;
  v_first text;
  v_last text;
  v_email text;
  v_phone text;
  v_company uuid;
  v_owner uuid;
  v_candidates jsonb;
  v_ident jsonb;
  v_pids uuid[];
  v_n int;
  v_truncated boolean := false;
  v_person uuid;
  v_rel uuid;
  v_default_type text;
  v_default_stage text;
  v_actor_label text;
  v_fingerprint text;
  v_stored marketing_request_keys%rowtype;
  v_result jsonb;
  v_conflict uuid;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  -- The idempotency key and a REAL same-tenant actor are mandatory: a null
  -- key would let racing browser retries bypass the ledger entirely.
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  if p_actor is null then
    raise exception 'actor required' using errcode = '22023';
  end if;
  select tenant_id into v_actor_tenant from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  -- STRICT SHAPE: arrays and scalars are rejected, never coerced or ignored.
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'details must be an object' using errcode = '22023';
  end if;
  v_name := nullif(trim(coalesce(p_details ->> 'display_name', '')), '');
  v_first := nullif(trim(coalesce(p_details ->> 'first_name', '')), '');
  v_last := nullif(trim(coalesce(p_details ->> 'last_name', '')), '');
  v_email := marketing_normalize_endpoint('email', p_details ->> 'email');
  v_phone := marketing_normalize_endpoint('phone', p_details ->> 'phone');
  begin
    v_company := (p_details ->> 'company_id')::uuid;
    v_owner := (p_details ->> 'owner_id')::uuid;
  exception when others then
    raise exception 'invalid detail value' using errcode = '22023';
  end;
  if v_name is null or length(v_name) > 200
     or length(coalesce(v_first, '')) > 200 or length(coalesce(v_last, '')) > 200 then
    raise exception 'display_name required (names max 200 chars)' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_details ->> 'email', '')), '') is not null and v_email is null then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_details ->> 'phone', '')), '') is not null and v_phone is null then
    raise exception 'invalid phone' using errcode = '22023';
  end if;
  if v_company is not null and not exists (
    select 1 from companies where id = v_company and tenant_id = p_tenant) then
    raise exception 'company not found in tenant' using errcode = 'P0002';
  end if;
  if v_owner is not null then
    perform marketing_validate_owner(p_tenant, v_owner);
  end if;

  -- Canonical collision-resistant fingerprint over EVERY material field.
  -- jsonb text rendering is canonical (sorted keys) and stored verbatim —
  -- equality is exact, no lossy hash.
  v_fingerprint := jsonb_build_object(
    'name', v_name, 'first', v_first, 'last', v_last,
    'email', v_email, 'phone', v_phone,
    'company', v_company, 'owner', v_owner,
    'type', nullif(p_details ->> 'relationship_type', ''),
    'stage', nullif(p_details ->> 'lifecycle_stage_key', ''))::text;

  -- SERIALISE THE KEY FIRST: the tenant+key advisory lock is taken BEFORE the
  -- ledger read, so two same-key requests can never both see an empty ledger
  -- and each commit a Person (the old name-only/same-key race). The ledger is
  -- read UNDER the lock and returns/conflicts before any identity or Person
  -- mutation. The unique (tenant, key) constraint below stays as defence in
  -- depth only.
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|idem|' || p_idempotency_key::text, 42));
  select * into v_stored from marketing_request_keys
   where tenant_id = p_tenant and idempotency_key = p_idempotency_key;
  if found then
    if v_stored.action <> 'create_contact'
       or v_stored.actor is distinct from p_actor
       or v_stored.fingerprint <> v_fingerprint then
      raise exception 'idempotency key was used for a different request'
        using errcode = '55000';
    end if;
    return v_stored.result;
  end if;

  -- One advisory lock PER supplied identifier, deterministic order (always
  -- after the key lock, email before phone): any strong-identifier overlap
  -- serialises; name-only creates take no identity lock.
  if v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|email|' || v_email, 42));
  end if;
  if v_phone is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|phone|' || v_phone, 42));
  end if;

  -- Per-identifier candidate evidence (locked re-check).
  with matches as (
    select distinct src.channel, src.person_id
    from (
      select 'email' as channel, pp.id as person_id from people pp
       where v_email is not null and pp.tenant_id = p_tenant
         and marketing_normalize_endpoint('email', pp.primary_email) = v_email
      union all
      select 'email', cp.person_id from contact_points cp
       where v_email is not null and cp.tenant_id = p_tenant
         and cp.channel = 'email' and cp.normalized_value = v_email
      union all
      select 'phone', pp2.id from people pp2
       where v_phone is not null and pp2.tenant_id = p_tenant
         and marketing_normalize_endpoint('phone', pp2.primary_phone) = v_phone
      union all
      select 'phone', cp2.person_id from contact_points cp2
       where v_phone is not null and cp2.tenant_id = p_tenant
         and cp2.channel = 'phone' and cp2.normalized_value = v_phone
    ) src
    join people p on p.id = src.person_id and p.tenant_id = p_tenant
  ),
  people_matched as (
    select m.person_id, p.display_name,
           array_agg(distinct m.channel order by m.channel) as matched_on
    from matches m join people p on p.id = m.person_id and p.tenant_id = p_tenant
    group by m.person_id, p.display_name
    order by m.person_id
    limit 7
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'person_id', pm.person_id, 'display_name', pm.display_name,
      'matched_on', to_jsonb(pm.matched_on))), '[]'::jsonb),
    count(*)
  into v_candidates, v_n
  from people_matched pm;

  -- Per-identifier evidence for the conflict record (never mislabelled).
  -- TENANT-SAFE ON BOTH SIDES: every contact-point candidate joins its Person
  -- back to p_tenant, so a corrupt cross-tenant reference can never leak a
  -- foreign Person id into stored evidence. Stored arrays are BOUNDED (25 ids,
  -- per-identifier truncated flag) — never an unlimited UUID list.
  v_ident := '[]'::jsonb;
  if v_email is not null then
    select array_agg(pid) into v_pids from (
      select u.pid from (
        select pp.id as pid from people pp
         where pp.tenant_id = p_tenant
           and marketing_normalize_endpoint('email', pp.primary_email) = v_email
        union
        select cpx.person_id from contact_points cpx
          join people pj on pj.id = cpx.person_id and pj.tenant_id = p_tenant
         where cpx.tenant_id = p_tenant and cpx.channel = 'email'
           and cpx.normalized_value = v_email
      ) u order by u.pid limit 26) b;
    if v_pids is not null then
      v_ident := v_ident || jsonb_build_array(jsonb_build_object(
        'channel', 'email', 'value', v_email,
        'candidate_person_ids', to_jsonb(v_pids[1:25]),
        'truncated', coalesce(array_length(v_pids, 1), 0) > 25));
    end if;
  end if;
  if v_phone is not null then
    select array_agg(pid) into v_pids from (
      select u.pid from (
        select pp2.id as pid from people pp2
         where pp2.tenant_id = p_tenant
           and marketing_normalize_endpoint('phone', pp2.primary_phone) = v_phone
        union
        select cpy.person_id from contact_points cpy
          join people pj2 on pj2.id = cpy.person_id and pj2.tenant_id = p_tenant
         where cpy.tenant_id = p_tenant and cpy.channel = 'phone'
           and cpy.normalized_value = v_phone
      ) u order by u.pid limit 26) b;
    if v_pids is not null then
      v_ident := v_ident || jsonb_build_array(jsonb_build_object(
        'channel', 'phone', 'value', v_phone,
        'candidate_person_ids', to_jsonb(v_pids[1:25]),
        'truncated', coalesce(array_length(v_pids, 1), 0) > 25));
    end if;
  end if;

  if v_n > 6 then
    v_truncated := true;
    v_n := 6;
    v_candidates := (select jsonb_agg(e) from (
      select e from jsonb_array_elements(v_candidates) with ordinality x(e, i)
       where x.i <= 6) s);
  end if;

  v_actor_label := coalesce((select email from profiles where id = p_actor),
                            p_actor::text, 'service');

  if v_n = 1 then
    v_result := jsonb_build_object(
      'created', false, 'status', 'existing', 'candidate', v_candidates -> 0);
  elsif v_n > 1 then
    insert into marketing_identity_conflicts
      (tenant_id, identifiers, candidate_person_ids, truncated, requested,
       idempotency_key, created_by)
    values
      (p_tenant, v_ident,
       (select array_agg(distinct (e ->> 'person_id')::uuid)
          from jsonb_array_elements(v_candidates) e),
       v_truncated,
       jsonb_build_object('display_name', v_name),
       p_idempotency_key, p_actor)
    returning id into v_conflict;
    insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
    values (p_tenant, v_actor_label, 'marketing.contact.create_ambiguous',
            'marketing_identity_conflict', v_conflict::text, 'ok',
            jsonb_build_object('candidates', v_n, 'truncated', v_truncated,
                               'idempotency_key', p_idempotency_key));
    perform marketing_event_append(p_tenant, 'marketing.identity_conflict.created',
      'marketing_identity_conflict', v_conflict, 'marketing-contacts',
      jsonb_build_object('k', 'created:' || v_conflict,
        'candidates', v_n, 'truncated', v_truncated,
        'actor', v_actor_label, 'at', now()));
    v_result := jsonb_build_object(
      'created', false, 'status', 'ambiguous',
      'conflict_id', v_conflict, 'candidates', v_candidates,
      'truncated', v_truncated);
  else
    select coalesce(ms.default_relationship_type, 'lead'),
           coalesce(ms.default_lifecycle_stage_key, 'new_lead')
      into v_default_type, v_default_stage
      from marketing_settings ms where ms.tenant_id = p_tenant;
    if not found then
      v_default_type := 'lead'; v_default_stage := 'new_lead';
    end if;

    insert into people (tenant_id, company_id, display_name, first_name, last_name,
                        primary_email, primary_phone, created_source, verified)
    values (p_tenant, v_company, v_name, v_first, v_last,
            v_email, nullif(trim(coalesce(p_details ->> 'phone', '')), ''), 'manual', false)
    returning id into v_person;

    if v_email is not null then
      insert into contact_points (tenant_id, person_id, channel, value, normalized_value,
                                  is_primary, source)
      values (p_tenant, v_person, 'email', p_details ->> 'email', v_email, true, 'manual');
    end if;
    if v_phone is not null then
      insert into contact_points (tenant_id, person_id, channel, value, normalized_value,
                                  is_primary, source)
      values (p_tenant, v_person, 'phone', p_details ->> 'phone', v_phone, true, 'manual');
    end if;

    insert into contact_relationships (tenant_id, person_id, relationship_type,
                                       lifecycle_stage_key, owner_id, source,
                                       created_by, updated_by)
    values (p_tenant, v_person,
            coalesce(nullif(p_details ->> 'relationship_type', ''), v_default_type),
            coalesce(nullif(p_details ->> 'lifecycle_stage_key', ''), v_default_stage),
            v_owner, 'manual', p_actor, p_actor)
    returning id into v_rel;

    insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
    values (p_tenant, v_actor_label, 'marketing.contact.created', 'person', v_person::text,
            'ok', jsonb_build_object('relationship_id', v_rel,
                                     'idempotency_key', p_idempotency_key));
    perform marketing_event_append(p_tenant, 'marketing.contact.created', 'person', v_person,
      'marketing-contacts',
      jsonb_build_object('k', 'created:' || v_person, 'relationship_id', v_rel,
                         'actor', v_actor_label, 'at', now()));

    v_result := jsonb_build_object('created', true, 'person_id', v_person,
                                   'relationship_id', v_rel);
  end if;

  -- Defence in depth only: under the tenant+key advisory lock this insert can
  -- never race itself, but the unique (tenant, key) constraint stays and a
  -- violation still converges on the stored result.
  begin
    insert into marketing_request_keys
      (tenant_id, idempotency_key, actor, action, fingerprint, result)
    values (p_tenant, p_idempotency_key, p_actor, 'create_contact', v_fingerprint, v_result);
  exception when unique_violation then
    select * into v_stored from marketing_request_keys
     where tenant_id = p_tenant and idempotency_key = p_idempotency_key;
    if v_stored.action <> 'create_contact'
       or v_stored.actor is distinct from p_actor
       or v_stored.fingerprint <> v_fingerprint then
      raise exception 'idempotency key was used for a different request'
        using errcode = '55000';
    end if;
    return v_stored.result;
  end;

  return v_result;
end $$;

-- ===========================================================================
-- Update — the edit surface: person fields, company, contact points (ADD /
-- UPDATE / set-primary with optimistic expected_updated_at + protected-field
-- rules), and relationship changes delegated to classify.
--   Contact-point protection: value edits only on 'manual'-source, non-verified
--   points — source evidence and verified values raise MK403 PROTECTED_FIELD;
--   label/primary stay editable. A value change re-runs the identity check:
--   matches against OTHER People do not block (shared endpoints are legal
--   evidence) but persist an identity-conflict record + event for review.
--   NO-OP SEMANTICS: sub-operations that change nothing (identical person
--   fields, identical value/label, make_primary/set_primary on the current
--   primary) update nothing and emit nothing; supplying the CURRENT value of a
--   protected point is a no-op, not a protection violation; a request whose
--   every sub-operation is a no-op raises 22023 — no false transitions, ever.
-- p_changes: {person:{display_name?,first_name?,last_name?,company_id?,clear_company?},
--             contact_points:{add:[{channel,value,label?,make_primary?}],
--                             update:[{id, expected_updated_at, value?, label?, make_primary?}]},
--             relationship:{...classify changes (relationship_id/expected_version/allow_new)}}
-- (set_primary shorthand REMOVED — primary changes go through update items
--  with the same explicit-id + expected_updated_at optimistic contract.)
-- ===========================================================================
create or replace function marketing_update_contact(
  p_tenant uuid, p_person uuid, p_actor uuid, p_changes jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_actor_tenant uuid;
  v_p people%rowtype;
  v_person_changes jsonb := p_changes -> 'person';
  v_cp_changes jsonb := p_changes -> 'contact_points';
  v_rel_changes jsonb := p_changes -> 'relationship';
  v_company uuid;
  v_clear_company boolean;
  v_changed text[] := array[]::text[];
  v_item jsonb;
  v_channel text;
  v_value text;
  v_norm text;
  v_label text;
  v_cp contact_points%rowtype;
  v_new_cp uuid;
  v_expected timestamptz;
  v_make_primary boolean;
  v_actor_label text;
  v_rel_result jsonb;
  v_other_matches uuid[];
  v_conflict uuid;
  v_value_changed boolean;
  v_label_changed boolean;
  v_primary_changed boolean;
begin
  if p_tenant is null or p_person is null then
    raise exception 'tenant and person required' using errcode = '22023';
  end if;
  -- STRICT SHAPES: the body and every nested block must be the declared shape;
  -- arrays, scalars and malformed items are rejected BEFORE any write, audit
  -- or event (explicit JSON null reads as absent).
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'changes must be an object' using errcode = '22023';
  end if;
  if v_person_changes is not null
     and jsonb_typeof(v_person_changes) not in ('object', 'null') then
    raise exception 'person changes must be an object' using errcode = '22023';
  end if;
  if v_cp_changes is not null
     and jsonb_typeof(v_cp_changes) not in ('object', 'null') then
    raise exception 'contact_points changes must be an object' using errcode = '22023';
  end if;
  if v_rel_changes is not null
     and jsonb_typeof(v_rel_changes) not in ('object', 'null') then
    raise exception 'relationship changes must be an object' using errcode = '22023';
  end if;
  if v_cp_changes is not null and jsonb_typeof(v_cp_changes) = 'object' then
    if v_cp_changes ? 'add'
       and jsonb_typeof(v_cp_changes -> 'add') not in ('array', 'null') then
      raise exception 'contact_points.add must be an array' using errcode = '22023';
    end if;
    if v_cp_changes ? 'update'
       and jsonb_typeof(v_cp_changes -> 'update') not in ('array', 'null') then
      raise exception 'contact_points.update must be an array' using errcode = '22023';
    end if;
    if v_cp_changes ? 'set_primary' then
      raise exception 'set_primary was removed — use contact_points.update with make_primary and expected_updated_at'
        using errcode = '22023';
    end if;
  end if;
  if p_actor is not null then
    select tenant_id into v_actor_tenant from profiles where id = p_actor;
    if not found or v_actor_tenant is distinct from p_tenant then
      raise exception 'actor must be a profile of the target tenant'
        using errcode = 'integrity_constraint_violation';
    end if;
  end if;
  select * into v_p from people where id = p_person and tenant_id = p_tenant for update;
  if not found then
    raise exception 'person not found in tenant' using errcode = 'P0002';
  end if;
  v_actor_label := coalesce((select email from profiles where id = p_actor),
                            p_actor::text, 'service');

  -- ── person fields ──
  if v_person_changes is not null and jsonb_typeof(v_person_changes) = 'object' then
    if v_person_changes ? 'clear_company'
       and jsonb_typeof(v_person_changes -> 'clear_company') <> 'boolean' then
      raise exception 'clear_company must be a boolean' using errcode = '22023';
    end if;
    begin
      v_company := (v_person_changes ->> 'company_id')::uuid;
      v_clear_company := coalesce((v_person_changes ->> 'clear_company')::boolean, false);
    exception when others then
      raise exception 'invalid person change value' using errcode = '22023';
    end;
    if greatest(length(coalesce(v_person_changes ->> 'display_name', '')),
                length(coalesce(v_person_changes ->> 'first_name', '')),
                length(coalesce(v_person_changes ->> 'last_name', ''))) > 200 then
      raise exception 'name too long' using errcode = '22023';
    end if;
    if (v_person_changes ? 'display_name' or v_person_changes ? 'first_name'
        or v_person_changes ? 'last_name') and v_p.verified then
      raise exception 'verified identity fields are source-authoritative'
        using errcode = 'MK403';
    end if;
    if v_company is not null and not exists (
      select 1 from companies where id = v_company and tenant_id = p_tenant) then
      raise exception 'company not found in tenant' using errcode = 'P0002';
    end if;
    -- Only an EFFECTIVE change updates, audits and emits — identical values are
    -- a no-op sub-operation (a wholly ineffective request is rejected below).
    if (v_person_changes ? 'display_name'
        and nullif(trim(v_person_changes ->> 'display_name'), '')
            is distinct from v_p.display_name)
       or (v_person_changes ? 'first_name'
           and nullif(trim(v_person_changes ->> 'first_name'), '')
               is distinct from v_p.first_name)
       or (v_person_changes ? 'last_name'
           and nullif(trim(v_person_changes ->> 'last_name'), '')
               is distinct from v_p.last_name)
       or (v_clear_company and v_p.company_id is not null)
       or (not v_clear_company and v_company is not null
           and v_company is distinct from v_p.company_id) then
      update people p set
        display_name = case when v_person_changes ? 'display_name'
                            then nullif(trim(v_person_changes ->> 'display_name'), '')
                            else p.display_name end,
        first_name = case when v_person_changes ? 'first_name'
                          then nullif(trim(v_person_changes ->> 'first_name'), '')
                          else p.first_name end,
        last_name = case when v_person_changes ? 'last_name'
                         then nullif(trim(v_person_changes ->> 'last_name'), '')
                         else p.last_name end,
        company_id = case when v_clear_company then null
                          when v_company is not null then v_company
                          else p.company_id end
      where p.id = p_person;
      v_changed := array_append(v_changed, 'person');
    end if;
  end if;

  -- ── contact points: add ──
  if v_cp_changes is not null and jsonb_typeof(v_cp_changes -> 'add') = 'array' then
    for v_item in select * from jsonb_array_elements(v_cp_changes -> 'add') loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'invalid contact point' using errcode = '22023';
      end if;
      if v_item ? 'make_primary'
         and jsonb_typeof(v_item -> 'make_primary') <> 'boolean' then
        raise exception 'make_primary must be a boolean' using errcode = '22023';
      end if;
      v_channel := v_item ->> 'channel';
      v_value := nullif(trim(coalesce(v_item ->> 'value', '')), '');
      v_label := nullif(trim(coalesce(v_item ->> 'label', '')), '');
      v_make_primary := coalesce((v_item ->> 'make_primary')::boolean, false);
      if v_channel not in ('email', 'phone', 'sms', 'whatsapp', 'social', 'other')
         or v_value is null or length(v_value) > 200
         or (v_label is not null and length(v_label) > 60) then
        raise exception 'invalid contact point' using errcode = '22023';
      end if;
      v_norm := marketing_normalize_endpoint(v_channel, v_value);
      if v_norm is null then
        raise exception 'invalid contact point value' using errcode = '22023';
      end if;
      if v_make_primary then
        update contact_points set is_primary = false
         where tenant_id = p_tenant and person_id = p_person
           and channel = v_channel and is_primary;
      end if;
      insert into contact_points (tenant_id, person_id, channel, value, normalized_value,
                                  label, is_primary, source)
      values (p_tenant, p_person, v_channel, v_value, v_norm, v_label,
              v_make_primary, 'manual')
      returning id into v_new_cp;
      insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
      values (p_tenant, v_actor_label, 'marketing.contact_point.created',
              'contact_point', v_new_cp::text, 'ok',
              jsonb_build_object('person_id', p_person, 'channel', v_channel));
      perform marketing_event_append(p_tenant, 'marketing.contact_point.created', 'person',
        p_person, 'marketing-contacts',
        jsonb_build_object('k', 'cp-created:' || v_new_cp, 'contact_point_id', v_new_cp,
                           'channel', v_channel, 'actor', v_actor_label, 'at', now()));
      v_changed := array_append(v_changed, 'contact_point_added');
    end loop;
  end if;

  -- ── contact points: update (value/label/primary; optimistic + protected) ──
  if v_cp_changes is not null and jsonb_typeof(v_cp_changes -> 'update') = 'array' then
    for v_item in select * from jsonb_array_elements(v_cp_changes -> 'update') loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'invalid contact point update' using errcode = '22023';
      end if;
      if v_item ? 'make_primary'
         and jsonb_typeof(v_item -> 'make_primary') <> 'boolean' then
        raise exception 'make_primary must be a boolean' using errcode = '22023';
      end if;
      begin
        v_new_cp := (v_item ->> 'id')::uuid;
        v_expected := (v_item ->> 'expected_updated_at')::timestamptz;
        v_make_primary := coalesce((v_item ->> 'make_primary')::boolean, false);
      exception when others then
        raise exception 'invalid contact point update' using errcode = '22023';
      end;
      if v_new_cp is null or v_expected is null then
        raise exception 'contact point updates require id and expected_updated_at'
          using errcode = '22023';
      end if;
      select * into v_cp from contact_points
       where id = v_new_cp and tenant_id = p_tenant and person_id = p_person
       for update;
      if not found then
        raise exception 'contact point not found for person' using errcode = 'P0002';
      end if;
      -- EXACT opaque token comparison — the client returns the server's own
      -- updated_at verbatim; the token is never truncated or weakened.
      if v_cp.updated_at is distinct from v_expected then
        raise exception 'contact point was changed elsewhere' using errcode = 'MK409';
      end if;
      v_value := nullif(trim(coalesce(v_item ->> 'value', '')), '');
      v_label := case when v_item ? 'label'
                      then nullif(trim(coalesce(v_item ->> 'label', '')), '') end;
      if v_value is not null and length(v_value) > 200 then
        raise exception 'invalid contact point value' using errcode = '22023';
      end if;
      if v_label is not null and length(v_label) > 60 then
        raise exception 'invalid label' using errcode = '22023';
      end if;
      -- Effective-change detection: identical values are no-op sub-operations —
      -- they update nothing, bump nothing and emit nothing. Protection and the
      -- identity check apply to CHANGES (supplying the current value verbatim on
      -- a protected point is a no-op, not a protection violation).
      v_norm := null;
      v_value_changed := v_value is not null and v_value is distinct from v_cp.value;
      if v_value_changed then
        if v_cp.verification_state = 'verified' or v_cp.source <> 'manual' then
          raise exception 'contact point value is source-authoritative'
            using errcode = 'MK403';
        end if;
        v_norm := marketing_normalize_endpoint(v_cp.channel, v_value);
        if v_norm is null then
          raise exception 'invalid contact point value' using errcode = '22023';
        end if;
        -- identity check on endpoint change: the SAME tenant+channel+value
        -- advisory lock creates take is acquired first, so a concurrent create
        -- of this endpoint serialises with the edit; candidates join their
        -- Person back to p_tenant (corrupt cross-tenant refs never leak) and
        -- the stored array is bounded. Shared endpoints are legal evidence —
        -- matches against OTHER People never block, they are recorded for
        -- review with BOTH audit and event evidence.
        if v_norm is distinct from v_cp.normalized_value then
          perform pg_advisory_xact_lock(hashtextextended(
            p_tenant::text || '|' || v_cp.channel || '|' || v_norm, 42));
          select array_agg(pid) into v_other_matches from (
            select m.pid from (
              select pp.id as pid from people pp
               where pp.tenant_id = p_tenant and pp.id <> p_person
                 and marketing_normalize_endpoint(v_cp.channel, case v_cp.channel
                       when 'email' then pp.primary_email else pp.primary_phone end) = v_norm
              union
              select cpx.person_id from contact_points cpx
                join people pj on pj.id = cpx.person_id and pj.tenant_id = p_tenant
               where cpx.tenant_id = p_tenant and cpx.person_id <> p_person
                 and cpx.channel = v_cp.channel and cpx.normalized_value = v_norm
            ) m order by m.pid limit 26) b;
          if v_other_matches is not null then
            insert into marketing_identity_conflicts
              (tenant_id, identifiers, candidate_person_ids, truncated, requested, created_by)
            values (p_tenant,
                    jsonb_build_array(jsonb_build_object(
                      'channel', v_cp.channel, 'value', v_norm,
                      'candidate_person_ids', to_jsonb(v_other_matches[1:25]),
                      'truncated', coalesce(array_length(v_other_matches, 1), 0) > 25)),
                    v_other_matches[1:25],
                    coalesce(array_length(v_other_matches, 1), 0) > 25,
                    jsonb_build_object('edited_person_id', p_person,
                                       'contact_point_id', v_cp.id),
                    p_actor)
            returning id into v_conflict;
            insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
            values (p_tenant, v_actor_label, 'marketing.identity_conflict.created',
                    'marketing_identity_conflict', v_conflict::text, 'ok',
                    jsonb_build_object('reason', 'contact_point_value_change',
                      'edited_person_id', p_person, 'contact_point_id', v_cp.id,
                      'channel', v_cp.channel));
            perform marketing_event_append(p_tenant, 'marketing.identity_conflict.created',
              'marketing_identity_conflict', v_conflict, 'marketing-contacts',
              jsonb_build_object('k', 'created:' || v_conflict,
                'reason', 'contact_point_value_change',
                'actor', v_actor_label, 'at', now()));
          end if;
        end if;
      end if;
      v_label_changed := (v_item ? 'label') and v_label is distinct from v_cp.label;
      v_primary_changed := v_make_primary and not v_cp.is_primary;
      -- an INVALID endpoint can never become the primary
      if v_primary_changed and v_cp.verification_state = 'invalid' then
        raise exception 'an invalid contact point cannot be made primary'
          using errcode = '22023';
      end if;
      if not (v_value_changed or v_label_changed or v_primary_changed) then
        continue;  -- pure no-op item: no update, no audit, no event
      end if;
      if v_primary_changed then
        update contact_points set is_primary = false
         where tenant_id = p_tenant and person_id = p_person
           and channel = v_cp.channel and is_primary and id <> v_cp.id;
      end if;
      update contact_points set
        value = case when v_value_changed then v_value else value end,
        normalized_value = case when v_value_changed then v_norm else normalized_value end,
        label = case when v_label_changed then v_label else label end,
        is_primary = case when v_primary_changed then true else is_primary end
      where id = v_cp.id;
      -- audit + event both carry BEFORE/AFTER values for the real changes
      insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
      values (p_tenant, v_actor_label, 'marketing.contact_point.updated',
              'contact_point', v_cp.id::text, 'ok',
              jsonb_build_object('person_id', p_person,
                'value_changed', v_value_changed,
                'value_from', case when v_value_changed then v_cp.value end,
                'value_to', case when v_value_changed then v_value end,
                'label_changed', v_label_changed,
                'label_from', case when v_label_changed then v_cp.label end,
                'label_to', case when v_label_changed then v_label end,
                'made_primary', v_primary_changed));
      perform marketing_event_append(p_tenant, 'marketing.contact_point.updated', 'person',
        p_person, 'marketing-contacts',
        jsonb_build_object('k', 'cp-updated:' || v_cp.id || ':' ||
                                clock_timestamp()::text,
                           'contact_point_id', v_cp.id, 'channel', v_cp.channel,
                           'value_changed', v_value_changed,
                           'value_from', case when v_value_changed then v_cp.value end,
                           'value_to', case when v_value_changed then v_value end,
                           'label_changed', v_label_changed,
                           'label_from', case when v_label_changed then v_cp.label end,
                           'label_to', case when v_label_changed then v_label end,
                           'made_primary', v_primary_changed,
                           'actor', v_actor_label, 'at', now()));
      v_changed := array_append(v_changed, 'contact_point_updated');
    end loop;
  end if;

  -- (The set_primary shorthand was REMOVED: making a point primary always goes
  -- through contact_points.update with an explicit id + expected_updated_at —
  -- one optimistic-concurrency contract, no unprotected side door.)

  -- ── relationship: exactly the classify path ──
  if v_rel_changes is not null and jsonb_typeof(v_rel_changes) = 'object' then
    v_rel_result := marketing_classify_contact(p_tenant, p_person, p_actor, v_rel_changes);
    v_changed := array_append(v_changed, 'relationship');
  end if;

  if array_length(v_changed, 1) is null then
    -- nothing supplied, or everything supplied was a no-op — never a false event
    raise exception 'no effective changes supplied' using errcode = '22023';
  end if;

  if v_changed && array['person'] then
    insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
    values (p_tenant, v_actor_label, 'marketing.contact.updated', 'person', p_person::text,
            'ok', jsonb_build_object('changed', to_jsonb(v_changed)));
    perform marketing_event_append(p_tenant, 'marketing.contact.updated', 'person', p_person,
      'marketing-contacts',
      jsonb_build_object('k', 'updated:' || clock_timestamp()::text,
                         'changed', to_jsonb(v_changed), 'actor', v_actor_label, 'at', now()));
  end if;

  return jsonb_build_object('updated', to_jsonb(v_changed), 'relationship', v_rel_result);
end $$;

-- ===========================================================================
-- Tags — create / assign / remove with audit + precise events.
-- ===========================================================================
create or replace function marketing_tag_mutate(
  p_tenant uuid, p_actor uuid, p_op text, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_actor_tenant uuid;
  v_actor_label text;
  v_label text;
  v_key text;
  v_tone text;
  v_tag uuid;
  v_person uuid;
  v_tag_row marketing_tags%rowtype;
  v_deleted int;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  if p_op not in ('create', 'assign', 'remove') then
    raise exception 'invalid tag operation' using errcode = '22023';
  end if;
  if p_actor is not null then
    select tenant_id into v_actor_tenant from profiles where id = p_actor;
    if not found or v_actor_tenant is distinct from p_tenant then
      raise exception 'actor must be a profile of the target tenant'
        using errcode = 'integrity_constraint_violation';
    end if;
  end if;
  v_actor_label := coalesce((select email from profiles where id = p_actor),
                            p_actor::text, 'service');

  if p_op = 'create' then
    v_label := nullif(trim(coalesce(p_args ->> 'label', '')), '');
    v_tone := coalesce(nullif(p_args ->> 'tone', ''), 'neutral');
    if v_label is null or length(v_label) > 60 then
      raise exception 'label required (max 60 chars)' using errcode = '22023';
    end if;
    if v_tone not in ('neutral', 'info', 'positive', 'attention', 'negative') then
      raise exception 'invalid tone' using errcode = '22023';
    end if;
    v_key := left(regexp_replace(regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g'),
                                 '^_+|_+$', '', 'g'), 40);
    if v_key = '' then
      raise exception 'label must contain letters or digits' using errcode = '22023';
    end if;
    insert into marketing_tags (tenant_id, key, label, tone, created_by)
    values (p_tenant, v_key, v_label, v_tone, p_actor)
    returning * into v_tag_row;
    insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
    values (p_tenant, v_actor_label, 'marketing.tag.created', 'marketing_tag',
            v_tag_row.id::text, 'ok', jsonb_build_object('key', v_key));
    perform marketing_event_append(p_tenant, 'marketing.tag.created', 'marketing_tag',
      v_tag_row.id, 'marketing-contacts',
      jsonb_build_object('k', 'created:' || v_tag_row.id, 'key', v_key,
                         'actor', v_actor_label, 'at', now()));
    return jsonb_build_object('id', v_tag_row.id, 'key', v_tag_row.key,
                              'label', v_tag_row.label, 'tone', v_tag_row.tone);
  end if;

  begin
    v_tag := (p_args ->> 'tag_id')::uuid;
    v_person := (p_args ->> 'person_id')::uuid;
  exception when others then
    raise exception 'invalid tag or person id' using errcode = '22023';
  end;
  if v_tag is null or v_person is null then
    raise exception 'tag_id and person_id required' using errcode = '22023';
  end if;
  if not exists (select 1 from marketing_tags where id = v_tag and tenant_id = p_tenant) then
    raise exception 'tag not found in tenant' using errcode = 'P0002';
  end if;
  if not exists (select 1 from people where id = v_person and tenant_id = p_tenant) then
    raise exception 'person not found in tenant' using errcode = 'P0002';
  end if;

  if p_op = 'assign' then
    begin
      insert into contact_tag_assignments (tenant_id, person_id, tag_id, source, assigned_by)
      values (p_tenant, v_person, v_tag, 'manual', p_actor);
    exception when unique_violation then
      return jsonb_build_object('assigned', true, 'idempotent', true);
    end;
    insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
    values (p_tenant, v_actor_label, 'marketing.tag.assigned', 'person', v_person::text,
            'ok', jsonb_build_object('tag_id', v_tag));
    perform marketing_event_append(p_tenant, 'marketing.contact.tag_changed', 'person',
      v_person, 'marketing-contacts',
      jsonb_build_object('k', 'assign:' || v_tag || ':' ||
                              clock_timestamp()::text,
                         'op', 'assigned', 'tag_id', v_tag, 'actor', v_actor_label, 'at', now()));
    return jsonb_build_object('assigned', true);
  else
    delete from contact_tag_assignments
     where tenant_id = p_tenant and person_id = v_person and tag_id = v_tag;
    get diagnostics v_deleted = row_count;
    if v_deleted > 0 then
      insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
      values (p_tenant, v_actor_label, 'marketing.tag.removed', 'person', v_person::text,
              'ok', jsonb_build_object('tag_id', v_tag));
      perform marketing_event_append(p_tenant, 'marketing.contact.tag_changed', 'person',
        v_person, 'marketing-contacts',
        jsonb_build_object('k', 'remove:' || v_tag || ':' ||
                                clock_timestamp()::text,
                           'op', 'removed', 'tag_id', v_tag, 'actor', v_actor_label, 'at', now()));
    end if;
    return jsonb_build_object('removed', v_deleted > 0);
  end if;
end $$;

-- ===========================================================================
-- Owner directory — bounded tenant-scoped list of real assignable users.
-- ===========================================================================
create or replace function marketing_owners_list(p_tenant uuid)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pr.id, 'full_name', pr.full_name, 'email', pr.email, 'role', pr.role)
           order by coalesce(pr.full_name, pr.email)), '[]'::jsonb)
    from (
      select * from profiles
       where tenant_id = p_tenant and role in ('owner', 'admin', 'ops')
       order by coalesce(full_name, email)
       limit 200
    ) pr;
$$;

-- ===========================================================================
-- Grants — all projection/mutation RPCs are SERVICE-ROLE ONLY.
-- ===========================================================================
do $$
declare
  sig text;
begin
  foreach sig in array array[
    'marketing_normalize_endpoint(text, text)',
    'marketing_endpoint_eligibility(uuid, uuid, text, uuid, text, text)',
    'marketing_contact_eligibility(uuid, uuid, text)',
    'marketing_event_append(uuid, text, text, uuid, text, jsonb)',
    'marketing_validate_owner(uuid, uuid)',
    'marketing_contacts_list(uuid, jsonb)',
    'marketing_contacts_counts(uuid)',
    'marketing_contact_detail(uuid, uuid)',
    'marketing_classify_contact(uuid, uuid, uuid, jsonb)',
    'marketing_create_contact(uuid, uuid, jsonb, uuid)',
    'marketing_update_contact(uuid, uuid, uuid, jsonb)',
    'marketing_tag_mutate(uuid, uuid, text, jsonb)',
    'marketing_owners_list(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated;', sig);
    execute format('grant execute on function %s to service_role;', sig);
  end loop;
end $$;
