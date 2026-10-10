-- Ten thousand jobs, in actual bounded synthetic source pages. No live source data.
do $$declare n integer;body jsonb;begin
 for n in 0..99 loop
  select jsonb_build_object('data',jsonb_agg(jsonb_build_object('id',900000+n*100+i,'propertyID',800001,'status','ongoing','description',case when n=99 and i=100 then 'Deep retained needle' else 'Bulk synthetic job' end)),'pagination',jsonb_build_object('hasMore',false,'nextCursor',900000+n*100+100)) into body from generate_series(1,100) i;
  perform fixture_work_page('jobs',body);
 end loop;
end $$;
analyze learn_business_input_versions;analyze learn_business_input_observations;analyze learn_business_input_pages;
create function fixture_review_search_benchmark() returns jsonb language plpgsql as $$declare started timestamptz:=clock_timestamp();r jsonb;elapsed numeric;begin
 r:=learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','Deep retained needle');
 elapsed:=extract(epoch from clock_timestamp()-started)*1000;
 assert jsonb_array_length(r->'rows')=1 and r->'rows'->0->>'external_id'='910000' and r->'next_cursor'='null'::jsonb,'Deep search missed an imported record';
 return jsonb_build_object('additional_retained_jobs',10000,'matching_records',jsonb_array_length(r->'rows'),'elapsed_ms',round(elapsed));
end $$;
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';set role authenticated;
select fixture_review_search_benchmark();
reset role;
select 'PASS: searching beyond the first 10,000 source records returns the matching retained job';
