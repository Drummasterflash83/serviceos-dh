-- Retained-email discovery only. No routes, credentials, schedules or grants to
-- people are created. Candidate selection is NOT signature/ownership validation.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
create table public.receptionist_voicemail_scans(
 tenant_id uuid not null,route_id uuid primary key,
 generation integer not null default 1,last_id uuid,rows_examined bigint not null default 0,
 pages integer not null default 0,started_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,next_scan_at timestamptz,
 foreign key(tenant_id,route_id) references public.receptionist_voicemail_email_routes(tenant_id,id)
);
create table public.receptionist_voicemail_candidates(
 tenant_id uuid not null,route_id uuid not null,email_message_id uuid not null references public.email_messages(id),
 job_id uuid unique references public.platform_jobs(id),
 state text not null check(state in('selected','needs_review','excluded')),
 code text not null,observed_at timestamptz not null default clock_timestamp(),
 primary key(route_id,email_message_id),
 foreign key(tenant_id,route_id) references public.receptionist_voicemail_email_routes(tenant_id,id)
);
create table public.receptionist_voicemail_scan_receipts(
 request_id uuid primary key,tenant_id uuid not null,route_id uuid not null,
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,route_id) references public.receptionist_voicemail_email_routes(tenant_id,id)
);
create unique index voicemail_discovery_source_job_uk on public.receptionist_voicemail_candidates(tenant_id,email_message_id) where job_id is not null;
alter table public.receptionist_voicemail_scans enable row level security;
alter table public.receptionist_voicemail_candidates enable row level security;
alter table public.receptionist_voicemail_scan_receipts enable row level security;
revoke all on public.receptionist_voicemail_scans,public.receptionist_voicemail_candidates,public.receptionist_voicemail_scan_receipts from public,anon,authenticated;
grant select,insert,update on public.receptionist_voicemail_scans,public.receptionist_voicemail_candidates to service_role;
grant select,insert on public.receptionist_voicemail_scan_receipts to service_role;
create trigger voicemail_scan_receipt_immutable before update or delete on public.receptionist_voicemail_scan_receipts
 for each row execute function public.voicemail_job_immutable();
create index email_messages_voicemail_scan_idx on public.email_messages(tenant_id,id) where provider='gmail';

