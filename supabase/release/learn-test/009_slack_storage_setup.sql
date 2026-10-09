-- Generated TEST-only Slack storage/setup; no credentials, imports or provider requests.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target/checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_governed_work_actions_v1' and source_sha256='4f27681d0f6786b04374cb409fdea61babff40452f263ce8e3c9d43966f215f8' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Verified action authority prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_storage_setup_v1') then raise exception 'Slack storage release already exists';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['tenant_connectors','connector_accounts','provider_connections','provider_connection_events','slack_messages','slack_message_versions','slack_history_imports'])) then raise exception 'Slack dependency table already exists';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['slack_version_immutable','slack_history_commit_page','learn_slack_start_import'])) then raise exception 'Slack function already exists';end if;
end $$;
-- SOURCE 20260708120000_platform_connector_config.sql
-- Original SHA-256 8040064a3cfed1a7ae8bd7166ae9a0465d60623ad66e3c0b509c48fe3c0462c4
-- ServiceOS — Platform Connector Config (Phase: Operational Truth).
--
-- Introduces per-tenant connector configuration so provider identity (e.g. the
-- Simwood customer id) and durable sync cursors live in the DATABASE, not in
-- hardcoded constants inside Edge Functions. This is what lets the scheduled
-- phone sync become tenant-aware and cursor-based (no missed calls on a skipped
-- cron tick), replacing the previous fixed tenant + fixed 10-minute window.
--
-- Non-destructive & idempotent: creates two new tables and (in an isolated,
-- clearly-marked block) seeds ONLY the existing Drummond tenant's Simwood
-- connector from the previously-hardcoded values. No existing table or row is
-- altered or dropped.
--
-- RLS follows the established codebase pattern (cf. google_workspace_*): a
-- tenant-scoped SELECT policy for authenticated users, and NO write policies —
-- all writes go through service-role Edge Functions, which bypass RLS. Reuses
-- set_updated_at() (Phone-0) and current_tenant_id() (Security-2).

-- ---------------------------------------------------------------------------
-- tenant_connectors — one row per (tenant, connector). The connector's enabled
-- flag, rolled-up status/health and last sync watermarks live here.
-- ---------------------------------------------------------------------------
create table if not exists tenant_connectors (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null,
  connector_id            text not null,                       -- e.g. simwood | gmail | google_workspace
  provider                text not null,                       -- e.g. simwood | google
  category                text not null,                       -- e.g. communications
  status                  text not null default 'disabled',    -- disabled | active | error | ...
  health_status           text not null default 'unknown',     -- unknown | healthy | warning | critical
  enabled                 boolean not null default false,
  settings                jsonb not null default '{}'::jsonb,
  last_successful_sync_at timestamptz,
  last_failed_sync_at     timestamptz,
  last_error              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (tenant_id, connector_id)
);

create index if not exists tenant_connectors_tenant_id_idx on tenant_connectors (tenant_id);

drop trigger if exists tenant_connectors_set_updated_at on tenant_connectors;
create trigger tenant_connectors_set_updated_at
  before update on tenant_connectors
  for each row execute function set_updated_at();

alter table tenant_connectors enable row level security;

-- ---------------------------------------------------------------------------
-- connector_accounts — one row per account/mailbox/customer under a connector.
-- `settings` holds provider identity (e.g. provider_customer_id); `sync_cursor`
-- holds the durable watermark (e.g. { "last_synced_until": "<iso>" }).
-- ---------------------------------------------------------------------------
create table if not exists connector_accounts (
  id                      uuid primary key default gen_random_uuid(),
  tenant_connector_id     uuid not null references tenant_connectors (id) on delete cascade,
  tenant_id               uuid not null,
  account_key             text not null,                       -- stable provider id, e.g. Simwood customer id
  display_name            text,
  status                  text not null default 'active',      -- active | disabled | error
  settings                jsonb not null default '{}'::jsonb,
  sync_cursor             jsonb not null default '{}'::jsonb,
  last_successful_sync_at timestamptz,
  last_failed_sync_at     timestamptz,
  last_error              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (tenant_connector_id, account_key)
);

