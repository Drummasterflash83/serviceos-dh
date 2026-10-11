-- Connect retained discovery pages to message jobs. No credentials or capture activation.
begin;
set local lock_timeout='3s';
-- Serialize the upgrade against queue writers and retained completions.
lock table public.platform_jobs,public.learn_microsoft_job_completions in access exclusive mode;
-- Old completed discovery receipts cannot silently acquire a different meaning.
-- No Microsoft migrations are hosted yet; a populated installation needs an
-- explicit retained-page backfill before adopting this release.
do $$begin
 if exists(select 1 from public.learn_microsoft_job_completions c join public.platform_jobs j on j.id=c.job_id
  where j.job_type='email.microsoft_discovery') then
  raise exception 'learn_microsoft_existing_discovery_requires_backfill';
 end if;
end $$;
create table public.learn_microsoft_folder_dispatches (
 stream_id uuid not null, tenant_id uuid not null,
 folder_id text not null check(length(folder_id) between 1 and 2048 and folder_id~'^[A-Za-z0-9+/_=-]+$'),
 kind text not null check(kind in ('physical','search')),
 source_page_id uuid not null references public.learn_microsoft_source_pages(id) on delete restrict,
 message_job_id uuid references public.platform_jobs(id) on delete restrict,
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(stream_id,folder_id),
 foreign key(tenant_id,stream_id) references public.learn_microsoft_capture_streams(tenant_id,id) on delete restrict,
 check((kind='physical' and message_job_id is not null) or (kind='search' and message_job_id is null))
);
alter table public.learn_microsoft_folder_dispatches enable row level security;
revoke all on public.learn_microsoft_folder_dispatches from public,anon,authenticated,service_role;
create trigger learn_microsoft_dispatches_immutable before update or delete on public.learn_microsoft_folder_dispatches for each row execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_dispatches_no_truncate before truncate on public.learn_microsoft_folder_dispatches for each statement execute function public.learn_microsoft_journal_immutable();

-- Private helper, reachable only inside lease-bound settlement. The caller holds
-- the discovery job and stream locks; every source page is immutable. One page
-- creates at most 1,000 dispatch decisions, never a mailbox-sized transaction.
create function public.learn_microsoft_dispatch_folders(p_tenant uuid,p_page uuid,p_job uuid) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare s public.learn_microsoft_capture_streams%rowtype;r public.learn_microsoft_source_pages%rowtype;
 parent public.platform_jobs%rowtype;child public.platform_jobs%rowtype;old public.learn_microsoft_folder_dispatches%rowtype;
 folder_observation jsonb;payload jsonb;key text;child_id uuid;step integer;
 physical integer:=0;searches integer:=0;created integer:=0;reused integer:=0;previous integer:=0;
