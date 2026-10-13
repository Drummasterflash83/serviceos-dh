-- Supplemental one-source public revalidation. No campaign/source/cursor mutation
-- occurs on installation. Existing authenticated dispatch and service worker only.
begin;
set local search_path=pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$begin
if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from '17b4d8ea7b4fae2d59fb3d1d1f3c68ad5913c06bfeea119c61d6943ba9df9c83' then raise exception 'Exact replay release target/source/role required';end if;
if to_regclass('public.slack_campaign_source_replays') is not null then raise exception 'Replay storage exists; inspect before retry';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_card_communications_read(uuid,uuid,uuid,uuid,uuid[])'::regprocedure) is distinct from 'fe5cb8bd96f3c5e4cc49141b5da2bda7|learn_card_communication_reader|{learn_card_communication_reader=X/learn_card_communication_reader,authenticated=X/learn_card_communication_reader}' then raise exception 'Prior learn_card_communications_read definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_card_slack_job_context(uuid,uuid,uuid)'::regprocedure) is distinct from '17ee19d5f244e41cbf243532b5b0e5b6|postgres|{postgres=X/postgres,learn_card_communication_reader=X/postgres}' then raise exception 'Prior learn_card_slack_job_context definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)'::regprocedure) is distinct from 'c967a5f2ca314bb6c0d73ef379e5f0ed|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Prior learn_slack_campaign_dispatch definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_job_allowed(uuid,uuid)'::regprocedure) is distinct from '3bbe4369a69b2657ffe228fdba4332cd|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Prior learn_slack_campaign_job_allowed definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_reserve_request(uuid,uuid,text,integer,integer)'::regprocedure) is distinct from 'f2ad8d3280a6c89294259d970e0b7f4f|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Prior learn_slack_campaign_reserve_request definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_claim_jobs(uuid,integer)'::regprocedure) is distinct from '9705883d6e6587baf6e9bced29673a8d|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Prior learn_slack_claim_jobs definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure) is distinct from '5a5bac1bac364e7fd75f85aaa867c7c7|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Prior learn_slack_finish_job definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_read_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid)'::regprocedure) is distinct from 'd9a90fb054d2379288abb191999f2e33|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Prior learn_slack_read_credential definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.slack_commit_attested_page(uuid,uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb,jsonb)'::regprocedure) is distinct from '7e97b224d3dc219202f5eba08b9e17bd|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Prior slack_commit_attested_page definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.slack_history_commit_page(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb)'::regprocedure) is distinct from '1a899d4787d1b5f0d9db0b690562b9af|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Prior slack_history_commit_page definition/access differs';end if;
end$guard$;

create table public.slack_campaign_source_replays(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 campaign_id uuid not null,account_id uuid not null references public.connector_accounts(id),
 actor_id uuid not null references public.profiles(id),source_message_id uuid not null references public.slack_messages(id),
 source_version text not null check(source_version ~ '^[a-f0-9]{64}$'),
 definition jsonb not null,scope jsonb not null,job_id uuid unique references public.platform_jobs(id),
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(campaign_id,tenant_id) references public.slack_history_campaigns(id,tenant_id)
);
alter table public.slack_campaign_source_replays enable row level security;
revoke all on public.slack_campaign_source_replays from public,anon,authenticated,service_role;
create trigger slack_source_replay_immutable before update or delete on public.slack_campaign_source_replays for each row execute function public.slack_version_immutable();
create trigger slack_source_replay_no_truncate before truncate on public.slack_campaign_source_replays for each statement execute function public.slack_version_immutable();

