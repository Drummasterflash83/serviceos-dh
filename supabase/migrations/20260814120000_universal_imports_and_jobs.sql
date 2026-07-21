-- ServiceOS — Universal data imports + canonical Jobs/Sites (additive, tenant-scoped).
--
-- Two things, both source-neutral:
--  1) Canonical SoR tables the business graph can project: `jobs` (+ `job_number_aliases`)
--     and `sites`. Engineers are `people` (role), not a new type. Job numbers are unique per
--     (tenant, source_system) namespace — NOT globally. interactions.related_job_id already
--     exists as the link column; business-graph-sync will project jobs as node_type='job'.
--  2) A universal import engine: `import_profiles` (reusable, source-neutral column mapping —
--     Commusoft mapping is a PROFILE ROW, never generic code), `data_imports` (one row per
--     import run with full counts + provenance), `import_row_provenance` (per-entity lineage
--     so no canonical record loses where it came from). Plus a private `imports` Storage bucket.
--
-- Never overwrite stronger canonical data with lower-confidence imported values — enforced in
-- the import engine (evidence + confidence per row), recorded in import_row_provenance.
-- RLS: tenant SELECT for authenticated; writes service-role only. Explicit grants for portability.
--
-- ROLLBACK: drop tables job_number_aliases, jobs, sites, import_row_provenance, data_imports,
--   import_profiles;  delete from storage.buckets where id='imports';

