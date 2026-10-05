-- ============================================================================
-- Marketing Phase 7 — Templates, Objectives & Honest Reporting, Governed AI
-- Drafting. Additive, run-once. Builds on the committed Phase 0–6 chain
-- (through 20260903120000_marketing_sequences.sql).
--
-- ONE SAFE CONTENT MODEL. Template revisions and AI proposals store EXACTLY
-- the Phase-5 authored content shape (subject / preview_text / body_authored /
-- token_fallbacks) and every content write passes through the ONE canonical
-- validator `marketing_campaign_validate_content` — the same authority that
-- governs Broadcasts and Sequence email steps. No second template language,
-- no executable code, no unrestricted HTML, no new renderer.
--
-- OBJECTIVES. The EXISTING `objective_links` model is extended additively with
-- a precise `marketing_campaign` target kind + a governed same-tenant
-- validator for that kind ONLY. Campaign↔Objective history is preserved in an
-- append-only marketing ledger; the legacy `objective_link_ref` placeholder is
-- frozen (legacy/null values stay readable; new writes are rejected).
--
-- AI DRAFTING. A governed Automation Engine capability
-- (`ai.generate_marketing_draft`) with an immutable-proposal / human-revision
-- provenance model mirroring the platform's response-proposal pattern.
-- Generation produces PROPOSALS only — acceptance writes DRAFTS only and can
-- never approve, launch or send.
-- ============================================================================

-- ============================================================================
-- PART A · TEMPLATES — tenant Template identity + IMMUTABLE revisions
-- ============================================================================

create table marketing_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null check (length(name) between 1 and 120 and name !~ '[[:cntrl:]]'),
  description text check (description is null
                          or (length(description) <= 500 and description !~ '[[:cntrl:]]')),
  status text not null default 'active' check (status in ('active', 'archived')),
  current_revision_id uuid,
  version int not null default 1 check (version >= 1),
  created_by uuid,
  updated_by uuid,
  archived_at timestamptz,
  archived_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
alter table marketing_templates
  add constraint mt_created_by_fk foreign key (tenant_id, created_by)
    references profiles (tenant_id, id) on delete set null,
  add constraint mt_updated_by_fk foreign key (tenant_id, updated_by)
    references profiles (tenant_id, id) on delete set null,
  add constraint mt_archived_by_fk foreign key (tenant_id, archived_by)
    references profiles (tenant_id, id) on delete set null;
create index marketing_templates_tenant_idx
  on marketing_templates (tenant_id, status, created_at desc, id);
create trigger marketing_templates_set_updated_at
  before update on marketing_templates
  for each row execute function set_updated_at();

-- lifecycle/identity guard: archive is a preserved state, never a delete;
-- identity and creation facts are immutable; version can never move backwards
create or replace function marketing_template_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' then
      raise exception 'a template is born active' using errcode = '22023';
    end if;
    if new.archived_at is not null or new.archived_by is not null then
      raise exception 'a new template carries no archive facts' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id
     or new.created_at <> old.created_at then
    raise exception 'template identity is immutable' using errcode = 'restrict_violation';
  end if;
  if new.created_by is distinct from old.created_by and new.created_by is not null then
    raise exception 'template creator is immutable' using errcode = 'restrict_violation';
  end if;
  if new.version < old.version then
    raise exception 'a template version can never move backwards' using errcode = '22023';
  end if;
  -- archive facts move only with their transition and stay consistent
  if new.status = 'archived' and new.archived_at is null then
    raise exception 'archiving records when and by whom' using errcode = '22023';
  end if;
  if new.status = 'active' and new.archived_at is not null then
    raise exception 'a restored template clears its archive facts' using errcode = '22023';
  end if;
  if new.status = old.status
     and (new.archived_at is distinct from old.archived_at
          or new.archived_by is distinct from old.archived_by)
     and not (new.archived_by is null and old.archived_by is not null) then
    -- archived_by may only be nulled by its FK set-null; otherwise archive
    -- facts change only with a status transition
    raise exception 'archive facts move only with their transition' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger marketing_templates_guard
  before insert or update on marketing_templates
  for each row execute function marketing_template_guard();

alter table marketing_templates enable row level security;
create policy marketing_templates_select on marketing_templates
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_templates to authenticated;
grant select, insert, update on marketing_templates to service_role;
revoke delete, truncate on marketing_templates from anon, authenticated, service_role;

-- ── IMMUTABLE template revisions — the exact Phase-5 authored content shape ──
create table marketing_template_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  template_id uuid not null,
  revision_number int not null check (revision_number >= 1),
  subject text not null check (length(subject) between 1 and 300),
  preview_text text check (preview_text is null or length(preview_text) <= 150),
  body_authored text not null check (length(body_authored) between 1 and 20000),
  tokens_required text[] not null default '{}',
  token_fallbacks jsonb not null default '{}'::jsonb,
  -- names the ONE canonical content format this revision was authored against
  -- (plain authored text + {{token}} personalisation + [label](https://url)
  -- links, rendered by the ONE deterministic Marketing renderer). Not a
  -- configurable: the platform has exactly one safe content format today.
  content_format text not null default 'marketing_text_v1'
    check (content_format = 'marketing_text_v1'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  source text not null default 'editor'
    check (source in ('editor', 'duplicate', 'ai_draft')),
  source_template_revision_id uuid,
  source_ai_proposal_id uuid,   -- FK added after the AI tables exist (Part B)
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, template_id, revision_number)
);
alter table marketing_template_revisions
  add constraint mtr_template_fk foreign key (tenant_id, template_id)
    references marketing_templates (tenant_id, id) on delete cascade,
  add constraint mtr_source_revision_fk foreign key (tenant_id, source_template_revision_id)
    references marketing_template_revisions (tenant_id, id),
  add constraint mtr_created_by_fk foreign key (tenant_id, created_by)
    references profiles (tenant_id, id) on delete set null;
create index marketing_template_revisions_idx
  on marketing_template_revisions (tenant_id, template_id, revision_number desc);
create trigger marketing_template_revisions_append_only_update
  before update on marketing_template_revisions
  for each row execute function marketing_history_append_only();
alter table marketing_templates
  add constraint mt_current_revision_fk foreign key (tenant_id, current_revision_id)
    references marketing_template_revisions (tenant_id, id) on delete set null;

alter table marketing_template_revisions enable row level security;
create policy marketing_template_revisions_select on marketing_template_revisions
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_template_revisions to authenticated;
grant select, insert on marketing_template_revisions to service_role;
revoke update, delete, truncate on marketing_template_revisions
  from anon, authenticated, service_role;

-- content-only deterministic hash (unlike the campaign revision hash it binds
-- NO sender/segment — a Template is content identity, and the Campaign's
-- frozen approved sender remains authoritative at send time)
create or replace function marketing_template_revision_hash(
  p_subject text, p_preview text, p_body text, p_tokens text[], p_fallbacks jsonb
) returns text
language sql
immutable
as $$
  select encode(extensions.digest(jsonb_build_object(
    'format', 'marketing_text_v1',
    'subject', p_subject, 'preview', p_preview, 'body', p_body,
    'tokens', to_jsonb(p_tokens), 'fallbacks', p_fallbacks)::text, 'sha256'), 'hex');
$$;

-- ── APPEND-ONLY usage ledger — every pin of a Template revision into campaign
--    content is recorded once, in the same transaction that stores the pin ──
create table marketing_template_usages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  template_id uuid not null,
  template_revision_id uuid not null,
  used_in text not null check (used_in in ('broadcast', 'sequence_step')),
  campaign_id uuid not null,
  campaign_revision_id uuid,
  sequence_revision_id uuid,
  sequence_step_key text,
  actor_profile_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint mtu_shape check (
    (used_in = 'broadcast' and campaign_revision_id is not null
       and sequence_revision_id is null and sequence_step_key is null)
    or (used_in = 'sequence_step' and sequence_revision_id is not null
       and sequence_step_key is not null and campaign_revision_id is null))
);
alter table marketing_template_usages
  add constraint mtu_template_fk foreign key (tenant_id, template_id)
    references marketing_templates (tenant_id, id) on delete cascade,
  add constraint mtu_template_revision_fk foreign key (tenant_id, template_revision_id)
    references marketing_template_revisions (tenant_id, id),
  add constraint mtu_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade,
  add constraint mtu_actor_fk foreign key (tenant_id, actor_profile_id)
    references profiles (tenant_id, id) on delete set null;
create index marketing_template_usages_template_idx
  on marketing_template_usages (tenant_id, template_id, created_at desc);
create index marketing_template_usages_campaign_idx
  on marketing_template_usages (tenant_id, campaign_id);
create trigger marketing_template_usages_append_only_update
  before update on marketing_template_usages
  for each row execute function marketing_history_append_only();
create trigger marketing_template_usages_append_only_delete
  before delete on marketing_template_usages
  for each row execute function marketing_history_append_only();

alter table marketing_template_usages enable row level security;
create policy marketing_template_usages_select on marketing_template_usages
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_template_usages to authenticated;
grant select, insert on marketing_template_usages to service_role;
revoke update, delete, truncate on marketing_template_usages
  from anon, authenticated, service_role;

-- ── campaign-revision lineage columns (additive; default null for every
--    existing row) + the source vocabulary extension ──
alter table marketing_campaign_revisions
  add column source_template_revision_id uuid,
  add column source_ai_proposal_id uuid;   -- FK added in Part B
alter table marketing_campaign_revisions
  add constraint mcr_source_template_revision_fk
    foreign key (tenant_id, source_template_revision_id)
    references marketing_template_revisions (tenant_id, id);
create index marketing_campaign_revisions_template_idx
  on marketing_campaign_revisions (tenant_id, source_template_revision_id)
  where source_template_revision_id is not null;
alter table marketing_campaign_revisions
  drop constraint marketing_campaign_revisions_source_check;
alter table marketing_campaign_revisions
  add constraint marketing_campaign_revisions_source_check
    check (source in ('editor', 'duplicate', 'template', 'ai_draft'));
-- lineage means "this content IS exactly that revision": enforced by the
-- lineage checks below (Part C) at every write path, so source values stay
-- coherent with their lineage columns
alter table marketing_campaign_revisions
  add constraint mcr_lineage_shape check (
    (source = 'template') = (source_template_revision_id is not null)
    and (source = 'ai_draft') = (source_ai_proposal_id is not null));

-- ============================================================================
-- PART A0 · prerequisite composite-FK targets on EXISTING tables (additive
-- unique indexes only — no behaviour change; the pattern Phase 5 used for
-- marketing_campaigns_tenant_id_uk)
-- ============================================================================
create unique index if not exists objectives_tenant_id_uk
  on objectives (tenant_id, id);
create unique index if not exists objective_links_tenant_id_uk
  on objective_links (tenant_id, id);

-- ============================================================================
-- PART B · GOVERNED AI DRAFTING — capability registration + immutable
-- proposal / human-revision provenance
--
-- The generation call is an EXTERNAL, PAID provider interaction, so it runs
-- through the frozen Automation Engine like every other governed external
-- call: registered capability + intent type + enabled contract + adapter,
-- immutable parameters, deterministic idempotency, append-only execution
-- attempts, bounded retries and the Operational-Mode re-check. The intent
-- type registers requires_approval = FALSE **honestly**: a user-triggered
-- draft generation is an explicitly authorised, DELEGATED draft action under
-- canonical `marketing.campaigns.draft` (the send-side precedent is the
-- Phase-4 delegated test send). NO approval row exists or is fabricated, and
-- generation can never send, approve or launch anything: its only write is an
-- immutable PROPOSAL row.
-- ============================================================================

insert into automation_connector_capabilities
  (capability_key, description, external_side_effect, risk_category)
values
  ('ai.generate_marketing_draft',
   'Generate a Marketing content draft PROPOSAL through the tenant-configured AI model provider. Produces an immutable proposal only — never sends, approves, launches or mutates campaign state.',
   true, 'medium')
on conflict (capability_key) do nothing;

insert into outcome_types (outcome_type, layer, description)
values
  ('marketing_ai_draft_recorded', 'operational',
   'An AI marketing draft proposal was generated and recorded (system_observed draft artifact — not a business outcome)')
on conflict (outcome_type) do nothing;

insert into automation_capability_contracts
  (capability_key, outcome_type, outcome_layer, adapter_version, enabled)
values
  ('ai.generate_marketing_draft', 'marketing_ai_draft_recorded', 'operational', '1', true)
on conflict (capability_key) do nothing;

insert into automation_intent_types
  (intent_type, connector_capability, risk_category, external_side_effect,
   supports_idempotency, supports_status_lookup, requires_approval,
   default_expiry_seconds, schema_version, enabled)
values
  ('generate_marketing_draft', 'ai.generate_marketing_draft', 'medium', true,
   true, false, false, 3600, '1', true)
on conflict (intent_type) do nothing;

-- owner/admin-only provider administration permission (additive vocabulary —
-- the same data-driven extension path every marketing permission used)
insert into marketing_permissions (permission, category, description)
values ('marketing.ai.manage', 'admin', 'Configure the AI drafting provider')
on conflict (permission) do nothing;
insert into marketing_role_defaults (role, permission)
values ('owner', 'marketing.ai.manage'), ('admin', 'marketing.ai.manage')
on conflict (role, permission) do nothing;

-- ── marketing_ai_requests — one row per generation request. The brief fields
--    are FROZEN here and on the intent; status is always DERIVED from engine
--    facts (never stored, never fabricatable). Only the close facts mutate,
--    write-once. ──
create table marketing_ai_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  automation_intent_id uuid not null,
  actor_profile_id uuid,
  destination_kind text not null
    check (destination_kind in ('template', 'broadcast', 'sequence_step')),
  destination_template_id uuid,
  destination_campaign_id uuid,
  objective_id uuid,
  campaign_objective text not null
    check (length(campaign_objective) between 1 and 500),
  offer text not null check (length(offer) between 1 and 500),
  audience text not null check (length(audience) between 1 and 500),
  why_care text check (why_care is null or length(why_care) <= 500),
  objection text check (objection is null or length(objection) <= 500),
  tone text check (tone is null or length(tone) <= 300),
  sender_context text check (sender_context is null or length(sender_context) <= 300),
  call_to_action text not null check (length(call_to_action) between 1 and 300),
  prompt_version text not null,
  request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  correlation_id uuid not null,
  closed_at timestamptz,
  closed_by uuid,
  closed_reason text check (closed_reason in ('rejected', 'superseded', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, request_id),
  unique (tenant_id, automation_intent_id),
  constraint mar_close_shape check (
    (closed_at is null and closed_reason is null)
    or (closed_at is not null and closed_reason is not null))
);
alter table marketing_ai_requests
  add constraint mar_intent_fk foreign key (tenant_id, automation_intent_id)
    references automation_intents (tenant_id, id) on delete cascade,
  add constraint mar_actor_fk foreign key (tenant_id, actor_profile_id)
    references profiles (tenant_id, id) on delete set null,
  add constraint mar_closed_by_fk foreign key (tenant_id, closed_by)
    references profiles (tenant_id, id) on delete set null,
  add constraint mar_template_fk foreign key (tenant_id, destination_template_id)
    references marketing_templates (tenant_id, id),
  add constraint mar_campaign_fk foreign key (tenant_id, destination_campaign_id)
    references marketing_campaigns (tenant_id, id),
  add constraint mar_objective_fk foreign key (tenant_id, objective_id)
    references objectives (tenant_id, id);
create index marketing_ai_requests_tenant_idx
  on marketing_ai_requests (tenant_id, created_at desc, id);

-- everything except the close facts is immutable; closing is write-once
create or replace function marketing_ai_request_guard()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id or new.tenant_id <> old.tenant_id
     or new.automation_intent_id <> old.automation_intent_id
     or new.destination_kind <> old.destination_kind
     or new.campaign_objective <> old.campaign_objective
     or new.offer <> old.offer
     or new.audience <> old.audience
     or new.why_care is distinct from old.why_care
     or new.objection is distinct from old.objection
     or new.tone is distinct from old.tone
     or new.sender_context is distinct from old.sender_context
     or new.call_to_action <> old.call_to_action
     or new.prompt_version <> old.prompt_version
     or new.request_id <> old.request_id
     or new.request_fingerprint <> old.request_fingerprint
     or new.correlation_id <> old.correlation_id
     or new.created_at <> old.created_at then
    raise exception 'an AI generation request is immutable' using errcode = 'restrict_violation';
  end if;
  -- reference columns may only be nulled by their FK set-null
  if (new.actor_profile_id is distinct from old.actor_profile_id and new.actor_profile_id is not null)
     or (new.destination_template_id is distinct from old.destination_template_id
         and new.destination_template_id is not null)
     or (new.destination_campaign_id is distinct from old.destination_campaign_id
         and new.destination_campaign_id is not null)
     or (new.objective_id is distinct from old.objective_id and new.objective_id is not null) then
    raise exception 'AI request references are immutable' using errcode = 'restrict_violation';
  end if;
  if old.closed_at is not null
     and (new.closed_at is distinct from old.closed_at
          or new.closed_reason is distinct from old.closed_reason
          or (new.closed_by is distinct from old.closed_by and new.closed_by is not null)) then
    raise exception 'a closed AI request cannot be re-closed' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger marketing_ai_requests_guard
  before update on marketing_ai_requests
  for each row execute function marketing_ai_request_guard();

alter table marketing_ai_requests enable row level security;
create policy marketing_ai_requests_select on marketing_ai_requests
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_ai_requests to authenticated;
grant select, insert, update on marketing_ai_requests to service_role;
revoke delete, truncate on marketing_ai_requests from anon, authenticated, service_role;

-- ── marketing_ai_proposals — the IMMUTABLE original model output, with full
--    model/prompt/usage provenance. Exactly one proposal per intent; a
--    regeneration is a NEW request + intent + proposal. ──
create table marketing_ai_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  ai_request_id uuid not null,
  automation_intent_id uuid not null,
  execution_attempt_id uuid,
  provider text not null check (length(provider) between 1 and 40),
  model text not null check (length(model) between 1 and 120),
  prompt_version text not null,
  subject text not null check (length(subject) between 1 and 300),
  preview_text text check (preview_text is null or length(preview_text) <= 150),
  body_authored text not null check (length(body_authored) between 1 and 20000),
  tokens_required text[] not null default '{}',
  token_fallbacks jsonb not null default '{}'::jsonb,
  content_format text not null default 'marketing_text_v1'
    check (content_format = 'marketing_text_v1'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  prompt_tokens int check (prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens int check (completion_tokens is null or completion_tokens >= 0),
  finish_reason text check (finish_reason is null or length(finish_reason) <= 60),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, automation_intent_id)
);
alter table marketing_ai_proposals
  add constraint map_request_fk foreign key (tenant_id, ai_request_id)
    references marketing_ai_requests (tenant_id, id) on delete cascade,
  add constraint map_intent_fk foreign key (tenant_id, automation_intent_id)
    references automation_intents (tenant_id, id) on delete cascade,
  -- an attempt reference must belong to THIS proposal's own intent (the
  -- Phase-4 delivery precedent: (tenant, intent, attempt) composite binding)
  add constraint map_attempt_fk foreign key
    (tenant_id, automation_intent_id, execution_attempt_id)
    references automation_execution_attempts (tenant_id, automation_intent_id, id);
create index marketing_ai_proposals_request_idx
  on marketing_ai_proposals (tenant_id, ai_request_id);
create trigger marketing_ai_proposals_append_only_update
  before update on marketing_ai_proposals
  for each row execute function marketing_history_append_only();

alter table marketing_ai_proposals enable row level security;
create policy marketing_ai_proposals_select on marketing_ai_proposals
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_ai_proposals to authenticated;
grant select, insert on marketing_ai_proposals to service_role;
revoke update, delete, truncate on marketing_ai_proposals
  from anon, authenticated, service_role;

