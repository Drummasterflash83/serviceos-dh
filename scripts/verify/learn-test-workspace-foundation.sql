-- TEST-only missing read-model tables from original migrations. Production already
-- has these foundations. No access grants, source copies, schedules or provider calls.
create extension if not exists btree_gist with schema extensions;
create unique index if not exists team_members_id_tenant_uk on public.team_members(id,tenant_id);
create unique index if not exists org_units_id_tenant_uk on public.org_units(id,tenant_id);
create table if not exists member_integration_identities (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  team_member_id     uuid not null,
  provider           text not null,   -- google_workspace|microsoft365|slack|voip|commusoft|other
  identity_kind      text not null default 'user' check (identity_kind in ('user','service','shared')),
  external_ref       text not null,   -- provider account id
  display            text,
  primary_login      text,            -- email/username (NEVER a secret)
  provider_metadata  jsonb not null default '{}',
  verification_state text not null default 'unverified'
                       check (verification_state in ('unverified','verified','rejected','conflicted')),
  confidence         numeric check (confidence is null or (confidence between 0 and 1)),
  source             text not null default 'openfolk',
  effective_from     timestamptz not null default now(),
  effective_to       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Identity's tenant must match its team member's tenant (declarative).
  constraint mii_member_same_tenant
    foreign key (team_member_id, tenant_id) references team_members (id, tenant_id) on delete cascade
);
create index if not exists mii_member on member_integration_identities (tenant_id, team_member_id);
create index if not exists mii_lookup on member_integration_identities (tenant_id, provider, external_ref);
-- One ACTIVE user-identity per (tenant, provider, external_ref): a person account can't
-- be exclusively assigned to two members. Shared/service identities are exempt.
create unique index if not exists mii_active_user_uk
  on member_integration_identities (tenant_id, provider, external_ref)
  where effective_to is null and identity_kind = 'user';
drop trigger if exists mii_set_updated_at on member_integration_identities;
create trigger mii_set_updated_at before update on member_integration_identities
  for each row execute function set_updated_at();

-- ── Canonical cross-channel communication endpoints. ────────────────────────
create table if not exists communication_endpoints (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  channel               text not null,   -- phone|email|slack|other
  endpoint_kind         text not null,   -- email|email_alias|shared_mailbox|group_address|
                                         -- slack_user|slack_channel|ddi|extension|queue|
                                         -- ring_group|voicemail|sip|other
  normalized_value      text not null,   -- E.164 | lower-case email | provider id | norm. ext
  display_value         text,
  provider              text,
  provider_external_ref text,            -- e.g. telephony_inventory.provider_object_id / mailbox id
  is_shared             boolean not null default false,
  status                text not null default 'active' check (status in ('active','inactive')),
  source                text not null default 'openfolk',
  source_object_ref     text,            -- telephony_inventory.id / google_workspace_mailboxes.id
  metadata              jsonb not null default '{}',
  effective_from        timestamptz not null default now(),
  effective_to          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Tenant-safe composite key so ownership can FK (endpoint_id, tenant_id).
  unique (id, tenant_id)
);
create index if not exists ce_tenant on communication_endpoints (tenant_id, channel, endpoint_kind);
-- Dedup: one ACTIVE endpoint per provider external id, and per normalized value/kind.
create unique index if not exists ce_active_provider_uk
  on communication_endpoints (tenant_id, provider, provider_external_ref)
  where status = 'active' and provider_external_ref is not null;
create unique index if not exists ce_active_value_uk
  on communication_endpoints (tenant_id, channel, endpoint_kind, normalized_value)
  where status = 'active';
drop trigger if exists ce_set_updated_at on communication_endpoints;
create trigger ce_set_updated_at before update on communication_endpoints
  for each row execute function set_updated_at();

