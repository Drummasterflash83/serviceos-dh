-- Synthetic-only assertions. Hosted callers must wrap and roll back.
set local plpgsql.check_asserts=on;
create function pg_temp.ir(n integer) returns uuid language sql immutable as $$select ('c9821047-eeee-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.ir(integer) to authenticated,anon,service_role;
insert into tenants(id,slug,display_name,status) values(pg_temp.ir(1),'identity-review-a','Synthetic A','active'),(pg_temp.ir(2),'identity-review-b','Synthetic B','active');
insert into auth.users(id,email,banned_until) values(pg_temp.ir(10),'identity-review-admin@example.invalid','infinity'),(pg_temp.ir(11),'identity-review-viewer@example.invalid','infinity'),(pg_temp.ir(12),'identity-review-member@example.invalid','infinity');
insert into profiles(id,tenant_id,role) values(pg_temp.ir(10),null,'viewer'),(pg_temp.ir(11),null,'viewer'),(pg_temp.ir(12),pg_temp.ir(1),'owner') on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into platform_authority_grants(profile_id,permission,effective_from,effective_to,granted_by,reason) values
 (pg_temp.ir(10),'platform.controlplane.admin',now()-interval '1 hour',now()+interval '1 hour','rollback-only','Synthetic assertion'),
 (pg_temp.ir(11),'platform.controlplane.view',now()-interval '1 hour',now()+interval '1 hour','rollback-only','Synthetic assertion');
insert into companies(id,tenant_id,name,domain) values(pg_temp.ir(20),pg_temp.ir(1),'Synthetic company','example.invalid');
insert into people(id,tenant_id,display_name,primary_phone,company_id,verified) values
 (pg_temp.ir(30),pg_temp.ir(1),'Synthetic chosen contact','+441632960000',pg_temp.ir(20),false),
 (pg_temp.ir(31),pg_temp.ir(1),'Synthetic duplicate','+441632960000',null,false),
 (pg_temp.ir(32),pg_temp.ir(2),'Foreign synthetic contact','+441632960000',null,false);
create function pg_temp.ir_seed(n integer) returns void language plpgsql as $$declare i interactions%rowtype;begin
 insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,phone_from,summary,processing_status,metadata)
 values(pg_temp.ir(n),pg_temp.ir(1),'simwood','phone','phone_calls',pg_temp.ir(n+1000),'phone_call','inbound','2026-10-11T10:00:00Z','+441632960000','Synthetic summary','ready','{"PRIVATE_METADATA_CANARY":true,"phone_handoff":{"version":"learn-phone-handoff/1","sourceFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}') returning * into i;
 insert into platform_events(tenant_id,event_type,subject_type,subject_id,status,payload) values(pg_temp.ir(1),'interaction.ready','interaction',i.id,'pending',jsonb_build_object('source_fingerprint',repeat('a',64)));
 perform learn_identity_deliver(pg_temp.ir(1),pg_temp.ir(n+2000),i.id,learn_identity_revision(i),'publish');
end$$;
select pg_temp.ir_seed(n) from generate_series(100,106)n;
create temporary table ir_def(n integer,definition jsonb);
insert into ir_def select n,jsonb_build_object('action','attribute_contact','person_id',pg_temp.ir(30),'reason','Synthetic evidence reviewed','revision',learn_identity_review_state(pg_temp.ir(1),pg_temp.ir(n),pg_temp.ir(30))->>'revision') from generate_series(100,106)n;
grant select on ir_def to authenticated;
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='c9821047-eeee-4000-8000-000000000010';set local role authenticated;
do $$declare r jsonb;d jsonb;begin
 assert jsonb_array_length(learn_operator_identity_reviews(pg_temp.ir(1))->'rows')=7;
 assert jsonb_array_length(learn_operator_identity_people(pg_temp.ir(1),'synthetic')->'rows')=2;
 d:=learn_operator_identity_review_detail(pg_temp.ir(1),pg_temp.ir(100),pg_temp.ir(30));
 assert d->'can_apply'='true' and d->>'hold_reason'='person_ambiguous' and d->'person'->'verified'='false';assert d::text not like '%CANARY%';
 begin perform learn_operator_identity_review_detail(pg_temp.ir(1),pg_temp.ir(100),pg_temp.ir(32));raise exception 'Foreign person accepted';exception when insufficient_privilege then null;end;
 begin perform learn_operator_identity_review_detail(pg_temp.ir(2),pg_temp.ir(100),pg_temp.ir(32));raise exception 'Foreign interaction accepted';exception when insufficient_privilege then null;end;
 r:=learn_operator_identity_review(pg_temp.ir(1),pg_temp.ir(10),pg_temp.ir(3000),pg_temp.ir(100),(select definition from ir_def where n=100),'check');assert r->>'state'='pending';
 r:=learn_operator_identity_review(pg_temp.ir(1),pg_temp.ir(10),pg_temp.ir(3000),pg_temp.ir(100),(select definition from ir_def where n=100));assert r->>'state'='recorded' and r->>'card_processing'='committed';
 assert r=learn_operator_identity_review(pg_temp.ir(1),pg_temp.ir(10),pg_temp.ir(3000),pg_temp.ir(100),(select definition from ir_def where n=100),'check');
 begin perform learn_operator_identity_review(pg_temp.ir(1),pg_temp.ir(10),pg_temp.ir(3000),pg_temp.ir(100),(select definition||'{"reason":"Changed"}' from ir_def where n=100));raise exception 'Conflicting replay accepted';exception when sqlstate 'PT409' then null;end;
 r:=learn_operator_identity_review(pg_temp.ir(1),pg_temp.ir(10),pg_temp.ir(3001),pg_temp.ir(101),(select definition from ir_def where n=101),'cancel');assert r->>'state'='cancelled';
 assert r=learn_operator_identity_review(pg_temp.ir(1),pg_temp.ir(10),pg_temp.ir(3001),pg_temp.ir(101),(select definition from ir_def where n=101));