-- ── marketing_ai_revisions — APPEND-ONLY human edits of a proposal. The
--    original AI output is never overwritten; every edit is a numbered
--    revision with its editor preserved. ──
create table marketing_ai_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  proposal_id uuid not null,
  revision_number int not null check (revision_number >= 1),
  subject text not null check (length(subject) between 1 and 300),
  preview_text text check (preview_text is null or length(preview_text) <= 150),
  body_authored text not null check (length(body_authored) between 1 and 20000),
  tokens_required text[] not null default '{}',
  token_fallbacks jsonb not null default '{}'::jsonb,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  editor_profile_id uuid,
  change_note text check (change_note is null or length(change_note) <= 500),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, proposal_id, revision_number)
);
alter table marketing_ai_revisions
  add constraint mair_proposal_fk foreign key (tenant_id, proposal_id)
    references marketing_ai_proposals (tenant_id, id) on delete cascade,
  add constraint mair_editor_fk foreign key (tenant_id, editor_profile_id)
    references profiles (tenant_id, id) on delete set null;
create trigger marketing_ai_revisions_append_only_update
  before update on marketing_ai_revisions
  for each row execute function marketing_history_append_only();

alter table marketing_ai_revisions enable row level security;
create policy marketing_ai_revisions_select on marketing_ai_revisions
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_ai_revisions to authenticated;
grant select, insert on marketing_ai_revisions to service_role;
revoke update, delete, truncate on marketing_ai_revisions
  from anon, authenticated, service_role;

-- AI lineage FKs deferred from Part A (the proposal table now exists)
alter table marketing_template_revisions
  add constraint mtr_source_ai_proposal_fk
    foreign key (tenant_id, source_ai_proposal_id)
    references marketing_ai_proposals (tenant_id, id);
alter table marketing_campaign_revisions
  add constraint mcr_source_ai_proposal_fk
    foreign key (tenant_id, source_ai_proposal_id)
    references marketing_ai_proposals (tenant_id, id);
create index marketing_campaign_revisions_ai_idx
  on marketing_campaign_revisions (tenant_id, source_ai_proposal_id)
  where source_ai_proposal_id is not null;

-- ============================================================================
-- PART C · LINEAGE AUTHORITIES + campaign/sequence content supersets
--
-- Lineage means "this content IS exactly that pinned revision". A lineage
-- claim that does not byte-match its source is rejected, so provenance can
-- never lie. Editing template-derived content afterwards simply drops the pin
-- (an ordinary editor revision) — the Template's own history is untouched.
-- ============================================================================

create or replace function marketing_template_lineage_check(
  p_tenant uuid, p_template_revision uuid,
  p_subject text, p_preview text, p_body text, p_fallbacks jsonb
) returns uuid   -- the owning template id
language plpgsql
stable
as $$
declare
  v_rev marketing_template_revisions%rowtype;
  v_status text;
begin
  if p_tenant is null or p_template_revision is null then
    raise exception 'tenant and template revision required' using errcode = '22023';
  end if;
  select * into v_rev from marketing_template_revisions
   where id = p_template_revision and tenant_id = p_tenant;
  if not found then
    raise exception 'template revision not found for tenant' using errcode = 'P0002';
  end if;
  select status into v_status from marketing_templates
   where id = v_rev.template_id and tenant_id = p_tenant;
  if v_status is distinct from 'active' then
    raise exception 'an archived template cannot be selected for new content — restore it first'
      using errcode = '22023';
  end if;
  if v_rev.subject is distinct from p_subject
     or v_rev.preview_text is distinct from p_preview
     or v_rev.body_authored is distinct from p_body
     or v_rev.token_fallbacks is distinct from coalesce(p_fallbacks, '{}'::jsonb) then
    raise exception 'template lineage requires the exact pinned revision content — edited content is an ordinary editor revision without the pin'
      using errcode = '22023';
  end if;
  return v_rev.template_id;
end $$;

create or replace function marketing_ai_lineage_check(
  p_tenant uuid, p_proposal uuid,
  p_subject text, p_preview text, p_body text, p_fallbacks jsonb
) returns uuid   -- the proposal's ai_request id
language plpgsql
stable
as $$
declare
  v_p marketing_ai_proposals%rowtype;
begin
  if p_tenant is null or p_proposal is null then
    raise exception 'tenant and proposal required' using errcode = '22023';
  end if;
  select * into v_p from marketing_ai_proposals
   where id = p_proposal and tenant_id = p_tenant;
  if not found then
    raise exception 'AI proposal not found for tenant' using errcode = 'P0002';
  end if;
  if not (
    (v_p.subject is not distinct from p_subject
     and v_p.preview_text is not distinct from p_preview
     and v_p.body_authored is not distinct from p_body
     and v_p.token_fallbacks is not distinct from coalesce(p_fallbacks, '{}'::jsonb))
    or exists (
      select 1 from marketing_ai_revisions r
       where r.tenant_id = p_tenant and r.proposal_id = p_proposal
         and r.subject is not distinct from p_subject
         and r.preview_text is not distinct from p_preview
         and r.body_authored is not distinct from p_body
         and r.token_fallbacks is not distinct from coalesce(p_fallbacks, '{}'::jsonb))
  ) then
    raise exception 'AI lineage requires content equal to the immutable proposal or one of its recorded human revisions'
      using errcode = '22023';
  end if;
  return v_p.ai_request_id;
end $$;

-- ── usage recording — fired by the INSERT that stores the pin, so a lineage
--    pin and its usage-ledger row can never diverge ──
create or replace function marketing_template_usage_record()
returns trigger
language plpgsql
as $$
declare
  v_tpl uuid;
  v_rev uuid;
begin
  if tg_table_name = 'marketing_campaign_revisions' then
    v_rev := new.source_template_revision_id;
    if v_rev is null then
      return new;
    end if;
    select template_id into v_tpl from marketing_template_revisions
     where id = v_rev and tenant_id = new.tenant_id;
    insert into marketing_template_usages
      (tenant_id, template_id, template_revision_id, used_in, campaign_id,
       campaign_revision_id, actor_profile_id)
    values (new.tenant_id, v_tpl, v_rev, 'broadcast', new.campaign_id,
            new.id, new.created_by);
    perform marketing_event_append(new.tenant_id, 'marketing.template.used',
      'marketing_template', v_tpl, 'marketing-templates',
      jsonb_build_object('k', 'used:' || new.id, 'revision', v_rev,
                         'campaign', new.campaign_id, 'in', 'broadcast', 'at', now()));
  elsif tg_table_name = 'marketing_sequence_steps' then
    if not (new.config ? 'source_template_revision_id') then
      return new;
    end if;
    v_rev := (new.config ->> 'source_template_revision_id')::uuid;
    select template_id into v_tpl from marketing_template_revisions
     where id = v_rev and tenant_id = new.tenant_id;
    insert into marketing_template_usages
      (tenant_id, template_id, template_revision_id, used_in, campaign_id,
       sequence_revision_id, sequence_step_key)
    values (new.tenant_id, v_tpl, v_rev, 'sequence_step', new.campaign_id,
            new.revision_id, new.step_key);
    perform marketing_event_append(new.tenant_id, 'marketing.template.used',
      'marketing_template', v_tpl, 'marketing-templates',
      jsonb_build_object('k', 'used:' || new.id, 'revision', v_rev,
                         'campaign', new.campaign_id, 'in', 'sequence_step', 'at', now()));
  end if;
  return new;
end $$;
create trigger marketing_campaign_revisions_template_usage
  after insert on marketing_campaign_revisions
  for each row execute function marketing_template_usage_record();
create trigger marketing_sequence_steps_template_usage
  after insert on marketing_sequence_steps
  for each row execute function marketing_template_usage_record();

-- structural defence in depth: a campaign revision's lineage columns are
-- verified at the ROW boundary too, so even a direct service-role insert
-- cannot record a lineage lie
create or replace function marketing_campaign_revision_lineage_guard()
returns trigger
language plpgsql
as $$
begin
  if new.source_template_revision_id is not null then
    perform marketing_template_lineage_check(
      new.tenant_id, new.source_template_revision_id,
      new.subject, new.preview_text, new.body_authored, new.token_fallbacks);
  end if;
  if new.source_ai_proposal_id is not null then
    perform marketing_ai_lineage_check(
      new.tenant_id, new.source_ai_proposal_id,
      new.subject, new.preview_text, new.body_authored, new.token_fallbacks);
  end if;
  return new;
end $$;
create trigger marketing_campaign_revisions_lineage_guard
  before insert on marketing_campaign_revisions
  for each row execute function marketing_campaign_revision_lineage_guard();

-- the SAME structural defence for SEQUENCE STEPS: a step's config-carried
-- lineage keys are verified at the ROW boundary too, so even a direct
-- service-role insert cannot record a lineage lie — or mint a false
-- usage-ledger fact through the AFTER-insert usage recorder. (The governed
-- path already validates through marketing_sequence_validate_step; this
-- guard makes the invariant structural, exactly as campaign revisions have.)
create or replace function marketing_sequence_step_lineage_guard()
returns trigger
language plpgsql
as $$
declare
  v_lin uuid;