-- Each request consumes at most 100 retained rows; a receipt makes a lost reply
-- replayable without advancing a second page. State, candidates and jobs commit
-- together. Repeated passes from the start catch inserts behind the UUID cursor
-- and corrected labels/account bindings; this is not a provider snapshot.
create function public.voicemail_discover_page(p_tenant uuid,p_route uuid,p_request uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog set timezone='UTC' as $$
declare r public.receptionist_voicemail_email_routes%rowtype;s public.receptionist_voicemail_scans%rowtype;
 e public.email_messages%rowtype;c public.receptionist_voicemail_candidates%rowtype;
 saved public.receptionist_voicemail_scan_receipts%rowtype;ext text;code text;state text;request jsonb;
 job uuid;previous_request jsonb;matches integer;n integer:=0;selected integer:=0;review integer:=0;excluded_count integer:=0;
 at_time timestamptz;result jsonb;last_seen uuid;finished boolean;millis numeric;
begin
 if current_user<>'service_role' then raise exception 'voicemail_discovery_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_route is null or p_request is null or current_setting('transaction_isolation')<>'read committed'
 then raise exception 'voicemail_discovery_request_invalid' using errcode='22023';end if;
 -- Serialize a request even if it is accidentally reused for another route.
 perform pg_advisory_xact_lock(hashtextextended('voicemail-discovery:'||p_request::text,0));
 select * into saved from public.receptionist_voicemail_scan_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.route_id<>p_route then raise exception 'voicemail_discovery_request_conflict' using errcode='PT409';end if;
  return saved.receipt; -- historical page acknowledgement, not fresh health
 end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into r from public.receptionist_voicemail_email_routes where tenant_id=p_tenant and id=p_route for share;
 if not found then raise exception 'voicemail_route_unverified' using errcode='22023';end if;
 -- Reuse the authoritative route/account/capture gate checks, at its interval start.
 perform public.voicemail_intake_route(p_tenant,p_route,r.received_from);
 select extension into ext from public.receptionist_mailboxes where tenant_id=p_tenant and id=r.mailbox_id and provider='birchills';
 if ext is null or ext!~'^[0-9]{3}$' or r.signing_domain<>'birchills-net.20251104.gappssmtp.com'
 then raise exception 'voicemail_route_unverified' using errcode='22023';end if;
 insert into public.receptionist_voicemail_scans(tenant_id,route_id) values(p_tenant,p_route) on conflict do nothing;
 select * into s from public.receptionist_voicemail_scans where route_id=p_route for update;
 at_time:=clock_timestamp();
 if s.completed_at is not null and s.next_scan_at>at_time then
  result:=jsonb_build_object('state','waiting','generation',s.generation,'observed_at',at_time,'next_scan_at',s.next_scan_at,
   'rows_examined',0,'jobs_enqueued',0,'coverage_complete',false);
 else
  if s.completed_at is not null then
   s.generation:=s.generation+1;s.last_id:=null;s.rows_examined:=0;s.pages:=0;s.started_at:=at_time;s.completed_at:=null;s.next_scan_at:=null;
  end if;
  for e in select * from public.email_messages where tenant_id=p_tenant and provider='gmail'
   and (s.last_id is null or id>s.last_id) order by id limit 100
  loop
   n:=n+1;last_seen:=e.id;
   -- Broad subject/sender hints choose candidates only. Untrusted content never
   -- assigns ownership or bypasses original-message DKIM/audio validation.
   if e.subject is null or e.subject!~('^New message in mailbox '||ext||' from .+$')
    or lower(coalesce(e.from_email,''))!~'^[^[:space:]@]+@birchills[.]net$' then continue;end if;
   if e.raw_payload->>'provider_account_id' is not null and e.raw_payload->>'provider_account_id'<>r.email_account_id::text then continue;end if;
   if e.received_at is not null and isfinite(e.received_at)
    and (e.received_at<r.received_from or (r.received_until is not null and e.received_at>=r.received_until)) then continue;end if;
   code:=null;state:='needs_review';request:=null;job:=null;
   if e.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb then code:='voicemail_source_ineligible';state:='excluded';
   elsif e.raw_payload->>'provider_account_id' is distinct from r.email_account_id::text then code:='voicemail_mailbox_binding_unverified';
   elsif e.raw_payload->>'provider_availability'='unavailable' then code:='voicemail_provider_source_unavailable';
   elsif e.provider_message_id is null or e.provider_message_id!~'^[a-f0-9]{1,64}$' then code:='voicemail_provider_response_invalid';
   elsif e.received_at is null or not isfinite(e.received_at) then code:='voicemail_received_time_unverified';
   else
    millis:=extract(epoch from e.received_at)*1000;
    if millis<0 or millis>8640000000000000 or trunc(millis)<>millis then code:='voicemail_received_time_unverified';
    else
     select count(*) into matches from public.receptionist_voicemail_email_routes other
      join public.receptionist_mailboxes m on m.tenant_id=other.tenant_id and m.id=other.mailbox_id
      where other.tenant_id=p_tenant and other.email_account_id=r.email_account_id and other.enabled
       and m.provider='birchills' and m.extension=ext and e.received_at>=other.received_from
       and (other.received_until is null or e.received_at<other.received_until);
     if matches<>1 then code:='voicemail_route_ambiguous';
     elsif exists(select 1 from public.receptionist_voicemail_candidates prior
      where prior.tenant_id=p_tenant and prior.email_message_id=e.id and prior.route_id<>p_route and prior.job_id is not null)
     then code:='voicemail_source_previously_routed';
     else
      request:=jsonb_build_object('routeId',p_route,'accountId',r.email_account_id,'messageId',e.provider_message_id,'internalDate',trunc(millis)::text);
      code:='voicemail_selected';state:='selected';
     end if;
    end if;
   end if;
   select * into c from public.receptionist_voicemail_candidates where route_id=p_route and email_message_id=e.id for update;
   if found and c.job_id is not null then
    job:=c.job_id;
    select payload into previous_request from public.platform_jobs where id=job and tenant_id=p_tenant and job_type='phone.voicemail_import';
    if request is not null and previous_request is distinct from request then code:='voicemail_provider_source_changed';state:='needs_review';end if;
    -- Retain settled/dead-letter jobs; discovery is never an unbounded retry loop.
   elsif request is not null then
    insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,payload,max_attempts,available_at)
    values(p_tenant,'google-workspace','communications.phone','phone.voicemail_import',
     'voicemail-discovery:'||p_route::text||':'||e.id::text,'queued',request,3,at_time) returning id into job;
    selected:=selected+1;
   end if;
   if state='needs_review' then review:=review+1;elsif state='excluded' then excluded_count:=excluded_count+1;end if;
   insert into public.receptionist_voicemail_candidates(tenant_id,route_id,email_message_id,job_id,state,code,observed_at)
    values(p_tenant,p_route,e.id,job,state,code,at_time)
    on conflict(route_id,email_message_id) do update set job_id=excluded.job_id,state=excluded.state,code=excluded.code,observed_at=excluded.observed_at;
  end loop;
  s.last_id:=coalesce(last_seen,s.last_id);s.rows_examined:=s.rows_examined+n;s.pages:=s.pages+1;
  -- An exact 100-row page conservatively requires an additional empty page.
  finished:=n<100;
  if finished then s.completed_at:=clock_timestamp();s.next_scan_at:=s.completed_at+interval '15 minutes';end if;
  update public.receptionist_voicemail_scans set generation=s.generation,last_id=s.last_id,rows_examined=s.rows_examined,pages=s.pages,
   started_at=s.started_at,completed_at=s.completed_at,next_scan_at=s.next_scan_at where route_id=p_route;
  result:=jsonb_build_object('state',case when finished then 'retained_pass_complete' else 'scanning' end,'generation',s.generation,
   'observed_at',at_time,'rows_examined',n,'pass_rows_examined',s.rows_examined,'jobs_enqueued',selected,
   'needs_review',review,'excluded',excluded_count,'coverage_complete',false);
 end if;
 insert into public.receptionist_voicemail_scan_receipts(request_id,tenant_id,route_id,receipt) values(p_request,p_tenant,p_route,result);
 return result;
