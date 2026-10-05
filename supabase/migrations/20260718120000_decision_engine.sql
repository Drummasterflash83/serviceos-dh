-- ============================================================================
-- Universal Decision Engine v1 — persistence (additive, backwards-compatible)
-- ============================================================================
-- The Decision Engine is a pure evaluator; this migration only gives its output
-- a home. It EXTENDS decision_log (no new parallel audit table) with the
-- immutable Decision Package + promoted, queryable columns, adds controlled
-- registries for destinations / owner kinds / reason codes (FK-enforced, like
-- object_classes), extends the review queue with the customer/escalate routes,
-- and records decision supersession lineage. Nothing is destructive.
-- ============================================================================

-- ── Controlled registries (validated by FK; extended by INSERT, not by code) ─
create table if not exists decision_destinations (destination text primary key, description text);
insert into decision_destinations (destination, description) values
  ('AUTOMATION_AUTHORISED','Authorised to proceed automatically under policy'),
  ('AUTOMATION_REQUIRES_APPROVAL','Automation intent created, pending approval'),
  ('OPENFOLK_REVIEW','Machine uncertainty — routed to OpenFolk'),
  ('TENANT_SENIOR_REVIEW','Tenant-specific judgement required'),
  ('CUSTOMER_APPROVAL','Customer business authority required'),
  ('WAIT_FOR_EVENT','Blocked on an unmet dependency'),
  ('ESCALATE','Escalated for higher review'),
  ('REJECT','Prohibited by policy — stop'),
  ('NO_ACTION','No useful action required')
on conflict (destination) do nothing;

create table if not exists decision_owner_kinds (kind text primary key, description text);
insert into decision_owner_kinds (kind, description) values
  ('ai','The system finalises'),('automation','The Automation Engine'),
  ('openfolk_user','An OpenFolk operator'),('tenant_user','A named tenant user'),
  ('tenant_role','A tenant role'),('customer','The customer'),
  ('supplier','A supplier'),('external_party','An external party'),('event','A pending event')
on conflict (kind) do nothing;

create table if not exists reason_codes (code text primary key, category text not null, description text);
insert into reason_codes (code, category) values
  ('conflicting_evidence','uncertainty'),('evidence_insufficient','uncertainty'),
  ('confidence_below_threshold','uncertainty'),('ambiguity_too_high','uncertainty'),
  ('missing_policy','uncertainty'),('unfamiliar_pattern','uncertainty'),
  ('incomplete_configuration','configuration'),('missing_authority_policy','configuration'),
  ('missing_automation_policy','configuration'),('missing_risk_policy','configuration'),
  ('authority_currency_mismatch','configuration'),
  ('authority_required','authority'),('outside_delegated_limit','authority'),
  ('within_delegated_authority','authority'),('customer_approval_required','authority'),
  ('tenant_judgement_required','authority'),
  ('risk_exceeds_policy','risk'),('risk_within_policy','risk'),
  ('irreversible_action','risk'),('reversible_within_policy','risk'),
  ('dependency_unmet','lifecycle'),
  ('automation_permitted','automation'),('automation_prohibited','automation'),
  ('automation_authorised','automation'),('confidence_sufficient','automation'),
  ('policy_prohibits_action','terminal'),('no_action_required','terminal')
on conflict (code) do nothing;

-- ── Extend decision_log with the Decision Package (promoted + full jsonb). ───
alter table decision_log add column if not exists decision                 text;
alter table decision_log add column if not exists next_owner_kind          text;
alter table decision_log add column if not exists engine_version           text;
alter table decision_log add column if not exists operating_profile_version text;
alter table decision_log add column if not exists learning_version_ids     text[] not null default '{}';
alter table decision_log add column if not exists reason_codes             text[] not null default '{}';
alter table decision_log add column if not exists correlation_id           uuid;
alter table decision_log add column if not exists output_hash              text;
alter table decision_log add column if not exists supersedes               uuid references decision_log(id);
alter table decision_log add column if not exists decision_package         jsonb;  -- the immutable package, verbatim

-- Validate promoted values against the registries (nullable ⇒ FK-safe for old rows).
alter table decision_log drop constraint if exists decision_log_destination_fk;
alter table decision_log add  constraint decision_log_destination_fk
  foreign key (decision) references decision_destinations(destination);
alter table decision_log drop constraint if exists decision_log_owner_kind_fk;
alter table decision_log add  constraint decision_log_owner_kind_fk
  foreign key (next_owner_kind) references decision_owner_kinds(kind);

create index if not exists decision_log_decision on decision_log (tenant_id, decision, evaluated_at);
create index if not exists decision_log_supersedes on decision_log (supersedes);

-- ── Extend the review queue so the customer/escalate destinations have a home. ─
alter table review_tasks drop constraint if exists review_tasks_route_check;
alter table review_tasks add  constraint review_tasks_route_check
  check (route in ('openfolk','tenant_senior','manual','customer','escalate'));

-- ── RLS for the new registries (non-secret platform metadata). ──────────────
alter table decision_destinations enable row level security;
drop policy if exists dd_select on decision_destinations;
create policy dd_select on decision_destinations for select to authenticated using (true);

alter table decision_owner_kinds enable row level security;
drop policy if exists dok_select on decision_owner_kinds;
create policy dok_select on decision_owner_kinds for select to authenticated using (true);

alter table reason_codes enable row level security;
drop policy if exists rc_select on reason_codes;
create policy rc_select on reason_codes for select to authenticated using (true);