begin
  if new.config is null
     or not (new.config ? 'source_template_revision_id'
             or new.config ? 'source_ai_proposal_id') then
    return new;
  end if;
  if new.step_type <> 'send_email' then
    raise exception 'only a send_email step can carry content lineage'
      using errcode = '22023';
  end if;
  if new.config ? 'source_template_revision_id' and new.config ? 'source_ai_proposal_id' then
    raise exception 'content lineage names ONE source — a template revision or an AI proposal, never both'
      using errcode = '22023';
  end if;
  if new.config ? 'source_template_revision_id' then
    begin
      v_lin := (new.config ->> 'source_template_revision_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'source_template_revision_id must be a uuid' using errcode = '22023';
    end;
    perform marketing_template_lineage_check(new.tenant_id, v_lin,
      new.config ->> 'subject', nullif(new.config ->> 'preview_text', ''),
      new.config ->> 'body_authored', coalesce(new.config -> 'token_fallbacks', '{}'::jsonb));
  else
    begin
      v_lin := (new.config ->> 'source_ai_proposal_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'source_ai_proposal_id must be a uuid' using errcode = '22023';
    end;
    perform marketing_ai_lineage_check(new.tenant_id, v_lin,
      new.config ->> 'subject', nullif(new.config ->> 'preview_text', ''),
      new.config ->> 'body_authored', coalesce(new.config -> 'token_fallbacks', '{}'::jsonb));
  end if;
  return new;
end $$;
create trigger marketing_sequence_steps_lineage_guard
  before insert on marketing_sequence_steps
  for each row execute function marketing_sequence_step_lineage_guard();

-- ============================================================================
-- PART C2 · SUPERSET REPLACEMENTS (the Phase-5→6 pattern: every existing
-- behaviour preserved verbatim and re-proven by the untouched earlier suites;
-- the ONLY additions are the two optional lineage keys and their validation)
-- ============================================================================

create or replace function marketing_campaign_create(p_tenant uuid, p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_name text;
  v_desc text;
  v_sender marketing_sender_profiles%rowtype;
  v_seg marketing_segments%rowtype;
  v_tokens text[];
  v_hash text;
  v_campaign uuid := gen_random_uuid();
  v_rev uuid := gen_random_uuid();
  v_fallbacks jsonb;
  v_source text := 'editor';
  v_src_tpl uuid;
  v_src_ai uuid;
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('name', 'description', 'sender_id', 'segment_id', 'subject',
                     'preview_text', 'body_authored', 'token_fallbacks',
                     'source_template_revision_id', 'source_ai_proposal_id') then
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
  v_fallbacks := coalesce(p_args -> 'token_fallbacks', '{}'::jsonb);
  v_tokens := marketing_campaign_validate_content(
    p_args ->> 'subject', p_args ->> 'preview_text', p_args ->> 'body_authored', v_fallbacks);
  -- content lineage (Phase 7): a lineage claim must byte-match its source
  if p_args ? 'source_template_revision_id' and p_args ? 'source_ai_proposal_id' then
    raise exception 'content lineage names ONE source — a template revision or an AI proposal, never both'
      using errcode = '22023';
  end if;
  if p_args ? 'source_template_revision_id' then
    begin
      v_src_tpl := (p_args ->> 'source_template_revision_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'source_template_revision_id must be a uuid' using errcode = '22023';
    end;
    perform marketing_template_lineage_check(p_tenant, v_src_tpl,
      p_args ->> 'subject', p_args ->> 'preview_text', p_args ->> 'body_authored',
      v_fallbacks);
    v_source := 'template';
  elsif p_args ? 'source_ai_proposal_id' then
    begin
      v_src_ai := (p_args ->> 'source_ai_proposal_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'source_ai_proposal_id must be a uuid' using errcode = '22023';
    end;
    perform marketing_ai_lineage_check(p_tenant, v_src_ai,
      p_args ->> 'subject', p_args ->> 'preview_text', p_args ->> 'body_authored',
      v_fallbacks);
    v_source := 'ai_draft';
  end if;
  v_hash := marketing_campaign_revision_hash(
    v_sender.id, v_seg.id, v_seg.definition_version, p_args ->> 'subject',
    p_args ->> 'preview_text', p_args ->> 'body_authored', v_tokens, v_fallbacks);

  insert into marketing_campaigns
    (id, tenant_id, name, description, campaign_type, status, owner_id,
     sender_profile_id, segment_id, created_by, version)
  values (v_campaign, p_tenant, v_name, v_desc, 'broadcast', 'draft', p_actor,
          v_sender.id, v_seg.id, p_actor, 1);
  insert into marketing_campaign_revisions
    (id, tenant_id, campaign_id, revision_number, sender_profile_id, segment_id,
     segment_version, subject, preview_text, body_authored, tokens_required,
     token_fallbacks, content_hash, source, source_template_revision_id,
     source_ai_proposal_id, created_by)
  values (v_rev, p_tenant, v_campaign, 1, v_sender.id, v_seg.id,
          v_seg.definition_version, p_args ->> 'subject', p_args ->> 'preview_text',
          p_args ->> 'body_authored', v_tokens, v_fallbacks, v_hash, v_source,
          v_src_tpl, v_src_ai, p_actor);
  update marketing_campaigns set current_revision_id = v_rev where id = v_campaign;
  insert into marketing_campaign_events (tenant_id, campaign_id, from_status, to_status, actor, detail)
  values (p_tenant, v_campaign, null, 'draft', v_label, 'campaign created');

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.campaign.created', 'marketing_campaign',
          v_campaign::text, 'ok', jsonb_build_object('name', v_name, 'revision', 1));
  perform marketing_event_append(p_tenant, 'marketing.campaign.created', 'marketing_campaign',
    v_campaign, 'marketing-campaigns',
    jsonb_build_object('k', 'created:' || v_campaign, 'actor', v_label, 'at', now()));

  return jsonb_build_object('id', v_campaign, 'revision_id', v_rev, 'status', 'draft',
                            'version', 1, 'content_hash', v_hash);
end $$;

create or replace function marketing_campaign_revise(
  p_tenant uuid, p_actor uuid, p_campaign uuid, p_args jsonb, p_expected_version int
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_c marketing_campaigns%rowtype;
  v_prev marketing_campaign_revisions%rowtype;
  v_key text;
  v_sender marketing_sender_profiles%rowtype;
  v_seg marketing_segments%rowtype;
  v_tokens text[];
  v_hash text;
  v_rev uuid := gen_random_uuid();
  v_n int;
  v_fallbacks jsonb;
  v_subject text;
  v_preview text;
  v_body text;
  v_from_status text;
  v_name text;
  v_desc text;
  v_seeded boolean;
  v_source text := 'editor';
  v_src_tpl uuid;
  v_src_ai uuid;
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  if p_campaign is null or p_expected_version is null then
    raise exception 'campaign and expected_version required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' or p_args = '{}'::jsonb then
    raise exception 'changes must be a non-empty object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('name', 'description', 'sender_id', 'segment_id', 'subject',
                     'preview_text', 'body_authored', 'token_fallbacks',
                     'source_template_revision_id', 'source_ai_proposal_id') then
      raise exception 'unknown revise argument %', v_key using errcode = '22023';
    end if;
  end loop;
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant for update;
  if not found then
    raise exception 'campaign not found for tenant' using errcode = 'P0002';
  end if;
  if v_c.version <> p_expected_version then
    raise exception 'campaign changed since it was read' using errcode = 'MK409';
  end if;
  if v_c.status not in ('draft', 'review', 'approved') then
    raise exception 'a % campaign cannot be revised — cancel or complete it first', v_c.status
      using errcode = '22023';
  end if;
  select * into v_prev from marketing_campaign_revisions
   where tenant_id = p_tenant and id = v_c.current_revision_id;
  if not found then
    -- a PRE-PHASE-5 skeleton campaign has no revision yet: the first revise
    -- bootstraps revision 1 and must therefore supply the full content
    if not (p_args ? 'sender_id' and p_args ? 'segment_id'
            and p_args ? 'subject' and p_args ? 'body_authored') then
      raise exception 'this campaign has no revision yet — the first revision needs sender_id, segment_id, subject and body_authored'
        using errcode = '22023';
    end if;
  end if;

  -- effective values = previous revision (when one exists) overlaid with the
  -- supplied changes
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
  begin
    select * into v_seg from marketing_segments
     where id = coalesce((p_args ->> 'segment_id')::uuid, v_prev.segment_id)
       and tenant_id = p_tenant;
  exception when others then
    raise exception 'invalid segment id' using errcode = '22023';
  end;
  if v_seg.id is null or v_seg.status <> 'active' then
    raise exception 'segment not found or archived' using errcode = '22023';
  end if;
  -- name/description are validated EXACTLY as on create — a revision can never
  -- introduce an oversized or control-character campaign identity
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
  v_subject := coalesce(p_args ->> 'subject', v_prev.subject);
  v_preview := case when p_args ? 'preview_text'
                    then nullif(p_args ->> 'preview_text', '') else v_prev.preview_text end;
  v_body := coalesce(p_args ->> 'body_authored', v_prev.body_authored);
  v_fallbacks := coalesce(p_args -> 'token_fallbacks', v_prev.token_fallbacks, '{}'::jsonb);
  v_tokens := marketing_campaign_validate_content(v_subject, v_preview, v_body, v_fallbacks);
  -- content lineage (Phase 7): a lineage claim must byte-match its source,
  -- judged over the EFFECTIVE content this revision will store
  if p_args ? 'source_template_revision_id' and p_args ? 'source_ai_proposal_id' then
    raise exception 'content lineage names ONE source — a template revision or an AI proposal, never both'
      using errcode = '22023';
  end if;
  if p_args ? 'source_template_revision_id' then
    begin
      v_src_tpl := (p_args ->> 'source_template_revision_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'source_template_revision_id must be a uuid' using errcode = '22023';
    end;
    perform marketing_template_lineage_check(p_tenant, v_src_tpl,
      v_subject, v_preview, v_body, v_fallbacks);
    v_source := 'template';
  elsif p_args ? 'source_ai_proposal_id' then
    begin
      v_src_ai := (p_args ->> 'source_ai_proposal_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'source_ai_proposal_id must be a uuid' using errcode = '22023';
    end;
    perform marketing_ai_lineage_check(p_tenant, v_src_ai,
      v_subject, v_preview, v_body, v_fallbacks);
    v_source := 'ai_draft';
  end if;
  v_hash := marketing_campaign_revision_hash(
    v_sender.id, v_seg.id, v_seg.definition_version, v_subject, v_preview, v_body,
    v_tokens, v_fallbacks);

  select coalesce(max(revision_number), 0) + 1 into v_n
    from marketing_campaign_revisions
   where tenant_id = p_tenant and campaign_id = p_campaign;
  insert into marketing_campaign_revisions
    (id, tenant_id, campaign_id, revision_number, sender_profile_id, segment_id,
     segment_version, subject, preview_text, body_authored, tokens_required,
     token_fallbacks, content_hash, source, source_template_revision_id,
     source_ai_proposal_id, created_by)
  values (v_rev, p_tenant, p_campaign, v_n, v_sender.id, v_seg.id,
          v_seg.definition_version, v_subject, v_preview, v_body, v_tokens,
          v_fallbacks, v_hash, v_source, v_src_tpl, v_src_ai, p_actor);

  v_from_status := v_c.status;
  -- editing invalidates approval/preflight through a NEW revision + draft
  -- state — history stays append-only, nothing is deleted
  update marketing_campaigns set
    name = case when p_args ? 'name' then v_name else name end,
    description = case when p_args ? 'description' then v_desc else description end,
    current_revision_id = v_rev,
    sender_profile_id = v_sender.id,
    segment_id = v_seg.id,
    status = 'draft',
    version = version + 1
  where id = p_campaign
  returning * into v_c;
  -- a pre-Phase-5 skeleton has no chain at all: its FIRST recorded fact is the
  -- initial draft record, not a fabricated transition out of a status nothing
  -- ever recorded
  v_seeded := marketing_campaign_seed_event_chain(p_tenant, p_campaign, v_label);
  if not v_seeded and v_from_status <> 'draft' then
    insert into marketing_campaign_events (tenant_id, campaign_id, from_status, to_status, actor, detail)
    values (p_tenant, p_campaign, v_from_status, 'draft', v_label,
            'revision ' || v_n || ' created — approval and preflight invalidated');
  end if;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.campaign.revised', 'marketing_campaign',
          p_campaign::text, 'ok', jsonb_build_object('revision', v_n));
  perform marketing_event_append(p_tenant, 'marketing.campaign.revised', 'marketing_campaign',
    p_campaign, 'marketing-campaigns',
    jsonb_build_object('k', 'revised:' || v_rev, 'revision', v_n, 'actor', v_label, 'at', now()));

  return jsonb_build_object('id', p_campaign, 'revision_id', v_rev, 'revision', v_n,
    'status', v_c.status, 'version', v_c.version, 'content_hash', v_hash);
end $$;

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
  v_lin uuid;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'step config must be an object' using errcode = '22023';
  end if;

  if p_type = 'send_email' then
    for v_key in select jsonb_object_keys(p_config) loop
      if v_key not in ('subject', 'preview_text', 'body_authored', 'token_fallbacks',
                       'source_template_revision_id', 'source_ai_proposal_id') then
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
    -- content lineage (Phase 7): a lineage claim must byte-match its source
    if p_config ? 'source_template_revision_id' and p_config ? 'source_ai_proposal_id' then
      raise exception 'content lineage names ONE source — a template revision or an AI proposal, never both'
        using errcode = '22023';
    end if;
    if p_config ? 'source_template_revision_id' then
      begin
        v_lin := (p_config ->> 'source_template_revision_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'source_template_revision_id must be a uuid' using errcode = '22023';
      end;
      perform marketing_template_lineage_check(p_tenant, v_lin,
        p_config ->> 'subject', nullif(p_config ->> 'preview_text', ''),
        p_config ->> 'body_authored', coalesce(p_config -> 'token_fallbacks', '{}'::jsonb));
      v_out := v_out || jsonb_build_object('source_template_revision_id', v_lin::text);
    elsif p_config ? 'source_ai_proposal_id' then
      begin
        v_lin := (p_config ->> 'source_ai_proposal_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'source_ai_proposal_id must be a uuid' using errcode = '22023';
      end;
      perform marketing_ai_lineage_check(p_tenant, v_lin,
        p_config ->> 'subject', nullif(p_config ->> 'preview_text', ''),
        p_config ->> 'body_authored', coalesce(p_config -> 'token_fallbacks', '{}'::jsonb));
      v_out := v_out || jsonb_build_object('source_ai_proposal_id', v_lin::text);
    end if;

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

-- ============================================================================
-- PART D · TEMPLATE RPCs — service-role-only authoring/read surface. Every
-- content write passes marketing_campaign_validate_content (the ONE canonical
-- validator); every revision is immutable; archive preserves all history and
-- existing campaign usage.
--
-- EVERY template MUTATION is request-id idempotent through the canonical
-- marketing_request_keys ledger (the Phase-2 mechanism): validate the id →
-- fingerprint EVERY semantic input (tenant, genuine actor, action, explicit
-- resource/version params and the full argument object) → per-request
-- advisory lock → consult the ledger BEFORE any version/status gate, so a
-- byte-identical replay returns the ORIGINAL result even after the resource
-- advanced → changed reuse of the same id is MK412 → the exact result is
-- persisted atomically with the side effects. A different actor reusing the
-- key fingerprints differently and conflicts — one actor can never receive
-- another actor's stored result.
-- ============================================================================

-- shared gate: validates the request id, locks, and returns the stored result
-- for an identical replay (null = proceed); changed reuse raises MK412
create or replace function marketing_template_request_gate(
  p_tenant uuid, p_action text, p_request_id text, p_fp text
) returns jsonb
language plpgsql
as $$
declare
  v_stored marketing_request_keys%rowtype;
begin
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'request_id must match ^[A-Za-z0-9_-]{8,64}$' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant::text || '|' || p_action || '|' || p_request_id, 42));
  select * into v_stored from marketing_request_keys
   where tenant_id = p_tenant
     and idempotency_key = md5(p_action || ':' || p_request_id)::uuid;
  if found then
    if v_stored.fingerprint = p_fp then
      return v_stored.result;
    end if;
    raise exception 'request_id was already used for a DIFFERENT request'
      using errcode = 'MK412';
  end if;
  return null;
end $$;

create or replace function marketing_template_create(p_tenant uuid, p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_name text;
  v_desc text;
  v_tokens text[];
  v_hash text;
  v_template uuid := gen_random_uuid();
  v_rev uuid := gen_random_uuid();
  v_fallbacks jsonb;
  v_source text := 'editor';
  v_src_ai uuid;
  v_request_id text;
  v_fp text;
  v_stored jsonb;
  v_result jsonb;
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('name', 'description', 'subject', 'preview_text', 'body_authored',
                     'token_fallbacks', 'source_ai_proposal_id', 'request_id') then
      raise exception 'unknown template create argument %', v_key using errcode = '22023';
    end if;
  end loop;
  -- REQUEST IDEMPOTENCY FIRST: the fingerprint binds every semantic input;
  -- an identical replay converges on the stored result before any other gate
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'template_create',
    'args', p_args - 'request_id')::text, 'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'template_create',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored;
  end if;
  v_name := nullif(trim(coalesce(p_args ->> 'name', '')), '');
  if v_name is null or length(v_name) > 120 or v_name ~ '[[:cntrl:]]' then
    raise exception 'name required (max 120 clean chars)' using errcode = '22023';
  end if;
  v_desc := nullif(trim(coalesce(p_args ->> 'description', '')), '');
  if v_desc is not null and (length(v_desc) > 500 or v_desc ~ '[[:cntrl:]]') then
    raise exception 'description is bounded to 500 clean chars' using errcode = '22023';
  end if;
  v_fallbacks := coalesce(p_args -> 'token_fallbacks', '{}'::jsonb);
  v_tokens := marketing_campaign_validate_content(
    p_args ->> 'subject', p_args ->> 'preview_text', p_args ->> 'body_authored', v_fallbacks);
  if p_args ? 'source_ai_proposal_id' then
    begin
      v_src_ai := (p_args ->> 'source_ai_proposal_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'source_ai_proposal_id must be a uuid' using errcode = '22023';
    end;
    perform marketing_ai_lineage_check(p_tenant, v_src_ai,
      p_args ->> 'subject', nullif(p_args ->> 'preview_text', ''),
      p_args ->> 'body_authored', v_fallbacks);
    v_source := 'ai_draft';
  end if;
  v_hash := marketing_template_revision_hash(
    p_args ->> 'subject', nullif(p_args ->> 'preview_text', ''),
    p_args ->> 'body_authored', v_tokens, v_fallbacks);

  insert into marketing_templates (id, tenant_id, name, description, status, created_by,
                                   updated_by, version)
  values (v_template, p_tenant, v_name, v_desc, 'active', p_actor, p_actor, 1);
  insert into marketing_template_revisions
    (id, tenant_id, template_id, revision_number, subject, preview_text, body_authored,
     tokens_required, token_fallbacks, content_hash, source, source_ai_proposal_id,
     created_by)
  values (v_rev, p_tenant, v_template, 1, p_args ->> 'subject',
          nullif(p_args ->> 'preview_text', ''), p_args ->> 'body_authored',
          v_tokens, v_fallbacks, v_hash, v_source, v_src_ai, p_actor);
  update marketing_templates set current_revision_id = v_rev where id = v_template;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.template.created', 'marketing_template',
          v_template::text, 'ok',
          jsonb_build_object('name', v_name, 'revision', 1, 'source', v_source));
  perform marketing_event_append(p_tenant, 'marketing.template.created',
    'marketing_template', v_template, 'marketing-templates',
    jsonb_build_object('k', 'created:' || v_template, 'actor', v_label,
                       'source', v_source, 'at', now()));

  v_result := jsonb_build_object('id', v_template, 'revision_id', v_rev, 'revision', 1,
    'status', 'active', 'version', 1, 'content_hash', v_hash);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('template_create:' || v_request_id)::uuid, p_actor,
          'template_create', v_fp, v_result);
  return v_result;
end $$;

create or replace function marketing_template_revise(
  p_tenant uuid, p_actor uuid, p_template uuid, p_args jsonb, p_expected_version int
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_t marketing_templates%rowtype;
  v_prev marketing_template_revisions%rowtype;
  v_key text;
  v_tokens text[];
  v_hash text;
  v_rev uuid := gen_random_uuid();
  v_n int;
  v_fallbacks jsonb;
  v_subject text;
  v_preview text;
  v_body text;
  v_name text;
  v_desc text;
  v_source text := 'editor';
  v_src_ai uuid;
  v_request_id text;
  v_fp text;
  v_stored jsonb;
  v_result jsonb;
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  if p_template is null or p_expected_version is null then
    raise exception 'template and expected_version required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object'
     or p_args - 'request_id' = '{}'::jsonb then
    raise exception 'changes must be a non-empty object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('name', 'description', 'subject', 'preview_text', 'body_authored',
                     'token_fallbacks', 'source_ai_proposal_id', 'request_id') then
      raise exception 'unknown template revise argument %', v_key using errcode = '22023';
    end if;
  end loop;
  -- REQUEST IDEMPOTENCY FIRST — consulted BEFORE the optimistic-concurrency
  -- gate, so a byte-identical replay returns the ORIGINALLY created revision
  -- even after the template advanced past it
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'template_revise',
    'template', p_template, 'expected_version', p_expected_version,
    'args', p_args - 'request_id')::text, 'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'template_revise',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored;
  end if;
  select * into v_t from marketing_templates
   where id = p_template and tenant_id = p_tenant for update;
  if not found then
    raise exception 'template not found for tenant' using errcode = 'P0002';
  end if;
  if v_t.version <> p_expected_version then
    raise exception 'template changed since it was read' using errcode = 'MK409';
  end if;
  if v_t.status <> 'active' then
    raise exception 'an archived template cannot be revised — restore it first'
      using errcode = '22023';
  end if;
  select * into v_prev from marketing_template_revisions
   where tenant_id = p_tenant and id = v_t.current_revision_id;
  if not found then
    raise exception 'template has no current revision' using errcode = 'P0002';
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
  v_subject := coalesce(p_args ->> 'subject', v_prev.subject);
  v_preview := case when p_args ? 'preview_text'
                    then nullif(p_args ->> 'preview_text', '') else v_prev.preview_text end;
  v_body := coalesce(p_args ->> 'body_authored', v_prev.body_authored);
  v_fallbacks := coalesce(p_args -> 'token_fallbacks', v_prev.token_fallbacks, '{}'::jsonb);
  v_tokens := marketing_campaign_validate_content(v_subject, v_preview, v_body, v_fallbacks);
  if p_args ? 'source_ai_proposal_id' then
    begin
      v_src_ai := (p_args ->> 'source_ai_proposal_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'source_ai_proposal_id must be a uuid' using errcode = '22023';
    end;
    perform marketing_ai_lineage_check(p_tenant, v_src_ai,
      v_subject, v_preview, v_body, v_fallbacks);
    v_source := 'ai_draft';
  end if;
  v_hash := marketing_template_revision_hash(v_subject, v_preview, v_body,
                                             v_tokens, v_fallbacks);

  select coalesce(max(revision_number), 0) + 1 into v_n
    from marketing_template_revisions
   where tenant_id = p_tenant and template_id = p_template;
  insert into marketing_template_revisions
    (id, tenant_id, template_id, revision_number, subject, preview_text, body_authored,
     tokens_required, token_fallbacks, content_hash, source, source_ai_proposal_id,
     created_by)
  values (v_rev, p_tenant, p_template, v_n, v_subject, v_preview, v_body,
          v_tokens, v_fallbacks, v_hash, v_source, v_src_ai, p_actor);
  update marketing_templates set
    name = case when p_args ? 'name' then v_name else name end,
    description = case when p_args ? 'description' then v_desc else description end,
    current_revision_id = v_rev,
    updated_by = p_actor,
    version = version + 1
  where id = p_template;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.template.revised', 'marketing_template',
          p_template::text, 'ok',
          jsonb_build_object('revision', v_n, 'source', v_source));
  perform marketing_event_append(p_tenant, 'marketing.template.revised',
    'marketing_template', p_template, 'marketing-templates',
    jsonb_build_object('k', 'revised:' || v_rev, 'revision', v_n, 'actor', v_label,
                       'at', now()));

  v_result := jsonb_build_object('id', p_template, 'revision_id', v_rev, 'revision', v_n,
    'version', v_t.version + 1, 'content_hash', v_hash);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('template_revise:' || v_request_id)::uuid, p_actor,
          'template_revise', v_fp, v_result);
  return v_result;
end $$;

create or replace function marketing_template_duplicate(
  p_tenant uuid, p_actor uuid, p_template uuid, p_args jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_t marketing_templates%rowtype;
  v_prev marketing_template_revisions%rowtype;
  v_key text;
  v_name text;
  v_new uuid := gen_random_uuid();
  v_rev uuid := gen_random_uuid();
  v_request_id text;
  v_fp text;
  v_stored jsonb;
  v_result jsonb;
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('name', 'request_id') then
      raise exception 'unknown duplicate argument %', v_key using errcode = '22023';
    end if;
  end loop;
  -- REQUEST IDEMPOTENCY FIRST: a replay returns the SAME duplicate
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'template_duplicate',
    'template', p_template, 'args', p_args - 'request_id')::text, 'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'template_duplicate',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored;
  end if;
  select * into v_t from marketing_templates
   where id = p_template and tenant_id = p_tenant;
  if not found then
    raise exception 'template not found for tenant' using errcode = 'P0002';
  end if;
  -- duplication mints NEW active content from the source: an archived
  -- template must be restored first, or the archive gate would be
  -- launderable through an active copy
  if v_t.status <> 'active' then
    raise exception 'an archived template cannot be duplicated — restore it first'
      using errcode = '22023';
  end if;
  select * into v_prev from marketing_template_revisions
   where tenant_id = p_tenant and id = v_t.current_revision_id;
  if not found then
    raise exception 'template has no current revision' using errcode = 'P0002';
  end if;
  v_name := nullif(trim(coalesce(p_args ->> 'name', '')), '');
  if v_name is null then
    v_name := 'Copy of ' || left(v_t.name, 112);
  end if;
  if length(v_name) > 120 or v_name ~ '[[:cntrl:]]' then
    raise exception 'name required (max 120 clean chars)' using errcode = '22023';
  end if;

  insert into marketing_templates (id, tenant_id, name, description, status, created_by,
                                   updated_by, version)
  values (v_new, p_tenant, v_name, v_t.description, 'active', p_actor, p_actor, 1);
  insert into marketing_template_revisions
    (id, tenant_id, template_id, revision_number, subject, preview_text, body_authored,
     tokens_required, token_fallbacks, content_hash, source,
     source_template_revision_id, created_by)
  values (v_rev, p_tenant, v_new, 1, v_prev.subject, v_prev.preview_text,
          v_prev.body_authored, v_prev.tokens_required, v_prev.token_fallbacks,
          v_prev.content_hash, 'duplicate', v_prev.id, p_actor);
  update marketing_templates set current_revision_id = v_rev where id = v_new;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.template.duplicated', 'marketing_template',
          v_new::text, 'ok',
          jsonb_build_object('from_template', p_template, 'from_revision', v_prev.id));
  perform marketing_event_append(p_tenant, 'marketing.template.duplicated',
    'marketing_template', v_new, 'marketing-templates',
    jsonb_build_object('k', 'duplicated:' || v_new, 'from', p_template,
                       'actor', v_label, 'at', now()));

  v_result := jsonb_build_object('id', v_new, 'revision_id', v_rev, 'name', v_name,
                                 'status', 'active', 'version', 1);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('template_duplicate:' || v_request_id)::uuid, p_actor,
          'template_duplicate', v_fp, v_result);
  return v_result;
end $$;

create or replace function marketing_template_set_status(
  p_tenant uuid, p_actor uuid, p_template uuid, p_args jsonb, p_expected_version int
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_t marketing_templates%rowtype;
  v_key text;
  v_status text;
  v_request_id text;
  v_fp text;
  v_stored jsonb;
  v_result jsonb;
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  if p_template is null or p_expected_version is null then
    raise exception 'template and expected_version required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('status', 'request_id') then
      raise exception 'unknown set_status argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_status := p_args ->> 'status';
  if v_status is null or v_status not in ('active', 'archived') then
    raise exception 'status must be active|archived' using errcode = '22023';
  end if;
  -- REQUEST IDEMPOTENCY FIRST: an archive/restore replay returns the
  -- original successful result before the version/no-op gates can refuse it
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'template_set_status',
    'template', p_template, 'expected_version', p_expected_version,
    'args', p_args - 'request_id')::text, 'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'template_set_status',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored;
  end if;
  select * into v_t from marketing_templates
   where id = p_template and tenant_id = p_tenant for update;
  if not found then
    raise exception 'template not found for tenant' using errcode = 'P0002';
  end if;
  if v_t.version <> p_expected_version then
    raise exception 'template changed since it was read' using errcode = 'MK409';
  end if;
  if v_t.status = v_status then
    raise exception 'template is already %', v_status using errcode = '22023';
  end if;

  if v_status = 'archived' then
    update marketing_templates
       set status = 'archived', archived_at = now(), archived_by = p_actor,
           updated_by = p_actor, version = version + 1
     where id = p_template;
  else
    update marketing_templates
       set status = 'active', archived_at = null, archived_by = null,
           updated_by = p_actor, version = version + 1
     where id = p_template;
  end if;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label,
          case when v_status = 'archived' then 'marketing.template.archived'
               else 'marketing.template.restored' end,
          'marketing_template', p_template::text, 'ok', '{}'::jsonb);
  perform marketing_event_append(p_tenant,
    case when v_status = 'archived' then 'marketing.template.archived'
         else 'marketing.template.restored' end,
    'marketing_template', p_template, 'marketing-templates',
    jsonb_build_object('k', v_status || ':' || p_template || ':v' || (v_t.version + 1),
                       'actor', v_label, 'at', now()));

  v_result := jsonb_build_object('id', p_template, 'status', v_status,
                                 'version', v_t.version + 1);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('template_set_status:' || v_request_id)::uuid, p_actor,
          'template_set_status', v_fp, v_result);
  return v_result;
