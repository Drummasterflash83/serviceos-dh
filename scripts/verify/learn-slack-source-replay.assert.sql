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

-- Isolate the one replay candidate from unrelated synthetic initial traversal jobs.
update platform_jobs set available_at=clock_timestamp()+interval '1 day' where tenant_id=verify.id(1);
insert into slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,message_text,provider_payload,source_version,source_updated_at)
select verify.id(501),verify.id(1),'TCAMPAIGN:CARCHIVEA:1790000000.000001','TCAMPAIGN','CARCHIVEA','1790000000.000001',p->>'text',p,encode(sha256(convert_to(p::text,'UTF8')),'hex'),1790000000.000001
from(select '{"ts":"1790000000.000001","text":"Job 123 needs a part"}'::jsonb p)x;
insert into slack_message_versions(tenant_id,message_id,source_version,provider_payload)
select tenant_id,id,source_version,provider_payload from slack_messages where id=verify.id(501);
create table verify.replay(definition jsonb,receipt jsonb,job_id uuid,worker text,attempt integer,records jsonb,visibility jsonb);
grant select,update on verify.replay to authenticated,service_role;
insert into verify.replay(definition,records,visibility)
select jsonb_build_object('campaignId',verify.id(30),'sourceMessageId',s.id,'sourceVersion',s.source_version,'reason','Revalidate one retained source within existing campaign'),
 jsonb_build_array(jsonb_build_object('tenant_id',s.tenant_id,'source_external_id',s.source_external_id,'channel_id',s.channel_id,'provider_timestamp',s.provider_timestamp,'provider_payload',s.provider_payload)),
 jsonb_build_object('version','slack-capture-visibility/1','connection_id',c.id,'connection_revision',c.updated_at,'team_id',s.team_id,'channel_id',s.channel_id,'is_channel',true,'is_private',false,'is_im',false,'is_mpim',false,'is_shared',false,'is_ext_shared',false,'is_org_shared',false,'is_pending_ext_shared',false,'pending_shared',false)
 from slack_messages s cross join provider_connections c where s.id=verify.id(501) and c.id=verify.id(20);
create table verify.preserved as select a.id,a.settings,a.sync_cursor from connector_accounts a where tenant_id=verify.id(1);
create table verify.source_preserved as select to_jsonb(s) data from slack_messages s where id=verify.id(501);
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='f7600000-0000-4000-8000-000000000010';set role authenticated;
do $$declare d jsonb;r jsonb;begin
 select definition into d from verify.replay;
 assert learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(510),'replay_source',d,'check')->>'state'='pending';
 r:=learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(510),'replay_source',d,'apply');
 assert r->>'state'='committed';update verify.replay set receipt=r,job_id=(r->>'jobId')::uuid;
 assert learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(510),'replay_source',d,'apply')=r;
 begin perform learn_slack_campaign_dispatch(verify.id(1),verify.id(11),verify.id(511),'replay_source',d,'apply');raise exception 'Wrong actor accepted';exception when insufficient_privilege then null;end;
 begin perform learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(511),'replay_source',d,'apply');raise exception 'Concurrent same-source replay accepted';exception when sqlstate '55000' then null;end;
 begin perform learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(510),'replay_source',d||'{"reason":"Changed"}','apply');raise exception 'Changed replay accepted';exception when sqlstate 'PT409' then null;end;
 assert learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(512),'replay_source',d,'cancel')->>'state'='cancelled';
end$$;reset role;
set request.jwt.claim.role='service_role';set role service_role;
do $$declare j platform_jobs%rowtype;x record;begin
 select * into j from learn_slack_claim_jobs(verify.id(520),1);
 assert j.id=(select job_id from verify.replay),'Actual queue did not claim replay';
 update verify.replay set worker=j.claimed_by,attempt=j.attempt_count;
 assert learn_slack_campaign_job_allowed(verify.id(1),j.id);
 assert learn_slack_source_replay_scope(verify.id(1),j.id,j.claimed_by,j.attempt_count)->'scope'->>'maxPages'='1';
 assert learn_slack_source_replay_scope(verify.id(2),j.id,j.claimed_by,j.attempt_count) is null;
 select * into x from verify.replay;
 begin perform learn_slack_commit_source_replay(verify.id(1),j.id,j.claimed_by,j.attempt_count,x.records,x.visibility);raise exception 'Unreserved replay accepted';exception when sqlstate 'PT409' then null;end;
 assert learn_slack_campaign_reserve_request(verify.id(1),j.id,j.claimed_by,j.attempt_count,1);
 assert not learn_slack_campaign_reserve_request(verify.id(1),j.id,j.claimed_by,j.attempt_count,1),'Dispatch ordinal reused';
 begin perform learn_slack_commit_source_replay(verify.id(1),j.id,j.claimed_by,j.attempt_count,x.records,x.visibility||'{"is_private":true}');raise exception 'Private channel accepted';exception when sqlstate '22023' then null;end;
 begin perform learn_slack_commit_source_replay(verify.id(1),j.id,j.claimed_by,j.attempt_count,jsonb_set(x.records,'{0,provider_timestamp}','"1790000001.000001"'),x.visibility);raise exception 'Wrong source accepted';exception when sqlstate '22023' then null;end;
