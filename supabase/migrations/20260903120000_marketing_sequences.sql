-- ============================================================================
-- MARKETING PHASE 6 — Governed Sequences: ordered multi-step journeys.
-- ADDITIVE, RUN-ONCE. Nothing here edits a committed migration; the frozen
-- Automation Engine is untouched. Phase-5 functions that must learn about
-- sequences (the delivery guard/reconciler, the campaign guard) are REPLACED
-- here with SUPERSETS — every Broadcast invariant is preserved verbatim and
-- re-proven by the unchanged Phase-5 suites.
--
-- ONE campaign identity. A sequence IS a marketing_campaigns row with
-- campaign_type = 'sequence' (a vocabulary the Phase-1 foundation already
-- allows). Nothing below duplicates campaign identity, name, description,
-- owner, status, sender, segment, objective or lifecycle timestamps; the new
-- tables EXTEND that campaign:
--
--  - SEQUENCE REVISIONS (marketing_sequence_revisions): the immutable
--    authored journey — sender, tenant-local timezone + quiet-hour policy,
--    entry/re-enrolment policy, exit rules, step count and a content hash
--    over the WHOLE bundle (revision + every step). Editing an approved
--    sequence creates a NEW revision and returns the campaign to draft;
--    EXISTING ENROLMENTS STAY PINNED to the revision they entered on and are
--    never silently migrated.
--  - SEQUENCE STEPS (marketing_sequence_steps): immutable ordered steps with
--    a stable key, a validated type-specific configuration, a deterministic
--    config hash and a human-readable summary. No executable code, no
--    unvalidated template expressions.
--  - APPROVALS (marketing_sequence_approvals): append-only, binding the exact
--    campaign version, revision, bundle hash, sender, exit policy and the
--    owner/admin approver under canonical marketing.campaigns.launch.
--  - ENROLMENT BATCHES + CANDIDATES (marketing_enrolment_batches /
--    marketing_enrolment_candidates): the IMMUTABLE enrolment audience. Every
--    candidate gets a row — enrolled or excluded with exact reason codes —
--    exactly like a Phase-5 audience snapshot.
--  - ENROLMENTS (marketing_sequence_enrolments): PERSON-based (never an email
--    string), pinned to a revision AND a contact point, with current step,
--    next-eligible instant, generation, deterministic dedup key and
--    append-only exit facts. A later change to the Person's primary endpoint
--    never silently moves a live enrolment to another address.
--  - EXECUTIONS (marketing_sequence_executions): the append-only per
--    (enrolment, step, generation) evidence record. At most ONE active
--    logical execution can exist for that tuple — enforced by a partial
--    unique index, not by convention.
--  - CONFIRMATIONS (marketing_sequence_confirmations): short-lived, ONE-USE,
--    digest-only challenges binding tenant, campaign, version, revision,
--    actor and (for enrolment) the exact batch. Superseded by any relevant
--    change.
--
--  - AUTOMATION REGISTRATION: every side effect a sequence performs is a
--    REGISTERED capability executed through the untouched engine.
--      * send_marketing_sequence_email on the EXISTING email.send_marketing
--        capability — external, high risk, requires_approval TRUE, with a
--        genuine append-only tenant_senior approval naming the owner/admin
--        who approved the sequence (the Phase-5 model, narrowed to a step).
--      * marketing.contact_action (NEW, internal, external_side_effect FALSE)
--        with five intent types: marketing_apply_tag, marketing_remove_tag,
--        marketing_change_lifecycle, marketing_assign_owner and
--        marketing_create_follow_up. requires_approval FALSE is the HONEST
--        model: these are internal tenant-data changes explicitly authorised
--        by the owner/admin sequence approval recorded on the revision — no
--        tenant-senior approval row exists for them and none is fabricated.
--
-- Honest limitations recorded deliberately:
--  * A follow-up step creates a REAL canonical work item on the platform's
--    own spine (intelligence_objects, object_class 'action', plus its
--    append-only object_state_history seed) — the same rows the Command
--    Centre work projection reads. It is NOT a Marketing-only task table.
--    Platform gap, pre-existing and NOT introduced here: the platform seeds
--    state_definitions/state_transitions for ('serviceos'|'productos','Action')
--    but NOT for ('core','Action'), so work-transition cannot yet move ANY
--    core Action — including the 46 already created by Phase 4/5. Creating
--    the work item is genuine; its downstream transition depends on that
--    platform seed, which is out of scope for a Marketing migration.
--  * "submitted" still means GMAIL ACCEPTED THE REQUEST — never "delivered".
--    Delivered/opened/clicked/bounced remain unavailable (null, never zero).
--  * A hard bounce is only ever recorded from real canonical evidence. This
--    pipeline receives none today, so bounce exits stay unproven rather than
--    invented.
--  * Event-triggered enrolment is NOT installed. No second event engine, no
--    hidden poller. The entry policy vocabulary reserves it and the surface
--    states it honestly as Preview.
--
-- Rollback (dev only): drop the Phase-6 tables/functions in reverse
-- dependency order; restore the Phase-5 definitions of
-- marketing_campaign_guard / marketing_delivery_guard /
-- marketing_delivery_reconcile / serviceos_schedule_defs from
-- 20260902120000; then
--   alter table marketing_deliveries drop column ... (sequence columns);
--   delete from automation_intent_types where intent_type in (...);
-- ============================================================================

-- ── Composite keys so every Phase-6 reference is STRUCTURALLY tenant-bound ──
create unique index if not exists marketing_sender_profiles_tenant_id_uk
  on marketing_sender_profiles (tenant_id, id);
create unique index if not exists marketing_tags_tenant_id_uk
  on marketing_tags (tenant_id, id);
create unique index if not exists companies_tenant_id_uk
  on companies (tenant_id, id);

-- ── Tenant guardrail: bounded enrolment batches (server-enforced) ───────────
alter table marketing_settings
  add column if not exists max_sequence_enrolments int not null default 500;
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'marketing_settings_max_sequence_enrolments_check') then
    alter table marketing_settings add constraint marketing_settings_max_sequence_enrolments_check
      check (max_sequence_enrolments between 1 and 10000);
  end if;
end $$;

-- ============================================================================
-- SEQUENCE REVISIONS — the immutable authored journey
-- ============================================================================
create table marketing_sequence_revisions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  campaign_id         uuid not null,
  revision_number     int not null check (revision_number >= 1),
  sender_profile_id   uuid not null,
  timezone            text not null,
  quiet_hours_start   int check (quiet_hours_start is null or quiet_hours_start between 0 and 23),
  quiet_hours_end     int check (quiet_hours_end is null or quiet_hours_end between 0 and 23),
  -- how People may enter. 'event' is RESERVED vocabulary only: no event
  -- subscriber is installed by this phase and none is implied.
  entry_policy        text not null default 'manual_or_segment'
                        check (entry_policy in ('manual_or_segment', 'manual_only', 'segment_only')),
  -- may a Person who already completed/exited enter again?
  reenrolment_policy  text not null default 'never'
                        check (reenrolment_policy in ('never', 'after_exit', 'always')),
  -- exit rules are DATA, validated on write (see marketing_sequence_validate_exit_rules)
  exit_rules          jsonb not null default '{}'::jsonb,
  -- what a policy-blocked email step does: exit the enrolment or skip the step
  policy_block_action text not null default 'exit'
                        check (policy_block_action in ('exit', 'skip_step')),
  step_count          int not null check (step_count between 1 and 40),
  bundle_hash         text not null check (bundle_hash ~ '^[0-9a-f]{64}$'),
  tokens_required     text[] not null default '{}',
  source              text not null default 'editor' check (source in ('editor', 'duplicate')),
  created_by          uuid,
  created_at          timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, campaign_id, revision_number),
  constraint msr_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade,
  constraint msr_sender_fk foreign key (tenant_id, sender_profile_id)
    references marketing_sender_profiles (tenant_id, id),
  constraint msr_created_by_fk foreign key (tenant_id, created_by)
    references profiles (tenant_id, id) on delete set null (created_by)
);
create index marketing_sequence_revisions_idx
  on marketing_sequence_revisions (tenant_id, campaign_id, revision_number desc);
create trigger marketing_sequence_revisions_append_only_update
  before update on marketing_sequence_revisions
  for each row execute function marketing_history_append_only();
alter table marketing_sequence_revisions enable row level security;
create policy marketing_sequence_revisions_select on marketing_sequence_revisions
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_sequence_revisions to authenticated;
grant select, insert on marketing_sequence_revisions to service_role;
revoke update, delete, truncate on marketing_sequence_revisions
  from anon, authenticated, service_role;

-- campaign → current sequence revision (additive column on the ONE campaign)
alter table marketing_campaigns
  add column if not exists current_sequence_revision_id uuid,
  add column if not exists sequence_closed_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mc_current_sequence_revision_fk') then
    alter table marketing_campaigns add constraint mc_current_sequence_revision_fk
      foreign key (tenant_id, current_sequence_revision_id)
      references marketing_sequence_revisions (tenant_id, id)
      on delete set null (current_sequence_revision_id);
  end if;
end $$;

-- ============================================================================
-- SEQUENCE STEPS — immutable, ordered, validated configuration
-- ============================================================================
create table marketing_sequence_steps (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id) on delete cascade,
  revision_id   uuid not null,
  campaign_id   uuid not null,
  step_order    int not null check (step_order >= 1),
  step_key      text not null check (step_key ~ '^[a-z0-9_-]{1,40}$'),
  step_type     text not null
                  check (step_type in ('send_email', 'wait_duration', 'wait_until_window',
                                       'apply_tag', 'remove_tag', 'change_lifecycle',
                                       'assign_owner', 'create_follow_up')),
  config        jsonb not null default '{}'::jsonb,
  config_hash   text not null check (config_hash ~ '^[0-9a-f]{64}$'),
  summary       text not null check (length(summary) between 1 and 300),
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, revision_id, step_order),
  unique (tenant_id, revision_id, step_key),
  constraint mss_revision_fk foreign key (tenant_id, revision_id)
    references marketing_sequence_revisions (tenant_id, id) on delete cascade,
  constraint mss_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade
);
create index marketing_sequence_steps_idx
  on marketing_sequence_steps (tenant_id, revision_id, step_order);
create trigger marketing_sequence_steps_append_only_update
  before update on marketing_sequence_steps
  for each row execute function marketing_history_append_only();
alter table marketing_sequence_steps enable row level security;
create policy marketing_sequence_steps_select on marketing_sequence_steps
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_sequence_steps to authenticated;
grant select, insert on marketing_sequence_steps to service_role;
revoke update, delete, truncate on marketing_sequence_steps
  from anon, authenticated, service_role;

-- ============================================================================
-- SEQUENCE APPROVALS — append-only, binding the exact immutable bundle
-- ============================================================================
create table marketing_sequence_approvals (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  campaign_id         uuid not null,
  campaign_version    int not null,
  revision_id         uuid not null,
  bundle_hash         text not null check (bundle_hash ~ '^[0-9a-f]{64}$'),
  sender_profile_id   uuid not null,
  approver_profile_id uuid,
  authority_basis     text not null default 'marketing.campaigns.launch',
  decision            text not null check (decision in ('approved', 'changes_requested')),
  note                text check (note is null or length(note) <= 500),
  correlation_id      uuid not null default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  unique (tenant_id, id),
  constraint msa_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade,
  constraint msa_revision_fk foreign key (tenant_id, revision_id)
    references marketing_sequence_revisions (tenant_id, id),
  constraint msa_sender_fk foreign key (tenant_id, sender_profile_id)
    references marketing_sender_profiles (tenant_id, id),
  constraint msa_approver_fk foreign key (tenant_id, approver_profile_id)
    references profiles (tenant_id, id) on delete set null (approver_profile_id)
);
create index marketing_sequence_approvals_idx
  on marketing_sequence_approvals (tenant_id, campaign_id, created_at desc);
create trigger marketing_sequence_approvals_append_only_update
  before update on marketing_sequence_approvals
  for each row execute function marketing_history_append_only();
alter table marketing_sequence_approvals enable row level security;
create policy marketing_sequence_approvals_select on marketing_sequence_approvals
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_sequence_approvals to authenticated;
grant select, insert on marketing_sequence_approvals to service_role;
revoke update, delete, truncate on marketing_sequence_approvals
  from anon, authenticated, service_role;

-- ============================================================================
-- ENROLMENT BATCHES + CANDIDATES — the immutable enrolment audience
-- ============================================================================
create table marketing_enrolment_batches (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  campaign_id         uuid not null,
  revision_id         uuid not null,
  source              text not null check (source in ('manual', 'segment')),
  segment_id          uuid,
  segment_version     int,
  segment_hash        text check (segment_hash is null or segment_hash ~ '^[0-9a-f]{64}$'),
  candidate_count     int not null check (candidate_count >= 0),
  eligible_count      int not null check (eligible_count >= 0),
  excluded_count      int not null check (excluded_count >= 0),
  exclusion_breakdown jsonb not null default '{}'::jsonb,
  batch_hash          text not null check (batch_hash ~ '^[0-9a-f]{64}$'),
  created_by          uuid,
  created_at          timestamptz not null default now(),
  confirmed_at        timestamptz,
  enrolled_count      int,
  unique (tenant_id, id),
  constraint meb_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade,
  constraint meb_revision_fk foreign key (tenant_id, revision_id)
    references marketing_sequence_revisions (tenant_id, id),
  constraint meb_segment_fk foreign key (tenant_id, segment_id)
    references marketing_segments (tenant_id, id),
  constraint meb_created_by_fk foreign key (tenant_id, created_by)
    references profiles (tenant_id, id) on delete set null (created_by),
  constraint meb_segment_shape check (
    (source = 'segment' and segment_id is not null and segment_version is not null)
    or (source = 'manual' and segment_id is null))
);
create index marketing_enrolment_batches_idx
  on marketing_enrolment_batches (tenant_id, campaign_id, created_at desc);

-- a batch is immutable except the single legal confirmation stamp
create or replace function marketing_enrolment_batch_guard()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.campaign_id is distinct from old.campaign_id
     or new.revision_id is distinct from old.revision_id
     or new.source is distinct from old.source
     or new.segment_id is distinct from old.segment_id
     or new.segment_version is distinct from old.segment_version
     or new.segment_hash is distinct from old.segment_hash
     or new.candidate_count is distinct from old.candidate_count
     or new.eligible_count is distinct from old.eligible_count
     or new.excluded_count is distinct from old.excluded_count
     or new.exclusion_breakdown is distinct from old.exclusion_breakdown
     or new.batch_hash is distinct from old.batch_hash
     or new.created_at is distinct from old.created_at then
    raise exception 'an enrolment batch is immutable';
  end if;
  if old.confirmed_at is not null then
    raise exception 'an enrolment batch is confirmed exactly once';
  end if;
  return new;
end $$;
create trigger marketing_enrolment_batches_guard
  before update on marketing_enrolment_batches
  for each row execute function marketing_enrolment_batch_guard();
-- the batch header is evidence for the same reason its candidate rows are
create trigger marketing_enrolment_batches_append_only_delete
  before delete on marketing_enrolment_batches
  for each row execute function marketing_history_append_only();
alter table marketing_enrolment_batches enable row level security;
create policy marketing_enrolment_batches_select on marketing_enrolment_batches
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_enrolment_batches to authenticated;
grant select, insert, update on marketing_enrolment_batches to service_role;
revoke delete, truncate on marketing_enrolment_batches
  from anon, authenticated, service_role;

create table marketing_enrolment_candidates (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants (id) on delete cascade,
  batch_id          uuid not null,
  campaign_id       uuid not null,
  person_id         uuid not null,
  contact_point_id  uuid,
  destination       text,
  eligible          boolean not null,
  exclusion_reasons text[] not null default '{}',
  eligibility_state text not null,
  personalisation   jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, batch_id, person_id),
  constraint mec_batch_fk foreign key (tenant_id, batch_id)
    references marketing_enrolment_batches (tenant_id, id) on delete cascade,
  constraint mec_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade,
  constraint mec_person_fk foreign key (tenant_id, person_id)
    references people (tenant_id, id) on delete cascade,
  constraint mec_point_fk foreign key (tenant_id, contact_point_id)
    references contact_points (tenant_id, id) on delete set null (contact_point_id),
  -- an INCLUDED candidate carries no exclusion reasons; the endpoint is
  -- required only for a sending journey (enforced in preflight + the enrolment
  -- guard, which can see the revision a CHECK constraint cannot)
  constraint mec_shape check (
    (eligible and exclusion_reasons = '{}')
    or (not eligible and array_length(exclusion_reasons, 1) >= 1))
);
create index marketing_enrolment_candidates_idx
  on marketing_enrolment_candidates (tenant_id, batch_id, eligible);
create trigger marketing_enrolment_candidates_append_only_update
  before update on marketing_enrolment_candidates
  for each row execute function marketing_history_append_only();
-- DELETE is guarded too, not only UPDATE: this ledger is the evidence of WHO
-- was enrolled and exactly WHY each excluded Person was excluded. A record that
-- can be erased is not evidence, so it follows marketing_delivery_events rather
-- than the weaker update-only pattern.
create trigger marketing_enrolment_candidates_append_only_delete
  before delete on marketing_enrolment_candidates
  for each row execute function marketing_history_append_only();
alter table marketing_enrolment_candidates enable row level security;
create policy marketing_enrolment_candidates_select on marketing_enrolment_candidates
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_enrolment_candidates to authenticated;
grant select, insert on marketing_enrolment_candidates to service_role;
revoke update, delete, truncate on marketing_enrolment_candidates
  from anon, authenticated, service_role;

-- ============================================================================
-- ENROLMENTS — Person-based, revision-pinned, endpoint-pinned
-- ============================================================================
create table marketing_sequence_enrolments (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants (id) on delete cascade,
  campaign_id        uuid not null,
  revision_id        uuid not null,          -- PINNED: never silently migrated
  batch_id           uuid,
  person_id          uuid not null,
  company_id         uuid,
  -- PINNED endpoint for this enrolment. Required only when the pinned revision
  -- actually sends email — an internal-only journey (tag/lifecycle/owner/
  -- follow-up) must be able to enrol a Person who has no usable email
  -- endpoint. The guard below enforces exactly that.
  contact_point_id   uuid,
  destination        text,
  personalisation    jsonb not null default '{}'::jsonb,
  source             text not null check (source in ('manual', 'segment')),
  source_evidence    jsonb not null default '{}'::jsonb,
  enrolled_by        uuid,
  status             text not null default 'active'
                       check (status in ('active', 'paused', 'completed', 'exited', 'held')),
  current_step_order int not null default 1 check (current_step_order >= 1),
  generation         int not null default 1 check (generation >= 1),
  next_eligible_at   timestamptz,
  hold_reason        text check (hold_reason is null or length(hold_reason) <= 160),
  exit_reason        text check (exit_reason is null or exit_reason in
                       ('unsubscribed', 'hard_suppression', 'hard_bounce', 'replied',
                        'lifecycle_outcome', 'manual_removal', 'campaign_cancelled',
                        'policy_blocked', 'endpoint_invalid', 'completed_all_steps',
                        'configuration_failure')),
  exit_evidence      jsonb,
  dedup_key          text not null,
  entered_at         timestamptz not null default now(),
  paused_at          timestamptz,
  resumed_at         timestamptz,
  completed_at       timestamptz,
  exited_at          timestamptz,
  last_execution_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, dedup_key),
  constraint mse_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade,
  constraint mse_revision_fk foreign key (tenant_id, revision_id)
    references marketing_sequence_revisions (tenant_id, id),
  constraint mse_batch_fk foreign key (tenant_id, batch_id)
    references marketing_enrolment_batches (tenant_id, id) on delete set null (batch_id),
  constraint mse_person_fk foreign key (tenant_id, person_id)
    references people (tenant_id, id) on delete cascade,
  constraint mse_company_fk foreign key (tenant_id, company_id)
    references companies (tenant_id, id) on delete set null (company_id),
  constraint mse_point_fk foreign key (tenant_id, contact_point_id)
    references contact_points (tenant_id, id),
  constraint mse_enrolled_by_fk foreign key (tenant_id, enrolled_by)
    references profiles (tenant_id, id) on delete set null (enrolled_by)
);
create index marketing_sequence_enrolments_due_idx
  on marketing_sequence_enrolments (tenant_id, status, next_eligible_at);
create index marketing_sequence_enrolments_campaign_idx
  on marketing_sequence_enrolments (tenant_id, campaign_id, status);
create index marketing_sequence_enrolments_person_idx
  on marketing_sequence_enrolments (tenant_id, person_id);
create trigger marketing_sequence_enrolments_set_updated_at
  before update on marketing_sequence_enrolments
  for each row execute function set_updated_at();

-- FACTUAL enrolment guard: pinned lineage, legal machine, terminal truth —
-- for EVERY caller including the service role.
create or replace function marketing_sequence_enrolment_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' then
      raise exception 'an enrolment must be created active — % is not a creatable state',
        new.status;
    end if;
    if new.exit_reason is not null or new.exited_at is not null
       or new.completed_at is not null or new.paused_at is not null then
      raise exception 'a new enrolment cannot carry lifecycle facts';
    end if;
    -- a SENDING revision must have a pinned endpoint; a non-sending one must not
    -- be forced to invent one
    if exists (select 1 from marketing_sequence_steps s
                where s.tenant_id = new.tenant_id and s.revision_id = new.revision_id
                  and s.step_type = 'send_email') then
      if new.contact_point_id is null or new.destination is null then
        raise exception 'a sequence that sends email requires a pinned email endpoint';
      end if;
    end if;
    -- whenever an endpoint IS pinned it must belong to the enrolled Person
    if new.contact_point_id is not null
       and not exists (select 1 from contact_points cp
                        where cp.id = new.contact_point_id and cp.tenant_id = new.tenant_id
                          and cp.person_id = new.person_id and cp.channel = 'email') then
      raise exception 'the pinned contact point must be an email endpoint of this Person';
    end if;
    -- the pinned revision must belong to the same campaign
    if not exists (select 1 from marketing_sequence_revisions r
                    where r.id = new.revision_id and r.tenant_id = new.tenant_id
                      and r.campaign_id = new.campaign_id) then
      raise exception 'the pinned revision must belong to this campaign';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.campaign_id is distinct from old.campaign_id
     or new.revision_id is distinct from old.revision_id
     or new.person_id is distinct from old.person_id
     or new.contact_point_id is distinct from old.contact_point_id
     or new.destination is distinct from old.destination
     or new.dedup_key is distinct from old.dedup_key
     or new.entered_at is distinct from old.entered_at
     or new.created_at is distinct from old.created_at
     or new.generation is distinct from old.generation then
    raise exception 'enrolment identity, its pinned revision and its pinned endpoint are immutable';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'active'    and new.status in ('paused', 'held', 'completed', 'exited'))
         or (old.status = 'paused'    and new.status in ('active', 'exited'))
         or (old.status = 'held'      and new.status in ('active', 'exited'))) then
      raise exception 'illegal enrolment transition % -> %', old.status, new.status;
    end if;
    if new.status = 'exited' and new.exit_reason is null then
      raise exception 'an exited enrolment requires its exact exit reason';
    end if;
    if new.status = 'held' and new.hold_reason is null then
      raise exception 'a held enrolment requires its hold reason';
    end if;
  else
    if new.exit_reason is distinct from old.exit_reason
       or new.exited_at is distinct from old.exited_at
       or new.completed_at is distinct from old.completed_at then
      raise exception 'enrolment lifecycle facts may only change through their factual transition';
    end if;
  end if;
  -- terminal states are terminal
  if old.status in ('completed', 'exited') and new.status is distinct from old.status then
    raise exception 'a % enrolment is terminal', old.status;
  end if;
  -- the step pointer only moves FORWARD
  if new.current_step_order < old.current_step_order then
    raise exception 'an enrolment never moves backwards through its steps';
  end if;
  return new;
end $$;
create trigger marketing_sequence_enrolments_guard
  before insert or update on marketing_sequence_enrolments
  for each row execute function marketing_sequence_enrolment_guard();
alter table marketing_sequence_enrolments enable row level security;
create policy marketing_sequence_enrolments_select on marketing_sequence_enrolments
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_sequence_enrolments to authenticated;
grant select, insert, update on marketing_sequence_enrolments to service_role;
revoke delete, truncate on marketing_sequence_enrolments
  from anon, authenticated, service_role;

-- ============================================================================
-- EXECUTIONS — append-only per-(enrolment, step, generation) evidence
-- ============================================================================
create table marketing_sequence_executions (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id) on delete cascade,
  enrolment_id         uuid not null,
  campaign_id          uuid not null,
  revision_id          uuid not null,
  step_id              uuid not null,
  step_order           int not null check (step_order >= 1),
  step_type            text not null,
  generation           int not null default 1 check (generation >= 1),
  status               text not null default 'pending'
                         check (status in ('pending', 'preparing', 'queued', 'executing',
                                           'succeeded', 'skipped', 'failed', 'unknown',
                                           'cancelled')),
  lease_worker         text,
  lease_expires_at     timestamptz,
  scheduled_for        timestamptz,
  delivery_id          uuid,
  automation_intent_id uuid,
  skip_reason          text check (skip_reason is null or length(skip_reason) <= 120),
  failure_class        text check (failure_class is null or length(failure_class) <= 120),
  evidence             jsonb not null default '{}'::jsonb,
  started_at           timestamptz,
  finished_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  constraint msx_enrolment_fk foreign key (tenant_id, enrolment_id)
    references marketing_sequence_enrolments (tenant_id, id) on delete cascade,
  constraint msx_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade,
  constraint msx_revision_fk foreign key (tenant_id, revision_id)
    references marketing_sequence_revisions (tenant_id, id),
  constraint msx_step_fk foreign key (tenant_id, step_id)
    references marketing_sequence_steps (tenant_id, id),
  constraint msx_intent_fk foreign key (tenant_id, automation_intent_id)
    references automation_intents (tenant_id, id) on delete set null (automation_intent_id)
);
-- AT MOST ONE active logical execution per (tenant, enrolment, revision, step,
-- generation) — a structural guarantee, not a convention.
create unique index marketing_sequence_executions_active_uk
  on marketing_sequence_executions (tenant_id, enrolment_id, revision_id, step_id, generation);
create index marketing_sequence_executions_enrolment_idx
  on marketing_sequence_executions (tenant_id, enrolment_id, step_order);
create index marketing_sequence_executions_claim_idx
  on marketing_sequence_executions (tenant_id, status, scheduled_for);
create trigger marketing_sequence_executions_set_updated_at
  before update on marketing_sequence_executions
  for each row execute function set_updated_at();

create or replace function marketing_sequence_execution_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'an execution must be created pending — % is not a creatable state',
        new.status;
    end if;
    if new.delivery_id is not null or new.automation_intent_id is not null
       or new.skip_reason is not null or new.failure_class is not null
       or new.started_at is not null or new.finished_at is not null then
      raise exception 'a new execution cannot carry work facts';
    end if;
    -- it must mirror a real step of the enrolment's PINNED revision
    if not exists (select 1 from marketing_sequence_steps s
                    where s.id = new.step_id and s.tenant_id = new.tenant_id
                      and s.revision_id = new.revision_id
                      and s.step_order = new.step_order
                      and s.step_type = new.step_type) then
      raise exception 'an execution must mirror a step of its pinned revision';
    end if;
    if not exists (select 1 from marketing_sequence_enrolments e
                    where e.id = new.enrolment_id and e.tenant_id = new.tenant_id
                      and e.revision_id = new.revision_id
                      and e.campaign_id = new.campaign_id) then
      raise exception 'an execution must belong to an enrolment on the same pinned revision';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.enrolment_id is distinct from old.enrolment_id
     or new.campaign_id is distinct from old.campaign_id
     or new.revision_id is distinct from old.revision_id
     or new.step_id is distinct from old.step_id
     or new.step_order is distinct from old.step_order
     or new.step_type is distinct from old.step_type
     or new.generation is distinct from old.generation
     or new.created_at is distinct from old.created_at then
    raise exception 'execution identity and lineage are immutable';
  end if;
  if old.delivery_id is not null and new.delivery_id is distinct from old.delivery_id then
    raise exception 'a recorded execution delivery is immutable';
  end if;
  if old.automation_intent_id is not null
     and new.automation_intent_id is distinct from old.automation_intent_id then
    raise exception 'a recorded execution intent is immutable';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'pending'   and new.status in ('preparing', 'skipped', 'cancelled'))
         or (old.status = 'preparing' and new.status in ('pending', 'queued', 'succeeded',
                                                         'skipped', 'failed', 'cancelled'))
         or (old.status = 'queued'    and new.status in ('executing', 'succeeded', 'skipped',
                                                         'failed', 'unknown', 'cancelled'))
         or (old.status = 'executing' and new.status in ('queued', 'succeeded', 'skipped',
                                                         'failed', 'unknown'))
         or (old.status = 'unknown'   and new.status in ('succeeded', 'failed'))) then
      raise exception 'illegal execution transition % -> %', old.status, new.status;
    end if;
    if new.status = 'skipped' and new.skip_reason is null then
      raise exception 'a skipped execution requires its skip reason';
    end if;
    if new.status = 'failed' and new.failure_class is null then
      raise exception 'a failed execution requires its failure classification';
    end if;
  else
    if new.skip_reason is distinct from old.skip_reason
       or new.failure_class is distinct from old.failure_class
       or new.finished_at is distinct from old.finished_at then
      raise exception 'execution facts may only change through a factual status transition';
    end if;
  end if;
  return new;