create index if not exists connector_accounts_tenant_id_idx on connector_accounts (tenant_id);
create index if not exists connector_accounts_tenant_connector_idx
  on connector_accounts (tenant_connector_id);

drop trigger if exists connector_accounts_set_updated_at on connector_accounts;
create trigger connector_accounts_set_updated_at
  before update on connector_accounts
  for each row execute function set_updated_at();

alter table connector_accounts enable row level security;

-- ---------------------------------------------------------------------------
-- Tenant-scoped SELECT policies (read-only). Owner/admin/ops "manage" these via
-- service-role Edge Functions (which bypass RLS), consistent with every other
-- connector table in this schema — no direct client writes, no cross-tenant leak.
-- ---------------------------------------------------------------------------
drop policy if exists tenant_connectors_select_tenant on tenant_connectors;
create policy tenant_connectors_select_tenant on tenant_connectors
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists connector_accounts_select_tenant on connector_accounts;
create policy connector_accounts_select_tenant on connector_accounts
  for select to authenticated using (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------

-- SOURCE 20260811120000_provider_connections.sql
-- Original SHA-256 3e0f0b5d900f0f6687dad926e266f0903fc364ba96b850639e71ba9542bb2b9d
-- ServiceOS — Provider connection metadata + audit (additive, tenant-scoped).
--
-- The NON-secret half of the credential broker. Secrets themselves live only in Vault
-- (see 20260810120000_provider_secret_broker.sql); this table stores what is safe to show:
-- connection status, masked account reference, non-secret config, WHICH secret fields are
-- set (names only), and the Vault secret *references* (uuids — useless without service_role
-- execute on the read RPC). One row per (tenant, provider). RLS: tenant SELECT (metadata),
-- writes are service-role only via the Edge Function. The Edge Function additionally masks
-- account_ref and never returns secret material.
--
-- provider_connection_events is the append-only audit trail. detail jsonb NEVER holds secret
-- values — the broker/edge function are responsible for that, and the security tests prove it.
--
-- ROLLBACK:
--   drop table if exists provider_connection_events;
--   drop table if exists provider_connections;

create table if not exists provider_connections (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  provider          text not null,
  status            text not null default 'not_configured',
    -- not_configured | configured | manual | revoked | error
  auth_mode         text,
  account_ref       text,                              -- masked/opaque, non-secret
  non_secret_config jsonb not null default '{}'::jsonb, -- declared non-secret fields only
  configured_fields text[] not null default '{}',       -- secret field NAMES that are set
  secret_refs       jsonb not null default '{}'::jsonb,  -- field -> vault secret id (reference)
  verified_at       timestamptz,                        -- last successful connection test
  last_test         jsonb,                              -- last diagnostics summary (no secrets)
  created_by        uuid,
  updated_by        uuid,
  revoked_by        uuid,
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists provider_connections_tenant_provider_uk
  on provider_connections (tenant_id, provider);

create table if not exists provider_connection_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  provider    text not null,
  event       text not null,
    -- provider_selected | credentials_configured | credentials_replaced | connection_tested
    -- | discovery_started | discovery_completed | discovery_failed | inventory_imported
    -- | mapping_confirmed | mapping_replaced | mapping_rejected | gaps_accepted
    -- | test_call_completed | onboarding_completed | onboarding_reopened
    -- | provider_disconnected | oauth_started | oauth_completed | oauth_failed
  actor_id    uuid,
  detail      jsonb not null default '{}'::jsonb,       -- NEVER secret values
  created_at  timestamptz not null default now()
);
create index if not exists provider_connection_events_tenant_idx
  on provider_connection_events (tenant_id, provider, created_at desc);

-- ── triggers + RLS ──────────────────────────────────────────────────────────
do $$
declare t text;
begin
  execute 'drop trigger if exists provider_connections_set_updated_at on provider_connections;';
  execute 'create trigger provider_connections_set_updated_at before update on provider_connections
             for each row execute function set_updated_at();';
  foreach t in array array['provider_connections','provider_connection_events'] loop
    execute format('alter table %s enable row level security;', t);
    execute format('drop policy if exists %1$s_select_tenant on %1$s;', t);
    execute format(
      'create policy %1$s_select_tenant on %1$s
         for select to authenticated using (tenant_id = current_tenant_id());', t);
    -- Explicit grants (portable): service-role does all writes; authenticated SELECT is
    -- gated by the RLS policy above. Hosted Supabase grants these via default privileges,
    -- but postgres-owned tables applied by `migration up` locally do not — so we grant
    -- explicitly to keep local and remote identical. anon gets nothing.
    execute format('grant select, insert, update, delete on %s to service_role;', t);
    execute format('grant select on %s to authenticated;', t);
  end loop;
end $$;

-- SOURCE 20261029130000_learn_slack_history.sql
-- Original SHA-256 8e2517ca0f01b5ef660b5e431bae7988704f3c08fb6bfadd6a2e3cd837b26656
-- LEARN: additive storage for approved bounded Slack channel-history reads.
-- Apply only after target schema review. Does not enable a connection, grant
-- Slack scopes, schedule a job, change email/phone data or fetch a provider.

create table public.slack_messages (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 source_external_id text not null,
 team_id text not null,
 channel_id text not null,
 provider_timestamp text not null,
 thread_timestamp text,
 message_text text not null,
 provider_payload jsonb not null,
 source_version text not null,
 source_updated_at numeric not null,
 unique(tenant_id,id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(tenant_id, source_external_id)
);
alter table public.slack_messages enable row level security;
-- Retain every observed version. Replaying the same provider content is a no-op.
create table public.slack_message_versions (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 message_id uuid not null,
 foreign key(tenant_id,message_id) references public.slack_messages(tenant_id,id),
 source_version text not null,
 provider_payload jsonb not null,
 observed_at timestamptz not null default now(),
 unique(tenant_id,message_id,source_version)
);
alter table public.slack_message_versions enable row level security;
create policy slack_messages_read on public.slack_messages for select to authenticated
 using(tenant_id=public.current_tenant_id());
create policy slack_versions_read on public.slack_message_versions for select to authenticated
 using(tenant_id=public.current_tenant_id());
revoke all on public.slack_messages,public.slack_message_versions from public,anon,authenticated,service_role;
grant select on public.slack_messages,public.slack_message_versions to authenticated;
grant select,insert,update on public.slack_messages to service_role;
grant select,insert on public.slack_message_versions to service_role;
create function public.slack_version_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Slack source versions are immutable' using errcode='55000'; end $$;
create trigger slack_versions_immutable before update or delete on public.slack_message_versions
 for each row execute function public.slack_version_immutable();


create or replace function public.slack_history_commit_page(
 p_tenant_id uuid,p_job_id uuid,p_account_id uuid,
 p_expected jsonb,p_next jsonb,p_records jsonb
) returns boolean language plpgsql security invoker set search_path=public as $$
declare
 a public.connector_accounts%rowtype;
 cfg jsonb;
 c public.tenant_connectors%rowtype;
 r jsonb;
 sid uuid;
 scope_identity jsonb;
 version_hash text;
 provider_updated numeric;
 current_version text;
 seen text[]:=array[]::text[];
begin
 if p_tenant_id is null or p_job_id is null or p_account_id is null then raise exception 'history_identity_required'; end if;
 if auth.role() is distinct from 'service_role' then raise exception 'history_service_role_required'; end if;
 if jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_next) is distinct from 'object'
  or not (p_expected ?& array['scopeKey','cursor','pages','complete'])
  or not (p_next ?& array['scopeKey','cursor','pages','complete'])
  or jsonb_typeof(p_expected->'pages') is distinct from 'number'
  or jsonb_typeof(p_next->'pages') is distinct from 'number'
  or jsonb_typeof(p_expected->'complete') is distinct from 'boolean'
  or jsonb_typeof(p_next->'complete') is distinct from 'boolean'
  or (p_expected->>'pages') !~ '^[0-9]+$' or (p_next->>'pages') !~ '^[0-9]+$'
  or jsonb_typeof(p_expected->'scopeKey') is distinct from 'string'
  or jsonb_typeof(p_next->'scopeKey') is distinct from 'string'
  or jsonb_typeof(p_expected->'cursor') not in ('null','string')
  or jsonb_typeof(p_next->'cursor') not in ('null','string')
  or (select count(*) from jsonb_object_keys(p_expected))<>4
  or (select count(*) from jsonb_object_keys(p_next))<>4
  or (p_expected->>'pages')::integer<0
 then raise exception 'history_checkpoint_invalid'; end if;
 -- Lock authoritative job and account; concurrent checkpoint or revocation is
 -- serialised. The worker's own lifecycle owns completion/retry/dead-letter.
 perform 1 from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id
  and status='running' and job_type='slack.history_sync'
  and payload->>'connector_account_id'=p_account_id::text for update;
 if not found then raise exception 'history_job_unavailable'; end if;
 select * into a from public.connector_accounts where id=p_account_id and tenant_id=p_tenant_id for update;
 if not found or a.status<>'active' then raise exception 'history_account_unavailable'; end if;
 select * into c from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id for update;
 if not found or c.connector_id<>'slack' or not c.enabled or c.status<>'active' then raise exception 'history_connector_unavailable'; end if;
 cfg=a.settings->'slack_history';
 if cfg is null or cfg->'approved' is distinct from 'true'::jsonb
  or jsonb_typeof(cfg->'maxPages') is distinct from 'number'
  or length(btrim(cfg->>'consentReference')) not between 1 and 2000
  or coalesce(cfg->>'maxPages','') !~ '^[1-9]$|^10$' or coalesce(cfg->>'consentReference','')=''
  or coalesce(cfg->>'teamId','') !~ '^T[A-Z0-9]+$'
  or coalesce(cfg->>'channelId','') !~ '^C[A-Z0-9]+$'
  or coalesce(cfg->>'oldest','') !~ '^\d{1,12}\.\d{1,6}$'
  or coalesce(cfg->>'latest','') !~ '^\d{1,12}\.\d{1,6}$'
  or (cfg->>'oldest')::numeric>(cfg->>'latest')::numeric
  or (cfg->>'latest')::numeric-(cfg->>'oldest')::numeric>86400
  or cfg->>'expiresAt' is null or (cfg->>'expiresAt')::timestamptz<=clock_timestamp()
 then raise exception 'history_scope_unavailable'; end if;
 -- Recheck the credential connection inside the same transaction as publication.
 -- A revoke after the HTTP response must not publish against a disabled connection.
 perform 1 from public.provider_connections where id=(cfg->>'connectionId')::uuid
  and tenant_id=p_tenant_id and provider='slack' and status='configured'
  and revoked_at is null and non_secret_config->>'team_id'=cfg->>'teamId' for share;
 if not found then raise exception 'history_connection_unavailable'; end if;
 scope_identity=jsonb_build_array(p_tenant_id::text,cfg->>'teamId',cfg->>'channelId',cfg->>'oldest',cfg->>'latest',cfg->>'consentReference');
 if (p_expected->>'scopeKey')::jsonb is distinct from scope_identity
  or p_next->>'scopeKey' is distinct from p_expected->>'scopeKey'
  or (p_next->>'pages')::integer<>(p_expected->>'pages')::integer+1
  or (p_next->>'pages')::integer>least(10,(cfg->>'maxPages')::integer)
  or (p_expected->>'complete')::boolean
  or p_next->>'complete' not in ('true','false')
  or (p_next->>'complete')::boolean and p_next->>'cursor' is not null
  or not (p_next->>'complete')::boolean and coalesce(p_next->>'cursor','')=''
  or length(coalesce(p_next->>'cursor',''))>1024
  or p_next->>'cursor' is not null and p_next->>'cursor'=p_expected->>'cursor'
  or length(coalesce(p_expected->>'cursor',''))>1024
 then raise exception 'history_checkpoint_invalid'; end if;
 if a.sync_cursor is distinct from p_expected then
  if a.sync_cursor<>'{}'::jsonb or p_expected->>'cursor' is not null
   or (p_expected->>'pages')::integer<>0 then raise exception 'history_checkpoint_conflict'; end if;
 end if;
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>15 then raise exception 'history_page_invalid'; end if;
 for r in select value from jsonb_array_elements(p_records) loop
  if r->>'tenant_id' is distinct from p_tenant_id::text
   or r->>'channel_id' is distinct from cfg->>'channelId'
   or r->>'source_external_id' is distinct from concat(cfg->>'teamId',':',cfg->>'channelId',':',r->>'provider_timestamp')
   or coalesce(r->>'provider_timestamp','') !~ '^\d{1,12}\.\d{1,6}$'
   or (r->>'provider_timestamp')::numeric<(cfg->>'oldest')::numeric
   or (r->>'provider_timestamp')::numeric>(cfg->>'latest')::numeric
   or r->>'provider_timestamp'=any(seen)
   or r->>'thread_timestamp' is not null and r->>'thread_timestamp' !~ '^\d{1,12}\.\d{1,6}$'
   or jsonb_typeof(r->'provider_payload') is distinct from 'object'
   or octet_length((r->'provider_payload')::text)>262144
   or r->'provider_payload'->>'ts' is distinct from r->>'provider_timestamp'
   or r->'provider_payload'->>'text' is distinct from r->>'text'
   or r->'provider_payload'->'edited' is not null and (coalesce(r->'provider_payload'->'edited'->>'ts','') !~ '^\d{1,12}\.\d{1,6}$')
   or r->'provider_payload'->>'thread_ts' is distinct from r->>'thread_timestamp'
   or jsonb_typeof(r->'text') is distinct from 'string' or length(r->>'text')>40000
  then raise exception 'history_record_invalid'; end if;
  seen=array_append(seen,r->>'provider_timestamp');
  version_hash=encode(sha256(convert_to((r->'provider_payload')::text,'UTF8')),'hex');
  provider_updated=coalesce(r->'provider_payload'->'edited'->>'ts',r->>'provider_timestamp')::numeric;
  if provider_updated<(r->>'provider_timestamp')::numeric then raise exception 'history_edit_timestamp_invalid'; end if;
  sid=md5(p_tenant_id::text||':'||(r->>'source_external_id'))::uuid;
  insert into public.slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,thread_timestamp,message_text,provider_payload,source_version,source_updated_at)
   values(sid,p_tenant_id,r->>'source_external_id',cfg->>'teamId',cfg->>'channelId',r->>'provider_timestamp',r->>'thread_timestamp',r->>'text',r->'provider_payload',version_hash,provider_updated)
   on conflict(tenant_id,source_external_id) do update set message_text=excluded.message_text,thread_timestamp=excluded.thread_timestamp,provider_payload=excluded.provider_payload,source_version=excluded.source_version,source_updated_at=excluded.source_updated_at,updated_at=now()
   where slack_messages.source_updated_at<=excluded.source_updated_at and slack_messages.source_version is distinct from excluded.source_version;
  insert into public.slack_message_versions(tenant_id,message_id,source_version,provider_payload)
   values(p_tenant_id,sid,version_hash,r->'provider_payload') on conflict do nothing;
  select source_version into current_version from public.slack_messages where id=sid and tenant_id=p_tenant_id;
  if current_version<>version_hash then continue; end if; -- Older replay is retained, not made current.
  -- Reuse the single existing interaction/observation engine. No AI execution,
  -- event fan-out or consequential follow-on jobs are introduced by this page.
  insert into public.interactions(tenant_id,source_connector_id,source_type,source_table,source_id,source_external_id,interaction_type,direction,occurred_at,body_preview,metadata)
   values(p_tenant_id,'slack','chat','slack_messages',sid,r->>'source_external_id','slack_message','unknown',to_timestamp((r->>'provider_timestamp')::numeric),left(r->>'text',2000),jsonb_build_object('channel_id',cfg->>'channelId','coverage','bounded_history_page','threads','unverified','source_version',version_hash))
   on conflict(tenant_id,source_table,source_id) do update set body_preview=excluded.body_preview,metadata=interactions.metadata||excluded.metadata,
    processing_status=case when interactions.metadata->>'source_version' is distinct from excluded.metadata->>'source_version' then 'pending' else interactions.processing_status end
   where interactions.metadata->>'source_version' is distinct from excluded.metadata->>'source_version';
 end loop;
 update public.connector_accounts set sync_cursor=p_next where id=p_account_id and tenant_id=p_tenant_id;
 return true;
end $$;

revoke all on function public.slack_history_commit_page(uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.slack_history_commit_page(uuid,uuid,uuid,jsonb,jsonb,jsonb) to service_role;

-- SOURCE 20261029140000_learn_slack_import_setup.sql
-- Original SHA-256 f598f6a99da6a886cb6df70cd790fbeafa75cbad69799088e81dc0b11342acde
-- Owner/admin approval and durable enqueue for the existing Slack history worker.
-- Additive; does not create credentials, change provider grants or import on apply.

create table public.slack_history_imports (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 account_id uuid not null references public.connector_accounts(id),
 job_id uuid not null references public.platform_jobs(id),
 approved_by uuid not null references public.profiles(id),
 approved_at timestamptz not null default now(),
 definition jsonb not null,
 previous_state jsonb
);
alter table public.slack_history_imports enable row level security;
create policy slack_import_read on public.slack_history_imports for select to authenticated
 using(tenant_id=public.current_tenant_id());
revoke all on public.slack_history_imports from public,anon,authenticated,service_role;
grant select on public.slack_history_imports to authenticated,service_role;
create trigger slack_import_immutable before update or delete on public.slack_history_imports
 for each row execute function public.slack_version_immutable();

create function public.learn_slack_start_import(
 p_tenant_id uuid,p_request_id uuid,p_connection_id uuid,p_expected_revision text,
 p_channel_id text,p_start timestamptz,p_end timestamptz,p_max_pages integer,p_reason text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 c public.provider_connections%rowtype;
 tc public.tenant_connectors%rowtype;
 a public.connector_accounts%rowtype;
 prior public.slack_history_imports%rowtype;
 definition jsonb;
 scope jsonb;
 checkpoint jsonb;
 previous_state jsonb;
 aid uuid;
 jid uuid:=gen_random_uuid();
begin
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id()
  or coalesce(public.current_user_role(),'') not in ('owner','admin')
  or exists(select 1 from public.view_as_context where actor_user_id=auth.uid()
   and ended_at is null and (expires_at is null or expires_at>now())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';
 end if;
 if p_request_id is null or p_connection_id is null or p_expected_revision is null
  or coalesce(p_channel_id,'') !~ '^C[A-Z0-9]+$' or length(p_channel_id)>100
  or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_start>=p_end or p_end-p_start>interval '24 hours' or p_end>clock_timestamp()
  or p_start<to_timestamp(0) or p_max_pages is null or p_max_pages not between 1 and 10
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
  raise exception 'Choose a past window up to 24 hours, a public channel and a reason' using errcode='22023';
 end if;
 definition:=jsonb_build_object('connectionId',p_connection_id,'connectionRevision',p_expected_revision,
  'channelId',p_channel_id,'start',p_start,'end',p_end,'maxPages',p_max_pages,'reason',btrim(p_reason));
 -- Serialise retries before looking up an existing request. A lost response must
 -- never produce a second approval or job, even if no job is still active.
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-request:'||p_request_id::text,0));
 select * into prior from public.slack_history_imports where id=p_request_id;
 if found then
  if prior.tenant_id<>p_tenant_id or prior.definition<>definition then
   raise exception 'Import request identity has changed' using errcode='40001';
  end if;
  return jsonb_build_object('requestId',prior.id,'accountId',prior.account_id,'jobId',prior.job_id,'reused',true);
 end if;
 -- Shared tenant connector before channel/account follows the same order for
 -- all setup requests. Publication takes row locks separately and stays atomic.
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||p_tenant_id::text,0));
 select * into c from public.provider_connections where id=p_connection_id and tenant_id=p_tenant_id for share;
 if not found or c.provider<>'slack' or c.status<>'configured' or c.revoked_at is not null
  or c.updated_at is distinct from p_expected_revision::timestamptz
  or coalesce(c.non_secret_config->>'team_id','') !~ '^T[A-Z0-9]+$'
  or not ('bot_token'=any(c.configured_fields)) or c.secret_refs->>'bot_token' is null then
  raise exception 'Slack connection unavailable or changed; reload setup' using errcode='40001';
 end if;
 select * into tc from public.tenant_connectors where tenant_id=p_tenant_id and connector_id='slack';
 if not found then
  insert into public.tenant_connectors(tenant_id,connector_id,provider,category,status,enabled)
   values(p_tenant_id,'slack','slack','communications','active',true) returning * into tc;
 elsif not tc.enabled or tc.status<>'active' then
  raise exception 'Slack connector is disabled; restore it before importing' using errcode='55000';
 end if;
 select * into a from public.connector_accounts where tenant_connector_id=tc.id and tenant_id=p_tenant_id
  and account_key=(c.non_secret_config->>'team_id')||':'||p_channel_id for update;
 if found then
  if a.status<>'active' or exists(select 1 from public.platform_jobs where tenant_id=p_tenant_id
   and job_type='slack.history_sync' and payload->>'connector_account_id'=a.id::text
   and status in ('queued','running','retrying')) then
   raise exception 'A channel import is active or the account is disabled' using errcode='55000';
  end if;
  if a.settings ? 'slack_history' and a.sync_cursor->'complete' is distinct from 'true'::jsonb then
   raise exception 'Previous window is incomplete; retain its checkpoint for review' using errcode='55000';
  end if;
  previous_state:=jsonb_build_object('settings',a.settings->'slack_history','checkpoint',a.sync_cursor);
  aid:=a.id;
 else
  insert into public.connector_accounts(tenant_id,tenant_connector_id,account_key,display_name,status)
   values(p_tenant_id,tc.id,(c.non_secret_config->>'team_id')||':'||p_channel_id,p_channel_id,'active') returning id into aid;
 end if;
 scope:=jsonb_build_object('approved',true,'connectionId',c.id,'teamId',c.non_secret_config->>'team_id',
  'channelId',p_channel_id,'oldest',to_char(extract(epoch from p_start),'FM999999999999.000000'),
  'latest',to_char(extract(epoch from p_end),'FM999999999999.000000'),
  'consentReference','learn-slack-import:'||p_request_id::text,'expiresAt',clock_timestamp()+interval '24 hours','maxPages',p_max_pages);
 checkpoint:='{}'::jsonb; -- Worker creates the exact canonical scope key.
 select * into tc from public.tenant_connectors where id=tc.id and tenant_id=p_tenant_id for update;
 if not found or not tc.enabled or tc.status<>'active' then raise exception 'Slack connector changed' using errcode='55000'; end if;
 update public.connector_accounts set settings=settings||jsonb_build_object('slack_history',scope),sync_cursor=checkpoint where id=aid;
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
  values(jid,p_tenant_id,'slack','slack.history_sync','slack.history:'||aid::text,'queued',5,clock_timestamp(),
   jsonb_build_object('connector_account_id',aid),auth.uid());
 insert into public.slack_history_imports(id,tenant_id,account_id,job_id,approved_by,definition,previous_state)
  values(p_request_id,p_tenant_id,aid,jid,auth.uid(),definition,previous_state);
 return jsonb_build_object('requestId',p_request_id,'accountId',aid,'jobId',jid,'reused',false);
end $$;
revoke all on function public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text) from public,anon;
grant execute on function public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text) to authenticated;

