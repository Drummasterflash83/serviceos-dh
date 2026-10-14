-- Runs after the existing contact-projection fixture in one rolled-back native
-- schema transaction. Original caller/endpoint/receipt tests also run unchanged.
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='92000000-0000-4000-8000-000000000080';
select fixture_source('propertyContacts','{"id":511,"propertyID":2,"firstName":"Jamie","lastName":"Office","position":"Property manager","email":"jamie@example.invalid","telephones":[{"type":"Office","number":"02079460123"}]}');
select fixture_source('propertyContacts','{"id":512,"propertyID":2,"firstName":"Taylor","lastName":"Office","telephones":[{"type":"Office","number":"02079460123"}]}');
select fixture_source('propertyContacts','{"id":513,"propertyID":2,"firstName":"Invalid","lastName":"Endpoint","email":"shared@example.invalid","telephones":[{"number":false}]}');
select fixture_source('propertyContacts','{"id":514,"propertyID":2,"firstName":"Cancelled","lastName":"Separate","email":"shared@example.invalid"}');
select fixture_source('propertyContacts','{"id":515,"propertyID":2,"firstName":"Receipt","lastName":"Rollback","email":"shared@example.invalid"}');
select fixture_source('propertyContacts','{"id":516,"propertyID":2,"firstName":"Operator","lastName":"Separate","email":"shared@example.invalid"}');
create function fixture_separation(n int,source_name text) returns jsonb language plpgsql as $$
declare c jsonb;begin
 c:=public.learn_commusoft_contact_candidates(public.fixture_id(1),public.fixture_version('propertyContacts',n),'person','',null,50);
 return jsonb_build_object('mode','separate_named_person','source_name',source_name,'candidate_ids',(select jsonb_agg(x->'id') from jsonb_array_elements(c->'rows')x),'evidence','Named source contact is a different property manager; the office number is shared.');
