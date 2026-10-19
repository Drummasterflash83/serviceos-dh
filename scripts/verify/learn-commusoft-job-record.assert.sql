-- The expanded job record is still a fixed, scoped subset of retained source.
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
set role authenticated;
do $$declare r jsonb;begin
 r:=public.learn_commusoft_job_details(public.fixture_id(1),public.fixture_id(5),public.fixture_work_version('jobs','900001'));
 assert r->>'version'='commusoft-job-detail/2','Expanded source contract missing';
 assert r->>'external_id'='900001','Wrong source job';
 assert r->'fields' ?& array['quotedAmount','customerContactName','siteContactName','completedBySourceUser','closedBySourceUser'],'Missing bounded source facets';
 assert not (r::text like '%private@example.invalid%'),'Contact email leaked';
 assert not (r::text like '%never-return%'),'Arbitrary raw field leaked';
 assert r->'fields'->'customerContactName'->'value'='null'::jsonb,'Absent name was invented';
end $$;
reset role;
select 'PASS: expanded source job facets are scoped and bounded' as result;