-- SOURCE 20261030090000_learn_slack_import_integrity.sql
-- Original SHA-256 0e56a4308dcd350493da2b59d92ae3d2f4edb80e4936f9bde06f887d16829dee
-- Preserve Slack source and approval evidence, and align setup with the
-- serialized owner/preview authority introduced for governed work actions.

-- A narrow service-only writer avoids granting direct queue/source DML merely
-- to publish a validated Slack page. Its body checks job, tenant and account.
alter function public.slack_history_commit_page(uuid,uuid,uuid,jsonb,jsonb,jsonb)
 security definer;
alter function public.slack_history_commit_page(uuid,uuid,uuid,jsonb,jsonb,jsonb)
 set search_path=public,pg_temp;
do $$ declare t text;begin
 foreach t in array array['slack_messages','slack_message_versions','slack_history_imports'] loop
  execute format('create trigger learn_slack_retain_truncate before truncate on public.%I for each statement execute function public.slack_version_immutable()',t);
 end loop;
end $$;
create trigger learn_slack_retain_message before delete on public.slack_messages
 for each row execute function public.slack_version_immutable();

do $$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text)'::regprocedure);
 needle:='errcode=''40001''';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then
  raise exception 'Reviewed Slack conflict contract changed';
 end if;
 definition:=replace(definition,needle,'errcode=''PT409''');
 needle:=E'begin\n if auth.uid() is null';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then
  raise exception 'Reviewed Slack authority contract changed';
 end if;
 definition:=replace(definition,needle,$patch$begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Slack approval requires a fresh read-committed snapshot' using errcode='22023';
 end if;
 -- Same order as governed work. Authority mutations take the matching tenant
 -- mutex; privileged truncation takes the global exclusive lock.
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant_id::text,0));
 if auth.uid() is null$patch$);
 execute definition;