end$$;
grant execute on function fixture_separation(integer,text) to authenticated;
create table fixture_separation_original as select 'people' kind,id,to_jsonb(p) row from public.people p union all select 'contact_points',id,to_jsonb(cp) from public.contact_points cp;
create table fixture_separation_requests(id int primary key,request jsonb,result jsonb);
grant all on fixture_separation_requests to authenticated;
set local role authenticated;
do $$declare r jsonb;review jsonb;items jsonb;v uuid:=fixture_version('propertyContacts',511);begin
 r:=learn_commusoft_confirm_contact(fixture_id(1),v,null,'Default collision remains held');assert r->>'reason'='contact_identity_needs_review';
 review:=fixture_separation(511,'Jamie Office');assert jsonb_array_length(review->'candidate_ids')=1;
 items:=jsonb_build_array(jsonb_build_object('version_id',v,'target_id',null,'identity_review',review));
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(711),fixture_id(5),'contact',items,'Distinct named office person reviewed');
 assert r->>'linked'='1' and r->>'held'='0','Separate contact not linked';
 assert r=learn_commusoft_work_batch(fixture_id(1),fixture_id(711),fixture_id(5),'contact',items,'Distinct named office person reviewed'),'Batch replay differs';
 insert into fixture_separation_requests values(511,items,r);
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(712),fixture_id(5),'contact',items,'Same reviewed source replay');
 assert r#>>'{items,0,outcome,already}'='true','Source replay created second person';
 begin perform learn_commusoft_work_batch(fixture_id(1),fixture_id(711),fixture_id(5),'contact',jsonb_set(items,'{0,identity_review,evidence}','"A changed distinction with a different meaning"'),'Distinct named office person reviewed');raise exception 'Changed request accepted';exception when sqlstate 'PT409' then null;end;
 review:=fixture_separation(512,'Taylor Office');assert jsonb_array_length(review->'candidate_ids')=2,'Both shared-phone people not returned';
 items:=jsonb_build_array(jsonb_build_object('version_id',fixture_version('propertyContacts',512),'target_id',null,'identity_review',jsonb_set(review,'{candidate_ids}',(review->'candidate_ids')-0)));
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(713),fixture_id(5),'contact',items,'Incomplete candidate set rejected');assert r#>>'{items,0,outcome,reason}'='contact_separation_candidates_changed';
 items:=jsonb_build_array(jsonb_build_object('version_id',fixture_version('propertyContacts',512),'target_id',null,'identity_review',jsonb_set(review,'{source_name}','"Wrong person"')));
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(714),fixture_id(5),'contact',items,'Changed source name rejected');assert r#>>'{items,0,outcome,reason}'='contact_separation_source_changed';
 items:=jsonb_build_array(jsonb_build_object('version_id',fixture_version('propertyContacts',513),'target_id',null,'identity_review',fixture_separation(513,'Invalid Endpoint')));
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(715),fixture_id(5),'contact',items,'Invalid endpoint leaves no person');assert r#>>'{items,0,outcome,reason}'='contact_phone_invalid';
 items:=jsonb_build_array(jsonb_build_object('version_id',fixture_version('propertyContacts',514),'target_id',null,'identity_review',fixture_separation(514,'Cancelled Separate')));
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(716),fixture_id(5),'contact',items,'Cancel separate person review',true);assert r->>'state'='cancelled';
 assert r=learn_commusoft_work_batch(fixture_id(1),fixture_id(716),fixture_id(5),'contact',items,'Cancel separate person review'),'Cancellation fence failed';
 begin perform learn_commusoft_work_batch(fixture_id(1),fixture_id(717),fixture_id(5),'job',items,'Wrong kind must fail');raise exception 'Job separation accepted';exception when invalid_parameter_value then null;end;
 begin perform learn_commusoft_work_batch(fixture_id(1),fixture_id(718),fixture_id(5),'contact',jsonb_set(items,'{0,target_id}',to_jsonb(fixture_id(83)::text)),'Target plus separation rejected');raise exception 'Target separation accepted';exception when invalid_parameter_value then null;end;
 begin perform learn_commusoft_work_batch(fixture_id(2),fixture_id(719),fixture_id(5),'contact',items,'Foreign tenant denied');raise exception 'Foreign tenant accepted';exception when insufficient_privilege then null;end;
 begin perform learn_commusoft_separate_contact(fixture_id(1),v,'Internal helper is private',review);raise exception 'Private helper exposed';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$declare new_person uuid;c uuid;begin
 select entity_id,card_id into new_person,c from public.learn_business_input_links where tenant_id=fixture_id(1) and collection='propertyContacts' and external_id='511';
 assert new_person is not null and (select display_name='Jamie Office' and primary_email is null and primary_phone is null and not verified from public.people where id=new_person),'New identity or primary choice wrong';
 assert (select count(*)=2 from public.contact_points where person_id=new_person and not is_primary and verification_state='unverified'),'Channels missing or marked verified';
 assert exists(select 1 from public.learn_business_input_projection_attempts where tenant_id=fixture_id(1) and source_version_id=fixture_version('propertyContacts',511) and request#>>'{identity_review,mode}'='separate_named_person' and result->>'entity_id'=new_person::text),'Append-only review evidence missing';
 assert (select metadata#>>'{reviewed_contact_separation,actor_id}'=fixture_id(80)::text from public.people where id=new_person),'Actor evidence missing';
 assert (select count(*)=2 from public.graph_edges e join public.graph_nodes n on n.id=e.from_node_id where n.tenant_id=fixture_id(1) and n.source_id=new_person and e.edge_type='contact_for'),'Owner/site edges missing';
 assert not exists(select 1 from public.people where tenant_id=fixture_id(1) and display_name in ('Taylor Office','Invalid Endpoint','Cancelled Separate')),'Held or cancelled orphan person';
 assert not exists(select 1 from fixture_separation_original f where f.kind='people' and not exists(select 1 from public.people p where p.id=f.id and to_jsonb(p)=f.row)),'Existing people changed';
 assert not exists(select 1 from fixture_separation_original f where f.kind='contact_points' and not exists(select 1 from public.contact_points p where p.id=f.id and to_jsonb(p)=f.row)),'Existing channels changed';
end$$;
create trigger fixture_fail_separation_receipt before insert on public.learn_business_input_projection_batches for each row execute function fixture_fail_receipt();
set local role authenticated;
do $$declare items jsonb;begin
 items:=jsonb_build_array(jsonb_build_object('version_id',fixture_version('propertyContacts',515),'target_id',null,'identity_review',fixture_separation(515,'Receipt Rollback')));
 begin perform learn_commusoft_work_batch(fixture_id(1),fixture_id(720),fixture_id(5),'contact',items,'Receipt failure rolls back separate identity');raise exception 'Receipt failure missed';exception when raise_exception then if sqlerrm<>'synthetic_receipt_failure' then raise;end if;end;
end$$;
reset role;drop trigger fixture_fail_separation_receipt on public.learn_business_input_projection_batches;
do $$begin assert not exists(select 1 from public.people where tenant_id=fixture_id(1) and display_name='Receipt Rollback');end$$;
set local request.jwt.claim.sub='92000000-0000-4000-8000-000000000081';set local role authenticated;
do $$begin begin perform learn_commusoft_work_batch(fixture_id(1),fixture_id(721),fixture_id(5),'contact',(select request from fixture_separation_requests where id=511),'Viewer denied');raise exception 'Viewer accepted';exception when insufficient_privilege then null;end;end$$;
reset role;
-- Existing cross-client operator must use the logged selection path, not profile relocation.
insert into public.platform_authority_grants(profile_id,permission,granted_by,effective_to) values(fixture_id(81),'platform.controlplane.admin','rolled-back separation fixture',clock_timestamp()+interval '5 minutes');
set local role authenticated;
do $$declare args jsonb;r jsonb;review jsonb;begin
 -- Candidate read uses the same explicit logged operator adapter.
 r:=openfolk_business_review(fixture_id(1),'learn_commusoft_contact_candidates','Review selected company contact',jsonb_build_object('p_tenant',fixture_id(1),'p_version',fixture_version('propertyContacts',516),'p_kind','person','p_search','','p_after',null,'p_limit',50));
 review:=jsonb_build_object('mode','separate_named_person','source_name','Operator Separate','candidate_ids',(select jsonb_agg(x->'id') from jsonb_array_elements(r#>'{result,rows}')x),'evidence','Separate named source contact with shared office endpoint; all candidates reviewed.');
 args:=jsonb_build_object('p_tenant',fixture_id(1),'p_request',fixture_id(722),'p_connection',fixture_id(5),'p_kind','contact','p_items',jsonb_build_array(jsonb_build_object('version_id',fixture_version('propertyContacts',516),'target_id',null,'identity_review',review)),'p_reason','Operator reviewed separate named person','p_cancel',false,'p_expected_actor',fixture_id(81));
 r:=openfolk_business_review(fixture_id(1),'learn_commusoft_work_batch','Review selected company contact',args);assert r#>>'{result,linked}'='1';
end$$;
reset role;
do $$begin assert exists(select 1 from public.controlplane_change_log where actor=fixture_id(81)::text and action='business_review.result' and resource_type='learn_commusoft_work_batch');end$$;
select 'Separate named contacts: default hold, full candidate snapshot, stale inputs, replay/conflict, cancellation, no orphan, retained channels/people, tenant/viewer/private helper and logged operator passed.';

-- Audit failure and revocation must fail the same wrapper used by the operator UI.
select fixture_source('propertyContacts','{"id":517,"propertyID":2,"firstName":"Audit","lastName":"Rollback","email":"shared@example.invalid"}');
create function fixture_fail_separation_audit() returns trigger language plpgsql as $$begin if new.action='business_review.result' then raise exception 'synthetic_separation_audit_failure';end if;return new;end$$;
create trigger fixture_fail_separation_audit before insert on public.controlplane_change_log for each row execute function fixture_fail_separation_audit();
select set_config('fixture.separation_operator_person',(select entity_id::text from public.learn_business_input_links where tenant_id=fixture_id(1) and external_id='516' and collection='propertyContacts'),true);
set local role authenticated;
do $$declare items jsonb;args jsonb;review jsonb;begin
 -- The known candidate is the retained shared-email identity; request is rejected
 -- at the final operator audit, after its transactional projection has run.
 review:=jsonb_build_object('mode','separate_named_person','source_name','Audit Rollback','candidate_ids',jsonb_build_array(fixture_id(83),current_setting('fixture.separation_operator_person')::uuid),'evidence','Different named contact, shared office email; review rollback fixture.');
 items:=jsonb_build_array(jsonb_build_object('version_id',fixture_version('propertyContacts',517),'target_id',null,'identity_review',review));
 args:=jsonb_build_object('p_tenant',fixture_id(1),'p_request',fixture_id(723),'p_connection',fixture_id(5),'p_kind','contact','p_items',items,'p_reason','Fail the final operator audit','p_cancel',false,'p_expected_actor',fixture_id(81));
 begin perform openfolk_business_review(fixture_id(1),'learn_commusoft_work_batch','Review selected company contact',args);raise exception 'Audit failure missed' using errcode='XX000';exception when raise_exception then if sqlerrm<>'synthetic_separation_audit_failure' then raise;end if;end;
end$$;
reset role;drop trigger fixture_fail_separation_audit on public.controlplane_change_log;
do $$begin assert not exists(select 1 from public.people where tenant_id=fixture_id(1) and display_name='Audit Rollback');end$$;
update public.platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=fixture_id(81) and permission='platform.controlplane.admin';
set local role authenticated;
do $$begin begin perform openfolk_business_review(fixture_id(1),'learn_commusoft_work_batch','Revoked operator denied','{}');raise exception 'Revoked operator accepted';exception when insufficient_privilege then null;end;end$$;
reset role;
