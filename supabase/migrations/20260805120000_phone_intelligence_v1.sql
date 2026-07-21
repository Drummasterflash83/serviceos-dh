-- ServiceOS — PHONE INTELLIGENCE V1 (identity + interpretation backbone).
--
-- PRINCIPLE: metadata establishes the initial identity; speech and context CONFIRM,
-- CHALLENGE or REFINE it. A speaker identity is NEVER assigned from uncertain
-- transcript text alone. Every identity result is explainable (evidence + confidence
-- + conflict state) and the RAW transcript is never destroyed.
--
-- REUSE, DON'T FORK. Canonical people/companies already live in graph_nodes
-- (node_type in 'person'|'company') with graph_edges between them; call rows in
-- phone_calls (with provider raw_payload preserved); raw transcripts in
-- phone_transcripts.transcript_text; provider endpoints in phone_endpoints. This
-- migration adds ONLY the five things that model cannot represent cleanly:
--   1. telephony_directory        — tenant staff/device directory (extension→person/role)
--   2. call_directions            — deterministic, evidenced call direction (1:1 call)
--   3. call_participants          — resolved internal/external parties + evidence/conflicts
--   4. tenant_vocabulary          — tenant aliases for ASR normalisation
--   5. call_transcript_normalisations — normalised transcript + material corrections
--      (RAW stays in phone_transcripts, never mutated)
--
-- Additive & idempotent (create table if not exists / add column if not exists). No
-- data mutation, no drops. Tenant-scoped RLS: authenticated SELECT within tenant;
-- ALL writes are service-role (Edge Functions / worker), which bypass RLS — matching
-- the platform_jobs pattern. Reuses set_updated_at() and current_tenant_id().
--
-- ROLLBACK (safe — additive only):
--   drop table if exists call_transcript_normalisations;
--   drop table if exists call_participants;
--   drop table if exists call_directions;
--   drop table if exists tenant_vocabulary;
--   drop table if exists telephony_directory;
--   alter table phone_ai_insights drop column if exists identity_summary;