end$$;reset role;
-- Revocation, pause and immutable budget still bind the supplemental job.
do $$declare x record;begin
 select * into x from verify.replay;
 update slack_history_campaigns set enabled=false where id=verify.id(30);
 assert not learn_slack_source_replay_allowed(verify.id(1),x.job_id);
 update slack_history_campaigns set enabled=true where id=verify.id(30);
 begin
  update platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=verify.id(10);
  assert not learn_slack_source_replay_allowed(verify.id(1),x.job_id);raise exception 'rollback_actor';
 exception when raise_exception then if sqlerrm<>'rollback_actor' then raise;end if;end;
 begin
  update slack_history_campaigns set requests_reserved=request_budget where id=verify.id(30);
  perform set_config('request.jwt.claim.role','service_role',true);
  assert not learn_slack_campaign_reserve_request(verify.id(1),x.job_id,x.worker,x.attempt,2);raise exception 'rollback_budget';
 exception when raise_exception then if sqlerrm<>'rollback_budget' then raise;end if;end;
end$$;
create function verify.reject_replay_proof() returns trigger language plpgsql as $$begin raise exception 'injected_replay_proof_failure';end$$;
create trigger synthetic_replay_proof before insert on slack_source_visibility_proofs for each row execute function verify.reject_replay_proof();
set role service_role;
do $$declare x record;begin select * into x from verify.replay;
 begin perform learn_slack_commit_source_replay(verify.id(1),x.job_id,x.worker,x.attempt,x.records,x.visibility);raise exception 'Proof failure ignored';exception when raise_exception then if sqlerrm<>'injected_replay_proof_failure' then raise;end if;end;
 assert not exists(select 1 from platform_jobs where id=x.job_id and metadata ? 'slack_page_v1');
end$$;reset role;
do $$begin assert not exists(select 1 from slack_channel_visibility_receipts where job_id=(select job_id from verify.replay));end$$;
drop trigger synthetic_replay_proof on slack_source_visibility_proofs;
set role service_role;
do $$declare x record;result jsonb;begin select * into x from verify.replay;
 -- Missing and changed versions commit held results, never a proof; roll back each probe.
 begin
  assert learn_slack_commit_source_replay(verify.id(1),x.job_id,x.worker,x.attempt,'[]',x.visibility);
  assert (select metadata->'slack_page_v1'->>'state' from platform_jobs where id=x.job_id)='source_unavailable';raise exception 'rollback_missing';
 exception when raise_exception then if sqlerrm<>'rollback_missing' then raise;end if;end;
 begin
  assert learn_slack_commit_source_replay(verify.id(1),x.job_id,x.worker,x.attempt,jsonb_set(x.records,'{0,provider_payload,text}','"Changed source"'),x.visibility);
  assert (select metadata->'slack_page_v1'->>'state' from platform_jobs where id=x.job_id)='source_changed';raise exception 'rollback_changed';
 exception when raise_exception then if sqlerrm<>'rollback_changed' then raise;end if;end;
 assert learn_slack_commit_source_replay(verify.id(1),x.job_id,x.worker,x.attempt,x.records,x.visibility);
 assert learn_slack_commit_source_replay(verify.id(1),x.job_id,x.worker,x.attempt,x.records,x.visibility);
 begin perform learn_slack_commit_source_replay(verify.id(1),x.job_id,x.worker,x.attempt,'[]',x.visibility);raise exception 'Changed commit accepted';exception when sqlstate 'PT409' then null;end;
 result:=learn_slack_finish_job(verify.id(1),x.job_id,x.worker,x.attempt,'{"success":true}');
 assert result->>'status'='succeeded' and result->>'successor_id' is null;
 assert learn_slack_finish_job(verify.id(1),x.job_id,x.worker,x.attempt,'{"success":true}')=result;