end$$;reset role;
do $$begin
 assert (select processing_status='enriched' and related_person_id=pg_temp.ir(30) and related_company_id=pg_temp.ir(20) and metadata->'PRIVATE_METADATA_CANARY'='true' from interactions where id=pg_temp.ir(100));
 assert (select previous_interaction->>'processing_status'='identity_review' and reviewed_person->>'display_name'='Synthetic chosen contact' from learn_identity_operator_reviews where id=pg_temp.ir(3000));
 assert (select not verified from people where id=pg_temp.ir(30));
 assert (select status='consumed' from platform_events where subject_id=pg_temp.ir(100));
 assert (select count(*)=1 from customer_cards where tenant_id=pg_temp.ir(1));
 assert (select processing_status='identity_review' from interactions where id=pg_temp.ir(101));
end$$;
-- Exact source/person/company changes require renewed review.
update interactions set summary='Updated evidence' where id=pg_temp.ir(102);
set local role authenticated;do $$begin
 begin perform learn_operator_identity_review(pg_temp.ir(1),pg_temp.ir(10),pg_temp.ir(3002),pg_temp.ir(102),(select definition from ir_def where n=102));raise exception 'Stale source accepted';exception when sqlstate 'PT409' then assert SQLERRM='identity_review_changed';end;
end$$;reset role;
update people set display_name='Renamed contact' where id=pg_temp.ir(30);
set local role authenticated;do $$begin
 begin perform learn_operator_identity_review(pg_temp.ir(1),pg_temp.ir(10),pg_temp.ir(3003),pg_temp.ir(103),(select definition from ir_def where n=103));raise exception 'Stale person accepted';exception when sqlstate 'PT409' then assert SQLERRM='identity_review_changed';end;
end$$;reset role;
update ir_def set definition=jsonb_set(definition,'{revision}',to_jsonb(learn_identity_review_state(pg_temp.ir(1),pg_temp.ir(n),pg_temp.ir(30))->>'revision'));
update companies set name='Renamed company' where id=pg_temp.ir(20);
set local role authenticated;do $$begin
 begin perform learn_operator_identity_review(pg_temp.ir(1),pg_temp.ir(10),pg_temp.ir(3003),pg_temp.ir(103),(select definition from ir_def where n=103));raise exception 'Stale company accepted';exception when sqlstate 'PT409' then assert SQLERRM='identity_review_changed';end;
end$$;reset role;
update ir_def set definition=jsonb_set(definition,'{revision}',to_jsonb(learn_identity_review_state(pg_temp.ir(1),pg_temp.ir(n),pg_temp.ir(30))->>'revision'));
-- A late audit failure rolls back card enrichment, event consumption and links.
create function pg_temp.ir_fail() returns trigger language plpgsql as $$begin raise exception 'Synthetic audit failure' using errcode='P0002';end$$;
create trigger ir_fail before insert on learn_identity_operator_reviews for each row when(new.id='c9821047-eeee-4000-8000-000000003004') execute function pg_temp.ir_fail();
create temporary table ir_before as select to_jsonb(c) card from customer_cards c where tenant_id=pg_temp.ir(1);
set local role authenticated;do $$begin
 begin perform learn_operator_identity_review(pg_temp.ir(1),pg_temp.ir(10),pg_temp.ir(3004),pg_temp.ir(104),(select definition from ir_def where n=104));raise exception 'Audit failure ignored';exception when sqlstate 'P0002' then null;end;
end$$;reset role;
do $$begin
 assert (select processing_status='identity_review' and related_person_id is null from interactions where id=pg_temp.ir(104));
 assert (select status='pending' from platform_events where subject_id=pg_temp.ir(104));
 assert (select to_jsonb(c)=(select card from ir_before) from customer_cards c where tenant_id=pg_temp.ir(1));
 assert not exists(select 1 from learn_identity_delivery_receipts where request_id=pg_temp.ir(3004));
