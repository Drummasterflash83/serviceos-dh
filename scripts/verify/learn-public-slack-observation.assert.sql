set local plpgsql.check_asserts=on;
set local statement_timeout='15s';
-- Caller runs this fixture inside a transaction and rolls it back.
create function pg_temp.sr(n int) returns uuid language sql immutable as $$select ('caa14000-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.sr(int) to authenticated;
insert into public.tenants(id,slug,display_name,status) values(pg_temp.sr(1),'source-reader-a','Synthetic source A','active'),(pg_temp.sr(2),'source-reader-b','Synthetic source B','active');
insert into public.provider_connections(id,tenant_id,provider,status,auth_mode,non_secret_config) values(pg_temp.sr(20),pg_temp.sr(1),'slack','configured','api_key','{"team_id":"TTEST"}');
insert into public.tenant_connectors(id,tenant_id,connector_id,provider,category,status,enabled) values(pg_temp.sr(21),pg_temp.sr(1),'slack','slack','communications','active',true);
insert into public.connector_accounts(id,tenant_id,tenant_connector_id,account_key,status) values(pg_temp.sr(22),pg_temp.sr(1),pg_temp.sr(21),'TTEST:CTEST','active');
create function pg_temp.message(n int, flags jsonb default '{}', proof boolean default true, body text default 'Synthetic historical request', subtype text default null) returns void language plpgsql as $$
declare payload jsonb;v uuid:=pg_temp.sr(200+n);e uuid:=pg_temp.sr(300+n);job uuid:=pg_temp.sr(400+n);s uuid:=pg_temp.sr(100+n);stamp text:=(1649347021+n)::text||'.123456';begin
 payload:=jsonb_build_object('type','message','ts',stamp,'text',body,'user','UTEST','private_unreturned','DO_NOT_RETURN');
 if subtype is not null then payload:=payload||jsonb_build_object('subtype',subtype,'hidden',true);end if;
 insert into public.slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,message_text,provider_payload,source_version,source_updated_at)
 values(s,pg_temp.sr(1),'TTEST:CTEST:'||stamp,'TTEST','CTEST',stamp,body,payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),stamp::numeric);
 insert into public.slack_message_versions(id,tenant_id,message_id,source_version,provider_payload)select v,tenant_id,id,source_version,provider_payload from public.slack_messages where id=s;
 insert into public.interactions(id,tenant_id,source_type,source_connector_id,source_table,source_id,interaction_type,
 direction,processing_status,body_preview,metadata,occurred_at,created_at,updated_at)
 select pg_temp.sr(500+n),tenant_id,'chat','slack','slack_messages',id,'slack_message','unknown','identity_review',left(message_text,2000),
 jsonb_build_object('source_version',source_version,'identity_delivery',jsonb_build_object('state','review_required','reason','direction_unverified')),
 '2026-10-14T06:00:00Z'::timestamptz+n*interval '1 second','2026-10-14T06:00:00Z','2026-10-14T06:00:00.123456Z'
 from public.slack_messages where id=s;
 if not proof then return;end if;
 insert into public.platform_jobs(id,tenant_id,job_type,job_key,status,payload) values(job,pg_temp.sr(1),'slack.history_sync','source-reader-'||n,'succeeded','{}');
 insert into public.slack_channel_visibility_receipts(id,tenant_id,job_id,account_id,claimed_by,attempt_count,connection_id,connection_revision,team_id,channel_id,evidence,evidence_sha256,page_sha256)
 select e,pg_temp.sr(1),job,pg_temp.sr(22),'synthetic',1,id,updated_at,'TTEST','CTEST',jsonb_build_object('version','slack-capture-visibility/1','team_id','TTEST','channel_id','CTEST','connection_id',id,'connection_revision',updated_at,'is_channel',true,'is_private',false,'is_shared',false,'pending_shared',false,'is_im',false,'is_mpim',false,'is_ext_shared',false,'is_org_shared',false,'is_pending_ext_shared',false)||flags,repeat('c',64),repeat('d',64) from public.provider_connections where id=pg_temp.sr(20);
 insert into public.slack_source_visibility_proofs values(e,v);
end$$;

