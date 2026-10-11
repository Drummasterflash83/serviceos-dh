set request.jwt.claim.sub='bbb50000-0000-4000-8000-000000000001';set role authenticated;
-- A new revision must not reinterpret a request saved under an earlier revision.
select learn_work_collection_begin('aaa50000-0000-4000-8000-000000000001','workingTime','ddd50000-0000-4000-8000-000000000001',
 (member_policy->>'id')::uuid,1,starts+interval '.000070 second',ends,'ff150000-0000-4000-8000-000000000061','Retain explicit original states') from working_collection_fixture;
select learn_work_collection_step('aaa50000-0000-4000-8000-000000000001','ff150000-0000-4000-8000-000000000061',0);
select learn_scorecard_save_draft('aaa50000-0000-4000-8000-000000000001',1,jsonb_set(member_policy,'{metrics,0,workStates}','["ready"]'),'Synthetic next revision excludes waiting state') from working_collection_fixture;
do $$declare r jsonb;t uuid:='aaa50000-0000-4000-8000-000000000001';begin
 r:=learn_work_collection_step(t,'ff150000-0000-4000-8000-000000000061',100);
 while r->>'state'='collecting' loop r:=learn_work_collection_step(t,'ff150000-0000-4000-8000-000000000061',(r->>'processed')::int);end loop;
 assert r->>'state'='completed';
 assert (select value>0 and policy_revision=1 from measurements where id='ff150000-0000-4000-8000-000000000061');
 assert (select states='["ready","waiting"]' from learn_working_collection_runs where run_id='ff150000-0000-4000-8000-000000000061');
end $$;
select learn_work_collection_begin('aaa50000-0000-4000-8000-000000000001','workingTime','ddd50000-0000-4000-8000-000000000001',
 (member_policy->>'id')::uuid,2,starts+interval '.000070 second',ends,'ff150000-0000-4000-8000-000000000062','Use explicit new states') from working_collection_fixture;
do $$declare r jsonb;t uuid:='aaa50000-0000-4000-8000-000000000001';begin
 r:=learn_work_collection_step(t,'ff150000-0000-4000-8000-000000000062',0);
 while r->>'state'='collecting' loop r:=learn_work_collection_step(t,'ff150000-0000-4000-8000-000000000062',(r->>'processed')::int);end loop;
 assert r->>'state'='completed';
 assert (select value=0 and policy_revision=2 from measurements where id='ff150000-0000-4000-8000-000000000062'),'New ready-only rule has no captured owned ready intervals';
 assert (select states='["ready"]' from learn_working_collection_runs where run_id='ff150000-0000-4000-8000-000000000062');
end $$;
reset role;
