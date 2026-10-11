-- Bounded discovery on the existing platform-worker tick. No cron, credentials,
-- route activation or human access is seeded.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
alter table public.receptionist_voicemail_scans
 add column last_dispatch_at timestamptz,
 add column last_dispatch_success_at timestamptz,
 add column dispatch_next_at timestamptz,
 add column dispatch_code text;
create table public.receptionist_voicemail_dispatch_receipts(
 tick_id uuid primary key,tick_at timestamptz not null unique,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.receptionist_voicemail_dispatch_receipts enable row level security;
revoke all on public.receptionist_voicemail_dispatch_receipts from public,anon,authenticated;
grant select,insert on public.receptionist_voicemail_dispatch_receipts to service_role;
create trigger voicemail_dispatch_receipt_immutable before update or delete on public.receptionist_voicemail_dispatch_receipts
 for each row execute function public.voicemail_job_immutable();

-- One durable batch per UTC minute, shared by concurrent worker invocations.
-- At most two routes / five pages each / 1,000 retained rows per tick. All per-route
-- pages roll back together on error; another route can still make progress.
create function public.voicemail_schedule_tick() returns jsonb
language plpgsql security invoker set search_path=pg_catalog set timezone='UTC' as $$
declare tick timestamptz:=date_trunc('minute',clock_timestamp());request_id uuid;route record;
 cached jsonb;receipt jsonb;result jsonb;page integer;code text;route_pages integer;route_rows integer;route_jobs integer;
 attempted integer:=0;failed integer:=0;pages integer:=0;examined integer:=0;enqueued integer:=0;
begin
 if current_user<>'service_role' then raise exception 'voicemail_dispatch_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'voicemail_snapshot_invalid' using errcode='22023';end if;
 request_id:=md5('voicemail-dispatch/1:'||tick::text)::uuid;
 if not pg_try_advisory_xact_lock(hashtextextended('voicemail-dispatch/1',0)) then
  return jsonb_build_object('state','busy','coverage_complete',false,'historical_receipt',false);
 end if;
 select d.receipt into cached from public.receptionist_voicemail_dispatch_receipts d where d.tick_id=request_id;
 if found then return cached||jsonb_build_object('historical_receipt',true);end if;
 for route in
  select r.tenant_id,r.id from public.receptionist_voicemail_email_routes r
   left join public.receptionist_voicemail_scans s on s.route_id=r.id
   where r.enabled and (s.dispatch_next_at is null or s.dispatch_next_at<=clock_timestamp())
    and (s.next_scan_at is null or s.next_scan_at<=clock_timestamp())
   order by s.last_dispatch_at nulls first,r.id limit 2
 loop
  attempted:=attempted+1;code:=null;route_pages:=0;route_rows:=0;route_jobs:=0;
  -- Consistent capture -> route -> scan lock order with page discovery.
  perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||route.tenant_id::text,0));
  perform 1 from public.receptionist_voicemail_email_routes where id=route.id for share;
  insert into public.receptionist_voicemail_scans(tenant_id,route_id) values(route.tenant_id,route.id) on conflict do nothing;
  update public.receptionist_voicemail_scans set last_dispatch_at=clock_timestamp() where route_id=route.id;
  begin
   for page in 1..5 loop
    receipt:=public.voicemail_discover_page(route.tenant_id,route.id,md5(request_id::text||':'||route.id::text||':'||page::text)::uuid);
    route_pages:=route_pages+1;route_rows:=route_rows+(receipt->>'rows_examined')::integer;
    route_jobs:=route_jobs+(receipt->>'jobs_enqueued')::integer;
    exit when receipt->>'state'<>'scanning';
   end loop;
  exception when others then
   code:=case sqlstate when '55000' then 'voicemail_capture_paused' when '22023' then 'voicemail_route_unverified' else 'voicemail_discovery_unconfirmed' end;
  end;
  if code is null then
   pages:=pages+route_pages;examined:=examined+route_rows;enqueued:=enqueued+route_jobs;
   update public.receptionist_voicemail_scans set last_dispatch_success_at=clock_timestamp(),dispatch_next_at=tick+interval '1 minute',dispatch_code=null where route_id=route.id;
  else
   failed:=failed+1;
   update public.receptionist_voicemail_scans set dispatch_next_at=clock_timestamp()+interval '5 minutes',dispatch_code=code where route_id=route.id;
  end if;
 end loop;
 result:=jsonb_build_object('state',case when attempted=0 then 'idle' when failed>0 then 'attention' else 'completed' end,
  'observed_at',clock_timestamp(),'tick_at',tick,'routes_attempted',attempted,'routes_failed',failed,
  'pages',pages,'rows_examined',examined,'jobs_enqueued',enqueued,'coverage_complete',false,'historical_receipt',false);
 -- Empty installations make no scheduled writes. No heartbeat proves capture.
 if attempted>0 then insert into public.receptionist_voicemail_dispatch_receipts(tick_id,tick_at,receipt) values(request_id,tick,result);end if;
 return result;
