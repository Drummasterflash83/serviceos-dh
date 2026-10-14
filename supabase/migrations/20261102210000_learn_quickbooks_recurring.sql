-- Bounded full-source refresh under a recorded operator approval. Installation
-- creates no schedules, credentials or provider calls. Existing sources stay.
begin;
create table public.learn_quickbooks_recurring (
 connection_id uuid primary key,
 tenant_id uuid not null,
 app_id uuid not null,
 environment text not null,
 realm_id text not null,
 approved_by uuid not null references public.profiles(id),
 enabled boolean not null,
 revision bigint not null default 1,
 connection_revision bigint not null,
 max_requests integer not null check(max_requests between 1 and 10000),
 interval_hours integer not null check(interval_hours between 1 and 168),
 current_run uuid references public.learn_quickbooks_imports(id),
 last_completed_at timestamptz,
 next_at timestamptz not null,
 last_state text not null,
 reason text not null,
 updated_at timestamptz not null default clock_timestamp(),
 foreign key(connection_id,tenant_id) references public.learn_quickbooks_connections(id,tenant_id)
);
alter table public.learn_quickbooks_recurring enable row level security;
revoke all on public.learn_quickbooks_recurring from public,anon,authenticated,service_role;
create index learn_quickbooks_recurring_due on public.learn_quickbooks_recurring(next_at) where enabled;

create function public.learn_quickbooks_recurring_control(p_tenant uuid,p_connection uuid,p_enabled boolean,p_revision bigint,p_max_requests integer,p_interval_hours integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.learn_quickbooks_connections%rowtype;s public.learn_quickbooks_recurring%rowtype;r public.learn_quickbooks_imports%rowtype;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 if p_enabled is null or p_revision is null or p_revision<0 or p_max_requests is null or p_max_requests not between 1 and 10000
  or p_interval_hours is null or p_interval_hours not between 1 and 168 or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'quickbooks_schedule_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-schedule:'||p_connection::text,0));
 select * into s from public.learn_quickbooks_recurring where connection_id=p_connection for update;
 if coalesce(s.revision,0)<>p_revision then raise exception 'quickbooks_schedule_changed' using errcode='PT409';end if;
 select * into c from public.learn_quickbooks_connections where id=p_connection and tenant_id=p_tenant for update;
 if not found then raise exception 'quickbooks_schedule_unavailable' using errcode='42501';end if;
 if p_enabled then
  perform public.learn_quickbooks_enabled(p_tenant);
  if c.status<>'paused' or c.confirmed_at is null or c.token_secret_id is null then raise exception 'quickbooks_schedule_unavailable' using errcode='42501';end if;
  select * into r from public.learn_quickbooks_imports where connection_id=c.id order by created_at desc,id desc limit 1;
  if not found or r.state<>'traversed' or r.connection_revision<>c.revision or r.environment<>c.environment or r.realm_id<>c.realm_id
   or r.page_size<>100 or r.minor_version<>75
   or r.entities<>array['Customer','Invoice','Payment','CreditMemo','SalesReceipt','Estimate','Vendor','Bill','BillPayment','Purchase','VendorCredit','Account','Item']::text[] then
   raise exception 'quickbooks_baseline_incomplete' using errcode='PT409';end if;
 else
  if s.connection_id is null then raise exception 'quickbooks_schedule_unavailable' using errcode='42501';end if;
  -- Fence only this schedule's active run. A separate manual import is retained.
  if s.current_run is not null then
   update public.learn_quickbooks_imports set state='paused',last_error='schedule_paused',updated_at=clock_timestamp()
    where id=s.current_run and tenant_id=p_tenant and state in('queued','running');
   if found then update public.learn_quickbooks_connections set status='paused',revision=revision+1,updated_at=clock_timestamp() where id=c.id returning * into c;end if;
  end if;
 end if;
 insert into public.learn_quickbooks_recurring(connection_id,tenant_id,app_id,environment,realm_id,approved_by,enabled,revision,connection_revision,max_requests,interval_hours,current_run,last_completed_at,next_at,last_state,reason)
 values(c.id,p_tenant,c.app_id,c.environment,c.realm_id,auth.uid(),p_enabled,p_revision+1,c.revision,p_max_requests,p_interval_hours,
  case when p_enabled then r.id else s.current_run end,case when p_enabled then r.updated_at else s.last_completed_at end,
  clock_timestamp()+make_interval(hours=>p_interval_hours),case when p_enabled then 'waiting' else 'paused' end,btrim(p_reason))
 on conflict(connection_id) do update set approved_by=excluded.approved_by,enabled=excluded.enabled,revision=excluded.revision,
  connection_revision=excluded.connection_revision,max_requests=excluded.max_requests,interval_hours=excluded.interval_hours,current_run=excluded.current_run,
  last_completed_at=excluded.last_completed_at,next_at=excluded.next_at,last_state=excluded.last_state,reason=excluded.reason,updated_at=clock_timestamp();
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail) values(p_tenant,c.id,auth.uid(),'schedule_changed',jsonb_build_object('enabled',p_enabled,'revision',p_revision+1,'maxRequests',p_max_requests,'intervalHours',p_interval_hours,'reason',btrim(p_reason)));
 return jsonb_build_object('revision',p_revision+1,'enabled',p_enabled);
end $$;

