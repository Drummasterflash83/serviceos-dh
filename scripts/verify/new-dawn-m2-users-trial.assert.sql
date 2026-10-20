-- Disposable, network-isolated PostgreSQL only. Exercises the real restore RPC.
create role authenticated;
create role anon;
create role service_role;
create schema auth;
create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function public.learn_operator_input_access(p_tenant uuid,p_actor uuid,p_write boolean)
returns void language plpgsql as $$begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is distinct from p_actor
  or p_tenant is null or not p_write then raise exception 'fixture_forbidden' using errcode='42501';end if;
end$$;
create function public.fixture_id(n integer) returns uuid language sql immutable as
$$select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create table public.controlplane_change_log(id uuid primary key default gen_random_uuid(),tenant_id uuid,
 actor text,action text,resource_type text,resource_id text,before jsonb default '{}',after jsonb default '{}',
 reason text,correlation_id text,view_as_active boolean default false,source text,created_at timestamptz default clock_timestamp());
create table public.learn_operator_input_requests(id uuid primary key,tenant_id uuid,actor_id uuid,
 definition jsonb,receipt jsonb,previous_state jsonb,created_at timestamptz default clock_timestamp());
create table public.learn_commusoft_recurring(account_id uuid primary key,tenant_id uuid,connection_id uuid,
 enabled boolean,phase integer,current_request uuid,last_state text,revision bigint,next_check_at timestamptz,
 updated_at timestamptz);
create table public.connector_accounts(id uuid primary key,tenant_id uuid,status text,settings jsonb,sync_cursor jsonb);
create table public.platform_jobs(id uuid primary key,tenant_id uuid,job_type text,job_key text,status text,payload jsonb,
 lease_expires_at timestamptz,completed_at timestamptz,dead_lettered_at timestamptz,result jsonb,metadata jsonb);
create table public.learn_business_input_pages(id uuid primary key,tenant_id uuid,connection_id uuid,
 provider text,collection text,job_id uuid,record_count integer,checkpoint_after jsonb);
create table public.learn_business_input_observations(page_id uuid,ordinal integer);
create table public.feature_flags(id uuid primary key default gen_random_uuid(),tenant_id uuid,flag text,value jsonb,
 unique(tenant_id,flag));

create function public.fixture_users_trial(p_has_more boolean,p_job_status text default 'succeeded',
 p_drift text default '') returns void language plpgsql as $$
declare t uuid:=fixture_id(100); actor uuid:=fixture_id(180); account uuid:=fixture_id(103);
 connection uuid:=fixture_id(105); arm uuid:=fixture_id(111); request uuid:=fixture_id(112);
 job uuid:=fixture_id(113); page uuid:=fixture_id(114);
 old_cfg jsonb:=jsonb_build_object('approvalId',fixture_id(90),'connectionId',connection,
  'resource','jobs','maxPages',2,'pageSize',10);
 old_cp jsonb:=jsonb_build_object('approvalId',fixture_id(90),'pages',2,'complete',true,'after',null);
 cp jsonb;
begin
 truncate public.controlplane_change_log,public.learn_operator_input_requests,public.learn_commusoft_recurring,
  public.connector_accounts,public.platform_jobs,public.learn_business_input_pages,
  public.learn_business_input_observations,public.feature_flags;
 cp:=jsonb_build_object('approvalId',request,'pages',1,'complete',not p_has_more,
  'after',case when p_has_more then to_jsonb(71) else 'null'::jsonb end);
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,before,after,
  reason,correlation_id,source,created_at) values(arm,t,actor::text,'learn.commusoft.users_trial.arm',
  'connector_account',account::text,
  jsonb_build_object('approval',old_cfg,'checkpoint',old_cp,'recurring_state','idle','recurring_revision',1),
  '{"users_flag":"on","recurring_state":"paused"}'::jsonb,'Synthetic arm',arm::text,
  'new-dawn-m2-users-trial',clock_timestamp()-interval '1 minute');
 insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt,previous_state)
 values(request,t,actor,jsonb_build_object('kind','start_commusoft','resource','users','max_pages',1,
  'page_size',10,'connection_id',connection,'expires_at','2026-12-31T00:00:00Z'),jsonb_build_object('state','recorded',
  'kind','start_commusoft','account_id',account,'job_id',job),
  jsonb_build_object('approval',old_cfg,'checkpoint',old_cp));
 insert into public.learn_commusoft_recurring values(account,t,connection,false,0,null,
  'source_user_trial_paused',2,clock_timestamp(),clock_timestamp());
 insert into public.connector_accounts values(account,t,'active',jsonb_build_object('commusoft_import',
  jsonb_build_object('approved',true,'resource','users','approvalId',request,'connectionId',connection,
  'consentReference','learn-operator-input:'||request::text,'expiresAt','2026-12-31T00:00:00Z',
  'maxPages',1,'pageSize',10)),case when p_job_status='dead_letter' then '{}'::jsonb else cp end);
 insert into public.feature_flags(tenant_id,flag,value)
 values(t,'learn.inputs.commusoft.users.enabled','true'::jsonb);
 insert into public.platform_jobs values(job,t,'commusoft.source_sync',
  'commusoft.source:'||account::text||':'||request::text,p_job_status,
  jsonb_build_object('connector_account_id',account),null,
  case when p_job_status='succeeded' then clock_timestamp() end,
  case when p_job_status='dead_letter' then clock_timestamp() end,
  jsonb_build_object('stop_reason',case when p_has_more then 'page_budget_exhausted' else 'collection_exhausted' end),
  jsonb_build_object('commusoft_page_v1',jsonb_build_object('pageId',page)));
 if p_job_status='succeeded' then
  insert into public.learn_business_input_pages values(page,t,connection,'commusoft','users',job,2,cp);
  insert into public.learn_business_input_observations values(page,1),(page,2);
 end if;
 if p_drift='approval' then
  update public.connector_accounts set settings=jsonb_set(settings,'{commusoft_import,approvalId}',to_jsonb(fixture_id(199)::text));
 elsif p_drift='cursor' then
  update public.connector_accounts set sync_cursor=jsonb_set(sync_cursor,'{pages}','2'::jsonb);
 elsif p_drift='extra_scope' then
  update public.connector_accounts set settings=jsonb_set(settings,'{commusoft_import,unexpected}','true'::jsonb);
 elsif p_drift='expiry' then
  update public.connector_accounts set settings=jsonb_set(settings,'{commusoft_import,expiresAt}',
   '"2027-01-01T00:00:00Z"'::jsonb);
 end if;
