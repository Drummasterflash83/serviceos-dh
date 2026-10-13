-- Runs after the existing search fixtures and 10,000-job scale fixture.
-- Exercise repeated selective and broad reads under a generic-plan caller.
begin;
set local plan_cache_mode=force_generic_plan;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
set local role authenticated;
do $$declare n integer;r jsonb;baseline jsonb;started timestamptz;begin
 baseline:=learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','Deep retained needle');
 started:=clock_timestamp();
 for n in 1..8 loop
  r:=learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','Deep retained needle');
  assert r=baseline and jsonb_array_length(r->'rows')=1 and r->'rows'->0->>'external_id'='910000';
  assert current_setting('plan_cache_mode')='force_generic_plan','Function setting escaped to caller';
  r:=learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','',null,1);
  assert jsonb_array_length(r->'rows')=1 and r->>'next_cursor' is not null;
  r:=learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','',r->>'next_cursor',1);
  assert jsonb_array_length(r->'rows')=1;
 end loop;
 raise notice 'Repeated selective/broad search elapsed: % ms',round(extract(epoch from clock_timestamp()-started)*1000);
end $$;
rollback;
select 'PASS: repeated retained search under generic-plan caller, pagination and function-setting isolation';
