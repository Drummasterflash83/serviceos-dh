-- SUPERSEDED: executable migration and isolated SQL tests now live in
-- supabase/migrations/20261029130000_learn_slack_history.sql and
-- scripts/verify/learn-slack-sql.py. Retained for historical handover provenance.
-- Do not apply this older proposal: it lacks retained source revisions.
-- SOURCE PROPOSAL ONLY. Not an executable release migration; owner acceptance,
-- TEST schema compatibility and exact approval required. No GRANT or RLS policy
-- changes. Runtime EXECUTE/table privileges require verification, not assumption.
-- One approved channel/window per existing connector account. No tokens here.
create table if not exists public.slack_messages (
 id uuid primary key,
 tenant_id uuid not null,
 source_external_id text not null,
 team_id text not null,
 channel_id text not null,
 provider_timestamp text not null,
 thread_timestamp text,
 message_text text not null,
 updated_at timestamptz not null default now(),
 unique(tenant_id, source_external_id)
);
alter table public.slack_messages enable row level security;

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
begin
 if auth.role() is distinct from 'service_role' then raise exception 'history_service_role_required'; end if;
 if jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_next) is distinct from 'object'
  or not (p_expected ?& array['scopeKey','cursor','pages','complete'])
  or not (p_next ?& array['scopeKey','cursor','pages','complete'])
  or jsonb_typeof(p_expected->'pages') is distinct from 'number'
  or jsonb_typeof(p_next->'pages') is distinct from 'number'
  or jsonb_typeof(p_expected->'complete') is distinct from 'boolean'
  or jsonb_typeof(p_next->'complete') is distinct from 'boolean'
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
 if cfg is null or cfg->>'approved' is distinct from 'true'
  or coalesce(cfg->>'maxPages','') !~ '^[1-9]$|^10$' or coalesce(cfg->>'consentReference','')=''
  or coalesce(cfg->>'teamId','') !~ '^T[A-Z0-9]+$'
  or coalesce(cfg->>'channelId','') !~ '^C[A-Z0-9]+$'
  or coalesce(cfg->>'oldest','') !~ '^\d{1,12}\.\d{1,6}$'
  or coalesce(cfg->>'latest','') !~ '^\d{1,12}\.\d{1,6}$'
  or (cfg->>'oldest')::numeric>(cfg->>'latest')::numeric
  or (cfg->>'latest')::numeric-(cfg->>'oldest')::numeric>86400
  or cfg->>'expiresAt' is null or (cfg->>'expiresAt')::timestamptz<=now()
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
   or jsonb_typeof(r->'text') is distinct from 'string' or length(r->>'text')>40000
  then raise exception 'history_record_invalid'; end if;
  sid=md5(p_tenant_id::text||':'||(r->>'source_external_id'))::uuid;
  insert into public.slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,thread_timestamp,message_text)
   values(sid,p_tenant_id,r->>'source_external_id',cfg->>'teamId',cfg->>'channelId',r->>'provider_timestamp',r->>'thread_timestamp',r->>'text')
   on conflict(tenant_id,source_external_id) do update set message_text=excluded.message_text,thread_timestamp=excluded.thread_timestamp,updated_at=now();
  -- Reuse the single existing interaction/observation engine. No AI execution,
  -- event fan-out or consequential follow-on jobs are introduced by this page.
  insert into public.interactions(tenant_id,source_connector_id,source_type,source_table,source_id,source_external_id,interaction_type,direction,occurred_at,body_preview,metadata)
   values(p_tenant_id,'slack','chat','slack_messages',sid,r->>'source_external_id','slack_message','unknown',to_timestamp((r->>'provider_timestamp')::numeric),left(r->>'text',2000),jsonb_build_object('channel_id',cfg->>'channelId','coverage','bounded_history_page','threads','unverified','source_version',md5((r->>'text')||':'||coalesce(r->>'thread_timestamp',''))))
   on conflict(tenant_id,source_table,source_id) do update set body_preview=excluded.body_preview,metadata=excluded.metadata,
    processing_status=case when interactions.metadata->>'source_version' is distinct from excluded.metadata->>'source_version' then 'pending' else interactions.processing_status end;
 end loop;
 update public.connector_accounts set sync_cursor=p_next where id=p_account_id and tenant_id=p_tenant_id;
 return true;
end $$;