end$$;reset role;
do $$begin
 assert (select count(*) from slack_source_visibility_proofs p join slack_channel_visibility_receipts r on r.id=p.receipt_id where r.job_id=(select job_id from verify.replay))=1;
 assert not exists(select 1 from verify.preserved p join connector_accounts a on a.id=p.id where a.settings<>p.settings or a.sync_cursor<>p.sync_cursor),'Main campaign checkpoint/settings changed';
 assert (select data from verify.source_preserved)=(select to_jsonb(s) from slack_messages s where id=verify.id(501)),'Source altered by revalidation';
 assert (select count(*) from slack_message_versions where message_id=verify.id(501))=1;
 assert (select requests_reserved from slack_history_campaigns where id=verify.id(30))=1;
 assert not has_table_privilege('authenticated','slack_campaign_source_replays','SELECT,INSERT,UPDATE,DELETE');
 assert not has_table_privilege('service_role','slack_campaign_source_replays','SELECT,INSERT,UPDATE,DELETE');
 assert not has_function_privilege('authenticated','learn_slack_commit_source_replay(uuid,uuid,text,integer,jsonb,jsonb)','execute');
end$$;
-- A second request uses the same ledger, normal retry accounting and workspace 429 gate.
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='f7600000-0000-4000-8000-000000000010';set role authenticated;
do $$declare r jsonb;begin
 r:=learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(511),'replay_source',(select definition from verify.replay),'apply');
 update verify.replay set job_id=(r->>'jobId')::uuid,receipt=r;
end$$;reset role;
-- Advancing only the synthetic offline pacing fixture avoids sleeping in tests.
update slack_workspace_pacing set next_allowed_at=clock_timestamp()-interval '1 second',blocked_until='-infinity' where team_id='TCAMPAIGN';
set request.jwt.claim.role='service_role';set role service_role;
do $$declare j platform_jobs%rowtype;x record;r jsonb;begin
 select * into j from learn_slack_claim_jobs(verify.id(521),1);assert j.id=(select job_id from verify.replay);
 update verify.replay set worker=j.claimed_by,attempt=j.attempt_count;
 assert learn_slack_campaign_reserve_request(verify.id(1),j.id,j.claimed_by,j.attempt_count,1);
 r:=learn_slack_finish_job(verify.id(1),j.id,j.claimed_by,j.attempt_count,'{"success":false,"code":"slack_history_rate_limited","retryable":true,"retry_after_seconds":120}');
 assert r->>'status'='retrying';
 assert (select blocked_until>clock_timestamp()+interval '110 seconds' from slack_workspace_pacing where team_id='TCAMPAIGN');
 assert not exists(select 1 from learn_slack_claim_jobs(verify.id(522),1));
end$$;reset role;
update slack_workspace_pacing set next_allowed_at=clock_timestamp()-interval '1 second',blocked_until='-infinity' where team_id='TCAMPAIGN';
update platform_jobs set available_at=clock_timestamp()-interval '1 second' where id=(select job_id from verify.replay);
set role service_role;
do $$declare j platform_jobs%rowtype;x record;begin
 select * into x from verify.replay;
 select * into j from learn_slack_claim_jobs(verify.id(523),1);assert j.id=x.job_id and j.attempt_count=2;
 assert learn_slack_source_replay_scope(verify.id(1),x.job_id,x.worker,x.attempt) is null;
 begin perform learn_slack_commit_source_replay(verify.id(1),x.job_id,x.worker,x.attempt,x.records,x.visibility);raise exception 'Old attempt accepted';exception when sqlstate 'PT409' then null;end;
 assert learn_slack_campaign_reserve_request(verify.id(1),j.id,j.claimed_by,j.attempt_count,1);
 assert learn_slack_finish_job(verify.id(1),j.id,j.claimed_by,j.attempt_count,'{"success":false,"code":"slack_history_source_unavailable","retryable":false,"retry_after_seconds":0}')->>'status'='dead_letter';
end$$;reset role;
do $$begin
 assert (select requests_reserved from slack_history_campaigns where id=verify.id(30))=3;
 assert (select count(*) from slack_source_visibility_proofs p join slack_channel_visibility_receipts r on r.id=p.receipt_id where r.tenant_id=verify.id(1))=1;
 assert not exists(select 1 from verify.preserved p join connector_accounts a on a.id=p.id where a.settings<>p.settings or a.sync_cursor<>p.sync_cursor);
end$$;