begin
 select * into r from public.learn_microsoft_source_pages where id=p_page and tenant_id=p_tenant and job_id=p_job;
 if not found then raise exception 'learn_microsoft_dispatch_evidence_invalid' using errcode='PT409';end if;
 select * into strict s from public.learn_microsoft_capture_streams where tenant_id=p_tenant and id=r.stream_id;
 select * into strict parent from public.platform_jobs where tenant_id=p_tenant and id=p_job;
 if s.kind<>'folders' or parent.job_type<>'email.microsoft_discovery'
  or parent.payload is distinct from jsonb_build_object('email_account_id',s.email_account_id,'mailbox_id',s.mailbox_id,'binding_id',s.binding_id,'kind','folders','folder_id','')
  or jsonb_typeof(r.source_page->'folders') is distinct from 'array' or jsonb_array_length(r.source_page->'folders')>1000
 then raise exception 'learn_microsoft_dispatch_evidence_invalid' using errcode='PT409';end if;
 -- All observed folder identities must agree with the reader's saved checkpoint.
 -- Duplicate observations share one decision; conflicting identity/type is refused.
 if exists(select 1 from jsonb_array_elements(r.source_page->'folders') f where
   jsonb_typeof(f) is distinct from 'object' or jsonb_typeof(f->'id') is distinct from 'string'
   or not coalesce(length(f->>'id') between 1 and 2048 and f->>'id'~'^[A-Za-z0-9+/_=-]+$',false)
   or not coalesce(f->>'kind' in ('physical','search'),false)
   or not exists(select 1 from jsonb_array_elements(r.after_checkpoint->'folders') saved
    where saved->'id'=f->'id' and saved->'kind'=f->'kind' and saved->'parentFolderId'=f->'parentFolderId'))
  or exists(select 1 from jsonb_array_elements(r.source_page->'folders') f group by f->>'id'
    having count(distinct f->>'kind')<>1 or count(distinct f->>'parentFolderId')<>1)
 then raise exception 'learn_microsoft_dispatch_evidence_invalid' using errcode='PT409';end if;
 for folder_observation in select distinct on (v->>'id') v from jsonb_array_elements(r.source_page->'folders') v order by v->>'id' loop
  child_id:=null;
  if folder_observation->>'kind'='physical' then physical:=physical+1;else searches:=searches+1;end if;
  payload:=jsonb_build_object('email_account_id',s.email_account_id,'mailbox_id',s.mailbox_id,'binding_id',s.binding_id,'kind','messages','folder_id',folder_observation->>'id');
  key:='email.microsoft_sync:'||s.binding_id||':'||(folder_observation->>'id');
  select * into old from public.learn_microsoft_folder_dispatches where stream_id=s.id and folder_id=folder_observation->>'id';
  if found then
   if old.tenant_id<>p_tenant or old.kind<>folder_observation->>'kind' then raise exception 'learn_microsoft_dispatch_conflict' using errcode='PT409';end if;
   if old.message_job_id is not null then
    select * into child from public.platform_jobs where id=old.message_job_id;
    if not found or child.tenant_id<>p_tenant or child.payload is distinct from payload or child.job_type<>'email.microsoft_sync' or child.job_key is distinct from key
     or child.connector_id is distinct from 'microsoft-365' or child.module_id is distinct from 'communications.email'
    then raise exception 'learn_microsoft_dispatch_conflict' using errcode='PT409';end if;
   end if;
   previous:=previous+1;continue;
  end if;
  if folder_observation->>'kind'='physical' then
   for step in 1..3 loop
    insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,payload,parent_job_id,available_at)
     values(p_tenant,'microsoft-365','communications.email','email.microsoft_sync',key,'queued',parent.priority,parent.max_attempts,payload,p_job,clock_timestamp()+interval '1 second')
     on conflict(tenant_id,job_key) where job_key is not null and status in ('queued','running','retrying') do nothing returning * into child;
    if found then child_id:=child.id;created:=created+1;exit;end if;
    select * into child from public.platform_jobs where tenant_id=p_tenant and job_key=key and status in ('queued','running','retrying') for share;
    if not found then continue;end if;
    if child.payload is distinct from payload or child.job_type<>'email.microsoft_sync' or child.job_key is distinct from key
     or child.connector_id is distinct from 'microsoft-365' or child.module_id is distinct from 'communications.email'
    then raise exception 'learn_microsoft_dispatch_conflict' using errcode='PT409';end if;
    child_id:=child.id;reused:=reused+1;exit;
   end loop;
   if child_id is null then raise exception 'learn_microsoft_dispatch_unconfirmed' using errcode='PT409';end if;
  end if;
  insert into public.learn_microsoft_folder_dispatches(stream_id,tenant_id,folder_id,kind,source_page_id,message_job_id)
   values(s.id,p_tenant,folder_observation->>'id',folder_observation->>'kind',p_page,child_id);
 end loop;
 return jsonb_build_object('physicalFolders',physical,'searchFolders',searches,'newJobs',created,'reusedJobs',reused,'previouslyDispatched',previous);
