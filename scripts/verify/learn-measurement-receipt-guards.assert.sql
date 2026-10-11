-- Existing mismatched data is retained, never reclassified as trustworthy.
do $$declare m measurements%rowtype; role_name text;begin
 for m in select * from measurements where source like 'serviceos.work.%' and id<>'ab160000-0000-4000-8000-000000000001' loop
  perform learn_work_measurement_receipt_check(m.tenant_id,m.id);
 end loop;
 begin perform learn_work_measurement_receipt_check((select tenant_id from receipt_legacy_fixture),'ab160000-0000-4000-8000-000000000001');
  raise exception 'Legacy mismatched reference accepted';exception when invalid_parameter_value then null;end;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  assert not has_function_privilege(role_name,'learn_work_measurement_receipt_check(uuid,uuid)','EXECUTE'),'Private validator exposed';
  assert not has_function_privilege(role_name,'learn_measurement_receipt_constraint()','EXECUTE'),'Trigger exposed';
 end loop;
 assert not exists(select 1 from receipt_functions_before f join pg_proc p on p.oid=f.oid where f.definition<>pg_get_functiondef(p.oid) or f.proacl is distinct from p.proacl),'Existing RPC contracts changed';
end $$;
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
-- Old mismatched observations can be disputed, but cannot acquire confirmation.
do $$declare f receipt_legacy_fixture%rowtype;actor uuid;begin
 select * into f from receipt_legacy_fixture;
 select id into actor from profiles where tenant_id=f.tenant_id and role in ('owner','admin') limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin
  perform learn_performance_review(f.tenant_id,'ab160000-0000-4000-8000-000000000001',gen_random_uuid(),0,'confirmed','Synthetic invalid source confirmation');
  set constraints all immediate;
  raise exception 'Invalid old evidence confirmed';
 exception when invalid_parameter_value then null;end;
 set constraints all deferred;
 perform learn_performance_review(f.tenant_id,'ab160000-0000-4000-8000-000000000001','ab160000-0000-4000-8000-000000000002',0,'disputed','Synthetic source mismatch reported');
 set constraints all immediate;
end $$;
-- Preservation includes the deliberately old mismatched row and existing RPC ACLs.
do $$begin
 assert not exists(select 1 from receipt_preservation_before b left join measurements m on m.id=b.id where to_jsonb(m) is distinct from b.row),'Prior measurement changed';
 assert (select decision='disputed' from learn_performance_reviews where id='ab160000-0000-4000-8000-000000000002'),'Dispute not retained';
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
 foreach variant in array array['changed_value','legacy_mismatch'] loop
  begin
   bad:=to_jsonb(a)||jsonb_build_object('id',gen_random_uuid());
   if variant='changed_value' then bad:=jsonb_set(bad,'{snapshot,measurements,0,value}','123456789');
   else bad:=jsonb_set(bad,'{snapshot,measurements}',(select jsonb_build_array(to_jsonb(m)) from measurements m where id='ab160000-0000-4000-8000-000000000001'));end if;
   insert into learn_assessments select * from jsonb_populate_record(null::learn_assessments,bad);
   set constraints all immediate;
   raise exception 'Invalid assessment was retained: %',variant;
  exception when invalid_parameter_value then null;end;
  set constraints all deferred;
 end loop;
 assert (select count(*) from learn_assessments)=n,'Rejected assessment remained';
 assert (select to_jsonb(x)=to_jsonb(a) from learn_assessments x where id=a.id),'Original assessment changed';
end $$;