create function public.learn_slack_source_replay_allowed(p_tenant uuid,p_job uuid) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select coalesce(auth.role()='service_role' and exists(
 select 1 from public.platform_jobs j
 join public.slack_campaign_source_replays r on r.job_id=j.id and r.tenant_id=j.tenant_id and r.id::text=j.payload->>'source_replay_id'
 join public.slack_history_campaigns h on h.id=r.campaign_id and h.tenant_id=r.tenant_id
 join public.slack_history_campaign_channels m on m.campaign_id=h.id and m.tenant_id=h.tenant_id and m.account_id=r.account_id
 join public.connector_accounts a on a.id=r.account_id and a.tenant_id=r.tenant_id
 join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=a.tenant_id
 join public.profiles actor on actor.id=r.actor_id
 join public.slack_messages s on s.id=r.source_message_id and s.tenant_id=r.tenant_id
 where j.id=p_job and j.tenant_id=p_tenant and j.job_type='slack.history_sync'
 and j.job_key='slack.source-replay:'||r.id::text and j.created_by=r.actor_id
 and j.payload->>'connector_account_id'=a.id::text and j.payload->>'campaign_id'=h.id::text
 and public.learn_slack_campaign_authority(h.id)
 and r.receipt->>'state'='committed' and r.scope->>'campaignId'=h.id::text
 and (r.scope->>'expiresAt')::timestamptz=h.expires_at
 and r.definition->>'connectionRevision'=h.connection_revision::text
 and a.status='active' and a.settings->'slack_history'->>'campaignId'=h.id::text
 and a.settings->'slack_history'->>'connectionId'=h.connection_id::text
 and a.settings->'slack_history'->'approved'='true'::jsonb
 and tc.connector_id='slack' and tc.enabled and tc.status='active'
 and s.team_id=h.team_id and s.channel_id=m.channel_id and s.source_version=r.source_version
 and r.scope->>'teamId'=s.team_id and r.scope->>'channelId'=s.channel_id
 and s.provider_timestamp::numeric between extract(epoch from h.starts_at) and extract(epoch from h.ends_at)
 and ((actor.tenant_id=h.tenant_id and actor.role in('owner','admin')) or exists(select 1 from public.platform_authority_grants g
  where g.profile_id=actor.id and g.permission='platform.controlplane.admin'
  and coalesce(g.effective_from,'-infinity')<=clock_timestamp() and coalesce(g.effective_to,'infinity')>clock_timestamp()))),false)
$$;
revoke all on function public.learn_slack_source_replay_allowed(uuid,uuid) from public,anon,authenticated;
grant execute on function public.learn_slack_source_replay_allowed(uuid,uuid) to service_role;