end $$;

create or replace function marketing_template_list(p_tenant uuid, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_key text;
  v_limit int := 25;
  v_status text;
  v_search text;
  v_cur jsonb;
  v_cur_at timestamptz;
  v_cur_id uuid;
  v_rows jsonb;
  v_next jsonb;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('status', 'search', 'limit', 'cursor') then
      raise exception 'unknown list argument %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_args ? 'status' and jsonb_typeof(p_args -> 'status') <> 'null' then
    v_status := p_args ->> 'status';
    if v_status not in ('active', 'archived') then
      raise exception 'status filter must be active|archived' using errcode = '22023';
    end if;
  end if;
  if p_args ? 'search' and jsonb_typeof(p_args -> 'search') <> 'null' then
    v_search := nullif(trim(p_args ->> 'search'), '');
    if v_search is not null and (length(v_search) > 120 or v_search ~ '[[:cntrl:]]') then
      raise exception 'search is bounded to 120 clean chars' using errcode = '22023';
    end if;
  end if;
  if p_args ? 'limit' then
    if jsonb_typeof(p_args -> 'limit') <> 'number' or (p_args ->> 'limit') ~ '[.eE]' then
      raise exception 'limit must be an integer' using errcode = '22023';
    end if;
    v_limit := least(greatest((p_args ->> 'limit')::int, 1), 50);
  end if;
  if p_args ? 'cursor' and jsonb_typeof(p_args -> 'cursor') <> 'null' then
    v_cur := p_args -> 'cursor';
    if jsonb_typeof(v_cur) <> 'object'
       or jsonb_typeof(v_cur -> 'at') <> 'string'
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

  select coalesce(jsonb_agg(row_j order by created_at desc, id desc), '[]'::jsonb)
    into v_rows from (
    select t.created_at, t.id, jsonb_build_object(
      'id', t.id, 'name', t.name, 'description', t.description, 'status', t.status,
      'version', t.version,
      'created_at', t.created_at, 'updated_at', t.updated_at,
      'created_by_email', (select p.email from profiles p
                            where p.id = t.created_by and p.tenant_id = t.tenant_id),
      'current_revision', (select jsonb_build_object(
           'id', r.id, 'revision_number', r.revision_number, 'subject', r.subject,
           'content_hash', r.content_hash, 'source', r.source, 'created_at', r.created_at)
          from marketing_template_revisions r
         where r.tenant_id = t.tenant_id and r.id = t.current_revision_id),
      'revision_count', (select count(*) from marketing_template_revisions r
                          where r.tenant_id = t.tenant_id and r.template_id = t.id),
      'usage_count', (select count(*) from marketing_template_usages u
                       where u.tenant_id = t.tenant_id and u.template_id = t.id),
      'last_used_at', (select max(u.created_at) from marketing_template_usages u
                        where u.tenant_id = t.tenant_id and u.template_id = t.id)) as row_j
      from marketing_templates t
     where t.tenant_id = p_tenant
       and (v_status is null or t.status = v_status)
       and (v_search is null or t.name ilike '%' || v_search || '%')
       and (v_cur_at is null or (t.created_at, t.id) < (v_cur_at, v_cur_id))
     order by t.created_at desc, t.id desc
     limit v_limit + 1
  ) page;

  if jsonb_array_length(v_rows) > v_limit then
    v_next := jsonb_build_object(
      'at', (v_rows -> (v_limit - 1)) ->> 'created_at',
      'id', (v_rows -> (v_limit - 1)) ->> 'id');
    v_rows := (select coalesce(jsonb_agg(t.e order by t.i), '[]'::jsonb)
                 from jsonb_array_elements(v_rows) with ordinality t(e, i)
                where t.i <= v_limit);
  end if;
  return jsonb_build_object(
    'templates', v_rows, 'next_cursor', v_next,
    'counts', (select jsonb_build_object(
        'active', count(*) filter (where status = 'active'),
        'archived', count(*) filter (where status = 'archived'))
       from marketing_templates where tenant_id = p_tenant));
end $$;

create or replace function marketing_template_detail(p_tenant uuid, p_template uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_t marketing_templates%rowtype;
begin
  if p_tenant is null or p_template is null then
    raise exception 'tenant and template required' using errcode = '22023';
  end if;
  select * into v_t from marketing_templates
   where id = p_template and tenant_id = p_tenant;
  if not found then
    raise exception 'template not found for tenant' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', v_t.id, 'name', v_t.name, 'description', v_t.description,
    'status', v_t.status, 'version', v_t.version,
    'created_at', v_t.created_at, 'updated_at', v_t.updated_at,
    'archived_at', v_t.archived_at,
    'created_by_email', (select p.email from profiles p
                          where p.id = v_t.created_by and p.tenant_id = p_tenant),
    'current_revision_id', v_t.current_revision_id,
    'revisions', (select coalesce(jsonb_agg(jsonb_build_object(
         'id', r.id, 'revision_number', r.revision_number, 'subject', r.subject,
         'preview_text', r.preview_text, 'body_authored', r.body_authored,
         'tokens_required', to_jsonb(r.tokens_required),
         'token_fallbacks', r.token_fallbacks,
         'content_hash', r.content_hash, 'source', r.source,
         'source_template_revision_id', r.source_template_revision_id,
         'source_ai_proposal_id', r.source_ai_proposal_id,
         'created_at', r.created_at,
         'created_by_email', (select p.email from profiles p
                               where p.id = r.created_by and p.tenant_id = p_tenant))
         order by r.revision_number desc), '[]'::jsonb)
        from (select * from marketing_template_revisions r0
               where r0.tenant_id = p_tenant and r0.template_id = p_template
               order by r0.revision_number desc limit 100) r),
    'usage', jsonb_build_object(
      'total', (select count(*) from marketing_template_usages u
                 where u.tenant_id = p_tenant and u.template_id = p_template),
      'last_used_at', (select max(u.created_at) from marketing_template_usages u
                        where u.tenant_id = p_tenant and u.template_id = p_template),
      'by_revision', (select coalesce(jsonb_object_agg(x.rn::text, x.n), '{}'::jsonb)
                        from (select r.revision_number rn, count(*) n
                                from marketing_template_usages u
                                join marketing_template_revisions r
                                  on r.tenant_id = u.tenant_id
                                 and r.id = u.template_revision_id
                               where u.tenant_id = p_tenant
                                 and u.template_id = p_template
                               group by r.revision_number) x),
      'recent', (select coalesce(jsonb_agg(jsonb_build_object(
           'used_in', u.used_in, 'campaign_id', u.campaign_id,
           'campaign_name', (select c.name from marketing_campaigns c
                              where c.id = u.campaign_id and c.tenant_id = p_tenant),
           'revision_number', (select r.revision_number
                                 from marketing_template_revisions r
                                where r.tenant_id = p_tenant
                                  and r.id = u.template_revision_id),
           'created_at', u.created_at)
           order by u.created_at desc), '[]'::jsonb)
          from (select * from marketing_template_usages u0
                 where u0.tenant_id = p_tenant and u0.template_id = p_template
                 order by u0.created_at desc limit 20) u)));
end $$;

create or replace function marketing_template_use_in_broadcast(
  p_tenant uuid, p_actor uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_key text;
  v_rev marketing_template_revisions%rowtype;
  v_mode text;
  v_c marketing_campaigns%rowtype;
  v_content jsonb;
  v_result jsonb;
  v_request_id text;
  v_fp text;
  v_stored jsonb;
begin
  perform marketing_require_draft_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('template_revision_id', 'mode', 'name', 'description',
                     'sender_id', 'segment_id', 'campaign_id', 'expected_version',
                     'request_id') then
      raise exception 'unknown use_in_broadcast argument %', v_key using errcode = '22023';
    end if;
  end loop;
  -- REQUEST IDEMPOTENCY FIRST: a replay creates no second campaign, revision
  -- or usage row — it returns the original composed result
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'template_use_broadcast',
    'args', p_args - 'request_id')::text, 'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'template_use_broadcast',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored;
  end if;
  begin
    select * into v_rev from marketing_template_revisions
     where id = (p_args ->> 'template_revision_id')::uuid and tenant_id = p_tenant;
  exception when others then
    raise exception 'invalid template revision id' using errcode = '22023';
  end;
  if v_rev.id is null then
    raise exception 'template revision not found for tenant' using errcode = 'P0002';
  end if;
  v_mode := p_args ->> 'mode';
  if v_mode is null or v_mode not in ('new', 'existing') then
    raise exception 'mode must be new|existing' using errcode = '22023';
  end if;

  v_content := jsonb_build_object(
    'subject', v_rev.subject,
    'preview_text', v_rev.preview_text,
    'body_authored', v_rev.body_authored,
    'token_fallbacks', v_rev.token_fallbacks,
    'source_template_revision_id', v_rev.id::text);

  if v_mode = 'new' then
    if not (p_args ? 'name' and p_args ? 'sender_id' and p_args ? 'segment_id') then
      raise exception 'a new broadcast draft needs name, sender_id and segment_id'
        using errcode = '22023';
    end if;
    v_result := marketing_campaign_create(p_tenant, p_actor,
      v_content || jsonb_build_object(
        'name', p_args ->> 'name',
        'description', p_args ->> 'description',
        'sender_id', p_args ->> 'sender_id',
        'segment_id', p_args ->> 'segment_id'));
  else
    if not (p_args ? 'campaign_id' and p_args ? 'expected_version') then
      raise exception 'replacing draft content needs campaign_id and expected_version'
        using errcode = '22023';
    end if;
    if jsonb_typeof(p_args -> 'expected_version') <> 'number'
       or (p_args ->> 'expected_version') ~ '[.eE]' then
      raise exception 'expected_version must be an integer' using errcode = '22023';
    end if;
    begin
      select * into v_c from marketing_campaigns
       where id = (p_args ->> 'campaign_id')::uuid and tenant_id = p_tenant;
    exception when others then
      raise exception 'invalid campaign id' using errcode = '22023';
    end;
    if v_c.id is null then
      raise exception 'campaign not found for tenant' using errcode = 'P0002';
    end if;
    if v_c.campaign_type <> 'broadcast' then
      raise exception 'this action replaces BROADCAST content — sequence email steps take a template through the sequence builder'
        using errcode = '22023';
    end if;
    v_result := marketing_campaign_revise(p_tenant, p_actor, v_c.id,
      v_content, (p_args ->> 'expected_version')::int);
  end if;

  v_result := v_result || jsonb_build_object(
    'template_id', v_rev.template_id, 'template_revision_id', v_rev.id);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('template_use_broadcast:' || v_request_id)::uuid, p_actor,
          'template_use_broadcast', v_fp, v_result);
  return v_result;
end $$;

-- ============================================================================
-- PART E · CAMPAIGN ↔ OBJECTIVE — the EXISTING canonical objective_links model
-- extended ADDITIVELY with a precise `marketing_campaign` target kind and a
-- governed validator for that kind ONLY. A link records INTENT ("this campaign
-- is intended to support this objective"); it never fabricates contribution —
-- verified contribution stays with the canonical Objective engine's
-- append-only contribution assessments and their evidence rules.
-- ============================================================================

-- controlled target-kind registry extension (additive: every existing kind and
-- its validation behaviour is unchanged)
alter table objective_links drop constraint objective_links_target_kind_check;
alter table objective_links add constraint objective_links_target_kind_check
  check (target_kind in ('intelligence_object', 'decision', 'action',
                         'automation_intent', 'outcome', 'graph_node', 'capability',
                         'policy', 'initiative', 'metric', 'marketing_campaign'));

-- governed validator for the NEW kind only: the target must be a REAL campaign
-- of the SAME tenant, under a relation that can honestly describe a campaign
create or replace function objective_links_marketing_campaign_guard()
returns trigger
language plpgsql
as $$
declare
  v_campaign uuid;
begin
  if new.target_kind <> 'marketing_campaign' then
    return new;   -- other kinds keep their existing (unchanged) behaviour
  end if;
  begin
    v_campaign := new.target_ref::uuid;
  exception when invalid_text_representation then
    raise exception 'a marketing_campaign link target_ref must be a campaign uuid'
      using errcode = '22023';
  end;
  if not exists (select 1 from marketing_campaigns c
                  where c.id = v_campaign and c.tenant_id = new.tenant_id) then
    raise exception 'the linked campaign must exist in the same tenant'
      using errcode = '23503';
  end if;
  if new.relation not in ('supports', 'contributes_to') then
    raise exception 'a campaign relates to an objective as supports|contributes_to'
      using errcode = '22023';
  end if;
  return new;
end $$;
create trigger objective_links_marketing_campaign_guard
  before insert or update on objective_links
  for each row execute function objective_links_marketing_campaign_guard();

-- the campaign's CURRENT relationship pointer (the objective_links row is the
-- canonical relationship; history lives in the append-only ledger below)
alter table marketing_campaigns add column objective_link_id uuid;
alter table marketing_campaigns
  add constraint mc_objective_link_fk foreign key (tenant_id, objective_link_id)
    references objective_links (tenant_id, id) on delete set null;
create index marketing_campaigns_objective_idx
  on marketing_campaigns (tenant_id, objective_link_id)
  where objective_link_id is not null;

-- the Phase-1 `objective_link_ref` placeholder is CLOSED: legacy/null values
-- stay readable, new writes are rejected — the governed path above supersedes
-- it. (A separate narrow trigger, so the proven campaign guard is untouched.)
create or replace function marketing_campaigns_objective_ref_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.objective_link_ref is not null then
      raise exception 'objective_link_ref is a closed legacy placeholder — link objectives through the governed objective_links path'
        using errcode = '22023';
    end if;
    return new;
  end if;
  if new.objective_link_ref is distinct from old.objective_link_ref then
    raise exception 'objective_link_ref is a closed legacy placeholder — link objectives through the governed objective_links path'
      using errcode = '22023';
  end if;
  return new;
end $$;
create trigger marketing_campaigns_objective_ref_guard
  before insert or update on marketing_campaigns
  for each row execute function marketing_campaigns_objective_ref_guard();

-- ── APPEND-ONLY relationship history — who linked/superseded/unlinked what,
--    when, why, with the campaign version at the time ──
create table marketing_campaign_objective_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  campaign_id uuid not null,
  campaign_version int not null,
  objective_id uuid not null,
  objective_link_id uuid,
  action text not null check (action in ('linked', 'superseded', 'unlinked')),
  relation text,
  expected_contribution text
    check (expected_contribution is null or length(expected_contribution) <= 500),
  rationale text check (rationale is null or length(rationale) <= 500),
  actor_profile_id uuid,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
alter table marketing_campaign_objective_history
  add constraint mcoh_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade,
  add constraint mcoh_objective_fk foreign key (tenant_id, objective_id)
    references objectives (tenant_id, id),
  add constraint mcoh_link_fk foreign key (tenant_id, objective_link_id)
    references objective_links (tenant_id, id),
  add constraint mcoh_actor_fk foreign key (tenant_id, actor_profile_id)
    references profiles (tenant_id, id) on delete set null;
create index marketing_campaign_objective_history_idx
  on marketing_campaign_objective_history (tenant_id, campaign_id, created_at desc);
create trigger marketing_campaign_objective_history_append_only_update
  before update on marketing_campaign_objective_history
  for each row execute function marketing_history_append_only();
create trigger marketing_campaign_objective_history_append_only_delete
  before delete on marketing_campaign_objective_history
  for each row execute function marketing_history_append_only();

alter table marketing_campaign_objective_history enable row level security;
create policy marketing_campaign_objective_history_select
  on marketing_campaign_objective_history
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_campaign_objective_history to authenticated;
grant select, insert on marketing_campaign_objective_history to service_role;
revoke update, delete, truncate on marketing_campaign_objective_history
  from anon, authenticated, service_role;

-- ── link / supersede ──
create or replace function marketing_campaign_objective_link(
  p_tenant uuid, p_actor uuid, p_campaign uuid, p_args jsonb, p_expected_version int
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_c marketing_campaigns%rowtype;
  v_obj objectives%rowtype;
  v_old objective_links%rowtype;
  v_relation text;
  v_expected text;
  v_rationale text;
  v_request_id text;
  v_fp text;
  v_stored marketing_request_keys%rowtype;
  v_link uuid := gen_random_uuid();
  v_result jsonb;
begin
  v_label := marketing_require_launch_actor(p_tenant, p_actor);
  if p_campaign is null or p_expected_version is null then
    raise exception 'campaign and expected_version required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('objective_id', 'relation', 'expected_contribution', 'rationale',
                     'request_id') then
      raise exception 'unknown objective link argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request_id := p_args ->> 'request_id';
  if v_request_id is null or v_request_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'request_id must match ^[A-Za-z0-9_-]{8,64}$' using errcode = '22023';
  end if;
  v_relation := coalesce(p_args ->> 'relation', 'supports');
  if v_relation not in ('supports', 'contributes_to') then
    raise exception 'relation must be supports|contributes_to' using errcode = '22023';
  end if;
  v_expected := nullif(trim(coalesce(p_args ->> 'expected_contribution', '')), '');
  if v_expected is not null and (length(v_expected) > 500 or v_expected ~ '[[:cntrl:]]') then
    raise exception 'expected_contribution is bounded to 500 clean chars' using errcode = '22023';
  end if;
  v_rationale := nullif(trim(coalesce(p_args ->> 'rationale', '')), '');
  if v_rationale is not null and (length(v_rationale) > 500 or v_rationale ~ '[[:cntrl:]]') then
    raise exception 'rationale is bounded to 500 clean chars' using errcode = '22023';
  end if;

  -- REQUEST IDEMPOTENCY FIRST (the canonical Phase-2 request-key ledger): a
  -- byte-identical replay must converge on the stored result even though the
  -- original call already advanced the campaign version — so the ledger is
  -- consulted BEFORE the optimistic-concurrency gate can 409 the replay
  -- the fingerprint binds EVERY semantic input INCLUDING the campaign version
  -- the caller acted on: a byte-identical replay (same expected_version)
  -- converges, while reusing the request id against a DIFFERENT campaign
  -- version is a different logical request and must conflict (MK412)
  v_fp := encode(extensions.digest(jsonb_build_object(
    'action', 'campaign_objective_link', 'campaign', p_campaign,
    'campaign_version', p_expected_version,
    'objective', p_args ->> 'objective_id', 'relation', v_relation,
    'expected', v_expected, 'rationale', v_rationale, 'actor', p_actor)::text,
    'sha256'), 'hex');
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant::text || '|mkt_objective_link|' || v_request_id, 42));
  select * into v_stored from marketing_request_keys
   where tenant_id = p_tenant
     and idempotency_key = md5('campaign_objective_link:' || v_request_id)::uuid;
  if found then
    if v_stored.fingerprint = v_fp then
      return v_stored.result;
    end if;
    raise exception 'request_id was already used for a DIFFERENT request'
      using errcode = 'MK412';
  end if;

  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant for update;
  if not found then
    raise exception 'campaign not found for tenant' using errcode = 'P0002';
  end if;
  if v_c.version <> p_expected_version then
    raise exception 'campaign changed since it was read' using errcode = 'MK409';
  end if;
  if v_c.status in ('cancelled', 'archived') then
    raise exception 'a % campaign cannot change its objective relationship', v_c.status
      using errcode = '22023';
  end if;
  begin
    select * into v_obj from objectives
     where id = (p_args ->> 'objective_id')::uuid and tenant_id = p_tenant;
  exception when others then
    raise exception 'invalid objective id' using errcode = '22023';
  end;
  if v_obj.id is null then
    raise exception 'objective not found for tenant' using errcode = 'P0002';
  end if;
  if v_obj.status <> 'active' then
    raise exception 'only an active objective can be linked (objective is %)', v_obj.status
      using errcode = '22023';
  end if;

  if v_c.objective_link_id is not null then
    select * into v_old from objective_links
     where id = v_c.objective_link_id and tenant_id = p_tenant;
    if found then
      if v_old.objective_id = v_obj.id and v_old.relation = v_relation
         and v_old.expected_contribution is not distinct from v_expected
         and v_old.rationale is not distinct from v_rationale then
        raise exception 'the campaign already carries exactly this objective relationship'
          using errcode = '22023';
      end if;
      -- deactivate the CURRENT pointer without rewriting history: the row
      -- stays, its assessments stay; approved=false takes it out of the
      -- objective engine's link-consuming queries
      update objective_links set approved = false
       where id = v_old.id and tenant_id = p_tenant;
      insert into marketing_campaign_objective_history
        (tenant_id, campaign_id, campaign_version, objective_id, objective_link_id,
         action, relation, expected_contribution, rationale, actor_profile_id, evidence)
      values (p_tenant, p_campaign, v_c.version, v_old.objective_id, v_old.id,
              'superseded', v_old.relation, v_old.expected_contribution,
              v_old.rationale, p_actor,
              jsonb_build_object('request_id', v_request_id));
    end if;
  end if;

  insert into objective_links
    (id, tenant_id, objective_id, target_kind, target_ref, relation,
     expected_contribution, contribution_state, rationale, evidence, created_by,
     approved, verification_state)
  values
    (v_link, p_tenant, v_obj.id, 'marketing_campaign', p_campaign::text, v_relation,
     v_expected, 'proposed', v_rationale,
     jsonb_build_array(
       jsonb_build_object('kind', 'marketing_campaign', 'ref', p_campaign::text),
       jsonb_build_object('kind', 'request', 'ref', v_request_id)),
     v_label, true, 'approved_link');

  update marketing_campaigns
     set objective_link_id = v_link, version = version + 1
   where id = p_campaign;

  insert into marketing_campaign_objective_history
    (tenant_id, campaign_id, campaign_version, objective_id, objective_link_id,
     action, relation, expected_contribution, rationale, actor_profile_id, evidence)
  values (p_tenant, p_campaign, v_c.version + 1, v_obj.id, v_link, 'linked',
          v_relation, v_expected, v_rationale, p_actor,
          jsonb_build_object('request_id', v_request_id));

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.campaign.objective_linked', 'marketing_campaign',
          p_campaign::text, 'ok',
          jsonb_build_object('objective', v_obj.id, 'relation', v_relation,
                             'link', v_link, 'request_id', v_request_id));
  perform marketing_event_append(p_tenant, 'marketing.campaign.objective_linked',
    'marketing_campaign', p_campaign, 'marketing-reporting',
    jsonb_build_object('k', 'objective_linked:' || v_link, 'objective', v_obj.id,
                       'relation', v_relation, 'actor', v_label, 'at', now()));

  v_result := jsonb_build_object(
    'campaign_id', p_campaign, 'objective_id', v_obj.id, 'objective_link_id', v_link,
    'relation', v_relation, 'version', v_c.version + 1, 'request_id', v_request_id);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('campaign_objective_link:' || v_request_id)::uuid, p_actor,
          'campaign_objective_link', v_fp, v_result);
  return v_result;