-- ── Effective-dated endpoint ownership. ─────────────────────────────────────
create table if not exists endpoint_ownership_assignments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  endpoint_id       uuid not null,
  owner_kind        text not null check (owner_kind in ('person','team','role','shared')),
  owner_member_id   uuid,
  owner_org_unit_id uuid,
  owner_role        text,
  assignment_role   text not null check (assignment_role in ('accountable','primary_handler','cover','escalation')),
  exclusive         boolean not null default true,
  effective_from    timestamptz not null default now(),
  effective_to      timestamptz,
  confidence        numeric check (confidence is null or (confidence between 0 and 1)),
  provenance        text not null default 'openfolk',
  review_state      text not null default 'proposed' check (review_state in ('proposed','confirmed','conflicted','rejected')),
  reason            text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Endpoint + all owner refs must be in the SAME tenant (declarative).
  constraint eoa_endpoint_same_tenant
    foreign key (endpoint_id, tenant_id) references communication_endpoints (id, tenant_id) on delete cascade,
  constraint eoa_member_same_tenant
    foreign key (owner_member_id, tenant_id) references team_members (id, tenant_id) on delete set null,
  constraint eoa_org_same_tenant
    foreign key (owner_org_unit_id, tenant_id) references org_units (id, tenant_id) on delete set null,
  -- EXACTLY the applicable owner reference must be set for the kind — no missing owner,
  -- no incompatible/multiple owners. (Cross-tenant owners are rejected by the FKs above.)
  constraint eoa_owner_ref_matches_kind check (
    (owner_kind = 'person' and owner_member_id is not null and owner_org_unit_id is null and owner_role is null) or
    (owner_kind = 'team'   and owner_org_unit_id is not null and owner_member_id is null and owner_role is null) or
    (owner_kind = 'role'   and owner_role is not null       and owner_member_id is null and owner_org_unit_id is null) or
    (owner_kind = 'shared' and owner_member_id is null and owner_org_unit_id is null and owner_role is null)
  )
);
create index if not exists eoa_endpoint on endpoint_ownership_assignments (tenant_id, endpoint_id, assignment_role);
create index if not exists eoa_member on endpoint_ownership_assignments (tenant_id, owner_member_id);
-- TRUE temporal non-overlap for the EXCLUSIVE accountable owner of an endpoint: no two
-- exclusive-accountable assignments may have overlapping effective windows. (Non-exclusive
-- / non-accountable roles — cover, escalation, shared — may coexist.) Uses btree_gist.
alter table endpoint_ownership_assignments drop constraint if exists eoa_no_overlap_accountable;
alter table endpoint_ownership_assignments add constraint eoa_no_overlap_accountable
  exclude using gist (
    endpoint_id with =,
    tstzrange(effective_from, coalesce(effective_to, 'infinity'::timestamptz)) with &&
  ) where (assignment_role = 'accountable' and exclusive and review_state <> 'rejected');
drop trigger if exists eoa_set_updated_at on endpoint_ownership_assignments;
create trigger eoa_set_updated_at before update on endpoint_ownership_assignments
  for each row execute function set_updated_at();

-- ── Responsibility handoffs (append-only evidence of movement). ─────────────
create table if not exists responsibility_handoffs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  subject_type       text,             -- interaction|commitment|endpoint
  subject_ref        text,
  source_endpoint_id uuid references communication_endpoints(id) on delete set null,
  from_party         jsonb,            -- {kind:'person|team|role|external', ref}
  to_party           jsonb,
  from_endpoint_id   uuid references communication_endpoints(id) on delete set null,
  to_endpoint_id     uuid references communication_endpoints(id) on delete set null,
  handoff_type       text not null check (handoff_type in (
                        'phone_transfer','call_pickup','queue_route','voicemail_route',
                        'email_forward','mailbox_delegation','slack_handoff','commitment_delegation')),
  occurred_at        timestamptz,
  observed_state     text not null default 'observed' check (observed_state in ('observed','confirmed','rejected')),
  reason             text,
  evidence           jsonb not null default '{}',
  provider_event_ref text,
  confidence         numeric check (confidence is null or (confidence between 0 and 1)),
  provenance         text not null default 'observed',
  actor              text,             -- set when human-confirmed
  created_at         timestamptz not null default now()
);
create index if not exists rh_tenant on responsibility_handoffs (tenant_id, occurred_at desc);
create index if not exists rh_subject on responsibility_handoffs (tenant_id, subject_type, subject_ref);