-- ── Canonical Sites (SoR) ───────────────────────────────────────────────────
create table if not exists sites (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  source_system text,                         -- e.g. commusoft (null = native)
  external_id   text,                          -- provider site id
  company_id    uuid references companies (id) on delete set null,
  person_id     uuid references people (id) on delete set null,
  label         text,
  address_text  text,
  postcode      text,
  metadata      jsonb not null default '{}'::jsonb,
  created_source text not null default 'native',
  verified      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists sites_source_uk
  on sites (tenant_id, source_system, external_id) where external_id is not null;
create index if not exists sites_tenant_idx on sites (tenant_id);
create index if not exists sites_tenant_postcode_idx on sites (tenant_id, postcode);

-- ── Canonical Jobs (SoR) ────────────────────────────────────────────────────
create table if not exists jobs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  source_system      text,                     -- commusoft | native | …
  external_id        text,                      -- provider job id (stable)
  job_number         text,                      -- human job number (tenant/source-scoped)
  customer_person_id uuid references people (id) on delete set null,
  customer_company_id uuid references companies (id) on delete set null,
  site_id            uuid references sites (id) on delete set null,
  engineer_person_id uuid references people (id) on delete set null,   -- engineer = a person
  title              text,
  description        text,
  job_type           text,
  status             text,                      -- free text (source vocab), e.g. open|completed
  priority           text,
  invoice_status     text,
  quote_status       text,
  value_pennies      bigint,                    -- money as integer pennies (never float)
  created_date       timestamptz,
  booked_date        timestamptz,
  completed_date     timestamptz,
  active             boolean not null default true,
  metadata           jsonb not null default '{}'::jsonb,
  created_source     text not null default 'native',
  verified           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- Idempotent import: one job per (tenant, source_system, external_id).
create unique index if not exists jobs_source_uk
  on jobs (tenant_id, source_system, external_id) where external_id is not null;
-- Job number unique within the (tenant, source_system) namespace — not global.
create unique index if not exists jobs_number_uk
  on jobs (tenant_id, source_system, job_number) where job_number is not null;
create index if not exists jobs_tenant_idx on jobs (tenant_id);
create index if not exists jobs_tenant_customer_idx on jobs (tenant_id, customer_person_id);

-- ── Job-number aliases (formatting variants → canonical job) ─────────────────
-- '#123456', 'Job 123456', 'J123456', 'Commusoft 123456' all normalise to one job.
create table if not exists job_number_aliases (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  job_id     uuid not null references jobs (id) on delete cascade,
  alias      text not null,             -- as written
  normalized text not null,             -- canonical digits (e.g. '123456')
  source     text not null default 'import',
  created_at timestamptz not null default now()
);
create unique index if not exists job_number_aliases_norm_uk
  on job_number_aliases (tenant_id, normalized);
create index if not exists job_number_aliases_job_idx on job_number_aliases (tenant_id, job_id);

-- ── Import profiles (source-neutral; Commusoft mapping is a ROW) ─────────────
create table if not exists import_profiles (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid,                    -- null = platform default profile
  source_system text not null,           -- commusoft | generic | …
  entity_type   text not null,           -- customers | jobs | staff | sites | assets
  name          text not null,
  -- definition: { columns:[{canonical, aliases[], required, type, transform}],
  --   identifier_rules[], dedup_rules[], relationship_rules[], date_formats[], … }
  definition    jsonb not null default '{}'::jsonb,
  active        boolean not null default true,
  version       int not null default 1,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists import_profiles_tenant_idx
  on import_profiles (tenant_id, source_system, entity_type) where active;

-- ── Import runs (one per upload; full counts + provenance) ───────────────────
create table if not exists data_imports (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  source_system     text not null,
  profile_id        uuid references import_profiles (id) on delete set null,
  entity_type       text not null,
  original_filename text,
  file_checksum     text,                -- sha256 — duplicate-upload detection
  file_size         bigint,
  storage_path      text,                -- private bucket pointer (raw file retained, controlled)
  status            text not null default 'uploaded',
    -- uploaded | previewed | importing | completed | failed
  row_count         int not null default 0,
  valid_rows        int not null default 0,
  invalid_rows      int not null default 0,
  created_records   int not null default 0,
  updated_records   int not null default 0,
  skipped_records   int not null default 0,
  duplicate_records int not null default 0,
  conflict_records  int not null default 0,
  preview           jsonb,               -- dry-run summary (redacted)
  failure           text,
  import_version    int not null default 1,
  uploaded_by       uuid,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists data_imports_tenant_idx on data_imports (tenant_id, created_at desc);
create index if not exists data_imports_checksum_idx on data_imports (tenant_id, file_checksum);

-- ── Per-entity import provenance (lineage for every created/updated record) ──
create table if not exists import_row_provenance (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  import_id        uuid not null references data_imports (id) on delete cascade,
  entity_table     text not null,        -- people | companies | jobs | sites | …
  entity_id        uuid not null,
  source_system    text,
  source_row_number int,
  external_id      text,
  imported_fields  text[] not null default '{}',
  match_strategy   text,                 -- external_id | phone | email | job_number | new | …
  confidence       numeric,
  action           text,                 -- created | updated | skipped | conflict
  conflicts        jsonb not null default '[]'::jsonb,
  imported_at      timestamptz not null default now()
);
create index if not exists import_row_provenance_import_idx on import_row_provenance (tenant_id, import_id);
create index if not exists import_row_provenance_entity_idx on import_row_provenance (tenant_id, entity_table, entity_id);

-- ── Storage bucket for raw import files (private) ───────────────────────────
insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do nothing;

-- ── Mark Job/Site as high-integrity (dedicated SoR tables now exist) ────────
update domain_entity_types set is_high_integrity = true
  where domain = 'serviceos' and node_type in ('Job', 'Site');

-- ── triggers + RLS + grants ─────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'sites','jobs','job_number_aliases','import_profiles','data_imports','import_row_provenance'
  ] loop
    execute format('drop trigger if exists %1$s_set_updated_at on %1$s;', t);
    -- job_number_aliases + import_row_provenance have no updated_at → guard
    if exists (select 1 from information_schema.columns
                 where table_name = t and column_name = 'updated_at') then
      execute format('create trigger %1$s_set_updated_at before update on %1$s
                        for each row execute function set_updated_at();', t);
    end if;
    execute format('alter table %s enable row level security;', t);
    execute format('drop policy if exists %1$s_select_tenant on %1$s;', t);
    -- platform-default import_profiles (tenant_id null) are readable by any authenticated tenant
    if t = 'import_profiles' then
      execute format('create policy %1$s_select_tenant on %1$s
                        for select to authenticated
                        using (tenant_id is null or tenant_id = current_tenant_id());', t);
    else
      execute format('create policy %1$s_select_tenant on %1$s
                        for select to authenticated using (tenant_id = current_tenant_id());', t);
    end if;
    execute format('grant select, insert, update, delete on %s to service_role;', t);
    execute format('grant select on %s to authenticated;', t);
  end loop;
end $$;
