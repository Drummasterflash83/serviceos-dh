-- Forward observed membership evidence. Existing dates never backfill coverage.
create table public.learn_member_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  member_id uuid not null references public.team_members(id),
  sequence bigint generated always as identity unique,
  kind text not null check(kind in ('insert','update','baseline')),
  observed_at timestamptz not null default clock_timestamp(),
  before_state jsonb not null check(jsonb_typeof(before_state)='object'),
  after_state jsonb not null check(jsonb_typeof(after_state)='object'),
  check(kind='update' or before_state=after_state)
);
create index learn_member_history_read_idx on public.learn_member_history(tenant_id,member_id,sequence);
alter table public.learn_member_history enable row level security;
revoke all on public.learn_member_history from public,anon,authenticated,service_role;
revoke all on sequence public.learn_member_history_sequence_seq from public,anon,authenticated,service_role;

create function public.learn_member_snapshot(p public.team_members) returns jsonb
language sql immutable set search_path=public as $$
 select jsonb_build_object('profileId',p.profile_id,'teamId',p.org_unit_id,
   'confirmedAt',p.confirmed_at,'effectiveFrom',p.effective_from,'effectiveTo',p.effective_to);
$$;
create function public.learn_member_history_immutable() returns trigger
language plpgsql set search_path=public as $$
begin raise exception 'Membership evidence is append-only' using errcode='55000'; end $$;
create trigger learn_member_history_immutable before update or delete on public.learn_member_history
 for each row execute function public.learn_member_history_immutable();
create trigger learn_member_history_no_truncate before truncate on public.learn_member_history
 for each statement execute function public.learn_member_history_immutable();

create function public.learn_capture_member_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare b jsonb; a jsonb;
begin
 if tg_op='DELETE' or tg_op='TRUNCATE' then
   raise exception 'End memberships instead of removing their identity history' using errcode='55000';
 end if;
 a:=learn_member_snapshot(new);
 if tg_op='UPDATE' then
   if old.id is distinct from new.id or old.tenant_id is distinct from new.tenant_id then
     raise exception 'Member identity and tenant are immutable' using errcode='23514';
   end if;
   b:=learn_member_snapshot(old);
   if a=b then return new; end if;
 else b:=a;
 end if;
 insert into learn_member_history(tenant_id,member_id,kind,before_state,after_state)
 values(new.tenant_id,new.id,lower(tg_op),b,a);
 return new;
end $$;
create trigger learn_capture_member_change after insert or update on public.team_members
 for each row execute function public.learn_capture_member_change();
create trigger learn_member_no_delete before delete on public.team_members
 for each row execute function public.learn_capture_member_change();
create trigger learn_member_no_truncate before truncate on public.team_members
 for each statement execute function public.learn_capture_member_change();

create function public.learn_member_capture_baseline(p_tenant uuid,p_member uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare m team_members%rowtype; result uuid; s jsonb;
begin
 select * into m from team_members where tenant_id=p_tenant and id=p_member for update;
 if not found then raise exception 'Member not found in tenant' using errcode='P0002'; end if;
 select id into result from learn_member_history where tenant_id=p_tenant and member_id=p_member
 order by sequence limit 1;
 if found then return result; end if;
 s:=learn_member_snapshot(m);
 insert into learn_member_history(tenant_id,member_id,kind,before_state,after_state)
 values(p_tenant,p_member,'baseline',s,s) returning id into result;
 return result;
end $$;

-- Bounded, coherent whole-roster read, required to detect ambiguous user->member
-- mappings. A missing member history is explicit, never treated as no membership.
create function public.learn_member_history_read(p_tenant uuid,p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare m team_members%rowtype; head learn_member_history%rowtype; first_event learn_member_history%rowtype;
 predecessor bigint; n int; total_events int:=0; total_members int; events jsonb; members jsonb:='[]';
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
 if (select count(*) from pg_trigger where tgrelid='public.team_members'::regclass
   and tgname in ('learn_capture_member_change','learn_member_no_delete','learn_member_no_truncate')
   and tgenabled in ('O','A'))<>3 then
   raise exception 'Membership capture is unavailable' using errcode='55000';
 end if;
 select count(*) into total_members from team_members where tenant_id=p_tenant;
 if total_members>500 then raise exception 'Roster exceeds bounded history review' using errcode='54000'; end if;
 for m in select * from team_members where tenant_id=p_tenant order by id loop
   select * into head from learn_member_history where tenant_id=p_tenant and member_id=m.id order by sequence desc limit 1;
   if found and (head.after_state is distinct from learn_member_snapshot(m) or head.observed_at>observed) then
     raise exception 'Current membership does not reconcile with captured history' using errcode='55000';
   end if;
   if exists(select 1 from (
     select observed_at,before_state,
       lag(observed_at) over(order by sequence) prior_at,
       lag(after_state) over(order by sequence) prior_state
     from learn_member_history where tenant_id=p_tenant and member_id=m.id
   ) h where observed_at<prior_at or (prior_state is not null and before_state is distinct from prior_state)) then
     raise exception 'Membership capture contains an unexplained history gap' using errcode='55000';
   end if;
   select * into first_event from learn_member_history where tenant_id=p_tenant and member_id=m.id order by sequence limit 1;
   select sequence into predecessor from learn_member_history where tenant_id=p_tenant and member_id=m.id
     and observed_at<p_start order by sequence desc limit 1;
   select count(*) into n from learn_member_history where tenant_id=p_tenant and member_id=m.id
     and (sequence=predecessor or observed_at between p_start and p_end);
   total_events:=total_events+n;
   if n>1000 or total_events>5000 then raise exception 'Membership history exceeds bounded review' using errcode='54000'; end if;
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'sequence',sequence::text,'kind',kind,
     'observedAt',observed_at,'before',before_state,'after',after_state) order by sequence),'[]') into events
     from learn_member_history where tenant_id=p_tenant and member_id=m.id
     and (sequence=predecessor or observed_at between p_start and p_end);
   members:=members||jsonb_build_array(jsonb_build_object('memberId',m.id,
     'coverageStart',first_event.observed_at,'firstKind',first_event.kind,
     'sourceThrough',case when first_event.id is not null then observed end,'count',n,'events',events));
 end loop;
 result:=jsonb_build_object('contract','member-capture@1','tenantId',p_tenant,
   'period',jsonb_build_object('start',p_start,'end',p_end),'observedAt',observed,
   'count',total_members,'members',members);
 if octet_length(result::text)>2097152 then raise exception 'Membership history exceeds payload limit' using errcode='54000'; end if;
 return result;
end $$;
revoke all on function public.learn_member_snapshot(public.team_members),public.learn_member_history_immutable(),
 public.learn_capture_member_change(),public.learn_member_capture_baseline(uuid,uuid),
 public.learn_member_history_read(uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.learn_member_capture_baseline(uuid,uuid) to service_role;
grant execute on function public.learn_member_history_read(uuid,timestamptz,timestamptz) to authenticated;
