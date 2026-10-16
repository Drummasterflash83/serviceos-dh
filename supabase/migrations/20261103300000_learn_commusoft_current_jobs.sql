-- Refresh changed jobs between contact pages. No provider settings or frontend
-- changes. Existing recurring consent, quota, worker and version writer apply.
-- Installation is inert: only explicitly registered accounts can use this lane.
begin;
create table public.learn_commusoft_current_jobs (
 account_id uuid primary key references public.learn_commusoft_recurring(account_id),
 tenant_id uuid not null references public.tenants(id),
 enabled boolean not null default false,
 watermark timestamptz,
 next_check_at timestamptz not null default clock_timestamp(),
 current_request uuid,
 suspended jsonb,
 last_state text not null default 'ready',
 updated_at timestamptz not null default clock_timestamp(),
 check ((current_request is null) = (suspended is null))
);
create table public.learn_commusoft_current_job_receipts (
 request_id uuid not null,
 stage text not null check(stage in ('started','completed','incomplete')),
 account_id uuid not null references public.learn_commusoft_current_jobs(account_id),
 tenant_id uuid not null,
 detail jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(request_id,stage)
);
alter table public.learn_commusoft_current_jobs enable row level security;
alter table public.learn_commusoft_current_job_receipts enable row level security;
revoke all on public.learn_commusoft_current_jobs,public.learn_commusoft_current_job_receipts from public,anon,authenticated,service_role;
create trigger retain_current_job_receipts before update or delete on public.learn_commusoft_current_job_receipts
 for each row execute function public.learn_operator_input_immutable();

-- The new private start function keeps every setup/admission check. Its two
-- exceptions are limited to the exact saved contact scope, with no live lease.
create function public.learn_commusoft_current_jobs_suspended(p_tenant uuid,p_account uuid,p_request uuid)
returns boolean language sql security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.learn_commusoft_current_jobs f
  join public.learn_commusoft_recurring s on s.account_id=f.account_id and s.tenant_id=f.tenant_id
  join public.connector_accounts a on a.id=f.account_id and a.tenant_id=f.tenant_id
  where f.tenant_id=p_tenant and f.account_id=p_account and f.current_request=p_request
   and s.current_request=p_request and s.current_definition->>'resource'='jobs'
   and a.settings->'commusoft_import'=f.suspended->'approval' and a.sync_cursor=f.suspended->'checkpoint'
   and f.suspended->>'phase' in ('3','4')
   and not exists(select 1 from public.platform_jobs j where j.tenant_id=p_tenant
    and j.job_type='commusoft.source_sync' and j.payload->>'connector_account_id'=p_account::text
    and j.status='running' and coalesce(j.lease_expires_at,'infinity')>clock_timestamp()))
$$;
do $patch$ declare d text;old text;begin
 d:=pg_get_functiondef('public.learn_commusoft_recurring_start(uuid,uuid,uuid,jsonb,text)'::regprocedure);
 d:=replace(d,'FUNCTION public.learn_commusoft_recurring_start(','FUNCTION public.learn_commusoft_current_jobs_start(');
 old:=$old$and payload->>'connector_account_id'=a.id::text and status in ('queued','running','retrying'))$old$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'commusoft_current_jobs_active_source_changed';end if;
 d:=replace(d,old,$new$and payload->>'connector_account_id'=a.id::text and status in ('queued','running','retrying')
    and not (public.learn_commusoft_current_jobs_suspended(p_tenant,a.id,p_request)
     and job_key='commusoft.source:'||a.id::text||':'||(select suspended->>'current_request' from public.learn_commusoft_current_jobs where account_id=a.id)))$new$);
 -- Dollar-quoted separately to make the exact original check visible.
 old:='   if a.settings ? ''commusoft_import'' and (a.sync_cursor->''complete'' is distinct from ''true''::jsonb';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'commusoft_current_jobs_checkpoint_source_changed';end if;
 d:=replace(d,old,'   if not public.learn_commusoft_current_jobs_suspended(p_tenant,a.id,p_request) and a.settings ? ''commusoft_import'' and (a.sync_cursor->''complete'' is distinct from ''true''::jsonb');
 execute d;
 -- Preserve the complete four-phase scheduler; exclude only an active saved
 -- contact scope. The wrapper below handles its exact restoration first.
 d:=pg_get_functiondef('public.learn_commusoft_schedule_recurring(integer)'::regprocedure);
 d:=replace(d,'FUNCTION public.learn_commusoft_schedule_recurring(','FUNCTION public.learn_commusoft_schedule_full(');
 old:='where enabled and next_check_at<=clock_timestamp() order by next_check_at,account_id';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'commusoft_current_jobs_schedule_source_changed';end if;
 d:=replace(d,old,'where enabled and next_check_at<=clock_timestamp() and not exists(select 1 from public.learn_commusoft_current_jobs f where f.account_id=learn_commusoft_recurring.account_id and f.current_request is not null) order by next_check_at,account_id');
 execute d;
end $patch$;