end $$;

-- ── unlink (deactivate the current relationship; prior evidence preserved) ──
create or replace function marketing_campaign_objective_unlink(
  p_tenant uuid, p_actor uuid, p_campaign uuid, p_args jsonb, p_expected_version int
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_c marketing_campaigns%rowtype;
  v_old objective_links%rowtype;
  v_rationale text;
begin
  v_label := marketing_require_launch_actor(p_tenant, p_actor);
  if p_campaign is null or p_expected_version is null then
    raise exception 'campaign and expected_version required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('rationale') then
      raise exception 'unknown objective unlink argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_rationale := nullif(trim(coalesce(p_args ->> 'rationale', '')), '');
  if v_rationale is not null and (length(v_rationale) > 500 or v_rationale ~ '[[:cntrl:]]') then
    raise exception 'rationale is bounded to 500 clean chars' using errcode = '22023';
  end if;
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant for update;
  if not found then
    raise exception 'campaign not found for tenant' using errcode = 'P0002';
  end if;
  if v_c.version <> p_expected_version then
    raise exception 'campaign changed since it was read' using errcode = 'MK409';
  end if;
  if v_c.objective_link_id is null then
    raise exception 'the campaign has no objective relationship to remove'
      using errcode = '22023';
  end if;
  select * into v_old from objective_links
   where id = v_c.objective_link_id and tenant_id = p_tenant;

  update objective_links set approved = false
   where id = v_c.objective_link_id and tenant_id = p_tenant;
  update marketing_campaigns
     set objective_link_id = null, version = version + 1
   where id = p_campaign;

  insert into marketing_campaign_objective_history
    (tenant_id, campaign_id, campaign_version, objective_id, objective_link_id,
     action, relation, expected_contribution, rationale, actor_profile_id, evidence)
  values (p_tenant, p_campaign, v_c.version + 1, v_old.objective_id, v_old.id,
          'unlinked', v_old.relation, v_old.expected_contribution, v_rationale,
          p_actor, '{}'::jsonb);

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.campaign.objective_unlinked', 'marketing_campaign',
          p_campaign::text, 'ok',
          jsonb_build_object('objective', v_old.objective_id, 'link', v_old.id));
  perform marketing_event_append(p_tenant, 'marketing.campaign.objective_unlinked',
    'marketing_campaign', p_campaign, 'marketing-reporting',
    jsonb_build_object('k', 'objective_unlinked:' || v_old.id || ':v' || (v_c.version + 1),
                       'objective', v_old.objective_id, 'actor', v_label, 'at', now()));

  return jsonb_build_object('campaign_id', p_campaign, 'objective_link_id', null,
                            'version', v_c.version + 1);
end $$;

-- ── bounded search over ELIGIBLE (active) objectives ──
create or replace function marketing_objective_search(p_tenant uuid, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_key text;
  v_search text;
  v_limit int := 10;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('search', 'limit') then
      raise exception 'unknown objective search argument %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_args ? 'search' and jsonb_typeof(p_args -> 'search') <> 'null' then
    v_search := nullif(trim(p_args ->> 'search'), '');
    if v_search is not null and (length(v_search) > 200 or v_search ~ '[[:cntrl:]]') then
      raise exception 'search is bounded to 200 clean chars' using errcode = '22023';
    end if;
  end if;
  if p_args ? 'limit' then
    if jsonb_typeof(p_args -> 'limit') <> 'number' or (p_args ->> 'limit') ~ '[.eE]' then
      raise exception 'limit must be an integer' using errcode = '22023';
    end if;
    v_limit := least(greatest((p_args ->> 'limit')::int, 1), 20);
  end if;
  return jsonb_build_object('objectives',
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'title', o.title, 'objective_type', o.objective_type,
        'status', o.status, 'target_at', o.target_at,
        'health', (select jsonb_build_object('status', h.status,
                                             'evaluated_at', h.evaluated_at)
                     from objective_health h
                    where h.tenant_id = p_tenant and h.objective_id = o.id
                    order by h.evaluated_at desc limit 1))
        order by o.title), '[]'::jsonb)
      from (select * from objectives o0
             where o0.tenant_id = p_tenant and o0.status = 'active'
               and (v_search is null or o0.title ilike '%' || v_search || '%')
             order by o0.title limit v_limit) o));
end $$;

-- ── the campaign's current objective context — canonical health, freshness,
--    comparable metric values and HONEST contribution state ──
create or replace function marketing_campaign_objective_context(p_tenant uuid, p_campaign uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_c marketing_campaigns%rowtype;
  v_link objective_links%rowtype;
  v_obj objectives%rowtype;
  v_health objective_health%rowtype;
  v_metric jsonb;
  v_assessment jsonb;
begin
  if p_tenant is null or p_campaign is null then
    raise exception 'tenant and campaign required' using errcode = '22023';
  end if;
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant;
  if not found then
    raise exception 'campaign not found for tenant' using errcode = 'P0002';
  end if;
  if v_c.objective_link_id is null then
    return jsonb_build_object('campaign_id', p_campaign, 'linked', false,
      'history_count', (select count(*) from marketing_campaign_objective_history h
                         where h.tenant_id = p_tenant and h.campaign_id = p_campaign));
  end if;
  select * into v_link from objective_links
   where id = v_c.objective_link_id and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('campaign_id', p_campaign, 'linked', false,
      'note', 'the linked objective_links row no longer exists');
  end if;
  select * into v_obj from objectives
   where id = v_link.objective_id and tenant_id = p_tenant;
  select * into v_health from objective_health
   where tenant_id = p_tenant and objective_id = v_link.objective_id
   order by evaluated_at desc limit 1;

  -- primary metric target vs latest measurement, ONLY when units (and, for
  -- currency metrics, currencies) genuinely agree — otherwise unknown+reason
  select jsonb_build_object(
      'metric_key', md.key, 'metric_name', md.name, 'unit', om.target_unit,
      'baseline', om.baseline_value, 'target', om.target_value,
      'direction', om.direction,
      'current', case when m.id is null then null
                      when m.unit is distinct from om.target_unit then null
                      when md.currency is not null
                           and m.currency is distinct from om.target_currency then null
                      else m.value end,
      'current_measured_at', m.measured_at,
      'comparability', case
        when m.id is null then 'no_measurement'
        when m.unit is distinct from om.target_unit then 'unit_mismatch'
        when md.currency is not null
             and m.currency is distinct from om.target_currency then 'currency_mismatch'
        else 'comparable' end)
    into v_metric
    from objective_metrics om
    join metric_definitions md
      on md.id = om.metric_id and md.tenant_id = p_tenant
    left join lateral (
      select * from measurements m0
       where m0.tenant_id = p_tenant and m0.metric_id = om.metric_id
       order by m0.measured_at desc limit 1) m on true
   where om.tenant_id = p_tenant and om.objective_id = v_link.objective_id
     and om.role = 'primary'
   limit 1;

  -- verified contribution ONLY from the canonical append-only assessment
  -- history — never inferred, never fabricated
  select jsonb_build_object('state', a.state, 'confidence', a.confidence,
                            'evaluated_at', a.evaluated_at,
                            'observed_movement', a.observed_movement)
    into v_assessment
    from objective_contribution_assessments a
   where a.tenant_id = p_tenant and a.objective_link_id = v_link.id
   order by a.evaluated_at desc limit 1;

  return jsonb_build_object(
    'campaign_id', p_campaign,
    'linked', true,
    'link', jsonb_build_object(
      'id', v_link.id, 'relation', v_link.relation,
      'expected_contribution', v_link.expected_contribution,
      'rationale', v_link.rationale, 'created_by', v_link.created_by,
      'created_at', v_link.created_at,
      'verification_state', v_link.verification_state),
    'objective', jsonb_build_object(
      'id', v_obj.id, 'title', v_obj.title, 'objective_type', v_obj.objective_type,
      'status', v_obj.status, 'target_at', v_obj.target_at),
    'health', case when v_health.id is null then null else jsonb_build_object(
      'status', v_health.status, 'progress', v_health.progress,
      'confidence', v_health.confidence, 'reasons', to_jsonb(v_health.reasons),
      'stale_measurements', to_jsonb(v_health.stale_measurements),
      'evaluated_at', v_health.evaluated_at,
      'age_seconds', extract(epoch from (now() - v_health.evaluated_at))::bigint) end,
    'health_state', case
      when v_health.id is null then 'never_evaluated'
      when v_health.evaluated_at < now() - interval '48 hours' then 'stale'
      else 'current' end,
    'primary_metric', v_metric,
    'contribution', coalesce(v_assessment,
      jsonb_build_object('state', null,
        'note', 'No verified contribution evidence — a link records intent, never outcome')),
    'history_count', (select count(*) from marketing_campaign_objective_history h
                       where h.tenant_id = p_tenant and h.campaign_id = p_campaign),
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
         'action', h.action, 'objective_id', h.objective_id, 'relation', h.relation,
         'expected_contribution', h.expected_contribution, 'rationale', h.rationale,
         'campaign_version', h.campaign_version, 'created_at', h.created_at)
         order by h.created_at desc), '[]'::jsonb)
        from (select * from marketing_campaign_objective_history h0
               where h0.tenant_id = p_tenant and h0.campaign_id = p_campaign
               order by h0.created_at desc limit 20) h));
end $$;

-- ============================================================================
-- PART F · UNIFIED HONEST REPORTING — one server-governed projection that
-- COMPOSES the canonical per-type report authorities
-- (marketing_campaign_report / marketing_sequence_report). It re-derives no
-- status truth of its own: every number a row shows comes from the canonical
-- function for that campaign type, so totals always reconcile with the
-- existing drill-downs. Unknown/unavailable stays null with a reason — never
-- zero.
-- ============================================================================

create or replace function marketing_reporting_overview(p_tenant uuid, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_key text;
  v_limit int := 20;
  v_type text;
  v_status text;
  v_objective uuid;
  v_from timestamptz;
  v_to timestamptz;
  v_search text;
  v_cur jsonb;
  v_cur_at timestamptz;
  v_cur_id uuid;
  v_rows jsonb := '[]'::jsonb;
  v_next jsonb;
  r record;
  v_n int := 0;
  v_last_at timestamptz;
  v_last_id uuid;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('limit', 'cursor', 'campaign_type', 'status', 'objective_id',
                     'created_from', 'created_to', 'search') then
      raise exception 'unknown overview argument %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_args ? 'limit' then
    if jsonb_typeof(p_args -> 'limit') <> 'number' or (p_args ->> 'limit') ~ '[.eE]' then
      raise exception 'limit must be an integer' using errcode = '22023';
    end if;
    v_limit := least(greatest((p_args ->> 'limit')::int, 1), 50);
  end if;
  if p_args ? 'campaign_type' and jsonb_typeof(p_args -> 'campaign_type') <> 'null' then
    v_type := p_args ->> 'campaign_type';
    if v_type not in ('broadcast', 'sequence') then
      raise exception 'campaign_type must be broadcast|sequence' using errcode = '22023';
    end if;
  end if;
  if p_args ? 'status' and jsonb_typeof(p_args -> 'status') <> 'null' then
    v_status := p_args ->> 'status';
    if v_status not in ('draft', 'review', 'approved', 'scheduled', 'active',
                        'paused', 'completed', 'cancelled', 'archived') then
      raise exception 'invalid status filter' using errcode = '22023';
    end if;
  end if;
  if p_args ? 'objective_id' and jsonb_typeof(p_args -> 'objective_id') <> 'null' then
    begin
      v_objective := (p_args ->> 'objective_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'objective_id must be a uuid' using errcode = '22023';
    end;
  end if;
  if p_args ? 'created_from' and jsonb_typeof(p_args -> 'created_from') <> 'null' then
    begin
      v_from := (p_args ->> 'created_from')::timestamptz;
    exception when others then
      raise exception 'created_from must be a timestamp' using errcode = '22023';
    end;
  end if;
  if p_args ? 'created_to' and jsonb_typeof(p_args -> 'created_to') <> 'null' then
    begin
      v_to := (p_args ->> 'created_to')::timestamptz;
    exception when others then
      raise exception 'created_to must be a timestamp' using errcode = '22023';
    end;
  end if;
  if p_args ? 'search' and jsonb_typeof(p_args -> 'search') <> 'null' then
    v_search := nullif(trim(p_args ->> 'search'), '');
    if v_search is not null and (length(v_search) > 120 or v_search ~ '[[:cntrl:]]') then
      raise exception 'search is bounded to 120 clean chars' using errcode = '22023';
    end if;
  end if;
  if p_args ? 'cursor' and jsonb_typeof(p_args -> 'cursor') <> 'null' then
    v_cur := p_args -> 'cursor';
    if jsonb_typeof(v_cur) <> 'object'
       or jsonb_typeof(v_cur -> 'at') <> 'string'
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

  for r in
    select c.*, ol.objective_id as linked_objective_id,
           (select o.title from objectives o
             where o.id = ol.objective_id and o.tenant_id = p_tenant) as objective_title
      from marketing_campaigns c
      left join objective_links ol
        on ol.id = c.objective_link_id and ol.tenant_id = c.tenant_id
     where c.tenant_id = p_tenant
       and (v_type is null or c.campaign_type = v_type)
       and (v_status is null or c.status = v_status)
       and (v_objective is null or ol.objective_id = v_objective)
       and (v_from is null or c.created_at >= v_from)
       and (v_to is null or c.created_at <= v_to)
       and (v_search is null or c.name ilike '%' || v_search || '%')
       and (v_cur_at is null or (c.created_at, c.id) < (v_cur_at, v_cur_id))
     order by c.created_at desc, c.id desc
     limit v_limit + 1
  loop
    v_n := v_n + 1;
    if v_n > v_limit then
      -- the cursor names the LAST INCLUDED row, so page 2 resumes exactly
      -- after it (the canonical recipient-page keyset contract)
      v_next := jsonb_build_object('at', to_jsonb(v_last_at) #>> '{}',
                                   'id', v_last_id::text);
      exit;
    end if;
    v_last_at := r.created_at;
    v_last_id := r.id;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'name', r.name, 'campaign_type', r.campaign_type,
      'status', r.status, 'created_at', r.created_at,
      'launched_at', r.launched_at, 'completed_at', r.completed_at,
      'schedule_at', r.schedule_at,
      'objective_id', r.linked_objective_id, 'objective_title', r.objective_title,
      -- the CANONICAL per-type report — composed, never re-derived
      'report', case when r.campaign_type = 'sequence'
                     then marketing_sequence_report(p_tenant, r.id)
                     else marketing_campaign_report(p_tenant, r.id) end));
  end loop;

  return jsonb_build_object(
    'campaigns', v_rows,
    'next_cursor', v_next,
    -- totals over the SAME filtered population (campaign counts only — no
    -- cross-type metric arithmetic is ever fabricated here)
    'totals', (select jsonb_build_object(
        'campaigns', count(*),
        'by_status', coalesce((select jsonb_object_agg(s.status, s.n)
           from (select c2.status, count(*) n from marketing_campaigns c2
                  left join objective_links ol2
                    on ol2.id = c2.objective_link_id and ol2.tenant_id = c2.tenant_id
                 where c2.tenant_id = p_tenant
                   and (v_type is null or c2.campaign_type = v_type)
                   and (v_status is null or c2.status = v_status)
                   and (v_objective is null or ol2.objective_id = v_objective)
                   and (v_from is null or c2.created_at >= v_from)
                   and (v_to is null or c2.created_at <= v_to)
                   and (v_search is null or c2.name ilike '%' || v_search || '%')
                 group by c2.status) s), '{}'::jsonb),
        'by_type', coalesce((select jsonb_object_agg(t.campaign_type, t.n)
           from (select c3.campaign_type, count(*) n from marketing_campaigns c3
                  left join objective_links ol3
                    on ol3.id = c3.objective_link_id and ol3.tenant_id = c3.tenant_id
                 where c3.tenant_id = p_tenant
                   and (v_type is null or c3.campaign_type = v_type)
                   and (v_status is null or c3.status = v_status)
                   and (v_objective is null or ol3.objective_id = v_objective)
                   and (v_from is null or c3.created_at >= v_from)
                   and (v_to is null or c3.created_at <= v_to)
                   and (v_search is null or c3.name ilike '%' || v_search || '%')
                 group by c3.campaign_type) t), '{}'::jsonb))
      from marketing_campaigns c1
      left join objective_links ol1
        on ol1.id = c1.objective_link_id and ol1.tenant_id = c1.tenant_id
     where c1.tenant_id = p_tenant
       and (v_type is null or c1.campaign_type = v_type)
       and (v_status is null or c1.status = v_status)
       and (v_objective is null or ol1.objective_id = v_objective)
       and (v_from is null or c1.created_at >= v_from)
       and (v_to is null or c1.created_at <= v_to)
       and (v_search is null or c1.name ilike '%' || v_search || '%')));
