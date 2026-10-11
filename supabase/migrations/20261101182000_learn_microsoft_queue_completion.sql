-- Atomic completion and same-stream continuation. No provider activation or schedules.
begin;
create table public.learn_microsoft_job_completions (
 job_id uuid primary key references public.platform_jobs(id) on delete restrict,
 tenant_id uuid not null, definition jsonb not null,
 source_receipt_id uuid references public.learn_microsoft_source_pages(id) on delete restrict,
 successor_id uuid references public.platform_jobs(id) on delete restrict,
 result jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
alter table public.learn_microsoft_job_completions enable row level security;
revoke all on public.learn_microsoft_job_completions from public,anon,authenticated,service_role;
create trigger learn_microsoft_completions_immutable before update or delete on public.learn_microsoft_job_completions for each row execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_completions_no_truncate before truncate on public.learn_microsoft_job_completions for each statement execute function public.learn_microsoft_journal_immutable();

create function public.learn_microsoft_job_settle(p_tenant uuid,p_job uuid,p_worker text,p_claim integer,p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;s public.learn_microsoft_capture_streams%rowtype;r public.learn_microsoft_source_pages%rowtype;
 done public.learn_microsoft_job_completions%rowtype;n public.platform_jobs%rowtype;
 definition jsonb;job_state jsonb;answer jsonb;needs_more boolean;receipt_id uuid;observations integer:=0;
 key text;successor uuid;lease_end timestamptz;step integer;
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
  'sourceReceiptId',receipt_id,'successorId',successor,'observationsStored',observations,'mailboxCoverage','unverified');
 update public.platform_jobs set result=answer where id=p_job;
 insert into public.learn_microsoft_job_completions(job_id,tenant_id,definition,source_receipt_id,successor_id,result)
  values(p_job,p_tenant,definition,receipt_id,successor,answer);
 if lease_end<=clock_timestamp() then raise exception 'learn_microsoft_lease_invalid' using errcode='PT409';end if;
 return answer;
end $$;
revoke all on function public.learn_microsoft_job_settle(uuid,uuid,text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.learn_microsoft_job_settle(uuid,uuid,text,integer,boolean) to service_role;
commit;