end $$;
create trigger marketing_sequence_executions_guard
  before insert or update on marketing_sequence_executions
  for each row execute function marketing_sequence_execution_guard();
alter table marketing_sequence_executions enable row level security;
create policy marketing_sequence_executions_select on marketing_sequence_executions
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_sequence_executions to authenticated;
grant select, insert, update on marketing_sequence_executions to service_role;
revoke delete, truncate on marketing_sequence_executions
  from anon, authenticated, service_role;

-- ============================================================================
-- CONFIRMATIONS — short-lived, one-use, digest-only
-- ============================================================================
create table marketing_sequence_confirmations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants (id) on delete cascade,
  campaign_id        uuid not null,
  campaign_version   int not null,
  revision_id        uuid not null,
  purpose            text not null check (purpose in ('activate', 'enrol')),
  batch_id           uuid,
  bundle_hash        text not null,
  actor_profile_id   uuid,
  challenge_digest   text not null check (challenge_digest ~ '^[0-9a-f]{64}$'),
  request_id         text check (request_id is null or request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  request_fingerprint text check (request_fingerprint is null
                                  or request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  used_at            timestamptz,
  superseded_at      timestamptz,
  unique (tenant_id, id),
  constraint msc_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade,
  constraint msc_revision_fk foreign key (tenant_id, revision_id)
    references marketing_sequence_revisions (tenant_id, id),
  constraint msc_batch_fk foreign key (tenant_id, batch_id)
    references marketing_enrolment_batches (tenant_id, id) on delete cascade,
  constraint msc_actor_fk foreign key (tenant_id, actor_profile_id)
    references profiles (tenant_id, id) on delete set null (actor_profile_id),
  constraint msc_purpose_shape check (
    (purpose = 'enrol' and batch_id is not null) or purpose = 'activate')
);
create index marketing_sequence_confirmations_idx
  on marketing_sequence_confirmations (tenant_id, campaign_id, created_at desc);
create unique index marketing_sequence_confirmations_request_uk
  on marketing_sequence_confirmations (tenant_id, request_id)
  where request_id is not null;

create or replace function marketing_sequence_confirmation_guard()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.campaign_id is distinct from old.campaign_id
     or new.campaign_version is distinct from old.campaign_version
     or new.revision_id is distinct from old.revision_id
     or new.purpose is distinct from old.purpose
     or new.batch_id is distinct from old.batch_id
     or new.bundle_hash is distinct from old.bundle_hash
     or (new.actor_profile_id is distinct from old.actor_profile_id
         and not (new.actor_profile_id is null and old.actor_profile_id is not null))
     or new.challenge_digest is distinct from old.challenge_digest
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'a sequence confirmation is immutable';
  end if;
  if old.used_at is not null then
    raise exception 'a sequence confirmation is single-use';
  end if;
  if old.superseded_at is not null then
    raise exception 'a superseded confirmation can never change again';
  end if;
  if new.superseded_at is not null then
    if new.used_at is not null
       or new.request_id is distinct from old.request_id
       or new.request_fingerprint is distinct from old.request_fingerprint then
      raise exception 'supersession records nothing but the supersession';
    end if;
    return new;
  end if;
  if new.used_at is null
     and (new.request_id is distinct from old.request_id
          or new.request_fingerprint is distinct from old.request_fingerprint) then
    raise exception 'request facts are recorded only by the single legal use';
  end if;
  return new;
end $$;
create trigger marketing_sequence_confirmations_guard
  before update on marketing_sequence_confirmations
  for each row execute function marketing_sequence_confirmation_guard();
alter table marketing_sequence_confirmations enable row level security;
-- challenge digests are NEVER client-readable (the proven Phase-3/5 pattern)
grant select, insert, update on marketing_sequence_confirmations to service_role;
revoke select on marketing_sequence_confirmations from anon, authenticated;
revoke delete, truncate on marketing_sequence_confirmations
  from anon, authenticated, service_role;

-- ============================================================================
-- DELIVERIES — sequence provenance (additive) + vocabulary
-- ============================================================================
alter table marketing_deliveries
  add column if not exists sequence_enrolment_id uuid,
  add column if not exists sequence_execution_id uuid,
  add column if not exists sequence_step_id      uuid,
  add column if not exists sequence_revision_id  uuid;

alter table marketing_deliveries drop constraint marketing_deliveries_purpose_check;
alter table marketing_deliveries add constraint marketing_deliveries_purpose_check
  check (purpose in ('test', 'broadcast', 'sequence'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'md_seq_enrolment_fk') then
    alter table marketing_deliveries add constraint md_seq_enrolment_fk
      foreign key (tenant_id, sequence_enrolment_id)
      references marketing_sequence_enrolments (tenant_id, id)
      on delete set null (sequence_enrolment_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'md_seq_execution_fk') then
    alter table marketing_deliveries add constraint md_seq_execution_fk
      foreign key (tenant_id, sequence_execution_id)
      references marketing_sequence_executions (tenant_id, id)
      on delete set null (sequence_execution_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'md_seq_step_fk') then
    alter table marketing_deliveries add constraint md_seq_step_fk
      foreign key (tenant_id, sequence_step_id)
      references marketing_sequence_steps (tenant_id, id)
      on delete set null (sequence_step_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'md_seq_revision_fk') then
    alter table marketing_deliveries add constraint md_seq_revision_fk
      foreign key (tenant_id, sequence_revision_id)
      references marketing_sequence_revisions (tenant_id, id)
      on delete set null (sequence_revision_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'msx_delivery_fk') then
    alter table marketing_sequence_executions add constraint msx_delivery_fk
      foreign key (tenant_id, delivery_id)
      references marketing_deliveries (tenant_id, id) on delete set null (delivery_id);
  end if;
end $$;

-- ============================================================================
-- AUTOMATION REGISTRATION
--  (a) the BULK-equivalent sequence email intent on the EXISTING external
--      capability — approval-required with genuine tenant-senior lineage;
--  (b) a NEW internal capability for the four governed contact actions plus
--      the canonical follow-up work item. Internal means internal: no network
--      call, no external side effect, and no fabricated approval.
-- ============================================================================
insert into automation_intent_types
  (intent_type, connector_capability, risk_category, external_side_effect,
   supports_idempotency, supports_status_lookup, requires_approval,
   default_expiry_seconds, schema_version, enabled)
values
  ('send_marketing_sequence_email', 'email.send_marketing', 'high', true,
   true, false, true, 3600, '1', true)
on conflict (intent_type) do nothing;

insert into automation_connector_capabilities
  (capability_key, description, external_side_effect, risk_category)
values
  ('marketing.contact_action',
   'Apply a governed internal Marketing action to a canonical Person: tag, lifecycle, owner or a follow-up work item on the platform work spine. No external side effect and no network call.',
   false, 'medium')
on conflict (capability_key) do nothing;

insert into outcome_types (outcome_type, layer, description) values
  ('marketing_contact_action_recorded', 'operational',
   'A governed Marketing contact action (tag/lifecycle/owner/follow-up) was applied to canonical tenant data')
on conflict (outcome_type) do nothing;

insert into automation_capability_contracts
  (capability_key, outcome_type, outcome_layer, adapter_version)
values ('marketing.contact_action', 'marketing_contact_action_recorded', 'operational', '1')
on conflict (capability_key) do nothing;

-- requires_approval = FALSE is the HONEST model for these five: they are
-- INTERNAL tenant-data changes explicitly authorised by the owner/admin who
-- approved the immutable sequence revision that contains the step. No
-- tenant-senior approval row exists for them and none is fabricated. The
-- external email step keeps its genuine approval (registered above).
insert into automation_intent_types
  (intent_type, connector_capability, risk_category, external_side_effect,
   supports_idempotency, supports_status_lookup, requires_approval,
   default_expiry_seconds, schema_version, enabled)
values
  ('marketing_apply_tag',         'marketing.contact_action', 'low',    false, true, false, false, 3600, '1', true),
  ('marketing_remove_tag',        'marketing.contact_action', 'low',    false, true, false, false, 3600, '1', true),
  ('marketing_change_lifecycle',  'marketing.contact_action', 'medium', false, true, false, false, 3600, '1', true),
  ('marketing_assign_owner',      'marketing.contact_action', 'medium', false, true, false, false, 3600, '1', true),
  ('marketing_create_follow_up',  'marketing.contact_action', 'medium', false, true, false, false, 3600, '1', true)
on conflict (intent_type) do nothing;

-- per-tenant enablement, function-gated exactly like the Phase-4 sender sync
create or replace function marketing_sequence_capability_sync(p_tenant uuid)
returns jsonb
language plpgsql
as $$
declare v_enabled boolean;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  select coalesce(marketing_enabled, false) into v_enabled
    from marketing_settings where tenant_id = p_tenant;
  if not coalesce(v_enabled, false) then
    update tenant_connector_capabilities set enabled = false
     where tenant_id = p_tenant and connector_id = 'marketing-internal'
       and capability_key = 'marketing.contact_action';
    return jsonb_build_object('capability_enabled', false, 'reason', 'marketing_disabled');
  end if;
  insert into tenant_connectors
    (tenant_id, connector_id, provider, category, status, health_status, enabled)
  values (p_tenant, 'marketing-internal', 'serviceos', 'marketing', 'active', 'healthy', true)
  on conflict (tenant_id, connector_id) do update
    set enabled = true, status = 'active', health_status = 'healthy';
  insert into tenant_connector_capabilities (tenant_id, connector_id, capability_key, enabled)
  values (p_tenant, 'marketing-internal', 'marketing.contact_action', true)
  on conflict (tenant_id, connector_id, capability_key) do update set enabled = true;
  return jsonb_build_object('capability_enabled', true);
end $$;

-- ============================================================================
-- CAMPAIGN GUARD — REPLACED with a SUPERSET. Every Phase-5 Broadcast rule is
-- preserved verbatim; the sequence branches are additive and equally factual.
-- ============================================================================
create or replace function marketing_campaign_guard()
returns trigger language plpgsql as $$
declare v_is_sequence boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'a campaign must be created as a draft';
    end if;
    if new.approved_by is not null or new.approved_at is not null
       or new.launched_by is not null or new.launched_at is not null
       or new.paused_at is not null or new.completed_at is not null
       or new.archived_at is not null or new.cancelled_at is not null
       or new.active_snapshot_id is not null then
      raise exception 'a new campaign cannot carry lifecycle facts';
    end if;
    return new;
  end if;

  v_is_sequence := new.campaign_type = 'sequence';

  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.campaign_type is distinct from old.campaign_type
     or new.created_at is distinct from old.created_at
     or (new.created_by is distinct from old.created_by
         and not (new.created_by is null and old.created_by is not null)) then
    raise exception 'campaign identity is immutable';
  end if;
  -- optimistic-concurrency version can only move forward
  if new.version < old.version then
    raise exception 'a campaign version can never move backwards';
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'draft'     and new.status in ('review'))
         or (old.status = 'review'    and new.status in ('draft', 'approved'))
         or (old.status = 'approved'  and new.status in ('draft', 'scheduled', 'active'))
         or (old.status = 'scheduled' and new.status in ('active', 'paused', 'cancelled'))
         or (old.status = 'active'    and new.status in ('paused', 'completed', 'cancelled'))
         -- a campaign paused BEFORE its scheduled instant returns to 'scheduled'
         or (old.status = 'paused'    and new.status in ('active', 'scheduled', 'cancelled'))
         -- a PAUSED SEQUENCE may be edited: that creates a new immutable
         -- revision and returns it to draft for re-approval. Live enrolments
         -- stay pinned to the revision they entered on. Broadcasts keep their
         -- Phase-5 machine exactly as it was.
         or (v_is_sequence and old.status = 'paused' and new.status = 'draft')
         or (old.status = 'completed' and new.status in ('archived'))
         or (old.status = 'cancelled' and new.status in ('archived'))) then
      raise exception 'illegal campaign transition % -> %', old.status, new.status;
    end if;
    -- FACTUAL anchoring — states cannot be fabricated:
    if new.status = 'approved' then
      if v_is_sequence then
        if new.current_sequence_revision_id is null or not exists (
             select 1 from marketing_sequence_approvals a
              where a.tenant_id = new.tenant_id and a.campaign_id = new.id
                and a.revision_id = new.current_sequence_revision_id
                and a.decision = 'approved') then
          raise exception 'an approved sequence requires an approval of its current revision';
        end if;
      elsif new.current_revision_id is null or not exists (
           select 1 from marketing_campaign_approvals a
            where a.tenant_id = new.tenant_id and a.campaign_id = new.id
              and a.revision_id = new.current_revision_id and a.decision = 'approved') then
        raise exception 'an approved campaign requires an approval of its current revision';
      end if;
    end if;
    if new.status in ('scheduled', 'active') and old.status in ('approved') then
      if v_is_sequence then
        if not exists (
             select 1 from marketing_sequence_confirmations c
              where c.tenant_id = new.tenant_id and c.campaign_id = new.id
                and c.purpose = 'activate'
                and c.revision_id = new.current_sequence_revision_id
                and c.used_at is not null) then
          raise exception 'activating a sequence requires a USED activation confirmation bound to its revision';
        end if;
      elsif new.active_snapshot_id is null or not exists (
           select 1 from marketing_launch_confirmations c
            where c.tenant_id = new.tenant_id and c.campaign_id = new.id
              and c.snapshot_id = new.active_snapshot_id and c.used_at is not null) then
        raise exception 'launching requires a USED launch confirmation bound to the active snapshot';
      end if;
    end if;
    if new.status = 'scheduled'
       and (new.schedule_at is null or new.timezone is null or new.schedule_local is null) then
      raise exception 'a scheduled campaign requires its resolved schedule evidence';
    end if;
    if new.status = 'completed' then
      if v_is_sequence then
        -- a REUSABLE sequence is not "completed" merely because its current
        -- cohort emptied: an operator must first CLOSE it to enrolment, and
        -- no enrolment may still be live.
        if new.sequence_closed_at is null then
          raise exception 'a sequence must be closed to enrolment before it can complete';
        end if;
        if exists (select 1 from marketing_sequence_enrolments e
                    where e.tenant_id = new.tenant_id and e.campaign_id = new.id
                      and e.status in ('active', 'paused', 'held')) then
          raise exception 'a sequence cannot complete while enrolments are still live';
        end if;
        if exists (select 1 from marketing_sequence_executions x
                    where x.tenant_id = new.tenant_id and x.campaign_id = new.id
                      and x.status in ('pending', 'preparing', 'queued', 'executing', 'unknown')) then
          raise exception 'a sequence cannot complete with unresolved step executions (incl. unknown results)';
        end if;
      elsif exists (select 1 from marketing_broadcast_dispatches d
                  where d.tenant_id = new.tenant_id and d.campaign_id = new.id
                    and d.snapshot_id = new.active_snapshot_id
                    and d.status in ('pending', 'preparing', 'queued', 'executing', 'unknown')) then
        raise exception 'a campaign cannot complete with unresolved recipients (incl. unknown results)';
      end if;
    end if;
    -- lifecycle facts move only WITH their transition
    if new.approved_at is distinct from old.approved_at and new.status <> 'approved' then
      raise exception 'approval facts are recorded by the approval transition';
    end if;
    if new.launched_at is distinct from old.launched_at
       and new.status not in ('active', 'scheduled') then
      raise exception 'launch facts are recorded by the launch transition';
    end if;
  else
    -- status-preserving updates cannot rewrite lifecycle facts
    if new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.launched_by is distinct from old.launched_by
       or new.launched_at is distinct from old.launched_at
       or new.completed_at is distinct from old.completed_at
       or new.cancelled_at is distinct from old.cancelled_at
       or new.archived_at is distinct from old.archived_at then
      raise exception 'campaign lifecycle facts may only change through their factual transition';
    end if;
    -- the launched bundle is pinned while launched work exists
    if old.status in ('scheduled', 'active', 'paused') then
      if v_is_sequence then
        if new.current_sequence_revision_id is distinct from old.current_sequence_revision_id
           or new.sender_profile_id is distinct from old.sender_profile_id then
          raise exception 'the activated sequence bundle is pinned';
        end if;
      elsif new.current_revision_id is distinct from old.current_revision_id
            or new.active_snapshot_id is distinct from old.active_snapshot_id
            or new.sender_profile_id is distinct from old.sender_profile_id
            or new.segment_id is distinct from old.segment_id then
        raise exception 'the launched campaign bundle is pinned';
      end if;
    end if;
  end if;
  -- closure is write-once and only meaningful for a sequence
  if old.sequence_closed_at is not null
     and new.sequence_closed_at is distinct from old.sequence_closed_at then
    raise exception 'sequence closure is recorded once';
  end if;
  if new.sequence_closed_at is not null and not v_is_sequence then
    raise exception 'only a sequence campaign can be closed to enrolment';
  end if;
  return new;
end $$;

