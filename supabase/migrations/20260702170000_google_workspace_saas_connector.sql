-- ServiceOS — Google Workspace SaaS connector: per-tenant connection config.
--
-- Moves domain + impersonation subject OFF global Supabase secrets and INTO the
-- tenant's google_workspace_connections row. The platform service-account
-- client_email + private_key stay global secrets; each tenant stores its own
-- domain/admin-subject and authorises the same ServiceOS client ID.
--
-- Non-destructive: additive columns only (add column if not exists). Existing
-- rows keep their values; new columns default to null / '{}'.

alter table google_workspace_connections
  add column if not exists impersonation_subject     text;

alter table google_workspace_connections
  add column if not exists service_account_client_id text;

alter table google_workspace_connections
  add column if not exists authorised_scopes         text[] not null default '{}';

alter table google_workspace_connections
  add column if not exists last_verified_at          timestamptz;

alter table google_workspace_connections
  add column if not exists error_message             text;