select pg_temp.message(1);
select pg_temp.message(2,'{"is_private":true}');
select pg_temp.message(3,'{"is_shared":true}');
select pg_temp.message(4,'{"is_im":true}');
select pg_temp.message(5,'{"is_mpim":true}');
select pg_temp.message(6,'{"is_ext_shared":true}');
select pg_temp.message(7,'{"pending_shared":true}');
select pg_temp.message(8,'{"is_channel":false}');
select pg_temp.message(9,'{}',false);
select pg_temp.message(10,'{}',true,'Withheld synthetic content','tombstone');
select pg_temp.message(11,'{}',true,'Unknown synthetic content','unsupported_synthetic_subtype');
select pg_temp.message(12,'{"is_private":null}');
select pg_temp.message(13,'{"is_org_shared":true}');
select pg_temp.message(14,'{"is_pending_ext_shared":true}');
select pg_temp.message(15,'{}',true,'');
create temporary table learning_sources_before as select id,md5(to_jsonb(s)::text) h from public.slack_messages s where tenant_id=pg_temp.sr(1);
create temporary table learning_interactions_before as select id,md5(to_jsonb(i)::text) h from public.interactions i where tenant_id=pg_temp.sr(1);
do $$declare n int;p jsonb;change text;begin
 p:=public.learn_public_slack_observation_context(pg_temp.sr(1),pg_temp.sr(501));
 assert p->>'scope'='company_source' and p->>'attribution'='unresolved' and p->>'interaction_id'=pg_temp.sr(501)::text, 'Synthetic public source was not qualified';
 assert p->>'interaction_updated_at'='2026-10-14T06:00:00.123456+00:00';
 assert public.learn_public_slack_observation_context(pg_temp.sr(2),pg_temp.sr(501)) is null;
 for n in 2..15 loop assert public.learn_public_slack_observation_context(pg_temp.sr(1),pg_temp.sr(500+n)) is null,'Unproven source admitted '||n;end loop;
 foreach change in array array[
  'update provider_connections set revoked_at=now() where id=pg_temp.sr(20)',
  'update provider_connections set non_secret_config=''{"team_id":"OTHER"}'' where id=pg_temp.sr(20)',
  'update interactions set body_preview=''changed'' where id=pg_temp.sr(501)',
  'update interactions set subject=''unverified summary'' where id=pg_temp.sr(501)',
  'update interactions set summary=''unverified summary'' where id=pg_temp.sr(501)',
  'update interactions set metadata=metadata||''{"work_context":{}}'' where id=pg_temp.sr(501)',
  'update interactions set direction=''inbound'' where id=pg_temp.sr(501)',
  'update interactions set status=''deleted'' where id=pg_temp.sr(501)',
  'update interactions set processing_status=''pending'' where id=pg_temp.sr(501)',
  'update slack_messages set source_version=repeat(''b'',64) where id=pg_temp.sr(101)',
  'update slack_messages set provider_payload=provider_payload||''{"text":"changed"}'' where id=pg_temp.sr(101)'
 ]loop begin
  execute change;assert public.learn_public_slack_observation_context(pg_temp.sr(1),pg_temp.sr(501)) is null,change;
  raise exception 'rollback_probe';exception when raise_exception then if sqlerrm<>'rollback_probe' then raise;end if;end;
 end loop;
 assert not has_function_privilege('anon','learn_public_slack_observation_context(uuid,uuid)','execute');
 assert not has_function_privilege('authenticated','learn_public_slack_observation_context(uuid,uuid)','execute');
 assert has_function_privilege('service_role','learn_public_slack_observation_context(uuid,uuid)','execute');
end$$;
-- Selection includes real source holds without modifying or resolving them.
select pg_temp.message(n) from generate_series(20,39) n;
insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,processing_status,occurred_at,created_at)
 select pg_temp.sr(800+n),pg_temp.sr(1),'google','email','email_messages',pg_temp.sr(1800+n),'email_received','inbound','enriched','2020-01-01'::timestamptz+n*interval '1 second','2020-01-01' from generate_series(1,20)n;
create temporary table chosen as select row_number() over() pos,* from intelligence_select_uningested(pg_temp.sr(1),'obs-ingest/2',10);
do $$begin
 assert (select count(*) from chosen)=10;
 assert (select array_agg(interaction_id order by pos) from chosen where pos<=4)=array[pg_temp.sr(539),pg_temp.sr(538),pg_temp.sr(537),pg_temp.sr(536)];
 assert (select array_agg(interaction_id order by pos) from chosen where pos>4)=array[pg_temp.sr(801),pg_temp.sr(802),pg_temp.sr(803),pg_temp.sr(804),pg_temp.sr(805),pg_temp.sr(806)];
 assert (select count(*) from intelligence_select_uningested(pg_temp.sr(2),'obs-ingest/2',10))=0;
 assert (select count(*) from intelligence_select_uningested(pg_temp.sr(1),'obs-ingest/2',0))=1;