end$$;drop trigger ir_fail on learn_identity_operator_reviews;
-- A rejected suggestion remains rejected; the separate explicit decision is retained.
insert into interaction_match_suggestions(tenant_id,interaction_id,target_type,target_id,match_level,confidence,status) values(pg_temp.ir(1),pg_temp.ir(104),'person',pg_temp.ir(30),'possible',0,'rejected');
update ir_def set definition=jsonb_set(definition,'{revision}',to_jsonb(learn_identity_review_state(pg_temp.ir(1),pg_temp.ir(n),pg_temp.ir(30))->>'revision'));
update customer_cards set title='Manual title',locked_fields=array['title'] where tenant_id=pg_temp.ir(1);
set local role authenticated;do $$begin
 assert jsonb_array_length(learn_operator_identity_review_detail(pg_temp.ir(1),pg_temp.ir(104),pg_temp.ir(30))->'rejected_matches')=1;
 perform learn_operator_identity_review(pg_temp.ir(1),pg_temp.ir(10),pg_temp.ir(3004),pg_temp.ir(104),(select definition from ir_def where n=104));
end$$;reset role;
do $$begin
 assert (select status='rejected' from interaction_match_suggestions where interaction_id=pg_temp.ir(104));
 assert (select title='Manual title' from customer_cards where tenant_id=pg_temp.ir(1));
 assert not has_function_privilege('service_role','learn_identity_deliver_internal(uuid,uuid,uuid,text,text,uuid)','execute');
 assert not has_function_privilege('authenticated','learn_identity_deliver_internal(uuid,uuid,uuid,text,text,uuid)','execute');
 assert not has_table_privilege('authenticated','learn_identity_operator_reviews','select');
 assert not has_table_privilege('service_role','learn_identity_operator_reviews','select');
 assert not has_function_privilege('anon','learn_operator_identity_reviews(uuid,uuid)','execute');
end$$;
-- Current operator authority, not tenant membership or an expired grant.
set local request.jwt.claim.sub='c9821047-eeee-4000-8000-000000000011';set local role authenticated;do $$begin
 perform learn_operator_identity_reviews(pg_temp.ir(1));
 begin perform learn_operator_identity_review(pg_temp.ir(1),pg_temp.ir(11),pg_temp.ir(3005),pg_temp.ir(105),(select definition from ir_def where n=105));raise exception 'Viewer write accepted';exception when insufficient_privilege then null;end;
end$$;reset role;
set local request.jwt.claim.sub='c9821047-eeee-4000-8000-000000000012';set local role authenticated;do $$begin
 begin perform learn_operator_identity_reviews(pg_temp.ir(1));raise exception 'Tenant-only accepted';exception when insufficient_privilege then null;end;
 begin perform learn_operator_identity_review(pg_temp.ir(1),pg_temp.ir(10),pg_temp.ir(3000),pg_temp.ir(100),(select definition from ir_def where n=100),'check');raise exception 'Actor mismatch accepted';exception when insufficient_privilege then null;end;
end$$;reset role;
insert into view_as_context(tenant_id,actor_user_id,subject_kind,reason) values(pg_temp.ir(1),pg_temp.ir(10),'unassigned','Synthetic review');
set local request.jwt.claim.sub='c9821047-eeee-4000-8000-000000000010';set local role authenticated;do $$begin
 begin perform learn_operator_identity_reviews(pg_temp.ir(1));raise exception 'View As accepted';exception when insufficient_privilege then null;end;
end$$;reset role;
update view_as_context set ended_at=clock_timestamp() where actor_user_id=pg_temp.ir(10);
update platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=pg_temp.ir(10);
set local role authenticated;do $$begin
 begin perform learn_operator_identity_reviews(pg_temp.ir(1));raise exception 'Expired grant accepted';exception when insufficient_privilege then null;end;
end$$;reset role;
update platform_authority_grants set effective_to=now()+interval '1 hour' where profile_id=pg_temp.ir(10);
-- Page all holds/contacts without an unbounded initial list.
select pg_temp.ir_seed(n) from generate_series(200,224)n;
insert into people(id,tenant_id,display_name) select pg_temp.ir(n),pg_temp.ir(1),'Paged synthetic person' from generate_series(500,524)n;
set local role authenticated;do $$declare a jsonb;b jsonb;begin
 a:=learn_operator_identity_reviews(pg_temp.ir(1));b:=learn_operator_identity_reviews(pg_temp.ir(1),(a->>'next_cursor')::uuid);
 assert jsonb_array_length(a->'rows')=20 and jsonb_array_length(b->'rows')=10 and b->'next_cursor'='null';
 a:=learn_operator_identity_people(pg_temp.ir(1),'Paged');b:=learn_operator_identity_people(pg_temp.ir(1),'Paged',(a->>'next_cursor')::uuid);
 assert jsonb_array_length(a->'rows')=20 and jsonb_array_length(b->'rows')=5 and b->'next_cursor'='null';
end$$;reset role;
-- Re-attributing previously delivered cards and source-invalid traffic requires
-- their broader correction flow, never silently leaving an old card stale.
update interactions set processing_status='identity_review',metadata=jsonb_set(metadata,'{identity_delivery,state}','"review_required"') where id=pg_temp.ir(100);
do $$begin
 assert learn_identity_review_state(pg_temp.ir(1),pg_temp.ir(100),pg_temp.ir(31))->>'blocked_reason'='previous_delivery_needs_reconciliation';
end$$;