create function public.learn_slack_campaign_source_replay(p_tenant uuid,p_request uuid,p_input jsonb,p_mode text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.slack_campaign_source_replays%rowtype;h public.slack_history_campaigns%rowtype;
 m public.slack_messages%rowtype;a public.connector_accounts%rowtype;scope jsonb;answer jsonb;definition jsonb;
 jid uuid:=gen_random_uuid();ts numeric;parent text;begin
 perform public.learn_slack_control_access(p_tenant,true,'start_history');
 if auth.role() is distinct from 'authenticated' or auth.uid() is null or current_setting('transaction_isolation')<>'read committed'
 or p_request is null or p_mode not in('apply','check','cancel') or p_mode is null
 or jsonb_typeof(p_input) is distinct from 'object'
 or not(p_input ?& array['campaignId','sourceMessageId','sourceVersion','reason'])
 or p_input-array['campaignId','sourceMessageId','sourceVersion','reason']<>'{}'
 or jsonb_typeof(p_input->'reason') is distinct from 'string' or length(btrim(p_input->>'reason')) not between 1 and 1000
 or coalesce(p_input->>'sourceVersion','') !~ '^[a-f0-9]{64}$' then raise exception 'slack_replay_definition_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-source-replay:'||p_request::text,0));
 select * into prior from public.slack_campaign_source_replays where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>auth.uid() or prior.definition->'request'<>p_input then raise exception 'slack_replay_request_changed' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 select * into h from public.slack_history_campaigns where id=(p_input->>'campaignId')::uuid and tenant_id=p_tenant for share;
 if not found then raise exception 'slack_replay_campaign_unavailable' using errcode='42501';end if;
 select * into m from public.slack_messages where id=(p_input->>'sourceMessageId')::uuid and tenant_id=p_tenant for share;
 if not found or m.source_version<>p_input->>'sourceVersion' or m.team_id<>h.team_id
 or public.learn_slack_message_kind(m.provider_payload)<>'conversation' then raise exception 'slack_replay_source_changed' using errcode='PT409';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-source-replay-source:'||p_tenant::text||':'||m.id::text,0));
 select ca.* into a from public.connector_accounts ca join public.slack_history_campaign_channels cm on cm.account_id=ca.id and cm.tenant_id=ca.tenant_id
 where cm.campaign_id=h.id and cm.tenant_id=p_tenant and cm.channel_id=m.channel_id for share of ca;
 if not found or a.settings->'slack_history'->>'campaignId' is distinct from h.id::text then raise exception 'slack_replay_campaign_owned_scope_required' using errcode='55000';end if;
 answer:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'state',case when p_mode='cancel' then 'cancelled' else 'pending' end);
 if p_mode='check' then return answer;end if;
 ts:=m.provider_timestamp::numeric;
 if ts<=extract(epoch from h.starts_at) or ts>=extract(epoch from h.ends_at)
 or ts<0.000001 or ts>extract(epoch from clock_timestamp()) then raise exception 'slack_replay_source_outside_scope' using errcode='22023';end if;
 parent:=case when m.thread_timestamp is not null and m.thread_timestamp<>m.provider_timestamp then m.thread_timestamp end;
 if parent is not null and (parent !~ '^\d{1,12}\.\d{1,6}$' or parent::numeric>ts) then raise exception 'slack_replay_thread_evidence_invalid' using errcode='22023';end if;
 definition:=jsonb_build_object('request',p_input,'connectionRevision',h.connection_revision::text,'sourceTimestamp',m.provider_timestamp);
 scope:=jsonb_build_object('approved',true,'campaignId',h.id,'connectionId',h.connection_id,'teamId',h.team_id,'channelId',m.channel_id,
 'oldest',to_char(ts-0.000001,'FM999999999999.000000'),'latest',to_char(ts+0.000001,'FM999999999999.000000'),
 'consentReference','learn-slack-source-replay:'||p_request::text,'expiresAt',h.expires_at,'maxPages',1)
 ||case when parent is null then '{}'::jsonb else jsonb_build_object('parentTimestamp',parent) end;
 if p_mode='apply' then
  if not public.learn_slack_campaign_authority(h.id) or h.requests_reserved>=h.request_budget or a.status<>'active' then
   raise exception 'slack_replay_campaign_unavailable' using errcode='55000';end if;
  if exists(select 1 from public.slack_campaign_source_replays r join public.platform_jobs j on j.id=r.job_id
   where r.tenant_id=p_tenant and r.source_message_id=m.id and r.source_version=m.source_version and j.status in('queued','running','retrying')) then
   raise exception 'slack_replay_already_active' using errcode='55000';end if;
  insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
  values(jid,p_tenant,'slack','slack.history_sync','slack.source-replay:'||p_request::text,'queued',3,clock_timestamp(),
   jsonb_build_object('connector_account_id',a.id,'campaign_id',h.id,'source_replay_id',p_request),auth.uid());
  answer:=answer||jsonb_build_object('state','committed','jobId',jid);
 else jid:=null;end if;
 insert into public.slack_campaign_source_replays(id,tenant_id,campaign_id,account_id,actor_id,source_message_id,source_version,definition,scope,job_id,receipt)
 values(p_request,p_tenant,h.id,a.id,auth.uid(),m.id,m.source_version,definition,scope,jid,answer);
 return answer;
