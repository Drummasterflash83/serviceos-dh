-- ServiceOS — Telephony directory: first-class endpoint mapping + lifecycle (additive).
--
-- Phone Intelligence maps a provider ENDPOINT (opaque URI) → person. Until now the
-- endpoint ref lived in metadata and `extension` was required. This makes endpoint_ref
-- first-class, lets `extension` be null (many providers expose only endpoint URIs), and
-- adds a calibration `status` lifecycle. Additive & idempotent; no data rewrite.
--
-- Lifecycle status: discovered | suggested | confirmed | conflicted | shared | inactive
--                   | unknown | rejected. Free text (no constraint) — like platform_jobs.
--
-- ROLLBACK:
--   drop index if exists telephony_directory_active_endpoint_uk;
--   alter table telephony_directory drop column if exists endpoint_ref;
--   alter table telephony_directory drop column if exists status;
--   -- (extension NOT NULL is not restored: existing rows may now hold null.)

alter table telephony_directory
  add column if not exists endpoint_ref text,
  add column if not exists status       text not null default 'confirmed';

-- Extension is optional now (endpoint-only providers).
alter table telephony_directory alter column extension drop not null;

-- Backfill endpoint_ref from any metadata we already stored.
update telephony_directory
  set endpoint_ref = metadata->>'endpoint_ref'
  where endpoint_ref is null and metadata ? 'endpoint_ref';

-- At most one ACTIVE mapping per (tenant, endpoint_ref) — a device resolves to one
-- confirmed owner (shared devices are exempt; they legitimately have many people).
create unique index if not exists telephony_directory_active_endpoint_uk
  on telephony_directory (tenant_id, endpoint_ref)
  where active and endpoint_ref is not null and not is_shared_device;

create index if not exists telephony_directory_tenant_status_idx
  on telephony_directory (tenant_id, status) where active;