end $$;

-- Portable least privileges; publishing uses only the verified service RPC.
do $$ declare n text;begin
 foreach n in array array['tenant_connectors','connector_accounts','provider_connections','provider_connection_events','slack_messages','slack_message_versions','slack_history_imports'] loop
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
  execute format('grant select on public.%I to authenticated,service_role',n);
 end loop;
 foreach n in array array['tenant_connectors','connector_accounts','provider_connections'] loop
  execute format('grant insert,update on public.%I to service_role',n);
  execute format('alter table public.%I add constraint learn_connector_tenant_fk foreign key(tenant_id) references public.tenants(id)',n);
  execute format('create trigger learn_connector_reference_guard before insert or update on public.%I for each row execute function public.learn_foundation_reference_guard()',n);
  execute format('create trigger learn_connector_retain before delete on public.%I for each row execute function public.slack_version_immutable()',n);
  execute format('create trigger learn_connector_retain_truncate before truncate on public.%I for each statement execute function public.slack_version_immutable()',n);
 end loop;
end $$;
alter table provider_connection_events add constraint learn_provider_event_tenant_fk foreign key(tenant_id) references tenants(id);
grant insert on provider_connection_events to service_role;
create trigger learn_provider_events_retain before update or delete on provider_connection_events for each row execute function slack_version_immutable();
create trigger learn_provider_events_retain_truncate before truncate on provider_connection_events for each statement execute function slack_version_immutable();
create trigger learn_slack_import_reference_guard before insert or update on slack_history_imports for each row execute function learn_foundation_reference_guard();
revoke all on function slack_version_immutable() from public,anon,authenticated,service_role;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'learn_slack_storage_setup_v1','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
