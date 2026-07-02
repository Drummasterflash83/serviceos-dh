-- ServiceOS — Email Input Phase-1: secure Gmail OAuth token storage.
--
-- Holds the OAuth access/refresh tokens for a connected mailbox. These are
-- SECRETS: RLS is enabled with NO policies at all, so the authenticated
-- frontend can never read or write them. Only the service role (which bypasses
-- RLS, used by the gmail-oauth-* Edge Functions) touches this table.
--
-- Reuses set_updated_at() (Phone-0). Idempotent.

create table if not exists email_oauth_tokens (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  email_account_id uuid not null references email_accounts (id) on delete cascade,
  provider         text not null default 'gmail',
  access_token     text,
  refresh_token    text,
  expires_at       timestamptz,
  scope            text,
  token_type       text,
  raw_payload      jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- One token row per connected account (upserted on each successful connect).
  unique (email_account_id)
);

create index if not exists email_oauth_tokens_tenant_id_idx on email_oauth_tokens (tenant_id);

drop trigger if exists email_oauth_tokens_set_updated_at on email_oauth_tokens;
create trigger email_oauth_tokens_set_updated_at
  before update on email_oauth_tokens
  for each row execute function set_updated_at();

-- RLS ON, NO policies → deny-all for anon/authenticated. Service role bypasses
-- RLS entirely; tokens are therefore never reachable from the frontend.
alter table email_oauth_tokens enable row level security;