-- ============================================================================
-- STEP + EXIT-RULE VALIDATION — one safe authored model. Every step
-- configuration is validated on write and hashed; nothing executable, no
-- unvalidated expressions, no arbitrary cross-tenant identifiers.
-- ============================================================================
create or replace function marketing_sequence_validate_exit_rules(p_rules jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_allow constant text[] := array['on_unsubscribe', 'on_hard_suppression', 'on_reply',
                                   'on_hard_bounce', 'on_lifecycle_stage', 'on_endpoint_invalid'];
  v_key text;
  v_val jsonb;
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then
    raise exception 'exit_rules must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_rules) loop
    if not (v_key = any(v_allow)) then
      raise exception 'unknown exit rule % — allowed: %', v_key, array_to_string(v_allow, ', ')
        using errcode = '22023';
    end if;
    v_val := p_rules -> v_key;
    if v_key = 'on_lifecycle_stage' then
      if jsonb_typeof(v_val) <> 'string' or length(v_val #>> '{}') > 60
         or (v_val #>> '{}') !~ '^[a-z0-9_]+$' then
        raise exception 'on_lifecycle_stage must be a lifecycle stage key' using errcode = '22023';
      end if;
    elsif jsonb_typeof(v_val) <> 'boolean' then
      raise exception 'exit rule % must be true or false', v_key using errcode = '22023';
    end if;
  end loop;
  -- unsubscribe and hard suppression are NOT optional: a live suppression
  -- always stops future sends. Recording them as always-on keeps the stored
  -- policy honest rather than implying they can be switched off.
  return jsonb_strip_nulls(p_rules) || '{"on_unsubscribe": true, "on_hard_suppression": true}'::jsonb;
end $$;

-- ============================================================================
-- FOLLOW-UP AVAILABILITY — an honest CONFIGURATION GATE, not a hardcoded ban.
--
-- A follow-up step creates a canonical work item on the platform spine
-- (intelligence_objects, object_class 'action'), which `work-projection`
-- surfaces. But `work-transition` derives an object's legal moves from the
-- state_transitions DATA keyed on its (domain, object_type), and the platform
-- seeds that data for ('serviceos','Action') and ('productos','Action') only —
-- NOT for ('core','Action'). A core Action can therefore be created and shown
-- but never started, completed or dismissed: permanently stuck work.
--
-- Marketing must not invent a transition engine or seed a platform state
-- machine on the platform's behalf. So the step is gated on the real
-- configuration: the moment the platform seeds ('core','Action') transitions,
-- this returns true and the step becomes authorable with NO Marketing change.
-- ============================================================================
create or replace function marketing_sequence_follow_up_available()
returns boolean
language sql
stable
as $$
  select exists (select 1 from state_transitions
                  where domain = 'core' and object_type = 'Action')
     and exists (select 1 from state_definitions
                  where domain = 'core' and object_type = 'Action');
$$;

create or replace function marketing_sequence_validate_step(
  p_tenant uuid, p_type text, p_config jsonb
) returns jsonb   -- returns the NORMALISED config (the stored form)
language plpgsql
as $$
declare
  v_key text;
  v_out jsonb;
  v_tokens text[];
  v_unit text;
  v_amount int;
  v_days jsonb;
  v_d jsonb;
  v_start int;
  v_end int;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'step config must be an object' using errcode = '22023';
  end if;

  if p_type = 'send_email' then
    for v_key in select jsonb_object_keys(p_config) loop
      if v_key not in ('subject', 'preview_text', 'body_authored', 'token_fallbacks') then
        raise exception 'unknown send_email config key %', v_key using errcode = '22023';
      end if;
    end loop;
    -- the ONE Phase-5 authored content model, reused verbatim
    v_tokens := marketing_campaign_validate_content(
      p_config ->> 'subject', p_config ->> 'preview_text', p_config ->> 'body_authored',
      coalesce(p_config -> 'token_fallbacks', '{}'::jsonb));
    v_out := jsonb_build_object(
      'subject', p_config ->> 'subject',
      'preview_text', nullif(p_config ->> 'preview_text', ''),
      'body_authored', p_config ->> 'body_authored',
      'token_fallbacks', coalesce(p_config -> 'token_fallbacks', '{}'::jsonb),
      'tokens_required', to_jsonb(v_tokens));

  elsif p_type = 'wait_duration' then
    for v_key in select jsonb_object_keys(p_config) loop
      if v_key not in ('unit', 'amount') then
        raise exception 'unknown wait_duration config key %', v_key using errcode = '22023';
      end if;
    end loop;
    v_unit := p_config ->> 'unit';
    if v_unit is null or v_unit not in ('minutes', 'hours', 'days') then
      raise exception 'wait unit must be minutes|hours|days' using errcode = '22023';
    end if;
    if jsonb_typeof(p_config -> 'amount') <> 'number' then
      raise exception 'wait amount must be a number' using errcode = '22023';
    end if;
    v_amount := (p_config ->> 'amount')::int;
    if v_amount < 1
       or (v_unit = 'minutes' and v_amount > 10080)
       or (v_unit = 'hours' and v_amount > 8760)
       or (v_unit = 'days' and v_amount > 365) then
      raise exception 'wait amount out of the supported bounds for %', v_unit using errcode = '22023';
    end if;
    v_out := jsonb_build_object('unit', v_unit, 'amount', v_amount);

  elsif p_type = 'wait_until_window' then
    for v_key in select jsonb_object_keys(p_config) loop
      if v_key not in ('days', 'start_hour', 'end_hour', 'ambiguous_policy') then
        raise exception 'unknown wait_until_window config key %', v_key using errcode = '22023';
      end if;
    end loop;
    v_days := p_config -> 'days';
    if v_days is null or jsonb_typeof(v_days) <> 'array' or jsonb_array_length(v_days) = 0
       or jsonb_array_length(v_days) > 7 then
      raise exception 'days must be a non-empty array of weekday numbers (0=Sunday)'
        using errcode = '22023';
    end if;
    for v_d in select jsonb_array_elements(v_days) loop
      if jsonb_typeof(v_d) <> 'number' or (v_d #>> '{}')::int < 0 or (v_d #>> '{}')::int > 6 then
        raise exception 'each day must be 0..6 (0=Sunday)' using errcode = '22023';
      end if;
    end loop;
    if jsonb_typeof(p_config -> 'start_hour') <> 'number'
       or jsonb_typeof(p_config -> 'end_hour') <> 'number' then
      raise exception 'start_hour and end_hour are required numbers' using errcode = '22023';
    end if;
    v_start := (p_config ->> 'start_hour')::int;
    v_end := (p_config ->> 'end_hour')::int;
    if v_start < 0 or v_start > 23 or v_end < 1 or v_end > 24 or v_end <= v_start then
      raise exception 'the local window must satisfy 0 <= start < end <= 24' using errcode = '22023';
    end if;
    -- DST ambiguity resolution is STORED POLICY, decided at authoring time —
    -- never guessed at execution time
    if coalesce(p_config ->> 'ambiguous_policy', 'earlier') not in ('earlier', 'later') then
      raise exception 'ambiguous_policy must be earlier|later' using errcode = '22023';
    end if;
    v_out := jsonb_build_object(
      'days', v_days, 'start_hour', v_start, 'end_hour', v_end,
      'ambiguous_policy', coalesce(p_config ->> 'ambiguous_policy', 'earlier'));

  elsif p_type in ('apply_tag', 'remove_tag') then
    for v_key in select jsonb_object_keys(p_config) loop
      if v_key not in ('tag_id') then
        raise exception 'unknown % config key %', p_type, v_key using errcode = '22023';
      end if;
    end loop;
    begin
      if not exists (select 1 from marketing_tags t
                      where t.id = (p_config ->> 'tag_id')::uuid and t.tenant_id = p_tenant) then
        raise exception 'tag not found for tenant' using errcode = 'P0002';
      end if;
    exception when invalid_text_representation then
      raise exception 'tag_id must be a uuid' using errcode = '22023';
    end;
    v_out := jsonb_build_object('tag_id', p_config ->> 'tag_id');

  elsif p_type = 'change_lifecycle' then
    for v_key in select jsonb_object_keys(p_config) loop
      if v_key not in ('stage_key') then
        raise exception 'unknown change_lifecycle config key %', v_key using errcode = '22023';
      end if;
    end loop;
    if not exists (select 1 from marketing_lifecycle_stages s
                    where s.tenant_id = p_tenant and s.stage_key = (p_config ->> 'stage_key')) then
      raise exception 'lifecycle stage not found for tenant' using errcode = 'P0002';
    end if;
    v_out := jsonb_build_object('stage_key', p_config ->> 'stage_key');

  elsif p_type = 'assign_owner' then
    for v_key in select jsonb_object_keys(p_config) loop
      if v_key not in ('owner_profile_id') then
        raise exception 'unknown assign_owner config key %', v_key using errcode = '22023';
      end if;
    end loop;
    begin
      perform marketing_validate_owner(p_tenant, (p_config ->> 'owner_profile_id')::uuid);
    exception when invalid_text_representation then
      raise exception 'owner_profile_id must be a uuid' using errcode = '22023';
    end;
    v_out := jsonb_build_object('owner_profile_id', p_config ->> 'owner_profile_id');

  elsif p_type = 'create_follow_up' then
    -- refuse to author work nobody could ever progress (see the gate above)
    if not marketing_sequence_follow_up_available() then
      raise exception 'follow-up steps are unavailable: this platform has no state_transitions configured for (core, Action), so the work item could be created but never progressed, completed or dismissed'
        using errcode = 'MK428';
    end if;
    for v_key in select jsonb_object_keys(p_config) loop
      if v_key not in ('subject', 'due_in_days', 'priority') then
        raise exception 'unknown create_follow_up config key %', v_key using errcode = '22023';
      end if;
    end loop;
    if p_config ->> 'subject' is null or length(trim(p_config ->> 'subject')) = 0
       or length(p_config ->> 'subject') > 200 or (p_config ->> 'subject') ~ '[[:cntrl:]]' then
      raise exception 'follow-up subject required (max 200 clean chars)' using errcode = '22023';
    end if;
    if p_config ? 'due_in_days' then
      if jsonb_typeof(p_config -> 'due_in_days') <> 'number'
         or (p_config ->> 'due_in_days')::int < 0 or (p_config ->> 'due_in_days')::int > 365 then
        raise exception 'due_in_days must be 0..365' using errcode = '22023';
      end if;
    end if;
    if p_config ? 'priority' then
      if jsonb_typeof(p_config -> 'priority') <> 'number'
         or (p_config ->> 'priority')::numeric < 0 or (p_config ->> 'priority')::numeric > 1 then
        raise exception 'priority must be between 0 and 1' using errcode = '22023';
      end if;
    end if;
    v_out := jsonb_build_object(
      'subject', trim(p_config ->> 'subject'),
      'due_in_days', coalesce((p_config ->> 'due_in_days')::int, 3),
      'priority', coalesce((p_config ->> 'priority')::numeric, 0.5));
  else
    raise exception 'unsupported step type %', p_type using errcode = '22023';
  end if;
  return v_out;
end $$;

create or replace function marketing_sequence_step_summary(p_type text, p_config jsonb)
returns text
language sql
immutable
as $$
  select case p_type
    when 'send_email' then 'Send email: ' || left(coalesce(p_config ->> 'subject', ''), 120)
    when 'wait_duration' then 'Wait ' || (p_config ->> 'amount') || ' ' || (p_config ->> 'unit')
    when 'wait_until_window' then 'Wait until ' || (p_config ->> 'start_hour') || ':00-'
                                 || (p_config ->> 'end_hour') || ':00 tenant-local'
    when 'apply_tag' then 'Apply tag'
    when 'remove_tag' then 'Remove tag'
    when 'change_lifecycle' then 'Change lifecycle to ' || coalesce(p_config ->> 'stage_key', '')
    when 'assign_owner' then 'Assign owner'
    when 'create_follow_up' then 'Create follow-up: ' || left(coalesce(p_config ->> 'subject', ''), 120)
    else p_type end;
$$;

create or replace function marketing_sequence_step_hash(p_type text, p_config jsonb)
returns text
language sql
immutable
as $$
  select encode(extensions.digest(
    jsonb_build_object('type', p_type, 'config', p_config)::text, 'sha256'), 'hex');
$$;

-- make the persisted schedule of an execution immutable too: a retry must
-- never recompute a wait instant and let it drift
create or replace function marketing_sequence_execution_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'an execution must be created pending — % is not a creatable state',
        new.status;
    end if;
    if new.delivery_id is not null or new.automation_intent_id is not null
       or new.skip_reason is not null or new.failure_class is not null
       or new.started_at is not null or new.finished_at is not null then
      raise exception 'a new execution cannot carry work facts';
    end if;
    if not exists (select 1 from marketing_sequence_steps s
                    where s.id = new.step_id and s.tenant_id = new.tenant_id
                      and s.revision_id = new.revision_id
                      and s.step_order = new.step_order
                      and s.step_type = new.step_type) then
      raise exception 'an execution must mirror a step of its pinned revision';
    end if;
    if not exists (select 1 from marketing_sequence_enrolments e
                    where e.id = new.enrolment_id and e.tenant_id = new.tenant_id
                      and e.revision_id = new.revision_id
                      and e.campaign_id = new.campaign_id) then
      raise exception 'an execution must belong to an enrolment on the same pinned revision';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.enrolment_id is distinct from old.enrolment_id
     or new.campaign_id is distinct from old.campaign_id
     or new.revision_id is distinct from old.revision_id
     or new.step_id is distinct from old.step_id
     or new.step_order is distinct from old.step_order
     or new.step_type is distinct from old.step_type
     or new.generation is distinct from old.generation
     or new.scheduled_for is distinct from old.scheduled_for
     or new.created_at is distinct from old.created_at then
    raise exception 'execution identity, lineage and its persisted schedule are immutable';
  end if;
  if old.delivery_id is not null and new.delivery_id is distinct from old.delivery_id then
    raise exception 'a recorded execution delivery is immutable';
  end if;
  if old.automation_intent_id is not null
     and new.automation_intent_id is distinct from old.automation_intent_id then
    raise exception 'a recorded execution intent is immutable';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'pending'   and new.status in ('preparing', 'skipped', 'cancelled'))
         or (old.status = 'preparing' and new.status in ('pending', 'queued', 'succeeded',
                                                         'skipped', 'failed', 'cancelled'))
         or (old.status = 'queued'    and new.status in ('executing', 'succeeded', 'skipped',
                                                         'failed', 'unknown', 'cancelled'))
         or (old.status = 'executing' and new.status in ('queued', 'succeeded', 'skipped',
                                                         'failed', 'unknown'))
         or (old.status = 'unknown'   and new.status in ('succeeded', 'failed'))) then
      raise exception 'illegal execution transition % -> %', old.status, new.status;
    end if;
    if new.status = 'skipped' and new.skip_reason is null then
      raise exception 'a skipped execution requires its skip reason';
    end if;
    if new.status = 'failed' and new.failure_class is null then
      raise exception 'a failed execution requires its failure classification';
    end if;
  else
    if new.skip_reason is distinct from old.skip_reason
       or new.failure_class is distinct from old.failure_class
       or new.finished_at is distinct from old.finished_at then
      raise exception 'execution facts may only change through a factual status transition';
    end if;
  end if;
  return new;
end $$;

-- ============================================================================
-- TENANT-LOCAL SCHEDULING — one DST authority, shared with the Phase-5 rules.
-- Nonexistent local times (spring-forward gaps) move deterministically to the
-- first instant that DOES exist; ambiguous local times (folds of ANY size —
-- 30/45/60/90/120 minutes) resolve through the revision's STORED policy, never
-- a guess at execution time.
-- ============================================================================
create or replace function marketing_sequence_resolve_local(
  p_tz text, p_local timestamp, p_ambiguous text
) returns timestamptz
language plpgsql
stable
as $$
declare
  v_utc timestamptz;
  v_alt timestamptz;
  v_probe interval;
  v_try timestamp := p_local;
  i int;
begin
  -- GAP: walk forward to the FIRST local time that actually exists.
  -- The step must be one minute, not a coarser probe: real sub-hour DST gaps
  -- do not begin on a coarse boundary. Lord Howe Island springs forward
  -- 02:00 → 02:30, so a requested 02:29 has to resolve to 02:30 — a 15-minute
  -- probe would step straight over it to 02:44 and schedule 14 minutes late.
  -- Bounded at 180 minutes, comfortably above the largest real transition
  -- (2 hours), and the loop exits immediately for the overwhelmingly common
  -- case of a local time that exists.
  for i in 0 .. 180 loop
    v_utc := v_try at time zone p_tz;
    exit when (v_utc at time zone p_tz) = v_try;
    v_try := v_try + interval '1 minute';
  end loop;
  v_utc := v_try at time zone p_tz;
  -- FOLD: the same local time maps to two instants — resolve by stored policy
  v_alt := null;
  foreach v_probe in array array['00:15', '00:20', '00:30', '00:45', '01:00',
                                 '01:30', '02:00']::interval[] loop
    if ((v_utc - v_probe) at time zone p_tz) = v_try then
      v_alt := v_utc - v_probe; exit;
    elsif ((v_utc + v_probe) at time zone p_tz) = v_try then
      v_alt := v_utc + v_probe; exit;
    end if;
  end loop;
  if v_alt is not null then
    return case when coalesce(p_ambiguous, 'earlier') = 'earlier'
                then least(v_utc, v_alt) else greatest(v_utc, v_alt) end;
  end if;
  return v_utc;
end $$;

-- the next instant inside a configured tenant-local weekday window
create or replace function marketing_sequence_next_window(
  p_tz text, p_days jsonb, p_start int, p_end int, p_ambiguous text, p_from timestamptz
) returns timestamptz
language plpgsql
stable
as $$
declare
  v_local_now timestamp := p_from at time zone p_tz;
  v_day date;
  v_dow int;
  v_candidate timestamptz;
  i int;
begin
  for i in 0 .. 14 loop
    v_day := (v_local_now + make_interval(days => i))::date;
    v_dow := extract(dow from v_day)::int;
    if not exists (select 1 from jsonb_array_elements_text(p_days) d
                    where d.value::int = v_dow) then
      continue;
    end if;
    -- already inside today's window? the next eligible instant is NOW
    if i = 0 and extract(hour from v_local_now)::int >= p_start
       and extract(hour from v_local_now)::int < p_end then
      return p_from;
    end if;
    v_candidate := marketing_sequence_resolve_local(
      p_tz, v_day + make_interval(hours => p_start), p_ambiguous);
    if v_candidate > p_from then
      return v_candidate;
    end if;
  end loop;
  -- no matching day within a fortnight is a configuration fault, not a send
  return null;
end $$;

-- quiet hours DEFER an email step to the end of the window (tenant-local)
create or replace function marketing_sequence_apply_quiet_hours(
  p_tz text, p_start int, p_end int, p_at timestamptz
) returns timestamptz
language plpgsql
stable
as $$
declare v_local timestamp; v_hour int; v_day date;
begin
  if p_start is null or p_end is null or p_start = p_end then
    return p_at;
  end if;
  v_local := p_at at time zone p_tz;
  v_hour := extract(hour from v_local)::int;
  v_day := v_local::date;
  if p_start < p_end then
    if v_hour >= p_start and v_hour < p_end then
      return marketing_sequence_resolve_local(p_tz, v_day + make_interval(hours => p_end), 'earlier');
    end if;
  else
    -- window wraps midnight
    if v_hour >= p_start then
      return marketing_sequence_resolve_local(
        p_tz, (v_day + 1) + make_interval(hours => p_end), 'earlier');
    elsif v_hour < p_end then
      return marketing_sequence_resolve_local(p_tz, v_day + make_interval(hours => p_end), 'earlier');
    end if;
  end if;
  return p_at;
end $$;

-- ============================================================================
-- AUTHORING — create / revise. Both build the COMPLETE immutable bundle
-- (revision + every step) in one transaction and hash it.
-- ============================================================================
create or replace function marketing_sequence_build_revision(
  p_tenant uuid, p_actor uuid, p_campaign uuid, p_revision_number int,
  p_sender uuid, p_args jsonb, p_source text
) returns jsonb
language plpgsql
as $$
declare
  v_rev uuid := gen_random_uuid();
  v_steps jsonb := coalesce(p_args -> 'steps', '[]'::jsonb);
  v_step jsonb;
  v_cfg jsonb;
  v_type text;
  v_key text;
  v_tz text;
  v_qs int;
  v_qe int;
  v_entry text;
  v_reenrol text;
  v_block text;
  v_rules jsonb;
  v_hash_input jsonb := '[]'::jsonb;
  v_tokens text[] := '{}';
  v_bundle text;
  i int;
  v_n int;
begin
  if jsonb_typeof(v_steps) <> 'array' then
    raise exception 'steps must be an array' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(v_steps);
  if v_n < 1 or v_n > 40 then
    raise exception 'a sequence needs between 1 and 40 steps' using errcode = '22023';
  end if;
  v_tz := coalesce(p_args ->> 'timezone',
                   (select timezone from marketing_settings where tenant_id = p_tenant), 'UTC');
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'a valid IANA timezone is required' using errcode = '22023';
  end if;
  v_qs := nullif(p_args ->> 'quiet_hours_start', '')::int;
  v_qe := nullif(p_args ->> 'quiet_hours_end', '')::int;
  v_entry := coalesce(p_args ->> 'entry_policy', 'manual_or_segment');
  if v_entry not in ('manual_or_segment', 'manual_only', 'segment_only') then
    raise exception 'unsupported entry policy' using errcode = '22023';
  end if;
  v_reenrol := coalesce(p_args ->> 'reenrolment_policy', 'never');
  if v_reenrol not in ('never', 'after_exit', 'always') then
    raise exception 'unsupported re-enrolment policy' using errcode = '22023';
  end if;
  v_block := coalesce(p_args ->> 'policy_block_action', 'exit');
  if v_block not in ('exit', 'skip_step') then
    raise exception 'policy_block_action must be exit|skip_step' using errcode = '22023';
  end if;
  v_rules := marketing_sequence_validate_exit_rules(coalesce(p_args -> 'exit_rules', '{}'::jsonb));

  -- validate + normalise EVERY step before anything is written
  for i in 0 .. v_n - 1 loop
    v_step := v_steps -> i;
    if jsonb_typeof(v_step) <> 'object' then
      raise exception 'each step must be an object' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_step) loop
      if v_key not in ('key', 'type', 'config') then
        raise exception 'unknown step key %', v_key using errcode = '22023';
      end if;
    end loop;
    v_type := v_step ->> 'type';
    v_key := coalesce(v_step ->> 'key', 's' || (i + 1));
    if v_key !~ '^[a-z0-9_-]{1,40}$' then
      raise exception 'step key must match ^[a-z0-9_-]{1,40}$' using errcode = '22023';
    end if;
    v_cfg := marketing_sequence_validate_step(p_tenant, v_type, coalesce(v_step -> 'config', '{}'::jsonb));
    if v_type = 'send_email' then
      v_tokens := array(select distinct unnest(
        v_tokens || array(select jsonb_array_elements_text(v_cfg -> 'tokens_required'))));
    end if;
    v_hash_input := v_hash_input || jsonb_build_object(
      'order', i + 1, 'key', v_key, 'type', v_type, 'config', v_cfg);
  end loop;

  -- the FIRST step may not be a wait: an enrolment must do something real
  if (v_hash_input -> 0 ->> 'type') in ('wait_duration', 'wait_until_window') then
    raise exception 'the first step cannot be a wait — start the sequence with a real step'
      using errcode = '22023';
  end if;

  v_bundle := encode(extensions.digest(jsonb_build_object(
    'campaign', p_campaign, 'sender', p_sender, 'timezone', v_tz,
    'quiet_start', v_qs, 'quiet_end', v_qe, 'entry', v_entry, 'reenrol', v_reenrol,
    'policy_block', v_block, 'exit_rules', v_rules, 'steps', v_hash_input)::text,
    'sha256'), 'hex');

  insert into marketing_sequence_revisions
    (id, tenant_id, campaign_id, revision_number, sender_profile_id, timezone,
     quiet_hours_start, quiet_hours_end, entry_policy, reenrolment_policy, exit_rules,
     policy_block_action, step_count, bundle_hash, tokens_required, source, created_by)
  values
    (v_rev, p_tenant, p_campaign, p_revision_number, p_sender, v_tz, v_qs, v_qe,
     v_entry, v_reenrol, v_rules, v_block, v_n, v_bundle, v_tokens, p_source, p_actor);

  insert into marketing_sequence_steps
    (tenant_id, revision_id, campaign_id, step_order, step_key, step_type, config,
     config_hash, summary)
  select p_tenant, v_rev, p_campaign, (s.value ->> 'order')::int, s.value ->> 'key',
         s.value ->> 'type', s.value -> 'config',
         marketing_sequence_step_hash(s.value ->> 'type', s.value -> 'config'),
         marketing_sequence_step_summary(s.value ->> 'type', s.value -> 'config')
    from jsonb_array_elements(v_hash_input) s(value);

  return jsonb_build_object('revision_id', v_rev, 'bundle_hash', v_bundle,
    'step_count', v_n, 'timezone', v_tz);
end $$;

create or replace function marketing_sequence_create(p_tenant uuid, p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_name text;
  v_desc text;
  v_sender marketing_sender_profiles%rowtype;
  v_campaign uuid := gen_random_uuid();
  v_built jsonb;
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('name', 'description', 'sender_id', 'timezone', 'quiet_hours_start',
                     'quiet_hours_end', 'entry_policy', 'reenrolment_policy', 'exit_rules',
                     'policy_block_action', 'steps') then
      raise exception 'unknown create argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_name := nullif(trim(coalesce(p_args ->> 'name', '')), '');
  if v_name is null or length(v_name) > 120 or v_name ~ '[[:cntrl:]]' then
    raise exception 'name required (max 120 clean chars)' using errcode = '22023';
  end if;
  v_desc := nullif(trim(coalesce(p_args ->> 'description', '')), '');
  if v_desc is not null and (length(v_desc) > 500 or v_desc ~ '[[:cntrl:]]') then
    raise exception 'description is bounded to 500 clean chars' using errcode = '22023';
  end if;
  begin
    select * into v_sender from marketing_sender_profiles
     where id = (p_args ->> 'sender_id')::uuid and tenant_id = p_tenant;
  exception when others then
    raise exception 'invalid sender id' using errcode = '22023';
  end;
  if v_sender.id is null then
    raise exception 'sender not found for tenant' using errcode = 'P0002';
  end if;

  insert into marketing_campaigns
    (id, tenant_id, name, description, campaign_type, status, owner_id,
     sender_profile_id, created_by, version)
  values (v_campaign, p_tenant, v_name, v_desc, 'sequence', 'draft', p_actor,
          v_sender.id, p_actor, 1);
  v_built := marketing_sequence_build_revision(
    p_tenant, p_actor, v_campaign, 1, v_sender.id, p_args, 'editor');
  update marketing_campaigns
     set current_sequence_revision_id = (v_built ->> 'revision_id')::uuid,
         timezone = v_built ->> 'timezone'
   where id = v_campaign;
  insert into marketing_campaign_events (tenant_id, campaign_id, from_status, to_status, actor, detail)
  values (p_tenant, v_campaign, null, 'draft', v_label, 'sequence created');

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.sequence.created', 'marketing_campaign',
          v_campaign::text, 'ok', jsonb_build_object('name', v_name, 'revision', 1,
                                                     'steps', v_built ->> 'step_count'));
  perform marketing_event_append(p_tenant, 'marketing.sequence.revision_created',
    'marketing_campaign', v_campaign, 'marketing-sequences',
    jsonb_build_object('k', 'seq_created:' || v_campaign, 'actor', v_label,
                       'revision', 1, 'at', now()));

  return jsonb_build_object('id', v_campaign, 'revision_id', v_built ->> 'revision_id',
    'status', 'draft', 'version', 1, 'bundle_hash', v_built ->> 'bundle_hash',
    'step_count', (v_built ->> 'step_count')::int);
end $$;

create or replace function marketing_sequence_revise(
  p_tenant uuid, p_actor uuid, p_campaign uuid, p_args jsonb, p_expected_version int
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_c marketing_campaigns%rowtype;
  v_prev marketing_sequence_revisions%rowtype;
  v_key text;
  v_sender marketing_sender_profiles%rowtype;
  v_name text;
  v_desc text;
  v_n int;
  v_built jsonb;
  v_merged jsonb;
  v_from_status text;
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  if p_campaign is null or p_expected_version is null then
    raise exception 'campaign and expected_version required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' or p_args = '{}'::jsonb then
    raise exception 'changes must be a non-empty object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('name', 'description', 'sender_id', 'timezone', 'quiet_hours_start',
                     'quiet_hours_end', 'entry_policy', 'reenrolment_policy', 'exit_rules',
                     'policy_block_action', 'steps') then
      raise exception 'unknown revise argument %', v_key using errcode = '22023';
    end if;
  end loop;
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant and campaign_type = 'sequence' for update;
  if not found then
    raise exception 'sequence not found for tenant' using errcode = 'P0002';
  end if;
  if v_c.version <> p_expected_version then
    raise exception 'campaign changed since it was read' using errcode = 'MK409';
  end if;
  -- An ACTIVE sequence is the journey enrolled People are living. Editing it
  -- in place would either disturb them or silently migrate them, so the
  -- operator must PAUSE first: that stops new steps, leaves every enrolment
  -- pinned to the revision it entered on, and makes the edit explicit.
  if v_c.status = 'active' then
    raise exception 'an ACTIVE sequence cannot be revised — pause it first (enrolled People stay pinned to the revision they entered on)'
      using errcode = '22023';
  end if;
  if v_c.status not in ('draft', 'review', 'approved', 'paused') then
    raise exception 'a % sequence cannot be revised', v_c.status using errcode = '22023';
  end if;
  select * into v_prev from marketing_sequence_revisions
   where tenant_id = p_tenant and id = v_c.current_sequence_revision_id;
  if not found then
    if not (p_args ? 'sender_id' and p_args ? 'steps') then
      raise exception 'this campaign has no sequence revision yet — the first revision needs sender_id and steps'
        using errcode = '22023';
    end if;
  end if;
  if p_args ? 'name' then
    v_name := nullif(trim(coalesce(p_args ->> 'name', '')), '');
    if v_name is null or length(v_name) > 120 or v_name ~ '[[:cntrl:]]' then
      raise exception 'name required (max 120 clean chars)' using errcode = '22023';
    end if;
  end if;
  if p_args ? 'description' then
    v_desc := nullif(trim(coalesce(p_args ->> 'description', '')), '');
    if v_desc is not null and (length(v_desc) > 500 or v_desc ~ '[[:cntrl:]]') then
      raise exception 'description is bounded to 500 clean chars' using errcode = '22023';
    end if;
  end if;
  begin
    select * into v_sender from marketing_sender_profiles
     where id = coalesce((p_args ->> 'sender_id')::uuid, v_prev.sender_profile_id)
       and tenant_id = p_tenant;
  exception when others then
    raise exception 'invalid sender id' using errcode = '22023';
  end;
  if v_sender.id is null then
    raise exception 'sender not found for tenant' using errcode = 'P0002';
  end if;

  -- effective bundle = previous revision overlaid with the supplied changes
  v_merged := jsonb_strip_nulls(jsonb_build_object(
    'timezone', coalesce(p_args ->> 'timezone', v_prev.timezone),
    'quiet_hours_start', coalesce(p_args ->> 'quiet_hours_start', v_prev.quiet_hours_start::text),
    'quiet_hours_end', coalesce(p_args ->> 'quiet_hours_end', v_prev.quiet_hours_end::text),
    'entry_policy', coalesce(p_args ->> 'entry_policy', v_prev.entry_policy),
    'reenrolment_policy', coalesce(p_args ->> 'reenrolment_policy', v_prev.reenrolment_policy),
    'policy_block_action', coalesce(p_args ->> 'policy_block_action', v_prev.policy_block_action)))
    || jsonb_build_object('exit_rules', coalesce(p_args -> 'exit_rules', v_prev.exit_rules,
                                                 '{}'::jsonb))
    || jsonb_build_object('steps', coalesce(p_args -> 'steps',
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'key', s.step_key, 'type', s.step_type, 'config', s.config)
                  order by s.step_order), '[]'::jsonb)
            from marketing_sequence_steps s
           where s.tenant_id = p_tenant and s.revision_id = v_prev.id)));

  select coalesce(max(revision_number), 0) + 1 into v_n
    from marketing_sequence_revisions
   where tenant_id = p_tenant and campaign_id = p_campaign;
  v_built := marketing_sequence_build_revision(
    p_tenant, p_actor, p_campaign, v_n, v_sender.id, v_merged, 'editor');

  v_from_status := v_c.status;
  -- editing invalidates approval + any unused confirmation through a NEW
  -- revision and a return to draft; nothing is deleted, and EXISTING
  -- ENROLMENTS STAY PINNED to the revision they entered on
  update marketing_sequence_confirmations set superseded_at = now()
   where tenant_id = p_tenant and campaign_id = p_campaign
     and used_at is null and superseded_at is null;
  update marketing_campaigns set
    name = case when p_args ? 'name' then v_name else name end,
    description = case when p_args ? 'description' then v_desc else description end,
    current_sequence_revision_id = (v_built ->> 'revision_id')::uuid,
    sender_profile_id = v_sender.id,
    timezone = v_built ->> 'timezone',
    status = 'draft',
    version = version + 1
  where id = p_campaign
  returning * into v_c;
  if v_from_status <> 'draft' then
    insert into marketing_campaign_events (tenant_id, campaign_id, from_status, to_status, actor, detail)
    values (p_tenant, p_campaign, v_from_status, 'draft', v_label,
            'revision ' || v_n || ' created — approval and confirmations invalidated');
  end if;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.sequence.revised', 'marketing_campaign',
          p_campaign::text, 'ok', jsonb_build_object('revision', v_n));
  perform marketing_event_append(p_tenant, 'marketing.sequence.revision_created',
    'marketing_campaign', p_campaign, 'marketing-sequences',
    jsonb_build_object('k', 'seq_revised:' || (v_built ->> 'revision_id'), 'revision', v_n,
                       'actor', v_label, 'at', now()));

  return jsonb_build_object('id', p_campaign, 'revision_id', v_built ->> 'revision_id',
    'revision', v_n, 'status', v_c.status, 'version', v_c.version,
    'bundle_hash', v_built ->> 'bundle_hash');
end $$;

