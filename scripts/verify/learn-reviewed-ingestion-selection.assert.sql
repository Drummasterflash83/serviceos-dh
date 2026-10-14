-- Synthetic fixtures, executed in a rolled-back transaction on the full schema.
set local plpgsql.check_asserts=on;
create function pg_temp.rqid(n integer) returns uuid language sql immutable as $$select ('ad241b32-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.rqid(integer) to service_role;
insert into public.tenants(id,slug,display_name) values(pg_temp.rqid(1),'review-queue-a','Synthetic review queue'),(pg_temp.rqid(2),'review-queue-b','Synthetic isolated queue');
insert into public.interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,processing_status)
select pg_temp.rqid(n),pg_temp.rqid(1),'simwood','phone','phone_calls',pg_temp.rqid(n+1000),'phone_call','inbound','2010-01-01Z'::timestamptz+n*interval '1 second','enriched' from generate_series(100,349)n;
insert into public.slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,message_text,provider_payload,source_version,source_updated_at)
select pg_temp.rqid(n+1000),pg_temp.rqid(1),'review-'||n,'TSYNTHETIC','CSYNTHETIC','1791800000.'||n,'Synthetic review message','{"type":"message"}',repeat('a',64),1791800000+n from generate_series(400,409)n;
insert into public.interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,processing_status,metadata)
select pg_temp.rqid(n),pg_temp.rqid(1),'slack','chat','slack_messages',pg_temp.rqid(n+1000),'slack_message','unknown','2026-10-14Z'::timestamptz+n*interval '1 second','enriched',jsonb_build_object('source_version',repeat('a',64),'work_context',jsonb_build_object('version','learn-slack-work-context/1','state','reviewed','source_version',repeat('a',64))) from generate_series(400,409)n;
-- An older foreign-tenant record must never enter either lane.
insert into public.interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,processing_status)
values(pg_temp.rqid(500),pg_temp.rqid(2),'simwood','phone','phone_calls',pg_temp.rqid(1500),'phone_call','inbound','2000-01-01Z','enriched');
set local role service_role;
do $$declare a uuid[];begin
 select array_agg(interaction_id) into a from public.intelligence_select_uningested(pg_temp.rqid(1),'priority-test',25);
 assert cardinality(a)=25;
 assert a[1:5]=array(select pg_temp.rqid(n) from generate_series(400,404)n),'Five reviewed slots required';
 assert a[6:25]=array(select pg_temp.rqid(n) from generate_series(100,119)n),'Twenty oldest historical slots required';
 assert not pg_temp.rqid(500)=any(a),'Tenant isolation';
 assert (select count(*)=25 from public.intelligence_select_uningested(pg_temp.rqid(1),'priority-test',null));
 assert (select count(*)=200 from public.intelligence_select_uningested(pg_temp.rqid(1),'priority-test',10000));
 assert (select interaction_id=pg_temp.rqid(100) from public.intelligence_select_uningested(pg_temp.rqid(1),'priority-test',1));
 assert (select interaction_id=pg_temp.rqid(100) from public.intelligence_select_uningested(pg_temp.rqid(1),'priority-test',-1));
 assert (select count(*)=0 from public.intelligence_select_uningested(null,'priority-test',25));
end$$;
reset role;
-- All ledger states already claimed this mapper and stay excluded. Other versions
-- do not suppress legitimate selection for a new mapper.
insert into public.intelligence_ingestions(tenant_id,interaction_id,mapper_version,ingest_key,status)
select pg_temp.rqid(1),pg_temp.rqid(n),'priority-test','synthetic-review-'||n,case n when 400 then 'failed' when 401 then 'enqueued' else 'observed' end from generate_series(400,404)n;
set local role service_role;
do $$declare a uuid[];begin
 select array_agg(interaction_id) into a from public.intelligence_select_uningested(pg_temp.rqid(1),'priority-test',25);
 assert a[1:5]=array(select pg_temp.rqid(n) from generate_series(405,409)n);
 assert a[6:25]=array(select pg_temp.rqid(n) from generate_series(100,119)n);
 assert (select interaction_id=pg_temp.rqid(400) from public.intelligence_select_uningested(pg_temp.rqid(1),'other-mapper',5) limit 1);
end$$;
reset role;
-- Source edits, withheld tombstones and stale review state lose the priority slot.
update public.slack_messages set source_version=repeat('b',64) where id=pg_temp.rqid(1405);
update public.slack_messages set provider_payload='{"type":"message","subtype":"tombstone","hidden":true}' where id=pg_temp.rqid(1406);
update public.interactions set metadata=jsonb_set(metadata,'{work_context,state}','"source_changed"') where id=pg_temp.rqid(407);
update public.interactions set processing_status='pending' where id=pg_temp.rqid(408);
-- Source from another tenant cannot provide the remaining matching proof.
insert into public.slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,message_text,provider_payload,source_version,source_updated_at) values(pg_temp.rqid(1600),pg_temp.rqid(2),'foreign-source','TFOREIGN','CFOREIGN','1791800000.600','Synthetic foreign message','{}',repeat('a',64),1791800000.600);
update public.interactions set source_id=pg_temp.rqid(1600) where id=pg_temp.rqid(409);
set local role service_role;
do $$declare a uuid[];begin
 select array_agg(interaction_id) into a from public.intelligence_select_uningested(pg_temp.rqid(1),'priority-test',25);
 assert a=array(select pg_temp.rqid(n) from generate_series(100,124)n),'Unfilled review capacity returns to historical work';
end$$;
reset role;
do $$begin
 assert not has_function_privilege('anon','public.intelligence_select_uningested(uuid,text,integer)','execute');
 assert not has_function_privilege('authenticated','public.intelligence_select_uningested(uuid,text,integer)','execute');
 assert has_function_privilege('service_role','public.intelligence_select_uningested(uuid,text,integer)','execute');
 assert not (select prosecdef from pg_proc where oid='public.intelligence_select_uningested(uuid,text,integer)'::regprocedure);
 assert not exists(select 1 from public.platform_jobs where tenant_id in(pg_temp.rqid(1),pg_temp.rqid(2))),'Selector must not enqueue';
end$$;
select 'Review quota, historical progress, source freshness, mapper idempotency, tenant isolation, bounds and unchanged authority passed';
