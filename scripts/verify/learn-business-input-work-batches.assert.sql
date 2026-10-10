set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
select fixture_work_page('jobs','{"data":[{"id":201,"propertyID":3,"status":"Open"},{"id":202,"propertyID":999,"status":"Open"},{"id":203,"propertyID":3,"status":"Open"},{"id":204,"propertyID":3,"status":"Open"},{"id":205,"propertyID":3,"status":"Open"}],"pagination":{"hasMore":false,"nextCursor":205}}');
set role authenticated;
do $$declare items jsonb;r jsonb;saved jsonb;cursor text;seen text[]:='{}';item jsonb;begin
 loop
  r:=learn_commusoft_work_review_page(fixture_id(1),fixture_id(5),'job',cursor,3);
  for item in select value from jsonb_array_elements(r->'rows') loop
   assert not (item->>'external_id')=any(seen);seen:=array_append(seen,item->>'external_id');
   assert not item ? 'payload';
   if item->>'external_id'='201' then assert item->>'customer_name'='Existing person';end if;
  end loop;
  cursor:=r->>'next_cursor';exit when cursor is null;
 end loop;
 assert cardinality(seen)=19,'work pagination omitted or duplicated identities';
 items:=jsonb_build_array(jsonb_build_object('version_id',fixture_work_version('jobs','201'),'target_id',null),jsonb_build_object('version_id',fixture_work_version('jobs','202'),'target_id',null));
 begin perform learn_commusoft_work_batch(fixture_id(1),fixture_id(91),fixture_id(5),'job',items,'Synthetic batch',false,fixture_id(81));raise exception 'changed actor accepted';exception when insufficient_privilege then null;end;
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(91),fixture_id(5),'job',items,'Synthetic batch');
 assert r->>'state'='recorded' and r->>'linked'='1' and r->>'held'='1';saved:=r;
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(91),fixture_id(5),'job',items,'Synthetic batch');assert r=saved,'replay receipt changed';
 r:=learn_commusoft_work_batch_result(fixture_id(1),fixture_id(91));assert r=saved;
 begin perform learn_commusoft_work_batch(fixture_id(1),fixture_id(91),fixture_id(5),'job',items,'Changed request');raise exception 'changed replay accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_commusoft_work_batch(fixture_id(1),fixture_id(99),fixture_id(55),'job',items,'Wrong connection');raise exception 'foreign connection accepted';exception when invalid_parameter_value then null;end;
 items:=jsonb_build_array(jsonb_build_object('version_id',fixture_work_version('jobs','203'),'target_id',null));
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(92),fixture_id(5),'job',items,'Synthetic cancellation',true);assert r->>'state'='cancelled';saved:=r;
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(92),fixture_id(5),'job',items,'Synthetic cancellation',false);assert r=saved,'late apply escaped cancellation';
end $$;
reset role;
do $$begin
 assert (select count(*) from jobs where external_id='201')=1;
 assert not exists(select 1 from jobs where external_id in ('202','203'));
 assert not exists(select 1 from learn_business_input_projection_batches where id=fixture_id(99));
 assert (select count(*) from learn_business_input_projection_attempts where source_version_id=fixture_work_version('jobs','201'))=1;
 assert not has_table_privilege('authenticated','learn_business_input_projection_batches','SELECT');
end $$;
-- Recording a batch is the same transaction as its row projections.
create function fixture_fail_batch() returns trigger language plpgsql as $$begin raise exception 'injected batch failure';end$$;
create trigger fixture_fail_batch before insert on learn_business_input_projection_batches for each row execute function fixture_fail_batch();
set role authenticated;
do $$begin
 begin perform learn_commusoft_work_batch(fixture_id(1),fixture_id(93),fixture_id(5),'job',jsonb_build_array(jsonb_build_object('version_id',fixture_work_version('jobs','204'),'target_id',null)),'Synthetic failure');raise exception 'failure injection missed';
 exception when raise_exception then if sqlerrm<>'injected batch failure' then raise;end if;end;
end $$;
reset role;
drop trigger fixture_fail_batch on learn_business_input_projection_batches;
do $$begin assert not exists(select 1 from jobs where external_id='204');assert not exists(select 1 from learn_business_input_projection_attempts where source_version_id=fixture_work_version('jobs','204'));end$$;
update feature_flags set value='false' where flag='learn.inputs.commusoft.enabled';
set role authenticated;
do $$declare r jsonb;begin
 r:=learn_commusoft_work_batch_result(fixture_id(1),fixture_id(91));assert r->>'state'='recorded','module disable hid receipt';
 begin perform learn_commusoft_work_batch(fixture_id(1),fixture_id(94),fixture_id(5),'job',jsonb_build_array(jsonb_build_object('version_id',fixture_work_version('jobs','204'),'target_id',null)),'Disabled attempt');raise exception 'disabled module allowed new work';exception when insufficient_privilege then null;end;
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(94),fixture_id(5),'job',jsonb_build_array(jsonb_build_object('version_id',fixture_work_version('jobs','204'),'target_id',null)),'Disabled attempt',true);assert r->>'state'='cancelled';
end $$;
reset role;
update feature_flags set value='true' where flag='learn.inputs.commusoft.enabled';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000081';
set role authenticated;
do $$begin begin perform learn_commusoft_work_batch_result(fixture_id(1),fixture_id(91));raise exception 'viewer receipt access';exception when insufficient_privilege then null;end;end$$;
reset role;
select 'Work batches: paginated summaries, mixed held/linked receipts, exact replay, scope denial, cancellation fencing, disabled-module recovery and atomic rollback passed.';