-- read-only validation of a candidate bundle (the builder's dry run)
create or replace function marketing_sequence_validate(p_tenant uuid, p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare v_steps jsonb; v_step jsonb; v_out jsonb := '[]'::jsonb; i int; v_cfg jsonb;
begin
  perform marketing_require_draft_actor(p_tenant, p_actor);
  v_steps := coalesce(p_args -> 'steps', '[]'::jsonb);
  if jsonb_typeof(v_steps) <> 'array' then
    raise exception 'steps must be an array' using errcode = '22023';
  end if;
  for i in 0 .. jsonb_array_length(v_steps) - 1 loop
    v_step := v_steps -> i;
    begin
      v_cfg := marketing_sequence_validate_step(
        p_tenant, v_step ->> 'type', coalesce(v_step -> 'config', '{}'::jsonb));
      v_out := v_out || jsonb_build_object('order', i + 1, 'ok', true,
        'summary', marketing_sequence_step_summary(v_step ->> 'type', v_cfg));
    exception when others then
      v_out := v_out || jsonb_build_object('order', i + 1, 'ok', false, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('steps', v_out,
    'valid', not exists (select 1 from jsonb_array_elements(v_out) s
                          where (s.value ->> 'ok')::boolean is not true));
end $$;

-- ============================================================================
-- LIFECYCLE — submit / request changes / approve / activate / pause / resume /
-- cancel / close / archive. Approval and activation are OWNER/ADMIN ONLY under
-- the canonical resolver ceiling; a hostile raw grant stays inert.
-- ============================================================================
create or replace function marketing_sequence_transition(
  p_tenant uuid, p_actor uuid, p_campaign uuid, p_action text,
  p_expected_version int, p_args jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_c marketing_campaigns%rowtype;
  v_rev marketing_sequence_revisions%rowtype;
  v_to text;
  v_note text;
  v_approval uuid;
  v_exited int := 0;
begin
  if p_action is null or p_action not in
     ('submit_review', 'request_changes', 'approve', 'pause', 'resume', 'cancel',
      'close', 'archive') then
    raise exception 'unknown transition action' using errcode = '22023';
  end if;
  if p_action = 'submit_review' then
    v_label := marketing_require_draft_actor(p_tenant, p_actor);
  else
    v_label := marketing_require_launch_actor(p_tenant, p_actor);
  end if;
  if p_campaign is null or p_expected_version is null then
    raise exception 'campaign and expected_version required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  v_note := nullif(trim(coalesce(p_args ->> 'note', '')), '');
  if v_note is not null and length(v_note) > 500 then
    raise exception 'note is bounded to 500 chars' using errcode = '22023';
  end if;
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant and campaign_type = 'sequence' for update;
  if not found then
    raise exception 'sequence not found for tenant' using errcode = 'P0002';
  end if;
  if v_c.version <> p_expected_version then
    raise exception 'campaign changed since it was read' using errcode = 'MK409';
  end if;
  -- EVERY action states its legal precondition, so an out-of-sequence request
  -- is a stable client error rather than a raw trigger exception
  if p_action = 'submit_review' and v_c.status <> 'draft' then
    raise exception 'only a draft sequence can be submitted for review (it is %)', v_c.status
      using errcode = '22023';
  end if;
  if p_action in ('approve', 'request_changes') and v_c.status <> 'review' then
    raise exception 'only a sequence in review can be approved or changed (it is %)', v_c.status
      using errcode = '22023';
  end if;
  if p_action = 'pause' and v_c.status not in ('scheduled', 'active') then
    raise exception 'only a scheduled/active sequence can be paused (it is %)', v_c.status
      using errcode = '22023';
  end if;
  if p_action = 'resume' and v_c.status <> 'paused' then
    raise exception 'only a paused sequence can be resumed (it is %)', v_c.status
      using errcode = '22023';
  end if;
  if p_action = 'cancel' and v_c.status not in ('scheduled', 'active', 'paused') then
    raise exception 'only a scheduled/active/paused sequence can be cancelled (it is %)', v_c.status
      using errcode = '22023';
  end if;
  if p_action = 'close' and v_c.status not in ('active', 'paused') then
    raise exception 'only an active/paused sequence can be closed to enrolment (it is %)', v_c.status
      using errcode = '22023';
  end if;
  if p_action = 'archive' and v_c.status not in ('completed', 'cancelled') then
    raise exception 'only a completed/cancelled sequence can be archived (it is %)', v_c.status
      using errcode = '22023';
  end if;

  if p_action = 'approve' then
    select * into v_rev from marketing_sequence_revisions
     where tenant_id = p_tenant and id = v_c.current_sequence_revision_id;
    if not found then
      raise exception 'sequence has no current revision' using errcode = 'P0002';
    end if;
    -- the approval binds the EXACT immutable bundle
    insert into marketing_sequence_approvals
      (tenant_id, campaign_id, campaign_version, revision_id, bundle_hash,
       sender_profile_id, approver_profile_id, authority_basis, decision, note)
    values (p_tenant, p_campaign, v_c.version, v_rev.id, v_rev.bundle_hash,
            v_rev.sender_profile_id, p_actor, 'marketing.campaigns.launch', 'approved', v_note)
    returning id into v_approval;
    update marketing_campaigns
       set status = 'approved', approved_by = p_actor, approved_at = now(),
           version = version + 1
     where id = p_campaign returning * into v_c;
  elsif p_action = 'request_changes' then
    insert into marketing_sequence_approvals
      (tenant_id, campaign_id, campaign_version, revision_id, bundle_hash,
       sender_profile_id, approver_profile_id, authority_basis, decision, note)
    select p_tenant, p_campaign, v_c.version, r.id, r.bundle_hash, r.sender_profile_id,
           p_actor, 'marketing.campaigns.launch', 'changes_requested', v_note
      from marketing_sequence_revisions r
     where r.tenant_id = p_tenant and r.id = v_c.current_sequence_revision_id;
    update marketing_campaigns set status = 'draft', version = version + 1
     where id = p_campaign returning * into v_c;
  elsif p_action = 'cancel' then
    update marketing_campaigns
       set status = 'cancelled', cancelled_by = p_actor, cancelled_at = now(),
           version = version + 1
     where id = p_campaign returning * into v_c;
    -- cancelling the campaign exits every live enrolment with an exact fact;
    -- work already accepted by the provider is NEVER rewritten
    update marketing_sequence_enrolments
       set status = 'exited', exit_reason = 'campaign_cancelled', exited_at = now(),
           exit_evidence = jsonb_build_object('actor', v_label, 'at', now())
     where tenant_id = p_tenant and campaign_id = p_campaign
       and status in ('active', 'paused', 'held');
    get diagnostics v_exited = row_count;
    update marketing_sequence_executions
       set status = 'cancelled', finished_at = now()
     where tenant_id = p_tenant and campaign_id = p_campaign and status = 'pending';
  elsif p_action = 'close' then
    -- CLOSED means "no new enrolments"; the campaign stays active while live
    -- enrolments finish. Completion is derived separately and truthfully.
    update marketing_campaigns set sequence_closed_at = now(), version = version + 1
     where id = p_campaign returning * into v_c;
  else
    update marketing_campaigns
       set status = case p_action when 'submit_review' then 'review'
                                  when 'pause' then 'paused'
                                  when 'resume' then 'active'
                                  when 'archive' then 'archived' end,
           paused_at = case when p_action = 'pause' then now() else paused_at end,
           archived_at = case when p_action = 'archive' then now() else archived_at end,
           version = version + 1
     where id = p_campaign returning * into v_c;
  end if;

  if p_action <> 'close' then
    insert into marketing_campaign_events (tenant_id, campaign_id, from_status, to_status, actor, detail)
    values (p_tenant, p_campaign,
            (select to_status from marketing_campaign_events e
              where e.tenant_id = p_tenant and e.campaign_id = p_campaign
              order by seq desc limit 1),
            v_c.status, v_label, coalesce(v_note, p_action));
  end if;
  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.sequence.' || p_action, 'marketing_campaign',
          p_campaign::text, 'ok',
          jsonb_build_object('to', v_c.status, 'exited_enrolments', v_exited));
  perform marketing_event_append(p_tenant, 'marketing.sequence.' ||
    case p_action when 'submit_review' then 'review_requested'
                  when 'request_changes' then 'changes_requested'
                  when 'approve' then 'approved'
                  when 'pause' then 'paused'
                  when 'resume' then 'resumed'
                  when 'cancel' then 'cancelled'
                  when 'close' then 'closed'
                  else 'archived' end,
    'marketing_campaign', p_campaign, 'marketing-sequences',
    jsonb_build_object('k', p_action || ':' || p_campaign || ':' || v_c.version,
                       'actor', v_label, 'at', now()));

  return jsonb_build_object('id', p_campaign, 'status', v_c.status, 'version', v_c.version,
    'approval_id', v_approval, 'exited_enrolments', v_exited,
    'closed_at', v_c.sequence_closed_at);
end $$;

-- ── ACTIVATION: a one-use, digest-only, revision-bound confirmation ─────────
create or replace function marketing_sequence_preflight_activation(
  p_tenant uuid, p_actor uuid, p_campaign uuid, p_expected_version int,
  p_public_base_url text
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_c marketing_campaigns%rowtype;
  v_rev marketing_sequence_revisions%rowtype;
  v_appr marketing_sequence_approvals%rowtype;
  v_rd jsonb;
  v_challenge text;
  v_conf uuid := gen_random_uuid();
  v_email_steps int;
begin
  v_label := marketing_require_launch_actor(p_tenant, p_actor);
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant and campaign_type = 'sequence' for update;
  if not found then
    raise exception 'sequence not found for tenant' using errcode = 'P0002';
  end if;
  if v_c.version <> p_expected_version then
    raise exception 'campaign changed since it was read' using errcode = 'MK409';
  end if;
  if v_c.status <> 'approved' then
    raise exception 'activation requires an APPROVED sequence (it is %)', v_c.status
      using errcode = '22023';
  end if;
  select * into v_rev from marketing_sequence_revisions
   where tenant_id = p_tenant and id = v_c.current_sequence_revision_id;
  select * into v_appr from marketing_sequence_approvals a
   where a.tenant_id = p_tenant and a.campaign_id = p_campaign
     and a.revision_id = v_rev.id and a.decision = 'approved'
   order by a.created_at desc limit 1;
  if v_appr.id is null then
    raise exception 'no approval exists for the current revision' using errcode = '22023';
  end if;
  if v_appr.bundle_hash <> v_rev.bundle_hash then
    raise exception 'the approved bundle no longer matches this revision' using errcode = 'MK409';
  end if;
  if exists (select 1 from marketing_settings s
              where s.tenant_id = p_tenant and not s.marketing_enabled) then
    raise exception 'marketing is disabled for this tenant' using errcode = '42501';
  end if;
  select count(*) into v_email_steps from marketing_sequence_steps
   where tenant_id = p_tenant and revision_id = v_rev.id and step_type = 'send_email';
  -- a sender only has to be READY when the journey actually sends
  if v_email_steps > 0 then
    -- an email step needs a real public unsubscribe path; without one, launch
    -- is impossible and we NEVER fabricate a link
    if p_public_base_url is null or p_public_base_url !~ '^https?://[^\s]+$' then
      raise exception 'the Marketing public base URL is not configured — unsubscribe links cannot be built, so a sending sequence cannot be activated'
        using errcode = 'MK428';
    end if;
    if not exists (select 1 from marketing_sender_profiles p
                    where p.id = v_rev.sender_profile_id and p.tenant_id = p_tenant and p.enabled) then
      raise exception 'the sequence sender is disabled' using errcode = '22023';
    end if;
    v_rd := marketing_sender_readiness(p_tenant, v_rev.sender_profile_id);
    if not (v_rd ->> 'ready')::boolean then
      raise exception 'the sequence sender is not ready to send (%)', v_rd ->> 'state'
        using errcode = '22023';
    end if;
  end if;
  perform marketing_sequence_capability_sync(p_tenant);
  -- freeze the public unsubscribe origin the whole journey will use
  if v_email_steps > 0 then
    update marketing_campaigns set launch_public_base_url = p_public_base_url
     where id = p_campaign and tenant_id = p_tenant;
  end if;

  update marketing_sequence_confirmations set superseded_at = now()
   where tenant_id = p_tenant and campaign_id = p_campaign and purpose = 'activate'
     and used_at is null and superseded_at is null;
  v_challenge := encode(extensions.gen_random_bytes(24), 'hex');
  insert into marketing_sequence_confirmations
    (id, tenant_id, campaign_id, campaign_version, revision_id, purpose, bundle_hash,
     actor_profile_id, challenge_digest, expires_at)
  values (v_conf, p_tenant, p_campaign, v_c.version, v_rev.id, 'activate', v_rev.bundle_hash,
          p_actor, encode(extensions.digest(v_challenge, 'sha256'), 'hex'),
          now() + interval '15 minutes');

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.sequence.activation_preflight', 'marketing_campaign',
          p_campaign::text, 'ok', jsonb_build_object('revision', v_rev.revision_number));

  return jsonb_build_object('confirmation_id', v_conf, 'challenge', v_challenge,
    'expires_at', now() + interval '15 minutes', 'revision_id', v_rev.id,
    'revision_number', v_rev.revision_number, 'bundle_hash', v_rev.bundle_hash,
    'campaign_version', v_c.version, 'step_count', v_rev.step_count,
    'email_steps', v_email_steps, 'timezone', v_rev.timezone,
    'quiet_hours_start', v_rev.quiet_hours_start, 'quiet_hours_end', v_rev.quiet_hours_end,
    'exit_rules', v_rev.exit_rules, 'approval_id', v_appr.id);
end $$;

create or replace function marketing_sequence_activate(
  p_tenant uuid, p_actor uuid, p_campaign uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_c marketing_campaigns%rowtype;
  v_conf marketing_sequence_confirmations%rowtype;
  v_used marketing_sequence_confirmations%rowtype;
  v_key text;
  v_request text;
  v_challenge text;
  v_fp text;
begin
  v_label := marketing_require_launch_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('confirmation_id', 'challenge', 'request_id') then
      raise exception 'unknown activate argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request := p_args ->> 'request_id';
  if v_request is null or v_request !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'request_id must match ^[A-Za-z0-9_-]{8,64}$' using errcode = '22023';
  end if;
  v_challenge := p_args ->> 'challenge';
  if v_challenge is null or v_challenge !~ '^[0-9a-f]{48}$' then
    raise exception 'activation requires its server-issued confirmation challenge'
      using errcode = '22023';
  end if;
  v_fp := encode(extensions.digest(jsonb_build_object(
    'request_id', v_request, 'campaign', p_campaign, 'actor', p_actor,
    'confirmation', p_args ->> 'confirmation_id')::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|mkt_seq_act|' || p_campaign, 42));

  select * into v_used from marketing_sequence_confirmations
   where tenant_id = p_tenant and request_id = v_request;
  if found then
    if v_used.request_fingerprint = v_fp and v_used.used_at is not null then
      select * into v_c from marketing_campaigns where id = p_campaign and tenant_id = p_tenant;
      return jsonb_build_object('id', p_campaign, 'status', v_c.status,
        'version', v_c.version, 'idempotent', true);
    end if;
    raise exception 'that request_id was already used for a DIFFERENT activation'
      using errcode = 'MK412';
  end if;

  begin
    select * into v_conf from marketing_sequence_confirmations
     where id = (p_args ->> 'confirmation_id')::uuid and tenant_id = p_tenant for update;
  exception when others then
    raise exception 'invalid confirmation id' using errcode = '22023';
  end;
  if v_conf.id is null or v_conf.campaign_id is distinct from p_campaign
     or v_conf.purpose <> 'activate' then
    raise exception 'activation confirmation not found for this sequence' using errcode = 'P0002';
  end if;
  if v_conf.used_at is not null then
    raise exception 'this confirmation was already used' using errcode = 'MK412';
  end if;
  if v_conf.superseded_at is not null then
    raise exception 'the sequence changed — confirm the latest activation preflight'
      using errcode = 'MK409';
  end if;
  if v_conf.expires_at < now() then
    raise exception 'the activation confirmation has expired — preflight again'
      using errcode = 'MK416';
  end if;
  if v_conf.actor_profile_id is distinct from p_actor then
    raise exception 'the confirmation belongs to a different actor' using errcode = '42501';
  end if;
  if encode(extensions.digest(v_challenge, 'sha256'), 'hex') <> v_conf.challenge_digest then
    raise exception 'the activation challenge does not match' using errcode = '42501';
  end if;

  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant for update;
  if v_c.status <> 'approved' then
    raise exception 'only an APPROVED sequence can be activated (it is %)', v_c.status
      using errcode = '22023';
  end if;
  if v_c.version <> v_conf.campaign_version
     or v_c.current_sequence_revision_id is distinct from v_conf.revision_id then
    raise exception 'the sequence changed after preflight — preflight again' using errcode = 'MK409';
  end if;

  update marketing_sequence_confirmations
     set used_at = now(), request_id = v_request, request_fingerprint = v_fp
   where id = v_conf.id;
  update marketing_campaigns
     set status = 'active', launched_by = p_actor, launched_at = now(), version = version + 1
   where id = p_campaign returning * into v_c;

  insert into marketing_campaign_events (tenant_id, campaign_id, from_status, to_status, actor, detail)
  values (p_tenant, p_campaign, 'approved', 'active', v_label, 'sequence activated');
  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.sequence.activated', 'marketing_campaign',
          p_campaign::text, 'ok', jsonb_build_object('revision', v_conf.revision_id));
  perform marketing_event_append(p_tenant, 'marketing.sequence.activated',
    'marketing_campaign', p_campaign, 'marketing-sequences',
    jsonb_build_object('k', 'activate:' || v_request, 'actor', v_label, 'at', now()));

  return jsonb_build_object('id', p_campaign, 'status', v_c.status, 'version', v_c.version,
    'idempotent', false);
end $$;

-- ============================================================================
-- ENROLMENT — immutable batch (EVERY candidate recorded once with an exact
-- verdict) + a one-use confirmation. Manual and segment sources share one
-- code path so their evidence is identical.
-- ============================================================================
create or replace function marketing_sequence_preflight_enrolment(
  p_tenant uuid, p_actor uuid, p_campaign uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_c marketing_campaigns%rowtype;
  v_rev marketing_sequence_revisions%rowtype;
  v_seg marketing_segments%rowtype;
  v_key text;
  v_source text;
  v_people uuid[];
  v_cap int;
  v_candidates int := 0;
  v_eligible int := 0;
  v_excluded int := 0;
  v_breakdown jsonb := '{}'::jsonb;
  v_members jsonb := '[]'::jsonb;
  v_batch uuid := gen_random_uuid();
  v_hash text;
  v_challenge text;
  v_conf uuid := gen_random_uuid();
  v_samples_inc jsonb := '[]'::jsonb;
  v_samples_exc jsonb := '[]'::jsonb;
  v_sends_email boolean;
begin
  v_label := marketing_require_launch_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('source', 'person_ids', 'segment_id') then
      raise exception 'unknown enrolment argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_source := p_args ->> 'source';
  if v_source is null or v_source not in ('manual', 'segment') then
    raise exception 'source must be manual|segment' using errcode = '22023';
  end if;
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant and campaign_type = 'sequence' for update;
  if not found then
    raise exception 'sequence not found for tenant' using errcode = 'P0002';
  end if;
  if v_c.status <> 'active' then
    raise exception 'only an ACTIVE sequence can enrol People (it is %)', v_c.status
      using errcode = '22023';
  end if;
  if v_c.sequence_closed_at is not null then
    raise exception 'this sequence is closed to new enrolments' using errcode = '22023';
  end if;
  select * into v_rev from marketing_sequence_revisions
   where tenant_id = p_tenant and id = v_c.current_sequence_revision_id;
  if not found then
    raise exception 'sequence has no current revision' using errcode = 'P0002';
  end if;
  if v_source = 'manual' and v_rev.entry_policy = 'segment_only' then
    raise exception 'this sequence accepts segment enrolment only' using errcode = '22023';
  end if;
  if v_source = 'segment' and v_rev.entry_policy = 'manual_only' then
    raise exception 'this sequence accepts manual enrolment only' using errcode = '22023';
  end if;
  select coalesce(max_sequence_enrolments, 500) into v_cap
    from marketing_settings where tenant_id = p_tenant;
  v_cap := coalesce(v_cap, 500);
  -- does this journey actually send? An internal-only sequence must not
  -- exclude a Person for an email reason.
  select exists (select 1 from marketing_sequence_steps s
                  where s.tenant_id = p_tenant and s.revision_id = v_rev.id
                    and s.step_type = 'send_email')
    into v_sends_email;

  if v_source = 'segment' then
    begin
      select * into v_seg from marketing_segments
       where id = (p_args ->> 'segment_id')::uuid and tenant_id = p_tenant;
    exception when others then
      raise exception 'invalid segment id' using errcode = '22023';
    end;
    if v_seg.id is null then
      raise exception 'segment not found for tenant' using errcode = 'P0002';
    end if;
    if v_seg.status <> 'active' then
      raise exception 'segment is archived' using errcode = '22023';
    end if;
    select array_agg(p.id order by p.created_at, p.id) into v_people
      from people p
     where p.tenant_id = p_tenant
       and marketing_segment_match_person(p_tenant, p.id, v_seg.definition);
  else
    if jsonb_typeof(p_args -> 'person_ids') <> 'array'
       or jsonb_array_length(p_args -> 'person_ids') = 0 then
      raise exception 'person_ids must be a non-empty array' using errcode = '22023';
    end if;
    begin
      select array_agg(distinct (v.value #>> '{}')::uuid)
        into v_people from jsonb_array_elements(p_args -> 'person_ids') v;
    exception when others then
      raise exception 'person_ids must all be uuids' using errcode = '22023';
    end;
  end if;
  v_people := coalesce(v_people, '{}'::uuid[]);
  v_candidates := coalesce(array_length(v_people, 1), 0);
  if v_candidates > v_cap then
    raise exception 'enrolment audience (% candidates) exceeds the tenant guardrail max_sequence_enrolments = %',
      v_candidates, v_cap using errcode = 'MK413';
  end if;

  -- EVERY candidate, with the canonical eligibility verdict and the exact
  -- reason it is or is not enrollable. Same evidence shape as a Phase-5
  -- audience snapshot.
  with cand as (
    select p.id as person_id, p.company_id, p.created_at,
           jsonb_build_object(
             'first_name', nullif(left(regexp_replace(coalesce(p.first_name, ''), '[[:cntrl:]]', '', 'g'), 200), ''),
             'last_name', nullif(left(regexp_replace(coalesce(p.last_name, ''), '[[:cntrl:]]', '', 'g'), 200), ''),
             'display_name', nullif(left(regexp_replace(coalesce(p.display_name, ''), '[[:cntrl:]]', '', 'g'), 200), ''),
             'company_name', nullif(left(regexp_replace(coalesce(c.name, ''), '[[:cntrl:]]', '', 'g'), 200), '')
           ) as context
      from people p
      left join companies c on c.id = p.company_id and c.tenant_id = p.tenant_id
     where p.tenant_id = p_tenant and p.id = any(v_people)
  ), resolved as (
    select cd.*, ep.contact_point_id, ep.destination,
           marketing_endpoint_eligibility(p_tenant, cd.person_id, 'email', ep.contact_point_id) as state
      from cand cd
      left join lateral marketing_broadcast_resolve_endpoint(p_tenant, cd.person_id) ep on true
  ), reasoned as (
    select rs.*,
           -- EMAIL eligibility only governs a journey that sends email
           (case
              when not v_sends_email then '{}'::text[]
              when rs.state = 'subscribed' then
                case when rs.contact_point_id is null then array['no_contact_point'] else '{}'::text[] end
              else array[case rs.state
                     when 'unsubscribed' then 'unsubscribed'
                     when 'suppressed' then 'hard_suppression'
                     when 'invalid' then 'invalid_destination'
                     when 'no_contact_point' then 'no_contact_point'
                     else 'unknown_preference' end]
            end)
           || (case when v_sends_email and exists (
                     select 1 from unnest(v_rev.tokens_required) t(tok)
                      where coalesce(rs.context ->> t.tok, '') = ''
                        and not exists (select 1 from marketing_sequence_steps s
                                         where s.tenant_id = p_tenant and s.revision_id = v_rev.id
                                           and s.step_type = 'send_email'
                                           and (s.config -> 'token_fallbacks') ? t.tok))
                    then array['missing_personalisation'] else '{}'::text[] end)
           -- an ALREADY-LIVE enrolment is not a candidate; a previously exited
           -- Person depends on the revision's stored re-enrolment policy
           || (case when exists (select 1 from marketing_sequence_enrolments e
                                  where e.tenant_id = p_tenant and e.campaign_id = p_campaign
                                    and e.person_id = rs.person_id
                                    and e.status in ('active', 'paused', 'held'))
                    then array['already_enrolled']
                    when v_rev.reenrolment_policy = 'never'
                         and exists (select 1 from marketing_sequence_enrolments e
                                      where e.tenant_id = p_tenant and e.campaign_id = p_campaign
                                        and e.person_id = rs.person_id)
                    then array['reenrolment_not_permitted']
                    else '{}'::text[] end)
           || (case when v_sends_email and rs.destination is not null
                     and count(*) over (partition by rs.destination) > 1
                    then array['duplicate_shared_destination'] else '{}'::text[] end) as reasons
      from resolved rs
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', rd.person_id, 'company_id', rd.company_id,
           'contact_point_id', rd.contact_point_id, 'destination', rd.destination,
           'eligibility_state', rd.state, 'reasons', to_jsonb(rd.reasons),
           'context', rd.context) order by rd.created_at, rd.person_id), '[]'::jsonb),
         count(*) filter (where cardinality(rd.reasons) = 0),
         count(*) filter (where cardinality(rd.reasons) > 0)
    into v_members, v_eligible, v_excluded
    from reasoned rd;

  select coalesce(jsonb_object_agg(x.reason, x.n), '{}'::jsonb) into v_breakdown from (
    select reason, count(*)::int as n
      from jsonb_array_elements(v_members) m(value)
      cross join lateral jsonb_array_elements_text(m.value -> 'reasons') as t(reason)
     group by reason) x;
  select coalesce(jsonb_agg(s.j order by s.i), '[]'::jsonb) into v_samples_inc from (
    select jsonb_build_object('destination_masked',
             regexp_replace(m.value ->> 'destination', '^(.).*(@.*)$', '\1***\2')) as j,
           row_number() over () as i
      from jsonb_array_elements(v_members) m(value)
     where jsonb_array_length(m.value -> 'reasons') = 0 limit 5) s;
  select coalesce(jsonb_agg(s.j order by s.i), '[]'::jsonb) into v_samples_exc from (
    select jsonb_build_object(
             'destination_masked', case when m.value ->> 'destination' is null then null
               else regexp_replace(m.value ->> 'destination', '^(.).*(@.*)$', '\1***\2') end,
             'reasons', m.value -> 'reasons') as j,
           row_number() over () as i
      from jsonb_array_elements(v_members) m(value)
     where jsonb_array_length(m.value -> 'reasons') > 0 limit 5) s;

  v_hash := encode(extensions.digest(jsonb_build_object(
    'campaign', p_campaign, 'revision', v_rev.id, 'bundle', v_rev.bundle_hash,
    'source', v_source, 'segment', v_seg.id, 'segment_version', v_seg.definition_version,
    'members', v_members)::text, 'sha256'), 'hex');

  insert into marketing_enrolment_batches
    (id, tenant_id, campaign_id, revision_id, source, segment_id, segment_version,
     segment_hash, candidate_count, eligible_count, excluded_count, exclusion_breakdown,
     batch_hash, created_by)
  values
    (v_batch, p_tenant, p_campaign, v_rev.id, v_source, v_seg.id, v_seg.definition_version,
     case when v_seg.id is null then null
          else encode(extensions.digest(v_seg.definition::text, 'sha256'), 'hex') end,
     v_candidates, v_eligible, v_excluded, v_breakdown, v_hash, p_actor);

  insert into marketing_enrolment_candidates
    (tenant_id, batch_id, campaign_id, person_id, contact_point_id, destination,
     eligible, exclusion_reasons, eligibility_state, personalisation)
  select p_tenant, v_batch, p_campaign, (m.value ->> 'person_id')::uuid,
         case when jsonb_array_length(m.value -> 'reasons') = 0 and v_sends_email
              then (m.value ->> 'contact_point_id')::uuid else null end,
         case when jsonb_array_length(m.value -> 'reasons') = 0 and v_sends_email
              then m.value ->> 'destination' else null end,
         jsonb_array_length(m.value -> 'reasons') = 0,
         array(select jsonb_array_elements_text(m.value -> 'reasons')),
         m.value ->> 'eligibility_state', m.value -> 'context'
    from jsonb_array_elements(v_members) m(value);

  update marketing_sequence_confirmations set superseded_at = now()
   where tenant_id = p_tenant and campaign_id = p_campaign and purpose = 'enrol'
     and used_at is null and superseded_at is null;
  v_challenge := encode(extensions.gen_random_bytes(24), 'hex');
  insert into marketing_sequence_confirmations
    (id, tenant_id, campaign_id, campaign_version, revision_id, purpose, batch_id,
     bundle_hash, actor_profile_id, challenge_digest, expires_at)
  values (v_conf, p_tenant, p_campaign, v_c.version, v_rev.id, 'enrol', v_batch,
          v_rev.bundle_hash, p_actor,
          encode(extensions.digest(v_challenge, 'sha256'), 'hex'), now() + interval '15 minutes');

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.sequence.enrolment_preflight', 'marketing_campaign',
          p_campaign::text, 'ok', jsonb_build_object('batch', v_batch, 'candidates', v_candidates,
                                                     'eligible', v_eligible));
  perform marketing_event_append(p_tenant, 'marketing.sequence.enrolment_previewed',
    'marketing_campaign', p_campaign, 'marketing-sequences',
    jsonb_build_object('k', 'enrol_preview:' || v_batch, 'actor', v_label, 'at', now()));

  return jsonb_build_object('batch_id', v_batch, 'batch_hash', v_hash,
    'candidate_count', v_candidates, 'eligible_count', v_eligible,
    'excluded_count', v_excluded, 'exclusion_breakdown', v_breakdown,
    'included_samples', v_samples_inc, 'excluded_samples', v_samples_exc,
    'revision_id', v_rev.id, 'revision_number', v_rev.revision_number,
    'segment_version', v_seg.definition_version, 'source', v_source,
    'confirmation_id', v_conf, 'challenge', v_challenge,
    'expires_at', now() + interval '15 minutes', 'max_sequence_enrolments', v_cap);
end $$;

create or replace function marketing_sequence_confirm_enrolment(
  p_tenant uuid, p_actor uuid, p_campaign uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_c marketing_campaigns%rowtype;
  v_conf marketing_sequence_confirmations%rowtype;
  v_used marketing_sequence_confirmations%rowtype;
  v_batch marketing_enrolment_batches%rowtype;
  v_rev marketing_sequence_revisions%rowtype;
  v_key text;
  v_request text;
  v_challenge text;
  v_fp text;
  v_created int := 0;
begin
  v_label := marketing_require_launch_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('confirmation_id', 'challenge', 'request_id') then
      raise exception 'unknown confirm argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request := p_args ->> 'request_id';
  if v_request is null or v_request !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'request_id must match ^[A-Za-z0-9_-]{8,64}$' using errcode = '22023';
  end if;
  v_challenge := p_args ->> 'challenge';
  if v_challenge is null or v_challenge !~ '^[0-9a-f]{48}$' then
    raise exception 'enrolment requires its server-issued confirmation challenge'
      using errcode = '22023';
  end if;
  v_fp := encode(extensions.digest(jsonb_build_object(
    'request_id', v_request, 'campaign', p_campaign, 'actor', p_actor,
    'confirmation', p_args ->> 'confirmation_id')::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|mkt_seq_enrol|' || p_campaign, 42));

  select * into v_used from marketing_sequence_confirmations
   where tenant_id = p_tenant and request_id = v_request;
  if found then
    if v_used.request_fingerprint = v_fp and v_used.used_at is not null then
      return jsonb_build_object('batch_id', v_used.batch_id, 'idempotent', true,
        'enrolled', (select enrolled_count from marketing_enrolment_batches
                      where id = v_used.batch_id and tenant_id = p_tenant));
    end if;
    raise exception 'that request_id was already used for a DIFFERENT enrolment'
      using errcode = 'MK412';
  end if;

  begin
    select * into v_conf from marketing_sequence_confirmations
     where id = (p_args ->> 'confirmation_id')::uuid and tenant_id = p_tenant for update;
  exception when others then
    raise exception 'invalid confirmation id' using errcode = '22023';
  end;
  if v_conf.id is null or v_conf.campaign_id is distinct from p_campaign
     or v_conf.purpose <> 'enrol' then
    raise exception 'enrolment confirmation not found for this sequence' using errcode = 'P0002';
  end if;
  if v_conf.used_at is not null then
    raise exception 'this confirmation was already used' using errcode = 'MK412';
  end if;
  if v_conf.superseded_at is not null then
    raise exception 'a newer enrolment preflight exists — confirm the latest one'
      using errcode = 'MK409';
  end if;
  if v_conf.expires_at < now() then
    raise exception 'the enrolment confirmation has expired — preflight again'
      using errcode = 'MK416';
  end if;
  if v_conf.actor_profile_id is distinct from p_actor then
    raise exception 'the confirmation belongs to a different actor' using errcode = '42501';
  end if;
  if encode(extensions.digest(v_challenge, 'sha256'), 'hex') <> v_conf.challenge_digest then
    raise exception 'the enrolment challenge does not match' using errcode = '42501';
  end if;

  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant for update;
  if v_c.status <> 'active' then
    raise exception 'only an ACTIVE sequence can enrol People (it is %)', v_c.status
      using errcode = '22023';
  end if;
  if v_c.sequence_closed_at is not null then
    raise exception 'this sequence is closed to new enrolments' using errcode = '22023';
  end if;
  if v_c.current_sequence_revision_id is distinct from v_conf.revision_id then
    raise exception 'the sequence revision changed after preflight — preflight again'
      using errcode = 'MK409';
  end if;
  select * into v_batch from marketing_enrolment_batches
   where id = v_conf.batch_id and tenant_id = p_tenant for update;
  if v_batch.confirmed_at is not null then
    raise exception 'this enrolment batch was already confirmed' using errcode = 'MK412';
  end if;
  select * into v_rev from marketing_sequence_revisions
   where tenant_id = p_tenant and id = v_conf.revision_id;

  -- create EXACTLY one enrolment per eligible candidate. The dedup key makes
  -- the write convergent under parallel confirmation.
  insert into marketing_sequence_enrolments
    (tenant_id, campaign_id, revision_id, batch_id, person_id, company_id,
     contact_point_id, destination, personalisation, source, source_evidence,
     enrolled_by, next_eligible_at, dedup_key)
  select p_tenant, p_campaign, v_conf.revision_id, v_batch.id, c.person_id,
         (select p.company_id from people p where p.id = c.person_id and p.tenant_id = p_tenant),
         c.contact_point_id, c.destination, c.personalisation, v_batch.source,
         jsonb_build_object('batch_id', v_batch.id, 'batch_hash', v_batch.batch_hash,
                            'source', v_batch.source, 'segment_id', v_batch.segment_id,
                            'segment_version', v_batch.segment_version, 'actor', v_label),
         p_actor, now(),
         'seq:' || p_campaign || ':' || c.person_id || ':' ||
           (select count(*) from marketing_sequence_enrolments e
             where e.tenant_id = p_tenant and e.campaign_id = p_campaign
               and e.person_id = c.person_id)
    from marketing_enrolment_candidates c
   where c.tenant_id = p_tenant and c.batch_id = v_batch.id and c.eligible
  on conflict (tenant_id, dedup_key) do nothing;
  get diagnostics v_created = row_count;

  update marketing_sequence_confirmations
     set used_at = now(), request_id = v_request, request_fingerprint = v_fp
   where id = v_conf.id;
  update marketing_enrolment_batches
     set confirmed_at = now(), enrolled_count = v_created
   where id = v_batch.id;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.sequence.enrolment_confirmed', 'marketing_campaign',
          p_campaign::text, 'ok', jsonb_build_object('batch', v_batch.id, 'enrolled', v_created));
  perform marketing_event_append(p_tenant, 'marketing.sequence.enrolment_confirmed',
    'marketing_campaign', p_campaign, 'marketing-sequences',
    jsonb_build_object('k', 'enrol_confirm:' || v_batch.id, 'enrolled', v_created,
                       'actor', v_label, 'at', now()));

  return jsonb_build_object('batch_id', v_batch.id, 'enrolled', v_created,
    'eligible', v_batch.eligible_count, 'idempotent', false);
end $$;

-- ============================================================================
-- THE ONE SEQUENCE SEND AUTHORITY — the canonical recheck used by the worker
-- BEFORE any intent exists and by the Gmail adapter IMMEDIATELY before its
-- single provider call. Fail-closed; there is NO override.
-- ============================================================================
create or replace function marketing_sequence_authority_core(
  p_tenant uuid, p_enrolment uuid, p_execution uuid, p_require_email boolean default true
) returns jsonb
language plpgsql
stable
as $$
declare
  v_e marketing_sequence_enrolments%rowtype;
  v_c marketing_campaigns%rowtype;
  v_rev marketing_sequence_revisions%rowtype;
  v_appr marketing_sequence_approvals%rowtype;
  v_x marketing_sequence_executions%rowtype;
  v_cp contact_points%rowtype;
  v_rd jsonb;
  v_state text;
  v_role text;
  v_atenant uuid;
begin
  if exists (select 1 from marketing_settings s
              where s.tenant_id = p_tenant and not s.marketing_enabled) then
    return jsonb_build_object('allowed', false, 'code', 'marketing_disabled');
  end if;
  select * into v_e from marketing_sequence_enrolments
   where id = p_enrolment and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('allowed', false, 'code', 'enrolment_missing');
  end if;
  if v_e.status <> 'active' then
    return jsonb_build_object('allowed', false, 'code', 'enrolment_not_active',
                              'state', v_e.status);
  end if;
  select * into v_c from marketing_campaigns where id = v_e.campaign_id and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('allowed', false, 'code', 'campaign_missing');
  end if;
  if v_c.status <> 'active' then
    return jsonb_build_object('allowed', false, 'code', 'campaign_not_active',
                              'state', v_c.status);
  end if;
  select * into v_rev from marketing_sequence_revisions
   where id = v_e.revision_id and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('allowed', false, 'code', 'revision_missing');
  end if;
  if p_execution is not null then
    select * into v_x from marketing_sequence_executions
     where id = p_execution and tenant_id = p_tenant;
    if not found or v_x.enrolment_id is distinct from p_enrolment
       or v_x.revision_id is distinct from v_e.revision_id then
      return jsonb_build_object('allowed', false, 'code', 'execution_binding_changed');
    end if;
  end if;
  -- the approval of the PINNED revision must still be valid, by an approver who
  -- is STILL a same-tenant owner/admin holding canonical campaigns.launch
  select * into v_appr from marketing_sequence_approvals a
   where a.tenant_id = p_tenant and a.campaign_id = v_e.campaign_id
     and a.revision_id = v_e.revision_id and a.decision = 'approved'
   order by a.created_at desc limit 1;
  if not found then
    return jsonb_build_object('allowed', false, 'code', 'sequence_approval_missing');
  end if;
  if v_appr.bundle_hash is distinct from v_rev.bundle_hash then
    return jsonb_build_object('allowed', false, 'code', 'approved_bundle_changed');
  end if;
  if v_appr.approver_profile_id is null then
    return jsonb_build_object('allowed', false, 'code', 'sequence_approver_removed');
  end if;
  select tenant_id, role into v_atenant, v_role from profiles
   where id = v_appr.approver_profile_id;
  if not found or v_atenant is distinct from p_tenant
     or v_role not in ('owner', 'admin')
     or not ((marketing_effective_permissions(v_appr.approver_profile_id) -> 'permissions')
             ? 'marketing.campaigns.launch') then
    return jsonb_build_object('allowed', false, 'code', 'sequence_approver_no_longer_authorised');
  end if;
  -- ── EMAIL PRECONDITIONS ──────────────────────────────────────────────────
  -- Everything above governs the SEQUENCE (marketing enabled, campaign active,
  -- enrolment active, pinned revision, valid approval). Everything below
  -- governs SENDING EMAIL. A tag/lifecycle/owner/follow-up step must never be
  -- blocked because a sender is unconfigured or the Person unsubscribed from
  -- marketing email — those facts say nothing about an internal action.
  if not p_require_email then
    return jsonb_build_object('allowed', true, 'code', 'ok');
  end if;
  -- sender still enabled + CURRENTLY ready
  if not exists (select 1 from marketing_sender_profiles p
                  where p.id = v_rev.sender_profile_id and p.tenant_id = p_tenant and p.enabled) then
    return jsonb_build_object('allowed', false, 'code', 'sender_disabled');
  end if;
  v_rd := marketing_sender_readiness(p_tenant, v_rev.sender_profile_id);
  if not (v_rd ->> 'ready')::boolean then
    return jsonb_build_object('allowed', false, 'code', 'sender_not_ready',
                              'state', v_rd ->> 'state');
  end if;
  if not coalesce((select c2.enabled from tenant_connector_capabilities c2
                    where c2.tenant_id = p_tenant and c2.connector_id = 'google-gmail'
                      and c2.capability_key = 'email.send_marketing'), false) then
    return jsonb_build_object('allowed', false, 'code', 'capability_disabled');
  end if;
  -- the PINNED endpoint must still be this Person's same usable point
  select * into v_cp from contact_points cp
   where cp.id = v_e.contact_point_id and cp.tenant_id = p_tenant;
  if not found or v_cp.person_id is distinct from v_e.person_id
     or v_cp.channel <> 'email'
     or v_cp.normalized_value is distinct from v_e.destination
     or v_cp.verification_state = 'invalid' then
    return jsonb_build_object('allowed', false, 'code', 'endpoint_changed');
  end if;
  -- CURRENT eligibility, re-derived LIVE through the ONE canonical authority
  v_state := marketing_endpoint_eligibility(p_tenant, v_e.person_id, 'email', v_e.contact_point_id);
  if v_state <> 'subscribed' then
    return jsonb_build_object('allowed', false, 'code', 'not_subscribed', 'state', v_state);
  end if;
  return jsonb_build_object('allowed', true, 'code', 'ok');
end $$;

create or replace function marketing_sequence_send_authority(p_tenant uuid, p_delivery uuid)
returns jsonb
language plpgsql
stable
as $$
declare v_d marketing_deliveries%rowtype;
begin
  if p_tenant is null or p_delivery is null then
    raise exception 'tenant and delivery required' using errcode = '22023';
  end if;
  select * into v_d from marketing_deliveries where id = p_delivery and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('allowed', false, 'code', 'delivery_missing');
  end if;
  if v_d.purpose <> 'sequence' then
    return jsonb_build_object('allowed', false, 'code', 'not_a_sequence_delivery');
  end if;
  return marketing_sequence_authority_core(
    p_tenant, v_d.sequence_enrolment_id, v_d.sequence_execution_id, true);
end $$;

-- ============================================================================
-- COMPLETION — derived, never invented. A sequence completes only when it has
-- been CLOSED to enrolment and no enrolment or execution is still live.
-- ============================================================================
create or replace function marketing_sequence_check_completion(p_tenant uuid, p_campaign uuid)
returns boolean
language plpgsql
as $$
declare v_c marketing_campaigns%rowtype;
begin
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant and campaign_type = 'sequence' for update;
  if not found or v_c.status <> 'active' or v_c.sequence_closed_at is null then
    return false;
  end if;
  if exists (select 1 from marketing_sequence_enrolments e
              where e.tenant_id = p_tenant and e.campaign_id = p_campaign
                and e.status in ('active', 'paused', 'held')) then
    return false;
  end if;
  if exists (select 1 from marketing_sequence_executions x
              where x.tenant_id = p_tenant and x.campaign_id = p_campaign
                and x.status in ('pending', 'preparing', 'queued', 'executing', 'unknown')) then
    return false;
  end if;
  update marketing_campaigns
     set status = 'completed', completed_at = now(), version = version + 1
   where id = p_campaign;
  insert into marketing_campaign_events (tenant_id, campaign_id, from_status, to_status, actor, detail)
  values (p_tenant, p_campaign, 'active', 'completed', 'reconciler',
          'closed to enrolment and every enrolment reached a terminal state');
  perform marketing_event_append(p_tenant, 'marketing.sequence.completed',
    'marketing_campaign', p_campaign, 'marketing-sequences',
    jsonb_build_object('k', 'seq_completed:' || p_campaign, 'at', now()));
  return true;
end $$;

-- ── governed exit: append-only, idempotent, evidence-backed ─────────────────
create or replace function marketing_sequence_exit_enrolment(
  p_tenant uuid, p_enrolment uuid, p_reason text, p_evidence jsonb, p_actor_label text
) returns boolean
language plpgsql
as $$
declare v_e marketing_sequence_enrolments%rowtype;
begin
  select * into v_e from marketing_sequence_enrolments
   where id = p_enrolment and tenant_id = p_tenant for update;
  if not found then
    return false;
  end if;
  if v_e.status in ('completed', 'exited') then
    return false;   -- idempotent: an already-terminal enrolment never re-exits
  end if;
  update marketing_sequence_enrolments
     set status = 'exited', exit_reason = p_reason, exited_at = now(),
         exit_evidence = coalesce(p_evidence, '{}'::jsonb)
                         || jsonb_build_object('actor', coalesce(p_actor_label, 'system'), 'at', now()),
         next_eligible_at = null
   where id = p_enrolment;
  update marketing_sequence_executions
     set status = 'cancelled', finished_at = now()
   where tenant_id = p_tenant and enrolment_id = p_enrolment and status = 'pending';
  perform marketing_event_append(p_tenant, 'marketing.sequence.enrolment_exited',
    'marketing_enrolment', p_enrolment, 'marketing-sequences',
    jsonb_build_object('k', 'exit:' || p_enrolment, 'reason', p_reason, 'at', now()));
  perform marketing_sequence_check_completion(p_tenant, v_e.campaign_id);
  return true;
end $$;

-- ============================================================================
-- SCHEDULER DISCOVERY + CLAIMS
--  * marketing_sequence_due: which tenants have claimable work (never sends).
--  * marketing_sequence_claim_batch: leases a bounded, disjoint batch. Wait
--    steps are resolved HERE, in SQL, from the factual arrival time — so a
--    late worker can never make a wait drift.
-- ============================================================================
create or replace function marketing_sequence_due(p_limit int default 50)
returns table (tenant_id uuid, due_enrolments int)
language sql
stable
as $$
  select e.tenant_id, count(*)::int
    from marketing_sequence_enrolments e
    join marketing_campaigns c on c.id = e.campaign_id and c.tenant_id = e.tenant_id
   where e.status = 'active' and c.status = 'active'
     and (e.next_eligible_at is null or e.next_eligible_at <= now())
   group by e.tenant_id
   order by 2 desc
   limit greatest(1, least(200, p_limit));
$$;

create or replace function marketing_sequence_claim_batch(
  p_tenant uuid, p_worker text, p_limit int default 10, p_lease_seconds int default 120
) returns setof marketing_sequence_executions
language plpgsql
as $$
declare
  r record;
  v_step marketing_sequence_steps%rowtype;
  v_rev marketing_sequence_revisions%rowtype;
  v_exec marketing_sequence_executions%rowtype;
  v_next timestamptz;
  v_claimed uuid[] := '{}';
  v_n int := 0;
begin
  if p_tenant is null or coalesce(p_worker, '') = '' then
    raise exception 'tenant and worker required' using errcode = '22023';
  end if;
  for r in
    select e.* from marketing_sequence_enrolments e
     join marketing_campaigns c on c.id = e.campaign_id and c.tenant_id = e.tenant_id
    where e.tenant_id = p_tenant
      and e.status = 'active'
      and c.status = 'active'
      and (e.next_eligible_at is null or e.next_eligible_at <= now())
    order by e.next_eligible_at nulls first, e.created_at, e.id
    for update of e skip locked
    limit greatest(1, least(25, p_limit))
  loop
    select * into v_rev from marketing_sequence_revisions
     where id = r.revision_id and tenant_id = p_tenant;
    select * into v_step from marketing_sequence_steps
     where tenant_id = p_tenant and revision_id = r.revision_id
       and step_order = r.current_step_order;
    if not found then
      -- past the last step: the enrolment has genuinely completed the journey
      update marketing_sequence_enrolments
         set status = 'completed', completed_at = now(), next_eligible_at = null
       where id = r.id;
      perform marketing_event_append(p_tenant, 'marketing.sequence.enrolment_completed',
        'marketing_enrolment', r.id, 'marketing-sequences',
        jsonb_build_object('k', 'complete:' || r.id, 'at', now()));
      perform marketing_sequence_check_completion(p_tenant, r.campaign_id);
      continue;
    end if;

    -- one execution per (enrolment, revision, step, generation) — convergent
    select * into v_exec from marketing_sequence_executions
     where tenant_id = p_tenant and enrolment_id = r.id and revision_id = r.revision_id
       and step_id = v_step.id and generation = r.generation;
    if not found then
      if v_step.step_type = 'wait_duration' then
        v_next := now() + case v_step.config ->> 'unit'
                            when 'minutes' then make_interval(mins => (v_step.config ->> 'amount')::int)
                            when 'hours'   then make_interval(hours => (v_step.config ->> 'amount')::int)
                            else make_interval(days => (v_step.config ->> 'amount')::int) end;
      elsif v_step.step_type = 'wait_until_window' then
        v_next := marketing_sequence_next_window(
          v_rev.timezone, v_step.config -> 'days',
          (v_step.config ->> 'start_hour')::int, (v_step.config ->> 'end_hour')::int,
          v_step.config ->> 'ambiguous_policy', now());
      else
        v_next := null;
      end if;
      insert into marketing_sequence_executions
        (tenant_id, enrolment_id, campaign_id, revision_id, step_id, step_order, step_type,
         generation, scheduled_for, evidence)
      values (p_tenant, r.id, r.campaign_id, r.revision_id, v_step.id, v_step.step_order,
              v_step.step_type, r.generation, v_next,
              jsonb_build_object('arrived_at', now()))
      returning * into v_exec;
      perform marketing_event_append(p_tenant, 'marketing.sequence.step_due',
        'marketing_enrolment', r.id, 'marketing-sequences',
        jsonb_build_object('k', 'due:' || v_exec.id, 'step', v_step.step_order,
                           'type', v_step.step_type, 'at', now()));
    end if;

    -- WAIT steps are a scheduling FACT resolved in SQL, never worker work
    if v_step.step_type in ('wait_duration', 'wait_until_window') then
      if v_exec.scheduled_for is null then
        -- a window that matches no day within a fortnight is a configuration
        -- fault: hold the enrolment for a human rather than guess
        update marketing_sequence_executions
           set status = 'failed', failure_class = 'configuration_no_matching_window',
               finished_at = now()
         where id = v_exec.id and status = 'pending';
        update marketing_sequence_enrolments
           set status = 'held', hold_reason = 'no matching local-time window in the next 14 days',
               next_eligible_at = null
         where id = r.id;
      elsif v_exec.scheduled_for <= now() then
        update marketing_sequence_executions set status = 'preparing',
               lease_worker = p_worker, lease_expires_at = now() + interval '30 seconds',
               started_at = coalesce(started_at, now())
         where id = v_exec.id and status = 'pending';
        update marketing_sequence_executions set status = 'succeeded', finished_at = now(),
               evidence = evidence || jsonb_build_object('waited_until', v_exec.scheduled_for)
         where id = v_exec.id;
        update marketing_sequence_enrolments
           set current_step_order = current_step_order + 1, next_eligible_at = now(),
               last_execution_at = now()
         where id = r.id;
      else
        update marketing_sequence_enrolments set next_eligible_at = v_exec.scheduled_for
         where id = r.id;
      end if;
      continue;
    end if;

    -- SIDE-EFFECTING steps are leased for the worker
    if v_exec.status = 'pending' then
      -- quiet hours defer email preparation (tenant-local, DST-correct)
      if v_step.step_type = 'send_email' then
        v_next := marketing_sequence_apply_quiet_hours(
          v_rev.timezone, v_rev.quiet_hours_start, v_rev.quiet_hours_end, now());
        if v_next > now() then
          update marketing_sequence_enrolments set next_eligible_at = v_next where id = r.id;
          continue;
        end if;
      end if;
      update marketing_sequence_executions
         set status = 'preparing', lease_worker = p_worker,
             lease_expires_at = now() + make_interval(secs => greatest(30, least(600, p_lease_seconds))),
             started_at = coalesce(started_at, now())
       where id = v_exec.id
      returning * into v_exec;
      v_claimed := v_claimed || v_exec.id;
      v_n := v_n + 1;
    elsif v_exec.status = 'preparing' and v_exec.lease_expires_at < now() then
      update marketing_sequence_executions
         set lease_worker = p_worker,
             lease_expires_at = now() + make_interval(secs => greatest(30, least(600, p_lease_seconds)))
       where id = v_exec.id
      returning * into v_exec;
      v_claimed := v_claimed || v_exec.id;
      v_n := v_n + 1;
    end if;
  end loop;

  return query select * from marketing_sequence_executions
                where tenant_id = p_tenant and id = any(v_claimed);
end $$;

-- ============================================================================
-- STEP BUNDLE — the frozen inputs a worker may render from, plus the canonical
-- authority recheck BEFORE any intent exists (race closure, check 2 of 3).
-- ============================================================================
create or replace function marketing_sequence_step_bundle(
  p_tenant uuid, p_execution uuid, p_worker text
) returns jsonb
language plpgsql
as $$
declare
  v_x marketing_sequence_executions%rowtype;
  v_e marketing_sequence_enrolments%rowtype;
  v_c marketing_campaigns%rowtype;
  v_rev marketing_sequence_revisions%rowtype;
  v_step marketing_sequence_steps%rowtype;
  v_sender marketing_sender_profiles%rowtype;
  v_appr marketing_sequence_approvals%rowtype;
  v_verdict jsonb;
  v_token text;
  v_token_id uuid := gen_random_uuid();
begin
  select * into v_x from marketing_sequence_executions
   where id = p_execution and tenant_id = p_tenant for update;
  if not found then
    raise exception 'execution not found for tenant' using errcode = 'P0002';
  end if;
  if v_x.status <> 'preparing' or v_x.lease_worker is distinct from p_worker
     or v_x.lease_expires_at < now() then
    raise exception 'execution is not leased by this worker' using errcode = 'MK423';
  end if;
  if v_x.automation_intent_id is not null then
    return jsonb_build_object('already_prepared', true, 'intent_id', v_x.automation_intent_id,
      'delivery_id', v_x.delivery_id);
  end if;
  select * into v_e from marketing_sequence_enrolments
   where id = v_x.enrolment_id and tenant_id = p_tenant;
  select * into v_c from marketing_campaigns where id = v_x.campaign_id and tenant_id = p_tenant;
  select * into v_rev from marketing_sequence_revisions
   where id = v_x.revision_id and tenant_id = p_tenant;
  select * into v_step from marketing_sequence_steps
   where id = v_x.step_id and tenant_id = p_tenant;

  -- RACE CLOSURE (check 2 of 3) — the SAME canonical authority the adapter
  -- calls pre-provider. Applied to EVERY side-effecting step, not just email.
  v_verdict := marketing_sequence_authority_core(
    p_tenant, v_e.id, v_x.id, v_step.step_type = 'send_email');
  if not (v_verdict ->> 'allowed')::boolean then
    if (v_verdict ->> 'code') in ('campaign_not_active', 'campaign_missing',
                                  'enrolment_not_active') then
      if v_c.status = 'cancelled' or v_e.status = 'exited' then
        update marketing_sequence_executions
           set status = 'cancelled', lease_worker = null, lease_expires_at = null,
               finished_at = now()
         where id = p_execution;
        return jsonb_build_object('cancelled', true, 'code', v_verdict ->> 'code');
      end if;
      update marketing_sequence_executions
         set status = 'pending', lease_worker = null, lease_expires_at = null
       where id = p_execution;
      return jsonb_build_object('deferred', true, 'code', v_verdict ->> 'code');
    end if;
    -- a POLICY block: the approved sequence policy decides exit vs skip
    update marketing_sequence_executions
       set status = 'skipped', skip_reason = 'policy_' || (v_verdict ->> 'code'),
           finished_at = now()
     where id = p_execution;
    perform marketing_event_append(p_tenant, 'marketing.sequence.step_skipped_by_policy',
      'marketing_enrolment', v_e.id, 'marketing-sequences',
      jsonb_build_object('k', 'skip:' || p_execution, 'reason', v_verdict ->> 'code',
                         'step', v_x.step_order, 'at', now()));
    if v_rev.policy_block_action = 'exit' then
      perform marketing_sequence_exit_enrolment(p_tenant, v_e.id,
        case (v_verdict ->> 'code')
          when 'not_subscribed' then
            case (v_verdict ->> 'state') when 'unsubscribed' then 'unsubscribed'
                                         when 'suppressed' then 'hard_suppression'
                                         else 'policy_blocked' end
          when 'endpoint_changed' then 'endpoint_invalid'
          else 'policy_blocked' end,
        jsonb_build_object('code', v_verdict ->> 'code', 'state', v_verdict ->> 'state',
                           'execution_id', p_execution), 'sequence-worker');
    else
      update marketing_sequence_enrolments
         set current_step_order = current_step_order + 1, next_eligible_at = now(),
             last_execution_at = now()
       where id = v_e.id;
    end if;
    return jsonb_build_object('skipped', true, 'code', v_verdict ->> 'code',
      'policy', v_rev.policy_block_action);
  end if;

  select * into v_sender from marketing_sender_profiles
   where tenant_id = p_tenant and id = v_rev.sender_profile_id;
  select * into v_appr from marketing_sequence_approvals a
   where a.tenant_id = p_tenant and a.campaign_id = v_x.campaign_id
     and a.revision_id = v_x.revision_id and a.decision = 'approved'
   order by a.created_at desc limit 1;

  if v_step.step_type = 'send_email' then
    -- mint this send's opaque unsubscribe token; any prior unused token for
    -- this execution is revoked so exactly one can ever be live
    update marketing_unsubscribe_tokens set revoked_at = now()
     where tenant_id = p_tenant and person_id = v_e.person_id
       and campaign_id = v_x.campaign_id
       and used_at is null and revoked_at is null
       and (created_at, id) in (
         select t.created_at, t.id from marketing_unsubscribe_tokens t
          join marketing_deliveries d on d.unsubscribe_token_id = t.id and d.tenant_id = t.tenant_id
         where d.sequence_execution_id = p_execution);
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    insert into marketing_unsubscribe_tokens
      (id, tenant_id, token_digest, campaign_id, person_id, contact_point_id,
       destination, expires_at)
    values (v_token_id, p_tenant, encode(extensions.digest(v_token, 'sha256'), 'hex'),
            v_x.campaign_id, v_e.person_id, v_e.contact_point_id, v_e.destination,
            now() + interval '180 days');
  end if;

  return jsonb_build_object(
    'execution_id', p_execution, 'enrolment_id', v_e.id, 'campaign_id', v_x.campaign_id,
    'campaign_name', v_c.name, 'revision_id', v_rev.id, 'bundle_hash', v_rev.bundle_hash,
    'step_id', v_step.id, 'step_order', v_step.step_order, 'step_type', v_step.step_type,
    'step_config', v_step.config, 'generation', v_x.generation,
    'person_id', v_e.person_id, 'contact_point_id', v_e.contact_point_id,
    'destination', v_e.destination, 'personalisation', v_e.personalisation,
    'sender_profile_id', v_sender.id, 'mailbox_address', v_sender.mailbox_address,
    'from_name', v_sender.from_name, 'reply_to', v_sender.reply_to,
    'signature_text', v_sender.signature_text,
    'approver_profile_id', v_appr.approver_profile_id, 'sequence_approval_id', v_appr.id,
    'public_base_url', v_c.launch_public_base_url,
    'unsubscribe_footer', coalesce((select ms.unsubscribe_footer from marketing_settings ms
                                     where ms.tenant_id = p_tenant), '{}'::jsonb),
    'unsubscribe_token_id', case when v_step.step_type = 'send_email' then v_token_id end,
    'unsubscribe_token', v_token);
end $$;

-- ============================================================================
-- EMAIL STEP LINEAGE — the complete governed chain for ONE recipient send.
-- Identical in shape to the proven Phase-5 broadcast lineage: Action →
-- immutable Decision Package (AUTOMATION_REQUIRES_APPROVAL) → intent with the
-- FULL frozen envelope → pinned approved_payload_hash → append-only
-- tenant_senior approval naming the GENUINE owner/admin sequence approver →
-- delivery + event → execution queued.
-- ============================================================================
create or replace function marketing_sequence_create_email_lineage(
  p_tenant uuid, p_execution uuid, p_worker text, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_x marketing_sequence_executions%rowtype;
  v_e marketing_sequence_enrolments%rowtype;
  v_c marketing_campaigns%rowtype;
  v_rev marketing_sequence_revisions%rowtype;
  v_step marketing_sequence_steps%rowtype;
  v_sender marketing_sender_profiles%rowtype;
  v_appr marketing_sequence_approvals%rowtype;
  v_tok marketing_unsubscribe_tokens%rowtype;
  v_verdict jsonb;
  v_key text;
  v_subject text; v_body text; v_html text; v_preview text;
  v_unsub_url text; v_url_token text;
  v_request text; v_hash text; v_fp text; v_mode text;
  v_action uuid := gen_random_uuid();
  v_decision uuid := gen_random_uuid();
  v_intent uuid := gen_random_uuid();
  v_delivery uuid := gen_random_uuid();
  v_correlation uuid := gen_random_uuid();
  v_existing marketing_deliveries%rowtype;
  v_pkg jsonb; v_params jsonb;
begin
  select * into v_x from marketing_sequence_executions
   where id = p_execution and tenant_id = p_tenant for update;
  if not found then
    raise exception 'execution not found for tenant' using errcode = 'P0002';
  end if;
  if v_x.status <> 'preparing' or v_x.lease_worker is distinct from p_worker
     or v_x.lease_expires_at < now() then
    raise exception 'execution is not leased by this worker' using errcode = 'MK423';
  end if;
  if v_x.step_type <> 'send_email' then
    raise exception 'this execution is not an email step' using errcode = '22023';
  end if;
  if v_x.automation_intent_id is not null then
    return jsonb_build_object('delivery_id', v_x.delivery_id,
      'intent_id', v_x.automation_intent_id, 'idempotent', true);
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('subject', 'body_text', 'body_html', 'preview_text', 'unsubscribe_url') then
      raise exception 'unknown lineage argument %', v_key using errcode = '22023';
    end if;
  end loop;

  select * into v_e from marketing_sequence_enrolments where id = v_x.enrolment_id and tenant_id = p_tenant;
  select * into v_c from marketing_campaigns where id = v_x.campaign_id and tenant_id = p_tenant;
  select * into v_rev from marketing_sequence_revisions where id = v_x.revision_id and tenant_id = p_tenant;
  select * into v_step from marketing_sequence_steps where id = v_x.step_id and tenant_id = p_tenant;
  select * into v_sender from marketing_sender_profiles
   where tenant_id = p_tenant and id = v_rev.sender_profile_id;
  select * into v_appr from marketing_sequence_approvals a
   where a.tenant_id = p_tenant and a.campaign_id = v_x.campaign_id
     and a.revision_id = v_x.revision_id and a.decision = 'approved'
   order by a.created_at desc limit 1;

  -- RACE CLOSURE (still check 2 of 3): authority immediately before lineage
  v_verdict := marketing_sequence_authority_core(p_tenant, v_e.id, v_x.id);
  if not (v_verdict ->> 'allowed')::boolean then
    update marketing_sequence_executions
       set status = 'skipped', skip_reason = 'policy_' || (v_verdict ->> 'code'),
           finished_at = now()
     where id = p_execution;
    return jsonb_build_object('skipped', true, 'code', v_verdict ->> 'code');
  end if;

  v_subject := p_args ->> 'subject';
  v_body := p_args ->> 'body_text';
  v_html := p_args ->> 'body_html';
  v_preview := nullif(p_args ->> 'preview_text', '');
  v_unsub_url := p_args ->> 'unsubscribe_url';
  if v_subject is null or length(v_subject) < 1 or length(v_subject) > 300
     or v_subject ~ '[[:cntrl:]]' then
    raise exception 'rendered subject invalid' using errcode = '22023';
  end if;
  if v_body is null or length(v_body) < 1 or length(v_body) > 30000 then
    raise exception 'rendered body invalid' using errcode = '22023';
  end if;
  if v_html is null or length(v_html) < 1 or length(v_html) > 100000 then
    raise exception 'rendered html invalid' using errcode = '22023';
  end if;
  if v_preview is not null and (length(v_preview) > 150 or v_preview ~ '[[:cntrl:]]') then
    raise exception 'rendered preview invalid' using errcode = '22023';
  end if;
  if v_unsub_url is null or v_c.launch_public_base_url is null
     or position(v_c.launch_public_base_url in v_unsub_url) <> 1 then
    raise exception 'unsubscribe url must use the frozen public base url' using errcode = '22023';
  end if;
  v_url_token := substring(v_unsub_url from 't=([0-9a-f]{48})');
  if v_url_token is null then
    raise exception 'unsubscribe url carries no token' using errcode = '22023';
  end if;
  select * into v_tok from marketing_unsubscribe_tokens
   where tenant_id = p_tenant and person_id = v_e.person_id and campaign_id = v_x.campaign_id
     and used_at is null and revoked_at is null
   order by created_at desc limit 1;
  if v_tok.id is null
     or v_tok.token_digest <> encode(extensions.digest(v_url_token, 'sha256'), 'hex') then
    raise exception 'unsubscribe token does not match the minted token' using errcode = '22023';
  end if;
  if position(v_unsub_url in v_body) = 0 or position(v_unsub_url in v_html) = 0 then
    raise exception 'the visible unsubscribe link must appear in both bodies' using errcode = '22023';
  end if;

  -- deterministic idempotency: execution + generation
  v_request := 'sq-' || replace(v_x.id::text, '-', '') || '-g' || v_x.generation;
  select * into v_existing from marketing_deliveries
   where tenant_id = p_tenant and request_id = v_request;
  if found then
    update marketing_sequence_executions
       set status = 'queued', delivery_id = v_existing.id,
           automation_intent_id = v_existing.automation_intent_id
     where id = p_execution;
    return jsonb_build_object('delivery_id', v_existing.id,
      'intent_id', v_existing.automation_intent_id, 'idempotent', true);
  end if;

  v_hash := encode(extensions.digest(jsonb_build_object(
    'sender', v_sender.id, 'mailbox', v_sender.mailbox_address,
    'recipient', v_e.destination, 'subject', v_subject, 'body', v_body,
    'html', v_html, 'preview', v_preview, 'from_name', v_sender.from_name,
    'reply_to', v_sender.reply_to, 'signature', v_sender.signature_text,
    'purpose', 'sequence', 'content_version', '1',
    'bundle_hash', v_rev.bundle_hash, 'step', v_step.id, 'enrolment', v_e.id,
    'unsubscribe_url', v_unsub_url)::text, 'sha256'), 'hex');
  v_fp := marketing_request_fingerprint(v_request, v_appr.approver_profile_id,
                                        v_sender.id, v_e.person_id, v_hash);

  select coalesce(
    (select e2.value #>> '{}' from operating_profile_entries e2
      where e2.tenant_id = p_tenant and e2.namespace = 'operational_mode' and e2.key = 'current'
      limit 1),
    (select e2.value #>> '{}' from operating_profile_entries e2
      where e2.tenant_id is null and e2.namespace = 'operational_mode' and e2.key = 'current'
      limit 1)) into v_mode;

  insert into intelligence_objects (id, tenant_id, domain, object_type, object_class,
                                    subject, status)
  values (v_action, p_tenant, 'core', 'Action', 'action',
          'Sequence "' || left(v_c.name, 50) || '" step ' || v_x.step_order || ' to ' || v_e.destination,
          'ready');

  v_pkg := jsonb_build_object(
    'id', v_decision, 'tenantId', p_tenant, 'supersedes', null,
    'intelligenceObjectId', v_action, 'intelligenceObjectType', 'Action',
    'objectClass', 'action', 'domainPackKeys', jsonb_build_array(),
    'decision', 'AUTOMATION_REQUIRES_APPROVAL',
    'nextDecisionOwner', jsonb_build_object('kind', 'automation'),
    'rationale', jsonb_build_object(
      'summary', 'Approved sequence step — tenant-senior approval recorded on the immutable revision',
      'reasonCodes', jsonb_build_array('sequence_approved'),
      'policyMatches', jsonb_build_array('marketing.campaigns.launch'),
      'rejectedAlternatives', jsonb_build_array(),
      'missingConfiguration', jsonb_build_array()),
    'confidence', jsonb_build_object('score', 1, 'threshold', 0,
                                     'ambiguityScore', 0, 'evidenceQuality', 1),
    'authority', jsonb_build_object('requiredAuthority', 'tenant_senior',
      'resolvedAuthorityHolder', v_appr.approver_profile_id::text,
      'delegatedLimit', null, 'requestedValue', null, 'withinDelegatedAuthority', true),
    'risk', jsonb_build_object('level', 'medium', 'score', 0.4,
                               'categories', jsonb_build_array('customer')),
    'reversibility', jsonb_build_object('level', 'irreversible', 'compensationAvailable', false),
    'impact', jsonb_build_object('level', 'medium', 'categories', jsonb_build_array('customer')),
    'ownership', jsonb_build_object('responsible', null, 'accountable', null,
      'approver', v_appr.approver_profile_id::text, 'waitingOn', null,
      'consulted', jsonb_build_array(), 'informed', jsonb_build_array()),
    'proposedAction', null,
    'automationIntent', jsonb_build_object('intentType', 'send_marketing_sequence_email',
      'payload', jsonb_build_object('content_hash', v_hash), 'requiresApproval', true),
    'routing', jsonb_build_object('reviewRequired', true, 'openfolkRequired', false,
      'tenantReviewRequired', true, 'customerApprovalRequired', false, 'waitCondition', null),
    'versions', jsonb_build_object('engineVersion', 'marketing-sequence.v1',
      'operatingProfileVersion', null, 'policyVersionIds', jsonb_build_array(),
      'learningVersionIds', jsonb_build_array()),
    'audit', jsonb_build_object('correlationId', v_correlation,
      'inputHash', v_hash, 'outputHash', v_hash));

  insert into decision_log
    (id, tenant_id, object_id, object_snapshot, effective_profile_hash, policy_version_ids,
     matched_rules, outputs, input_hash, decision, operational_mode, next_owner_kind,
     engine_version, operating_profile_version, learning_version_ids, reason_codes,
     correlation_id, output_hash, supersedes, decision_package)
  values
    (v_decision, p_tenant, v_action,
     jsonb_build_object('kind', 'marketing_sequence_send', 'campaign', v_x.campaign_id,
                        'revision', v_rev.id, 'enrolment', v_e.id, 'step', v_step.id,
                        'execution', v_x.id, 'content_hash', v_hash,
                        'sequence_approval', v_appr.id,
                        'authority_basis', 'marketing.campaigns.launch'),
     v_hash, '{}', '[]'::jsonb,
     jsonb_build_object('decision', 'AUTOMATION_REQUIRES_APPROVAL',
                        'reason_codes', jsonb_build_array('sequence_approved')),
     v_hash, 'AUTOMATION_REQUIRES_APPROVAL', v_mode, 'automation',
     'marketing-sequence.v1', null, '{}', array['sequence_approved'],
     v_correlation, v_hash, null, v_pkg);

  v_params := jsonb_build_object(
    'sender_profile_id', v_sender.id, 'source_kind', v_sender.source_kind,
    'mailbox_address', v_sender.mailbox_address, 'recipient_profile_id', null,
    'recipient_email', v_e.destination, 'subject', v_subject, 'body_text', v_body,
    'body_html', v_html, 'preview_text', v_preview, 'from_name', v_sender.from_name,
    'reply_to', v_sender.reply_to, 'signature_text', v_sender.signature_text,
    'purpose', 'sequence', 'content_version', '1', 'content_hash', v_hash,
    'actor_profile_id', v_appr.approver_profile_id, 'request_id', v_request,
    'delivery_id', v_delivery, 'campaign_id', v_x.campaign_id,
    'sequence_revision_id', v_rev.id, 'sequence_approval_id', v_appr.id,
    'bundle_hash', v_rev.bundle_hash, 'sequence_enrolment_id', v_e.id,
    'sequence_execution_id', v_x.id, 'sequence_step_id', v_step.id,
    'step_order', v_x.step_order, 'generation', v_x.generation,
    'person_id', v_e.person_id, 'contact_point_id', v_e.contact_point_id,
    'unsubscribe_token_id', v_tok.id, 'unsubscribe_url', v_unsub_url);

  insert into automation_intents
    (id, tenant_id, action_object_id, intent_type, parameters, status, connector_id,
     capability_key, decision_id, correlation_id, expires_at, max_attempts, schema_version)
  values
    (v_intent, p_tenant, v_action, 'send_marketing_sequence_email', v_params, 'pending',
     'google-gmail', 'email.send_marketing', v_decision, v_correlation,
     now() + interval '1 hour', 3, '1');
  update automation_intents
     set approved_payload_hash = automation_intent_envelope_hash(p_tenant, v_intent)
   where id = v_intent;

  insert into automation_approvals
    (tenant_id, automation_intent_id, decision_id, approver_kind, approver_ref,
     authority_basis, decision, expires_at, evidence, correlation_id)
  values
    (p_tenant, v_intent, v_decision, 'tenant_senior', v_appr.approver_profile_id::text,
     'marketing.campaigns.launch', 'approved', now() + interval '30 days',
     jsonb_build_object('campaign_id', v_x.campaign_id, 'sequence_approval_id', v_appr.id,
                        'revision_id', v_rev.id, 'bundle_hash', v_rev.bundle_hash,
                        'enrolment_id', v_e.id, 'step_id', v_step.id,
                        'execution_id', v_x.id, 'content_hash', v_hash),
     v_correlation);

  insert into marketing_deliveries
    (id, tenant_id, sender_profile_id, purpose, actor_profile_id, recipient_email,
     person_id, automation_intent_id, request_id, request_fingerprint, correlation_id,
     subject, body_text, from_name, reply_to, signature_text, content_version, content_hash,
     status, campaign_id, contact_point_id, unsubscribe_token_id, body_html, preview_text,
     sequence_enrolment_id, sequence_execution_id, sequence_step_id, sequence_revision_id)
  values
    (v_delivery, p_tenant, v_sender.id, 'sequence', v_appr.approver_profile_id,
     v_e.destination, v_e.person_id, v_intent, v_request, v_fp, v_correlation,
     v_subject, v_body, v_sender.from_name, v_sender.reply_to, v_sender.signature_text,
     '1', v_hash, 'queued', v_x.campaign_id, v_e.contact_point_id, v_tok.id, v_html, v_preview,
     v_e.id, v_x.id, v_step.id, v_rev.id);
  insert into marketing_delivery_events
    (tenant_id, delivery_id, automation_intent_id, from_status, to_status, detail)
  values (p_tenant, v_delivery, v_intent, null, 'queued', 'sequence step queued');

  update marketing_sequence_executions
     set status = 'queued', delivery_id = v_delivery, automation_intent_id = v_intent
   where id = p_execution;

  perform marketing_event_append(p_tenant, 'marketing.sequence.step_queued',
    'marketing_enrolment', v_e.id, 'marketing-sequences',
    jsonb_build_object('k', 'queued:' || p_execution, 'step', v_x.step_order,
                       'delivery', v_delivery, 'at', now()));

  return jsonb_build_object('delivery_id', v_delivery, 'intent_id', v_intent,
    'correlation_id', v_correlation, 'idempotent', false);
end $$;

-- ============================================================================
-- INTERNAL ACTION LINEAGE — tag / lifecycle / owner / follow-up. Registered
-- capability, real intent, executed by the untouched engine through the
-- marketing_actions adapter. requires_approval is FALSE and no approval row is
-- created: the authority is the owner/admin approval of the immutable
-- revision, recorded honestly in the Decision Package.
-- ============================================================================
create or replace function marketing_sequence_create_action_lineage(
  p_tenant uuid, p_execution uuid, p_worker text
) returns jsonb
language plpgsql
as $$
declare
  v_x marketing_sequence_executions%rowtype;
  v_e marketing_sequence_enrolments%rowtype;
  v_c marketing_campaigns%rowtype;
  v_rev marketing_sequence_revisions%rowtype;
  v_step marketing_sequence_steps%rowtype;
  v_appr marketing_sequence_approvals%rowtype;
  v_verdict jsonb;
  v_intent_type text;
  v_request text;
  v_hash text;
  v_mode text;
  v_action uuid := gen_random_uuid();
  v_decision uuid := gen_random_uuid();
  v_intent uuid := gen_random_uuid();
  v_correlation uuid := gen_random_uuid();
  v_existing automation_intents%rowtype;
  v_pkg jsonb;
  v_params jsonb;
begin
  select * into v_x from marketing_sequence_executions
   where id = p_execution and tenant_id = p_tenant for update;
  if not found then
    raise exception 'execution not found for tenant' using errcode = 'P0002';
  end if;
  if v_x.status <> 'preparing' or v_x.lease_worker is distinct from p_worker
     or v_x.lease_expires_at < now() then
    raise exception 'execution is not leased by this worker' using errcode = 'MK423';
  end if;
  if v_x.step_type not in ('apply_tag', 'remove_tag', 'change_lifecycle',
                           'assign_owner', 'create_follow_up') then
    raise exception 'this execution is not an internal action step' using errcode = '22023';
  end if;
  if v_x.automation_intent_id is not null then
    return jsonb_build_object('intent_id', v_x.automation_intent_id, 'idempotent', true);
  end if;

  select * into v_e from marketing_sequence_enrolments where id = v_x.enrolment_id and tenant_id = p_tenant;
  select * into v_c from marketing_campaigns where id = v_x.campaign_id and tenant_id = p_tenant;
  select * into v_rev from marketing_sequence_revisions where id = v_x.revision_id and tenant_id = p_tenant;
  select * into v_step from marketing_sequence_steps where id = v_x.step_id and tenant_id = p_tenant;
  select * into v_appr from marketing_sequence_approvals a
   where a.tenant_id = p_tenant and a.campaign_id = v_x.campaign_id
     and a.revision_id = v_x.revision_id and a.decision = 'approved'
   order by a.created_at desc limit 1;

  v_verdict := marketing_sequence_authority_core(p_tenant, v_e.id, v_x.id, false);
  if not (v_verdict ->> 'allowed')::boolean then
    -- an internal action does not depend on email eligibility; only the
    -- campaign/enrolment/approval facts block it
    if (v_verdict ->> 'code') in ('not_subscribed', 'endpoint_changed', 'sender_disabled',
                                  'sender_not_ready', 'capability_disabled') then
      null;   -- these are EMAIL preconditions; an internal action proceeds
    elsif (v_verdict ->> 'code') in ('campaign_not_active', 'enrolment_not_active') then
      if v_c.status = 'cancelled' or v_e.status = 'exited' then
        update marketing_sequence_executions
           set status = 'cancelled', lease_worker = null, lease_expires_at = null,
               finished_at = now()
         where id = p_execution;
        return jsonb_build_object('cancelled', true, 'code', v_verdict ->> 'code');
      end if;
      update marketing_sequence_executions
         set status = 'pending', lease_worker = null, lease_expires_at = null
       where id = p_execution;
      return jsonb_build_object('deferred', true, 'code', v_verdict ->> 'code');
    else
      update marketing_sequence_executions
         set status = 'skipped', skip_reason = 'policy_' || (v_verdict ->> 'code'),
             finished_at = now()
       where id = p_execution;
      return jsonb_build_object('skipped', true, 'code', v_verdict ->> 'code');
    end if;
  end if;

  v_intent_type := 'marketing_' || v_x.step_type;
  v_request := 'sa-' || replace(v_x.id::text, '-', '') || '-g' || v_x.generation;
  select * into v_existing from automation_intents
   where tenant_id = p_tenant and idempotency_key = v_request;
  if found then
    update marketing_sequence_executions
       set status = 'queued', automation_intent_id = v_existing.id
     where id = p_execution;
    return jsonb_build_object('intent_id', v_existing.id, 'idempotent', true);
  end if;

  v_params := jsonb_build_object(
    'tenant_id', p_tenant, 'person_id', v_e.person_id, 'campaign_id', v_x.campaign_id,
    'sequence_revision_id', v_rev.id, 'sequence_enrolment_id', v_e.id,
    'sequence_execution_id', v_x.id, 'sequence_step_id', v_step.id,
    'step_order', v_x.step_order, 'action_type', v_x.step_type,
    'config', v_step.config, 'authorised_by', v_appr.approver_profile_id,
    'request_id', v_request);
  v_hash := encode(extensions.digest(v_params::text, 'sha256'), 'hex');

  select coalesce(
    (select e2.value #>> '{}' from operating_profile_entries e2
      where e2.tenant_id = p_tenant and e2.namespace = 'operational_mode' and e2.key = 'current'
      limit 1),
    (select e2.value #>> '{}' from operating_profile_entries e2
      where e2.tenant_id is null and e2.namespace = 'operational_mode' and e2.key = 'current'
      limit 1)) into v_mode;

  insert into intelligence_objects (id, tenant_id, domain, object_type, object_class,
                                    subject, status)
  values (v_action, p_tenant, 'core', 'Action', 'action',
          marketing_sequence_step_summary(v_x.step_type, v_step.config)
            || ' (sequence "' || left(v_c.name, 40) || '")', 'ready');

  -- HONEST package: no tenant review is required for an INTERNAL change that
  -- the owner/admin already authorised on the immutable revision.
  v_pkg := jsonb_build_object(
    'id', v_decision, 'tenantId', p_tenant, 'supersedes', null,
    'intelligenceObjectId', v_action, 'intelligenceObjectType', 'Action',
    'objectClass', 'action', 'domainPackKeys', jsonb_build_array(),
    'decision', 'AUTOMATION_AUTHORISED',
    'nextDecisionOwner', jsonb_build_object('kind', 'automation'),
    'rationale', jsonb_build_object(
      'summary', 'Internal Marketing action authorised by the approved sequence revision',
      'reasonCodes', jsonb_build_array('sequence_approved'),
      'policyMatches', jsonb_build_array('marketing.campaigns.launch'),
      'rejectedAlternatives', jsonb_build_array(),
      'missingConfiguration', jsonb_build_array()),
    'confidence', jsonb_build_object('score', 1, 'threshold', 0,
                                     'ambiguityScore', 0, 'evidenceQuality', 1),
    'authority', jsonb_build_object('requiredAuthority', 'delegated',
      'resolvedAuthorityHolder', v_appr.approver_profile_id::text,
      'delegatedLimit', null, 'requestedValue', null, 'withinDelegatedAuthority', true),
    'risk', jsonb_build_object('level', 'low', 'score', 0.2,
                               'categories', jsonb_build_array('internal')),
    'reversibility', jsonb_build_object('level', 'reversible', 'compensationAvailable', true),
    'impact', jsonb_build_object('level', 'low', 'categories', jsonb_build_array('internal')),
    'ownership', jsonb_build_object('responsible', null, 'accountable', null,
      'approver', v_appr.approver_profile_id::text, 'waitingOn', null,
      'consulted', jsonb_build_array(), 'informed', jsonb_build_array()),
    'proposedAction', null,
    'automationIntent', jsonb_build_object('intentType', v_intent_type,
      'payload', jsonb_build_object('content_hash', v_hash), 'requiresApproval', false),
    'routing', jsonb_build_object('reviewRequired', false, 'openfolkRequired', false,
      'tenantReviewRequired', false, 'customerApprovalRequired', false, 'waitCondition', null),
    'versions', jsonb_build_object('engineVersion', 'marketing-sequence.v1',
      'operatingProfileVersion', null, 'policyVersionIds', jsonb_build_array(),
      'learningVersionIds', jsonb_build_array()),
    'audit', jsonb_build_object('correlationId', v_correlation,
      'inputHash', v_hash, 'outputHash', v_hash));

  insert into decision_log
    (id, tenant_id, object_id, object_snapshot, effective_profile_hash, policy_version_ids,
     matched_rules, outputs, input_hash, decision, operational_mode, next_owner_kind,
     engine_version, operating_profile_version, learning_version_ids, reason_codes,
     correlation_id, output_hash, supersedes, decision_package)
  values
    (v_decision, p_tenant, v_action,
     jsonb_build_object('kind', 'marketing_sequence_action', 'campaign', v_x.campaign_id,
                        'revision', v_rev.id, 'enrolment', v_e.id, 'step', v_step.id,
                        'execution', v_x.id, 'action_type', v_x.step_type,
                        'sequence_approval', v_appr.id),
     v_hash, '{}', '[]'::jsonb,
     jsonb_build_object('decision', 'AUTOMATION_AUTHORISED',
                        'reason_codes', jsonb_build_array('sequence_approved')),
     v_hash, 'AUTOMATION_AUTHORISED', v_mode, 'automation',
     'marketing-sequence.v1', null, '{}', array['sequence_approved'],
     v_correlation, v_hash, null, v_pkg);

  insert into automation_intents
    (id, tenant_id, action_object_id, intent_type, parameters, status, connector_id,
     capability_key, decision_id, correlation_id, idempotency_key, expires_at,
     max_attempts, schema_version)
  values
    (v_intent, p_tenant, v_action, v_intent_type, v_params, 'pending',
     'marketing-internal', 'marketing.contact_action', v_decision, v_correlation,
     v_request, now() + interval '1 hour', 3, '1');
  update automation_intents
     set approved_payload_hash = automation_intent_envelope_hash(p_tenant, v_intent)
   where id = v_intent;

  update marketing_sequence_executions
     set status = 'queued', automation_intent_id = v_intent
   where id = p_execution;

  perform marketing_event_append(p_tenant, 'marketing.sequence.step_queued',
    'marketing_enrolment', v_e.id, 'marketing-sequences',
    jsonb_build_object('k', 'queued:' || p_execution, 'step', v_x.step_order,
                       'action', v_x.step_type, 'at', now()));

  return jsonb_build_object('intent_id', v_intent, 'correlation_id', v_correlation,
    'idempotent', false);
end $$;

-- ============================================================================
-- FOLLOW-UP WORK ITEM — the governed creation path for the create_follow_up
-- step. The adapter NEVER writes tables directly (the frozen adapter contract
-- forbids it and conformance G6 enforces it): it calls this one function,
-- which creates the CANONICAL work item on the platform's own spine
-- (intelligence_objects, object_class 'action' — exactly what the Command
-- Centre work projection reads) and seeds its append-only state ledger in the
-- SAME transaction. It is idempotent on the execution id, so a retry after a
-- crash converges instead of creating a second work item.
--
-- Platform gap recorded honestly: the platform seeds
-- state_definitions/state_transitions for ('serviceos'|'productos','Action')
-- but NOT for ('core','Action'), so work-transition cannot yet MOVE any core
-- Action — including those Phase 4/5 already create. Creation and surfacing
-- are genuine; the transition seed is a platform change out of scope here.
-- ============================================================================
create or replace function marketing_sequence_create_follow_up(
  p_tenant uuid, p_execution uuid, p_person uuid, p_config jsonb, p_actor uuid
) returns jsonb
language plpgsql
as $$
declare
  v_existing uuid;
  v_id uuid := gen_random_uuid();
  v_x marketing_sequence_executions%rowtype;
  v_person people%rowtype;
  v_subject text;
  v_due int;
  v_priority numeric;
begin
  if p_tenant is null or p_execution is null or p_person is null then
    raise exception 'tenant, execution and person required' using errcode = '22023';
  end if;
  select * into v_x from marketing_sequence_executions
   where id = p_execution and tenant_id = p_tenant;
  if not found then
    raise exception 'execution not found for tenant' using errcode = 'P0002';
  end if;
  select * into v_person from people where id = p_person and tenant_id = p_tenant;
  if not found then
    raise exception 'person not found for tenant' using errcode = 'P0002';
  end if;
  -- DEFENCE IN DEPTH. Authoring already refuses a follow-up step on a platform
  -- with no ('core','Action') state machine, but this RPC is the generic
  -- canonical-Action seam: it is the layer that actually mints the work, so it
  -- must refuse too. Otherwise any future caller — inside Marketing or not —
  -- could create work that appears on a real person's list and can never be
  -- started, completed or dismissed. The gate reads the platform's own
  -- configuration, so it opens by itself the moment those transitions exist.
  if not marketing_sequence_follow_up_available() then
    raise exception 'follow-up work items are unavailable: this platform has no state_transitions configured for (core, Action), so the work item could be created but never progressed, completed or dismissed'
      using errcode = 'MK428';
  end if;
  -- IDEMPOTENT on the execution: a retry converges, never a second work item
  select id into v_existing from intelligence_objects
   where tenant_id = p_tenant and created_from = 'marketing_sequence:' || p_execution;
  if found then
    return jsonb_build_object('work_item_id', v_existing, 'idempotent', true);
  end if;

  v_subject := trim(coalesce(p_config ->> 'subject', ''));
  if v_subject = '' or length(v_subject) > 200 or v_subject ~ '[[:cntrl:]]' then
    raise exception 'follow-up subject required (max 200 clean chars)' using errcode = '22023';
  end if;
  v_due := coalesce((p_config ->> 'due_in_days')::int, 3);
  v_priority := coalesce((p_config ->> 'priority')::numeric, 0.5);
  if v_due < 0 or v_due > 365 or v_priority < 0 or v_priority > 1 then
    raise exception 'follow-up bounds violated' using errcode = '22023';
  end if;

  insert into intelligence_objects
    (id, tenant_id, domain, object_type, object_class, subject, status, priority,
     deadline, created_by, created_from, attributes, evidence)
  values
    (v_id, p_tenant, 'core', 'Action', 'action',
     left(v_subject || ' — ' || coalesce(v_person.display_name, 'customer'), 500),
     'ready', v_priority, now() + make_interval(days => v_due),
     'marketing-sequence', 'marketing_sequence:' || p_execution,
     jsonb_build_object('action_type', 'marketing_follow_up', 'person_id', p_person,
                        'campaign_id', v_x.campaign_id,
                        'sequence_enrolment_id', v_x.enrolment_id,
                        'sequence_step_id', v_x.step_id, 'step_order', v_x.step_order,
                        'authorised_by', p_actor),
     jsonb_build_object('source', 'marketing_sequence',
                        'sequence_execution_id', p_execution,
                        'sequence_revision_id', v_x.revision_id));
  insert into object_state_history (tenant_id, object_id, from_state, to_state, actor, reason)
  values (p_tenant, v_id, null, 'ready',
          jsonb_build_object('kind', 'automation', 'ref', 'marketing-sequence'),
          'created by an approved Marketing sequence step');
  return jsonb_build_object('work_item_id', v_id, 'idempotent', false,
                            'deadline', now() + make_interval(days => v_due));
end $$;

-- ============================================================================
-- ADVANCEMENT — an enrolment moves on ONLY from canonical evidence. Exactly
-- once: the advance is keyed on the execution's own terminal transition.
-- ============================================================================
create or replace function marketing_sequence_reconcile_execution(
  p_tenant uuid, p_execution uuid
) returns jsonb
language plpgsql
as $$
declare
  v_x marketing_sequence_executions%rowtype;
  v_e marketing_sequence_enrolments%rowtype;
  v_rev marketing_sequence_revisions%rowtype;
  v_intent automation_intents%rowtype;
  v_attempt automation_execution_attempts%rowtype;
  v_new text;
  v_failure text;
  v_advance boolean := false;
begin
  select * into v_x from marketing_sequence_executions
   where id = p_execution and tenant_id = p_tenant for update;
  if not found then
    raise exception 'execution not found for tenant' using errcode = 'P0002';
  end if;
  if v_x.status in ('succeeded', 'skipped', 'failed', 'cancelled') then
    return jsonb_build_object('execution_id', v_x.id, 'status', v_x.status, 'changed', false);
  end if;
  if v_x.automation_intent_id is null then
    return jsonb_build_object('execution_id', v_x.id, 'status', v_x.status, 'changed', false,
                              'note', 'no intent yet');
  end if;
  select * into v_intent from automation_intents
   where id = v_x.automation_intent_id and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('execution_id', v_x.id, 'status', v_x.status, 'changed', false,
                              'note', 'intent missing');
  end if;
  select * into v_attempt from automation_execution_attempts a
   where a.tenant_id = p_tenant and a.automation_intent_id = v_intent.id
   order by a.completed_at desc nulls last, a.started_at desc nulls last,
            a.created_at desc, a.id desc limit 1;

  v_new := case v_intent.status
    when 'succeeded' then 'succeeded'
    when 'executing' then 'executing'
    when 'claimed'   then 'executing'
    when 'unknown'   then 'unknown'
    when 'expired'   then 'failed'
    when 'cancelled' then 'cancelled'
    when 'rejected'  then 'failed'
    when 'failed'    then case
      when v_attempt.id is not null and v_attempt.status = 'failed_permanent'
           and v_attempt.error_code ~ '^policy_' then 'skipped'
      when v_intent.attempts >= v_intent.max_attempts then 'failed'
      when v_attempt.id is not null and v_attempt.status = 'failed_permanent' then 'failed'
      else 'queued' end
    else 'queued' end;

  if v_new = v_x.status then
    return jsonb_build_object('execution_id', v_x.id, 'status', v_x.status, 'changed', false);
  end if;
  -- an UNKNOWN provider outcome FREEZES: it is never blindly resent
  if v_x.status = 'unknown' and v_new not in ('succeeded', 'failed') then
    return jsonb_build_object('execution_id', v_x.id, 'status', v_x.status, 'changed', false,
                              'note', 'unknown awaits reconciliation');
  end if;

  v_failure := left(coalesce(v_attempt.error_class, v_attempt.error_code,
                             case when v_intent.status = 'expired' then 'expired' end,
                             'unclassified'), 120);
  update marketing_sequence_executions set
    status = v_new,
    skip_reason = case when v_new = 'skipped' then left(coalesce(v_attempt.error_code, 'policy_blocked'), 120)
                       else skip_reason end,
    failure_class = case when v_new = 'failed' then v_failure else failure_class end,
    finished_at = case when v_new in ('succeeded', 'skipped', 'failed', 'cancelled')
                       then now() else finished_at end,
    evidence = evidence || jsonb_build_object('intent_status', v_intent.status,
                                              'attempt', v_attempt.id,
                                              'reconciled_at', now())
  where id = v_x.id;

  select * into v_e from marketing_sequence_enrolments
   where id = v_x.enrolment_id and tenant_id = p_tenant for update;
  select * into v_rev from marketing_sequence_revisions
   where id = v_x.revision_id and tenant_id = p_tenant;

  -- ADVANCE exactly once, and only on evidence the platform actually has.
  if v_new = 'succeeded' then
    v_advance := true;
  elsif v_new = 'skipped' then
    -- a policy skip either exits the enrolment or steps over it, per the
    -- APPROVED revision policy — never a silent stall
    if v_rev.policy_block_action = 'exit' then
      perform marketing_sequence_exit_enrolment(p_tenant, v_e.id, 'policy_blocked',
        jsonb_build_object('execution_id', v_x.id, 'skip', v_intent.status), 'sequence-reconciler');
    else
      v_advance := true;
    end if;
  elsif v_new = 'failed' then
    update marketing_sequence_enrolments
       set status = 'held', hold_reason = left('step failed: ' || v_failure, 160),
           next_eligible_at = null, last_execution_at = now()
     where id = v_e.id and status = 'active';
    perform marketing_event_append(p_tenant, 'marketing.sequence.enrolment_held',
      'marketing_enrolment', v_e.id, 'marketing-sequences',
      jsonb_build_object('k', 'held:' || v_x.id, 'reason', v_failure, 'at', now()));
  end if;

  if v_advance and v_e.status = 'active' then
    update marketing_sequence_enrolments
       set current_step_order = current_step_order + 1,
           next_eligible_at = now(), last_execution_at = now()
     where id = v_e.id;
    perform marketing_event_append(p_tenant, 'marketing.sequence.enrolment_advanced',
      'marketing_enrolment', v_e.id, 'marketing-sequences',
      jsonb_build_object('k', 'advance:' || v_x.id, 'from_step', v_x.step_order, 'at', now()));
  end if;

  perform marketing_sequence_check_completion(p_tenant, v_x.campaign_id);
  return jsonb_build_object('execution_id', v_x.id, 'status', v_new, 'changed', true,
                            'advanced', v_advance);
end $$;

-- ============================================================================
-- REPLY CORRELATION — canonical evidence only. A reply is recognised from the
-- PROVIDER THREAD of a message this sequence actually sent, never from subject
-- text and never from an unrelated inbound email.
-- ============================================================================
create or replace function marketing_sequence_apply_reply_exits(p_tenant uuid, p_limit int default 200)
returns int
language plpgsql
as $$
declare r record; v_n int := 0;
begin
  for r in
    select distinct on (e.id) e.id as enrolment_id, e.campaign_id, m_in.id as message_id,
           m_in.provider_thread_id, m_in.provider_message_id
      from marketing_sequence_enrolments e
      join marketing_sequence_revisions rev
        on rev.id = e.revision_id and rev.tenant_id = e.tenant_id
      join marketing_deliveries d
        on d.tenant_id = e.tenant_id and d.sequence_enrolment_id = e.id
       and d.status = 'submitted' and d.provider_thread_id is not null
      join email_messages m_in
        on m_in.tenant_id = e.tenant_id
       and m_in.provider_thread_id = d.provider_thread_id
       and m_in.direction = 'inbound'
       -- the inbound message must have ARRIVED AFTER the message this
       -- enrolment sent. Without this, a thread that already contained an
       -- older inbound message would be read as a reply to a send that had
       -- not happened yet.
       and m_in.received_at is not null
       and m_in.received_at > d.submitted_at
       -- and it must come FROM the endpoint this enrolment addressed. A shared
       -- or reused thread can carry messages from other people; attributing
       -- one of those to this Person would exit the wrong enrolment. Where the
       -- sender address is unknown the correlation stays UNRESOLVED rather
       -- than being forced.
       and e.destination is not null
       and lower(coalesce(m_in.from_email, '')) = lower(e.destination)
     where e.tenant_id = p_tenant
       and e.status in ('active', 'paused', 'held')
       and coalesce((rev.exit_rules ->> 'on_reply')::boolean, false)
     order by e.id, m_in.created_at
     limit greatest(1, least(1000, p_limit))
  loop
    if marketing_sequence_exit_enrolment(p_tenant, r.enrolment_id, 'replied',
         jsonb_build_object('email_message_id', r.message_id,
                            'provider_thread_id', r.provider_thread_id,
                            'provider_message_id', r.provider_message_id,
                            'evidence', 'canonical inbound message from the enrolled endpoint, on the thread this enrolment sent, after that send'),
         'reply-correlation') then
      v_n := v_n + 1;
      perform marketing_event_append(p_tenant, 'marketing.sequence.reply_linked',
        'marketing_enrolment', r.enrolment_id, 'marketing-sequences',
        jsonb_build_object('k', 'reply:' || r.enrolment_id || ':' || r.message_id,
                           'thread', r.provider_thread_id, 'at', now()));
    end if;
  end loop;
  return v_n;
end $$;

-- lifecycle-outcome exits: a configured terminal stage reached on the Person's
-- CURRENT relationship is canonical evidence, not an inference from engagement
create or replace function marketing_sequence_apply_lifecycle_exits(p_tenant uuid, p_limit int default 200)
returns int
language plpgsql
as $$
declare r record; v_n int := 0;
begin
  for r in
    select e.id as enrolment_id, rev.exit_rules ->> 'on_lifecycle_stage' as stage,
           cr.lifecycle_stage
      from marketing_sequence_enrolments e
      join marketing_sequence_revisions rev
        on rev.id = e.revision_id and rev.tenant_id = e.tenant_id
      join contact_relationships cr
        on cr.tenant_id = e.tenant_id and cr.person_id = e.person_id and cr.status = 'active'
     where e.tenant_id = p_tenant
       and e.status in ('active', 'paused', 'held')
       and rev.exit_rules ? 'on_lifecycle_stage'
       and cr.lifecycle_stage = rev.exit_rules ->> 'on_lifecycle_stage'
     limit greatest(1, least(1000, p_limit))
  loop
    if marketing_sequence_exit_enrolment(p_tenant, r.enrolment_id, 'lifecycle_outcome',
         jsonb_build_object('lifecycle_stage', r.lifecycle_stage,
                            'evidence', 'current active relationship reached the configured stage'),
         'lifecycle-exit') then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- suppression/unsubscribe exits BETWEEN steps (the pre-provider authority is
-- still the final word immediately before any send)
create or replace function marketing_sequence_apply_suppression_exits(p_tenant uuid, p_limit int default 500)
returns int
language plpgsql
as $$
declare r record; v_n int := 0; v_state text;
begin
  for r in
    select e.id as enrolment_id, e.person_id, e.contact_point_id
      from marketing_sequence_enrolments e
      join marketing_campaigns c on c.id = e.campaign_id and c.tenant_id = e.tenant_id
     where e.tenant_id = p_tenant and e.status = 'active'
       and c.status in ('active', 'paused')
       and e.contact_point_id is not null
       -- an email unsubscribe is not a reason to exit a journey that never
       -- sends email
       and exists (select 1 from marketing_sequence_steps s
                    where s.tenant_id = e.tenant_id and s.revision_id = e.revision_id
                      and s.step_type = 'send_email')
     limit greatest(1, least(2000, p_limit))
  loop
    v_state := marketing_endpoint_eligibility(p_tenant, r.person_id, 'email', r.contact_point_id);
    if v_state in ('unsubscribed', 'suppressed') then
      if marketing_sequence_exit_enrolment(p_tenant, r.enrolment_id,
           case v_state when 'unsubscribed' then 'unsubscribed' else 'hard_suppression' end,
           jsonb_build_object('eligibility_state', v_state,
                              'evidence', 'canonical endpoint eligibility'),
           'suppression-exit') then
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return v_n;
end $$;

-- ── enrolment-level control (tenant- and permission-governed) ───────────────
create or replace function marketing_sequence_enrolment_control(
  p_tenant uuid, p_actor uuid, p_enrolment uuid, p_action text, p_args jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_e marketing_sequence_enrolments%rowtype;
  v_note text;
begin
  v_label := marketing_require_launch_actor(p_tenant, p_actor);
  if p_action not in ('pause', 'resume', 'exit') then
    raise exception 'unknown enrolment action' using errcode = '22023';
  end if;
  v_note := nullif(trim(coalesce(p_args ->> 'note', '')), '');
  select * into v_e from marketing_sequence_enrolments
   where id = p_enrolment and tenant_id = p_tenant for update;
  if not found then
    raise exception 'enrolment not found for tenant' using errcode = 'P0002';
  end if;
  if p_action = 'pause' then
    if v_e.status <> 'active' then
      raise exception 'only an active enrolment can be paused (it is %)', v_e.status
        using errcode = '22023';
    end if;
    update marketing_sequence_enrolments
       set status = 'paused', paused_at = now()
     where id = p_enrolment;
    perform marketing_event_append(p_tenant, 'marketing.sequence.enrolment_paused',
      'marketing_enrolment', p_enrolment, 'marketing-sequences',
      jsonb_build_object('k', 'pause:' || p_enrolment || ':' || now()::text,
                         'actor', v_label, 'at', now()));
  elsif p_action = 'resume' then
    if v_e.status not in ('paused', 'held') then
      raise exception 'only a paused/held enrolment can be resumed (it is %)', v_e.status
        using errcode = '22023';
    end if;
    -- resuming preserves the pinned revision and the current step; only the
    -- next-eligible instant is recalculated
    update marketing_sequence_enrolments
       set status = 'active', resumed_at = now(), hold_reason = null,
           next_eligible_at = now()
     where id = p_enrolment;
    perform marketing_event_append(p_tenant, 'marketing.sequence.enrolment_resumed',
      'marketing_enrolment', p_enrolment, 'marketing-sequences',
      jsonb_build_object('k', 'resume:' || p_enrolment || ':' || now()::text,
                         'actor', v_label, 'at', now()));
  else
    perform marketing_sequence_exit_enrolment(p_tenant, p_enrolment, 'manual_removal',
      jsonb_build_object('note', v_note), v_label);
  end if;
  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.sequence.enrolment_' || p_action, 'marketing_enrolment',
          p_enrolment::text, 'ok', jsonb_build_object('note', v_note));
  select * into v_e from marketing_sequence_enrolments where id = p_enrolment;
  return jsonb_build_object('id', p_enrolment, 'status', v_e.status,
                            'exit_reason', v_e.exit_reason);
end $$;

-- ============================================================================
-- DELIVERY GUARD — REPLACED with a SUPERSET. Every Phase-4 test and Phase-5
-- broadcast invariant is preserved verbatim; the sequence branch binds the
-- full sequence lineage to the frozen envelope exactly the same way.
-- ============================================================================
create or replace function marketing_delivery_guard()
returns trigger language plpgsql as $$
declare
  v_intent automation_intents%rowtype;
  v_intent_status text;
  v_att automation_execution_attempts%rowtype;
  v_fp_recipient uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'queued' then
      raise exception 'a delivery must be created queued — % is not a creatable state', new.status;
    end if;
    if new.execution_attempt_id is not null or new.provider_message_id is not null
       or new.provider_thread_id is not null or new.submitted_at is not null
       or new.failure_class is not null then
      raise exception 'a new delivery cannot carry execution, provider or failure facts';
    end if;
    select * into v_intent from automation_intents
     where id = new.automation_intent_id and tenant_id = new.tenant_id;
    if not found then
      raise exception 'a delivery requires its same-tenant automation intent';
    end if;
    if v_intent.status <> 'pending' then
      raise exception 'a new delivery requires a PENDING intent (intent is %)', v_intent.status;
    end if;

    if new.purpose = 'test' then
      if v_intent.intent_type is distinct from 'send_marketing_test_email'
         or v_intent.capability_key is distinct from 'email.send_marketing' then
        raise exception 'a test delivery requires the Phase-4 test intent and Marketing capability';
      end if;
      if new.campaign_id is not null or new.campaign_revision_id is not null
         or new.audience_snapshot_id is not null or new.audience_member_id is not null
         or new.dispatch_id is not null or new.unsubscribe_token_id is not null
         or new.body_html is not null or new.preview_text is not null
         or new.dispatch_generation is not null or new.contact_point_id is not null
         or new.person_id is not null
         or new.sequence_enrolment_id is not null or new.sequence_execution_id is not null
         or new.sequence_step_id is not null or new.sequence_revision_id is not null then
        raise exception 'a test delivery cannot carry broadcast or sequence lineage';
      end if;
    elsif new.purpose = 'broadcast' then
      if v_intent.intent_type is distinct from 'send_marketing_broadcast_email'
         or v_intent.capability_key is distinct from 'email.send_marketing' then
        raise exception 'a broadcast delivery requires the broadcast intent and Marketing capability';
      end if;
      if new.recipient_profile_id is not null then
        raise exception 'a broadcast delivery addresses a Person, not a profile';
      end if;
      if new.sequence_enrolment_id is not null or new.sequence_execution_id is not null
         or new.sequence_step_id is not null or new.sequence_revision_id is not null then
        raise exception 'a broadcast delivery cannot carry sequence lineage';
      end if;
      if new.campaign_id is null or new.campaign_revision_id is null
         or new.audience_snapshot_id is null or new.audience_member_id is null
         or new.dispatch_id is null or new.person_id is null
         or new.contact_point_id is null or new.unsubscribe_token_id is null
         or new.body_html is null or new.dispatch_generation is null then
        raise exception 'a broadcast delivery requires its complete campaign lineage';
      end if;
      if not exists (select 1 from marketing_broadcast_dispatches d
                      where d.id = new.dispatch_id and d.tenant_id = new.tenant_id
                        and d.campaign_id = new.campaign_id
                        and d.snapshot_id = new.audience_snapshot_id
                        and d.member_id = new.audience_member_id
                        and d.person_id = new.person_id
                        and d.generation = new.dispatch_generation
                        and d.status = 'preparing') then
        raise exception 'a broadcast delivery requires its own PREPARING dispatch';
      end if;
      if v_intent.parameters ->> 'campaign_id' is distinct from new.campaign_id::text
         or v_intent.parameters ->> 'campaign_revision_id' is distinct from new.campaign_revision_id::text
         or v_intent.parameters ->> 'audience_snapshot_id' is distinct from new.audience_snapshot_id::text
         or v_intent.parameters ->> 'audience_member_id' is distinct from new.audience_member_id::text
         or v_intent.parameters ->> 'dispatch_id' is distinct from new.dispatch_id::text
         or (v_intent.parameters ->> 'dispatch_generation')::int is distinct from new.dispatch_generation
         or v_intent.parameters ->> 'person_id' is distinct from new.person_id::text
         or v_intent.parameters ->> 'contact_point_id' is distinct from new.contact_point_id::text
         or v_intent.parameters ->> 'unsubscribe_token_id' is distinct from new.unsubscribe_token_id::text
         or v_intent.parameters ->> 'body_html' is distinct from new.body_html
         or v_intent.parameters ->> 'preview_text' is distinct from new.preview_text then
        raise exception 'a broadcast delivery must agree with its intent''s frozen campaign lineage';
      end if;
    elsif new.purpose = 'sequence' then
      if v_intent.intent_type is distinct from 'send_marketing_sequence_email'
         or v_intent.capability_key is distinct from 'email.send_marketing' then
        raise exception 'a sequence delivery requires the sequence intent and Marketing capability';
      end if;
      if new.recipient_profile_id is not null then
        raise exception 'a sequence delivery addresses a Person, not a profile';
      end if;
      if new.dispatch_id is not null or new.audience_snapshot_id is not null
         or new.audience_member_id is not null or new.dispatch_generation is not null then
        raise exception 'a sequence delivery cannot carry broadcast dispatch lineage';
      end if;
      if new.campaign_id is null or new.sequence_revision_id is null
         or new.sequence_enrolment_id is null or new.sequence_execution_id is null
         or new.sequence_step_id is null or new.person_id is null
         or new.contact_point_id is null or new.unsubscribe_token_id is null
         or new.body_html is null then
        raise exception 'a sequence delivery requires its complete sequence lineage';
      end if;
      -- the execution being prepared must be THIS recipient's own leased work
      if not exists (select 1 from marketing_sequence_executions x
                      where x.id = new.sequence_execution_id and x.tenant_id = new.tenant_id
                        and x.campaign_id = new.campaign_id
                        and x.enrolment_id = new.sequence_enrolment_id
                        and x.revision_id = new.sequence_revision_id
                        and x.step_id = new.sequence_step_id
                        and x.step_type = 'send_email'
                        and x.status = 'preparing') then
        raise exception 'a sequence delivery requires its own PREPARING execution';
      end if;
      if not exists (select 1 from marketing_sequence_enrolments e
                      where e.id = new.sequence_enrolment_id and e.tenant_id = new.tenant_id
                        and e.person_id = new.person_id
                        and e.contact_point_id = new.contact_point_id
                        and e.revision_id = new.sequence_revision_id) then
        raise exception 'a sequence delivery must address its enrolment''s pinned Person and endpoint';
      end if;
      if v_intent.parameters ->> 'campaign_id' is distinct from new.campaign_id::text
         or v_intent.parameters ->> 'sequence_revision_id' is distinct from new.sequence_revision_id::text
         or v_intent.parameters ->> 'sequence_enrolment_id' is distinct from new.sequence_enrolment_id::text
         or v_intent.parameters ->> 'sequence_execution_id' is distinct from new.sequence_execution_id::text
         or v_intent.parameters ->> 'sequence_step_id' is distinct from new.sequence_step_id::text
         or v_intent.parameters ->> 'person_id' is distinct from new.person_id::text
         or v_intent.parameters ->> 'contact_point_id' is distinct from new.contact_point_id::text
         or v_intent.parameters ->> 'unsubscribe_token_id' is distinct from new.unsubscribe_token_id::text
         or v_intent.parameters ->> 'body_html' is distinct from new.body_html
         or v_intent.parameters ->> 'preview_text' is distinct from new.preview_text then
        raise exception 'a sequence delivery must agree with its intent''s frozen sequence lineage';
      end if;
    else
      raise exception 'unknown delivery purpose %', new.purpose;
    end if;

    if v_intent.parameters ->> 'delivery_id' is distinct from new.id::text
       or v_intent.parameters ->> 'sender_profile_id' is distinct from new.sender_profile_id::text
       or v_intent.parameters ->> 'recipient_profile_id' is distinct from new.recipient_profile_id::text
       or v_intent.parameters ->> 'recipient_email' is distinct from new.recipient_email
       or v_intent.parameters ->> 'actor_profile_id' is distinct from new.actor_profile_id::text
       or v_intent.parameters ->> 'request_id' is distinct from new.request_id
       or v_intent.parameters ->> 'purpose' is distinct from new.purpose
       or v_intent.parameters ->> 'subject' is distinct from new.subject
       or v_intent.parameters ->> 'body_text' is distinct from new.body_text
       or v_intent.parameters ->> 'from_name' is distinct from new.from_name
       or v_intent.parameters ->> 'reply_to' is distinct from new.reply_to
       or v_intent.parameters ->> 'signature_text' is distinct from new.signature_text
       or v_intent.parameters ->> 'content_version' is distinct from new.content_version
       or v_intent.parameters ->> 'content_hash' is distinct from new.content_hash then
      raise exception 'a delivery must agree with its intent''s frozen envelope';
    end if;
    if v_intent.correlation_id is distinct from new.correlation_id then
      raise exception 'a delivery must carry its intent''s correlation id';
    end if;
    v_fp_recipient := case when new.purpose = 'test'
                           then new.recipient_profile_id else new.person_id end;
    if new.request_fingerprint is distinct from marketing_request_fingerprint(
         new.request_id, new.actor_profile_id, new.sender_profile_id,
         v_fp_recipient, new.content_hash) then
      raise exception 'the request fingerprint must equal its canonical recomputation';
    end if;
    return new;
  end if;

  -- ── UPDATE path — Phase-4/5 rules preserved verbatim ──
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.sender_profile_id is distinct from old.sender_profile_id
     or new.purpose is distinct from old.purpose
     or (new.actor_profile_id is distinct from old.actor_profile_id
         and not (new.actor_profile_id is null and old.actor_profile_id is not null))
     or (new.recipient_profile_id is distinct from old.recipient_profile_id
         and not (new.recipient_profile_id is null and old.recipient_profile_id is not null))
     or (new.person_id is distinct from old.person_id
         and not (new.person_id is null and old.person_id is not null))
     or new.recipient_email is distinct from old.recipient_email
     or new.automation_intent_id is distinct from old.automation_intent_id
     or new.request_id is distinct from old.request_id
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.correlation_id is distinct from old.correlation_id
     or new.subject is distinct from old.subject
     or new.body_text is distinct from old.body_text
     or new.from_name is distinct from old.from_name
     or new.reply_to is distinct from old.reply_to
     or new.signature_text is distinct from old.signature_text
     or new.content_version is distinct from old.content_version
     or new.content_hash is distinct from old.content_hash
     or new.created_at is distinct from old.created_at then
    raise exception 'delivery identity, lineage and submitted content are immutable';
  end if;
  if (new.campaign_id is distinct from old.campaign_id
      and not (new.campaign_id is null and old.campaign_id is not null))
     or (new.campaign_revision_id is distinct from old.campaign_revision_id
         and not (new.campaign_revision_id is null and old.campaign_revision_id is not null))
     or (new.audience_snapshot_id is distinct from old.audience_snapshot_id
         and not (new.audience_snapshot_id is null and old.audience_snapshot_id is not null))
     or (new.audience_member_id is distinct from old.audience_member_id
         and not (new.audience_member_id is null and old.audience_member_id is not null))
     or (new.dispatch_id is distinct from old.dispatch_id
         and not (new.dispatch_id is null and old.dispatch_id is not null))
     or (new.contact_point_id is distinct from old.contact_point_id
         and not (new.contact_point_id is null and old.contact_point_id is not null))
     or (new.unsubscribe_token_id is distinct from old.unsubscribe_token_id
         and not (new.unsubscribe_token_id is null and old.unsubscribe_token_id is not null))
     or (new.sequence_enrolment_id is distinct from old.sequence_enrolment_id
         and not (new.sequence_enrolment_id is null and old.sequence_enrolment_id is not null))
     or (new.sequence_execution_id is distinct from old.sequence_execution_id
         and not (new.sequence_execution_id is null and old.sequence_execution_id is not null))
     or (new.sequence_step_id is distinct from old.sequence_step_id
         and not (new.sequence_step_id is null and old.sequence_step_id is not null))
     or (new.sequence_revision_id is distinct from old.sequence_revision_id
         and not (new.sequence_revision_id is null and old.sequence_revision_id is not null))
     or new.body_html is distinct from old.body_html
     or new.preview_text is distinct from old.preview_text
     or new.dispatch_generation is distinct from old.dispatch_generation then
    raise exception 'campaign lineage and rendered content are immutable';
  end if;
  if old.provider_message_id is not null
     and new.provider_message_id is distinct from old.provider_message_id then
    raise exception 'a recorded provider message id is immutable';
  end if;
  if old.provider_thread_id is not null
     and new.provider_thread_id is distinct from old.provider_thread_id then
    raise exception 'a recorded provider thread id is immutable';
  end if;
  if old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at then
    raise exception 'a recorded submission time is immutable';
  end if;
  if (old.provider_message_id is null and new.provider_message_id is not null
      or old.provider_thread_id is null and new.provider_thread_id is not null
      or old.submitted_at is null and new.submitted_at is not null)
     and not (new.status = 'submitted' and old.status is distinct from new.status) then
    raise exception 'provider facts may only be recorded by a confirmed submission';
  end if;
  if new.status is not distinct from old.status then
    if new.execution_attempt_id is distinct from old.execution_attempt_id then
      raise exception 'the cited execution attempt may only change through a factual status transition';
    end if;
    if new.failure_class is distinct from old.failure_class then
      raise exception 'a failure classification may only change through a factual status transition';
    end if;
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'queued' and new.status in ('executing', 'submitted', 'failed',
                                                      'unknown', 'skipped', 'cancelled'))
         or (old.status = 'executing' and new.status in ('queued', 'submitted', 'failed',
                                                         'unknown', 'skipped'))
         or (old.status = 'unknown' and new.status in ('submitted', 'failed'))) then
      raise exception 'illegal delivery status transition % -> %', old.status, new.status;
    end if;
    if old.purpose = 'test' and new.status in ('skipped', 'cancelled') then
      raise exception 'a test delivery has no % state', new.status;
    end if;
    select status into v_intent_status from automation_intents
     where id = new.automation_intent_id and tenant_id = new.tenant_id;
    if v_intent_status is null then
      raise exception 'delivery transition requires its automation intent';
    end if;
    if new.status = 'queued' and v_intent_status not in ('pending', 'failed') then
      raise exception 'a queued delivery requires a pending/retrying intent (intent is %)',
        v_intent_status;
    end if;
    if new.status = 'executing' and v_intent_status not in ('claimed', 'executing') then
      raise exception 'an executing delivery requires a claimed/executing intent (intent is %)',
        v_intent_status;
    end if;
    if new.status = 'unknown' and v_intent_status <> 'unknown' then
      raise exception 'an unknown delivery requires an unknown intent (intent is %)', v_intent_status;
    end if;
    if new.status = 'cancelled' then
      if v_intent_status <> 'cancelled' then
        raise exception 'a cancelled delivery requires a cancelled intent (intent is %)',
          v_intent_status;
      end if;
    end if;
    if new.status = 'skipped' then
      if v_intent_status not in ('failed', 'cancelled') then
        raise exception 'a skipped delivery requires a policy-refused intent (intent is %)',
          v_intent_status;
      end if;
      if new.failure_class is null or new.failure_class !~ '^policy_' then
        raise exception 'a skipped delivery requires its policy classification';
      end if;
      if new.execution_attempt_id is not null then
        select * into v_att from automation_execution_attempts
         where id = new.execution_attempt_id and tenant_id = new.tenant_id
           and automation_intent_id = new.automation_intent_id;
        if v_att.id is null or v_att.error_code !~ '^policy_' then
          raise exception 'a skipped delivery must cite the policy-refusal attempt';
        end if;
      end if;
    end if;
    if new.status = 'failed' then
      if old.purpose in ('broadcast', 'sequence') then
        if v_intent_status not in ('failed', 'expired', 'rejected') then
          raise exception 'a failed % delivery requires a terminally failed intent (intent is %)',
            old.purpose, v_intent_status;
        end if;
      elsif v_intent_status not in ('failed', 'expired', 'cancelled', 'rejected') then
        raise exception 'a failed delivery requires a terminally failed intent (intent is %)',
          v_intent_status;
      end if;
      if new.failure_class is null then
        raise exception 'a failed delivery requires its failure classification';
      end if;
      if new.execution_attempt_id is not null then
        select * into v_att from automation_execution_attempts
         where id = new.execution_attempt_id and tenant_id = new.tenant_id
           and automation_intent_id = new.automation_intent_id;
        if v_att.id is null
           or v_att.status not in ('failed_permanent', 'failed_transient', 'unknown') then
          raise exception 'a failed delivery cannot cite a non-failure attempt as evidence';
        end if;
      end if;
    end if;
    if new.status = 'submitted' then
      if new.failure_class is not null then
        raise exception 'a submitted delivery cannot carry a failure classification';
      end if;
      if v_intent_status <> 'succeeded' then
        raise exception 'a submitted delivery requires a succeeded intent (intent is %)',
          v_intent_status;
      end if;
      if new.execution_attempt_id is null then
        raise exception 'a submitted delivery requires its succeeded execution attempt';
      end if;
      select * into v_att from automation_execution_attempts
       where id = new.execution_attempt_id and tenant_id = new.tenant_id
         and automation_intent_id = new.automation_intent_id;
      if v_att.id is null then
        raise exception 'the cited execution attempt does not belong to this delivery''s intent';
      end if;
      if v_att.status <> 'succeeded' then
        raise exception 'a submitted delivery requires a SUCCEEDED attempt (attempt is %)',
          v_att.status;
      end if;
      if new.provider_message_id is null or new.submitted_at is null then
        raise exception 'a submitted delivery requires provider message id + submission time';
      end if;
      if v_att.external_reference is distinct from new.provider_message_id then
        raise exception 'provider message id must equal the attempt''s external reference';
      end if;
      if nullif(v_att.result ->> 'thread_id', '') is not null
         and new.provider_thread_id is distinct from nullif(v_att.result ->> 'thread_id', '') then
        raise exception 'provider thread id must agree with the attempt''s recorded thread';
      end if;
    end if;
  end if;
  return new;
end $$;

-- ============================================================================
-- RECONCILER — REPLACED with a SUPERSET. Phase-4/5 behaviour is byte-compatible;
-- a SEQUENCE delivery additionally keeps its execution row factual and lets the
-- sequence reconciler advance (or hold) the enrolment from that evidence.
-- ============================================================================
create or replace function marketing_delivery_reconcile(p_tenant uuid, p_delivery uuid)
returns jsonb
language plpgsql
as $$
declare
  v_d marketing_deliveries%rowtype;
  v_intent automation_intents%rowtype;
  v_attempt automation_execution_attempts%rowtype;
  v_new_status text;
  v_failure text;
  v_msg_id text;
  v_thread_id text;
  v_submitted timestamptz;
  v_disp marketing_broadcast_dispatches%rowtype;
begin
  if p_tenant is null or p_delivery is null then
    raise exception 'tenant and delivery required' using errcode = '22023';
  end if;
  select * into v_d from marketing_deliveries
   where id = p_delivery and tenant_id = p_tenant for update;
  if not found then
    raise exception 'delivery not found for tenant' using errcode = 'P0002';
  end if;
  if v_d.status in ('submitted', 'failed', 'skipped', 'cancelled') then
    return jsonb_build_object('delivery_id', v_d.id, 'status', v_d.status, 'changed', false);
  end if;

  select * into v_intent from automation_intents
   where id = v_d.automation_intent_id and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('delivery_id', v_d.id, 'status', v_d.status, 'changed', false,
                              'note', 'intent missing');
  end if;
  select * into v_attempt from automation_execution_attempts a
   where a.tenant_id = p_tenant and a.automation_intent_id = v_intent.id
   order by a.completed_at desc nulls last, a.started_at desc nulls last,
            a.created_at desc, a.id desc limit 1;

  v_new_status := case v_intent.status
    when 'succeeded' then 'submitted'
    when 'executing' then 'executing'
    when 'claimed'   then 'executing'
    when 'unknown'   then 'unknown'
    when 'expired'   then 'failed'
    when 'cancelled' then case when v_d.purpose in ('broadcast', 'sequence')
                               then 'cancelled' else 'failed' end
    when 'rejected'  then 'failed'
    when 'failed'    then case
      when v_d.purpose in ('broadcast', 'sequence') and v_attempt.id is not null
           and v_attempt.status = 'failed_permanent'
           and v_attempt.error_code ~ '^policy_' then 'skipped'
      when v_intent.attempts >= v_intent.max_attempts then 'failed'
      when v_attempt.id is not null and v_attempt.status = 'failed_permanent' then 'failed'
      else 'queued' end
    else 'queued' end;

  if v_new_status = v_d.status then
    return jsonb_build_object('delivery_id', v_d.id, 'status', v_d.status, 'changed', false);
  end if;
  if v_d.status = 'unknown' and v_new_status not in ('submitted', 'failed') then
    return jsonb_build_object('delivery_id', v_d.id, 'status', v_d.status, 'changed', false,
                              'note', 'unknown awaits reconciliation');
  end if;

  if v_new_status = 'submitted' and (v_attempt.id is null or v_attempt.status <> 'succeeded') then
    select * into v_attempt from automation_execution_attempts a
     where a.tenant_id = p_tenant and a.automation_intent_id = v_intent.id
       and a.status = 'succeeded'
     order by a.completed_at desc nulls last, a.created_at desc, a.id desc limit 1;
  end if;

  if v_new_status = 'submitted' then
    v_msg_id := v_attempt.external_reference;
    v_thread_id := nullif(v_attempt.result ->> 'thread_id', '');
    v_submitted := coalesce(v_attempt.completed_at, now());
    if v_msg_id is null then
      return jsonb_build_object('delivery_id', v_d.id, 'status', v_d.status, 'changed', false,
        'note', 'succeeded attempt has no provider reference');
    end if;
    update marketing_deliveries set
      status = 'submitted',
      provider_message_id = coalesce(provider_message_id, v_msg_id),
      provider_thread_id = coalesce(provider_thread_id, v_thread_id),
      submitted_at = coalesce(submitted_at, v_submitted),
      execution_attempt_id = v_attempt.id,
      failure_class = null
    where id = v_d.id;

    insert into email_messages
      (tenant_id, provider, provider_message_id, provider_thread_id, from_email, from_name,
       to_emails, subject, body_text, sent_at, direction, origin, origin_delivery_id,
       origin_automation_intent_id, origin_campaign_id, origin_person_id)
    values
      (p_tenant, 'gmail', v_msg_id, v_thread_id,
       coalesce(v_intent.parameters ->> 'mailbox_address', ''), v_d.from_name,
       jsonb_build_array(v_d.recipient_email), v_d.subject,
       case when v_d.purpose in ('broadcast', 'sequence') then v_d.body_text
            else v_d.body_text || case when v_d.signature_text is not null
                                       then e'\n\n--\n' || v_d.signature_text else '' end end,
       v_submitted, 'outbound', 'marketing_delivery', v_d.id, v_intent.id,
       v_d.campaign_id, v_d.person_id)
    on conflict (tenant_id, provider, provider_message_id) do update
      set origin = coalesce(email_messages.origin, excluded.origin),
          origin_delivery_id = coalesce(email_messages.origin_delivery_id,
                                        excluded.origin_delivery_id),
          origin_automation_intent_id = coalesce(email_messages.origin_automation_intent_id,
                                                 excluded.origin_automation_intent_id),
          origin_campaign_id = coalesce(email_messages.origin_campaign_id,
                                        excluded.origin_campaign_id),
          origin_person_id = coalesce(email_messages.origin_person_id,
                                      excluded.origin_person_id);

    insert into platform_jobs
      (tenant_id, module_id, job_type, job_key, status, priority, max_attempts, payload)
    values
      (p_tenant, 'core.interactions', 'interactions.sync',
       'interactions.sync:' || p_tenant || ':all', 'queued', 100, 5, '{}'::jsonb)
    on conflict (tenant_id, job_key)
      where job_key is not null and status in ('queued', 'running', 'retrying')
      do nothing;
  elsif v_new_status in ('failed', 'unknown', 'skipped') then
    v_failure := left(coalesce(v_attempt.error_class, v_attempt.error_code,
                               case when v_intent.status = 'expired' then 'expired' end,
                               'unclassified'), 120);
    if v_new_status = 'skipped' then
      v_failure := left(v_attempt.error_code, 120);
    end if;
    update marketing_deliveries set
      status = v_new_status, failure_class = v_failure,
      execution_attempt_id = coalesce(v_attempt.id, execution_attempt_id)
    where id = v_d.id;
  elsif v_new_status = 'cancelled' then
    update marketing_deliveries set status = 'cancelled' where id = v_d.id;
  else
    update marketing_deliveries set
      status = v_new_status,
      execution_attempt_id = coalesce(v_attempt.id, execution_attempt_id)
    where id = v_d.id;
  end if;

  insert into marketing_delivery_events
    (tenant_id, delivery_id, automation_intent_id, from_status, to_status, detail,
     execution_attempt_id)
  values (p_tenant, v_d.id, v_d.automation_intent_id, v_d.status, v_new_status,
          left(coalesce(v_failure, 'reconciled from execution attempt'), 300), v_attempt.id);

  -- ── broadcast: keep the DISPATCH factual + derive campaign completion ──
  if v_d.purpose = 'broadcast' and v_d.dispatch_id is not null then
    select * into v_disp from marketing_broadcast_dispatches
     where id = v_d.dispatch_id and tenant_id = p_tenant for update;
    if found and v_disp.status not in ('submitted', 'failed', 'skipped', 'cancelled') then
      if v_new_status = 'executing' and v_disp.status = 'queued' then
        update marketing_broadcast_dispatches set status = 'executing' where id = v_disp.id;
      elsif v_new_status in ('submitted', 'failed', 'unknown', 'skipped', 'cancelled')
            and v_disp.status in ('queued', 'executing', 'unknown') then
        update marketing_broadcast_dispatches set
          status = v_new_status,
          skip_reason = case when v_new_status = 'skipped' then v_failure else skip_reason end,
          failure_class = case when v_new_status = 'failed' then v_failure else failure_class end,
          finished_at = case when v_new_status in ('submitted', 'failed', 'skipped', 'cancelled')
                             then now() else finished_at end
        where id = v_disp.id;
      end if;
    end if;
    if v_new_status in ('submitted', 'failed', 'unknown') then
      perform marketing_event_append(p_tenant, 'marketing.message.' || v_new_status,
        'marketing_delivery', v_d.id, 'marketing-delivery-sync',
        jsonb_build_object('k', v_new_status || ':' || v_d.id,
                           'campaign', v_d.campaign_id, 'at', now()));
    end if;
    perform marketing_broadcast_check_completion(p_tenant, v_d.campaign_id);
  end if;

  -- ── sequence: the execution reconciler owns advancement/hold ──
  if v_d.purpose = 'sequence' and v_d.sequence_execution_id is not null then
    if v_new_status in ('submitted', 'failed', 'unknown', 'skipped') then
      perform marketing_event_append(p_tenant, 'marketing.message.' || v_new_status,
        'marketing_delivery', v_d.id, 'marketing-delivery-sync',
        jsonb_build_object('k', v_new_status || ':' || v_d.id,
                           'campaign', v_d.campaign_id, 'at', now()));
    end if;
    perform marketing_sequence_reconcile_execution(p_tenant, v_d.sequence_execution_id);
  end if;

  return jsonb_build_object('delivery_id', v_d.id, 'status', v_new_status, 'changed', true,
    'provider_message_id', v_msg_id);
end $$;

-- ============================================================================
-- BOUNDED READS — list, detail, enrolment page, report, health
-- ============================================================================
create or replace function marketing_sequence_list(p_tenant uuid, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
as $$
declare v_limit int := 25; v_rows jsonb;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  if p_args ? 'limit' then
    if jsonb_typeof(p_args -> 'limit') <> 'number' or (p_args ->> 'limit') ~ '[.eE]' then
      raise exception 'limit must be an integer' using errcode = '22023';
    end if;
    v_limit := least(greatest((p_args ->> 'limit')::int, 1), 100);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'description', c.description,
           'status', c.status, 'version', c.version, 'owner_id', c.owner_id,
           'owner_email', (select pr.email from profiles pr where pr.id = c.owner_id),
           'closed_at', c.sequence_closed_at,
           'sender_profile_id', r.sender_profile_id,
           'sender_mailbox', (select sp.mailbox_address from marketing_sender_profiles sp
                               where sp.id = r.sender_profile_id),
           'revision_id', r.id, 'revision_number', r.revision_number,
           'step_count', r.step_count, 'timezone', r.timezone,
           'entry_policy', r.entry_policy, 'reenrolment_policy', r.reenrolment_policy,
           'enrolment_counts', (select coalesce(jsonb_object_agg(e.status, e.n), '{}'::jsonb)
                                  from (select status, count(*) n
                                          from marketing_sequence_enrolments
                                         where tenant_id = p_tenant and campaign_id = c.id
                                         group by status) e),
           'exit_counts', (select coalesce(jsonb_object_agg(x.exit_reason, x.n), '{}'::jsonb)
                             from (select exit_reason, count(*) n
                                     from marketing_sequence_enrolments
                                    where tenant_id = p_tenant and campaign_id = c.id
                                      and exit_reason is not null
                                    group by exit_reason) x),
           'next_due_at', (select min(e2.next_eligible_at) from marketing_sequence_enrolments e2
                            where e2.tenant_id = p_tenant and e2.campaign_id = c.id
                              and e2.status = 'active'),
           'updated_at', c.updated_at, 'created_at', c.created_at
         ) order by c.updated_at desc), '[]'::jsonb)
    into v_rows
    from (select * from marketing_campaigns
           where tenant_id = p_tenant and campaign_type = 'sequence'
           order by updated_at desc limit v_limit) c
    left join marketing_sequence_revisions r
           on r.tenant_id = p_tenant and r.id = c.current_sequence_revision_id;
  -- surfaced so the authoring UI can only offer step types this platform can
  -- actually carry out. It reads the SAME authority marketing_sequence_create
  -- enforces, so the surface can never disagree with the server.
  return jsonb_build_object('sequences', v_rows,
                            'follow_up_available', marketing_sequence_follow_up_available());
end $$;

create or replace function marketing_sequence_detail(p_tenant uuid, p_campaign uuid)
returns jsonb
language plpgsql
stable
as $$
declare v_c marketing_campaigns%rowtype; v_out jsonb;
begin
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant and campaign_type = 'sequence';
  if not found then
    raise exception 'sequence not found for tenant' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'id', v_c.id, 'name', v_c.name, 'description', v_c.description, 'status', v_c.status,
    'version', v_c.version, 'owner_id', v_c.owner_id, 'closed_at', v_c.sequence_closed_at,
    'approved_at', v_c.approved_at, 'launched_at', v_c.launched_at,
    'completed_at', v_c.completed_at, 'cancelled_at', v_c.cancelled_at,
    'unsubscribe_base_configured', v_c.launch_public_base_url is not null,
    'revision', (select to_jsonb(r) - 'tenant_id' from marketing_sequence_revisions r
                  where r.tenant_id = p_tenant and r.id = v_c.current_sequence_revision_id),
    'steps', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', s.id, 'order', s.step_order, 'key', s.step_key, 'type', s.step_type,
                 'config', s.config, 'summary', s.summary, 'config_hash', s.config_hash)
                 order by s.step_order), '[]'::jsonb)
                from marketing_sequence_steps s
               where s.tenant_id = p_tenant and s.revision_id = v_c.current_sequence_revision_id),
    'revisions', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', r.id, 'revision_number', r.revision_number, 'step_count', r.step_count,
                     'created_at', r.created_at, 'bundle_hash', r.bundle_hash,
                     'live_enrolments', (select count(*) from marketing_sequence_enrolments e
                                          where e.tenant_id = p_tenant and e.revision_id = r.id
                                            and e.status in ('active', 'paused', 'held')))
                     order by r.revision_number desc), '[]'::jsonb)
                    from marketing_sequence_revisions r
                   where r.tenant_id = p_tenant and r.campaign_id = p_campaign),
    'approvals', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', a.id, 'decision', a.decision, 'revision_id', a.revision_id,
                     'approver', (select pr.email from profiles pr where pr.id = a.approver_profile_id),
                     'note', a.note, 'created_at', a.created_at)
                     order by a.created_at desc), '[]'::jsonb)
                    from marketing_sequence_approvals a
                   where a.tenant_id = p_tenant and a.campaign_id = p_campaign),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                  'seq', e.seq, 'from', e.from_status, 'to', e.to_status, 'actor', e.actor,
                  'detail', e.detail, 'at', e.created_at) order by e.seq), '[]'::jsonb)
                 from marketing_campaign_events e
                where e.tenant_id = p_tenant and e.campaign_id = p_campaign),
    'batches', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', b.id, 'source', b.source, 'candidate_count', b.candidate_count,
                   'eligible_count', b.eligible_count, 'excluded_count', b.excluded_count,
                   'exclusion_breakdown', b.exclusion_breakdown, 'enrolled_count', b.enrolled_count,
                   'confirmed_at', b.confirmed_at, 'created_at', b.created_at)
                   order by b.created_at desc), '[]'::jsonb)
                  from marketing_enrolment_batches b
                 where b.tenant_id = p_tenant and b.campaign_id = p_campaign))
    into v_out;
  return v_out;
