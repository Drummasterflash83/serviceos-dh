-- Synthetic post-install receipt/assessment journeys in the disposable scoring clone.
-- Exercise actual append and transaction-completion rollback with malformed new
-- private receipts. These synthetic administrative inserts are confined to this
-- disposable verification database; real clients have no such table grants.
do $$declare base learn_work_collection_runs%rowtype; raw jsonb; payload jsonb; mutation text;
 rid uuid; rejected boolean;before_count bigint;begin
 select * into strict base from learn_work_collection_runs where id='ff150000-0000-4000-8000-000000000001';
 select count(*) into before_count from measurements;
 foreach mutation in array array['subject','period','value','policy','coverage','processed','contract','reference','forged_correction'] loop
  rejected:=false;rid:=gen_random_uuid();
  begin
   raw:=to_jsonb(base)||jsonb_build_object('id',rid,'proof',base.proof||jsonb_build_object('runId',rid));
   if mutation='subject' then raw:=jsonb_set(raw,'{subject_id}',to_jsonb(gen_random_uuid()));end if;
   if mutation='period' then raw:=jsonb_set(raw,'{window_start}',to_jsonb(base.window_start+interval '1 microsecond'));end if;
   if mutation='value' then raw:=jsonb_set(raw,'{proof,value}','123456789');end if;
   if mutation='policy' then raw:=jsonb_set(raw,'{policy_revision}','99');end if;
   if mutation='coverage' then raw:=jsonb_set(raw,'{proof,coveredItems}','0');end if;
   if mutation='processed' then raw:=jsonb_set(raw,'{proof,itemCount}','0');end if;
   if mutation='contract' then raw:=jsonb_set(raw,'{proof,contract}','"wrong"');end if;
   insert into learn_work_collection_runs select * from jsonb_populate_record(null::learn_work_collection_runs,raw);
   select request_payload||jsonb_build_object('id',rid,'evidence',jsonb_build_array(jsonb_build_object('table','learn_work_collection_runs','id',rid))) into payload
    from measurements where id=base.id;
   if mutation='reference' then payload:=jsonb_set(payload,'{evidence,0,id}',to_jsonb(base.id));end if;
   if mutation='forged_correction' then payload:=payload||jsonb_build_object('manualCorrectionId',rid);end if;
   perform learn_performance_append(base.tenant_id,payload,'Synthetic invalid receipt '||mutation);
   set constraints all immediate;
  exception when invalid_parameter_value then rejected:=true;
  end;
  assert rejected,'Invalid receipt mutation accepted: '||mutation;
  set constraints all deferred;
  assert not exists(select 1 from measurements where id=rid),'Failed measurement remained';
  assert not exists(select 1 from learn_work_collection_runs where id=rid),'Failed source receipt remained';
 end loop;
 assert (select count(*) from measurements)=before_count,'Rejection changed observation count';
end $$;
-- Publish real rules prospectively, then collect and retain a real assessment.
create table receipt_assessment_fixture(publication uuid,starts timestamptz,ends timestamptz);
grant select,insert,update on receipt_assessment_fixture to authenticated;
set request.jwt.claim.sub='bbb50000-0000-4000-8000-000000000001';set role authenticated;
do $$declare p jsonb;f working_collection_fixture%rowtype;begin
 select * into f from working_collection_fixture;
 p:=learn_scorecard_publish('aaa50000-0000-4000-8000-000000000001',(f.member_policy->>'id')::uuid,2,'ab160000-0000-4000-8000-000000000010','Synthetic receipt-bound published rules');
 insert into receipt_assessment_fixture values((p->>'publicationId')::uuid,(p->>'effectiveFrom')::timestamptz,null);
end $$;
reset role;
select pg_sleep(.01);
update receipt_assessment_fixture set ends=clock_timestamp();
set role authenticated;
do $$declare p jsonb;f receipt_assessment_fixture%rowtype;t uuid:='aaa50000-0000-4000-8000-000000000001';begin
 select * into f from receipt_assessment_fixture;
 p:=learn_work_collection_begin(t,'workingTime','ddd50000-0000-4000-8000-000000000001',(select (member_policy->>'id')::uuid from working_collection_fixture),2,f.starts,f.ends,'ab160000-0000-4000-8000-000000000011','Synthetic published collection');
 while p->>'state'='collecting' loop p:=learn_work_collection_step(t,'ab160000-0000-4000-8000-000000000011',(p->>'processed')::int);end loop;
 assert p->>'state'='completed';
