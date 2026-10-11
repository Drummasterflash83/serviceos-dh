-- Exercise the real governed correction RPC on automatic working-time receipts.
create table working_correction_before as select
 (select md5(string_agg(to_jsonb(x)::text,'' order by id)) from measurements x) measurements,
 (select md5(string_agg(to_jsonb(x)::text,'' order by id)) from learn_work_collection_runs x) runs,
 (select md5(string_agg(to_jsonb(x)::text,'' order by run_id,ordinal)) from learn_working_collection_items x) inputs;
set request.jwt.claim.sub='bbb50000-0000-4000-8000-000000000001';set role authenticated;
do $$declare t uuid:='aaa50000-0000-4000-8000-000000000001';r jsonb;begin
 assert not has_function_privilege('authenticated','learn_performance_append(uuid,jsonb,text)','EXECUTE'),'Browser users must not append invented automatic values';
 r:=learn_performance_correct(t,'ff150000-0000-4000-8000-000000000001','ff150000-0000-4000-8000-000000000051',0,null,'Synthetic withholding pending source review');
 assert r->>'reused'='false';
 assert learn_performance_correct(t,'ff150000-0000-4000-8000-000000000001','ff150000-0000-4000-8000-000000000051',0,null,'Synthetic withholding pending source review')->>'reused'='true';
 begin perform learn_performance_correct(t,'ff150000-0000-4000-8000-000000000001','ff150000-0000-4000-8000-000000000052',0,0,'Forked correction');raise exception 'Fork accepted';exception when sqlstate 'PT409' then null;end;
end $$;
reset role;
select pg_sleep(.01);
set role authenticated;
select learn_performance_correct('aaa50000-0000-4000-8000-000000000001','ff150000-0000-4000-8000-000000000051','ff150000-0000-4000-8000-000000000052',0,0,'Synthetic explicit correction after review');
select learn_performance_correct('aaa50000-0000-4000-8000-000000000001','ff150000-0000-4000-8000-000000000002','ff150000-0000-4000-8000-000000000053',0,null,'Synthetic team withholding');
reset role;
do $$declare original measurements%rowtype;c measurements%rowtype;r learn_performance_corrections%rowtype;begin
 select * into original from measurements where id='ff150000-0000-4000-8000-000000000001';
 for c in select * from measurements where id in ('ff150000-0000-4000-8000-000000000051','ff150000-0000-4000-8000-000000000052') loop
  select * into r from learn_performance_corrections where id=c.id;
  assert found and r.source_observed_at=original.measured_at and r.corrected_value is not distinct from c.value;
  assert c.source_through=original.source_through and c.review_state='inferred';
  assert c.evidence=original.evidence and c.exclusions=original.exclusions and c.sample_count=original.sample_count and c.covered_count=original.covered_count and c.eligible_count=original.eligible_count;
  assert c.request_payload->>'manualCorrectionId'=c.id::text and c.request_payload->>'supersedes'=r.predecessor_id::text;
 end loop;
 assert (select measurements=(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from measurements x where id not in
  ('ff150000-0000-4000-8000-000000000051','ff150000-0000-4000-8000-000000000052','ff150000-0000-4000-8000-000000000053')) from working_correction_before),'Corrections must preserve every original observation';
 assert (select runs=(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from learn_work_collection_runs x) from working_correction_before),'Corrections must preserve collection receipts';
 assert (select inputs=(select md5(string_agg(to_jsonb(x)::text,'' order by run_id,ordinal)) from learn_working_collection_items x) from working_correction_before),'Corrections must preserve frozen evidence';
end $$;
