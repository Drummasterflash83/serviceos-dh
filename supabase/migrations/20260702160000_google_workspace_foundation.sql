-- ServiceOS — Email Input Phase-1B: Google Workspace Domain-Wide Delegation.
--
-- Foundation for admin-authorised, many-mailbox ingestion. One Workspace admin
-- delegates a service account to ServiceOS, which can then impersonate mailboxes
-- across the domain — instead of per-user OAuth (Phase-1, still supported).
--
-- Phase-1B is schema + a test-connection function only: NO mailbox sync yet, and
-- NO service-account private key in the DB (keys live in Edge Function secrets).
--
-- Tenant-scoped SELECT RLS (authenticated) so an admin UI can later list
-- connections/mailboxes; NO write policies → service role writes only. Reuses
-- set_updated_at() (Phone-0) and current_tenant_id() (Security-2). Idempotent.

-- ---------------------------------------------------------------------------
-- google_workspace_connections — one delegated connection per tenant/domain
-- ---------------------------------------------------------------------------
create table if not exists google_workspace_connections (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  domain                text not null,
  customer_id           text,                        -- Google customer id (nullable)
  service_account_email text,                        -- client_email of the SA (nullable)
  status                text not null default 'planned', -- planned | testing | active | error | disabled
  delegated_scopes      text[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id, domain)
);

create index if not exists google_workspace_connections_tenant_id_idx
  on google_workspace_connections (tenant_id);

drop trigger if exists google_workspace_connections_set_updated_at on google_workspace_connections;
create trigger google_workspace_connections_set_updated_at
  before update on google_workspace_connections
  for each row execute function set_updated_at();

alter table google_workspace_connections enable row level security;

-- ---------------------------------------------------------------------------
-- google_workspace_mailboxes — mailboxes discovered under a connection
-- ---------------------------------------------------------------------------
create table if not exists google_workspace_mailboxes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  connection_id uuid not null references google_workspace_connections (id) on delete cascade,
  email_address text not null,
  display_name  text,
  mailbox_type  text,                        -- role/type, e.g. user | shared | group (nullable)
  sync_enabled  boolean not null default true,
  status        text not null default 'pending', -- pending | active | error | disabled
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (connection_id, email_address)
);

create index if not exists google_workspace_mailboxes_tenant_id_idx
  on google_workspace_mailboxes (tenant_id);
create index if not exists google_workspace_mailboxes_connection_idx
  on google_workspace_mailboxes (connection_id);

drop trigger if exists google_workspace_mailboxes_set_updated_at on google_workspace_mailboxes;
create trigger google_workspace_mailboxes_set_updated_at
  before update on google_workspace_mailboxes
  for each row execute function set_updated_at();

alter table google_workspace_mailboxes enable row level security;

-- ---------------------------------------------------------------------------
-- Tenant-scoped SELECT policies (read-only; service role writes bypass RLS).
-- ---------------------------------------------------------------------------
drop policy if exists google_workspace_connections_select_tenant on google_workspace_connections;
create policy google_workspace_connections_select_tenant on google_workspace_connections
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists google_workspace_mailboxes_select_tenant on google_workspace_mailboxes;
create policy google_workspace_mailboxes_select_tenant on google_workspace_mailboxes
  for select to authenticated using (tenant_id = current_tenant_id());
