-- Synthetic correction flow on the retained source/review fixtures.
alter table profiles add column tenant_id uuid,add column role text;
update profiles set tenant_id='00000000-0000-4000-8000-000000000001',role='owner';
insert into profiles values('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000002','owner'),('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000001','viewer');
delete from view_as_context;
create or replace function current_tenant_id() returns uuid language sql stable security definer as $$select tenant_id from public.profiles where id=auth.uid()$$;
create or replace function current_user_role() returns text language sql stable security definer as $$select role from public.profiles where id=auth.uid()$$;
create table correction_sources_before as select * from measurements;
create table correction_reviews_before as select * from learn_performance_reviews;
set role authenticated;
set test.actor='00000000-0000-4000-8000-000000000030';
do $$ declare
 t uuid:='00000000-0000-4000-8000-000000000001';m uuid:='00000000-0000-4000-8000-000000000009';r jsonb;
begin
 begin perform learn_performance_correct(t,m,gen_random_uuid(),1,20,'Stale review');raise exception 'Stale revision accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_performance_correct(t,m,gen_random_uuid(),2,25,'Unchanged');raise exception 'No-op accepted';exception when invalid_parameter_value then null;end;
 begin perform learn_performance_correct(t,m,gen_random_uuid(),2,'NaN','Invalid');raise exception 'NaN accepted';exception when invalid_parameter_value then null;end;
 begin perform learn_performance_correct(t,m,gen_random_uuid(),2,1e400,'Invalid');raise exception 'Overflow accepted';exception when invalid_parameter_value then null;end;
 begin perform learn_performance_correct(t,m,gen_random_uuid(),2,20,'');raise exception 'Empty reason accepted';exception when invalid_parameter_value then null;end;
 r:=learn_performance_correct(t,m,'00000000-0000-4000-8000-000000000040',2,20,'Corrected arithmetic after checking source');
 if r->>'measurementId'<>'00000000-0000-4000-8000-000000000040' or r->>'reused'<>'false' then raise exception 'Bad correction receipt';end if;
 r:=learn_performance_correct(t,m,'00000000-0000-4000-8000-000000000040',2,20,'Corrected arithmetic after checking source');if r->>'reused'<>'true' then raise exception 'Exact retry failed';end if;
 begin perform learn_performance_correct(t,m,'00000000-0000-4000-8000-000000000040',2,19,'Changed request');raise exception 'Identity reused with changed content';exception when sqlstate 'PT409' then null;end;
 begin perform learn_performance_correct(t,m,gen_random_uuid(),2,19,'Competing correction');raise exception 'Correction fork accepted';exception when sqlstate 'PT409' then null;end;
 if (select review_state from measurements where id='00000000-0000-4000-8000-000000000040')<>'inferred' or exists(select 1 from learn_performance_reviews where measurement_id='00000000-0000-4000-8000-000000000040') then raise exception 'Correction confirmed itself';end if;
 begin perform learn_performance_review(t,m,gen_random_uuid(),2,'confirmed','Stale predecessor');raise exception 'Corrected original approved';exception when sqlstate 'PT409' then null;end;
 perform learn_performance_review(t,'00000000-0000-4000-8000-000000000040',gen_random_uuid(),0,'confirmed','Separate review of corrected calculation');
 perform pg_sleep(.005);
 perform learn_performance_correct(t,'00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000043',1,null,'Withhold until source ambiguity is resolved');
 if (select count(*) from learn_performance_corrections)<>2 then raise exception 'Correction history missing';end if;
 if exists(select 1 from learn_performance_corrections where source_observed_at<>'2026-01-04T00:00:00Z') then raise exception 'Human correction refreshed source evidence';end if;
end $$;
reset role;
do $$ begin
 if exists(select * from correction_sources_before except select m.* from measurements m join correction_sources_before b using(id)) then raise exception 'Source observation changed';end if;
 if exists(select * from correction_reviews_before except select r.* from learn_performance_reviews r join correction_reviews_before b using(id)) then raise exception 'Review history changed';end if;
 if exists(select 1 from measurements m join measurements p on p.id=m.supersedes where m.request_payload ? 'manualCorrectionId' and (m.evidence is distinct from p.evidence or m.exclusions is distinct from p.exclusions or m.source_through is distinct from p.source_through or m.sample_count<>p.sample_count or m.covered_count<>p.covered_count or m.eligible_count is distinct from p.eligible_count or m.metric_id<>p.metric_id or m.subject_id<>p.subject_id or m.window_start<>p.window_start or m.window_end<>p.window_end)) then raise exception 'Correction changed source scope or coverage';end if;
 begin update learn_performance_corrections set reason='Rewrite';raise exception 'Correction edited';exception when restrict_violation then null;end;
 begin delete from learn_performance_corrections;raise exception 'Correction deleted';exception when restrict_violation then null;end;
 begin truncate learn_performance_corrections;raise exception 'Correction truncated';exception when restrict_violation then null;end;
 if has_function_privilege('service_role','learn_performance_correct(uuid,uuid,uuid,integer,numeric,text)','execute') or has_function_privilege('anon','learn_performance_correct(uuid,uuid,uuid,integer,numeric,text)','execute') or has_table_privilege('authenticated','learn_performance_corrections','insert') or has_table_privilege('service_role','learn_performance_corrections','insert') then raise exception 'Correction authority broadened';end if;
end $$;
set role authenticated;
set test.actor='00000000-0000-4000-8000-000000000042';
do $$ begin
 if (select count(*) from learn_performance_corrections)<>0 then raise exception 'Viewer saw corrections';end if;
 begin perform learn_performance_correct('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000043',gen_random_uuid(),0,3,'Viewer');raise exception 'Viewer corrected';exception when insufficient_privilege then null;end;
end $$;
set test.actor='00000000-0000-4000-8000-000000000041';
do $$ begin
 if (select count(*) from learn_performance_corrections)<>0 then raise exception 'Foreign owner saw corrections';end if;
 begin perform learn_performance_correct('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000043',gen_random_uuid(),0,3,'Foreign');raise exception 'Foreign owner corrected';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into view_as_context values('00000000-0000-4000-8000-000000000030',null,now()+interval '1 hour');
set role authenticated;set test.actor='00000000-0000-4000-8000-000000000030';
do $$ begin
 begin perform learn_performance_correct('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000043',gen_random_uuid(),0,3,'Preview');raise exception 'View-as corrected';exception when insufficient_privilege then null;end;
end $$;
reset role;delete from view_as_context;
alter table learn_performance_corrections add constraint injected_failure check(corrected_value is distinct from 999);
set role authenticated;
do $$ begin
 begin perform learn_performance_correct('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000044',0,999,'Rollback');raise exception 'Injected failure ignored';exception when check_violation then null;end;
 if exists(select 1 from measurements where id='00000000-0000-4000-8000-000000000044') then raise exception 'Failed ledger left a measurement';end if;
end $$;
reset role;
alter table learn_performance_corrections drop constraint injected_failure;
-- An independent source observation for the two-session race; remains inferred.
select learn_performance_append('00000000-0000-4000-8000-000000000001',(select p||jsonb_build_object('id','00000000-0000-4000-8000-000000000050','observedAt',clock_timestamp()-interval '1 second') from test_payload),'Synthetic concurrency source');
select 'PASS: numerical correction, retry, old source/review retention, independent review, fixed source freshness, withholding, authority and rollback';
