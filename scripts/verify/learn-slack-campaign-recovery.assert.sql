-- Networkless production-schema journey. Synthetic operator approval, ten real
-- durable page transactions, automatic continuation and shared dispatch limits.
set search_path=public,pg_catalog;
create schema verify;
create function verify.id(n integer) returns uuid language sql immutable as $$select ('f7600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create table verify.campaign(definition jsonb,receipt jsonb);
grant usage on schema verify to authenticated,service_role;
grant execute on function verify.id(integer) to authenticated,service_role;
grant select,update on verify.campaign to authenticated,service_role;
insert into tenants(id,slug,display_name,status) values(verify.id(1),'slack-campaign-probe','Synthetic campaign','active'),(verify.id(2),'slack-campaign-foreign','Synthetic foreign','active');
insert into auth.users(id) values(verify.id(10)),(verify.id(11)),(verify.id(12));
update profiles set tenant_id=verify.id(2),role='viewer' where id in (verify.id(10),verify.id(11));
update profiles set tenant_id=verify.id(1),role='owner' where id=verify.id(12);
insert into platform_authority_grants(profile_id,permission,granted_by) values(verify.id(10),'platform.controlplane.admin','Synthetic campaign rehearsal');
insert into provider_connections(id,tenant_id,provider,status,non_secret_config,configured_fields,secret_refs) values
 (verify.id(20),verify.id(1),'slack','configured','{"team_id":"TCAMPAIGN"}',array['bot_token'],jsonb_build_object('bot_token',verify.id(21)));
insert into verify.campaign select jsonb_build_object('connectionId',id,'connectionRevision',updated_at,'channelIds',jsonb_build_array('CARCHIVEA','CARCHIVEB'),
 'start','2016-01-01T00:00:00Z','end','2026-10-01T00:00:00Z','expiresAt',clock_timestamp()+interval '2 days','requestBudget',100,'reason','Synthetic full channel history'),null from provider_connections where id=verify.id(20);
set request.jwt.claim.sub='f7600000-0000-4000-8000-000000000010';set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare d jsonb;r jsonb;begin
 select definition into d from verify.campaign;
 assert learn_slack_campaign_start(verify.id(1),verify.id(30),d,'check')->>'state'='pending';
 r:=learn_slack_campaign_start(verify.id(1),verify.id(30),d);
 assert r->>'state'='recorded';assert learn_slack_campaign_start(verify.id(1),verify.id(30),d)=r;
 assert learn_slack_campaign_start(verify.id(1),verify.id(30),d,'check')=r;
 update verify.campaign set receipt=r;
 begin perform learn_slack_campaign_start(verify.id(1),verify.id(30),d||'{"requestBudget":200}');raise exception 'Changed request accepted';exception when sqlstate 'PT409' then null;end;
 assert learn_slack_campaign_start(verify.id(1),verify.id(31),d,'cancel')->>'state'='cancelled';
 assert learn_slack_campaign_start(verify.id(1),verify.id(31),d)->>'state'='cancelled';
 assert learn_slack_campaign_read(verify.id(1),verify.id(30))->'complete'='false'::jsonb;
end$$;
reset role;
do $$begin
 assert (select count(*)=2 from slack_history_campaign_channels where campaign_id=verify.id(30));
 assert (select count(*)=2 from platform_jobs where tenant_id=verify.id(1));
 assert (select tenant_id=verify.id(2) and role='viewer' from profiles where id=verify.id(10)),'Operator profile was reassigned';
 assert not has_table_privilege('authenticated','slack_history_campaigns','SELECT,INSERT,UPDATE,DELETE');
 assert not has_table_privilege('service_role','slack_history_campaigns','UPDATE');
 assert not has_function_privilege('authenticated','learn_slack_campaign_reserve_request(uuid,uuid,text,integer,integer)','execute');
end$$;


update platform_jobs set available_at=clock_timestamp()+interval '1 day' where tenant_id=verify.id(1);
update platform_jobs set status='dead_letter',error_code='slack_history_message_subtype_unsupported',failed_at=clock_timestamp()
where tenant_id=verify.id(1) and payload->>'connector_account_id'=(select account_id::text from slack_history_campaign_channels where campaign_id=verify.id(30) and channel_id='CARCHIVEA');
create table verify.recovery(definition jsonb,receipt jsonb,job_id uuid,worker text,attempt integer);
grant select,update on verify.recovery to authenticated,service_role;
insert into verify.recovery(definition) select jsonb_build_object('campaignId',m.campaign_id,'accountId',a.id,'importId',m.current_import,
 'failedJobId',j.id,'checkpointHash',encode(sha256(convert_to(a.sync_cursor::text,'UTF8')),'hex'),'reason','Inspect exact held campaign page')
from slack_history_campaign_channels m join connector_accounts a on a.id=m.account_id join platform_jobs j on j.payload->>'connector_account_id'=a.id::text
where m.campaign_id=verify.id(30) and m.channel_id='CARCHIVEA';
create table verify.preserved as select a.id,a.settings,a.sync_cursor from connector_accounts a where tenant_id=verify.id(1);

-- Failures are isolated subtransactions and must leave no queued recovery behind.
do $$declare d jsonb;begin
 select definition into d from verify.recovery;
 begin update slack_history_campaigns set enabled=false where id=verify.id(30);
  perform learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(619),'recover_page',d,'apply');raise exception 'Paused campaign accepted';
 exception when sqlstate '55000' then null;end;
 begin update slack_history_campaigns set requests_reserved=request_budget where id=verify.id(30);
  perform learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(619),'recover_page',d,'apply');raise exception 'Exhausted budget accepted';
 exception when sqlstate '55000' then null;end;
 begin update connector_accounts set settings=jsonb_set(settings,'{slack_history,expiresAt}',to_jsonb((clock_timestamp()-interval '1 hour')::text)) where id=(d->>'accountId')::uuid;
  perform learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(619),'recover_page',d,'apply');raise exception 'Expired scope accepted';
 exception when sqlstate '55000' then null;end;
 assert not exists(select 1 from slack_campaign_recovery_requests where id=verify.id(619));