-- ── 1) Tenant staff/device telephony directory ──────────────────────────────
-- Maps a telephony extension (and optionally a specific device / e164) to a
-- canonical person (graph_nodes) and role, tenant-scoped and time-bounded. NO
-- hardcoded staff mappings live in code — Drummond's mappings are seeded/configured
-- separately once confirmed. A shared device (reception handset) is flagged so
-- resolution stays honest about uncertainty.
create table if not exists telephony_directory (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  extension        text not null,                 -- e.g. '103'
  e164_number      text,                          -- optional specific DID/device number
  person_node_id   uuid references graph_nodes (id) on delete set null, -- canonical person
  role             text,                          -- e.g. 'Finance', 'Engineer', 'Reception'
  device_label     text,                          -- e.g. 'Reception handset'
  is_shared_device boolean not null default false,
  active           boolean not null default true,
  effective_from   timestamptz not null default now(),
  effective_to     timestamptz,                   -- null = still effective
  confidence       numeric not null default 1.0,  -- 0..1 (a shared device may be < 1)
  source           text not null default 'configured', -- configured|seed|inferred
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists telephony_directory_tenant_ext_idx
  on telephony_directory (tenant_id, extension) where active;
create index if not exists telephony_directory_person_idx
  on telephony_directory (tenant_id, person_node_id) where person_node_id is not null;
-- At most one ACTIVE non-shared mapping per (tenant, extension): a dedicated device
-- resolves to exactly one person. Shared devices are exempt (many people, one device).
create unique index if not exists telephony_directory_active_ext_uk
  on telephony_directory (tenant_id, extension)
  where active and not is_shared_device;

-- ── 2) Deterministic, evidenced call direction (1:1 with phone_calls) ────────
-- Provider metadata is authoritative for direction; the transcript is NEVER used to
-- decide direction when metadata exists. provider_direction preserves the original
-- Simwood/Birchills value; direction is the normalised classification.
create table if not exists call_directions (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null,
  call_id                   uuid not null references phone_calls (id) on delete cascade,
  direction                 text not null default 'unknown',
    -- inbound|outbound|internal|transferred|picked_up|missed|voicemail|unknown
  provider_direction        text,                 -- original provider value (e.g. 'IN'/'OUT')
  originating_number        text,
  destination_number        text,
  external_party_number     text,
  originating_extension     text,
  answering_extension       text,
  pickup_extension          text,
  transferred_from_extension text,
  transferred_to_extension   text,
  direction_evidence        jsonb not null default '[]'::jsonb, -- [{signal, value, weight}]
  direction_confidence      numeric not null default 0.0,       -- 0..1
  classifier_version        text not null default 'v1',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists call_directions_call_uk on call_directions (tenant_id, call_id);
create index if not exists call_directions_tenant_dir_idx on call_directions (tenant_id, direction);

-- ── 3) Resolved call participants (internal/external) + evidence + conflicts ─
-- One row per resolved participant on a call. resolved_entity_id points at the
-- canonical graph_nodes person/company (never a phone-only identity). Conflicting
-- evidence is PERSISTED, never silently overwritten.
create table if not exists call_participants (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  call_id           uuid not null references phone_calls (id) on delete cascade,
  participant_role  text not null default 'unknown',  -- internal|external|ai_receptionist|unknown
  resolved_entity_id uuid references graph_nodes (id) on delete set null,
  display_name      text,
  confidence        numeric not null default 0.0,      -- 0..1
  evidence          jsonb not null default '[]'::jsonb, -- [{type, value, weight, source}]
  conflicts         jsonb not null default '[]'::jsonb, -- [{claimed, from, note}]
  source_fields     jsonb not null default '{}'::jsonb, -- which metadata/transcript fields fed this
  resolver_version  text not null default 'v1',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists call_participants_call_idx on call_participants (tenant_id, call_id);
create index if not exists call_participants_entity_idx
  on call_participants (tenant_id, resolved_entity_id) where resolved_entity_id is not null;

-- ── 4) Tenant vocabulary / aliases for ASR normalisation ────────────────────
-- Tenant-scoped canonical terms + aliases + phonetic variants used to repair ASR
-- errors ("John and Teething" → "Drummond Heating") using CONTEXT, never a brittle
-- global string replace. Categories keep matching scoped and auditable.
create table if not exists tenant_vocabulary (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  term              text not null,                 -- canonical form
  category          text not null default 'terminology',
    -- org|staff|customer|supplier|terminology|equipment|place|job_ref
  aliases           text[] not null default '{}',  -- known written variants
  phonetic_variants text[] not null default '{}',  -- known ASR mishears
  confidence        numeric not null default 1.0,
  active            boolean not null default true,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists tenant_vocabulary_tenant_cat_idx
  on tenant_vocabulary (tenant_id, category) where active;
create unique index if not exists tenant_vocabulary_tenant_term_uk
  on tenant_vocabulary (tenant_id, category, term);

-- ── 5) Transcript normalisation (raw preserved elsewhere, never mutated) ─────
-- The RAW transcript stays in phone_transcripts.transcript_text and is NEVER
-- overwritten. This table stores the normalised text plus every material correction
-- with its evidence + confidence, so corrections are auditable and reversible.
create table if not exists call_transcript_normalisations (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  transcript_id         uuid not null references phone_transcripts (id) on delete cascade,
  normalised_text       text,
  corrections           jsonb not null default '[]'::jsonb,
    -- [{from, to, category, evidence, confidence, span}]
  normalisation_version text not null default 'v1',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists call_transcript_norm_uk
  on call_transcript_normalisations (tenant_id, transcript_id, normalisation_version);

-- ── Optional: a compact identity/summary rollup on the existing insights row ──
-- Additive column so the improved, identity-aware summary can sit beside the
-- existing phone_ai_insights.summary without a parallel table.
alter table phone_ai_insights
  add column if not exists identity_summary jsonb not null default '{}'::jsonb;

-- ── set_updated_at triggers ─────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'telephony_directory','call_directions','call_participants',
    'tenant_vocabulary','call_transcript_normalisations'
  ] loop
    execute format('drop trigger if exists %1$s_set_updated_at on %1$s;', t);
    execute format(
      'create trigger %1$s_set_updated_at before update on %1$s
         for each row execute function set_updated_at();', t);
  end loop;
end $$;

-- ── RLS: tenant-scoped SELECT for authenticated; writes are service-role only ─
do $$
declare t text;
begin
  foreach t in array array[
    'telephony_directory','call_directions','call_participants',
    'tenant_vocabulary','call_transcript_normalisations'
  ] loop
    execute format('alter table %s enable row level security;', t);
    execute format('drop policy if exists %1$s_select_tenant on %1$s;', t);
    execute format(
      'create policy %1$s_select_tenant on %1$s
         for select to authenticated using (tenant_id = current_tenant_id());', t);
  end loop;
end $$;
