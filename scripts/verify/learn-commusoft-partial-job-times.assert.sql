-- Actual source-page -> reviewed customer/site -> canonical job, preserving unknown time.
reset role;
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
select fixture_work_page('jobs','{"data":[
 {"id":961,"propertyID":3,"status":"completed","completed":{"completedOnDateTime":"2026-02-30 01:00:00"}},
 {"id":962,"propertyID":3,"status":"completed","createdOnDateTime":"2026-10-25 01:30:00","completed":{"completedOnDateTime":"2026-10-25 01:40:00"}},
 {"id":963,"propertyID":999999,"status":"completed","completed":{"completedOnDateTime":"2026-01-02 01:00:00"}},
 {"id":964,"propertyID":3,"status":"completed","createdOnDateTime":"2026-01-01T01:00:00Z","completed":{"completedOnDateTime":"2026-01-02T01:00:00+01:00"}},
 {"id":965,"propertyID":3,"status":"Closed","completed":{"completedOnDateTime":""}},
 {"id":966,"propertyID":3,"status":"ongoing","createdOnDateTime":42}
],"pagination":{"hasMore":false,"nextCursor":966}}');
create temp table partial_time_existing_jobs as select id,to_jsonb(j) as value from jobs j;
create temp table partial_time_sources as select md5(string_agg(row_to_json(v)::text,'' order by id)) hash from learn_business_input_versions v;
set timezone='Pacific/Auckland';set role authenticated;
do $$declare n integer;r jsonb;first_id uuid;begin
 for n in 955..956 loop
  r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs',n::text),null,'Link job with explicit timezone limitation');
  assert r->>'state'='linked','Usable unzoned job was blocked';
  assert r->'timing_limitations'='["completed"]'::jsonb,'Missing timing limitation';
  first_id:=(r->>'entity_id')::uuid;
  r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs',n::text),null,'Repeat same retained source review');
  assert r->>'already'='true' and (r->>'entity_id')::uuid=first_id,'Replay duplicated job';
  assert r->'timing_limitations'='["completed"]'::jsonb,'Replay lost limitation';
 end loop;
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','961'),null,'Invalid local calendar date');assert r->>'reason'='job_timestamp_invalid';
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','962'),null,'DST local times remain unknown');assert r->>'state'='linked' and r->'timing_limitations'='["completed","created"]'::jsonb;
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','963'),null,'Missing property remains held');assert r->>'reason'='property_missing_or_ambiguous';
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','964'),null,'Known offset retained');assert r->>'state'='linked' and r->'timing_limitations'='[]'::jsonb;
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','965'),null,'Closed does not imply a completion time');assert r->>'state'='linked' and r->'timing_limitations'='[]'::jsonb;
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('jobs','966'),null,'Wrong timestamp type held');assert r->>'reason'='job_timestamp_invalid';
 begin perform learn_commusoft_confirm_work_record(fixture_id(99),fixture_work_version('jobs','955'),null,'Foreign tenant denied');raise exception 'foreign tenant accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;set timezone='UTC';
do $$declare j public.jobs%rowtype;begin
 select * into j from jobs where external_id='955';
 assert j.completed_date is null and j.status='completed' and not j.verified,'Unzoned source became a canonical instant or verified result';
 assert j.metadata#>>'{learn_business_input,timestamps,completed,state}'='timezone_required';
 assert j.metadata#>>'{learn_business_input,timestamps,completed,source}'='2026-01-02 01:00:00','Raw local time changed';
 assert j.metadata#>'{learn_business_input,timestamps,completed,instant}'='null'::jsonb;
 assert exists(select 1 from learn_business_input_links l where l.entity_id=j.id and l.entity_kind='job' and l.card_id is not null),'Source-to-customer card link absent';
 assert exists(select 1 from customer_cards c where c.id=(select card_id from learn_business_input_links where entity_id=j.id)),'Customer card missing';
 assert (select created_date is null and completed_date is null from jobs where external_id='962'),'Ambiguous DST times guessed';
 assert (select created_date='2026-01-01T01:00:00Z'::timestamptz and completed_date='2026-01-02T00:00:00Z'::timestamptz from jobs where external_id='964'),'Explicit offset lost';
 assert (select status='closed' and completed_date is null and metadata#>>'{learn_business_input,timestamps,completed,state}'='absent' from jobs where external_id='965'),'Closure invented completion';
 assert not exists(select 1 from jobs where external_id in ('961','963','966')),'Invalid or orphan record published';
 assert not exists(select 1 from partial_time_existing_jobs b left join jobs x on x.id=b.id where b.value is distinct from to_jsonb(x)),'Existing canonical job changed';
 assert (select hash from partial_time_sources)=(select md5(string_agg(row_to_json(v)::text,'' order by id)) from learn_business_input_versions v),'Retained source changed';
end $$;
select 'PASS: source-to-card job linkage with retained unzoned times, null instants, DST ambiguity, valid offsets, explicit limitations, retry, invalid/orphan holds and preserved existing sources/jobs';