end $$;

create or replace function marketing_reporting_campaign(p_tenant uuid, p_campaign uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_c marketing_campaigns%rowtype;
begin
  if p_tenant is null or p_campaign is null then
    raise exception 'tenant and campaign required' using errcode = '22023';
  end if;
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant;
  if not found then
    raise exception 'campaign not found for tenant' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', v_c.id, 'name', v_c.name, 'campaign_type', v_c.campaign_type,
    'status', v_c.status, 'version', v_c.version, 'created_at', v_c.created_at,
    'launched_at', v_c.launched_at, 'completed_at', v_c.completed_at,
    'report', case when v_c.campaign_type = 'sequence'
                   then marketing_sequence_report(p_tenant, p_campaign)
                   else marketing_campaign_report(p_tenant, p_campaign) end,
    'objective_context', marketing_campaign_objective_context(p_tenant, p_campaign),
    'template_lineage', case when v_c.campaign_type = 'sequence'
      then (select coalesce(jsonb_agg(jsonb_build_object(
              'step_key', s.step_key, 'step_order', s.step_order,
              'template_revision_id', s.config ->> 'source_template_revision_id',
              'ai_proposal_id', s.config ->> 'source_ai_proposal_id')
              order by s.step_order), '[]'::jsonb)
             from marketing_sequence_steps s
            where s.tenant_id = p_tenant
              and s.revision_id = v_c.current_sequence_revision_id
              and (s.config ? 'source_template_revision_id'
                   or s.config ? 'source_ai_proposal_id'))
      else (select coalesce(jsonb_agg(jsonb_build_object(
              'revision_number', cr.revision_number, 'source', cr.source,
              'template_revision_id', cr.source_template_revision_id,
              'template_id', (select tr.template_id from marketing_template_revisions tr
                               where tr.tenant_id = p_tenant
                                 and tr.id = cr.source_template_revision_id),
              'ai_proposal_id', cr.source_ai_proposal_id)), '[]'::jsonb)
             from marketing_campaign_revisions cr
            where cr.tenant_id = p_tenant and cr.id = v_c.current_revision_id
              and (cr.source_template_revision_id is not null
                   or cr.source_ai_proposal_id is not null)) end);
end $$;

-- ============================================================================
-- PART G · AI DRAFTING RPCs — provider configuration state, the governed
-- generation request (Action → Decision Package → pending intent, the exact
-- Phase-4 delegated-authority shape), the adapter's proposal recorder, and
-- the human revise / accept / reject / cancel lifecycle. Acceptance writes
-- DRAFTS only.
-- ============================================================================

