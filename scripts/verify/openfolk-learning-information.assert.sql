-- Run after the existing information-reader assertions, in the same rollback.
reset role;
set local request.jwt.claim.sub='cf800000-aaaa-4000-8000-000000000010';
set local request.jwt.claim.role='authenticated';
update public.platform_authority_grants set effective_to=clock_timestamp()+interval '5 minutes' where profile_id=pg_temp.info_id(10);
insert into public.interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,subject,body_preview,processing_status,updated_at)
select pg_temp.info_id(500+n),pg_temp.info_id(n),'slack','chat','slack_messages',pg_temp.info_id(510+n),'slack_message','unknown',now(),'Synthetic learning source','Synthetic retained excerpt','enriched','2026-10-12T12:00:00Z' from generate_series(1,2)n;
insert into public.intelligence_objects(id,tenant_id,domain,object_type,subject,source_interactions,created_from,attributes)
select pg_temp.info_id(520+n),pg_temp.info_id(case when n=2 then 2 else 1 end),'core','Observation','Synthetic saved observation',array[pg_temp.info_id(case when n=2 then 502 else 501 end)],'intelligence.ingest_interaction',
'{"channel":"chat","direction":"unknown","secret":"NEVER_RETURN","ingest":{"mapper_version":"obs-ingest/2","source_updated_at":"2026-10-12T12:00:00Z"}}'::jsonb from generate_series(1,3)n;
insert into public.platform_jobs(id,tenant_id,job_type,status) select pg_temp.info_id(530+n),pg_temp.info_id(n),'intelligence.observe','succeeded' from generate_series(1,2)n;
insert into public.learn_observation_receipts(job_id,tenant_id,interaction_id,observation_id,receipt)
select pg_temp.info_id(530+n),pg_temp.info_id(n),pg_temp.info_id(500+n),pg_temp.info_id(520+n),'{"state":"committed","decision":"observe","operational_mode":"observe_only","can_execute":false,"secret":"NEVER_RETURN"}'::jsonb from generate_series(1,2)n;
set local role authenticated;
do $$declare a jsonb;s jsonb;begin
 a:=public.openfolk_client_information(pg_temp.info_id(1),'learning_observations','verify learning evidence');
 assert jsonb_array_length(a->'rows')=1 and a#>>'{rows,0,id}'=pg_temp.info_id(521)::text,'Foreign or uncommitted observation shown';
 assert a#>'{rows,0,fields,source_current}'='true'::jsonb,'Current source not recognised';
 assert a#>>'{rows,0,fields,processing_method}'='rules-based observation';
 assert a#>'{rows,0,fields,can_execute}'='false'::jsonb and a::text not like '%NEVER_RETURN%','Unprojected metadata escaped';
 s:=public.openfolk_client_information(pg_temp.info_id(1),'communications','follow observation source',null,(a#>>'{rows,0,fields,source_interactions,0}')::uuid);
 assert s#>>'{rows,0,fields,body_preview}'='Synthetic retained excerpt';
 begin perform public.openfolk_client_information(pg_temp.info_id(1),'learning_observations','reject foreign observation',null,pg_temp.info_id(522));raise exception 'Foreign observation admitted';exception when insufficient_privilege then null;end;
 begin perform public.openfolk_client_information(pg_temp.info_id(1),'communications','reject foreign source',null,pg_temp.info_id(502));raise exception 'Foreign source admitted';exception when insufficient_privilege then null;end;
end$$;
reset role;
update public.interactions set summary='Synthetic source changed' where id=pg_temp.info_id(501);
set local role authenticated;
do $$declare a jsonb;begin
 a:=public.openfolk_client_information(pg_temp.info_id(1),'learning_observations','detect stale observation');
 assert a#>'{rows,0,fields,source_current}'='false'::jsonb,'Changed source presented as current';
end$$;
reset role;
-- Retain the receipt but simulate a no-longer-available source reference.
update public.intelligence_objects set source_interactions=array[pg_temp.info_id(502)] where id=pg_temp.info_id(521);
set local role authenticated;
do $$declare a jsonb;begin
 a:=public.openfolk_client_information(pg_temp.info_id(1),'learning_observations','reject broken lineage');
 assert a->'rows'='[]'::jsonb,'Broken or foreign source lineage admitted';
end$$;
reset role;