end$$;

set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';
do $$declare result jsonb;held integer;begin
 -- A full first page with hasMore=true is a terminal page-budget receipt,
 -- not a completed traversal. Restore must still free the ordinary scheduler.
 perform fixture_users_trial(true);
 result:=learn_commusoft_users_trial_restore(fixture_id(100),fixture_id(111),fixture_id(112),
  fixture_id(180),'Synthetic close','finish');
 assert result->>'records'='2' and result->>'held'='true';
 assert (select enabled and revision=3 and last_state='source_user_trial_restored'
  from learn_commusoft_recurring where account_id=fixture_id(103));
 assert (select sync_cursor->>'approvalId'=fixture_id(90)::text
  from connector_accounts where id=fixture_id(103));
 assert (select value='false'::jsonb from feature_flags where tenant_id=fixture_id(100));
 assert (select count(*) from learn_business_input_pages where collection='users')=1;
 result:=learn_commusoft_users_trial_restore(fixture_id(100),fixture_id(111),fixture_id(112),
  fixture_id(180),'Synthetic close','finish');
 assert result->>'records'='2';
 assert (select count(*) from controlplane_change_log where action='learn.commusoft.users_trial.restore')=1;

 -- hasMore=false also restores, without deleting the retained source page.
 perform fixture_users_trial(false);
 result:=learn_commusoft_users_trial_restore(fixture_id(100),fixture_id(111),fixture_id(112),
  fixture_id(180),'Synthetic close','finish');
 assert result->>'records'='2';
 assert (select count(*) from learn_business_input_pages where collection='users')=1;

 -- A retrying job, altered approval or altered cursor cannot be restored.
 perform fixture_users_trial(true,'retrying');
 begin
  perform learn_commusoft_users_trial_restore(fixture_id(100),fixture_id(111),fixture_id(112),
   fixture_id(180),'Synthetic close','finish');
  raise exception 'unsettled job restored';
 exception when sqlstate '55000' then null;end;
 assert (select not enabled from learn_commusoft_recurring where account_id=fixture_id(103));
 perform fixture_users_trial(true,'succeeded','approval');
 begin
  perform learn_commusoft_users_trial_restore(fixture_id(100),fixture_id(111),fixture_id(112),
   fixture_id(180),'Synthetic close','finish');
  raise exception 'approval drift restored';
 exception when sqlstate 'PT409' then null;end;
 perform fixture_users_trial(true,'succeeded','cursor');
 begin
  perform learn_commusoft_users_trial_restore(fixture_id(100),fixture_id(111),fixture_id(112),
   fixture_id(180),'Synthetic close','finish');
  raise exception 'cursor drift restored';
 exception when sqlstate 'PT409' then null;end;
 perform fixture_users_trial(true,'succeeded','extra_scope');
 begin
  perform learn_commusoft_users_trial_restore(fixture_id(100),fixture_id(111),fixture_id(112),
   fixture_id(180),'Synthetic close','finish');
  raise exception 'extra scope drift restored';
 exception when sqlstate 'PT409' then null;end;
 perform fixture_users_trial(true,'succeeded','expiry');
 begin
  perform learn_commusoft_users_trial_restore(fixture_id(100),fixture_id(111),fixture_id(112),
   fixture_id(180),'Synthetic close','finish');
  raise exception 'expiry drift restored';
 exception when sqlstate 'PT409' then null;end;

 -- Terminal source-free failure can restore without inventing a page receipt.
 perform fixture_users_trial(true,'dead_letter');
 result:=learn_commusoft_users_trial_restore(fixture_id(100),fixture_id(111),fixture_id(112),
  fixture_id(180),'Synthetic abandon','abandon');
 assert result->>'records'='0' and result->>'page_id' is null;
 assert (select enabled from learn_commusoft_recurring where account_id=fixture_id(103));
 assert (select count(*) from learn_business_input_pages where collection='users')=0;
end$$;
select 'new-dawn-m2-users-trial-restore-synthetic/1' as marker;