-- provider/config state — booleans and references only, NEVER a secret value
create or replace function marketing_ai_provider_state(p_tenant uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_conn tenant_connectors%rowtype;
  v_cap boolean;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  select * into v_conn from tenant_connectors
   where tenant_id = p_tenant and connector_id = 'openai';
  select coalesce(bool_or(enabled), false) into v_cap
    from tenant_connector_capabilities
   where tenant_id = p_tenant and connector_id = 'openai'
     and capability_key = 'ai.generate_marketing_draft';
  return jsonb_build_object(
    'connector_exists', v_conn.id is not null,
    'connector_enabled', coalesce(v_conn.enabled, false),
    'connector_status', coalesce(v_conn.status, 'not_connected'),
    'model', v_conn.settings ->> 'model',
    'secret_ref_present', coalesce(v_conn.settings ->> 'secret_ref', '') <> '',
    'capability_enabled', v_cap,
    'configured', v_conn.id is not null and coalesce(v_conn.enabled, false)
      and coalesce(v_conn.settings ->> 'model', '') <> ''
      and coalesce(v_conn.settings ->> 'secret_ref', '') <> ''
      and v_cap,
    'prompt_version', 'marketing-draft@1');
end $$;

-- owner/admin-ONLY provider administration. The STRUCTURAL role ceiling is
-- enforced here in the RPC — a hostile permission grant to an ops/viewer
-- profile can never reach provider configuration.
create or replace function marketing_ai_configure(p_tenant uuid, p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_role text;
  v_actor_tenant uuid;
  v_label text;
  v_key text;
  v_model text;
  v_secret_ref text;
  v_enabled boolean;
  v_conn tenant_connectors%rowtype;
begin
  if p_tenant is null or p_actor is null then
    raise exception 'tenant and actor required' using errcode = '22023';
  end if;
  select tenant_id, role into v_actor_tenant, v_role from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  if v_role not in ('owner', 'admin') then
    raise exception 'AI provider configuration requires an owner/admin actor'
      using errcode = '42501';
  end if;
  if not ((marketing_effective_permissions(p_actor) -> 'permissions')
          ? 'marketing.ai.manage') then
    raise exception 'actor lacks marketing.ai.manage' using errcode = '42501';
  end if;
  v_label := coalesce((select email from profiles where id = p_actor), p_actor::text);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('model', 'secret_ref', 'enabled') then
      raise exception 'unknown configure argument %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_args ? 'model' and jsonb_typeof(p_args -> 'model') <> 'null' then
    v_model := p_args ->> 'model';
    if v_model !~ '^[A-Za-z0-9._:-]{1,80}$' then
      raise exception 'model must be a short provider model identifier' using errcode = '22023';
    end if;
  end if;
  if p_args ? 'secret_ref' and jsonb_typeof(p_args -> 'secret_ref') <> 'null' then
    v_secret_ref := p_args ->> 'secret_ref';
    if v_secret_ref !~ '^[0-9a-f-]{36}$' then
      raise exception 'secret_ref must be the Vault reference returned by the credential broker'
        using errcode = '22023';
    end if;
  end if;
  if p_args ? 'enabled' then
    if jsonb_typeof(p_args -> 'enabled') <> 'boolean' then
      raise exception 'enabled must be a boolean' using errcode = '22023';
    end if;
    v_enabled := (p_args -> 'enabled')::boolean;
  end if;

  select * into v_conn from tenant_connectors
   where tenant_id = p_tenant and connector_id = 'openai' for update;
  if not found then
    insert into tenant_connectors
      (tenant_id, connector_id, provider, category, status, enabled, settings)
    values (p_tenant, 'openai', 'openai', 'ai',
            case when coalesce(v_enabled, false) then 'connected' else 'disabled' end,
            coalesce(v_enabled, false),
            jsonb_strip_nulls(jsonb_build_object('model', v_model,
                                                 'secret_ref', v_secret_ref)))
    returning * into v_conn;
  else
    update tenant_connectors set
      enabled = coalesce(v_enabled, enabled),
      status = case when coalesce(v_enabled, enabled) then 'connected' else 'disabled' end,
      settings = jsonb_strip_nulls(
        coalesce(settings, '{}'::jsonb)
        || case when v_model is not null
                then jsonb_build_object('model', v_model) else '{}'::jsonb end
        || case when v_secret_ref is not null
                then jsonb_build_object('secret_ref', v_secret_ref) else '{}'::jsonb end)
     where tenant_id = p_tenant and connector_id = 'openai'
    returning * into v_conn;
  end if;

  insert into tenant_connector_capabilities
    (tenant_id, connector_id, capability_key, enabled)
  values (p_tenant, 'openai', 'ai.generate_marketing_draft', v_conn.enabled)
  on conflict (tenant_id, connector_id, capability_key)
    do update set enabled = excluded.enabled, updated_at = now();

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.ai.provider_configured', 'tenant_connector',
          v_conn.id::text, 'ok',
          jsonb_build_object('enabled', v_conn.enabled,
                             'model', v_conn.settings ->> 'model',
                             'secret_ref_present',
                             coalesce(v_conn.settings ->> 'secret_ref', '') <> ''));
  perform marketing_event_append(p_tenant, 'marketing.ai.provider_configured',
    'tenant_connector', v_conn.id, 'marketing-ai-drafts',
    jsonb_build_object('k', 'configured:' || v_conn.id || ':' || coalesce(v_conn.updated_at, v_conn.created_at),
                       'enabled', v_conn.enabled, 'actor', v_label, 'at', now()));

  return marketing_ai_provider_state(p_tenant);
end $$;

-- ── the governed generation request ──
create or replace function marketing_ai_generation_request(p_tenant uuid, p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_state jsonb;
  v_request_id text;
  v_dest text;
  v_tpl uuid;
  v_camp uuid;
  v_obj objectives%rowtype;
  v_minute int;
  v_hour int;
  v_fp text;
  v_existing marketing_ai_requests%rowtype;
  v_action uuid := gen_random_uuid();
  v_decision uuid := gen_random_uuid();
  v_intent uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_correlation uuid := gen_random_uuid();
  v_mode text;
  v_pkg jsonb;
  v_params jsonb;
  v_brief jsonb;
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('destination_kind', 'destination_template_id',
                     'destination_campaign_id', 'objective_id', 'campaign_objective',
                     'offer', 'audience', 'why_care', 'objection', 'tone',
                     'sender_context', 'call_to_action', 'request_id') then
      raise exception 'unknown generation argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request_id := p_args ->> 'request_id';
  if v_request_id is null or v_request_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'request_id must match ^[A-Za-z0-9_-]{8,64}$' using errcode = '22023';
  end if;
  v_dest := p_args ->> 'destination_kind';
  if v_dest is null or v_dest not in ('template', 'broadcast', 'sequence_step') then
    raise exception 'destination_kind must be template|broadcast|sequence_step'
      using errcode = '22023';
  end if;

  -- required + optional brief fields, hard-bounded, control-characters rejected
  declare
    v_field text;
    v_val text;
    v_required text[] := array['campaign_objective', 'offer', 'audience', 'call_to_action'];
    v_bounds jsonb := jsonb_build_object(
      'campaign_objective', 500, 'offer', 500, 'audience', 500, 'why_care', 500,
      'objection', 500, 'tone', 300, 'sender_context', 300, 'call_to_action', 300);
  begin
    v_brief := '{}'::jsonb;
    for v_field in select jsonb_object_keys(v_bounds) loop
      v_val := nullif(trim(coalesce(p_args ->> v_field, '')), '');
      if v_val is null then
        if v_field = any (v_required) then
          raise exception '% is required', v_field using errcode = '22023';
        end if;
      else
        if length(v_val) > (v_bounds ->> v_field)::int or v_val ~ '[[:cntrl:]]' then
          raise exception '% is bounded to % clean chars', v_field, v_bounds ->> v_field
            using errcode = '22023';
        end if;
        v_brief := v_brief || jsonb_build_object(v_field, v_val);
      end if;
    end loop;
  end;

  -- honest configuration gate — no provider, no request
  v_state := marketing_ai_provider_state(p_tenant);
  if not (v_state ->> 'configured')::boolean then
    raise exception 'AI drafting is not configured: an owner/admin must connect a model provider first'
      using errcode = 'MK428';
  end if;

  -- optional destination / objective context — same-tenant, validated
  if p_args ? 'destination_template_id' and jsonb_typeof(p_args -> 'destination_template_id') <> 'null' then
    begin
      v_tpl := (p_args ->> 'destination_template_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'destination_template_id must be a uuid' using errcode = '22023';
    end;
    if not exists (select 1 from marketing_templates t
                    where t.id = v_tpl and t.tenant_id = p_tenant) then
      raise exception 'destination template not found for tenant' using errcode = 'P0002';
    end if;
  end if;
  if p_args ? 'destination_campaign_id' and jsonb_typeof(p_args -> 'destination_campaign_id') <> 'null' then
    begin
      v_camp := (p_args ->> 'destination_campaign_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'destination_campaign_id must be a uuid' using errcode = '22023';
    end;
    if not exists (select 1 from marketing_campaigns c
                    where c.id = v_camp and c.tenant_id = p_tenant) then
      raise exception 'destination campaign not found for tenant' using errcode = 'P0002';
    end if;
  end if;
  if p_args ? 'objective_id' and jsonb_typeof(p_args -> 'objective_id') <> 'null' then
    begin
      select * into v_obj from objectives
       where id = (p_args ->> 'objective_id')::uuid and tenant_id = p_tenant;
    exception when invalid_text_representation then
      raise exception 'objective_id must be a uuid' using errcode = '22023';
    end;
    if v_obj.id is null then
      raise exception 'objective not found for tenant' using errcode = 'P0002';
    end if;
  end if;

  -- canonical request fingerprint over EVERY frozen input
  v_fp := encode(extensions.digest(jsonb_build_object(
    'request_id', v_request_id, 'actor', p_actor, 'destination', v_dest,
    'template', v_tpl, 'campaign', v_camp, 'objective', v_obj.id,
    'brief', v_brief, 'prompt_version', 'marketing-draft@1')::text, 'sha256'), 'hex');

  -- request-id idempotency under a per-tenant lock
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|mkt_ai_generate', 42));
  select * into v_existing from marketing_ai_requests
   where tenant_id = p_tenant and request_id = v_request_id;
  if found then
    if v_existing.request_fingerprint = v_fp then
      return jsonb_build_object('ai_request_id', v_existing.id,
        'intent_id', v_existing.automation_intent_id,
        'correlation_id', v_existing.correlation_id, 'idempotent', true);
    end if;
    raise exception 'request_id was already used for a DIFFERENT request'
      using errcode = 'MK412';
  end if;

  -- DB-backed rate limit — generation is bounded, and cost stays bounded with it
  select count(*) filter (where created_at > now() - interval '1 minute'),
         count(*) filter (where created_at > now() - interval '1 hour')
    into v_minute, v_hour
    from marketing_ai_requests
   where tenant_id = p_tenant;
  if v_minute >= 3 or v_hour >= 20 then
    raise exception 'AI generation rate limit reached (3/minute, 20/hour per tenant)'
      using errcode = 'MK429';
  end if;

  select coalesce(
    (select e.value #>> '{}' from operating_profile_entries e
      where e.tenant_id = p_tenant and e.namespace = 'operational_mode' and e.key = 'current'
      limit 1),
    (select e.value #>> '{}' from operating_profile_entries e
      where e.tenant_id is null and e.namespace = 'operational_mode' and e.key = 'current'
      limit 1)) into v_mode;

  -- ── canonical Action ──
  insert into intelligence_objects (id, tenant_id, domain, object_type, object_class,
                                    subject, status)
  values (v_action, p_tenant, 'core', 'Action', 'action',
          'AI marketing draft generation (' || v_dest || ')', 'ready');

  -- ── immutable Decision Package — HONEST: an explicitly authorised,
  --    DELEGATED draft-generation action under canonical
  --    marketing.campaigns.draft. No review routing, no approval — and none
  --    fabricated. The provider interaction is external and cannot be
  --    recalled (spend + data egress), so reversibility is recorded
  --    IRREVERSIBLE and the Operational-Mode re-check withholds execution in
  --    modes that require reversibility — the surface states that honestly.
  --    This authorises ONE bounded generation and nothing beyond it: the
  --    result is an immutable draft proposal that cannot send or approve. ──
  v_pkg := jsonb_build_object(
    'id', v_decision,
    'tenantId', p_tenant,
    'supersedes', null,
    'intelligenceObjectId', v_action,
    'intelligenceObjectType', 'Action',
    'objectClass', 'action',
    'domainPackKeys', jsonb_build_array(),
    'decision', 'AUTOMATION_AUTHORISED',
    'nextDecisionOwner', jsonb_build_object('kind', 'automation'),
    'rationale', jsonb_build_object(
      'summary', 'Explicit delegated AI draft-generation request by a tenant actor holding marketing.campaigns.draft',
      'reasonCodes', jsonb_build_array('human_explicit_request'),
      'policyMatches', jsonb_build_array('marketing.campaigns.draft'),
      'rejectedAlternatives', jsonb_build_array(),
      'missingConfiguration', jsonb_build_array()),
    'confidence', jsonb_build_object('score', 1, 'threshold', 0,
                                     'ambiguityScore', 0, 'evidenceQuality', 1),
    'authority', jsonb_build_object(
      'requiredAuthority', 'operational',
      'resolvedAuthorityHolder', p_actor::text,
      'delegatedLimit', null, 'requestedValue', null,
      'withinDelegatedAuthority', true),
    'risk', jsonb_build_object('level', 'low', 'score', 0.2,
                               'categories', jsonb_build_array('operational')),
    'reversibility', jsonb_build_object('level', 'irreversible',
                                        'compensationAvailable', false),
    'impact', jsonb_build_object('level', 'low',
                                 'categories', jsonb_build_array('operational')),
    'ownership', jsonb_build_object('responsible', null, 'accountable', null,
      'approver', null, 'waitingOn', null,
      'consulted', jsonb_build_array(), 'informed', jsonb_build_array()),
    'proposedAction', null,
    'automationIntent', jsonb_build_object('intentType', 'generate_marketing_draft',
      'payload', jsonb_build_object('request_fingerprint', v_fp),
      'requiresApproval', false),
    'routing', jsonb_build_object('reviewRequired', false, 'openfolkRequired', false,
      'tenantReviewRequired', false, 'customerApprovalRequired', false,
      'waitCondition', null),
    'versions', jsonb_build_object('engineVersion', 'marketing-ai.v1',
      'operatingProfileVersion', null,
      'policyVersionIds', jsonb_build_array(),
      'learningVersionIds', jsonb_build_array()),
    'audit', jsonb_build_object('correlationId', v_correlation,
      'inputHash', v_fp, 'outputHash', v_fp));

  insert into decision_log
    (id, tenant_id, object_id, object_snapshot, effective_profile_hash,
     policy_version_ids, matched_rules, outputs, input_hash,
     decision, operational_mode, next_owner_kind, engine_version,
     operating_profile_version, learning_version_ids, reason_codes,
     correlation_id, output_hash, supersedes, decision_package)
  values
    (v_decision, p_tenant, v_action,
     jsonb_build_object('kind', 'marketing_ai_generation', 'destination', v_dest,
                        'requested_by', p_actor, 'request_fingerprint', v_fp,
                        'authority_basis', 'marketing.campaigns.draft'),
     v_fp, '{}', '[]'::jsonb,
     jsonb_build_object('decision', 'AUTOMATION_AUTHORISED',
                        'reason_codes', jsonb_build_array('human_explicit_request')),
     v_fp, 'AUTOMATION_AUTHORISED', v_mode, 'automation',
     'marketing-ai.v1', null, '{}', array['human_explicit_request'],
     v_correlation, v_fp, null, v_pkg);

  -- ── pending Automation Intent with the FROZEN brief ──
  v_params := v_brief || jsonb_build_object(
    'ai_request_id', v_request,
    'destination_kind', v_dest,
    'destination_template_id', v_tpl,
    'destination_campaign_id', v_camp,
    'objective_id', v_obj.id,
    'objective_title', case when v_obj.id is null then null
                            else left(v_obj.title, 300) end,
    'prompt_version', 'marketing-draft@1',
    'actor_profile_id', p_actor,
    'request_id', v_request_id,
    'request_fingerprint', v_fp);
  v_params := jsonb_strip_nulls(v_params);

  insert into automation_intents
    (id, tenant_id, action_object_id, intent_type, parameters, status,
     connector_id, capability_key, decision_id, correlation_id,
     expires_at, max_attempts, schema_version)
  values
    (v_intent, p_tenant, v_action, 'generate_marketing_draft', v_params, 'pending',
     'openai', 'ai.generate_marketing_draft', v_decision, v_correlation,
     now() + interval '1 hour', 3, '1');
  update automation_intents
     set approved_payload_hash = automation_intent_envelope_hash(p_tenant, v_intent)
   where id = v_intent;

  insert into marketing_ai_requests
    (id, tenant_id, automation_intent_id, actor_profile_id, destination_kind,
     destination_template_id, destination_campaign_id, objective_id,
     campaign_objective, offer, audience, why_care, objection, tone,
     sender_context, call_to_action, prompt_version, request_id,
     request_fingerprint, correlation_id)
  values
    (v_request, p_tenant, v_intent, p_actor, v_dest, v_tpl, v_camp, v_obj.id,
     v_brief ->> 'campaign_objective', v_brief ->> 'offer', v_brief ->> 'audience',
     v_brief ->> 'why_care', v_brief ->> 'objection', v_brief ->> 'tone',
     v_brief ->> 'sender_context', v_brief ->> 'call_to_action',
     'marketing-draft@1', v_request_id, v_fp, v_correlation);

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.ai.generation_requested', 'marketing_ai_request',
          v_request::text, 'ok',
          jsonb_build_object('destination', v_dest, 'request_id', v_request_id,
                             'objective', v_obj.id,
                             'authority_basis', 'marketing.campaigns.draft'));
  perform marketing_event_append(p_tenant, 'marketing.ai.generation_requested',
    'marketing_ai_request', v_request, 'marketing-ai-drafts',
    jsonb_build_object('k', 'requested:' || v_request_id, 'destination', v_dest,
                       'actor', v_label, 'at', now()));

  return jsonb_build_object('ai_request_id', v_request, 'intent_id', v_intent,
    'correlation_id', v_correlation, 'idempotent', false);
end $$;

-- ── the adapter's ONLY write path: record the immutable proposal.
--    Model output must pass the ONE canonical content validator or the
--    generation fails permanently — partial/unsafe output never persists. ──
create or replace function marketing_ai_record_proposal(p_tenant uuid, p_intent uuid, p_payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_key text;
  v_intent automation_intents%rowtype;
  v_req marketing_ai_requests%rowtype;
  v_existing marketing_ai_proposals%rowtype;
  v_tokens text[];
  v_hash text;
  v_fallbacks jsonb;
  v_proposal uuid := gen_random_uuid();
begin
  if p_tenant is null or p_intent is null then
    raise exception 'tenant and intent required' using errcode = '22023';
  end if;
  select * into v_intent from automation_intents
   where id = p_intent and tenant_id = p_tenant;
  if not found or v_intent.intent_type <> 'generate_marketing_draft' then
    raise exception 'intent not found for tenant (or not a generation intent)'
      using errcode = 'P0002';
  end if;
  select * into v_req from marketing_ai_requests
   where tenant_id = p_tenant and automation_intent_id = p_intent;
  if not found then
    raise exception 'no AI request exists for this intent' using errcode = 'P0002';
  end if;
  -- idempotent: one proposal per intent, converge on the stored row
  select * into v_existing from marketing_ai_proposals
   where tenant_id = p_tenant and automation_intent_id = p_intent;
  if found then
    return jsonb_build_object('proposal_id', v_existing.id,
      'content_hash', v_existing.content_hash, 'idempotent', true);
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key not in ('provider', 'model', 'subject', 'preview_text', 'body_authored',
                     'token_fallbacks', 'prompt_tokens', 'completion_tokens',
                     'finish_reason') then
      raise exception 'unknown proposal payload key %', v_key using errcode = '22023';
    end if;
  end loop;
  if coalesce(p_payload ->> 'provider', '') = '' or coalesce(p_payload ->> 'model', '') = '' then
    raise exception 'provider and model provenance are required' using errcode = '22023';
  end if;
  if p_payload ? 'prompt_tokens' and jsonb_typeof(p_payload -> 'prompt_tokens') not in ('number', 'null') then
    raise exception 'prompt_tokens must be a number' using errcode = '22023';
  end if;
  if p_payload ? 'completion_tokens' and jsonb_typeof(p_payload -> 'completion_tokens') not in ('number', 'null') then
    raise exception 'completion_tokens must be a number' using errcode = '22023';
  end if;

  v_fallbacks := coalesce(p_payload -> 'token_fallbacks', '{}'::jsonb);
  -- THE canonical validator — model output is judged exactly like any
  -- human-authored broadcast/sequence content
  v_tokens := marketing_campaign_validate_content(
    p_payload ->> 'subject', p_payload ->> 'preview_text',
    p_payload ->> 'body_authored', v_fallbacks);
  v_hash := marketing_template_revision_hash(
    p_payload ->> 'subject', nullif(p_payload ->> 'preview_text', ''),
    p_payload ->> 'body_authored', v_tokens, v_fallbacks);

  insert into marketing_ai_proposals
    (id, tenant_id, ai_request_id, automation_intent_id, provider, model,
     prompt_version, subject, preview_text, body_authored, tokens_required,
     token_fallbacks, content_hash, prompt_tokens, completion_tokens, finish_reason)
  values
    (v_proposal, p_tenant, v_req.id, p_intent,
     p_payload ->> 'provider', p_payload ->> 'model', v_req.prompt_version,
     p_payload ->> 'subject', nullif(p_payload ->> 'preview_text', ''),
     p_payload ->> 'body_authored', v_tokens, v_fallbacks, v_hash,
     (p_payload ->> 'prompt_tokens')::int, (p_payload ->> 'completion_tokens')::int,
     nullif(p_payload ->> 'finish_reason', ''));

  perform marketing_event_append(p_tenant, 'marketing.ai.generation_succeeded',
    'marketing_ai_request', v_req.id, 'marketing-ai-drafts',
    jsonb_build_object('k', 'proposal:' || v_proposal,
                       'model', p_payload ->> 'model', 'at', now()));

  return jsonb_build_object('proposal_id', v_proposal, 'content_hash', v_hash,
                            'idempotent', false);
end $$;

-- ── derived request status — always computed from engine facts, never stored ──
create or replace function marketing_ai_request_status(p_tenant uuid, p_request uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_req marketing_ai_requests%rowtype;
  v_intent automation_intents%rowtype;
  v_proposal marketing_ai_proposals%rowtype;
  v_status text;
begin
  if p_tenant is null or p_request is null then
    raise exception 'tenant and request required' using errcode = '22023';
  end if;
  select * into v_req from marketing_ai_requests
   where id = p_request and tenant_id = p_tenant;
  if not found then
    raise exception 'AI request not found for tenant' using errcode = 'P0002';
  end if;
  select * into v_intent from automation_intents
   where id = v_req.automation_intent_id and tenant_id = p_tenant;
  select * into v_proposal from marketing_ai_proposals
   where tenant_id = p_tenant and automation_intent_id = v_req.automation_intent_id;

  v_status := case
    when v_req.closed_reason = 'cancelled' then 'cancelled'
    when v_proposal.id is not null then 'succeeded'
    when v_intent.id is null then 'unknown'
    when v_intent.status in ('pending', 'claimed', 'approved') then 'queued'
    when v_intent.status = 'executing' then 'executing'
    when v_intent.status = 'succeeded' then 'succeeded'
    when v_intent.status = 'failed' then 'failed'
    when v_intent.status = 'unknown' then 'unknown'
    when v_intent.status = 'expired' then 'failed'
    when v_intent.status = 'cancelled' then 'cancelled'
    else v_intent.status end;

  return jsonb_build_object(
    'ai_request_id', v_req.id,
    'status', v_status,
    'intent_status', v_intent.status,
    'attempts', v_intent.attempts,
    'last_error', v_intent.last_error,
    'proposal_id', v_proposal.id,
    'closed_at', v_req.closed_at,
    'closed_reason', v_req.closed_reason,
    'created_at', v_req.created_at);
end $$;

create or replace function marketing_ai_request_list(p_tenant uuid, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_key text;
  v_limit int := 20;
  v_cur jsonb;
  v_cur_at timestamptz;
  v_cur_id uuid;
  v_rows jsonb;
  v_next jsonb;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('limit', 'cursor') then
      raise exception 'unknown list argument %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_args ? 'limit' then
    if jsonb_typeof(p_args -> 'limit') <> 'number' or (p_args ->> 'limit') ~ '[.eE]' then
      raise exception 'limit must be an integer' using errcode = '22023';
    end if;
    v_limit := least(greatest((p_args ->> 'limit')::int, 1), 50);
  end if;
  if p_args ? 'cursor' and jsonb_typeof(p_args -> 'cursor') <> 'null' then
    v_cur := p_args -> 'cursor';
    if jsonb_typeof(v_cur) <> 'object'
       or jsonb_typeof(v_cur -> 'at') <> 'string'
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

  select coalesce(jsonb_agg(row_j order by created_at desc, id desc), '[]'::jsonb)
    into v_rows from (
    select q.created_at, q.id,
           marketing_ai_request_status(p_tenant, q.id)
           || jsonb_build_object(
                'destination_kind', q.destination_kind,
                'campaign_objective', q.campaign_objective,
                'request_id', q.request_id,
                'actor_email', (select p.email from profiles p
                                 where p.id = q.actor_profile_id
                                   and p.tenant_id = p_tenant)) as row_j
      from marketing_ai_requests q
     where q.tenant_id = p_tenant
       and (v_cur_at is null or (q.created_at, q.id) < (v_cur_at, v_cur_id))
     order by q.created_at desc, q.id desc
     limit v_limit + 1
  ) page;

  if jsonb_array_length(v_rows) > v_limit then
    v_next := jsonb_build_object(
      'at', (v_rows -> (v_limit - 1)) ->> 'created_at',
      'id', (v_rows -> (v_limit - 1)) ->> 'ai_request_id');
    v_rows := (select coalesce(jsonb_agg(t.e order by t.i), '[]'::jsonb)
                 from jsonb_array_elements(v_rows) with ordinality t(e, i)
                where t.i <= v_limit);
  end if;
  return jsonb_build_object('requests', v_rows, 'next_cursor', v_next);
end $$;

create or replace function marketing_ai_proposal_detail(p_tenant uuid, p_proposal uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_p marketing_ai_proposals%rowtype;
  v_req marketing_ai_requests%rowtype;
begin
  if p_tenant is null or p_proposal is null then
    raise exception 'tenant and proposal required' using errcode = '22023';
  end if;
  select * into v_p from marketing_ai_proposals
   where id = p_proposal and tenant_id = p_tenant;
  if not found then
    raise exception 'AI proposal not found for tenant' using errcode = 'P0002';
  end if;
  select * into v_req from marketing_ai_requests
   where id = v_p.ai_request_id and tenant_id = p_tenant;
  return jsonb_build_object(
    'id', v_p.id, 'ai_request_id', v_p.ai_request_id,
    'provider', v_p.provider, 'model', v_p.model,
    'prompt_version', v_p.prompt_version,
    'subject', v_p.subject, 'preview_text', v_p.preview_text,
    'body_authored', v_p.body_authored,
    'tokens_required', to_jsonb(v_p.tokens_required),
    'token_fallbacks', v_p.token_fallbacks,
    'content_hash', v_p.content_hash,
    'prompt_tokens', v_p.prompt_tokens, 'completion_tokens', v_p.completion_tokens,
    'finish_reason', v_p.finish_reason,
    'created_at', v_p.created_at,
    'brief', jsonb_build_object(
      'destination_kind', v_req.destination_kind,
      'campaign_objective', v_req.campaign_objective, 'offer', v_req.offer,
      'audience', v_req.audience, 'why_care', v_req.why_care,
      'objection', v_req.objection, 'tone', v_req.tone,
      'sender_context', v_req.sender_context,
      'call_to_action', v_req.call_to_action,
      'objective_id', v_req.objective_id,
      'closed_at', v_req.closed_at, 'closed_reason', v_req.closed_reason),
    'revisions', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'revision_number', r.revision_number, 'subject', r.subject,
        'preview_text', r.preview_text, 'body_authored', r.body_authored,
        'token_fallbacks', r.token_fallbacks, 'content_hash', r.content_hash,
        'change_note', r.change_note, 'created_at', r.created_at,
        'editor_email', (select p.email from profiles p
                          where p.id = r.editor_profile_id and p.tenant_id = p_tenant))
        order by r.revision_number desc), '[]'::jsonb)
       from (select * from marketing_ai_revisions r0
              where r0.tenant_id = p_tenant and r0.proposal_id = p_proposal
              order by r0.revision_number desc limit 50) r),
    'accepted_into', jsonb_build_object(
      'template_revisions', (select coalesce(jsonb_agg(jsonb_build_object(
          'template_id', tr.template_id, 'revision_id', tr.id,
          'revision_number', tr.revision_number)), '[]'::jsonb)
         from marketing_template_revisions tr
        where tr.tenant_id = p_tenant and tr.source_ai_proposal_id = p_proposal),
      'campaign_revisions', (select coalesce(jsonb_agg(jsonb_build_object(
          'campaign_id', cr.campaign_id, 'revision_id', cr.id,
          'revision_number', cr.revision_number)), '[]'::jsonb)
         from marketing_campaign_revisions cr
        where cr.tenant_id = p_tenant and cr.source_ai_proposal_id = p_proposal),
      'sequence_steps', (select coalesce(jsonb_agg(jsonb_build_object(
          'campaign_id', s.campaign_id, 'revision_id', s.revision_id,
          'step_key', s.step_key)), '[]'::jsonb)
         from marketing_sequence_steps s
        where s.tenant_id = p_tenant
          and s.config ->> 'source_ai_proposal_id' = p_proposal::text)));
end $$;

-- ── human revision of a proposal (append-only; the original is never touched) ──
create or replace function marketing_ai_revise(
  p_tenant uuid, p_actor uuid, p_proposal uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_p marketing_ai_proposals%rowtype;
  v_prev marketing_ai_revisions%rowtype;
  v_subject text;
  v_preview text;
  v_body text;
  v_fallbacks jsonb;
  v_note text;
  v_tokens text[];
  v_hash text;
  v_n int;
  v_rev uuid := gen_random_uuid();
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  if p_proposal is null then
    raise exception 'proposal required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' or p_args = '{}'::jsonb then
    raise exception 'changes must be a non-empty object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('subject', 'preview_text', 'body_authored', 'token_fallbacks',
                     'change_note') then
      raise exception 'unknown revise argument %', v_key using errcode = '22023';
    end if;
  end loop;
  select * into v_p from marketing_ai_proposals
   where id = p_proposal and tenant_id = p_tenant;
  if not found then
    raise exception 'AI proposal not found for tenant' using errcode = 'P0002';
  end if;
  v_note := nullif(trim(coalesce(p_args ->> 'change_note', '')), '');
  if v_note is not null and (length(v_note) > 500 or v_note ~ '[[:cntrl:]]') then
    raise exception 'change_note is bounded to 500 clean chars' using errcode = '22023';
  end if;
  select * into v_prev from marketing_ai_revisions
   where tenant_id = p_tenant and proposal_id = p_proposal
   order by revision_number desc limit 1;
  -- overlay: latest human revision when one exists, else the immutable original
  v_subject := coalesce(p_args ->> 'subject',
                        case when v_prev.id is null then v_p.subject else v_prev.subject end);
  v_preview := case when p_args ? 'preview_text' then nullif(p_args ->> 'preview_text', '')
                    when v_prev.id is null then v_p.preview_text
                    else v_prev.preview_text end;
  v_body := coalesce(p_args ->> 'body_authored',
                     case when v_prev.id is null then v_p.body_authored else v_prev.body_authored end);
  v_fallbacks := coalesce(p_args -> 'token_fallbacks',
                          case when v_prev.id is null then v_p.token_fallbacks
                               else v_prev.token_fallbacks end, '{}'::jsonb);
  v_tokens := marketing_campaign_validate_content(v_subject, v_preview, v_body, v_fallbacks);
  v_hash := marketing_template_revision_hash(v_subject, v_preview, v_body,
                                             v_tokens, v_fallbacks);
  v_n := coalesce(v_prev.revision_number, 0) + 1;

  insert into marketing_ai_revisions
    (id, tenant_id, proposal_id, revision_number, subject, preview_text, body_authored,
     tokens_required, token_fallbacks, content_hash, editor_profile_id, change_note)
  values (v_rev, p_tenant, p_proposal, v_n, v_subject, v_preview, v_body,
          v_tokens, v_fallbacks, v_hash, p_actor, v_note);

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.ai.proposal_revised', 'marketing_ai_proposal',
          p_proposal::text, 'ok', jsonb_build_object('revision', v_n));
  perform marketing_event_append(p_tenant, 'marketing.ai.proposal_revised',
    'marketing_ai_proposal', p_proposal, 'marketing-ai-drafts',
    jsonb_build_object('k', 'revised:' || v_rev, 'revision', v_n,
                       'actor', v_label, 'at', now()));

  return jsonb_build_object('proposal_id', p_proposal, 'revision_id', v_rev,
                            'revision', v_n, 'content_hash', v_hash);
end $$;

-- ── acceptance — creates or updates ONLY a draft destination, through the
--    same canonical authoring RPCs every human edit uses. It cannot approve,
--    launch or send, and revising an approved campaign structurally
--    invalidates its approval (the campaign returns to draft). ──
create or replace function marketing_ai_accept(p_tenant uuid, p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_p marketing_ai_proposals%rowtype;
  v_rev marketing_ai_revisions%rowtype;
  v_dest text;
  v_request_id text;
  v_fp text;
  v_stored marketing_request_keys%rowtype;
  v_subject text;
  v_preview text;
  v_body text;
  v_fallbacks jsonb;
  v_content jsonb;
  v_c marketing_campaigns%rowtype;
  v_steps jsonb;
  v_step_found boolean := false;
  v_result jsonb;
  v_expected int;
  s record;
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('proposal_id', 'revision_id', 'destination_kind', 'request_id',
                     'template_id', 'template_name', 'expected_version',
                     'campaign_id', 'name', 'sender_id', 'segment_id',
                     'step_key', 'append_step') then
      raise exception 'unknown accept argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_request_id := p_args ->> 'request_id';
  if v_request_id is null or v_request_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'request_id must match ^[A-Za-z0-9_-]{8,64}$' using errcode = '22023';
  end if;
  v_dest := p_args ->> 'destination_kind';
  if v_dest is null or v_dest not in ('template', 'broadcast', 'sequence_step') then
    raise exception 'destination_kind must be template|broadcast|sequence_step'
      using errcode = '22023';
  end if;
  begin
    select * into v_p from marketing_ai_proposals
     where id = (p_args ->> 'proposal_id')::uuid and tenant_id = p_tenant;
  exception when others then
    raise exception 'invalid proposal id' using errcode = '22023';
  end;
  if v_p.id is null then
    raise exception 'AI proposal not found for tenant' using errcode = 'P0002';
  end if;
  if p_args ? 'revision_id' and jsonb_typeof(p_args -> 'revision_id') <> 'null' then
    begin
      select * into v_rev from marketing_ai_revisions
       where id = (p_args ->> 'revision_id')::uuid and tenant_id = p_tenant
         and proposal_id = v_p.id;
    exception when others then
      raise exception 'invalid revision id' using errcode = '22023';
    end;
    if v_rev.id is null then
      raise exception 'revision not found for this proposal' using errcode = 'P0002';
    end if;
    v_subject := v_rev.subject; v_preview := v_rev.preview_text;
    v_body := v_rev.body_authored; v_fallbacks := v_rev.token_fallbacks;
  else
    v_subject := v_p.subject; v_preview := v_p.preview_text;
    v_body := v_p.body_authored; v_fallbacks := v_p.token_fallbacks;
  end if;

  -- request idempotency (double-clicks converge; a changed reuse conflicts)
  v_fp := encode(extensions.digest(jsonb_build_object(
    'action', 'ai_accept', 'proposal', v_p.id, 'revision', v_rev.id,
    'destination', v_dest, 'args', p_args - 'request_id', 'actor', p_actor)::text,
    'sha256'), 'hex');
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant::text || '|mkt_ai_accept|' || v_request_id, 42));
  select * into v_stored from marketing_request_keys
   where tenant_id = p_tenant
     and idempotency_key = md5('ai_accept:' || v_request_id)::uuid;
  if found then
    if v_stored.fingerprint = v_fp then
      return v_stored.result;
    end if;
    raise exception 'request_id was already used for a DIFFERENT request'
      using errcode = 'MK412';
  end if;

  if v_dest = 'template' then
    if p_args ? 'template_id' and jsonb_typeof(p_args -> 'template_id') <> 'null' then
      if not (p_args ? 'expected_version') then
        raise exception 'accepting into an existing template needs expected_version'
          using errcode = '22023';
      end if;
      if jsonb_typeof(p_args -> 'expected_version') <> 'number'
         or (p_args ->> 'expected_version') ~ '[.eE]' then
        raise exception 'expected_version must be an integer' using errcode = '22023';
      end if;
      -- the CHILD request id for the internal template mutation is DERIVED
      -- server-side from the governed outer accept request (deterministic,
      -- namespaced) — the browser can never supply it (accept's own key
      -- allowlist carries no template request id), and an engine-level retry
      -- of the same accept can never mint a second revision
      v_result := marketing_template_revise(p_tenant, p_actor,
        (p_args ->> 'template_id')::uuid,
        jsonb_build_object('subject', v_subject, 'preview_text', v_preview,
                           'body_authored', v_body, 'token_fallbacks', v_fallbacks,
                           'source_ai_proposal_id', v_p.id::text,
                           'request_id',
                           substr(md5('ai-accept-child:' || v_request_id), 1, 32)),
        (p_args ->> 'expected_version')::int);
    else
      if coalesce(p_args ->> 'template_name', '') = '' then
        raise exception 'a new template needs template_name' using errcode = '22023';
      end if;
      -- derived namespaced child key — see the revise branch above
      v_result := marketing_template_create(p_tenant, p_actor,
        jsonb_build_object('name', p_args ->> 'template_name',
                           'subject', v_subject, 'preview_text', v_preview,
                           'body_authored', v_body, 'token_fallbacks', v_fallbacks,
                           'source_ai_proposal_id', v_p.id::text,
                           'request_id',
                           substr(md5('ai-accept-child:' || v_request_id), 1, 32)));
    end if;

  elsif v_dest = 'broadcast' then
    v_content := jsonb_build_object('subject', v_subject, 'preview_text', v_preview,
      'body_authored', v_body, 'token_fallbacks', v_fallbacks,
      'source_ai_proposal_id', v_p.id::text);
    if p_args ? 'campaign_id' and jsonb_typeof(p_args -> 'campaign_id') <> 'null' then
      if not (p_args ? 'expected_version') then
        raise exception 'accepting into an existing broadcast needs expected_version'
          using errcode = '22023';
      end if;
      if jsonb_typeof(p_args -> 'expected_version') <> 'number'
         or (p_args ->> 'expected_version') ~ '[.eE]' then
        raise exception 'expected_version must be an integer' using errcode = '22023';
      end if;
      begin
        select * into v_c from marketing_campaigns
         where id = (p_args ->> 'campaign_id')::uuid and tenant_id = p_tenant;
      exception when others then
        raise exception 'invalid campaign id' using errcode = '22023';
      end;
      if v_c.id is null then
        raise exception 'campaign not found for tenant' using errcode = 'P0002';
      end if;
      if v_c.campaign_type <> 'broadcast' then
        raise exception 'destination broadcast names a sequence campaign — use destination_kind sequence_step'
          using errcode = '22023';
      end if;
      v_result := marketing_campaign_revise(p_tenant, p_actor, v_c.id, v_content,
        (p_args ->> 'expected_version')::int);
    else
      if not (p_args ? 'name' and p_args ? 'sender_id' and p_args ? 'segment_id') then
        raise exception 'a new broadcast draft needs name, sender_id and segment_id'
          using errcode = '22023';
      end if;
      v_result := marketing_campaign_create(p_tenant, p_actor,
        v_content || jsonb_build_object('name', p_args ->> 'name',
                                        'sender_id', p_args ->> 'sender_id',
                                        'segment_id', p_args ->> 'segment_id'));
    end if;

  else   -- sequence_step
    if not (p_args ? 'campaign_id' and p_args ? 'expected_version') then
      raise exception 'accepting into a sequence needs campaign_id and expected_version'
        using errcode = '22023';
    end if;
    if jsonb_typeof(p_args -> 'expected_version') <> 'number'
       or (p_args ->> 'expected_version') ~ '[.eE]' then
      raise exception 'expected_version must be an integer' using errcode = '22023';
    end if;
    begin
      select * into v_c from marketing_campaigns
       where id = (p_args ->> 'campaign_id')::uuid and tenant_id = p_tenant;
    exception when others then
      raise exception 'invalid campaign id' using errcode = '22023';
    end;
    if v_c.id is null then
      raise exception 'campaign not found for tenant' using errcode = 'P0002';
    end if;
    if v_c.campaign_type <> 'sequence' then
      raise exception 'destination sequence_step names a broadcast campaign — use destination_kind broadcast'
        using errcode = '22023';
    end if;
    if v_c.current_sequence_revision_id is null then
      raise exception 'the sequence has no revision yet' using errcode = 'P0002';
    end if;
    if not (p_args ? 'step_key') and not coalesce((p_args -> 'append_step')::boolean, false) then
      raise exception 'name a step_key to replace, or set append_step true'
        using errcode = '22023';
    end if;
    -- rebuild the full step list with the accepted content placed
    v_steps := '[]'::jsonb;
    for s in select * from marketing_sequence_steps st
              where st.tenant_id = p_tenant
                and st.revision_id = v_c.current_sequence_revision_id
              order by st.step_order loop
      if p_args ? 'step_key' and s.step_key = (p_args ->> 'step_key') then
        if s.step_type <> 'send_email' then
          raise exception 'only a send_email step can take accepted content (step % is %)',
            s.step_key, s.step_type using errcode = '22023';
        end if;
        v_step_found := true;
        v_steps := v_steps || jsonb_build_array(jsonb_build_object(
          'key', s.step_key, 'type', 'send_email',
          'config', jsonb_strip_nulls(jsonb_build_object(
            'subject', v_subject, 'preview_text', v_preview,
            'body_authored', v_body, 'token_fallbacks', v_fallbacks,
            'source_ai_proposal_id', v_p.id::text))));
      else
        v_steps := v_steps || jsonb_build_array(jsonb_build_object(
          'key', s.step_key, 'type', s.step_type,
          'config', s.config - 'tokens_required'));
      end if;
    end loop;
    if p_args ? 'step_key' and not v_step_found then
      raise exception 'step % not found on the current revision', p_args ->> 'step_key'
        using errcode = 'P0002';
    end if;
    if not (p_args ? 'step_key') then
      v_steps := v_steps || jsonb_build_array(jsonb_build_object(
        'key', 'ai-' || substr(replace(v_p.id::text, '-', ''), 1, 12),
        'type', 'send_email',
        'config', jsonb_strip_nulls(jsonb_build_object(
          'subject', v_subject, 'preview_text', v_preview,
          'body_authored', v_body, 'token_fallbacks', v_fallbacks,
          'source_ai_proposal_id', v_p.id::text))));
    end if;
    v_result := marketing_sequence_revise(p_tenant, p_actor, v_c.id,
      jsonb_build_object('steps', v_steps), (p_args ->> 'expected_version')::int);
  end if;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.ai.proposal_accepted', 'marketing_ai_proposal',
          v_p.id::text, 'ok',
          jsonb_build_object('destination', v_dest, 'revision', v_rev.id,
                             'request_id', v_request_id,
                             'note', 'acceptance creates a DRAFT only — it approves and sends nothing'));
  perform marketing_event_append(p_tenant, 'marketing.ai.proposal_accepted',
    'marketing_ai_proposal', v_p.id, 'marketing-ai-drafts',
    jsonb_build_object('k', 'accepted:' || v_request_id, 'destination', v_dest,
                       'actor', v_label, 'at', now()));

  v_result := v_result || jsonb_build_object('proposal_id', v_p.id,
    'accepted_revision_id', v_rev.id, 'destination_kind', v_dest);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('ai_accept:' || v_request_id)::uuid, p_actor,
          'ai_accept', v_fp, v_result);
  return v_result;
