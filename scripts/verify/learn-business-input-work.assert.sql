create table fixture_work_results(external_id text primary key,result jsonb);
grant select,insert on fixture_work_results to authenticated;
set role authenticated;
do $$declare r jsonb;begin
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','101'),null,'Synthetic work review');
 assert r->>'state'='held' and r->>'reason'='property_identity_unreviewed';
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('properties','4'),null,'Synthetic site review');
 assert r->>'state'='linked';insert into fixture_work_results values('site',r);
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','101'),null,'Synthetic work review');
 assert r->>'state'='linked' and r->>'already'='false';insert into fixture_work_results values('101',r);
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','101'),null,'Synthetic work review');assert r->>'already'='true';
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','102'),null,'Synthetic work review');assert r->>'state'='linked';insert into fixture_work_results values('102',r);
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','103'),null,'Synthetic work review');assert r->>'reason'='property_missing_or_ambiguous';
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','104'),null,'Synthetic work review');assert r->>'state'='linked';insert into fixture_work_results values('104',r);
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','105'),null,'Synthetic work review');assert r->>'reason'='job_status_unrecognised';
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','106'),null,'Synthetic work review');assert r->>'reason'='job_timestamp_invalid';
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','107'),null,'Synthetic work review');assert r->>'reason'='property_reference_invalid';
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','108'),null,'Synthetic work review');assert r->>'reason'='existing_external_identity_needs_review';
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','108'),fixture_id(88),'Reviewed existing job');assert r->>'state'='linked' and r->>'entity_id'=fixture_id(88)::text;
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','109'),fixture_id(89),'Synthetic wrong owner');assert r->>'reason'='target_job_owner_mismatch';
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','112'),null,'Invalid object reference');assert r->>'reason'='property_reference_invalid';
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','113'),null,'Invalid hour boundary');assert r->>'reason'='job_timestamp_invalid';
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','114'),null,'Invalid completion object');assert r->>'reason'='job_timestamp_invalid';
 begin perform learn_commusoft_confirm_work_record(fixture_id(99),fixture_work_version('jobs','110'),null,'Foreign company');raise exception 'foreign company accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$declare site uuid;job public.jobs%rowtype;begin
 site:=((select result from fixture_work_results where external_id='site')->>'entity_id')::uuid;
 select * into job from jobs where external_id='101';
 assert job.site_id=site and job.customer_person_id=(select entity_id from learn_business_input_links where connection_id=fixture_id(5) and collection='properties' and external_id='1') and job.customer_company_id is null;
 assert job.created_date='2026-10-01T09:00:00Z' and job.completed_date is null and job.engineer_person_id is null and not job.verified;
 select * into job from jobs where external_id='102';
 assert job.customer_company_id=(select entity_id from learn_business_input_links where connection_id=fixture_id(5) and collection='properties' and external_id='2') and job.customer_person_id is null and job.site_id is null;
 assert job.status='completed' and job.completed_date='2026-10-02T09:00:00Z' and job.created_date is null;
 select * into job from jobs where external_id='104';assert job.status='closed' and job.completed_date is null,'closed inferred completed';
 assert (select to_jsonb(j) from jobs j where id=fixture_id(88))=(select value from fixture_job_baseline),'existing canonical job overwritten';
 assert not exists(select 1 from jobs where external_id in ('103','105','106','107','109','110'));
 assert exists(select 1 from learn_business_input_projection_attempts where result->>'reason'='property_identity_unreviewed'),'held outcome missing';
 assert not has_table_privilege('authenticated','learn_business_input_projection_attempts','SELECT');
 assert not has_function_privilege('authenticated','learn_commusoft_property_owner(uuid,uuid,text,boolean)','EXECUTE');
end$$;
-- Late attempt-ledger failure rolls back canonical job and source link together.
create function fixture_fail_projection_attempt() returns trigger language plpgsql as $$begin raise exception 'injected attempt failure';end$$;
create trigger fixture_fail_projection_attempt before insert on learn_business_input_projection_attempts for each row execute function fixture_fail_projection_attempt();
set role authenticated;
do $$begin
 begin perform learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','110'),null,'Synthetic late failure');raise exception 'injection failed';
 exception when raise_exception then if sqlerrm<>'injected attempt failure' then raise;end if;end;
end$$;
reset role;
do $$begin assert not exists(select 1 from jobs where external_id='110');assert not exists(select 1 from learn_business_input_links where collection='jobs' and external_id='110');assert fixture_work_version('jobs','110') is not null;end$$;
drop trigger fixture_fail_projection_attempt on learn_business_input_projection_attempts;
create table fixture_work_before as select to_jsonb(j) as value from jobs j where external_id='101';
-- Canonical site reassignment is also checked; no job silently follows it.
update sites set person_id=fixture_id(83) where id=((select result from fixture_work_results where external_id='site')->>'entity_id')::uuid;
set role authenticated;
do $$declare r jsonb;begin
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','101'),null,'Synthetic work review');assert r->>'reason'='site_canonical_owner_changed';
end$$;
reset role;
update sites set person_id=(select entity_id from learn_business_input_links where connection_id=fixture_id(5) and collection='properties' and external_id='1');
-- Retained site source changes ownership: the old canonical job is never moved.
select fixture_work_page('properties','{"data":[{"id":4,"type":"workaddress","parentPropertyID":2}],"pagination":{"hasMore":false,"nextCursor":4}}');
set role authenticated;
do $$declare r jsonb;begin
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','101'),null,'Synthetic work review');assert r->>'reason'='site_source_owner_changed';
end$$;
reset role;
do $$begin assert (select to_jsonb(j) from jobs j where external_id='101')=(select value from fixture_work_before),'retained job changed with site ownership';end$$;
-- Same provider job number on another connection remains separate and resolves
-- its property in THAT connection, not the first matching numeric ID.
select fixture_work_page('jobs','{"data":[{"id":101,"propertyID":1,"status":"Open"}],"pagination":{"hasMore":false,"nextCursor":101}}',fixture_id(55));
create temp table fixture_other_job as select id from learn_business_input_versions where connection_id=fixture_id(55) and collection='jobs' and external_id='101';
grant select on fixture_other_job to authenticated;
set role authenticated;
do $$declare r jsonb;begin r:=learn_commusoft_confirm_work_record(fixture_id(1),(select id from fixture_other_job),null,'Separate connection review');assert r->>'state'='linked';end$$;
reset role;
do $$begin
 assert (select count(*) from jobs where external_id='101')=2;
 assert (select count(distinct source_system) from jobs where external_id='101')=2;
 assert (select customer_person_id from jobs where external_id='101' and source_system='commusoft:connection:'||fixture_id(55))=fixture_id(83);
 begin delete from learn_business_input_projection_attempts;raise exception 'attempt history deleted';exception when insufficient_privilege then null;end;
end$$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000081';
set role authenticated;
do $$begin
 begin perform learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','110'),null,'Viewer attempt');raise exception 'viewer accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
select 'Work projection: reviewed customer/site ownership, held dependencies, scoped job identities, lifecycle fields, existing-row preservation and atomic failure passed.';