end $$;

create or replace function marketing_sequence_report(p_tenant uuid, p_campaign uuid)
returns jsonb
language plpgsql
stable
as $$
declare v_c marketing_campaigns%rowtype;
begin
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant and campaign_type = 'sequence';
  if not found then
    raise exception 'sequence not found for tenant' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'campaign_id', v_c.id, 'status', v_c.status, 'closed_at', v_c.sequence_closed_at,
    'enrolments', (select coalesce(jsonb_object_agg(e.status, e.n), '{}'::jsonb)
                     from (select status, count(*) n from marketing_sequence_enrolments
                            where tenant_id = p_tenant and campaign_id = p_campaign
                            group by status) e),
    'exits', (select coalesce(jsonb_object_agg(x.exit_reason, x.n), '{}'::jsonb)
                from (select exit_reason, count(*) n from marketing_sequence_enrolments
                       where tenant_id = p_tenant and campaign_id = p_campaign
                         and exit_reason is not null group by exit_reason) x),
    'candidates', (select coalesce(sum(candidate_count), 0) from marketing_enrolment_batches
                    where tenant_id = p_tenant and campaign_id = p_campaign),
    'eligible', (select coalesce(sum(eligible_count), 0) from marketing_enrolment_batches
                  where tenant_id = p_tenant and campaign_id = p_campaign),
    'excluded', (select coalesce(sum(excluded_count), 0) from marketing_enrolment_batches
                  where tenant_id = p_tenant and campaign_id = p_campaign),
    'steps', (select coalesce(jsonb_agg(jsonb_build_object(
                 'order', s.step_order, 'type', s.step_type, 'summary', s.summary,
                 'executions', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
                                  from (select status, count(*) n
                                          from marketing_sequence_executions
                                         where tenant_id = p_tenant and step_id = s.id
                                         group by status) x))
                 order by s.step_order), '[]'::jsonb)
                from marketing_sequence_steps s
               where s.tenant_id = p_tenant and s.revision_id = v_c.current_sequence_revision_id),
    'unsubscribed', (select count(*) from marketing_unsubscribe_tokens t
                      where t.tenant_id = p_tenant and t.campaign_id = p_campaign
                        and t.used_at is not null),
    -- HONEST: no evidence pipeline exists for these — unavailable, never zero
    'delivered', null, 'opened', null, 'clicked', null, 'bounced', null,
    'tracking', jsonb_build_object('enabled', false, 'state', 'unavailable',
      'note', 'Click tracking is not implemented — no redirect endpoint exists and no click is ever fabricated'),
    'replied_proven', (select count(*) from marketing_sequence_enrolments
                        where tenant_id = p_tenant and campaign_id = p_campaign
                          and exit_reason = 'replied'),
    'bounce_evidence', 'unavailable — this pipeline receives no provider bounce evidence',
    'submitted_meaning', 'accepted by Gmail — NOT delivered');