end$$;
create function verify.reject_recovery_request() returns trigger language plpgsql as $$begin raise exception 'injected_recovery_request_failure';end$$;
create trigger synthetic_recovery_failure before insert on slack_campaign_recovery_requests for each row execute function verify.reject_recovery_request();
do $$declare d jsonb;n integer;begin
 select definition into d from verify.recovery;select count(*) into n from platform_jobs where tenant_id=verify.id(1);
 begin perform learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(619),'recover_page',d,'apply');raise exception 'Atomic request failure ignored';
 exception when raise_exception then if sqlerrm<>'injected_recovery_request_failure' then raise;end if;end;
 assert (select count(*)=n from platform_jobs where tenant_id=verify.id(1));
end$$;
drop trigger synthetic_recovery_failure on slack_campaign_recovery_requests;
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='f7600000-0000-4000-8000-000000000010';set role authenticated;
do $$declare d jsonb;r jsonb;begin
 select definition into d from verify.recovery;
 assert learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(610),'recover_page',d,'check')->>'state'='pending';
 begin perform learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(613),'recover_page',d||'{"importId":null}','apply');raise exception 'Null import binding accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_slack_campaign_dispatch(verify.id(1),verify.id(11),verify.id(611),'recover_page',d,'apply');raise exception 'Wrong actor accepted';exception when insufficient_privilege then null;end;
 begin perform learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(611),'recover_page',d||jsonb_build_object('checkpointHash',repeat('a',64)),'apply');raise exception 'Wrong checkpoint accepted';exception when sqlstate 'PT409' then null;end;
 assert learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(612),'recover_page',d,'cancel')->>'state'='cancelled';
 assert learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(612),'recover_page',d,'apply')->>'state'='cancelled';
 r:=learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(610),'recover_page',d,'apply');
 assert r->>'state'='committed';update verify.recovery set receipt=r,job_id=(r->>'jobId')::uuid;
 assert learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(610),'recover_page',d,'check')=r;
 assert learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(610),'recover_page',d,'cancel')=r;
 begin perform learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(610),'recover_page',d||'{"reason":"Changed"}','apply');raise exception 'Changed request accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(611),'recover_page',d,'apply');raise exception 'Duplicate recovery accepted';exception when sqlstate 'PT409' or sqlstate '55000' then null;end;
