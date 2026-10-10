set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
select fixture_work_page('jobs',jsonb_build_object('data',jsonb_build_array(jsonb_build_object('id',900001,'propertyID',3,'description',repeat('🔧',4100),'status','completed','privateKey','never-return','customerContact',jsonb_build_object('email','private@example.invalid'),'completed',jsonb_build_object('completedOnDateTime','2026-01-02 01:00:00'))),'pagination',jsonb_build_object('hasMore',false,'nextCursor',900001)));
select fixture_work_page('jobs','{"data":[{"id":900002,"propertyID":3,"status":"completed","completed":"2026-10-01T00:00:00Z","closed":"2026-10-01 00:00:00"}],"pagination":{"hasMore":false,"nextCursor":900002}}');
create temp table job_detail_preservation as select 'versions' as name,md5(string_agg(to_jsonb(v)::text,'' order by id)) as hash from learn_business_input_versions v
union all select 'jobs',md5(string_agg(to_jsonb(v)::text,'' order by id)) from jobs v
union all select 'links',md5(string_agg(to_jsonb(v)::text,'' order by id)) from learn_business_input_links v
union all select 'attempts',md5(string_agg(to_jsonb(v)::text,'' order by id)) from learn_business_input_projection_attempts v;
set role authenticated;
do $$declare r jsonb;begin
 r:=learn_commusoft_job_details(fixture_id(1),fixture_id(5),fixture_work_version('jobs','955'));
 assert r->'dates'->'completed'->>'state'='timezone_required' and r->'dates'->'completed'->'instant'='null'::jsonb;
 assert r->'dates'->'created'->>'state'='absent' and r->>'current'='true';
 r:=learn_commusoft_job_details(fixture_id(1),fixture_id(5),fixture_work_version('jobs','954'));
 assert r->'dates'->'completed'->>'instant'='2026-01-02T00:00:00.000000Z';
 r:=learn_commusoft_job_details(fixture_id(1),fixture_id(5),fixture_work_version('jobs','958'));
 assert r->'dates'->'completed'->>'state'='invalid';
 r:=learn_commusoft_job_details(fixture_id(1),fixture_id(5),fixture_work_version('jobs','900001'));
 assert length(r->'fields'->'description'->>'value')=4000 and r->'fields'->'description'->>'shortened'='true';
 assert not r::text like '%never-return%' and not r::text like '%private@example.invalid%' and not r ? 'payload';
 r:=learn_commusoft_job_details(fixture_id(1),fixture_id(5),fixture_work_version('jobs','900002'));
 assert r->'dates'->'completed'->>'state'='invalid' and r->'dates'->'closed'->>'state'='invalid','Malformed timestamp parent interpreted as a date';
 r:=learn_commusoft_job_details(fixture_id(1),fixture_id(5),fixture_work_version('jobs','112'));
 assert r->'property_reference'='null'::jsonb,'Malformed property reference inferred';

 begin perform learn_commusoft_job_details(fixture_id(2),fixture_id(5),fixture_work_version('jobs','955'));raise exception 'Foreign company admitted';exception when insufficient_privilege then null;end;
 begin perform learn_commusoft_job_details(fixture_id(1),fixture_id(999),fixture_work_version('jobs','955'));raise exception 'Foreign connection admitted';exception when insufficient_privilege then null;end;
 begin perform learn_commusoft_job_details(fixture_id(1),fixture_id(5),fixture_work_version('properties','3'));raise exception 'Wrong collection admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_commusoft_job_details(fixture_id(1),fixture_id(5),fixture_work_version('jobs','800106'));raise exception 'Unobserved version admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_business_input_time_detail('null');raise exception 'Private helper exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$declare r jsonb;old uuid;begin
 select id into old from learn_business_input_versions where external_id='800103' and payload->>'description'='OldOnlyDescription';
 r:=learn_commusoft_job_details(fixture_id(1),fixture_id(5),old);assert r->>'current'='false';
 r:=learn_commusoft_job_details(fixture_id(1),fixture_id(5),fixture_work_version('jobs','800105'));assert r->>'current'='false';
 assert learn_business_input_time_detail('"2026-02-30 01:00:00"')->>'state'='invalid';
 assert learn_business_input_time_detail('"2026-01-02T24:00:00Z"')->>'state'='invalid';
 assert learn_business_input_time_detail('[]')->>'state'='invalid';
 assert learn_business_input_time_detail('"2026-01-02T01:00:00.000001+01:00"')->>'instant'='2026-01-02T00:00:00.000001Z';
end $$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000081';set role authenticated;
do $$begin begin perform learn_commusoft_job_details(fixture_id(1),fixture_id(5),fixture_work_version('jobs','955'));raise exception 'Viewer admitted';exception when insufficient_privilege then null;end;end $$;
reset role;
do $$begin
 assert not has_function_privilege('anon','learn_commusoft_job_details(uuid,uuid,uuid)','execute');
 assert not has_function_privilege('service_role','learn_commusoft_job_details(uuid,uuid,uuid)','execute');
 assert not exists(select 1 from jobs where external_id in('955','956','958','900001')),'Detail read published a held job';
 assert not exists(select 1 from job_detail_preservation b join (
 select 'versions' as name,md5(string_agg(to_jsonb(v)::text,'' order by id)) as hash from learn_business_input_versions v
 union all select 'jobs',md5(string_agg(to_jsonb(v)::text,'' order by id)) from jobs v
 union all select 'links',md5(string_agg(to_jsonb(v)::text,'' order by id)) from learn_business_input_links v
 union all select 'attempts',md5(string_agg(to_jsonb(v)::text,'' order by id)) from learn_business_input_projection_attempts v
 )a using(name) where a.hash is distinct from b.hash),'Detail read changed retained records';
end $$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
select 'PASS: scoped retained detail, timezone/invalid/absent/UTC dates, stale and ambiguous versions, Unicode clipping, private field exclusion, access denial and unchanged source/canonical/projection records';

begin;
update feature_flags set value='false'::jsonb where tenant_id=fixture_id(1) and flag='learn.inputs.commusoft.enabled';
set role authenticated;
do $$begin begin perform learn_commusoft_job_details(fixture_id(1),fixture_id(5),fixture_work_version('jobs','955'));raise exception 'Disabled module admitted';exception when insufficient_privilege then null;end;end $$;
reset role;rollback;
begin;
update profiles set role='viewer' where id=fixture_id(80);
set role authenticated;
do $$begin begin perform learn_commusoft_job_details(fixture_id(1),fixture_id(5),fixture_work_version('jobs','955'));raise exception 'Same-session revocation ignored';exception when insufficient_privilege then null;end;end $$;
reset role;rollback;
select 'PASS: OpenFolk input toggle and same-session owner revocation still control detail access';