end$$;
insert into intelligence_ingestions(tenant_id,interaction_id,mapper_version,ingest_key,status)
 values(pg_temp.sr(1),pg_temp.sr(539),'obs-ingest/2','retained-source-skip-fixture','skipped');
do $$begin
 assert not exists(select 1 from intelligence_select_uningested(pg_temp.sr(1),'obs-ingest/2',200) where interaction_id=pg_temp.sr(539));
 assert (select count(*) from intelligence_select_uningested(pg_temp.sr(1),'another-mapper',200) where interaction_id=pg_temp.sr(539))=1;
end$$;
-- Exercise the actual atomic observer with an unresolved, proven source.
create temporary table lrinput as select __DRAFT__ d,__RESULT__ r;
do $$begin
 assert (select d#>'{attributes,retained_source_context}' from lrinput)=learn_public_slack_observation_context(pg_temp.sr(1),pg_temp.sr(501)), 'Generated fixture differs from actual retained proof';
end$$;
insert into platform_jobs(id,tenant_id,job_type,job_key,status,claimed_by,attempt_count,lease_expires_at,payload)
 select pg_temp.sr(900),pg_temp.sr(1),'intelligence.observe','public-source-observation','running','fixture',1,now()+interval '5 minutes',jsonb_build_object('observation',d) from lrinput;
insert into intelligence_ingestions(tenant_id,interaction_id,mapper_version,ingest_key,observe_job_id,status)
 values(pg_temp.sr(1),pg_temp.sr(501),'obs-ingest/2','public-source-ingestion',pg_temp.sr(900),'enqueued');
do $$declare r jsonb;begin
 begin
  update provider_connections set revoked_at=now() where id=pg_temp.sr(20);
  perform learn_observation_deliver(pg_temp.sr(1),pg_temp.sr(900),'{"claimedBy":"fixture","attemptCount":1}',(select v.r from lrinput v));
  raise exception 'Revoked source committed';
 exception when raise_exception then if sqlerrm<>'learn_observation_source_changed' then raise;end if;end;
 begin
  update platform_jobs set payload=jsonb_set(payload,'{observation,attributes,retained_source_context,source_version}',to_jsonb(repeat('b',64))) where id=pg_temp.sr(900);
  update lrinput set r=jsonb_set(lrinput.r,'{object,attributes}',(select payload#>'{observation,attributes}' from platform_jobs where id=pg_temp.sr(900)));
  perform learn_observation_deliver(pg_temp.sr(1),pg_temp.sr(900),'{"claimedBy":"fixture","attemptCount":1}',(select v.r from lrinput v));
  raise exception 'Changed binding committed';
 exception when raise_exception then if sqlerrm<>'learn_observation_source_changed' then raise;end if;end;
 r:=learn_observation_deliver(pg_temp.sr(1),pg_temp.sr(900),'{"claimedBy":"fixture","attemptCount":1}',(select v.r from lrinput v));
 assert r->>'state'='committed' and r->'can_execute'='false' and r->'action_ids'='[]';
 assert r=learn_observation_deliver(pg_temp.sr(1),pg_temp.sr(900),null,null);
 assert not exists(select 1 from automation_intents where tenant_id=pg_temp.sr(1));
 assert (select count(*) from intelligence_objects where tenant_id=pg_temp.sr(1))=1;
 assert (select status from intelligence_ingestions where interaction_id=pg_temp.sr(501))='observed';
 assert not exists(select 1 from learning_sources_before b join slack_messages s on s.id=b.id where b.h<>md5(to_jsonb(s)::text));
 assert not exists(select 1 from learning_interactions_before b join interactions i on i.id=b.id where b.h<>md5(to_jsonb(i)::text));
end$$;

-- A thousand proven rows exercise per-row qualification and mixed selection.
select pg_temp.message(n) from generate_series(20000,20999)n;
do $$declare started timestamptz:=clock_timestamp();n int;begin
 select count(*) into n from intelligence_select_uningested(pg_temp.sr(1),'perf-fixture',25);
 assert n=25;
 raise notice 'synthetic_selection_ms=%',extract(epoch from clock_timestamp()-started)*1000;
 assert clock_timestamp()-started<interval '10 seconds','Synthetic selection exceeded the local execution budget';
end$$;