end $$;

-- ── reject (close the request; the proposal stays as historical evidence) ──
create or replace function marketing_ai_reject(
  p_tenant uuid, p_actor uuid, p_request uuid, p_args jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_req marketing_ai_requests%rowtype;
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  if p_request is null then
    raise exception 'request required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('reason') then
      raise exception 'unknown reject argument %', v_key using errcode = '22023';
    end if;
  end loop;
  select * into v_req from marketing_ai_requests
   where id = p_request and tenant_id = p_tenant for update;
  if not found then
    raise exception 'AI request not found for tenant' using errcode = 'P0002';
  end if;
  if v_req.closed_at is not null then
    raise exception 'the request is already closed (%)', v_req.closed_reason
      using errcode = '22023';
  end if;
  update marketing_ai_requests
     set closed_at = now(), closed_by = p_actor, closed_reason = 'rejected'
   where id = p_request;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.ai.proposal_rejected', 'marketing_ai_request',
          p_request::text, 'ok',
          jsonb_build_object('reason', left(coalesce(p_args ->> 'reason', ''), 500)));
  perform marketing_event_append(p_tenant, 'marketing.ai.proposal_rejected',
    'marketing_ai_request', p_request, 'marketing-ai-drafts',
    jsonb_build_object('k', 'rejected:' || p_request, 'actor', v_label, 'at', now()));

  return jsonb_build_object('ai_request_id', p_request, 'closed_reason', 'rejected');
end $$;

-- ── cancel BEFORE provider execution (a pending intent is legally cancelled;
--    once execution began, the factual result is preserved instead) ──
create or replace function marketing_ai_cancel(
  p_tenant uuid, p_actor uuid, p_request uuid
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_req marketing_ai_requests%rowtype;
  v_cancelled boolean := false;
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  if p_request is null then
    raise exception 'request required' using errcode = '22023';
  end if;
  select * into v_req from marketing_ai_requests
   where id = p_request and tenant_id = p_tenant for update;
  if not found then
    raise exception 'AI request not found for tenant' using errcode = 'P0002';
  end if;
  if v_req.closed_at is not null then
    raise exception 'the request is already closed (%)', v_req.closed_reason
      using errcode = '22023';
  end if;
  if exists (select 1 from marketing_ai_proposals p
              where p.tenant_id = p_tenant and p.ai_request_id = p_request) then
    raise exception 'generation already completed — the factual proposal is preserved; reject it instead'
      using errcode = '22023';
  end if;
  -- the engine's legal pending → cancelled transition (Phase-5 precedent);
  -- an executing/unknown intent is never rewritten
  update automation_intents set status = 'cancelled'
   where id = v_req.automation_intent_id and tenant_id = p_tenant
     and status = 'pending';
  v_cancelled := found;
  if not v_cancelled then
    raise exception 'generation is no longer pending — it cannot be cancelled (its factual result will be preserved)'
      using errcode = '22023';
  end if;
  update marketing_ai_requests
     set closed_at = now(), closed_by = p_actor, closed_reason = 'cancelled'
   where id = p_request;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.ai.generation_cancelled', 'marketing_ai_request',
          p_request::text, 'ok', '{}'::jsonb);
  perform marketing_event_append(p_tenant, 'marketing.ai.generation_cancelled',
    'marketing_ai_request', p_request, 'marketing-ai-drafts',
    jsonb_build_object('k', 'cancelled:' || p_request, 'actor', v_label, 'at', now()));

  return jsonb_build_object('ai_request_id', p_request, 'closed_reason', 'cancelled',
                            'intent_cancelled', v_cancelled);
end $$;

-- ── use a Template revision in a SEQUENCE email step: rebuild the step list
--    with the pinned content placed (replace an existing send_email step or
--    append a new one), through the canonical marketing_sequence_revise —
--    revision-pinning, re-approval and bundle hashing all apply unchanged ──
create or replace function marketing_template_use_in_sequence_step(
  p_tenant uuid, p_actor uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_key text;
  v_rev marketing_template_revisions%rowtype;
  v_c marketing_campaigns%rowtype;
  v_steps jsonb := '[]'::jsonb;
  v_step_found boolean := false;
  v_result jsonb;
  s record;
  v_config jsonb;
  v_request_id text;
  v_fp text;
  v_stored jsonb;
begin
  perform marketing_require_draft_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('template_revision_id', 'campaign_id', 'expected_version',
                     'step_key', 'append_step', 'request_id') then
      raise exception 'unknown use_in_sequence_step argument %', v_key using errcode = '22023';
    end if;
  end loop;
  -- REQUEST IDEMPOTENCY FIRST: a replay creates no second sequence revision,
  -- step or usage row — it returns the original composed result
  v_request_id := p_args ->> 'request_id';
  v_fp := encode(extensions.digest(jsonb_build_object(
    'tenant', p_tenant, 'actor', p_actor, 'action', 'template_use_sequence',
    'args', p_args - 'request_id')::text, 'sha256'), 'hex');
  v_stored := marketing_template_request_gate(p_tenant, 'template_use_sequence',
                                              v_request_id, v_fp);
  if v_stored is not null then
    return v_stored;
  end if;
  begin
    select * into v_rev from marketing_template_revisions
     where id = (p_args ->> 'template_revision_id')::uuid and tenant_id = p_tenant;
  exception when others then
    raise exception 'invalid template revision id' using errcode = '22023';
  end;
  if v_rev.id is null then
    raise exception 'template revision not found for tenant' using errcode = 'P0002';
  end if;
  if not (p_args ? 'campaign_id' and p_args ? 'expected_version') then
    raise exception 'campaign_id and expected_version are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_args -> 'expected_version') <> 'number'
     or (p_args ->> 'expected_version') ~ '[.eE]' then
    raise exception 'expected_version must be an integer' using errcode = '22023';
  end if;
  begin
    select * into v_c from marketing_campaigns
     where id = (p_args ->> 'campaign_id')::uuid and tenant_id = p_tenant;
  exception when others then
    raise exception 'invalid campaign id' using errcode = '22023';
  end;
  if v_c.id is null then
    raise exception 'campaign not found for tenant' using errcode = 'P0002';
  end if;
  if v_c.campaign_type <> 'sequence' then
    raise exception 'this action places a template into a SEQUENCE — broadcasts use use_in_broadcast'
      using errcode = '22023';
  end if;
  if v_c.current_sequence_revision_id is null then
    raise exception 'the sequence has no revision yet' using errcode = 'P0002';
  end if;
  if not (p_args ? 'step_key') and not coalesce((p_args -> 'append_step')::boolean, false) then
    raise exception 'name a step_key to replace, or set append_step true' using errcode = '22023';
  end if;

  v_config := jsonb_strip_nulls(jsonb_build_object(
    'subject', v_rev.subject,
    'preview_text', v_rev.preview_text,
    'body_authored', v_rev.body_authored,
    'token_fallbacks', v_rev.token_fallbacks,
    'source_template_revision_id', v_rev.id::text));

  for s in select * from marketing_sequence_steps st
            where st.tenant_id = p_tenant
              and st.revision_id = v_c.current_sequence_revision_id
            order by st.step_order loop
    if p_args ? 'step_key' and s.step_key = (p_args ->> 'step_key') then
      if s.step_type <> 'send_email' then
        raise exception 'only a send_email step can take template content (step % is %)',
          s.step_key, s.step_type using errcode = '22023';
      end if;
      v_step_found := true;
      v_steps := v_steps || jsonb_build_array(jsonb_build_object(
        'key', s.step_key, 'type', 'send_email', 'config', v_config));
    else
      v_steps := v_steps || jsonb_build_array(jsonb_build_object(
        'key', s.step_key, 'type', s.step_type,
        'config', s.config - 'tokens_required'));
    end if;
  end loop;
  if p_args ? 'step_key' and not v_step_found then
    raise exception 'step % not found on the current revision', p_args ->> 'step_key'
      using errcode = 'P0002';
  end if;
  if not (p_args ? 'step_key') then
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'key', 'tpl-' || substr(replace(v_rev.id::text, '-', ''), 1, 12),
      'type', 'send_email', 'config', v_config));
  end if;

  v_result := marketing_sequence_revise(p_tenant, p_actor, v_c.id,
    jsonb_build_object('steps', v_steps), (p_args ->> 'expected_version')::int);
  v_result := v_result || jsonb_build_object(
    'template_id', v_rev.template_id, 'template_revision_id', v_rev.id);
  insert into marketing_request_keys (tenant_id, idempotency_key, actor, action,
                                      fingerprint, result)
  values (p_tenant, md5('template_use_sequence:' || v_request_id)::uuid, p_actor,
          'template_use_sequence', v_fp, v_result);
  return v_result;
end $$;

-- ============================================================================
-- PART H · FUNCTION AUTHORITY — every Phase-7 function is service-role-only.
-- Supabase-managed databases grant EXECUTE on new public functions to client
-- roles by default; revoke explicitly so the boundary is deterministic in
-- EVERY environment. (The replaced supersets keep their existing ACLs —
-- CREATE OR REPLACE preserves privileges.) The Phase-7 SQL suite additionally
-- derives this function set FROM THE CATALOG and fails loudly if any of them
-- ever becomes client-reachable.
-- ============================================================================
do $$
declare
  fn text;
begin
  foreach fn in array array[
    -- templates
    'marketing_template_guard()',
    'marketing_template_revision_hash(text, text, text, text[], jsonb)',
    'marketing_template_usage_record()',
    'marketing_campaign_revision_lineage_guard()',
    'marketing_sequence_step_lineage_guard()',
    'marketing_template_request_gate(uuid, text, text, text)',
    'marketing_template_lineage_check(uuid, uuid, text, text, text, jsonb)',
    'marketing_ai_lineage_check(uuid, uuid, text, text, text, jsonb)',
    'marketing_template_create(uuid, uuid, jsonb)',
    'marketing_template_revise(uuid, uuid, uuid, jsonb, int)',
    'marketing_template_duplicate(uuid, uuid, uuid, jsonb)',
    'marketing_template_set_status(uuid, uuid, uuid, jsonb, int)',
    'marketing_template_list(uuid, jsonb)',
    'marketing_template_detail(uuid, uuid)',
    'marketing_template_use_in_broadcast(uuid, uuid, jsonb)',
    'marketing_template_use_in_sequence_step(uuid, uuid, jsonb)',
    -- objectives
    'objective_links_marketing_campaign_guard()',
    'marketing_campaigns_objective_ref_guard()',
    'marketing_campaign_objective_link(uuid, uuid, uuid, jsonb, int)',
    'marketing_campaign_objective_unlink(uuid, uuid, uuid, jsonb, int)',
    'marketing_objective_search(uuid, jsonb)',
    'marketing_campaign_objective_context(uuid, uuid)',
    -- reporting
    'marketing_reporting_overview(uuid, jsonb)',
    'marketing_reporting_campaign(uuid, uuid)',
    -- AI drafting
    'marketing_ai_request_guard()',
    'marketing_ai_provider_state(uuid)',
    'marketing_ai_configure(uuid, uuid, jsonb)',
    'marketing_ai_generation_request(uuid, uuid, jsonb)',
    'marketing_ai_record_proposal(uuid, uuid, jsonb)',
    'marketing_ai_request_status(uuid, uuid)',
    'marketing_ai_request_list(uuid, jsonb)',
    'marketing_ai_proposal_detail(uuid, uuid)',
    'marketing_ai_revise(uuid, uuid, uuid, jsonb)',
    'marketing_ai_accept(uuid, uuid, jsonb)',
    'marketing_ai_reject(uuid, uuid, uuid, jsonb)',
    'marketing_ai_cancel(uuid, uuid, uuid)'
  ] loop
    execute 'revoke all on function public.' || fn || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || fn || ' to service_role';
  end loop;
end $$;
