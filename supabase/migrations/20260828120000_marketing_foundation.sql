-- ServiceOS — Marketing CRM foundation (universal, additive, tenant-scoped, hardened).
--
-- Phase 1 of the Marketing CRM. Lays the canonical data foundations for a
-- Marketing capability that is a SERVER-SIDE PROJECTION over canonical People +
-- Companies — never an authoritative `marketing_contacts` table. Everything here
-- is additive and non-destructive; no existing table is altered.
--
-- Design rules honoured (see docs/product/marketing-crm/IMPLEMENTATION_LEDGER.md):
--  - People/Companies remain the identity source of truth. Marketing state hangs
--    off canonical `people` via person_id FKs; it never duplicates a Person.
--  - Tenant-scoped: every row carries tenant_id; ALL writes are service-role.
--  - MODULE ACCESS IS STRUCTURAL: protected Marketing tables are readable only by
--    users the CANONICAL DB RESOLVER (`marketing_effective_permissions`) grants
--    `marketing.view` — role defaults are DATA (`marketing_role_defaults`), explicit
--    per-user grants add, explicit deny overrides remove, tenant `marketing_enabled`
--    gates everything, and any unresolved state fails CLOSED. Hiding navigation is
--    never authorization; this resolver is the single authority and is shared by
--    RLS policies and the marketing-access Edge Function alike.
--  - TENANT CONSISTENCY IS STRUCTURAL: `marketing_tenant_guard()` triggers (the
--    repo's canonical pattern — cf. automation_vertical_tenant_guard) reject any
--    row whose person/company/tag/segment/contact-point/profile references belong
--    to a different tenant, so even a service-role bug cannot create cross-tenant
--    lineage.
--  - CONTACT-POINT SEMANTICS: the same normalized endpoint MAY be linked to more
--    than one Person (household phone, shared office number, family inbox) — shared
--    endpoints are explicit evidence for identity review, never a forced merge or a
--    failed insert. One Person cannot hold the same endpoint twice, and at most one
--    endpoint per (person, channel) is primary. Scalar people.primary_email/phone
--    remain the canonical fast path until a governed backfill projects them here;
--    contact_points is additive evidence, not a replacement, until that lands.
--  - Suppression FAILS CLOSED and is idempotent for destination-, person- AND
--    contact-point-scoped records (nullable destinations cannot duplicate).
--  - Consent/preference is APPEND-ONLY history, distinct from identity and from
--    hard suppression.
--  - Platform lifecycle defaults use the repo's established template convention
--    (`tenant_id is null` = platform template, exactly like import_profiles) and
--    are materialised per tenant by the service-role-only RPC
--    `marketing_materialise_defaults` — tenant configuration data, never
--    hard-coded behaviour. Universal defaults are tenant-neutral (timezone UTC —
--    a tenant's real timezone, e.g. Drummonds' Europe/London, is tenant data set
--    through Settings, not a schema default).
--  - Reuses set_updated_at() (Phone-0), current_tenant_id() (Security-2), tenants,
--    people, companies, profiles, audit_logs.
--
-- NO external side effects, NO delivery, NO automation capability, NO provider
-- scope change are introduced here (those are Phase 4+). These tables are inert
-- foundations.
--
-- Rollback (reverse order of dependencies):
--   drop function if exists marketing_materialise_defaults(uuid, uuid);
--   drop function if exists marketing_has_permission(text);
--   drop function if exists marketing_current_user_permissions();
--   drop function if exists marketing_effective_permissions(uuid);
--   drop function if exists marketing_tenant_guard() cascade;
--   drop function if exists marketing_preferences_append_only() cascade;
--   drop table if exists marketing_access_grants;
--   drop table if exists marketing_role_defaults;
--   drop table if exists marketing_permissions;
--   drop table if exists marketing_campaigns;
--   drop table if exists marketing_segments;
--   drop table if exists contact_tag_assignments;
--   drop table if exists marketing_tags;
--   drop table if exists contact_suppressions;
--   drop table if exists communication_preferences;
--   drop table if exists contact_relationships;
--   drop table if exists contact_points;
--   drop table if exists marketing_lifecycle_stages;
--   drop table if exists marketing_settings;

-- ===========================================================================
-- marketing_settings — one current row per tenant. Versioned (version bump on
-- change) + audited at the write path. Materialised per tenant by the
-- marketing_materialise_defaults RPC (owner/admin-triggered, service-role-run).
-- ===========================================================================
create table if not exists marketing_settings (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references tenants (id) on delete cascade,
  marketing_enabled           boolean not null default true,
  -- true = every discovered Person is a Contact; false = only classified/eligible.
  include_all_discovered      boolean not null default true,
  default_relationship_type   text not null default 'lead',
  default_lifecycle_stage_key text not null default 'new_lead',
  -- Universal safe default. A tenant's real timezone is CONFIGURATION DATA set in
  -- Settings (Phase 3) — never a universal schema assumption.
  timezone                    text not null default 'UTC',
  -- Quiet hours in tenant timezone (0–23, null = no window configured).
  quiet_hours_start           int check (quiet_hours_start is null or quiet_hours_start between 0 and 23),
  quiet_hours_end             int check (quiet_hours_end is null or quiet_hours_end between 0 and 23),
  default_sender_profile_id   uuid,                       -- Phase 4 (sender profiles)
  tracking_enabled            boolean not null default false,
  reply_handling              text not null default 'workspace'
                                check (reply_handling in ('workspace', 'none')),
  unsubscribe_footer          jsonb not null default '{}'::jsonb,   -- company info for footer
  notification_routing        jsonb not null default '{}'::jsonb,
  settings                    jsonb not null default '{}'::jsonb,   -- forward-compatible bag
  version                     int not null default 1,
  updated_by                  uuid,                       -- profiles.id of last editor
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (tenant_id)
);
create index if not exists marketing_settings_tenant_idx on marketing_settings (tenant_id);
drop trigger if exists marketing_settings_set_updated_at on marketing_settings;
create trigger marketing_settings_set_updated_at
  before update on marketing_settings for each row execute function set_updated_at();
-- Self-upgrade over the earlier local draft (which defaulted Europe/London).
alter table marketing_settings alter column timezone set default 'UTC';

-- ===========================================================================
-- marketing_lifecycle_stages — tenant-configurable pipeline stages. Platform
-- TEMPLATE rows use the repo's established convention `tenant_id is null`
-- (exactly like import_profiles' platform-default profiles) and are copied into
-- a tenant by the materialisation RPC. Template rows are service-role-writable
-- only (no client write policies exist on any marketing table), tenant reads
-- filter on their own tenant_id for operational rows, and retiring/renaming a
-- tenant stage never touches the template. A stage is never hard-deleted
-- (history preserved); `active` retires it.
-- ===========================================================================
create table if not exists marketing_lifecycle_stages (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references tenants (id) on delete cascade,   -- null = platform template
  stage_key        text not null,                                    -- stable id, e.g. 'new_lead'
  label            text not null,
  tone             text not null default 'neutral'
                     check (tone in ('neutral', 'info', 'positive', 'attention', 'negative')),
  sort_order       int not null default 0,
  active           boolean not null default true,
  -- optional terminal outcome for reporting: won | lost | nurture
  terminal_outcome text check (terminal_outcome is null or terminal_outcome in ('won', 'lost', 'nurture')),
  is_default       boolean not null default false,                   -- default stage for new contacts
  source           text not null default 'openfolk_template',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- one stage_key per tenant (template rows keyed on the null-tenant partial index).
create unique index if not exists mls_tenant_key_uk
  on marketing_lifecycle_stages (tenant_id, stage_key) where tenant_id is not null;
create unique index if not exists mls_template_key_uk
  on marketing_lifecycle_stages (stage_key) where tenant_id is null;
create index if not exists mls_tenant_order_idx
  on marketing_lifecycle_stages (tenant_id, sort_order);
drop trigger if exists mls_set_updated_at on marketing_lifecycle_stages;
create trigger mls_set_updated_at
  before update on marketing_lifecycle_stages for each row execute function set_updated_at();

-- ===========================================================================
-- contact_points — canonical multi-value contact endpoints for a Person. This is
-- a PLATFORM primitive (not marketing-only): the customer identity model had only
-- scalar people.primary_email/phone. Shape mirrors the staff-side
-- communication_endpoints (channel / kind / normalized_value / verification /
-- provenance).
--
-- IDENTITY SEMANTICS (deliberate): uniqueness is per (tenant, person, channel,
-- value) — the SAME endpoint may legitimately attach to SEVERAL People (household
-- phone, reception number, family inbox). A shared endpoint is explicit evidence
-- for the identity-review flow (interaction_match_suggestions), never a silent
-- merge and never an insertion failure. Endpoint lookup stays indexed via the
-- non-unique (tenant, channel, normalized_value) index; a lookup that returns
-- multiple People IS the ambiguity signal identity review consumes.
-- ===========================================================================
create table if not exists contact_points (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants (id) on delete cascade,
  person_id          uuid not null references people (id) on delete cascade,
  channel            text not null default 'email'
                       check (channel in ('email', 'phone', 'sms', 'whatsapp', 'social', 'other')),
  value              text not null,                        -- as observed (display)
  normalized_value   text not null,                        -- lower-case email | E.164 phone | provider id
  label              text,                                 -- 'work', 'mobile', …
  is_primary         boolean not null default false,
  verification_state text not null default 'unverified'
                       check (verification_state in ('unverified', 'verified', 'invalid')),
  source             text not null default 'system',       -- interaction | import | manual | system
  source_record_ref  text,
  last_observed_at   timestamptz,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- Superseded draft index (tenant-wide endpoint exclusivity) — wrong semantics:
-- it forced one Person per endpoint and would have blocked shared numbers/inboxes.
drop index if exists contact_points_value_uk;
-- One Person cannot hold the same endpoint twice.
create unique index if not exists contact_points_person_value_uk
  on contact_points (tenant_id, person_id, channel, normalized_value);
-- At most ONE primary endpoint per (person, channel) — deterministic primary rule.
create unique index if not exists contact_points_primary_uk
  on contact_points (tenant_id, person_id, channel) where is_primary;
-- Endpoint lookup (non-unique: several People may share an endpoint).
create index if not exists contact_points_endpoint_idx
  on contact_points (tenant_id, channel, normalized_value);
create index if not exists contact_points_person_idx on contact_points (tenant_id, person_id);
drop trigger if exists contact_points_set_updated_at on contact_points;
create trigger contact_points_set_updated_at
  before update on contact_points for each row execute function set_updated_at();

-- ===========================================================================
-- contact_relationships — how the tenant currently relates to a Person: type,
-- lifecycle stage, status, owner, source/provenance. Projects onto canonical
-- People; never a duplicate identity. lifecycle_stage_key is a stable key
-- validated by the tenant guard against this tenant's stages (or the platform
-- template, so discovery pipelines can classify before an admin first opens
-- Marketing).
-- ===========================================================================
create table if not exists contact_relationships (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id) on delete cascade,
  person_id            uuid not null references people (id) on delete cascade,
  company_id           uuid references companies (id) on delete set null,
  relationship_type    text not null default 'lead',       -- lead|prospect|customer|former_customer|supplier|partner|commercial|other (tenant-configurable convention)
  lifecycle_stage_key  text not null default 'new_lead',
  status               text not null default 'active'
                         check (status in ('active', 'inactive', 'archived')),
  owner_id             uuid,                                -- profiles.id (tenant-guarded, no FK: avoids auth coupling like customer_cards.owner_id)
  source               text not null default 'system',      -- discovery|import|manual|ad_lead|system
  source_record_ref    text,
  evidence             jsonb not null default '[]'::jsonb,
  metadata             jsonb not null default '{}'::jsonb,
  version              int not null default 1,
  created_by           uuid,
  updated_by           uuid,
  last_activity_at     timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- one active relationship per (tenant, person, relationship_type).
create unique index if not exists contact_rel_active_uk
  on contact_relationships (tenant_id, person_id, relationship_type) where status = 'active';
create index if not exists contact_rel_person_idx on contact_relationships (tenant_id, person_id);
create index if not exists contact_rel_stage_idx on contact_relationships (tenant_id, lifecycle_stage_key);
create index if not exists contact_rel_owner_idx on contact_relationships (tenant_id, owner_id);
create index if not exists contact_rel_company_idx on contact_relationships (tenant_id, company_id);
drop trigger if exists contact_rel_set_updated_at on contact_relationships;
create trigger contact_rel_set_updated_at
  before update on contact_relationships for each row execute function set_updated_at();

-- ===========================================================================
-- communication_preferences — APPEND-ONLY consent/preference history, distinct
-- from identity and from hard suppression. The current state for a (person,
-- channel, topic) is the latest effective row. A raising trigger blocks
-- update/delete so the lawful-basis trail is immutable.
-- ===========================================================================
create table if not exists communication_preferences (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants (id) on delete cascade,
  person_id        uuid not null references people (id) on delete cascade,
  contact_point_id uuid references contact_points (id) on delete set null,
  channel          text not null default 'email'
                     check (channel in ('email', 'phone', 'sms', 'whatsapp', 'social', 'other')),
  topic            text,                                    -- null = all topics on the channel
  state            text not null
                     check (state in ('subscribed', 'unsubscribed', 'unknown', 'not_applicable')),
  source           text not null default 'system',          -- signup|import|unsubscribe_link|manual|system
  lawful_basis     text,                                    -- optional (consent|legitimate_interest|…)
  evidence         jsonb not null default '{}'::jsonb,
  effective_at     timestamptz not null default now(),
  recorded_by      uuid,
  created_at       timestamptz not null default now()
);
create index if not exists comm_pref_person_idx
  on communication_preferences (tenant_id, person_id, channel, effective_at desc);
create index if not exists comm_pref_point_idx on communication_preferences (tenant_id, contact_point_id);

-- ===========================================================================
-- contact_suppressions — HARD suppression ledger. Fail-closed: a live row here
-- excludes the recipient from ALL bulk marketing, checked at audience build and
-- again immediately before delivery (later phases). No bulk-send bypass exists.
-- Append-oriented; a suppression is lifted by setting active=false + lifted_at
-- (history + actor/evidence preserved), never deleted.
--
-- Idempotency covers ALL THREE scopes (a nullable destination can never allow
-- duplicate active suppressions):
--   destination-scoped: one ACTIVE row per (tenant, channel, normalized_value);
--   person-scoped     : one ACTIVE row per (tenant, channel, person) when no
--                       destination/contact-point is recorded — survives endpoint
--                       changes because it suppresses the Person on the channel;
--   contact-point-scoped: one ACTIVE row per (tenant, contact_point).
-- Every suppression must name at least one target.
-- ===========================================================================
create table if not exists contact_suppressions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants (id) on delete cascade,
  person_id        uuid references people (id) on delete cascade,
  contact_point_id uuid references contact_points (id) on delete set null,
  channel          text not null default 'email'
                     check (channel in ('email', 'phone', 'sms', 'whatsapp', 'social', 'other')),
  -- normalized destination captured so suppression survives if the person link changes.
  normalized_value text,
  reason           text not null
                     check (reason in ('unsubscribe', 'manual', 'hard_bounce', 'spam_complaint',
                                       'invalid_destination', 'provider_policy')),
  active           boolean not null default true,
  source           text not null default 'system',
  evidence         jsonb not null default '{}'::jsonb,
  suppressed_at    timestamptz not null default now(),
  lifted_at        timestamptz,
  recorded_by      uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- A suppression must always have a target (no fully-anonymous rows).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'contact_suppressions_target_check'
  ) then
    alter table contact_suppressions add constraint contact_suppressions_target_check
      check (person_id is not null or contact_point_id is not null or normalized_value is not null);
  end if;
end $$;
-- destination-scoped dedup
create unique index if not exists suppression_active_value_uk
  on contact_suppressions (tenant_id, channel, normalized_value)
  where active = true and normalized_value is not null;
-- person-scoped dedup (no destination recorded)
create unique index if not exists suppression_active_person_uk
  on contact_suppressions (tenant_id, channel, person_id)
  where active = true and normalized_value is null and contact_point_id is null
        and person_id is not null;
-- contact-point-scoped dedup
create unique index if not exists suppression_active_point_uk
  on contact_suppressions (tenant_id, contact_point_id)
  where active = true and contact_point_id is not null;
create index if not exists suppression_person_idx on contact_suppressions (tenant_id, person_id);
create index if not exists suppression_active_idx on contact_suppressions (tenant_id, active);
drop trigger if exists suppression_set_updated_at on contact_suppressions;
create trigger suppression_set_updated_at
  before update on contact_suppressions for each row execute function set_updated_at();

-- ===========================================================================
-- marketing_tags — one tenant tag vocabulary. Distinct from source, import and
-- segment (a tag is an explicit classification). Retired via active=false.
-- ===========================================================================
create table if not exists marketing_tags (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  key         text not null,                                -- stable slug
  label       text not null,
  tone        text not null default 'neutral'
                check (tone in ('neutral', 'info', 'positive', 'attention', 'negative')),
  description text,
  active      boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists marketing_tags_key_uk on marketing_tags (tenant_id, key);
create index if not exists marketing_tags_tenant_idx on marketing_tags (tenant_id, active);
drop trigger if exists marketing_tags_set_updated_at on marketing_tags;
create trigger marketing_tags_set_updated_at
  before update on marketing_tags for each row execute function set_updated_at();

-- ===========================================================================
-- contact_tag_assignments — canonical Person↔Tag with actor/source/trigger.
-- ===========================================================================
create table if not exists contact_tag_assignments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  person_id   uuid not null references people (id) on delete cascade,
  tag_id      uuid not null references marketing_tags (id) on delete cascade,
  source      text not null default 'manual',               -- manual|import|segment|automation|system
  trigger_ref text,                                          -- event/segment/import id that caused it
  assigned_by uuid,
  created_at  timestamptz not null default now()
);
create unique index if not exists contact_tag_uk on contact_tag_assignments (tenant_id, person_id, tag_id);
create index if not exists contact_tag_person_idx on contact_tag_assignments (tenant_id, person_id);
create index if not exists contact_tag_tag_idx on contact_tag_assignments (tenant_id, tag_id);

-- ===========================================================================
-- marketing_segments — saved, versioned, validated filter definitions evaluated
-- SERVER-SIDE (Phase 3). Stores an estimated count + evaluation timestamp but the
-- count is never treated as the audience (a launch snapshots server-side).
-- ===========================================================================
create table if not exists marketing_segments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants (id) on delete cascade,
  name              text not null,
  description       text,
  -- validated filter AST (schema validated at the Edge Function, Phase 3).
  definition        jsonb not null default '{}'::jsonb,
  definition_version int not null default 1,
  status            text not null default 'active'
                      check (status in ('active', 'archived')),
  estimated_count   int,
  evaluated_at      timestamptz,
  created_by        uuid,
  updated_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists marketing_segments_tenant_idx on marketing_segments (tenant_id, status);
drop trigger if exists marketing_segments_set_updated_at on marketing_segments;
create trigger marketing_segments_set_updated_at
  before update on marketing_segments for each row execute function set_updated_at();

-- ===========================================================================
-- marketing_campaigns — the campaign umbrella + explicit legal state machine.
-- Foundation only: audience snapshot, approved content version and delivery are
-- Phases 4–5. Illegal transitions are rejected server-side (later); the CHECK
-- pins the allowed vocabulary now.
-- ===========================================================================
create table if not exists marketing_campaigns (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants (id) on delete cascade,
  name               text not null,
  description        text,
  campaign_type      text not null default 'broadcast'
                       check (campaign_type in ('broadcast', 'sequence')),
  status             text not null default 'draft'
                       check (status in ('draft', 'review', 'approved', 'scheduled',
                                         'active', 'paused', 'completed', 'cancelled', 'archived')),
  objective_link_ref text,                                   -- soft ref to objective_links (Phase 7)
  owner_id           uuid,
  sender_profile_id  uuid,                                   -- Phase 4
  segment_id         uuid references marketing_segments (id) on delete set null,
  schedule_at        timestamptz,
  timezone           text,
  metadata           jsonb not null default '{}'::jsonb,
  created_by         uuid,
  approved_by        uuid,
  approved_at        timestamptz,
  launched_by        uuid,
  launched_at        timestamptz,
  paused_at          timestamptz,
  completed_at       timestamptz,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists marketing_campaigns_tenant_status_idx
  on marketing_campaigns (tenant_id, status);
create index if not exists marketing_campaigns_tenant_type_idx
  on marketing_campaigns (tenant_id, campaign_type);
drop trigger if exists marketing_campaigns_set_updated_at on marketing_campaigns;
create trigger marketing_campaigns_set_updated_at
  before update on marketing_campaigns for each row execute function set_updated_at();

-- ===========================================================================
-- marketing_permissions — the platform permission VOCABULARY (like
-- authority_permissions). Public-readable; grants below reference it.
-- ===========================================================================
create table if not exists marketing_permissions (
  permission  text primary key,
  category    text not null,
  description text not null
);
insert into marketing_permissions (permission, category, description) values
  ('marketing.view',            'access',   'View the Marketing module'),
  ('marketing.contacts.manage', 'contacts', 'Create / edit / classify contacts'),
  ('marketing.contacts.import', 'contacts', 'Import contacts'),
  ('marketing.tags.manage',     'contacts', 'Manage tags and segments'),
  ('marketing.campaigns.draft', 'campaigns','Draft campaigns and templates'),
  ('marketing.campaigns.test',  'campaigns','Send test messages'),
  ('marketing.campaigns.launch','campaigns','Schedule / launch / pause campaigns'),
  ('marketing.senders.manage',  'delivery', 'Manage sender settings'),
  ('marketing.ads.manage',      'ads',      'Manage Ads connectors / sources'),
  ('marketing.reporting.view',  'reporting','View Marketing reporting'),
  ('marketing.access.manage',   'admin',    'Manage who has Marketing access')
on conflict (permission) do nothing;

-- ===========================================================================
-- marketing_role_defaults — role → default permissions as DATA (the single
-- source of truth; the Edge Function and any client mirror are consumers, not
-- authorities). Safe defaults per the brief: owner/admin full; ops a working
-- subset without launch/senders/ads/access-management; viewer nothing until
-- explicitly granted.
-- ===========================================================================
create table if not exists marketing_role_defaults (
  role        text not null,
  permission  text not null references marketing_permissions (permission) on delete cascade,
  primary key (role, permission)
);
insert into marketing_role_defaults (role, permission)
  select r, p from (values
    ('owner'), ('admin')
  ) roles(r)
  cross join (select permission as p from marketing_permissions) perms
on conflict do nothing;
insert into marketing_role_defaults (role, permission) values
  ('ops', 'marketing.view'),
  ('ops', 'marketing.contacts.manage'),
  ('ops', 'marketing.contacts.import'),
  ('ops', 'marketing.tags.manage'),
  ('ops', 'marketing.campaigns.draft'),
  ('ops', 'marketing.campaigns.test'),
  ('ops', 'marketing.reporting.view')
on conflict do nothing;
-- viewer: intentionally no rows.

-- ===========================================================================
-- marketing_access_grants — per-user (profile) Marketing grants layered ON TOP
-- of role defaults. granted=false is an explicit DENY override that removes a
-- role default. Resolved ONLY by marketing_effective_permissions below.
-- ===========================================================================
create table if not exists marketing_access_grants (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id) on delete cascade,
  profile_id     uuid not null references profiles (id) on delete cascade,
  permission     text not null references marketing_permissions (permission),
  granted        boolean not null default true,             -- false = explicit deny override
  granted_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists marketing_grant_uk
  on marketing_access_grants (tenant_id, profile_id, permission);
create index if not exists marketing_grant_profile_idx
  on marketing_access_grants (tenant_id, profile_id);
drop trigger if exists marketing_grant_set_updated_at on marketing_access_grants;
create trigger marketing_grant_set_updated_at
  before update on marketing_access_grants for each row execute function set_updated_at();

-- ===========================================================================
-- Platform lifecycle-stage TEMPLATE (tenant_id null — the import_profiles
-- convention). Materialised per tenant by marketing_materialise_defaults. These
-- are DEFAULTS (configuration data), not code — a tenant may rename/reorder/
-- retire its own copies; the template itself is service-role-writable only.
-- ===========================================================================
insert into marketing_lifecycle_stages
  (tenant_id, stage_key, label, tone, sort_order, active, terminal_outcome, is_default, source)
values
  (null, 'new_lead',          'New lead',       'info',     10, true, null,      true,  'openfolk_template'),
  (null, 'contact_attempted', 'Contact attempted','neutral',20, true, null,      false, 'openfolk_template'),
  (null, 'engaged',           'Engaged',        'info',     30, true, null,      false, 'openfolk_template'),
  (null, 'qualified',         'Qualified',      'positive', 40, true, null,      false, 'openfolk_template'),
  (null, 'survey_quote',      'Survey / quote', 'attention',50, true, null,      false, 'openfolk_template'),
  (null, 'won',               'Won',            'positive', 60, true, 'won',     false, 'openfolk_template'),
  (null, 'nurture',           'Nurture',        'neutral',  70, true, 'nurture', false, 'openfolk_template'),
  (null, 'lost',              'Lost',           'negative', 80, true, 'lost',    false, 'openfolk_template')
on conflict do nothing;

-- ===========================================================================
-- CANONICAL PERMISSION RESOLVER — the ONE authority for "what Marketing
-- permissions does this profile hold". Fail-closed at every step:
--   no profile / no tenant            → nothing;
--   marketing disabled for the tenant → nothing;
--   otherwise role defaults (data) + explicit grants − explicit denies.
-- A missing marketing_settings row is a DEFINITE state (the declared default,
-- enabled) — a query ERROR, by contrast, aborts the caller entirely, which is
-- the fail-closed behaviour we want inside RLS.
-- Consumed by: RLS policies (via marketing_has_permission), the marketing-access
-- Edge Function (via RPC), and tests. Do not re-implement this logic elsewhere.
-- ===========================================================================
create or replace function marketing_effective_permissions(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_role text;
  v_enabled boolean;
  v_settings_exists boolean := false;
  v_perms text[];
begin
  if p_profile_id is null then
    return jsonb_build_object('found', false, 'enabled', false,
                              'settings_exists', false, 'permissions', '[]'::jsonb);
  end if;

  select tenant_id, role into v_tenant, v_role from profiles where id = p_profile_id;
  if v_tenant is null then
    return jsonb_build_object('found', false, 'enabled', false,
                              'settings_exists', false, 'permissions', '[]'::jsonb);
  end if;

  select marketing_enabled into v_enabled from marketing_settings where tenant_id = v_tenant;
  v_settings_exists := found;
  if not v_settings_exists then
    v_enabled := true; -- declared schema default: enabled until configured otherwise
  end if;

  if not coalesce(v_enabled, false) then
    return jsonb_build_object('found', true, 'enabled', false,
                              'settings_exists', v_settings_exists, 'permissions', '[]'::jsonb);
  end if;

  select coalesce(array_agg(p order by p), '{}') into v_perms from (
    select rd.permission as p
      from marketing_role_defaults rd
     where rd.role = v_role
    union
    select g.permission
      from marketing_access_grants g
     where g.tenant_id = v_tenant and g.profile_id = p_profile_id and g.granted
    except
    select g.permission
      from marketing_access_grants g
     where g.tenant_id = v_tenant and g.profile_id = p_profile_id and not g.granted
  ) s(p);

  return jsonb_build_object('found', true, 'enabled', true,
                            'settings_exists', v_settings_exists,
                            'permissions', to_jsonb(v_perms));
end $$;

-- SELF-ONLY authenticated wrapper: resolves the CALLING user's permissions and
-- accepts NO caller-supplied profile id, so an authenticated user can never
-- inspect another profile's permission set, enabled state or settings-existence
-- state. This wrapper (not the internal resolver) is the only authenticated
-- execution path; it delegates to the one canonical resolver above (a SECURITY
-- DEFINER function runs as its owner, so the service-role-only grant on the
-- internal resolver does not block this delegation — and no logic is duplicated).
create or replace function marketing_current_user_permissions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select marketing_effective_permissions(auth.uid());
$$;

-- RLS-facing wrapper: does the CALLING user hold a Marketing permission?
-- STABLE + constant arguments → evaluated once per statement (InitPlan), not per
-- row. Fail-closed: unauthenticated or unresolved ⇒ false.
create or replace function marketing_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (marketing_current_user_permissions() -> 'permissions') ? p_permission,
    false
  );
$$;

-- Grant boundary: the ARBITRARY-PROFILE resolver is service-role only (the
-- marketing-access Edge Function's path); authenticated users get exactly the
-- self-only wrapper + the RLS predicate; anon gets nothing.
revoke all on function marketing_effective_permissions(uuid) from public, anon, authenticated;
grant execute on function marketing_effective_permissions(uuid) to service_role;
revoke all on function marketing_current_user_permissions() from public, anon;
grant execute on function marketing_current_user_permissions() to authenticated, service_role;
revoke all on function marketing_has_permission(text) from public, anon;
grant execute on function marketing_has_permission(text) to authenticated, service_role;

-- ===========================================================================
-- GOVERNED MATERIALISATION — service-role-only RPC that copies platform
-- defaults into a tenant (settings row + lifecycle stages). Idempotent and
-- race-safe: unique conflicts (the EXPECTED concurrent-first-call case) are
-- absorbed; every other error propagates to the caller. The Edge Function
-- invokes this ONLY for owner/admin callers — merely checking access never
-- mutates tenant configuration. Audits directly into audit_logs.
-- ===========================================================================
create or replace function marketing_materialise_defaults(p_tenant uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created_settings boolean := false;
  v_created_stages int := 0;
  v_actor text;
  v_actor_tenant uuid;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = 'null_value_not_allowed';
  end if;

  -- Actor integrity: when a Profile UUID is supplied it must belong to THIS
  -- tenant (tenantless profiles are never tenant actors — see the tenant-guard
  -- rationale). A null actor means a genuine system action, attributed as
  -- 'service' in the audit trail.
  if p_actor is not null then
    select tenant_id into v_actor_tenant from profiles where id = p_actor;
    if not found or v_actor_tenant is distinct from p_tenant then
      raise exception 'actor must be a profile of the target tenant'
        using errcode = 'integrity_constraint_violation';
    end if;
  end if;

  begin
    insert into marketing_settings (tenant_id) values (p_tenant);
    v_created_settings := true;
  exception when unique_violation then
    v_created_settings := false; -- concurrent/prior materialisation: expected
  end;

  if not exists (select 1 from marketing_lifecycle_stages where tenant_id = p_tenant) then
    begin
      insert into marketing_lifecycle_stages
        (tenant_id, stage_key, label, tone, sort_order, active, terminal_outcome, is_default, source)
      select p_tenant, t.stage_key, t.label, t.tone, t.sort_order, t.active,
             t.terminal_outcome, t.is_default, 'openfolk_template'
        from marketing_lifecycle_stages t
       where t.tenant_id is null;
      get diagnostics v_created_stages = row_count;
    exception when unique_violation then
      v_created_stages := 0; -- concurrent copy already ran: expected
    end;
  end if;

  if v_created_settings or v_created_stages > 0 then
    v_actor := coalesce((select email from profiles where id = p_actor), p_actor::text, 'service');
    insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
    values (p_tenant, v_actor, 'marketing.defaults.materialised', 'marketing_settings', null, 'ok',
            jsonb_build_object('created_settings', v_created_settings,
                               'created_stages', v_created_stages));
  end if;

  return jsonb_build_object('created_settings', v_created_settings,
                            'created_stages', v_created_stages);
end $$;

revoke all on function marketing_materialise_defaults(uuid, uuid) from public, anon, authenticated;
grant execute on function marketing_materialise_defaults(uuid, uuid) to service_role;

-- ===========================================================================
-- STRUCTURAL TENANT CONSISTENCY — canonical trigger pattern (cf.
-- automation_vertical_tenant_guard). Every cross-row reference must belong to
-- the row's tenant, so even a service-role bug cannot create cross-tenant
-- lineage. Profile references (owner/actor columns) must name an existing
-- profile in the SAME tenant only — tenantless/platform profiles are rejected
-- (platform authority confers no tenant-data actorship; see the guard body).
-- ===========================================================================
create or replace function marketing_tenant_guard() returns trigger
language plpgsql
as $$
declare
  -- One trigger function guards tables with DIFFERENT row shapes, so every field
  -- access goes through jsonb (a plpgsql `new.<col>` expression fails to compile
  -- on tables lacking the column, even in a non-taken branch of one expression).
  row_j jsonb := to_jsonb(new);
  row_tenant uuid := (row_j ->> 'tenant_id')::uuid;
  ref uuid;
  v uuid;
  col text;
begin
  -- person reference
  ref := (row_j ->> 'person_id')::uuid;
  if ref is not null then
    select tenant_id into v from people where id = ref;
    if v is distinct from row_tenant then
      raise exception 'cross-tenant person reference' using errcode = 'integrity_constraint_violation';
    end if;
  end if;

  -- company reference
  ref := (row_j ->> 'company_id')::uuid;
  if ref is not null then
    select tenant_id into v from companies where id = ref;
    if v is distinct from row_tenant then
      raise exception 'cross-tenant company reference' using errcode = 'integrity_constraint_violation';
    end if;
  end if;

  -- contact-point reference
  ref := (row_j ->> 'contact_point_id')::uuid;
  if ref is not null then
    select tenant_id into v from contact_points where id = ref;
    if v is distinct from row_tenant then
      raise exception 'cross-tenant contact-point reference' using errcode = 'integrity_constraint_violation';
    end if;
  end if;

  -- tag reference
  ref := (row_j ->> 'tag_id')::uuid;
  if ref is not null then
    select tenant_id into v from marketing_tags where id = ref;
    if v is distinct from row_tenant then
      raise exception 'cross-tenant tag reference' using errcode = 'integrity_constraint_violation';
    end if;
  end if;

  -- segment reference
  ref := (row_j ->> 'segment_id')::uuid;
  if ref is not null then
    select tenant_id into v from marketing_segments where id = ref;
    if v is distinct from row_tenant then
      raise exception 'cross-tenant segment reference' using errcode = 'integrity_constraint_violation';
    end if;
  end if;

  -- lifecycle stage key must exist for this tenant (or as a platform template,
  -- so discovery pipelines can classify before first materialisation)
  if tg_table_name = 'contact_relationships' then
    if not exists (
      select 1 from marketing_lifecycle_stages s
       where s.stage_key = row_j ->> 'lifecycle_stage_key'
         and (s.tenant_id = row_tenant or s.tenant_id is null)
    ) then
      raise exception 'unknown lifecycle stage for tenant' using errcode = 'integrity_constraint_violation';
    end if;
  end if;

  -- profile-reference columns (owner/actor): when a Profile UUID is supplied it
  -- must name an existing Profile IN THE SAME TENANT. A tenantless profile is
  -- NEVER acceptable here: per the platform-authority model
  -- (20260822120000_platform_authority_decoupled_from_role.sql) a null tenant_id
  -- alone is no authority at all, and even an active platform.controlplane grant
  -- deliberately confers Control Plane access ONLY — never tenant-data actorship.
  -- System/service actions leave these nullable columns NULL and are attributed
  -- through the canonical audit mechanism (audit_logs.actor / source columns),
  -- not a fabricated tenantless human Profile. A future OpenFolk cross-tenant
  -- Marketing operation must arrive as an explicit permissioned capability, not
  -- a trigger exception.
  foreach col in array array['owner_id','created_by','updated_by','recorded_by',
                             'assigned_by','approved_by','launched_by',
                             'profile_id','granted_by']
  loop
    if row_j ? col then
      ref := (row_j ->> col)::uuid;
      if ref is not null then
        select tenant_id into v from profiles where id = ref;
        if not found then
          raise exception 'unknown profile reference in %', col
            using errcode = 'integrity_constraint_violation';
        end if;
        if v is distinct from row_tenant then
          raise exception 'cross-tenant profile reference in %', col
            using errcode = 'integrity_constraint_violation';
        end if;
      end if;
    end if;
  end loop;

  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'contact_points', 'contact_relationships', 'communication_preferences',
    'contact_suppressions', 'contact_tag_assignments', 'marketing_campaigns',
    'marketing_access_grants', 'marketing_settings', 'marketing_tags', 'marketing_segments'
  ] loop
    execute format('drop trigger if exists %I on %I;', t || '_tenant_guard', t);
    execute format(
      'create trigger %I before insert or update on %I
         for each row execute function marketing_tenant_guard();',
      t || '_tenant_guard', t);
  end loop;
end $$;

-- ===========================================================================
-- RLS — STRUCTURAL MODULE ACCESS. Tenant scoping alone is NOT authorization for
-- Marketing-domain data: every protected table additionally requires the caller
-- to hold `marketing.view` via the canonical resolver (explicit deny and tenant
-- disablement therefore revoke direct reads too — the hidden-navigation bypass
-- is closed at the database). Writes remain service-role-only everywhere (no
-- client write policies exist). Vocabulary tables (marketing_permissions,
-- marketing_role_defaults) stay readable to all authenticated users, matching
-- authority_permissions. Access grants are visible only to access managers.
-- ===========================================================================
do $$
declare
  t text;
  view_gated text[] := array[
    'marketing_settings', 'contact_points', 'contact_relationships',
    'communication_preferences', 'contact_suppressions', 'marketing_tags',
    'contact_tag_assignments', 'marketing_segments', 'marketing_campaigns'
  ];
begin
  foreach t in array view_gated loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I on %I;', t || '_select_tenant', t);
    execute format(
      'create policy %I on %I for select to authenticated
         using (tenant_id = current_tenant_id() and marketing_has_permission(''marketing.view''));',
      t || '_select_tenant', t);
    execute format('grant select on %I to authenticated;', t);
    execute format('grant select, insert, update, delete on %I to service_role;', t);
  end loop;

  -- Preferences are append-only even for the service role at the SQL layer below;
  -- correct the writable grant set for it (select+insert only).
  execute 'revoke update, delete on communication_preferences from service_role;';

  -- Lifecycle stages: tenant rows OR platform template rows, still view-gated.
  execute 'alter table marketing_lifecycle_stages enable row level security;';
  execute 'drop policy if exists marketing_lifecycle_stages_select on marketing_lifecycle_stages;';
  execute 'create policy marketing_lifecycle_stages_select on marketing_lifecycle_stages
             for select to authenticated
             using ((tenant_id is null or tenant_id = current_tenant_id())
                    and marketing_has_permission(''marketing.view''));';
  execute 'grant select on marketing_lifecycle_stages to authenticated;';
  execute 'grant select, insert, update, delete on marketing_lifecycle_stages to service_role;';

  -- Access grants: only access managers may read them.
  execute 'alter table marketing_access_grants enable row level security;';
  execute 'drop policy if exists marketing_access_grants_select_tenant on marketing_access_grants;';
  execute 'create policy marketing_access_grants_select_tenant on marketing_access_grants
             for select to authenticated
             using (tenant_id = current_tenant_id()
                    and marketing_has_permission(''marketing.access.manage''));';
  execute 'grant select on marketing_access_grants to authenticated;';
  execute 'grant select, insert, update, delete on marketing_access_grants to service_role;';

  -- Permission vocabulary + role defaults: platform-wide read (like authority_permissions).
  execute 'alter table marketing_permissions enable row level security;';
  execute 'drop policy if exists marketing_permissions_select on marketing_permissions;';
  execute 'create policy marketing_permissions_select on marketing_permissions
             for select to authenticated using (true);';
  execute 'grant select on marketing_permissions to authenticated;';
  execute 'grant select, insert, update, delete on marketing_permissions to service_role;';

  execute 'alter table marketing_role_defaults enable row level security;';
  execute 'drop policy if exists marketing_role_defaults_select on marketing_role_defaults;';
  execute 'create policy marketing_role_defaults_select on marketing_role_defaults
             for select to authenticated using (true);';
  execute 'grant select on marketing_role_defaults to authenticated;';
  execute 'grant select, insert, update, delete on marketing_role_defaults to service_role;';
end $$;

-- ===========================================================================
-- Append-only guard for communication_preferences (record a new row instead of
-- mutating history — the lawful-basis trail is immutable).
-- ===========================================================================
create or replace function marketing_preferences_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'communication_preferences is append-only (record a new preference row instead)';
end $$;

drop trigger if exists comm_pref_append_only on communication_preferences;
create trigger comm_pref_append_only
  before update or delete on communication_preferences
  for each row execute function marketing_preferences_append_only();
