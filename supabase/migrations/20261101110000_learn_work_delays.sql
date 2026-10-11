-- Candidate: explicit owner-reviewed delay exclusions. No source or score writes.
create table public.learn_work_delay_events (
 id uuid primary key,tenant_id uuid not null references public.tenants(id),object_id uuid not null,
 revision integer not null check(revision>0),decision text not null check(decision in ('approve','reverse')),
 approval_id uuid,window_start timestamptz not null,window_end timestamptz not null,
 label text not null check(length(btrim(label)) between 1 and 200),
 reason text not null check(length(btrim(reason)) between 1 and 1000),
 evidence_ids uuid[] not null,actor_id uuid not null references public.profiles(id),
 recorded_at timestamptz not null default clock_timestamp(),request jsonb not null,proof jsonb,
 unique(tenant_id,object_id,revision),unique(tenant_id,object_id,id),unique(approval_id),
 foreign key(tenant_id,object_id,approval_id) references public.learn_work_delay_events(tenant_id,object_id,id),
 check(isfinite(window_start) and isfinite(window_end) and window_start<window_end and window_end<=recorded_at),
 check((decision='approve' and approval_id is null and proof is not null and cardinality(evidence_ids) between 1 and 50)
    or (decision='reverse' and approval_id is not null and proof is null and cardinality(evidence_ids)=0)),
 check(proof is null or octet_length(proof::text)<=2097152)
);
create index learn_work_delay_scope on public.learn_work_delay_events(tenant_id,object_id,recorded_at,revision);
create table public.learn_work_delay_cancellations (
 id uuid primary key,tenant_id uuid not null references public.tenants(id),object_id uuid not null,
 actor_id uuid not null references public.profiles(id),request jsonb not null,recorded_at timestamptz not null default clock_timestamp()
);
alter table public.learn_work_delay_events enable row level security;
alter table public.learn_work_delay_cancellations enable row level security;
revoke all on public.learn_work_delay_events,public.learn_work_delay_cancellations from public,anon,authenticated,service_role;
grant select on public.learn_work_delay_events,public.learn_work_delay_cancellations to authenticated;
create policy learn_work_delay_events_read on public.learn_work_delay_events for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create policy learn_work_delay_cancellations_read on public.learn_work_delay_cancellations for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create function public.learn_work_delay_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$begin
 raise exception 'Delay review evidence is immutable' using errcode='55000';end $$;
revoke all on function public.learn_work_delay_immutable() from public,anon,authenticated,service_role;
create trigger learn_work_delay_events_immutable before update or delete on public.learn_work_delay_events for each row execute function public.learn_work_delay_immutable();
create trigger learn_work_delay_events_no_truncate before truncate on public.learn_work_delay_events for each statement execute function public.learn_work_delay_immutable();
create trigger learn_work_delay_cancellations_immutable before update or delete on public.learn_work_delay_cancellations for each row execute function public.learn_work_delay_immutable();
create trigger learn_work_delay_cancellations_no_truncate before truncate on public.learn_work_delay_cancellations for each statement execute function public.learn_work_delay_immutable();