end$$;reset role;
do $$begin
 assert not exists(select 1 from slack_campaign_recovery_requests where id=verify.id(613)),'Null import wrote request';
 assert not exists(select 1 from platform_jobs where payload->>'campaign_recovery_id'=verify.id(613)::text),'Null import wrote job';
 assert not exists(select 1 from verify.preserved b join connector_accounts a using(id) where b.settings<>a.settings or b.sync_cursor<>a.sync_cursor),'Recovery changed cursor or scope';
 assert not has_table_privilege('authenticated','slack_structure_diagnostics','SELECT,INSERT,UPDATE,DELETE');
 assert not has_table_privilege('service_role','slack_campaign_recovery_requests','SELECT,INSERT,UPDATE,DELETE');
 assert not has_function_privilege('authenticated','learn_slack_campaign_recover_page(uuid,uuid,jsonb,text)','EXECUTE');
end$$;
set request.jwt.claim.role='service_role';set role service_role;
do $$declare j platform_jobs%rowtype;d jsonb;begin
 select * into j from learn_slack_claim_jobs(verify.id(620),1);
 assert j.id=(select job_id from verify.recovery),'Recovery not claimed';
 update verify.recovery set worker=j.claimed_by,attempt=j.attempt_count;
 assert learn_slack_campaign_job_allowed(verify.id(1),j.id);
 d:='{"version":"slack-structure/1","code":"slack_history_message_subtype_unsupported","type":"message","hidden":"missing","subtypeType":"string","subtype":"future_subtype"}';
 begin perform learn_slack_record_structure_diagnostic(verify.id(1),j.id,j.claimed_by,j.attempt_count,d);raise exception 'Unreserved diagnostic accepted';exception when sqlstate 'PT409' then null;end;
 assert learn_slack_campaign_reserve_request(verify.id(1),j.id,j.claimed_by,j.attempt_count,1);
 begin perform learn_slack_record_structure_diagnostic(verify.id(2),j.id,j.claimed_by,j.attempt_count,d);raise exception 'Wrong tenant diagnostic accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_slack_record_structure_diagnostic(verify.id(1),j.id,'wrong',j.attempt_count,d);raise exception 'Wrong lease diagnostic accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_slack_record_structure_diagnostic(verify.id(1),j.id,j.claimed_by,j.attempt_count,d||'{"text":"Private content"}');raise exception 'Raw content accepted';exception when sqlstate '22023' then null;end;
 assert learn_slack_record_structure_diagnostic(verify.id(1),j.id,j.claimed_by,j.attempt_count,d);
 assert learn_slack_record_structure_diagnostic(verify.id(1),j.id,j.claimed_by,j.attempt_count,d);
 begin perform learn_slack_record_structure_diagnostic(verify.id(1),j.id,j.claimed_by,j.attempt_count,d||'{"subtype":"changed"}');raise exception 'Diagnostic changed';exception when sqlstate 'PT409' then null;end;
 assert learn_slack_finish_job(verify.id(1),j.id,j.claimed_by,j.attempt_count,'{"success":false,"code":"slack_history_message_subtype_unsupported","retryable":false,"retry_after_seconds":0}')->>'status'='dead_letter';
end$$;reset role;
do $$begin
 assert (select count(*)=1 from slack_structure_diagnostics where tenant_id=verify.id(1));
 assert not exists(select 1 from verify.preserved b join connector_accounts a using(id) where b.settings<>a.settings or b.sync_cursor<>a.sync_cursor),'Diagnostic changed cursor or scope';
 assert (select requests_reserved=1 from slack_history_campaigns where id=verify.id(30));
 assert not exists(select 1 from slack_messages where tenant_id=verify.id(1));
end$$;

set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='f7600000-0000-4000-8000-000000000010';set role authenticated;
do $$declare d jsonb;r jsonb;begin
 select definition into d from verify.recovery;
 r:=learn_slack_campaign_recovery_read(verify.id(1),verify.id(30),(d->>'accountId')::uuid,verify.id(610));
 assert r->>'status'='dead_letter' and r->'diagnostic'->>'subtype'='future_subtype';
 assert r->>'checkpointHash'=d->>'checkpointHash';
 begin perform learn_slack_campaign_recovery_read(verify.id(2),verify.id(30),(d->>'accountId')::uuid,verify.id(610));raise exception 'Foreign recovery read accepted';exception when insufficient_privilege then null;end;
end$$;reset role;
-- Revoking the actual requesting operator also removes recovery-job authority.
do $$declare jid uuid;begin
 select job_id into jid from verify.recovery;
 begin update platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=verify.id(10);
  perform set_config('request.jwt.claim.role','service_role',true);
  assert not learn_slack_campaign_job_allowed(verify.id(1),jid);raise exception 'rollback_revocation';
 exception when raise_exception then if sqlerrm<>'rollback_revocation' then raise;end if;end;
end$$;
