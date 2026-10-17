/** One exact LIVE retry for the already approved, empty-checkpoint public window.
 * Rehearse with a rollback before applying. Never expands the channel roster.
 */
import assert from 'node:assert/strict';
import { savedCliToken } from './learn-test-readiness.mjs';

const project='tgbnakbxwcqjeimygroz';
const tenant='00000000-0000-0000-0000-000000000001';
const campaign='b54d246b-2818-44d1-ba05-ccbe2c6bd6c9';
const job='6c7b9706-bc13-48b6-8fa5-6a0263b27e5a';
const channel='C06PBC12MBJ';
const mode=process.argv.slice(2).join(' ');
if(!['--rehearse-live','--apply-live'].includes(mode)||
 process.env.LEARN_LIVE_ALLOW_PROJECT_REF!==project)
 throw Error('Exact LIVE project allowlist and mode required');

async function query(sql,readOnly=true){
 const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly?'/read-only':''}`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
  headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
  body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})}),
 });
 if(!response.ok)throw Error(`Exact Slack retry SQL HTTP ${response.status}`);
 const rows=await response.json();
 if(!Array.isArray(rows))throw Error('Exact Slack retry response changed');
 return rows;
}

const stateSql=`select j.status,j.attempt_count,j.error_count,j.error_code,
 j.metadata ? 'slack_page_v1' has_page_receipt,
 j.metadata ? 'build01_exact_retry' has_retry_receipt,
 a.sync_cursor='{}'::jsonb empty_checkpoint,
 (select count(*)::int from public.platform_jobs x where x.tenant_id=j.tenant_id
  and x.job_key=j.job_key and x.id<>j.id
  and x.status in ('queued','running','retrying')) active_conflicts,
 s.enabled subscription_enabled,
 a.settings->'slack_history'->>'consentReference'='learn-slack-import:'||i.id::text approval_matches,
 (a.settings->'slack_history'->>'expiresAt')::timestamptz>clock_timestamp()+interval '5 minutes' approval_live,
 s.connection_revision=c.updated_at connection_matches,
 c.status='configured' and c.revoked_at is null connection_ready
 from public.platform_jobs j
 join public.slack_history_imports i on i.job_id=j.id and i.tenant_id=j.tenant_id
 join public.slack_recurring_channels s on s.current_import=i.id and s.tenant_id=i.tenant_id
 join public.slack_history_campaign_channels m on m.account_id=s.account_id and m.tenant_id=s.tenant_id
 join public.connector_accounts a on a.id=s.account_id and a.tenant_id=s.tenant_id
 join public.provider_connections c on c.id=s.connection_id and c.tenant_id=s.tenant_id
 where j.id='${job}'::uuid and j.tenant_id='${tenant}'::uuid and j.job_type='slack.history_sync'
  and m.campaign_id='${campaign}'::uuid and s.channel_id='${channel}'`;
const [before]=await query(stateSql);
assert(before && before.status==='dead_letter' && before.attempt_count===1 &&
 before.error_code==='slack_history_failed' && !before.has_page_receipt &&
 !before.has_retry_receipt && before.empty_checkpoint && before.active_conflicts===0 &&
 before.subscription_enabled && before.approval_matches && before.approval_live &&
 before.connection_matches && before.connection_ready,
 'Exact failed public window changed; do not retry');

const guardedSql=`do $retry$ declare changed integer;begin
 update public.platform_jobs j set
  status='queued',available_at=clock_timestamp()+interval '60 seconds',
  claimed_at=null,claimed_by=null,lease_expires_at=null,
  failed_at=null,dead_lettered_at=null,error_code=null,last_error=null,
  metadata=j.metadata||jsonb_build_object('build01_exact_retry',jsonb_build_object(
   'previousErrorCode',j.error_code,'previousAttemptCount',j.attempt_count,
   'requeuedAt',clock_timestamp(),'reason','approved public recurring window; zero saved pages'))
 from public.slack_history_imports i,public.slack_recurring_channels s,
  public.slack_history_campaign_channels m,public.connector_accounts a,
  public.provider_connections c,public.tenant_connectors tc
 where j.id='${job}'::uuid and j.tenant_id='${tenant}'::uuid
  and j.job_type='slack.history_sync' and j.status='dead_letter'
  and j.attempt_count=1 and j.max_attempts=5 and j.error_code='slack_history_failed'
  and not(j.metadata ? 'slack_page_v1') and not(j.metadata ? 'build01_exact_retry')
  and i.job_id=j.id and i.tenant_id=j.tenant_id
  and s.current_import=i.id and s.tenant_id=i.tenant_id and s.enabled
  and s.channel_id='${channel}' and j.payload->>'connector_account_id'=s.account_id::text
  and j.job_key='slack.history:'||s.account_id::text
  and m.account_id=s.account_id and m.tenant_id=s.tenant_id
  and m.campaign_id='${campaign}'::uuid
  and a.id=s.account_id and a.tenant_id=s.tenant_id and a.status='active'
  and a.sync_cursor='{}'::jsonb
  and a.settings->'slack_history'->'approved'='true'::jsonb
  and not(a.settings->'slack_history' ? 'campaignId')
  and a.settings->'slack_history'->>'consentReference'='learn-slack-import:'||i.id::text
  and a.settings->'slack_history'->>'teamId'=s.team_id
  and a.settings->'slack_history'->>'channelId'=s.channel_id
  and (a.settings->'slack_history'->>'expiresAt')::timestamptz>clock_timestamp()+interval '5 minutes'
  and tc.id=a.tenant_connector_id and tc.tenant_id=a.tenant_id
  and tc.connector_id='slack' and tc.enabled and tc.status='active'
  and c.id=s.connection_id and c.tenant_id=s.tenant_id
  and c.status='configured' and c.revoked_at is null
  and c.updated_at=s.connection_revision and c.non_secret_config->>'team_id'=s.team_id
  and not exists(select 1 from public.platform_jobs x where x.tenant_id=j.tenant_id
   and x.job_key=j.job_key and x.id<>j.id and x.status in ('queued','running','retrying'));
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'exact_slack_retry_state_changed';end if;
end $retry$`;
const rehearsal=mode==='--rehearse-live';
await query(`begin;set local lock_timeout='5s';set local statement_timeout='30s';
${guardedSql};
select status,attempt_count,error_count,metadata ? 'build01_exact_retry' has_retry_receipt
 from public.platform_jobs where id='${job}'::uuid;
${rehearsal?'rollback':'commit'};`,false);
const [after]=await query(stateSql);
assert(after && (rehearsal?
 after.status==='dead_letter' && !after.has_retry_receipt && after.error_code==='slack_history_failed':
 after.has_retry_receipt && ['queued','running','succeeded'].includes(after.status) &&
 after.attempt_count>=1),
 'Exact Slack retry readback did not match expected transaction result');
console.log(JSON.stringify({state:rehearsal?'rehearsed_rolled_back':'exact_window_requeued',
 project,tenant,campaign,channel,job,status:after.status,attemptCount:after.attempt_count,
 priorFailurePreserved:!rehearsal&&after.has_retry_receipt,
 sourceProviderWrites:false,rosterExpanded:false,messageBodiesReturned:false,
 observedAt:new Date().toISOString()}));
