-- Generated TEST-only company-scoped Slack operator reads. No source imports or schedules.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target/checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_threads_v1' and source_sha256='c476f687762c1bb648c7ecdd7bd9bdb054b1d7f5ccc9cb43af17468991edf5ce' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Verified thread prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_operator_reads_v1') then raise exception 'Slack operator release already exists';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['learn_slack_accounts_read','learn_slack_threads_read'])) then raise exception 'Operator functions already exist';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_slack_claim_jobs') is distinct from 'b0c3946281c3ac19f0e2cb496f7b4db9' then raise exception 'Reviewed learn_slack_claim_jobs differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_slack_commit_page_private') is distinct from 'b9a282e4b2b5ec660434c5f9c01b41dd' then raise exception 'Reviewed learn_slack_commit_page_private differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_slack_finish_job') is distinct from '81d5f1054a3a67d137f419b86bd22584' then raise exception 'Reviewed learn_slack_finish_job differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_slack_finish_thread_job') is distinct from '7b09bac588f419569f6afa382b776107' then raise exception 'Reviewed learn_slack_finish_thread_job differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_slack_read_credential') is distinct from '33baf10ed6a97e135a511514a61e80c6' then raise exception 'Reviewed learn_slack_read_credential differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_slack_read_thread_credential') is distinct from 'ef4ea3c0eb4cbeeacfe37edd26cdc9ab' then raise exception 'Reviewed learn_slack_read_thread_credential differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_slack_start_thread_import') is distinct from 'a2b4d2c8643c2965cd008ed258e0c427' then raise exception 'Reviewed learn_slack_start_thread_import differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_slack_store_records') is distinct from '77f3785577d69ea791fccc2dcd432b98' then raise exception 'Reviewed learn_slack_store_records differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_slack_thread_immutable') is distinct from '7feaa8426874273065fbd1f9e97de5fa' then raise exception 'Reviewed learn_slack_thread_immutable differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='platform_jobs_claim') is distinct from 'ce2fcc492800b8bfca7fed9d4a244232' then raise exception 'Reviewed platform_jobs_claim differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='platform_jobs_complete_email_v1') is distinct from '78103231f68fcbdd9fc2f21c3639ee62' then raise exception 'Reviewed platform_jobs_complete_email_v1 differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='slack_history_commit_page') is distinct from '1a899d4787d1b5f0d9db0b690562b9af' then raise exception 'Reviewed slack_history_commit_page differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='slack_thread_commit_page') is distinct from '7fabf9b3ccf1868dcb64995bd166f9c1' then raise exception 'Reviewed slack_thread_commit_page differs';end if;
end $$;
-- SOURCE supabase/migrations/20261030140000_learn_slack_operator_reads.sql
-- SHA-256 5771f64d34218713784172aa345255a651641d93d8b161b646d75fc23f8ca5ad
-- Company-scoped read models for stored Slack channels and observed threads.
-- No provider request, approval, queue mutation, credential or table grant.