-- Canonical descriptor is shared by record and recovery. Recovery validates syntax
-- without requiring current source data/heads, so a stale unsent request can end.
create function public.learn_work_delay_request(p_tenant uuid,p_actor uuid,p_payload jsonb) returns jsonb
language plpgsql stable set search_path=public,pg_temp set timezone='UTC' as $$
declare o uuid;n numeric;a uuid;s timestamptz;e timestamptz;ids uuid[];begin
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>32768 then raise exception 'Invalid delay request' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_payload))<>8 or exists(select 1 from jsonb_object_keys(p_payload) k
   where k not in ('objectId','expectedRevision','decision','approvalId','period','label','evidenceIds','reason'))
  or jsonb_typeof(p_payload->'objectId') is distinct from 'string'
  or jsonb_typeof(p_payload->'expectedRevision') is distinct from 'number'
  or coalesce(p_payload->>'decision','') not in ('approve','reverse')
  or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason')) not between 1 and 1000
  or jsonb_typeof(p_payload->'evidenceIds') is distinct from 'array' then raise exception 'Complete delay review descriptor required' using errcode='22023';end if;
 o:=(p_payload->>'objectId')::uuid;n:=(p_payload->>'expectedRevision')::numeric;
 if n<0 or n>=2147483647 or mod(n,1)<>0 then raise exception 'Invalid delay revision' using errcode='22023';end if;
 if p_payload->>'decision'='approve' then
  if p_payload->'approvalId' is distinct from 'null'::jsonb or jsonb_typeof(p_payload->'period') is distinct from 'object'
   or jsonb_typeof(p_payload->'label') is distinct from 'string' or length(btrim(p_payload->>'label')) not between 1 and 200
   or jsonb_array_length(p_payload->'evidenceIds') not between 1 and 50 then raise exception 'Delay interval, label and captured evidence required' using errcode='22023';end if;
  if (select count(*) from jsonb_object_keys(p_payload->'period'))<>2 or exists(select 1 from jsonb_object_keys(p_payload->'period') k where k not in ('start','end'))
   or jsonb_typeof(p_payload#>'{period,start}') is distinct from 'string' or jsonb_typeof(p_payload#>'{period,end}') is distinct from 'string'
   or (p_payload#>>'{period,start}')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' or (p_payload#>>'{period,end}')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Explicit interval timezone required' using errcode='22023';end if;
  s:=(p_payload#>>'{period,start}')::timestamptz;e:=(p_payload#>>'{period,end}')::timestamptz;
  if s is null or e is null or not isfinite(s) or not isfinite(e) or s>=e or e-s>interval '366 days'
   or s<timestamptz '2000-01-01T00:00:00Z' or e>timestamptz '2201-01-01T00:00:00Z' then raise exception 'Invalid delay interval' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'evidenceIds') x where jsonb_typeof(x) is distinct from 'string') then raise exception 'Captured evidence IDs required' using errcode='22023';end if;
  select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(p_payload->'evidenceIds');
  if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Duplicate delay evidence' using errcode='22023';end if;
 else
  if jsonb_typeof(p_payload->'approvalId') is distinct from 'string' or p_payload->'period' is distinct from 'null'::jsonb
   or p_payload->'label' is distinct from 'null'::jsonb or p_payload->'evidenceIds'<>'[]'::jsonb then raise exception 'Reversal must reference the original approval' using errcode='22023';end if;
  a:=(p_payload->>'approvalId')::uuid;ids:='{}';
 end if;
 return jsonb_build_object('tenantId',p_tenant,'actorId',p_actor,'objectId',o,'expectedRevision',n::integer,
  'decision',p_payload->>'decision','approvalId',a,'period',case when s is not null then jsonb_build_object('start',s,'end',e) end,
  'label',case when s is not null then btrim(p_payload->>'label') end,'evidenceIds',to_jsonb(ids),'reason',btrim(p_payload->>'reason'));
end $$;
revoke all on function public.learn_work_delay_request(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.learn_work_delay_entry(r public.learn_work_delay_events) returns jsonb
language sql stable set search_path=public,pg_temp as $$select jsonb_build_object('id',r.id,'tenantId',r.tenant_id,'objectId',r.object_id,
 'revision',r.revision,'decision',r.decision,'approvalId',r.approval_id,'period',jsonb_build_object('start',r.window_start,'end',r.window_end),
 'label',r.label,'reason',r.reason,'evidenceIds',to_jsonb(r.evidence_ids),'recordedBy',r.actor_id,'recordedAt',r.recorded_at)$$;
revoke all on function public.learn_work_delay_entry(public.learn_work_delay_events) from public,anon,authenticated,service_role;

create function public.learn_work_delay_record(p_tenant uuid,p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);descriptor jsonb;item uuid;r learn_work_delay_events%rowtype;
 original learn_work_delay_events%rowtype;n integer;s timestamptz;e timestamptz;capture jsonb;ids uuid[];at_time timestamptz;begin
 if p_request is null then raise exception 'Delay request identity required' using errcode='22023';end if;
 descriptor:=learn_work_delay_request(p_tenant,actor,p_payload);item:=(descriptor->>'objectId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('learn-delay-request:'||p_request::text,0));
 if exists(select 1 from learn_work_delay_cancellations where id=p_request) then raise exception 'Delay request cancelled' using errcode='PT409';end if;
 select * into r from learn_work_delay_events where id=p_request;
 if found then
  if r.request is distinct from descriptor then raise exception 'Delay request changed' using errcode='PT409';end if;
 else
  perform pg_advisory_xact_lock(hashtextextended('learn-delay-object:'||p_tenant::text||':'||item::text,0));
  select coalesce(max(revision),0) into n from learn_work_delay_events where tenant_id=p_tenant and object_id=item;
  if n<>(descriptor->>'expectedRevision')::integer then raise exception 'Delay review history changed' using errcode='PT409';end if;
  if descriptor->>'decision'='approve' then
   s:=(descriptor#>>'{period,start}')::timestamptz;e:=(descriptor#>>'{period,end}')::timestamptz;
   if e>statement_timestamp() then raise exception 'Review a completed delay interval' using errcode='22023';end if;
   -- Hold the actual object stable while the existing reader checks its capture.
   perform 1 from intelligence_objects where id=item and tenant_id=p_tenant for share;
   if not found then raise exception 'Work item unavailable in this company' using errcode='22023';end if;
   capture:=learn_work_history_read(p_tenant,item,s,e);
   if capture->>'coverageStart' is null or (capture->>'coverageStart')::timestamptz>s
    or (capture->>'count')::integer=0 then raise exception 'Continuous captured history is required for a delay approval' using errcode='22023';end if;
   select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(descriptor->'evidenceIds');
   if exists(select 1 from unnest(ids) x where not exists(select 1 from jsonb_array_elements(capture->'events') ev where ev->>'id'=x::text)) then
    raise exception 'Delay evidence must come from this work item and review interval' using errcode='22023';end if;
   at_time:=clock_timestamp();
   if exists(select 1 from learn_work_delay_events where tenant_id=p_tenant and object_id=item and recorded_at>=at_time) then raise exception 'Delay review clock must advance' using errcode='55000';end if;
   insert into learn_work_delay_events(id,tenant_id,object_id,revision,decision,window_start,window_end,label,reason,evidence_ids,actor_id,recorded_at,request,proof)
    values(p_request,p_tenant,item,n+1,'approve',s,e,descriptor->>'label',descriptor->>'reason',ids,actor,at_time,descriptor,capture) returning * into r;
  else
   select * into original from learn_work_delay_events where id=(descriptor->>'approvalId')::uuid and tenant_id=p_tenant and object_id=item and decision='approve';
   if not found or exists(select 1 from learn_work_delay_events where approval_id=original.id) then raise exception 'Original delay approval missing or already reversed' using errcode='PT409';end if;
   at_time:=clock_timestamp();
   if exists(select 1 from learn_work_delay_events where tenant_id=p_tenant and object_id=item and recorded_at>=at_time) then raise exception 'Delay review clock must advance' using errcode='55000';end if;
   if at_time<=original.recorded_at then raise exception 'Delay review clock must advance' using errcode='55000';end if;
   insert into learn_work_delay_events(id,tenant_id,object_id,revision,decision,approval_id,window_start,window_end,label,reason,evidence_ids,actor_id,recorded_at,request)
    values(p_request,p_tenant,item,n+1,'reverse',original.id,original.window_start,original.window_end,original.label,descriptor->>'reason','{}',actor,at_time,descriptor) returning * into r;
  end if;
 end if;
 perform learn_work_collection_access(p_tenant);
 return jsonb_build_object('contract','work-delay-record@1','entry',learn_work_delay_entry(r));
end $$;
revoke all on function public.learn_work_delay_record(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_delay_record(uuid,uuid,jsonb) to authenticated;

create function public.learn_work_delay_resolve(p_tenant uuid,p_request uuid,p_payload jsonb,p_cancel boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);descriptor jsonb;retained jsonb;outcome text:='pending';at_time timestamptz;begin
 if p_request is null or p_cancel is null then raise exception 'Delay request and recovery action required' using errcode='22023';end if;
 descriptor:=learn_work_delay_request(p_tenant,actor,p_payload);
 perform pg_advisory_xact_lock(hashtextextended('learn-delay-request:'||p_request::text,0));
 select request,recorded_at into retained,at_time from learn_work_delay_events where id=p_request;
 if found then outcome:='recorded';else
  select request,recorded_at into retained,at_time from learn_work_delay_cancellations where id=p_request;
  if found then outcome:='cancelled';end if;
 end if;
 if outcome<>'pending' then
  if retained is distinct from descriptor then raise exception 'Delay request changed' using errcode='PT409';end if;
 elsif p_cancel then
  insert into learn_work_delay_cancellations(id,tenant_id,object_id,actor_id,request)
   values(p_request,p_tenant,(descriptor->>'objectId')::uuid,actor,descriptor) returning recorded_at into at_time;
  outcome:='cancelled';
 end if;
 perform learn_work_collection_access(p_tenant);
 return jsonb_build_object('contract','work-delay-resolution@1','tenantId',p_tenant,'actorId',actor,'requestId',p_request,
  'payload',descriptor-'tenantId'-'actorId','state',outcome,'recordedAt',at_time);
end $$;
revoke all on function public.learn_work_delay_resolve(uuid,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_delay_resolve(uuid,uuid,jsonb,boolean) to authenticated;

-- Fixed revision pagination returns all decisions, including reversals. Large
-- proofs are read separately so a page never expands every captured work history.
create function public.learn_work_delay_read(p_tenant uuid,p_object uuid,p_after integer,p_through integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);head integer;rows jsonb;last_revision integer;begin
 if p_object is null or p_after is null or p_after<0 then raise exception 'Delay object and cursor required' using errcode='22023';end if;
 select coalesce(max(revision),0) into head from learn_work_delay_events where tenant_id=p_tenant and object_id=p_object;
 if p_through is not null then
  if p_through<0 or p_through>head then raise exception 'Invalid retained delay head' using errcode='22023';end if;
  head:=p_through;
 end if;
 if p_after>head then raise exception 'Delay cursor exceeds retained head' using errcode='22023';end if;
 select coalesce(jsonb_agg(learn_work_delay_entry(r) order by revision),'[]'),coalesce(max(revision),p_after) into rows,last_revision
 from (select * from learn_work_delay_events where tenant_id=p_tenant and object_id=p_object and revision>p_after and revision<=head order by revision limit 100) r;
 return jsonb_build_object('contract','work-delay-page@1','tenantId',p_tenant,'objectId',p_object,'after',p_after,'through',head,'next',last_revision,
  'hasMore',last_revision<head,'entries',rows);
end $$;
revoke all on function public.learn_work_delay_read(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_delay_read(uuid,uuid,integer,integer) to authenticated;

create function public.learn_work_delay_evidence(p_tenant uuid,p_object uuid,p_approval uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_delay_events%rowtype;begin
 select * into r from learn_work_delay_events where id=p_approval and tenant_id=p_tenant and object_id=p_object and decision='approve';
 if not found then raise exception 'Delay approval unavailable in this work item' using errcode='22023';end if;
 return jsonb_build_object('contract','work-delay-evidence@1','tenantId',p_tenant,'objectId',p_object,'approval',learn_work_delay_entry(r),'capture',r.proof);
end $$;
revoke all on function public.learn_work_delay_evidence(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_delay_evidence(uuid,uuid,uuid) to authenticated;

-- Future collectors must retain this snapshot alongside calendar/work/roster
-- inputs. Reversals affect new snapshots; existing receipts are never rewritten.
create function public.learn_work_delay_snapshot(p_tenant uuid,p_object uuid,p_start timestamptz,p_end timestamptz,p_observed timestamptz) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);head integer;approvals jsonb;windows jsonb;n integer;begin
 if p_object is null or p_start is null or p_end is null or p_observed is null or not isfinite(p_start) or not isfinite(p_end) or not isfinite(p_observed)
  or p_start>=p_end or p_end>p_observed or p_observed>clock_timestamp() or p_end-p_start>interval '366 days' then raise exception 'Invalid delay snapshot period' using errcode='22023';end if;
 select coalesce(max(revision),0) into head from learn_work_delay_events where tenant_id=p_tenant and object_id=p_object and recorded_at<=p_observed;
 select count(*) into n from learn_work_delay_events a where a.tenant_id=p_tenant and a.object_id=p_object and a.revision<=head and a.decision='approve'
  and a.window_start<p_end and a.window_end>p_start and not exists(select 1 from learn_work_delay_events r where r.approval_id=a.id and r.revision<=head);
 if n>1000 then raise exception 'Delay evidence exceeds one item snapshot limit' using errcode='54000';end if;
 select coalesce(jsonb_agg(learn_work_delay_entry(a) order by a.revision),'[]') into approvals from learn_work_delay_events a
  where a.tenant_id=p_tenant and a.object_id=p_object and a.revision<=head and a.decision='approve' and a.window_start<p_end and a.window_end>p_start
   and not exists(select 1 from learn_work_delay_events r where r.approval_id=a.id and r.revision<=head);
 -- Union overlapping intervals once before ownership/calendar intersection.
 with spans as (select greatest((v#>>'{period,start}')::timestamptz,p_start) s,least((v#>>'{period,end}')::timestamptz,p_end) e from jsonb_array_elements(approvals) v),
 prior as (select s,e,max(e) over(order by s,e rows between unbounded preceding and 1 preceding) previous_end from spans),
 labelled as (select s,e,sum(case when previous_end is null or s>previous_end then 1 else 0 end) over(order by s,e) grp from prior),
 merged as (select min(s) s,max(e) e from labelled group by grp)
 select coalesce(jsonb_agg(jsonb_build_object('start',s,'end',e) order by s),'[]') into windows from merged;
 return jsonb_build_object('contract','work-delay-snapshot@1','tenantId',p_tenant,'objectId',p_object,'through',head,'observedAt',p_observed,
  'period',jsonb_build_object('start',p_start,'end',p_end),'approvals',approvals,'windows',windows);
end $$;
revoke all on function public.learn_work_delay_snapshot(uuid,uuid,timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;