create function public.learn_commusoft_schedule_current_jobs(p_batch integer default 10)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.learn_commusoft_recurring%rowtype;f public.learn_commusoft_current_jobs%rowtype;
 a public.connector_accounts%rowtype;rid uuid;definition jsonb;receipt jsonb;saved jsonb;
 baseline timestamptz;end_at timestamptz;start_at timestamptz;complete boolean;active boolean;
 checked integer:=0;queued integer:=0;restored integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'commusoft_recurring_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_batch is null or p_batch not between 1 and 50 then raise exception 'commusoft_recurring_invalid' using errcode='22023';end if;
 for s in select r.* from public.learn_commusoft_recurring r
  join public.learn_commusoft_current_jobs j on j.account_id=r.account_id and j.tenant_id=r.tenant_id
  where (j.current_request is not null or (j.enabled and r.enabled and r.phase in(3,4) and coalesce(j.next_check_at,'-infinity')<=clock_timestamp()))
  order by coalesce(j.next_check_at,'-infinity'),r.account_id limit p_batch loop
  if not pg_try_advisory_xact_lock(hashtextextended('learn-input-setup:'||s.tenant_id::text,0)) then continue;end if;
  select * into s from public.learn_commusoft_recurring where account_id=s.account_id for update;
  -- Never change the approval under an in-flight GET/commit/finish operation.
  if exists(select 1 from public.platform_jobs j where j.tenant_id=s.tenant_id
   and j.job_type='commusoft.source_sync' and j.payload->>'connector_account_id'=s.account_id::text
   and j.status='running' and coalesce(j.lease_expires_at,'infinity')>clock_timestamp()) then continue;end if;
  select * into a from public.connector_accounts where id=s.account_id and tenant_id=s.tenant_id for update;
  if not found then continue;end if;
  select * into f from public.learn_commusoft_current_jobs where account_id=s.account_id and tenant_id=s.tenant_id for update;
  if not found then raise exception 'commusoft_current_jobs_tenant_changed';end if;
  checked:=checked+1;
  if f.current_request is not null then
   if s.current_request is distinct from f.current_request or a.settings->'commusoft_import'->>'approvalId' is distinct from f.current_request::text then
    update public.learn_commusoft_current_jobs set last_state='scope_changed',updated_at=clock_timestamp() where account_id=s.account_id;continue;
   end if;
   complete:=a.sync_cursor->'complete'='true'::jsonb and exists(
    select 1 from public.learn_business_input_pages p join public.platform_jobs j on j.id=p.job_id and j.tenant_id=p.tenant_id
    where p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider='commusoft' and p.collection='jobs'
     and p.checkpoint_after=a.sync_cursor and p.checkpoint_after->>'approvalId'=f.current_request::text
     and j.status='succeeded' and j.metadata->'commusoft_page_v1'->>'pageId'=p.id::text);
   select exists(select 1 from public.platform_jobs j where j.tenant_id=s.tenant_id and j.job_type='commusoft.source_sync'
    and j.job_key='commusoft.source:'||s.account_id::text||':'||f.current_request::text and j.status in('queued','running','retrying')) into active;
   if not coalesce(complete,false) and active and (a.settings->'commusoft_import'->>'expiresAt')::timestamptz>clock_timestamp()
    and f.enabled and s.enabled and public.learn_commusoft_recurring_actor(s.approved_by)
    and public.learn_operator_input_flags(s.tenant_id)='{"learn.enabled":true,"learn.inputs.commusoft.enabled":true}'::jsonb
    and exists(select 1 from public.provider_connections c where c.id=s.connection_id and c.tenant_id=s.tenant_id
     and c.status='configured' and c.revoked_at is null and c.updated_at=s.connection_revision)
    then continue;end if;
   -- A failed/expired window never advances freshness; restore the saved crawl
   -- anyway. Its queued job remains intact and is governed by the original gates.
   update public.platform_jobs set status='dead_letter',lease_expires_at=null,dead_lettered_at=clock_timestamp(),
    error_code='commusoft_current_window_incomplete' where tenant_id=s.tenant_id and job_type='commusoft.source_sync'
    and job_key='commusoft.source:'||s.account_id::text||':'||f.current_request::text and status in('queued','running','retrying');
   saved:=f.suspended;
   insert into public.learn_commusoft_current_job_receipts values(f.current_request,
    case when coalesce(complete,false) then 'completed' else 'incomplete' end,s.account_id,s.tenant_id,
    jsonb_build_object('checkpoint',a.sync_cursor,'updatedBefore',s.cycle_end,'contact_checkpoint_restored',saved->'checkpoint'),clock_timestamp());
   update public.connector_accounts set settings=jsonb_set(settings,'{commusoft_import}',saved->'approval'),sync_cursor=saved->'checkpoint' where id=s.account_id;
   update public.learn_commusoft_recurring set phase=(saved->>'phase')::integer,current_request=(saved->>'current_request')::uuid,
    current_definition=saved->'current_definition',cycle_start=(saved->>'cycle_start')::timestamptz,cycle_end=(saved->>'cycle_end')::timestamptz,
    next_check_at=clock_timestamp(),last_state='contact_resumed',updated_at=clock_timestamp() where account_id=s.account_id;
   update public.learn_commusoft_current_jobs set watermark=case when coalesce(complete,false) then s.cycle_end else watermark end,
    current_request=null,suspended=null,next_check_at=clock_timestamp()+interval '15 minutes',
    last_state=case when coalesce(complete,false) then 'window_complete' else 'window_incomplete' end,updated_at=clock_timestamp() where account_id=s.account_id;
   restored:=restored+1;continue;
  end if;
  if not f.enabled or not s.enabled or s.phase not in(3,4) or f.next_check_at>clock_timestamp()
   or not public.learn_commusoft_recurring_actor(s.approved_by) or a.status<>'active'
   or public.learn_operator_input_flags(s.tenant_id) is distinct from '{"learn.enabled":true,"learn.inputs.commusoft.enabled":true}'::jsonb
   or a.settings->'commusoft_import'->>'resource' is distinct from 'propertyContacts'
   or a.settings->'commusoft_import'->>'approvalId' is distinct from s.current_request::text
   or a.sync_cursor->'complete'='true'::jsonb then continue;end if;
  -- Use a completed jobs traversal, never the full-cycle/contact watermark alone.
  select greatest(f.watermark,max(r.cycle_end)) into baseline from public.learn_commusoft_recurring_steps r
   where r.tenant_id=s.tenant_id and r.account_id=s.account_id and r.phase=2 and exists(
    select 1 from public.learn_business_input_pages p join public.platform_jobs j on j.id=p.job_id and j.tenant_id=p.tenant_id
    where p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider='commusoft' and p.collection='jobs'
     and p.checkpoint_after->>'approvalId'=r.request_id::text and p.checkpoint_after->'complete'='true'::jsonb
     and j.status='succeeded' and j.metadata->'commusoft_page_v1'->>'pageId'=p.id::text);
  if baseline is null or baseline>clock_timestamp()-interval '15 minutes' then continue;end if;
  start_at:=greatest(to_timestamp(0),baseline-interval '5 minutes');
  end_at:=date_trunc('milliseconds',least(baseline+interval '24 hours',clock_timestamp()-interval '2 minutes'));
  rid:=gen_random_uuid();
  definition:=jsonb_build_object('kind','start_commusoft','reason','Approved ongoing Commusoft current jobs between contact pages',
   'connection_id',s.connection_id,'revision',s.connection_revision,'resource','jobs','max_pages',least(s.max_pages,100),'page_size',s.page_size,
   'expires_at',clock_timestamp()+interval '1 hour','updatedFrom',to_char(start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'updatedBefore',to_char(end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  saved:=jsonb_build_object('approval',a.settings->'commusoft_import','checkpoint',a.sync_cursor,'phase',s.phase,
   'current_request',s.current_request,'current_definition',s.current_definition,'cycle_start',s.cycle_start,'cycle_end',s.cycle_end);
  begin
   update public.learn_commusoft_current_jobs set current_request=rid,suspended=saved where account_id=s.account_id;
   update public.learn_commusoft_recurring set current_request=rid,current_definition=definition,phase=2,cycle_start=start_at,cycle_end=end_at where account_id=s.account_id;
   receipt:=public.learn_commusoft_current_jobs_start(s.tenant_id,rid,s.approved_by,definition,'apply');
   if receipt->>'account_id' is distinct from s.account_id::text then raise exception 'commusoft_current_jobs_account_changed' using errcode='PT409';end if;
   insert into public.learn_commusoft_recurring_steps values(rid,s.account_id,s.tenant_id,s.approved_by,start_at,end_at,2,definition,(receipt->>'job_id')::uuid,clock_timestamp());
   insert into public.learn_commusoft_current_job_receipts values(rid,'started',s.account_id,s.tenant_id,jsonb_build_object('saved',saved,'definition',definition),clock_timestamp());
   update public.learn_commusoft_current_jobs set last_state='window_queued',updated_at=clock_timestamp() where account_id=s.account_id;
   queued:=queued+1;
  exception when sqlstate '55000' or sqlstate 'PT409' or insufficient_privilege then
   update public.learn_commusoft_current_jobs set last_state='setup_needs_review',next_check_at=clock_timestamp()+interval '15 minutes',updated_at=clock_timestamp() where account_id=s.account_id;
  end;
 end loop;
 return jsonb_build_object('checked',checked,'queued',queued,'restored',restored);
end $$;
create or replace function public.learn_commusoft_schedule_recurring(p_batch integer default 10)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare fresh jsonb;full_cycle jsonb;begin
 fresh:=public.learn_commusoft_schedule_current_jobs(p_batch);
 full_cycle:=public.learn_commusoft_schedule_full(p_batch);
 return full_cycle||jsonb_build_object('current_jobs',fresh);
end $$;
revoke all on function public.learn_commusoft_current_jobs_suspended(uuid,uuid,uuid),
 public.learn_commusoft_current_jobs_start(uuid,uuid,uuid,jsonb,text),
 public.learn_commusoft_schedule_full(integer),public.learn_commusoft_schedule_current_jobs(integer) from public,anon,authenticated,service_role;
commit;