create function public.learn_slack_accounts_read(p_tenant_id uuid,p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare rows jsonb;more boolean;last_id uuid;begin
 if auth.uid() is null or p_tenant_id is null or p_tenant_id is distinct from public.current_tenant_id() then
  raise exception 'Company access required' using errcode='42501';end if;
 with candidates as (
  select a.id,a.display_name,a.status,a.settings->'slack_history'->>'teamId' as team_id,a.settings->'slack_history'->>'channelId' as channel_id
  from public.connector_accounts a join public.tenant_connectors c on c.id=a.tenant_connector_id and c.tenant_id=a.tenant_id
  where a.tenant_id=p_tenant_id and c.connector_id='slack' and a.settings ? 'slack_history'
   and (p_after_id is null or a.id>p_after_id) order by a.id limit 21
 ), page as (select * from candidates order by id limit 20)
 select coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',coalesce(display_name,channel_id),'status',status,'teamId',team_id,'channelId',channel_id) order by id) from page),'[]'),
 (select count(*)>20 from candidates),(select id from page order by id desc limit 1) into rows,more,last_id;
 return jsonb_build_object('version','learn-slack-accounts/1','tenantId',p_tenant_id,'accounts',rows,'nextCursor',case when more then last_id else null end);
end $$;

create function public.learn_slack_threads_read(p_tenant_id uuid,p_account_id uuid,p_before_parent text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare a public.connector_accounts%rowtype;c public.provider_connections%rowtype;cfg jsonb;rows jsonb;more boolean;last_parent text;can_import boolean;begin
 if auth.uid() is null or p_tenant_id is null or p_tenant_id is distinct from public.current_tenant_id() then
  raise exception 'Company access required' using errcode='42501';end if;
 if p_account_id is null or p_before_parent is not null and p_before_parent !~ '^\d{1,12}\.\d{1,6}$' then
  raise exception 'Invalid thread page' using errcode='22023';end if;
 select a1.* into a from public.connector_accounts a1 join public.tenant_connectors tc on tc.id=a1.tenant_connector_id and tc.tenant_id=a1.tenant_id
  where a1.id=p_account_id and a1.tenant_id=p_tenant_id and tc.connector_id='slack';
 if not found then raise exception 'Stored Slack channel unavailable' using errcode='42501';end if;
 cfg:=a.settings->'slack_history';
 select * into c from public.provider_connections where id=(cfg->>'connectionId')::uuid and tenant_id=p_tenant_id and provider='slack';
 can_import:=found and a.status='active' and c.status='configured' and c.revoked_at is null
  and c.non_secret_config->>'team_id'=cfg->>'teamId' and 'bot_token'=any(c.configured_fields)
  and c.secret_refs->>'bot_token' is not null and exists(select 1 from public.tenant_connectors tc where tc.id=a.tenant_connector_id and tc.tenant_id=p_tenant_id and tc.enabled and tc.status='active');
 with observed as (
  select m.*,case when m.thread_timestamp is not null and m.thread_timestamp<>m.provider_timestamp then m.thread_timestamp else m.provider_timestamp end as parent
  from public.slack_messages m where m.tenant_id=p_tenant_id and m.team_id=cfg->>'teamId' and m.channel_id=cfg->>'channelId'
  and ((m.thread_timestamp is not null and m.thread_timestamp<>m.provider_timestamp)
   or case when coalesce(m.provider_payload->>'reply_count','') ~ '^[0-9]+$' then (m.provider_payload->>'reply_count')::numeric>0 else false end)
 ), roots as (
  select distinct on (parent::numeric) id,source_version,message_text,provider_timestamp,parent
  from observed where (p_before_parent is null or parent::numeric<p_before_parent::numeric)
  order by parent::numeric desc,(provider_timestamp=parent) desc,source_updated_at desc,id
 ), candidates as (select * from roots order by parent::numeric desc limit 21), page as (select * from candidates order by parent::numeric desc limit 20),
 detail as (
  select p.*,t.id as import_id,t.approved_at,t.definition,t.checkpoint,t.scope,j.id as job_id,j.status as job_status,j.available_at,j.error_code,j.result
  from page p left join lateral (select t1.* from public.slack_thread_imports t1 where t1.tenant_id=p_tenant_id and t1.account_id=p_account_id and (t1.scope->>'parentTimestamp')::numeric=p.parent::numeric order by t1.approved_at desc,t1.id desc limit 1)t on true
  left join lateral (select j1.* from public.platform_jobs j1 where j1.tenant_id=p_tenant_id and j1.job_type='slack.thread_sync'
   and j1.payload->>'thread_import_id'=t.id::text and j1.payload->>'connector_account_id'=p_account_id::text order by j1.created_at desc,j1.id desc limit 1)j on true
 ) select coalesce((select jsonb_agg(jsonb_build_object('sourceId',id,'sourceVersion',source_version,'parentTimestamp',parent,'observedTimestamp',provider_timestamp,
  'excerpt',left(message_text,400),'latestImport',case when import_id is null then null else jsonb_build_object('id',import_id,'approvedAt',approved_at,'start',definition->>'start','end',definition->>'end',
   'pages',coalesce((checkpoint->>'pages')::integer,0),'pageLimit',(scope->>'maxPages')::integer,'complete',coalesce((checkpoint->>'complete')::boolean,false),
   'status',job_status,'availableAt',case when job_status in ('queued','retrying') then available_at else null end,
   'errorCode',case when error_code ~ '^slack_history_[a-z_]{1,80}$' then error_code else null end,
   'stopReason',case when result->>'stopReason' in ('window_pages_complete','page_budget_exhausted','run_page_limit','authorisation_changed') then result->>'stopReason' else null end) end) order by parent::numeric desc) from detail),'[]'),
  (select count(*)>20 from candidates),(select parent from page order by parent::numeric limit 1) into rows,more,last_parent;
 return jsonb_build_object('version','learn-slack-threads/1','tenantId',p_tenant_id,'accountId',p_account_id,'teamId',cfg->>'teamId','channelId',cfg->>'channelId',
  'canImport',coalesce(can_import,false),'connectionRevision',c.updated_at,'threads',rows,'nextCursor',case when more then last_parent else null end,'coverage','observed_threads_only');
end $$;
revoke all on function public.learn_slack_accounts_read(uuid,uuid),public.learn_slack_threads_read(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.learn_slack_accounts_read(uuid,uuid),public.learn_slack_threads_read(uuid,uuid,text) to authenticated;

insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'learn_slack_operator_reads_v1','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