end $$;
revoke all on function public.learn_microsoft_dispatch_folders(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.learn_microsoft_job_settle(p_tenant uuid,p_job uuid,p_worker text,p_claim integer,p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;s public.learn_microsoft_capture_streams%rowtype;r public.learn_microsoft_source_pages%rowtype;
 done public.learn_microsoft_job_completions%rowtype;n public.platform_jobs%rowtype;
 definition jsonb;job_state jsonb;answer jsonb;needs_more boolean;receipt_id uuid;observations integer:=0;
 dispatch jsonb:=null;key text;successor uuid;lease_end timestamptz;step integer;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_journal_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_job is null or p_apply is null then raise exception 'learn_microsoft_settlement_invalid' using errcode='22023';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'learn_microsoft_snapshot_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found then raise exception 'learn_microsoft_job_unavailable' using errcode='PT409';end if;
 definition:=jsonb_build_object('tenant_id',j.tenant_id,'connector_id',j.connector_id,'module_id',j.module_id,'job_type',j.job_type,'job_key',j.job_key,'payload',j.payload);
 select * into done from public.learn_microsoft_job_completions where job_id=p_job;
 if found then
  if done.tenant_id<>p_tenant or done.definition is distinct from definition or j.status<>'succeeded'
   or j.result is distinct from done.result then raise exception 'learn_microsoft_settlement_conflict' using errcode='PT409';end if;
  return done.result;
 end if;
 -- This validates the live lease and exact server-owned Microsoft job payload.
 -- Completion consumes retained evidence, so pause/revocation need not block it.
 job_state:=public.learn_microsoft_journal_job(p_tenant,p_job,p_worker,p_claim);
 key:=j.job_type||':'||(j.payload->>'binding_id')||':'||(j.payload->>'folder_id');
 if j.job_key is distinct from key then raise exception 'learn_microsoft_job_key_invalid' using errcode='PT409';end if;
 if not p_apply then return jsonb_build_object('contract','microsoft-job-settlement/1','state','pending','tenantId',p_tenant,'jobId',p_job);end if;
 lease_end:=j.lease_expires_at;
 select * into s from public.learn_microsoft_capture_streams where tenant_id=p_tenant
  and email_account_id=(j.payload->>'email_account_id')::uuid and binding_id=(j.payload->>'binding_id')::uuid
  and mailbox_id=(j.payload->>'mailbox_id')::uuid and kind=j.payload->>'kind' and folder_id=j.payload->>'folder_id' for update;
 if not found or not public.learn_microsoft_checkpoint_valid(s.checkpoint,s.tenant_id,s.email_account_id,s.mailbox_id,s.kind,s.folder_id)
 then raise exception 'learn_microsoft_stream_unavailable' using errcode='PT409';end if;
 select * into r from public.learn_microsoft_source_pages where tenant_id=p_tenant and job_id=p_job;
 if found then
  if r.stream_id<>s.id or r.revision>s.revision then raise exception 'learn_microsoft_settlement_evidence_invalid' using errcode='PT409';end if;
  receipt_id:=r.id;
  observations:=jsonb_array_length(case when s.kind='folders' then r.source_page->'folders' else r.source_page->'events' end);
 else
  -- An already-exhausted folder traversal may settle without fabricating a page.
  if s.kind<>'folders' or s.checkpoint->'pending' is distinct from '[]'::jsonb or s.revision=0
   or not exists(select 1 from public.learn_microsoft_source_pages where stream_id=s.id and revision=s.revision and after_checkpoint=s.checkpoint)
  then raise exception 'learn_microsoft_saved_page_required' using errcode='PT409';end if;
 end if;
 if s.kind='folders' and receipt_id is not null then
  dispatch:=public.learn_microsoft_dispatch_folders(p_tenant,receipt_id,p_job);
 end if;
 needs_more:=case when s.kind='folders' then jsonb_array_length(s.checkpoint->'pending')>0
  else s.checkpoint->'continuation'->>'kind'='next' end;
 if needs_more is null then raise exception 'learn_microsoft_checkpoint_invalid' using errcode='PT409';end if;
 -- Release this active key and insert/reuse the continuation in the SAME transaction.
 update public.platform_jobs set status='succeeded',completed_at=clock_timestamp(),records_processed=observations,
  claimed_by=null,lease_expires_at=null,error_code=null,updated_at=clock_timestamp() where id=p_job;
 if needs_more then
  for step in 1..3 loop
   insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,payload,parent_job_id,available_at)
    values(p_tenant,'microsoft-365','communications.email',j.job_type,key,'queued',j.priority,j.max_attempts,j.payload,p_job,clock_timestamp()+interval '1 second')
    on conflict(tenant_id,job_key) where job_key is not null and status in ('queued','running','retrying') do nothing returning * into n;
   if found then successor:=n.id;exit;end if;
   select * into n from public.platform_jobs where tenant_id=p_tenant and job_key=key and status in ('queued','running','retrying');
   if not found then continue;end if;
   if n.id=p_job or n.job_type is distinct from j.job_type or n.connector_id is distinct from j.connector_id
    or n.module_id is distinct from j.module_id or n.payload is distinct from j.payload
   then raise exception 'learn_microsoft_successor_conflict' using errcode='PT409';end if;
   successor:=n.id;exit;
  end loop;
  if successor is null then raise exception 'learn_microsoft_successor_unconfirmed' using errcode='PT409';end if;
 end if;
 answer:=jsonb_build_object('contract','microsoft-job-settlement/1','state','completed','tenantId',p_tenant,'jobId',p_job,
  'sourceReceiptId',receipt_id,'successorId',successor,'observationsStored',observations,'mailboxCoverage','unverified','folderDispatch',dispatch);
 update public.platform_jobs set result=answer where id=p_job;
 insert into public.learn_microsoft_job_completions(job_id,tenant_id,definition,source_receipt_id,successor_id,result)
  values(p_job,p_tenant,definition,receipt_id,successor,answer);
 if lease_end<=clock_timestamp() then raise exception 'learn_microsoft_lease_invalid' using errcode='PT409';end if;
 return answer;
end $$;
-- Replacing the existing entrypoint preserves its owner and execute grants.
commit;