end $$;

create or replace function marketing_sequence_enrolment_page(
  p_tenant uuid, p_campaign uuid, p_args jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
stable
as $$
declare
  v_limit int := 25; v_cur jsonb; v_cur_at timestamptz; v_cur_id uuid;
  v_rows jsonb; v_next jsonb; v_status text;
begin
  if p_tenant is null or p_campaign is null then
    raise exception 'tenant and campaign required' using errcode = '22023';
  end if;
  if p_args ? 'limit' then
    if jsonb_typeof(p_args -> 'limit') <> 'number' or (p_args ->> 'limit') ~ '[.eE]' then
      raise exception 'limit must be an integer' using errcode = '22023';
    end if;
    v_limit := least(greatest((p_args ->> 'limit')::int, 1), 50);
  end if;
  if p_args ? 'status' and jsonb_typeof(p_args -> 'status') <> 'null' then
    v_status := p_args ->> 'status';
    if v_status not in ('active', 'paused', 'completed', 'exited', 'held') then
      raise exception 'invalid status filter' using errcode = '22023';
    end if;
  end if;
  if p_args ? 'cursor' and jsonb_typeof(p_args -> 'cursor') <> 'null' then
    v_cur := p_args -> 'cursor';
    if jsonb_typeof(v_cur) <> 'object' or jsonb_typeof(v_cur -> 'at') <> 'string'
       or jsonb_typeof(v_cur -> 'id') <> 'string'
       or (select count(*) from jsonb_object_keys(v_cur)) <> 2 then
      raise exception 'invalid cursor' using errcode = '22023';
    end if;
    begin
      v_cur_at := (v_cur ->> 'at')::timestamptz;
      v_cur_id := (v_cur ->> 'id')::uuid;
    exception when others then
      raise exception 'invalid cursor' using errcode = '22023';
    end;
  end if;

  select coalesce(jsonb_agg(row_j order by created_at, id), '[]'::jsonb) into v_rows from (
    select e.created_at, e.id, jsonb_build_object(
      'enrolment_id', e.id, 'status', e.status, 'person_id', e.person_id,
      'display_name', (select p.display_name from people p where p.id = e.person_id),
      'destination_masked', regexp_replace(e.destination, '^(.).*(@.*)$', '\1***\2'),
      'current_step_order', e.current_step_order,
      'next_eligible_at', e.next_eligible_at, 'hold_reason', e.hold_reason,
      'exit_reason', e.exit_reason, 'exited_at', e.exited_at,
      'revision_number', (select r.revision_number from marketing_sequence_revisions r
                           where r.id = e.revision_id),
      'source', e.source, 'entered_at', e.entered_at,
      'last_execution_at', e.last_execution_at, 'created_at', e.created_at) as row_j
      from marketing_sequence_enrolments e
     where e.tenant_id = p_tenant and e.campaign_id = p_campaign
       and (v_status is null or e.status = v_status)
       and (v_cur_at is null or (e.created_at, e.id) > (v_cur_at, v_cur_id))
     order by e.created_at, e.id
     limit v_limit + 1
  ) page;

  if jsonb_array_length(v_rows) > v_limit then
    v_next := jsonb_build_object('at', (v_rows -> (v_limit - 1)) ->> 'created_at',
                                 'id', (v_rows -> (v_limit - 1)) ->> 'enrolment_id');
    v_rows := (select coalesce(jsonb_agg(t.e order by t.i), '[]'::jsonb)
                 from jsonb_array_elements(v_rows) with ordinality t(e, i)
                where t.i <= v_limit);
  end if;
  return jsonb_build_object('enrolments', v_rows, 'next_cursor', v_next);
end $$;

create or replace function marketing_sequence_health(p_tenant uuid)
returns jsonb
language plpgsql
stable
as $$
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'sequences', (select coalesce(jsonb_object_agg(c.status, c.n), '{}'::jsonb)
                    from (select status, count(*) n from marketing_campaigns
                           where tenant_id = p_tenant and campaign_type = 'sequence'
                           group by status) c),
    'due_now', (select count(*) from marketing_sequence_enrolments e
                 join marketing_campaigns c on c.id = e.campaign_id and c.tenant_id = e.tenant_id
                where e.tenant_id = p_tenant and e.status = 'active' and c.status = 'active'
                  and (e.next_eligible_at is null or e.next_eligible_at <= now())),
    'oldest_due_seconds', (select extract(epoch from (now() - min(e.next_eligible_at)))::int
                             from marketing_sequence_enrolments e
                             join marketing_campaigns c on c.id = e.campaign_id and c.tenant_id = e.tenant_id
                            where e.tenant_id = p_tenant and e.status = 'active' and c.status = 'active'
                              and e.next_eligible_at <= now()),
    'active_leases', (select count(*) from marketing_sequence_executions
                       where tenant_id = p_tenant and status = 'preparing'
                         and lease_expires_at >= now()),
    'expired_leases', (select count(*) from marketing_sequence_executions
                        where tenant_id = p_tenant and status = 'preparing'
                          and lease_expires_at < now()),
    'held_enrolments', (select count(*) from marketing_sequence_enrolments
                         where tenant_id = p_tenant and status = 'held'),
    'unknown_executions', (select count(*) from marketing_sequence_executions
                            where tenant_id = p_tenant and status = 'unknown'),
    'execution_totals', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
                           from (select status, count(*) n from marketing_sequence_executions
                                  where tenant_id = p_tenant group by status) x),
    'recent_failures', (select coalesce(jsonb_object_agg(f.failure_class, f.n), '{}'::jsonb)
                          from (select failure_class, count(*) n
                                  from marketing_sequence_executions
                                 where tenant_id = p_tenant and failure_class is not null
                                   and created_at > now() - interval '7 days'
                                 group by failure_class) f),
    'capability_enabled', coalesce((select enabled from tenant_connector_capabilities
                                     where tenant_id = p_tenant
                                       and connector_id = 'marketing-internal'
                                       and capability_key = 'marketing.contact_action'), false),
    'sender_health', marketing_sender_health(p_tenant));
