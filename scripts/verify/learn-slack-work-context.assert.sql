-- Synthetic journey on the complete restored schema; caller rolls this back.
set local plpgsql.check_asserts=on;
create function pg_temp.sc(n integer) returns uuid language sql immutable as $$select ('ae156482-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.sc(integer) to authenticated,anon,service_role;
insert into tenants(id,slug,display_name,status) values(pg_temp.sc(1),'slack-context-one','Synthetic Slack context','active'),(pg_temp.sc(2),'slack-context-two','Synthetic other tenant','active');
insert into auth.users(id,banned_until) values(pg_temp.sc(10),'infinity'),(pg_temp.sc(11),'infinity');
insert into profiles(id,tenant_id,role) values(pg_temp.sc(10),null,'viewer'),(pg_temp.sc(11),pg_temp.sc(1),'owner') on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into platform_authority_grants(profile_id,permission,effective_from,effective_to,granted_by,reason) values(pg_temp.sc(10),'platform.controlplane.admin',now()-interval '1 hour',now()+interval '1 hour','offline','Synthetic context review');
insert into jobs(id,tenant_id,title,job_number,status) values(pg_temp.sc(20),pg_temp.sc(1),'Synthetic repair','100','open'),(pg_temp.sc(21),pg_temp.sc(2),'Foreign repair','100','open');
insert into slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,message_text,provider_payload,source_version,source_updated_at)
 values(pg_temp.sc(30),pg_temp.sc(1),'synthetic-message','TSYNTHETIC','CSYNTHETIC','1791800000.000001','Job 100 is waiting for a part.','{}',repeat('a',64),1791800000.000001);
insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,body_preview,processing_status,metadata)
 values(pg_temp.sc(40),pg_temp.sc(1),'slack','chat','slack_messages',pg_temp.sc(30),'slack_message','unknown','2026-10-12Z','Job 100 is waiting for a part.','identity_review',jsonb_build_object('source_version',repeat('a',64),'identity_delivery',jsonb_build_object('reason','direction_unverified')));
insert into platform_events(tenant_id,event_type,subject_type,subject_id,status) values(pg_temp.sc(1),'interaction.ready','interaction',pg_temp.sc(40),'pending');
create temporary table sc_saved(definition jsonb,receipt jsonb);
grant all on sc_saved to authenticated;
set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',pg_temp.sc(10)::text,true);
set local role authenticated;
do $$declare s jsonb;d jsonb;r jsonb;begin
 s:=public.learn_operator_slack_context(pg_temp.sc(1),pg_temp.sc(40),pg_temp.sc(20),'Review the observed job reference');
 assert s->>'source_version'=repeat('a',64) and s->'job'->>'id'=pg_temp.sc(20)::text;
 d:=jsonb_build_object('revision',s->>'revision','job_id',pg_temp.sc(20),'reason','Reviewed the job reference against the retained source');
 assert public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(50),pg_temp.sc(40),d,'check')->>'state'='pending';
 r:=public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(50),pg_temp.sc(40),d,'apply');
 assert r->>'state'='committed' and (r->>'events_consumed')::int=1;
 assert r=public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(50),pg_temp.sc(40),d,'check');
 assert r=public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(50),pg_temp.sc(40),d,'apply');
 assert r=public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(50),pg_temp.sc(40),d,'cancel');
 insert into sc_saved values(d,r);
 begin perform public.learn_operator_slack_context(pg_temp.sc(1),pg_temp.sc(40),pg_temp.sc(21),'Foreign job must fail');raise exception 'Foreign job accepted';exception when insufficient_privilege then null;end;
 begin perform public.learn_operator_slack_context(pg_temp.sc(2),pg_temp.sc(40),null,'Foreign source must fail');raise exception 'Foreign source accepted';exception when insufficient_privilege then null;end;
 begin perform public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(11),pg_temp.sc(51),pg_temp.sc(40),d,'apply');raise exception 'Actor mismatch accepted';exception when insufficient_privilege then null;end;
 begin perform public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(50),pg_temp.sc(40),d||'{"reason":"Changed request reason"}', 'apply');raise exception 'Conflicting request accepted';exception when sqlstate 'PT409' then null;end;
end$$;
reset role;
do $$declare i interactions%rowtype;begin
 select * into i from interactions where id=pg_temp.sc(40);
 assert i.related_job_id=pg_temp.sc(20) and i.related_person_id is null and i.related_company_id is null;
 assert i.direction='unknown' and i.processing_status='enriched' and i.metadata->'identity_delivery'->>'reason'='direction_unverified';
 assert (select count(*) from learn_slack_context_reviews where tenant_id=pg_temp.sc(1))=1;
 assert not exists(select 1 from people where tenant_id=pg_temp.sc(1));
 assert not exists(select 1 from customer_cards where tenant_id=pg_temp.sc(1));
 assert (select message_text from slack_messages where id=pg_temp.sc(30))='Job 100 is waiting for a part.';
end$$;
-- Real source-update shape invalidates the active link, preserving review history.
update slack_messages set source_version=repeat('b',64),message_text='The job reference was corrected.' where id=pg_temp.sc(30);
update interactions set metadata=metadata||jsonb_build_object('source_version',repeat('b',64)),body_preview='The job reference was corrected.' where id=pg_temp.sc(40);
do $$begin
 assert (select related_job_id is null and processing_status='pending' and metadata->'work_context'->>'state'='source_changed' from interactions where id=pg_temp.sc(40));
 assert (select count(*) from learn_slack_context_reviews where tenant_id=pg_temp.sc(1))=1;
 begin update learn_slack_context_reviews set receipt='{}' where request_id=pg_temp.sc(50);raise exception 'History changed';exception when sqlstate '55000' then null;end;
end$$;
set local role authenticated;
do $$declare s jsonb;d jsonb;r jsonb;begin
 select definition into d from sc_saved;
 begin perform public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(51),pg_temp.sc(40),d,'apply');raise exception 'Stale revision accepted';exception when sqlstate 'PT409' then null;end;
 r:=public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(51),pg_temp.sc(40),d,'cancel');
 assert r->>'state'='cancelled';
 assert r=public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(51),pg_temp.sc(40),d,'apply');
 s:=public.learn_operator_slack_context(pg_temp.sc(1),pg_temp.sc(40),null,'Keep the corrected conversation as company context');
 d:=jsonb_build_object('revision',s->>'revision','job_id',null,'reason','Reviewed as company context, no verified job reference');
 r:=public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(52),pg_temp.sc(40),d,'apply');
 assert r->'context'->>'scope'='company' and r->'context'->'job_id'='null';
end$$;
reset role;
update platform_authority_grants set effective_to=now()-interval '1 second' where profile_id=pg_temp.sc(10);
set local role authenticated;
do $$begin
 begin perform public.learn_operator_slack_context(pg_temp.sc(1),pg_temp.sc(40),null,'Revocation must deny reads');raise exception 'Revoked read accepted';exception when insufficient_privilege then null;end;
 begin perform public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(50),pg_temp.sc(40),(select definition from sc_saved),'check');raise exception 'Revoked receipt access accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$begin
 assert not has_function_privilege('anon','learn_operator_slack_context(uuid,uuid,uuid,text)','execute');
 assert not has_function_privilege('service_role','learn_operator_slack_context_review(uuid,uuid,uuid,uuid,jsonb,text)','execute');
 assert not has_table_privilege('authenticated','learn_slack_context_reviews','select');
 assert not has_function_privilege('authenticated','learn_slack_context_state(uuid,uuid,uuid)','execute');
end$$;
select 'Slack job/company context, replay, changed source, tenant isolation, actor and revocation checks passed';
