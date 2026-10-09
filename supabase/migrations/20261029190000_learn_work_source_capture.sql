-- Complete forward capture on the existing work ledger, including background
-- writers. No historical timestamps/owners are reconstructed or rewritten.
alter table public.object_state_history
  add column capture_kind text check(capture_kind in ('insert','update','baseline')),
  add column capture_sequence bigint;
alter table public.object_state_history add constraint osh_capture_shape check (
  (capture_kind is null and capture_sequence is null) or
  (capture_kind is not null and capture_sequence is not null and capture_sequence>0
    and work_before is not null and work_after is not null)
);
create sequence public.learn_work_capture_sequence;
create unique index osh_capture_sequence on public.object_state_history(capture_sequence)
  where capture_sequence is not null;
create index osh_capture_read on public.object_state_history(tenant_id,object_id,occurred_at,capture_sequence)
  where capture_kind is not null;

create function public.learn_work_snapshot(p public.intelligence_objects) returns jsonb
language sql immutable set search_path=public as $$
  select jsonb_build_object('status',p.status,'version',p.version,
    'responsible_ref',p.responsible_ref,'accountable_ref',p.accountable_ref,
    'waiting_on_ref',p.waiting_on_ref,'attributes',p.attributes);
$$;

create function public.learn_capture_work_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare b jsonb; a jsonb;
begin
  a:=learn_work_snapshot(new);
  if tg_op='UPDATE' then
    if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id then
      raise exception 'Work identity and tenant are immutable' using errcode='23514';
    end if;
    b:=learn_work_snapshot(old);
    if a=b then return new; end if;
  else b:=a;
  end if;
  insert into object_state_history(tenant_id,object_id,from_state,to_state,actor,reason,
    occurred_at,work_before,work_after,transition_verb,capture_kind,capture_sequence)
  values(new.tenant_id,new.id,b->>'status',a->>'status',
    '{"kind":"system","ref":"database_work_capture"}',
    'Database-observed work change; actor attribution is separate transition evidence',
    clock_timestamp(),b,a,'observed_'||lower(tg_op),lower(tg_op),nextval('learn_work_capture_sequence'));
  return new;
end $$;
create trigger learn_capture_work_change after insert or update on public.intelligence_objects
  for each row execute function public.learn_capture_work_change();

-- Explicit, bounded baseline for an existing item. It starts coverage NOW,
-- never at created_at and never at a guessed historical assignment time.
create function public.learn_work_capture_baseline(p_tenant uuid,p_object uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare o intelligence_objects%rowtype; snapshot jsonb; result uuid;
begin
  select * into o from intelligence_objects where tenant_id=p_tenant and id=p_object for update;
  if not found then raise exception 'Work item not found in tenant' using errcode='P0002'; end if;
  select id into result from object_state_history where tenant_id=p_tenant and object_id=p_object
    and capture_kind is not null order by capture_sequence limit 1;
  if found then return result; end if;
  snapshot:=learn_work_snapshot(o);
  insert into object_state_history(tenant_id,object_id,from_state,to_state,actor,reason,
    occurred_at,work_before,work_after,transition_verb,capture_kind,capture_sequence)
  values(p_tenant,p_object,o.status,o.status,'{"kind":"system","ref":"database_work_baseline"}',
    'Current state baseline; prior ownership duration is unknown',clock_timestamp(),snapshot,snapshot,
    'observed_baseline','baseline',nextval('learn_work_capture_sequence')) returning id into result;
  return result;
end $$;

-- One statement snapshot: period events, preceding state, capture watermark and
-- current object agree. A browser cannot declare history complete using a count
-- from a different read. The reader never creates baselines or writes anything.
create function public.learn_work_history_read(p_tenant uuid,p_object uuid,p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  o intelligence_objects%rowtype; head object_state_history%rowtype;
  coverage_start timestamptz; predecessor bigint; event_count int; events jsonb;
  observed timestamptz:=statement_timestamp(); result jsonb;
begin
  if auth.uid() is null or p_tenant is distinct from current_tenant_id()
    or coalesce(current_user_role(),'') not in ('owner','admin') then
    raise exception 'Owner/admin access in this tenant required' using errcode='42501';
  end if;
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_start>=p_end or p_end>observed or p_end-p_start>interval '366 days' then
    raise exception 'Choose a completed period of at most 366 days' using errcode='22023';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.intelligence_objects'::regclass
    and tgname='learn_capture_work_change' and tgenabled in ('O','A')) then
    raise exception 'Work capture is unavailable' using errcode='55000';
  end if;
  select * into o from intelligence_objects where id=p_object and tenant_id=p_tenant;
  if not found then raise exception 'Work item unavailable in tenant' using errcode='P0002'; end if;
  select * into head from object_state_history where tenant_id=p_tenant and object_id=p_object
    and capture_kind is not null order by capture_sequence desc limit 1;
  if found and (head.work_after is distinct from learn_work_snapshot(o) or head.occurred_at>observed) then
    raise exception 'Current work state does not reconcile with captured history' using errcode='55000';
  end if;
  if exists(select 1 from (
    select occurred_at,work_before,
      lag(occurred_at) over(order by capture_sequence) prior_at,
      lag(work_after) over(order by capture_sequence) prior_state
    from object_state_history where tenant_id=p_tenant and object_id=p_object and capture_kind is not null
  ) h where occurred_at<prior_at or (prior_state is not null and work_before is distinct from prior_state)) then
    raise exception 'Work capture contains an unexplained history gap' using errcode='55000';
  end if;
  select min(occurred_at) into coverage_start from object_state_history
    where tenant_id=p_tenant and object_id=p_object and capture_kind is not null;
  select capture_sequence into predecessor from object_state_history
    where tenant_id=p_tenant and object_id=p_object and capture_kind is not null and occurred_at<p_start
    order by capture_sequence desc limit 1;
  select count(*) into event_count from object_state_history where tenant_id=p_tenant and object_id=p_object
    and capture_kind is not null and (capture_sequence=predecessor or occurred_at between p_start and p_end);
  if event_count>1000 then raise exception 'Work history exceeds this bounded review window' using errcode='54000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'tenantId',tenant_id,'objectId',object_id,'sequence',capture_sequence::text,
    'kind',capture_kind,'occurredAt',occurred_at,'before',work_before,'after',work_after
  ) order by capture_sequence),'[]') into events from object_state_history
    where tenant_id=p_tenant and object_id=p_object and capture_kind is not null
    and (capture_sequence=predecessor or occurred_at between p_start and p_end);
  result:=jsonb_build_object('tenantId',p_tenant,'objectId',p_object,
    'period',jsonb_build_object('start',p_start,'end',p_end),'observedAt',observed,
    'sourceThrough',case when coverage_start is not null then observed end,
    'coverageStart',coverage_start,'count',event_count,'events',events,
    'contract','work-capture@1');
  if octet_length(result::text)>2097152 then raise exception 'Work history exceeds review payload limit' using errcode='54000'; end if;
  return result;
end $$;
revoke all on sequence public.learn_work_capture_sequence from public,anon,authenticated,service_role;
revoke all on function public.learn_work_snapshot(public.intelligence_objects),
  public.learn_capture_work_change(),public.learn_work_capture_baseline(uuid,uuid),
  public.learn_work_history_read(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_capture_baseline(uuid,uuid) to service_role;
grant execute on function public.learn_work_history_read(uuid,uuid,timestamptz,timestamptz) to authenticated;