end $$;

-- ============================================================================
-- SCHEDULER — one added definition; every existing schedule is preserved.
-- Adding this row INSTALLS NOTHING: an operator must explicitly run
-- serviceos_schedule_all() with MARKETING_SEQUENCE_SECRET configured.
-- ============================================================================
create or replace function serviceos_schedule_defs()
returns table (job text, fn text, secret text, sched text)
language sql immutable as $$
  select * from (values
    ('serviceos-worker',              'platform-worker',                         'WORKER_SECRET',                   '* * * * *'),
    ('serviceos-phone-sync',          'phone-scheduled-sync',                    'PHONE_SCHEDULE_SECRET',           '*/5 * * * *'),
    ('serviceos-phone-processing',    'phone-processing-scheduled-sync',         'PHONE_PROCESSING_SECRET',         '*/2 * * * *'),
    ('serviceos-email-sync',          'email-scheduled-sync',                    'EMAIL_SCHEDULE_SECRET',           '*/5 * * * *'),
    ('serviceos-email-workspace',     'email-workspace-scheduled-sync',          'EMAIL_WORKSPACE_SCHEDULE_SECRET', '*/5 * * * *'),
    ('serviceos-email-wksp-backfill', 'email-workspace-backfill-scheduled-sync', 'EMAIL_WORKSPACE_BACKFILL_SECRET', '*/15 * * * *'),
    ('serviceos-interactions',        'interactions-scheduled-sync',             'SIGNAL_SYNC_SECRET',              '*/5 * * * *'),
    ('serviceos-identity',            'identity-scheduled-sync',                 'IDENTITY_SYNC_SECRET',            '*/5 * * * *'),
    ('serviceos-business-graph',      'business-graph-scheduled-sync',           'GRAPH_SYNC_SECRET',               '*/5 * * * *'),
    ('serviceos-customer-cards',      'customer-card-scheduled-sync',            'CARD_SYNC_SECRET',                '*/5 * * * *'),
    ('serviceos-recommendations',     'recommendation-scheduled-sync',           'RECOMMENDATION_SYNC_SECRET',      '*/5 * * * *'),
    ('serviceos-intelligence-ingest', 'intelligence-ingestion-scheduled-sync',   'INTELLIGENCE_INGEST_SECRET',      '*/5 * * * *'),
    ('serviceos-marketing-broadcast', 'marketing-broadcast-scheduled-sync',      'MARKETING_BROADCAST_SECRET',      '* * * * *'),
    ('serviceos-marketing-sequence',  'marketing-sequence-scheduled-sync',       'MARKETING_SEQUENCE_SECRET',       '* * * * *')
  ) as t(job, fn, secret, sched);
