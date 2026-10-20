-- Recovery for a single explicitly armed Commusoft /users source-page trial.
-- Installation does not enable the users flag, pause recurrence, or read a provider.
-- The normal signed-in input request remains the only way to approve the page.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.learn_commusoft_users_trial_restore(
 p_tenant uuid,p_arm uuid,p_request uuid,p_actor uuid,p_reason text,p_action text default 'finish'
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare arm public.controlplane_change_log%rowtype;
 prior public.learn_operator_input_requests%rowtype;
 done public.controlplane_change_log%rowtype;
 s public.learn_commusoft_recurring%rowtype;
 a public.connector_accounts%rowtype;
 j public.platform_jobs%rowtype;f public.feature_flags%rowtype;
 p public.learn_business_input_pages%rowtype;
 old_approval jsonb;old_cursor jsonb;answer jsonb;observed integer;
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_arm is null or p_request is null or p_action is null or p_action not in ('finish','abandon')
  or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
  raise exception 'commusoft_users_trial_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into done from public.controlplane_change_log
  where tenant_id=p_tenant and action='learn.commusoft.users_trial.restore'
   and correlation_id=p_arm::text and resource_id=p_request::text;
 if found then
  if done.actor is distinct from p_actor::text or done.reason is distinct from btrim(p_reason)
   or done.after->>'action' is distinct from p_action then
   raise exception 'commusoft_users_trial_restore_conflict' using errcode='PT409';end if;
  return done.after;
 end if;
 select * into arm from public.controlplane_change_log
  where id=p_arm and tenant_id=p_tenant and actor=p_actor::text
   and action='learn.commusoft.users_trial.arm' and source='new-dawn-m2-users-trial';
 if not found or arm.resource_type is distinct from 'connector_account'
  or arm.after->>'users_flag' is distinct from 'on'
  or arm.after->>'recurring_state' is distinct from 'paused'
  or arm.before->>'recurring_state' is distinct from 'idle'
  or coalesce(arm.before->>'recurring_revision','') !~ '^[0-9]{1,18}$'
  or jsonb_typeof(arm.before->'checkpoint') is distinct from 'object' then
  raise exception 'commusoft_users_trial_arm_changed' using errcode='PT409';end if;
 select * into prior from public.learn_operator_input_requests where id=p_request and tenant_id=p_tenant and actor_id=p_actor;
 if not found or prior.created_at<arm.created_at or prior.receipt->>'state' is distinct from 'recorded'
  or prior.receipt->>'kind' is distinct from 'start_commusoft'
  or prior.definition->>'resource' is distinct from 'users'
  or prior.definition->>'max_pages' is distinct from '1'
  or coalesce(prior.definition->>'page_size','') !~ '^(10|[1-9])$'
  or prior.receipt->>'account_id' is distinct from arm.resource_id
  or prior.previous_state->'approval' is distinct from arm.before->'approval'
  or prior.previous_state->'checkpoint' is distinct from arm.before->'checkpoint' then
  raise exception 'commusoft_users_trial_request_changed' using errcode='PT409';end if;
 if exists(select 1 from public.learn_operator_input_requests other
   where other.tenant_id=p_tenant and other.id<>p_request and other.created_at>=arm.created_at
    and other.receipt->>'account_id'=arm.resource_id) then
  raise exception 'commusoft_users_trial_intervening_request' using errcode='PT409';end if;
 select * into s from public.learn_commusoft_recurring
  where account_id=arm.resource_id::uuid and tenant_id=p_tenant for update;
 if not found or s.enabled or s.phase<>0 or s.current_request is not null
  or s.last_state is distinct from 'source_user_trial_paused'
  or s.revision<>(arm.before->>'recurring_revision')::bigint+1
  or s.connection_id::text is distinct from prior.definition->>'connection_id' then
  raise exception 'commusoft_users_trial_recurring_changed' using errcode='PT409';end if;
 select * into a from public.connector_accounts where id=s.account_id and tenant_id=p_tenant for update;
 if not found or a.status is distinct from 'active'
  or a.settings->'commusoft_import'->>'resource' is distinct from 'users'
  or a.settings->'commusoft_import'->>'approvalId' is distinct from p_request::text
  or a.settings->'commusoft_import'->>'connectionId' is distinct from s.connection_id::text
  or a.settings->'commusoft_import'->>'maxPages' is distinct from '1'
  or coalesce(a.settings->'commusoft_import'->>'pageSize','') !~ '^(10|[1-9])$'
  or (p_action='finish' and a.sync_cursor->>'approvalId' is distinct from p_request::text)
  or (p_action='abandon' and a.sync_cursor is distinct from '{}'::jsonb) then
  raise exception 'commusoft_users_trial_account_changed' using errcode='PT409';end if;
 if exists(select 1 from public.platform_jobs active
   where active.tenant_id=p_tenant and active.job_type='commusoft.source_sync'
    and active.payload->>'connector_account_id'=a.id::text
    and active.status in ('queued','running','retrying')) then
  raise exception 'commusoft_users_trial_active' using errcode='55000';end if;
 select * into j from public.platform_jobs where id=(prior.receipt->>'job_id')::uuid and tenant_id=p_tenant for update;
 if not found or j.payload->>'connector_account_id' is distinct from a.id::text
  or j.job_key is distinct from 'commusoft.source:'||a.id::text||':'||p_request::text
  or j.lease_expires_at is not null
  or (p_action='finish' and j.completed_at is null)
  or (p_action='abandon' and j.dead_lettered_at is null) then
  raise exception 'commusoft_users_trial_job_changed' using errcode='PT409';end if;
 select * into p from public.learn_business_input_pages
  where job_id=j.id and tenant_id=p_tenant and connection_id=s.connection_id
   and provider='commusoft' and collection='users';
 if p_action='finish' then
  if j.status is distinct from 'succeeded' or not found
   or p.record_count not between 0 and 10 or p.checkpoint_after is distinct from a.sync_cursor
   or p.checkpoint_after->>'pages' is distinct from '1'
   or coalesce(j.result->>'stop_reason','') not in ('collection_exhausted','page_budget_exhausted')
   or j.metadata->'commusoft_page_v1'->>'pageId' is distinct from p.id::text then
   raise exception 'commusoft_users_trial_page_unverified' using errcode='PT409';end if;
  select count(*)::integer into observed from public.learn_business_input_observations where page_id=p.id;
  if observed<>p.record_count or exists(select 1 from public.learn_business_input_pages extra
    where extra.tenant_id=p_tenant and extra.connection_id=s.connection_id and extra.collection='users'
     and extra.checkpoint_after->>'approvalId'=p_request::text and extra.id<>p.id) then
   raise exception 'commusoft_users_trial_page_unverified' using errcode='PT409';end if;
 elsif j.status is distinct from 'dead_letter' or found
  or exists(select 1 from public.learn_business_input_pages extra where extra.tenant_id=p_tenant
    and extra.connection_id=s.connection_id and extra.collection='users'
    and extra.checkpoint_after->>'approvalId'=p_request::text) then
  raise exception 'commusoft_users_trial_abandon_unverified' using errcode='PT409';
 end if;
 old_approval:=arm.before->'approval';old_cursor:=arm.before->'checkpoint';
 update public.connector_accounts set
  settings=case when old_approval is null or old_approval='null'::jsonb
   then settings-'commusoft_import'
   else jsonb_set(settings,'{commusoft_import}',old_approval,true) end,
  sync_cursor=old_cursor where id=a.id;
 select * into f from public.feature_flags where tenant_id=p_tenant
  and flag='learn.inputs.commusoft.users.enabled' for update;
 if not found or f.value not in ('true'::jsonb,'false'::jsonb) then
  raise exception 'commusoft_users_trial_flag_changed' using errcode='PT409';end if;
 update public.feature_flags set value='false'::jsonb where id=f.id;
 update public.learn_commusoft_recurring set enabled=true,revision=revision+1,
  last_state='source_user_trial_restored',next_check_at=clock_timestamp()+interval '1 minute',
  updated_at=clock_timestamp() where account_id=s.account_id;
 answer:=jsonb_build_object('version','commusoft-users-trial-restore/1','tenant_id',p_tenant,
  'account_id',a.id,'approval_id',p_request,'action',p_action,
  'page_id',case when p_action='finish' then p.id else null end,
  'records',case when p_action='finish' then p.record_count else 0 end,
  'held',true,'users_flag','off','recurring_state','resumed');
 insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,
  before,after,reason,correlation_id,view_as_active,source)
 values(p_tenant,p_actor::text,'learn.commusoft.users_trial.restore','source_users_trial',
  p_request::text,jsonb_build_object('account_id',a.id,'users_flag','on','recurring_state','paused'),
  answer,btrim(p_reason),p_arm::text,false,'new-dawn-m2-users-trial');
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 return answer;
end $$;
revoke all on function public.learn_commusoft_users_trial_restore(uuid,uuid,uuid,uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_users_trial_restore(uuid,uuid,uuid,uuid,text,text)
 to authenticated;
commit;