create table if not exists telephony_inventory (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  provider           text not null,
  provider_object_id text not null,                  -- provider's id/URI (opaque)
  canonical_type     text not null,
    -- provider_account|trunk|ddi|sip_identity|endpoint|extension|device|user
    -- |ring_group|hunt_group|queue|pickup_group|voicemail_route|transfer_route
  label              text,
  parent_object_id   text,
  status             text not null default 'active',  -- active|inactive
  discovery_source   text not null default 'call_metadata',
  provisioning_state text not null default 'discovered', -- discovered|configured|manual
  confidence         numeric not null default 1.0,
  capabilities       jsonb not null default '{}'::jsonb,
  provider_metadata  jsonb not null default '{}'::jsonb, -- safe reference only, no secrets
  first_seen         timestamptz not null default now(),
  last_seen          timestamptz not null default now(),
  synced_at          timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- Idempotent discovery: one row per (tenant, provider, provider_object_id).
create unique index if not exists telephony_inventory_object_uk
  on telephony_inventory (tenant_id, provider, provider_object_id);
create index if not exists telephony_inventory_tenant_type_idx
  on telephony_inventory (tenant_id, canonical_type) where status = 'active';

create table if not exists endpoint_identity_reviews (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  endpoint_id    uuid not null,
  decision       text not null
                   check (decision in ('confirmed_person','shared','system','rejected','unresolved')),
  team_member_id uuid,                              -- set for confirmed_person / rejected(of a person)
  confidence     text,                              -- high|medium|low|unresolved (from the suggestion)
  evidence       jsonb not null default '{}',
  reason         text,
  actor          text not null,
  correlation_id text,
  created_at     timestamptz not null default now(),
  constraint eir_endpoint_same_tenant
    foreign key (endpoint_id, tenant_id) references communication_endpoints (id, tenant_id) on delete cascade
);
create index if not exists eir_endpoint on endpoint_identity_reviews (endpoint_id, created_at desc);

create table if not exists health_types (health_type text primary key, label text);
insert into health_types (health_type, label) values
  ('customer_health','Customer Health')
on conflict (health_type) do nothing;

-- The canonical subject KINDS a Health Object may point at. Free of person/company
-- data — just the entity table the subject_id refers to.
create table if not exists health_subject_types (subject_type text primary key, label text);
insert into health_subject_types (subject_type, label) values
  ('company','Company (companies)'),
  ('person','Person (people)'),
  ('customer_card','Customer Card (customer_cards)')
on conflict (subject_type) do nothing;

create table if not exists health_objects (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  health_type              text not null references health_types(health_type),
  subject_type             text not null references health_subject_types(subject_type),
  subject_id               uuid not null,
  active_policy_version_id uuid references config_versions(id),
  -- Optional current accountable pointer (a responsibility ref, e.g. a team/queue).
  -- It is a small reference, NEVER a copy of person/company data.
  accountable_ref          jsonb,
  mode                     text not null default 'shadow' check (mode in ('shadow','live')),
  attributes               jsonb not null default '{}',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- IDENTITY: one Health Object per (tenant, health_type, subject).
  unique (tenant_id, health_type, subject_type, subject_id)
);
create index if not exists health_objects_tenant on health_objects (tenant_id, health_type);
create index if not exists health_objects_subject on health_objects (tenant_id, subject_type, subject_id);
drop trigger if exists health_objects_set_updated_at on health_objects;
create trigger health_objects_set_updated_at before update on health_objects
  for each row execute function set_updated_at();


-- These TEST foundations support server-side reads only. Existing operator authority,
-- raw tenant policies and all pre-existing tables/functions remain unchanged.
do $$declare t text;begin
 foreach t in array array['member_integration_identities','communication_endpoints',
 'endpoint_ownership_assignments','responsibility_handoffs','telephony_inventory',
 'endpoint_identity_reviews','health_types','health_subject_types','health_objects'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to service_role',t);
 end loop;
end$$;
