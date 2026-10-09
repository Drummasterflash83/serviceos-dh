-- LEARN: additive storage for approved bounded Slack channel-history reads.
-- Apply only after target schema review. Does not enable a connection, grant
-- Slack scopes, schedule a job, change email/phone data or fetch a provider.
begin;
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
commit;
