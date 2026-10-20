/** Reviewed SQL for one Drummonds-only /users source trial. Importing this file
 * never executes SQL or sends a provider request. All writes require an explicit
 * operator and a separate release action after the default-OFF restore RPC is
 * installed and independently verified. */
import { pathToFileURL } from "node:url";

export const TENANT = "00000000-0000-0000-0000-000000000001";
export const FLAG = "learn.inputs.commusoft.users.enabled";
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const q = (value) => "'" + value.replaceAll("'", "''") + "'";

function args({ armId, accountId, actorId, reason }) {
  if (![armId, accountId, actorId].every(uuid) ||
      typeof reason !== "string" || reason.trim().length < 1 || reason.trim().length > 1000)
    throw Error("users_trial_arguments_invalid");
  return { armId, accountId, actorId, reason: reason.trim() };
}

/** Locks the scheduler and account together, then pauses ordinary recurrence
 * before turning on the tenant-only users flag. Nothing calls /users here.
 * The signed-in operator must separately approve one page of at most ten in
 * OpenFolk after this receipt. An unknown transaction outcome is read back,
 * never replayed blindly. */
export function armSql(input, rollback = false) {
  const { armId, accountId, actorId, reason } = args(input);
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $trial$
declare s public.learn_commusoft_recurring%rowtype;
 a public.connector_accounts%rowtype;f public.feature_flags%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||'${TENANT}',0));
 if not public.learn_commusoft_recurring_actor('${actorId}'::uuid) then
  raise exception 'users_trial_actor_changed';end if;
 if exists(select 1 from public.controlplane_change_log where id='${armId}'::uuid) then
  raise exception 'users_trial_arm_already_recorded';end if;
 select * into s from public.learn_commusoft_recurring
  where account_id='${accountId}'::uuid and tenant_id='${TENANT}'::uuid for update;
 if not found or not s.enabled or s.phase<>0 or s.current_request is not null
  or s.connection_id is null then raise exception 'users_trial_recurring_not_idle';end if;
 if not exists(select 1 from public.feature_flags where tenant_id=s.tenant_id
   and flag='learn.enabled' and value='true'::jsonb)
  or not exists(select 1 from public.feature_flags where tenant_id=s.tenant_id
   and flag='learn.inputs.commusoft.enabled' and value='true'::jsonb) then
  raise exception 'users_trial_master_input_off';end if;
 select * into a from public.connector_accounts where id=s.account_id and tenant_id=s.tenant_id for update;
 if not found or a.status is distinct from 'active'
  or not (a.settings ? 'commusoft_import')
  or a.sync_cursor->'complete' is distinct from 'true'::jsonb
  or a.sync_cursor->>'approvalId' is distinct from a.settings->'commusoft_import'->>'approvalId'
  or exists(select 1 from public.platform_jobs j where j.tenant_id=s.tenant_id
   and j.job_type='commusoft.source_sync' and j.payload->>'connector_account_id'=a.id::text
   and j.status in ('queued','running','retrying')) then
  raise exception 'users_trial_account_not_idle';end if;
 perform 1 from public.provider_connections c where c.id=s.connection_id and c.tenant_id=s.tenant_id
  and c.status='configured' and c.revoked_at is null and c.updated_at=s.connection_revision
  and c.provider='commusoft' and c.non_secret_config->>'account_key'=a.account_key for share;
 if not found then raise exception 'users_trial_connection_changed';end if;
 select * into f from public.feature_flags where tenant_id=s.tenant_id and flag='${FLAG}' for update;
 if found and f.value is distinct from 'false'::jsonb then
  raise exception 'users_trial_flag_already_on';end if;
 update public.learn_commusoft_recurring set enabled=false,revision=revision+1,
  last_state='source_user_trial_paused',updated_at=clock_timestamp() where account_id=s.account_id;
 if f.id is null then
  insert into public.feature_flags(tenant_id,flag,value)
   values(s.tenant_id,'${FLAG}','true'::jsonb);
 else
  update public.feature_flags set value='true'::jsonb where id=f.id;
 end if;
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,
  resource_id,before,after,reason,correlation_id,view_as_active,source)
 values('${armId}'::uuid,s.tenant_id,'${actorId}',
  'learn.commusoft.users_trial.arm','connector_account',a.id::text,
  jsonb_build_object('approval',a.settings->'commusoft_import','checkpoint',a.sync_cursor,
   'recurring_state','idle','recurring_revision',s.revision),
  jsonb_build_object('users_flag','on','recurring_state','paused',
   'recurring_revision',s.revision+1),${q(reason)},'${armId}',false,
  'new-dawn-m2-users-trial');
end $trial$;
select 'commusoft-users-trial-armed/1' as marker;
${rollback ? "rollback" : "commit"};`;
}

/** Fail closed when the page or restoration has an uncertain result: the users
 * flag turns Off, while recurrence remains paused for inspected recovery. This
 * does not cancel an active lease, delete evidence, or overwrite an account. */
export function failClosedSql(input, rollback = false) {
  const { armId, accountId, actorId, reason } = args(input);
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $trial$
declare s public.learn_commusoft_recurring%rowtype;a public.controlplane_change_log%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||'${TENANT}',0));
 select * into a from public.controlplane_change_log where id='${armId}'::uuid
  and tenant_id='${TENANT}'::uuid and actor='${actorId}'
  and action='learn.commusoft.users_trial.arm' and resource_id='${accountId}'
  and source='new-dawn-m2-users-trial';
 if not found then raise exception 'users_trial_arm_changed';end if;
 select * into s from public.learn_commusoft_recurring where account_id='${accountId}'::uuid
  and tenant_id='${TENANT}'::uuid for update;
 if not found or s.enabled or s.phase<>0 or s.current_request is not null
  or s.last_state is distinct from 'source_user_trial_paused'
  or s.revision<>(a.before->>'recurring_revision')::bigint+1 then
  raise exception 'users_trial_recurring_changed';end if;
 update public.feature_flags set value='false'::jsonb
  where tenant_id=s.tenant_id and flag='${FLAG}' and value='true'::jsonb;
 if not found then raise exception 'users_trial_flag_changed';end if;
 insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,
  resource_id,before,after,reason,correlation_id,view_as_active,source)
 values(s.tenant_id,'${actorId}','learn.commusoft.users_trial.fail_closed',
  'connector_account',s.account_id::text,'{"users_flag":"on"}'::jsonb,
  '{"users_flag":"off","recurring_state":"paused"}'::jsonb,
  ${q(reason)},'${armId}',false,'new-dawn-m2-users-trial');
end $trial$;
select 'commusoft-users-trial-fail-closed/1' as marker;
${rollback ? "rollback" : "commit"};`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  throw Error("users_trial_helper_is_review_only_no_live_execution");
