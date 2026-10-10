set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
select fixture_work_page('jobs','{"data":[
 {"id":951,"propertyID":3,"status":"ongoing","completed":{"completedOnDateTime":""}},
 {"id":952,"propertyID":3,"status":"on_hold","createdOnDateTime":""},
 {"id":953,"propertyID":3,"status":"pending"},
 {"id":954,"propertyID":3,"status":"completed","createdOnDateTime":"2026-01-01T01:00:00Z","completed":{"completedOnDateTime":"2026-01-02T01:00:00+01:00"}},
 {"id":955,"propertyID":3,"status":"completed","completed":{"completedOnDateTime":"2026-01-02 01:00:00"}},
 {"id":956,"propertyID":3,"status":"completed","completed":{"completedOnDateTime":"2026-01-02T01:00:00"}},
 {"id":957,"propertyID":3,"status":"mystery"},
 {"id":958,"propertyID":3,"status":"completed","completed":{"completedOnDateTime":"2026-02-30T01:00:00Z"}}
],"pagination":{"hasMore":false,"nextCursor":958}}');
create temp table lifecycle_source_before as select md5(string_agg(row_to_json(v)::text,'' order by id)) as hash from learn_business_input_versions v;
set role authenticated;
do $$declare r jsonb;n integer;begin
 for n in 951..954 loop
  r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs',n::text),null,'Review observed lifecycle format');
  assert r->>'state'='linked','Known status did not project';
  r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs',n::text),null,'Review observed lifecycle format');
  assert r->>'already'='true','Replay changed identity';
 end loop;
 for n in 955..956 loop
  r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs',n::text),null,'Review timezone before linking');
  assert r->>'state'='held' and r->>'reason'='job_timestamp_timezone_required','Unzoned time guessed';
 end loop;
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','957'),null,'Unknown status held');assert r->>'reason'='job_status_unrecognised';
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','958'),null,'Invalid calendar date held');assert r->>'reason'='job_timestamp_invalid';
end $$;
reset role;
do $$begin
 assert (select status='open' and completed_date is null from jobs where external_id='951');
 assert (select status='on_hold' and created_date is null from jobs where external_id='952');
 assert (select status='pending' from jobs where external_id='953');
 assert (select status='completed' and completed_date='2026-01-02T00:00:00Z'::timestamptz from jobs where external_id='954');
 assert not exists(select 1 from jobs where external_id in('955','956','957','958')),'Held record reached canonical jobs';
 assert (select md5(string_agg(row_to_json(v)::text,'' order by id)) from learn_business_input_versions v)=(select hash from lifecycle_source_before),'Source records changed';
 assert (select to_jsonb(j) from jobs j where id=fixture_id(88))=(select value from fixture_job_baseline),'Existing job overwritten';
end $$;
select 'Observed job lifecycle: ongoing, on_hold, pending, completed, optional blank dates, zoned instants, unresolved timezone holds, unknown/invalid holds, replay and preserved source/existing jobs passed.';
