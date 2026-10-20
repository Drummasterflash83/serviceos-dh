-- A second operator must not resume ordinary recurrence into a one-page users
-- cursor while the source-user trial is armed or awaiting conditional restore.
-- Installation is default-OFF and does not alter a flag, account, job or cycle.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.learn_commusoft_users_trial_active(p_tenant uuid,p_account uuid)
returns boolean language sql volatile security definer set search_path=pg_catalog as $$
 select p_tenant is not null and p_account is not null and (
  exists(select 1 from public.learn_commusoft_recurring s where s.tenant_id=p_tenant
   and s.account_id=p_account and s.last_state='source_user_trial_paused')
  or exists(select 1 from public.controlplane_change_log arm
   where arm.tenant_id=p_tenant and arm.resource_type='connector_account'
    and arm.resource_id=p_account::text and arm.action='learn.commusoft.users_trial.arm'
    and arm.source='new-dawn-m2-users-trial'
    and not exists(select 1 from public.controlplane_change_log done
     where done.tenant_id=p_tenant and done.action='learn.commusoft.users_trial.restore'
      and done.source='new-dawn-m2-users-trial' and done.correlation_id=arm.id::text)));
$$;
revoke all on function public.learn_commusoft_users_trial_active(uuid,uuid)
 from public,anon,authenticated,service_role;

create function public.learn_commusoft_users_trial_control_allowed(p_tenant uuid,p_account uuid)
returns boolean language sql volatile security definer set search_path=pg_catalog as $$
 select p_tenant is not null and p_account is not null
  and not public.learn_commusoft_users_trial_active(p_tenant,p_account)
  and not exists(select 1 from public.feature_flags f where f.tenant_id=p_tenant
   and f.flag='learn.inputs.commusoft.users.enabled' and f.value='true'::jsonb);
$$;
revoke all on function public.learn_commusoft_users_trial_control_allowed(uuid,uuid)
 from public,anon,authenticated,service_role;

do $fence$
declare body text;needle text:=$old$  if s.account_id is null then$old$;
 replacement text:=$new$  if not public.learn_commusoft_users_trial_control_allowed(p_tenant,aid) then
   raise exception 'commusoft_users_trial_active' using errcode='55000';end if;
  if s.account_id is null then$new$;
begin
 body:=pg_get_functiondef('public.learn_commusoft_recurring_control(uuid,uuid,uuid,jsonb,text)'::regprocedure);
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1
  or position(replacement in body)>0 then
  raise exception 'commusoft_recurring_control_contract_changed';end if;
 execute replace(body,needle,replacement);
end $fence$;

-- While the immutable arm is open, permit exactly one matching signed-in users
-- approval for that account and actor. No other manual import may replace its
-- account scope; a second users request cannot exceed the first ten records.
do $input_fence$
declare body text;needle text:=$old$  if found then
   if a.status is distinct from 'active'$old$;
 replacement text:=$new$  if found and public.learn_commusoft_users_trial_active(p_tenant,a.id) then
   if resource is distinct from 'users' or not exists(
    select 1 from public.controlplane_change_log arm
    where arm.tenant_id=p_tenant and arm.actor=p_actor::text
     and arm.action='learn.commusoft.users_trial.arm' and arm.source='new-dawn-m2-users-trial'
     and arm.resource_id=a.id::text
     and not exists(select 1 from public.controlplane_change_log done
      where done.tenant_id=p_tenant and done.action='learn.commusoft.users_trial.restore'
       and done.correlation_id=arm.id::text)
     and not exists(select 1 from public.learn_operator_input_requests prior
      where prior.tenant_id=p_tenant and prior.created_at>=arm.created_at
       and prior.receipt->>'account_id'=a.id::text)) then
    raise exception 'commusoft_users_trial_active' using errcode='55000';end if;
  end if;
  if found then
   if a.status is distinct from 'active'$new$;
begin
 body:=pg_get_functiondef('public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text)'::regprocedure);
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1
  or position(replacement in body)>0 then
  raise exception 'commusoft_users_trial_input_contract_changed';end if;
 execute replace(body,needle,replacement);
end $input_fence$;

-- The existing signed-in continuation route could otherwise add an eleventh
-- source user while the first-page trial is still open.
do $resume_fence$
declare body text;needle text:=$old$ cfg:=a.settings->'commusoft_import';cp:=a.sync_cursor;$old$;
 replacement text:=$new$ cfg:=a.settings->'commusoft_import';cp:=a.sync_cursor;
 if public.learn_commusoft_users_trial_active(p_tenant,a.id) then
  raise exception 'commusoft_users_trial_active' using errcode='55000';end if;$new$;
begin
 body:=pg_get_functiondef('public.learn_operator_resume_commusoft(uuid,uuid,uuid,jsonb,text)'::regprocedure);
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1
  or position(replacement in body)>0 then
  raise exception 'commusoft_users_trial_resume_contract_changed';end if;
 execute replace(body,needle,replacement);
end $resume_fence$;
commit;