create function public.learn_quickbooks_recurring_read(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$declare entries jsonb;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 perform public.learn_quickbooks_retained_finance_access(p_tenant,'Read recorded accounting refresh policy');
 select coalesce(jsonb_agg(to_jsonb(s)-'reason' order by s.connection_id),'[]') into entries from public.learn_quickbooks_recurring s where tenant_id=p_tenant;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event) select p_tenant,s.connection_id,auth.uid(),'schedule_status_read' from public.learn_quickbooks_recurring s where tenant_id=p_tenant;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('tenant_id',p_tenant,'actor_id',auth.uid(),'rows',entries,'checked_at',clock_timestamp());
end $$;

-- One cycle at a time. Recorded approval is revalidated without fabricating JWT
-- claims. Any incomplete or changed connection is held for explicit review.
create function public.learn_quickbooks_schedule_tick(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.learn_quickbooks_recurring%rowtype;c public.learn_quickbooks_connections%rowtype;r public.learn_quickbooks_imports%rowtype;
 checked integer:=0;queued integer:=0;held integer:=0;state text;rid uuid;definition jsonb;begin
 if auth.role() is distinct from 'service_role' then raise exception 'quickbooks_schedule_forbidden' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 10 then raise exception 'quickbooks_schedule_invalid' using errcode='22023';end if;
 for s in select * from public.learn_quickbooks_recurring where enabled and next_at<=clock_timestamp() order by next_at,connection_id for update skip locked limit p_limit loop
  checked:=checked+1;state:='ready';
  begin perform public.learn_quickbooks_actor_access(s.tenant_id,s.approved_by);perform public.learn_quickbooks_enabled(s.tenant_id);
  exception when insufficient_privilege then state:='authority_or_module_needs_review';end;
  select * into c from public.learn_quickbooks_connections where id=s.connection_id and tenant_id=s.tenant_id for update;
  if not found or (c.app_id,c.environment,c.realm_id,c.revision) is distinct from (s.app_id,s.environment,s.realm_id,s.connection_revision)
   or c.status not in('active','paused') or c.confirmed_at is null or c.token_secret_id is null
   or not exists(select 1 from public.learn_quickbooks_apps a where a.id=c.app_id and a.active) then state:='connection_needs_review';end if;
  if state='ready' and s.current_run is not null then
   select * into r from public.learn_quickbooks_imports where id=s.current_run and connection_id=s.connection_id and tenant_id=s.tenant_id;
   if not found then state:='checkpoint_needs_review';
   elsif r.state in('queued','running') then state:='capturing';
   elsif r.state<>'traversed' then state:='incomplete_cycle_needs_review';
   elsif s.last_completed_at is distinct from r.updated_at then
    update public.learn_quickbooks_recurring set last_completed_at=r.updated_at,next_at=r.updated_at+make_interval(hours=>s.interval_hours),last_state='waiting',updated_at=clock_timestamp() where connection_id=s.connection_id;
    if r.updated_at+make_interval(hours=>s.interval_hours)>clock_timestamp() then state:='waiting';end if;
   end if;
  end if;
  if state='ready' and (c.status<>'paused' or exists(select 1 from public.learn_quickbooks_imports i where i.connection_id=c.id and i.state in('queued','running'))) then state:='manual_capture_active';end if;
  if state='ready' then
   rid:=gen_random_uuid();definition:=jsonb_build_object('entities',jsonb_build_array('Customer','Invoice','Payment','CreditMemo','SalesReceipt','Estimate','Vendor','Bill','BillPayment','Purchase','VendorCredit','Account','Item'),
    'pageSize',100,'minorVersion',75,'maxRequests',s.max_requests,'expiresAt',clock_timestamp()+interval '24 hours','reason','Scheduled accounting refresh: '||s.reason,'resumeFrom',null);
   update public.learn_quickbooks_connections set status='active',revision=revision+1,updated_at=clock_timestamp() where id=c.id returning * into c;
   insert into public.learn_quickbooks_imports(id,tenant_id,connection_id,connection_revision,actor_id,definition,environment,realm_id,entities,page_size,minor_version,max_requests,expires_at)
   values(rid,s.tenant_id,c.id,c.revision,s.approved_by,definition,c.environment,c.realm_id,
    array['Customer','Invoice','Payment','CreditMemo','SalesReceipt','Estimate','Vendor','Bill','BillPayment','Purchase','VendorCredit','Account','Item'],100,75,s.max_requests,clock_timestamp()+interval '24 hours');
   update public.learn_quickbooks_recurring set current_run=rid,connection_revision=c.revision where connection_id=c.id;
   insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail) values(s.tenant_id,c.id,s.approved_by,'scheduled_import_started',jsonb_build_object('runId',rid,'scheduleRevision',s.revision,'scope',definition));
   queued:=queued+1;state:='capturing';
  end if;
  if state not in('capturing','waiting','manual_capture_active') then held:=held+1;end if;
  update public.learn_quickbooks_recurring set last_state=state,next_at=case when state='waiting' then next_at else clock_timestamp()+interval '60 seconds' end,updated_at=clock_timestamp() where connection_id=s.connection_id;
 end loop;
 return jsonb_build_object('checked',checked,'queued',queued,'held',held);
end $$;

revoke all on function public.learn_quickbooks_recurring_control(uuid,uuid,boolean,bigint,integer,integer,text),public.learn_quickbooks_recurring_read(uuid),public.learn_quickbooks_schedule_tick(integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_recurring_control(uuid,uuid,boolean,bigint,integer,integer,text),public.learn_quickbooks_recurring_read(uuid) to authenticated;
grant execute on function public.learn_quickbooks_schedule_tick(integer) to service_role;
commit;
