-- A completed historical-campaign channel may be given a separately approved
-- ongoing account without changing that campaign or its retained source rows.
-- This migration changes only the guarded owner/admin setup path; it creates
-- no account, job, subscription, provider request, credential or schedule.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Exact one-enabled-reader identity is important for the signed Events roster.
-- If existing data violates it, fail without changing the installed function.
create unique index if not exists slack_recurring_one_enabled_channel
 on public.slack_recurring_channels(tenant_id,team_id,channel_id) where enabled;

do $patch$declare d text; needle text; replacement text;begin
 d:=pg_get_functiondef('public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text)'::regprocedure);
 needle:=$old$if a.settings->'slack_history' ? 'campaignId' then raise exception 'slack_campaign_scope_owned' using errcode='55000';end if;$old$;
 replacement:=$new$if a.settings->'slack_history' ? 'campaignId' then
   -- The existing campaign account remains unchanged. Only a fully
   -- published channel with observed reply traversal may be split, and an
   -- already enabled recurring reader cannot be duplicated.
   if not exists(select 1 from public.slack_history_campaign_channels m
    where m.account_id=a.id and m.tenant_id=p_tenant_id and m.channel_id=p_channel_id
     and m.campaign_id::text=a.settings->'slack_history'->>'campaignId'
     and public.learn_slack_campaign_channel_progress(m.campaign_id,a.id)->'complete'='true'::jsonb)
    or exists(select 1 from public.platform_jobs j where j.tenant_id=p_tenant_id
     and j.job_type in ('slack.history_sync','slack.thread_sync')
     and j.payload->>'connector_account_id'=a.id::text
     and j.status in ('queued','running','retrying'))
    or exists(select 1 from public.slack_recurring_channels s where s.tenant_id=p_tenant_id
     and s.team_id=c.non_secret_config->>'team_id' and s.channel_id=p_channel_id and s.enabled)
   then raise exception 'slack_campaign_split_unavailable' using errcode='55000';end if;
   previous_state:=jsonb_build_object('splitFromCampaignId',a.settings->'slack_history'->>'campaignId',
    'splitFromAccountId',a.id);
   select * into a from public.connector_accounts where tenant_connector_id=tc.id
    and tenant_id=p_tenant_id
    and account_key=(c.non_secret_config->>'team_id')||':'||p_channel_id||':ongoing'
    for update;
   if not found then
    insert into public.connector_accounts(tenant_id,tenant_connector_id,account_key,display_name,status,settings)
     values(p_tenant_id,tc.id,(c.non_secret_config->>'team_id')||':'||p_channel_id||':ongoing',
      p_channel_id||' · ongoing','active',jsonb_build_object('slackSplitFrom',
       jsonb_build_object('campaignId',previous_state->>'splitFromCampaignId',
        'accountId',previous_state->>'splitFromAccountId')))
     returning * into a;
   elsif a.settings->'slackSplitFrom'->>'campaignId' is distinct from previous_state->>'splitFromCampaignId'
    or a.settings->'slackSplitFrom'->>'accountId' is distinct from previous_state->>'splitFromAccountId'
   then raise exception 'slack_campaign_split_changed' using errcode='55000';end if;
  end if;$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'Reviewed Slack campaign-owned import guard changed';end if;
 d:=replace(d,needle,replacement);
 needle:=$old$previous_state:=jsonb_build_object('settings',a.settings->'slack_history','checkpoint',a.sync_cursor);$old$;
 replacement:=$new$previous_state:=coalesce(previous_state,'{}'::jsonb)||
   jsonb_build_object('settings',a.settings->'slack_history','checkpoint',a.sync_cursor);$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'Reviewed Slack previous-state capture changed';end if;
 execute replace(d,needle,replacement);
end$patch$;
commit;
