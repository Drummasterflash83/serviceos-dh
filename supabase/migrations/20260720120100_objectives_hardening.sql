-- ============================================================================
-- Universal Objectives & Outcomes — HARDENING (additive, backwards-compatible)
-- ============================================================================
-- (1) Strategic versioning & approval: published objectives, their targets and
--     constraints are immutable IN PLACE — a strategic change creates a new
--     version that supersedes. AI-created objectives are always draft; AI cannot
--     publish/activate; publishing requires an authorised tenant role or OpenFolk
--     workflow. Measurements and objective-health snapshots stay append-only.
-- (2) Objective-context provenance: a controlled verification-state on each link.
-- Nothing blocks legitimate measurement inserts or derived health snapshots.
-- ============================================================================

-- ── (2) Objective-link verification-state registry + column. ────────────────
create table if not exists objective_verification_states (state text primary key, description text);
insert into objective_verification_states (state, description) values
  ('verified_published','Same-tenant published/active objective'),
  ('approved_link','From an approved objective_links record'),
  ('proposed','Proposed; not yet verified'),
  ('inferred_unverified','AI-inferred or caller-supplied; unverified'),
  ('rejected','Rejected (e.g. cross-tenant)')
on conflict (state) do nothing;

alter table objective_links add column if not exists verification_state text
  references objective_verification_states(state) default 'proposed';

alter table objective_verification_states enable row level security;
drop policy if exists ovs_select on objective_verification_states;
create policy ovs_select on objective_verification_states for select to authenticated using (true);

-- ── (1) Approval provenance columns on objectives. ──────────────────────────
alter table objectives add column if not exists created_by     text;
alter table objectives add column if not exists published_by    text;
alter table objectives add column if not exists published_role  text;

-- ── (1) Strategic guard: AI-draft-only, authorised publishing, published-immutable.
create or replace function objectives_strategic_guard() returns trigger language plpgsql as $$
declare
  ai_sources       text[] := array['approved_ai_proposal','derived'];
  authorised_roles text[] := array['tenant_owner','tenant_admin','openfolk_authorised'];
  authorised       boolean;
begin
  -- coalesce so a NULL published_role is definitively "not authorised" (a NULL
  -- would otherwise make `not authorised` NULL and silently skip the block).
  authorised := coalesce(new.published_role = any(authorised_roles), false)
                and lower(coalesce(new.published_by,'')) not in ('ai','system','');

  if tg_op = 'INSERT' then
    if new.source = any(ai_sources) and new.status is distinct from 'draft' then
      raise exception 'AI-created objectives must start as draft (source=%, status=%)', new.source, new.status
        using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'active' and not authorised then
      raise exception 'publishing an objective requires an authorised tenant role or OpenFolk workflow'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.tenant_id is distinct from new.tenant_id or old.id is distinct from new.id then
    raise exception 'objective tenant/id are immutable' using errcode = 'restrict_violation';
  end if;

  if old.status = 'draft' then
    if new.status = 'active' and not authorised then
      raise exception 'publishing an objective requires an authorised tenant role or OpenFolk workflow'
        using errcode = 'insufficient_privilege';
    end if;
    return new; -- drafts are editable
  end if;

  -- Published: the strategic definition is immutable in place.
  if old.title is distinct from new.title
     or old.description is distinct from new.description
     or old.objective_type is distinct from new.objective_type
     or old.parent_objective_id is distinct from new.parent_objective_id
     or old.priority is distinct from new.priority
     or old.weight is distinct from new.weight
     or old.starts_at is distinct from new.starts_at
     or old.target_at is distinct from new.target_at
     or old.review_cadence is distinct from new.review_cadence
     or old.source is distinct from new.source
     or old.stale_after_hours is distinct from new.stale_after_hours
     or old.domain_pack_keys is distinct from new.domain_pack_keys
     or old.capability_keys is distinct from new.capability_keys
     or old.version_id is distinct from new.version_id then
    raise exception 'published objective % is immutable — create a new version that supersedes it', old.id
      using errcode = 'restrict_violation';
  end if;
  if new.status = 'draft' then
    raise exception 'a published objective cannot return to draft' using errcode = 'restrict_violation';
  end if;
  -- Permitted on a published objective: lifecycle status, ownership, confidence,
  -- supersedes marking, updated_at. (Strategic fields are frozen above.)
  return new;
end;
$$;
drop trigger if exists objectives_strategic_guard on objectives;
create trigger objectives_strategic_guard before insert or update on objectives
  for each row execute function objectives_strategic_guard();

-- ── (1) A published objective's targets/constraints are immutable in place. ─
create or replace function objectives_child_guard() returns trigger language plpgsql as $$
declare parent_status text;
begin
  select status into parent_status from objectives
    where id = coalesce(old.objective_id, new.objective_id);
  if parent_status is not null and parent_status <> 'draft' then
    raise exception 'the target/constraint of a published objective is immutable — create a new objective version'
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists objective_metrics_guard on objective_metrics;
create trigger objective_metrics_guard before update or delete on objective_metrics
  for each row execute function objectives_child_guard();
drop trigger if exists objective_constraints_guard on objective_constraints;
create trigger objective_constraints_guard before update or delete on objective_constraints
  for each row execute function objectives_child_guard();

-- ── (1) A metric with measurements cannot change interpretation in place. ───
create or replace function metric_definitions_guard() returns trigger language plpgsql as $$
begin
  if (old.unit is distinct from new.unit
      or old.currency is distinct from new.currency
      or old.direction is distinct from new.direction
      or old.calculation_method is distinct from new.calculation_method)
     and exists (select 1 from measurements where metric_id = old.id) then
    raise exception 'metric % has measurements — unit/currency/direction/calculation are fixed (define a new metric)', old.key
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists metric_definitions_guard on metric_definitions;
create trigger metric_definitions_guard before update on metric_definitions
  for each row execute function metric_definitions_guard();

-- ── (1) Measurements + health snapshots are append-only facts. ──────────────
create or replace function objectives_append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only (facts are never edited)', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;
drop trigger if exists measurements_no_update on measurements;
create trigger measurements_no_update before update on measurements for each row execute function objectives_append_only();
drop trigger if exists measurements_no_delete on measurements;
create trigger measurements_no_delete before delete on measurements for each row execute function objectives_append_only();
drop trigger if exists objective_health_no_update on objective_health;
create trigger objective_health_no_update before update on objective_health for each row execute function objectives_append_only();
drop trigger if exists objective_health_no_delete on objective_health;
create trigger objective_health_no_delete before delete on objective_health for each row execute function objectives_append_only();
