-- Synthetic published rule interval; no real publication is backdated.
update operating_profile_entries set value=value||'{"tenantId":"00000000-0000-4000-8000-000000000001","name":"Synthetic response","status":"published","scaleMax":100,"groupId":null,"metrics":[{"key":"response.minutes","label":"Response","unit":"minutes","weight":1,"zeroAt":60,"fullAt":0,"minSamples":1,"minCoverage":0.5,"maxAgeHours":100000,"sourceSystems":["communications"]}]}';
insert into learn_scorecard_publications(id,tenant_id,version_id,policy_id,revision,scope,published_by,effective_from,reason,policy)
 select '00000000-0000-4000-8000-000000000060',tenant_id,version_id,(value->>'id')::uuid,1,'member:all','00000000-0000-4000-8000-000000000030','2026-01-01','Synthetic fixture interval',value from operating_profile_entries where value->>'id'='00000000-0000-4000-8000-000000000007' and value->>'version'='1';
create function test_save_assessment(request_id uuid,expected jsonb default '[{"id":"00000000-0000-4000-8000-000000000008","reviewRevision":0},{"id":"00000000-0000-4000-8000-000000000009","reviewRevision":2}]',reason text default 'Retained synthetic assessment',pub uuid default '00000000-0000-4000-8000-000000000060',subject uuid default '00000000-0000-4000-8000-000000000003',end_at timestamptz default '2026-01-02') returns jsonb language sql as $$
 select learn_assessment_save('00000000-0000-4000-8000-000000000001',request_id,pub,'member',subject,null,'2026-01-01',end_at,expected,reason)
$$;
create table assessment_sources_before as select * from measurements;
create table assessment_reviews_before as select * from learn_performance_reviews;
set role authenticated;
set test.actor='00000000-0000-4000-8000-000000000030';
do $$ declare r jsonb;begin
 r:=test_save_assessment('00000000-0000-4000-8000-000000000070');
 if r->>'reused'<>'false' then raise exception 'First save reused';end if;
 r:=test_save_assessment('00000000-0000-4000-8000-000000000070');
 if r->>'reused'<>'true' then raise exception 'Exact retry duplicated';end if;
 begin perform test_save_assessment('00000000-0000-4000-8000-000000000070',reason=>'Changed');raise exception 'Identity reused';exception when sqlstate 'PT409' then null;end;
 begin perform test_save_assessment(gen_random_uuid(),expected=>'[]');raise exception 'Stale measurements accepted';exception when sqlstate 'PT409' then null;end;
 begin perform test_save_assessment(gen_random_uuid(),pub=>gen_random_uuid());raise exception 'Unknown publication accepted';exception when sqlstate 'PT409' then null;end;
 begin perform test_save_assessment(gen_random_uuid(),subject=>'00000000-0000-4000-8000-000000000041');raise exception 'Foreign subject accepted';exception when invalid_parameter_value then null;end;
 begin perform test_save_assessment(gen_random_uuid(),end_at=>'2099-01-01');raise exception 'Unfinished period accepted';exception when invalid_parameter_value then null;end;
 begin insert into learn_assessments(id) values(gen_random_uuid());raise exception 'Client wrote snapshot';exception when insufficient_privilege then null;end;
 if (select count(*) from learn_assessments)<>1 then raise exception 'Owner history unavailable';end if;
end $$;
reset role;
create table first_assessment as select * from learn_assessments;
set role authenticated;
select learn_performance_review('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000071',2,'confirmed','Synthetic population checked');
do $$ begin
 begin perform test_save_assessment(gen_random_uuid());raise exception 'Stale review accepted';exception when sqlstate 'PT409' then null;end;
 if test_save_assessment('00000000-0000-4000-8000-000000000070')->>'reused'<>'true' then raise exception 'Retry changed after later review';end if;
 perform test_save_assessment('00000000-0000-4000-8000-000000000072','[{"id":"00000000-0000-4000-8000-000000000008","reviewRevision":0},{"id":"00000000-0000-4000-8000-000000000009","reviewRevision":3}]');
end $$;
set test.actor='00000000-0000-4000-8000-000000000042';
do $$ begin
 if (select count(*) from learn_assessments)<>0 then raise exception 'Viewer saw snapshots';end if;
 begin perform test_save_assessment(gen_random_uuid());raise exception 'Viewer saved';exception when insufficient_privilege then null;end;
end $$;
set test.actor='00000000-0000-4000-8000-000000000041';
do $$ begin
 if (select count(*) from learn_assessments)<>0 then raise exception 'Foreign owner saw snapshots';end if;
 begin perform test_save_assessment(gen_random_uuid());raise exception 'Foreign owner saved';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into view_as_context values('00000000-0000-4000-8000-000000000030',null,null);
set role authenticated;
set test.actor='00000000-0000-4000-8000-000000000030';
do $$ begin
 begin perform test_save_assessment(gen_random_uuid());raise exception 'Preview saved';exception when insufficient_privilege then null;end;
end $$;
reset role;
delete from view_as_context;
do $$ begin
 if exists(select * from first_assessment except select * from learn_assessments) then raise exception 'Earlier assessment changed';end if;
 if exists(select * from assessment_sources_before except select * from measurements) or (select count(*) from assessment_sources_before)<>(select count(*) from measurements) then raise exception 'Source measurements changed';end if;
 if exists(select * from assessment_reviews_before except select * from learn_performance_reviews) then raise exception 'Existing reviews changed';end if;
 if (select snapshot#>>'{reviews,1,decision}' from learn_assessments where id='00000000-0000-4000-8000-000000000070')<>'disputed' or (select snapshot#>>'{reviews,2,decision}' from learn_assessments where id='00000000-0000-4000-8000-000000000072')<>'confirmed' then raise exception 'Review snapshots not independent';end if;
 begin update learn_assessments set reason='Rewrite';raise exception 'Snapshot edited';exception when restrict_violation then null;end;
 begin delete from learn_assessments;raise exception 'Snapshot deleted';exception when restrict_violation then null;end;
 begin truncate learn_assessments;raise exception 'Snapshot truncated';exception when restrict_violation then null;end;
 if has_table_privilege('service_role','learn_assessments','insert') or has_table_privilege('authenticated','learn_assessments','insert') or has_function_privilege('service_role','learn_assessment_save(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text)','execute') or has_function_privilege('anon','learn_assessment_save(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text)','execute') then raise exception 'Authority broadened';end if;
end $$;
alter table learn_assessments add constraint injected_assessment_failure check(id<>'00000000-0000-4000-8000-000000000074');
set role authenticated;
do $$ begin
 begin perform test_save_assessment('00000000-0000-4000-8000-000000000074','[{"id":"00000000-0000-4000-8000-000000000008","reviewRevision":0},{"id":"00000000-0000-4000-8000-000000000009","reviewRevision":3}]');raise exception 'Failure injection missed';exception when check_violation then null;end;
 if (select count(*) from learn_assessments)<>2 then raise exception 'Failed save left a row';end if;
end $$;
reset role;
alter table learn_assessments drop constraint injected_assessment_failure;
