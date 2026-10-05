-- ServiceOS — Provider OAuth state + behaviour config (additive, tenant-scoped).
--
-- provider_oauth_states backs the reusable delegated-authorization framework: one-time,
-- expiring, tenant+user-bound state rows with a server-held PKCE verifier. It is SERVICE-ROLE
-- ONLY (RLS deny-all: no authenticated policy) — the browser never reads OAuth state or the
-- code_verifier; the callback Edge Function validates and consumes it. No tokens live here;
-- issued tokens go straight to Vault via the credential broker.
--
-- telephony_onboarding.behaviour_config holds the manual pickup/shared-device behaviour the
-- operator configures in the wizard (e.g. Drummond's *21# recording code) — tenant config,
-- not provider code, and no secrets.
--
-- ROLLBACK:
--   alter table telephony_onboarding drop column if exists behaviour_config;
--   drop table if exists provider_oauth_states;

create table if not exists provider_oauth_states (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  provider       text not null,
  state          text not null,               -- one-time CSRF/binding token (random)
  code_challenge text,                         -- PKCE S256 challenge sent to the provider
  code_verifier  text,                         -- PKCE verifier held SERVER-SIDE only
  redirect_uri   text,
  scopes         text[] not null default '{}',
  created_by     uuid,                          -- the user who initiated (binding)
  expires_at     timestamptz not null,
  used_at        timestamptz,                   -- set when consumed → one-time
  created_at     timestamptz not null default now()
);
create unique index if not exists provider_oauth_states_state_uk on provider_oauth_states (state);
create index if not exists provider_oauth_states_tenant_idx
  on provider_oauth_states (tenant_id, provider, created_at desc);

alter table telephony_onboarding
  add column if not exists behaviour_config jsonb not null default '{}'::jsonb;

do $$
begin
  execute 'alter table provider_oauth_states enable row level security;';
  -- Deliberately NO authenticated policy: OAuth state is service-role only.
  execute 'grant select, insert, update, delete on provider_oauth_states to service_role;';
end $$;
