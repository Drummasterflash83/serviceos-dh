-- ============================================================================
-- Universal Decision Engine v1 — HARDENING (additive, backwards-compatible)
-- ============================================================================
-- (a) Enforce DATABASE immutability for the Decision Package: decision_log is
--     append-only. A decision is never edited; it is superseded by a new row.
--     deepFreeze() protects the in-memory object; this protects the record even
--     against the service role. Reviews/outcomes/corrections live in SEPARATE
--     tables and progress through their own lifecycles, untouched.
-- (b) Seed the platform baseline for the decision-critical thresholds the engine
--     requires, so the fail-safe (missing config → OPENFOLK_REVIEW) fires only on
--     a GENUINE omission — never on the platform defaults. Note we deliberately do
--     NOT seed `authority.delegated_limit`: financial authority must be configured
--     explicitly per tenant, so an unconfigured spend fails safe to review.
-- ============================================================================

-- ── (a) decision_log is append-only (UPDATE and DELETE rejected). ───────────
create or replace function decision_log_reject_mutation()
  returns trigger language plpgsql as $$
begin
  raise exception
    'decision_log is append-only: decision % is immutable — supersede it with a new decision instead',
    coalesce(old.id::text, '?')
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists decision_log_no_update on decision_log;
create trigger decision_log_no_update before update on decision_log
  for each row execute function decision_log_reject_mutation();

drop trigger if exists decision_log_no_delete on decision_log;
create trigger decision_log_no_delete before delete on decision_log
  for each row execute function decision_log_reject_mutation();

-- Defense in depth: no role may UPDATE/DELETE (RLS already blocks tenants; the
-- trigger blocks the service role, which bypasses RLS).
revoke update, delete on decision_log from anon, authenticated;

-- ── (b) platform baseline for the engine's decision-critical config. ────────
-- References the existing platform operating-profile version (20260716120600).
insert into operating_profile_entries
  (tenant_id, scope_kind, scope_ref, domain, namespace, key, value, version_id)
values
  (null,'platform',null,null,'confidence','evidence_floor','0.3'::jsonb,'10000000-0000-0000-0000-000000000002'),
  (null,'platform',null,null,'risk','high_min','0.6'::jsonb,'10000000-0000-0000-0000-000000000002'),
  (null,'platform',null,null,'risk','critical_min','0.85'::jsonb,'10000000-0000-0000-0000-000000000002'),
  (null,'platform',null,null,'risk','auto_max_score','0.6'::jsonb,'10000000-0000-0000-0000-000000000002'),
  (null,'platform',null,null,'reversibility','irreversible_max','0.3'::jsonb,'10000000-0000-0000-0000-000000000002'),
  (null,'platform',null,null,'reversibility','partial_max','0.7'::jsonb,'10000000-0000-0000-0000-000000000002'),
  (null,'platform',null,null,'escalation','senior_role','"manager"'::jsonb,'10000000-0000-0000-0000-000000000002')
on conflict do nothing;
