-- A formal title confirmation is not proof that a proposed member is the
-- account holder. Work routing requires a separate, audited identity review.
create function public.cp_confirm_member_identity(
  p_tenant uuid, p_member uuid, p_expected_version integer,
  p_actor_user uuid, p_actor text, p_reason text,
  p_correlation text, p_view_as boolean
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare member_row public.team_members%rowtype;
        confirmed_row public.team_members%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  perform public.learn_roster_write_guard(p_tenant,p_actor,p_reason,p_view_as);
  if p_member is null or p_expected_version is null or p_expected_version<1
    or p_actor_user is null or not exists(select 1 from public.profiles where id=p_actor_user) then
    raise exception 'Identity confirmation input invalid' using errcode='22023';
  end if;
  select * into member_row from public.team_members
    where id=p_member and tenant_id=p_tenant for update;
  if not found then raise exception 'Member unavailable in tenant' using errcode='P0002'; end if;
  if member_row.version<>p_expected_version then
    raise exception 'Member changed; refresh before confirming' using errcode='P0409';
  end if;
  if member_row.confirmed_at is not null or member_row.effective_to is not null
    or member_row.effective_from>clock_timestamp() or member_row.profile_id is null then
    raise exception 'Active linked, unconfirmed member required' using errcode='22023';
  end if;
  if not exists(select 1 from public.profiles p
      where p.id=member_row.profile_id and p.tenant_id=p_tenant) then
    raise exception 'Linked login does not belong to this tenant' using errcode='22023';
  end if;
  if exists(select 1 from public.team_members duplicate
      where duplicate.tenant_id=p_tenant and duplicate.id<>p_member
        and duplicate.profile_id=member_row.profile_id
        and duplicate.effective_to is null) then
    raise exception 'Linked login is ambiguous in this tenant' using errcode='22023';
  end if;
  update public.team_members set confirmed_at=clock_timestamp(),
      confirmed_by=p_actor_user,version=version+1
    where id=p_member returning * into confirmed_row;
  insert into public.controlplane_change_log
    (tenant_id,actor,action,resource_type,resource_id,before,after,
     reason,correlation_id,view_as_active,source)
  values (p_tenant,p_actor,'controlplane.roster.member_identity_confirm',
    'team_member',p_member::text,to_jsonb(member_row),to_jsonb(confirmed_row),
    p_reason,p_correlation,false,'controlplane');
  return jsonb_build_object('id',p_member,'version',confirmed_row.version,
    'confirmed_at',confirmed_row.confirmed_at);
end $$;

revoke all on function public.cp_confirm_member_identity(
  uuid,uuid,integer,uuid,text,text,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.cp_confirm_member_identity(
  uuid,uuid,integer,uuid,text,text,text,boolean) to service_role;