end$$;
revoke all on function public.voicemail_schedule_tick() from public,anon,authenticated;
grant execute on function public.voicemail_schedule_tick() to service_role;
create function public.voicemail_discovery_status_data(p_tenant uuid,p_route uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare result jsonb;
begin
 if not exists(select 1 from public.receptionist_voicemail_email_routes where tenant_id=p_tenant and id=p_route)
 then raise exception 'voicemail_route_unverified' using errcode='22023';end if;
 select jsonb_build_object('scope','retained_email_candidates','coverage_complete',false,
  'generation',s.generation,'pass_started_at',s.started_at,'pass_completed_at',s.completed_at,'rows_examined',s.rows_examined,
  'next_scan_at',s.next_scan_at,'observed_at',clock_timestamp(),
  'capture_allowed',public.learn_capture_allowed(p_tenant,'email') and public.learn_capture_allowed(p_tenant,'phone'),
  'dispatch',jsonb_build_object('last_attempt_at',s.last_dispatch_at,'last_success_at',s.last_dispatch_success_at,'next_attempt_at',s.dispatch_next_at,'code',s.dispatch_code),
  'review_reasons',coalesce((select jsonb_object_agg(code,n) from (
   select code,count(*) n from public.receptionist_voicemail_candidates where tenant_id=p_tenant and route_id=p_route and state='needs_review' group by code) reasons),'{}'::jsonb),
  'candidates',(select count(*) from public.receptionist_voicemail_candidates where tenant_id=p_tenant and route_id=p_route),
  'needs_review',(select count(*) from public.receptionist_voicemail_candidates where tenant_id=p_tenant and route_id=p_route and state='needs_review'),
  'excluded',(select count(*) from public.receptionist_voicemail_candidates where tenant_id=p_tenant and route_id=p_route and state='excluded'),
  'jobs',coalesce((select jsonb_object_agg(status,n) from (
   select j.status,count(*) n from public.receptionist_voicemail_candidates c join public.platform_jobs j on j.id=c.job_id and j.tenant_id=c.tenant_id
   where c.tenant_id=p_tenant and c.route_id=p_route group by j.status) counts),'{}'::jsonb)) into result
 from (select 1) anchor left join public.receptionist_voicemail_scans s on s.route_id=p_route and s.tenant_id=p_tenant;
 return result;
end$$;
revoke all on function public.voicemail_discovery_status_data(uuid,uuid) from public,anon,authenticated;
grant execute on function public.voicemail_discovery_status_data(uuid,uuid) to service_role;
create or replace function public.voicemail_discovery_status(p_tenant uuid,p_route uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$begin
 if current_user<>'service_role' then raise exception 'voicemail_discovery_forbidden' using errcode='42501';end if;
 return public.voicemail_discovery_status_data(p_tenant,p_route);
end$$;

-- Existing OpenFolk view authority only; no owner/manager bypass and no raw
-- message, transcript, recipient, caller, storage path or credential is returned.
create function public.learn_operator_voicemail_status(p_tenant uuid,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 with rows as materialized(
  select r.id,r.enabled,case when m.extension~'^[0-9]{3}$' then m.extension else null end as extension from public.receptionist_voicemail_email_routes r
   join public.receptionist_mailboxes m on m.tenant_id=r.tenant_id and m.id=r.mailbox_id
   where r.tenant_id=p_tenant and (p_after is null or r.id>p_after) order by r.id limit 21
 ),shown as(select * from rows order by id limit 20)
 select jsonb_build_object('version','learn-voicemail-status/1','tenant_id',p_tenant,'observed_at',clock_timestamp(),
  'routes',coalesce((select jsonb_agg(jsonb_build_object('route_id',id,'enabled',enabled,'extension',extension,
   'status',public.voicemail_discovery_status_data(p_tenant,id)) order by id) from shown),'[]'::jsonb),
  'next_after',case when (select count(*) from rows)>20 then (select id from shown order by id desc limit 1) else null end)
 into result;
 return result;
end$$;
revoke all on function public.learn_operator_voicemail_status(uuid,uuid) from public,anon;
grant execute on function public.learn_operator_voicemail_status(uuid,uuid) to authenticated;
commit;