end$$;

-- Service-only aggregate for the operator controller. No names, caller numbers,
-- transcripts or source identifiers. Counters are observations, not provider coverage.
create function public.voicemail_discovery_status(p_tenant uuid,p_route uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare result jsonb;
begin
 if current_user<>'service_role' then raise exception 'voicemail_discovery_forbidden' using errcode='42501';end if;
 if not exists(select 1 from public.receptionist_voicemail_email_routes where tenant_id=p_tenant and id=p_route)
 then raise exception 'voicemail_route_unverified' using errcode='22023';end if;
 select jsonb_build_object('scope','retained_email_candidates','coverage_complete',false,
  'generation',s.generation,'pass_started_at',s.started_at,'pass_completed_at',s.completed_at,'rows_examined',s.rows_examined,
  'next_scan_at',s.next_scan_at,'observed_at',clock_timestamp(),
  'candidates',(select count(*) from public.receptionist_voicemail_candidates where tenant_id=p_tenant and route_id=p_route),
  'needs_review',(select count(*) from public.receptionist_voicemail_candidates where tenant_id=p_tenant and route_id=p_route and state='needs_review'),
  'excluded',(select count(*) from public.receptionist_voicemail_candidates where tenant_id=p_tenant and route_id=p_route and state='excluded'),
  'jobs',coalesce((select jsonb_object_agg(status,n) from (
   select j.status,count(*) n from public.receptionist_voicemail_candidates c join public.platform_jobs j on j.id=c.job_id and j.tenant_id=c.tenant_id
   where c.tenant_id=p_tenant and c.route_id=p_route group by j.status) counts),'{}'::jsonb)) into result
 from (select 1) anchor left join public.receptionist_voicemail_scans s on s.route_id=p_route and s.tenant_id=p_tenant;
 return result;
end$$;
revoke all on function public.voicemail_discover_page(uuid,uuid,uuid),public.voicemail_discovery_status(uuid,uuid) from public,anon,authenticated;
grant execute on function public.voicemail_discover_page(uuid,uuid,uuid),public.voicemail_discovery_status(uuid,uuid) to service_role;
commit;
