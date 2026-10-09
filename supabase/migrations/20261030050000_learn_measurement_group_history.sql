-- A current roster row cannot prove that somebody belonged to a team for an
-- earlier assessment period. Use retained, reconciled observed membership.
create function public.learn_member_group_covers(p_tenant uuid,p_member uuid,p_group uuid,p_start timestamptz,p_end timestamptz)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare m team_members%rowtype; h learn_member_history%rowtype; previous learn_member_history%rowtype;
 head learn_member_history%rowtype; n int; cursor_at timestamptz; segment_end timestamptz; s jsonb;
begin
 if p_tenant is null or p_member is null or p_group is null or p_start is null or p_end is null
   or not isfinite(p_start) or not isfinite(p_end) or p_start>=p_end or p_end>statement_timestamp() then return false;end if;
 select * into m from team_members where id=p_member and tenant_id=p_tenant for share;
 if not found or not exists(select 1 from org_units where id=p_group and tenant_id=p_tenant) then return false;end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.team_members'::regclass
   and tgname='learn_capture_member_change' and tgenabled in ('O','A')) then
  raise exception 'Membership capture unavailable' using errcode='55000';end if;
 select count(*) into n from learn_member_history where tenant_id=p_tenant and member_id=p_member;
 if n>1000 then raise exception 'Membership history exceeds bounded proof' using errcode='54000';end if;
 if n=0 then return false;end if;
 select * into head from learn_member_history where tenant_id=p_tenant and member_id=p_member order by sequence desc limit 1;
 if head.after_state is distinct from learn_member_snapshot(m) or head.observed_at>statement_timestamp() then
  raise exception 'Current membership does not reconcile with history' using errcode='55000';end if;
 cursor_at:=p_start;
 for h in select * from learn_member_history where tenant_id=p_tenant and member_id=p_member order by sequence loop
  if previous.id is not null then
   if h.observed_at<previous.observed_at or h.before_state is distinct from previous.after_state then
    raise exception 'Membership history has an unexplained gap' using errcode='55000';end if;
   segment_end:=least(h.observed_at,p_end);
   if segment_end>cursor_at then
    if previous.observed_at>cursor_at then return false;end if;
    s:=previous.after_state;
    if s->>'teamId' is distinct from p_group::text or s->>'confirmedAt' is null
      or (s->>'confirmedAt')::timestamptz>cursor_at or s->>'effectiveFrom' is null
      or (s->>'effectiveFrom')::timestamptz>cursor_at
      or (s->>'effectiveTo' is not null and (s->>'effectiveTo')::timestamptz<segment_end) then return false;end if;
    cursor_at:=segment_end;
   end if;
  end if;
  previous:=h;
 end loop;
 if cursor_at<p_end then
  if previous.observed_at>cursor_at then return false;end if;
  s:=previous.after_state;
  if s->>'teamId' is distinct from p_group::text or s->>'confirmedAt' is null
    or (s->>'confirmedAt')::timestamptz>cursor_at or s->>'effectiveFrom' is null
    or (s->>'effectiveFrom')::timestamptz>cursor_at
    or (s->>'effectiveTo' is not null and (s->>'effectiveTo')::timestamptz<p_end) then return false;end if;
 end if;
 return true;
end $$;
revoke all on function public.learn_member_group_covers(uuid,uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
-- Retain all existing adapter validation and its current evidence allowlist.
do $patch$ declare definition text; original text; replacement text; begin
 select pg_get_functiondef('public.learn_performance_append(uuid,jsonb,text)'::regprocedure) into definition;
 original:=$old$   select * into member from public.team_members where id=sid and tenant_id=p_tenant_id for share;
   if member.org_unit_id is distinct from (policy->>'groupId')::uuid or member.confirmed_at is null
    or member.effective_from>start_at or (member.effective_to is not null and member.effective_to<end_at) then
    raise exception 'Team membership does not establish the entire period' using errcode='22023';
   end if;
   groups:=array[member.org_unit_id];$old$;
 replacement:=$new$   if not public.learn_member_group_covers(p_tenant_id,sid,(policy->>'groupId')::uuid,start_at,end_at) then
    raise exception 'Observed team membership does not cover the entire period' using errcode='22023';
   end if;
   groups:=array[(policy->>'groupId')::uuid];$new$;
 if strpos(definition,original)=0 or array_length(string_to_array(definition,original),1)<>2 then
  raise exception 'Unexpected adapter membership contract';end if;
 execute replace(definition,original,replacement);
end $patch$;