end $$;
select learn_performance_review('aaa50000-0000-4000-8000-000000000001','ab160000-0000-4000-8000-000000000011','ab160000-0000-4000-8000-000000000012',0,'confirmed','Synthetic exact receipt checked');
do $$declare f receipt_assessment_fixture%rowtype;r jsonb;begin
 select * into f from receipt_assessment_fixture;
 r:=learn_assessment_save('aaa50000-0000-4000-8000-000000000001','ab160000-0000-4000-8000-000000000013',f.publication,'member','ddd50000-0000-4000-8000-000000000001',null,f.starts,f.ends,
 '[{"id":"ab160000-0000-4000-8000-000000000011","reviewRevision":1}]','Synthetic receipt-bound assessment');
 assert r->>'reused'='false';
 r:=learn_assessment_save('aaa50000-0000-4000-8000-000000000001','ab160000-0000-4000-8000-000000000013',f.publication,'member','ddd50000-0000-4000-8000-000000000001',null,f.starts,f.ends,
 '[{"id":"ab160000-0000-4000-8000-000000000011","reviewRevision":1}]','Synthetic receipt-bound assessment');
 assert r->>'reused'='true';
end $$;
reset role;
do $$declare a learn_assessments%rowtype;bad jsonb;n integer;variant text;begin
 select * into strict a from learn_assessments where id='ab160000-0000-4000-8000-000000000013';
 select count(*) into n from learn_assessments;
 foreach variant in array array['changed_value'] loop
  begin
   bad:=to_jsonb(a)||jsonb_build_object('id',gen_random_uuid());
   if variant='changed_value' then bad:=jsonb_set(bad,'{snapshot,measurements,0,value}','123456789');
   end if;
   insert into learn_assessments select * from jsonb_populate_record(null::learn_assessments,bad);
   set constraints all immediate;
   raise exception 'Invalid assessment was retained: %',variant;
  exception when invalid_parameter_value then null;end;
  set constraints all deferred;
 end loop;
 assert (select count(*) from learn_assessments)=n,'Rejected assessment remained';
 assert (select to_jsonb(x)=to_jsonb(a) from learn_assessments x where id=a.id),'Original assessment changed';
end $$;

-- Recover the actual retained assessment and prove cancellation blocks a late save.
set request.jwt.claim.sub='bbb50000-0000-4000-8000-000000000001';set role authenticated;
do $$declare f receipt_assessment_fixture%rowtype;r jsonb;t uuid:='aaa50000-0000-4000-8000-000000000001';
 subject uuid:='ddd50000-0000-4000-8000-000000000001';
 expected jsonb:='[{"id":"ab160000-0000-4000-8000-000000000011","reviewRevision":1}]';
 request_id uuid:='ab160000-0000-4000-8000-000000000020';begin
 select * into strict f from receipt_assessment_fixture;
 r:=learn_assessment_resolve(t,'ab160000-0000-4000-8000-000000000013',f.publication,'member',subject,null,f.starts,f.ends,expected,'Synthetic receipt-bound assessment',true);
 assert r->>'state'='recorded' and r->>'assessmentId'='ab160000-0000-4000-8000-000000000013';
 r:=learn_assessment_resolve(t,request_id,f.publication,'member',subject,null,f.starts,f.ends,expected,'Synthetic cancelled assessment',false);
 assert r->>'state'='pending';
 r:=learn_assessment_resolve(t,request_id,f.publication,'member',subject,null,f.starts,f.ends,expected,'Synthetic cancelled assessment',true);
 assert r->>'state'='cancelled';
 begin perform learn_assessment_save(t,request_id,f.publication,'member',subject,null,f.starts,f.ends,expected,'Synthetic cancelled assessment');
 raise exception 'Cancelled assessment saved';exception when sqlstate 'PT409' then null;end;
end $$;
reset role;
do $$declare m record;begin
 for m in select tenant_id,id from public.measurements where source like 'serviceos.work.%' loop
  perform public.learn_work_measurement_receipt_check(m.tenant_id,m.id);
 end loop;
end $$;