$$;

-- ============================================================================
-- Grants — every Phase-6 RPC is SERVICE-ROLE ONLY.
-- ============================================================================
do $$
declare sig text;
begin
  foreach sig in array array[
    'marketing_sequence_capability_sync(uuid)',
    'marketing_sequence_validate_exit_rules(jsonb)',
    'marketing_sequence_validate_step(uuid, text, jsonb)',
    'marketing_sequence_follow_up_available()',
    'marketing_sequence_step_summary(text, jsonb)',
    'marketing_sequence_step_hash(text, jsonb)',
    'marketing_sequence_resolve_local(text, timestamp, text)',
    'marketing_sequence_next_window(text, jsonb, int, int, text, timestamptz)',
    'marketing_sequence_apply_quiet_hours(text, int, int, timestamptz)',
    'marketing_sequence_build_revision(uuid, uuid, uuid, int, uuid, jsonb, text)',
    'marketing_sequence_create(uuid, uuid, jsonb)',
    'marketing_sequence_revise(uuid, uuid, uuid, jsonb, int)',
    'marketing_sequence_validate(uuid, uuid, jsonb)',
    'marketing_sequence_transition(uuid, uuid, uuid, text, int, jsonb)',
    'marketing_sequence_preflight_activation(uuid, uuid, uuid, int, text)',
    'marketing_sequence_activate(uuid, uuid, uuid, jsonb)',
    'marketing_sequence_preflight_enrolment(uuid, uuid, uuid, jsonb)',
    'marketing_sequence_confirm_enrolment(uuid, uuid, uuid, jsonb)',
    'marketing_sequence_authority_core(uuid, uuid, uuid, boolean)',
    'marketing_sequence_send_authority(uuid, uuid)',
    'marketing_sequence_check_completion(uuid, uuid)',
    'marketing_sequence_exit_enrolment(uuid, uuid, text, jsonb, text)',
    'marketing_sequence_due(int)',
    'marketing_sequence_claim_batch(uuid, text, int, int)',
    'marketing_sequence_step_bundle(uuid, uuid, text)',
    'marketing_sequence_create_email_lineage(uuid, uuid, text, jsonb)',
    'marketing_sequence_create_action_lineage(uuid, uuid, text)',
    'marketing_sequence_create_follow_up(uuid, uuid, uuid, jsonb, uuid)',
    'marketing_sequence_reconcile_execution(uuid, uuid)',
    'marketing_sequence_apply_reply_exits(uuid, int)',
    'marketing_sequence_apply_lifecycle_exits(uuid, int)',
    'marketing_sequence_apply_suppression_exits(uuid, int)',
    'marketing_sequence_enrolment_control(uuid, uuid, uuid, text, jsonb)',
    'marketing_sequence_list(uuid, jsonb)',
    'marketing_sequence_detail(uuid, uuid)',
    'marketing_sequence_report(uuid, uuid)',
    'marketing_sequence_enrolment_page(uuid, uuid, jsonb)',
    'marketing_sequence_health(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated;', sig);
    execute format('grant execute on function %s to service_role;', sig);
  end loop;
end $$;

-- Trigger functions need no client EXECUTE at all: PostgreSQL checks the
-- privilege when the trigger is CREATED, and fires it as the table owner
-- thereafter. Revoking makes the Phase-6 boundary assertable with NO
-- exceptions — a catalog test can demand zero client-reachable functions.
do $$
declare sig text;
begin
  foreach sig in array array[
    'marketing_sequence_enrolment_guard()',
    'marketing_sequence_execution_guard()',
    'marketing_sequence_confirmation_guard()',
    'marketing_enrolment_batch_guard()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated;', sig);
  end loop;
end $$;