end$$;
revoke all on function public.learn_slack_campaign_source_replay(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;

create function public.learn_slack_source_replay_scope(p_tenant uuid,p_job uuid,p_claimed_by text,p_attempt integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;r public.slack_campaign_source_replays%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_replay_forbidden' using errcode='42501';end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant;
 if not found or j.status<>'running' or j.claimed_by is distinct from p_claimed_by or p_claimed_by is null
 or j.attempt_count is distinct from p_attempt or j.lease_expires_at<=clock_timestamp() or j.lease_expires_at is null
 or j.metadata ? 'slack_page_v1' or not public.learn_slack_source_replay_allowed(p_tenant,p_job) then return null;end if;
 select * into r from public.slack_campaign_source_replays where job_id=j.id and tenant_id=p_tenant;
 return jsonb_build_object('replayId',r.id,'accountId',r.account_id,'sourceId',r.source_message_id,'sourceVersion',r.source_version,
 'timestamp',r.definition->>'sourceTimestamp','scope',r.scope);
end$$;
revoke all on function public.learn_slack_source_replay_scope(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.learn_slack_source_replay_scope(uuid,uuid,text,integer) to service_role;

create function public.learn_slack_commit_source_replay(p_tenant uuid,p_job uuid,p_claimed_by text,p_attempt integer,p_records jsonb,p_visibility jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;r public.slack_campaign_source_replays%rowtype;s public.slack_messages%rowtype;
c public.provider_connections%rowtype;cfg jsonb;page_hash text;rid uuid;vid uuid;matched boolean;result_state text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_replay_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_replay_snapshot' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant for update;
 if not found or j.status<>'running' or j.job_type<>'slack.history_sync' or j.claimed_by is distinct from p_claimed_by
 or p_claimed_by is null or j.attempt_count is distinct from p_attempt or p_attempt is null
 or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 select * into r from public.slack_campaign_source_replays where job_id=j.id and tenant_id=p_tenant;
 if not found or j.payload->>'source_replay_id' is distinct from r.id::text then raise exception 'slack_replay_identity' using errcode='PT409';end if;
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>1 or octet_length(p_records::text)>300000 then raise exception 'slack_replay_page_invalid' using errcode='22023';end if;
 page_hash:=encode(sha256(convert_to(jsonb_build_object('records',p_records,'visibility',p_visibility)::text,'UTF8')),'hex');
 if j.metadata ? 'slack_page_v1' then
  if j.metadata->'slack_page_v1'->>'kind'='source_replay' and j.metadata->'slack_page_v1'->>'replay_id'=r.id::text
   and j.metadata->'slack_page_v1'->>'page_hash'=page_hash then return true;end if;
  raise exception 'slack_replay_commit_changed' using errcode='PT409';
 end if;
 if not public.learn_slack_source_replay_allowed(p_tenant,p_job)
 or not exists(select 1 from public.slack_history_campaign_dispatches where campaign_id=r.campaign_id and tenant_id=p_tenant and job_id=j.id and attempt=p_attempt)
 then raise exception 'slack_replay_authority_changed' using errcode='PT409';end if;
 cfg:=r.scope;
 select * into c from public.provider_connections where id=(cfg->>'connectionId')::uuid and tenant_id=p_tenant
  and provider='slack' and status='configured' and revoked_at is null and non_secret_config->>'team_id'=cfg->>'teamId' for share;
 if not found then raise exception 'slack_replay_connection_changed' using errcode='PT409';end if;
 if jsonb_typeof(p_visibility) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_visibility))<>14
  or not(p_visibility ?& array['version','connection_id','connection_revision','team_id','channel_id','is_channel','is_private','is_im','is_mpim','is_shared','is_ext_shared','is_org_shared','is_pending_ext_shared','pending_shared'])
  or p_visibility->>'version' is distinct from 'slack-capture-visibility/1'
  or p_visibility->>'connection_id' is distinct from c.id::text
  or (p_visibility->>'connection_revision')::timestamptz is distinct from c.updated_at
  or p_visibility->>'team_id' is distinct from cfg->>'teamId' or p_visibility->>'channel_id' is distinct from cfg->>'channelId'
  or p_visibility->'is_channel' is distinct from 'true'::jsonb or p_visibility->'is_private' is distinct from 'false'::jsonb
  or p_visibility->'is_shared' is distinct from 'false'::jsonb or p_visibility->'pending_shared' is distinct from 'false'::jsonb
  or exists(select 1 from unnest(array['is_im','is_mpim','is_ext_shared','is_org_shared','is_pending_ext_shared']) f
   where p_visibility->f not in('false'::jsonb,'null'::jsonb))
 then raise exception 'slack_visibility_not_public' using errcode='22023';end if;

 select * into s from public.slack_messages where id=r.source_message_id and tenant_id=p_tenant for share;
 if not found or s.source_version<>r.source_version then raise exception 'slack_replay_source_changed' using errcode='PT409';end if;
 if jsonb_array_length(p_records)=1 and (p_records->0->>'tenant_id' is distinct from p_tenant::text
  or p_records->0->>'source_external_id' is distinct from s.source_external_id
  or p_records->0->>'channel_id' is distinct from s.channel_id
  or p_records->0->>'provider_timestamp' is distinct from s.provider_timestamp
  or p_records->0->'provider_payload'->>'ts' is distinct from s.provider_timestamp
  or jsonb_typeof(p_records->0->'provider_payload') is distinct from 'object')
 then raise exception 'slack_replay_returned_wrong_source' using errcode='22023';end if;
 matched:=jsonb_array_length(p_records)=1 and p_records->0->'provider_payload'=s.provider_payload
  and encode(sha256(convert_to((p_records->0->'provider_payload')::text,'UTF8')),'hex')=r.source_version;
 result_state:=case when matched then 'exact_source_verified' when jsonb_array_length(p_records)=0 then 'source_unavailable' else 'source_changed' end;
 if matched then
  select id into vid from public.slack_message_versions where tenant_id=p_tenant and message_id=s.id and source_version=r.source_version and provider_payload=s.provider_payload;
  if not found then raise exception 'slack_replay_version_missing' using errcode='PT409';end if;
  insert into public.slack_channel_visibility_receipts(tenant_id,job_id,account_id,claimed_by,attempt_count,connection_id,connection_revision,team_id,channel_id,evidence,evidence_sha256,page_sha256)
  values(p_tenant,j.id,r.account_id,p_claimed_by,p_attempt,c.id,c.updated_at,cfg->>'teamId',cfg->>'channelId',p_visibility,
   encode(sha256(convert_to(p_visibility::text,'UTF8')),'hex'),page_hash) returning id into rid;
  insert into public.slack_source_visibility_proofs(receipt_id,version_id) values(rid,vid);
 end if;
 update public.platform_jobs set metadata=coalesce(metadata,'{}')||jsonb_build_object('slack_page_v1',jsonb_build_object(
  'kind','source_replay','replay_id',r.id,'account_id',r.account_id,'page_hash',page_hash,'state',result_state,
  'records_processed',case when matched then 1 else 0 end,'committed_at',clock_timestamp())) where id=j.id;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 return true;
end$$;
revoke all on function public.learn_slack_commit_source_replay(uuid,uuid,text,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.learn_slack_commit_source_replay(uuid,uuid,text,integer,jsonb,jsonb) to service_role;

-- Exact insertion points retain existing privileges, normal history behaviour,
-- global request accounting, pacing and 429/retry settlement.
do $$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)'::regprocedure);
 needle:=' if p_operation=''start'' then';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Replay dispatch baseline differs';end if;
 execute replace(d,needle,' if p_operation=''replay_source'' then return public.learn_slack_campaign_source_replay(p_tenant,p_request,p_input,p_mode);end if;'||chr(10)||needle);
 d:=pg_get_functiondef('public.learn_slack_campaign_job_allowed(uuid,uuid)'::regprocedure);
 needle:=' select * into a from public.connector_accounts';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Replay authority baseline differs';end if;
 execute replace(d,needle,' if j.payload ? ''source_replay_id'' then return public.learn_slack_source_replay_allowed(p_tenant,p_job);end if;'||chr(10)||needle);
 d:=pg_get_functiondef('public.slack_history_commit_page(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb)'::regprocedure);
 needle:=' receipt:=j.metadata->''slack_page_v1'';';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Replay commit baseline differs';end if;
 execute replace(d,needle,' if j.payload ? ''source_replay_id'' then raise exception ''slack_replay_requires_dedicated_commit'' using errcode=''PT409'';end if;'||chr(10)||needle);
 d:=pg_get_functiondef('public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure);
 needle:=' if p_outcome->''success''=''true''::jsonb then';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Replay settlement baseline differs';end if;
 replacement:=$patch$ if j.payload ? 'source_replay_id' and p_outcome->'success'='true'::jsonb then
  if p_outcome<>'{"success":true}'::jsonb then raise exception 'slack_queue_invalid' using errcode='22023';end if;
  page:=j.metadata->'slack_page_v1';
  if page is null then raise exception 'slack_queue_page_missing' using errcode='PT409';end if;
  if page->>'kind' is distinct from 'source_replay' or page->>'replay_id' is distinct from j.payload->>'source_replay_id'
   or page->>'account_id' is distinct from j.payload->>'connector_account_id'
   or page->>'state' not in('exact_source_verified','source_unavailable','source_changed')
   or j.job_key is distinct from 'slack.source-replay:'||(j.payload->>'source_replay_id')
  then raise exception 'slack_queue_identity' using errcode='PT409';end if;
  result_doc:=jsonb_build_object('coverage','one_retained_source_revalidation','state',page->>'state','replayId',page->>'replay_id','ingestion_complete',false);
  next_status:='succeeded';
  update public.platform_jobs set status='succeeded',completed_at=clock_timestamp(),lease_expires_at=null,error_code=null,result=result_doc,
   records_processed=(page->>'records_processed')::integer where id=j.id;
 elsif p_outcome->'success'='true'::jsonb then$patch$;
 execute replace(d,needle,replacement);
end$$;
notify pgrst,'reload schema';
commit;
